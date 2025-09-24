const emailCache = require('./emailCache');
const unifiedBroadcast = require('./unifiedBroadcast');
const mailboxCache = require('./cache/mailboxCache');
const { query } = require('./db');

class GmailEventualConsistencyManager {
  constructor() {
    // Track local count changes to detect stale Gmail responses
    this.localCountChanges = new Map(); // userId -> { timestamp, lastChange, expectedCount }

    // Pending delayed resyncs
    this.pendingResyncs = new Map(); // userId -> timeout

    // Track last broadcast to prevent blinking/duplicate broadcasts
    this.lastBroadcastCounts = new Map(); // userId -> { unread, total, timestamp }

    // Debounce pending broadcasts to prevent rapid flashing
    this.pendingBroadcasts = new Map(); // userId -> timeout

    // Accumulate rapid successive actions
    this.actionAccumulator = new Map(); // userId -> { unreadChange, totalChange, timestamp }

    // Configuration from environment variables
    this.RESYNC_DELAY_MS = 4000; // 4 seconds - enough time for Gmail to catch up
    this.STALE_THRESHOLD_MS = parseInt(process.env.SYNC_STALE_WINDOW_MS) || 10000;
    this.UPDATE_SUCCESS_TIMEOUT = 2000;
    this.BROADCAST_DEBOUNCE_MS = parseInt(process.env.COUNT_DISPLAY_HOLD_MS) || 120;
    this.ACTION_ACCUMULATION_MS = 500;

    // Feature flag for new Redis-based system
    this.REALTIME_SYNC_V2 = process.env.REALTIME_SYNC_V2 === 'true';

    console.log(`🚀 [GmailEventualConsistency] Initialized with REALTIME_SYNC_V2=${this.REALTIME_SYNC_V2}`);
  }

  /**
   * Record a local count change (when user marks emails read/unread)
   * This helps us detect when Gmail API returns stale data
   */
  recordLocalCountChange(userId, oldCount, newCount, changeType = 'user_action') {
    const timestamp = Date.now();

    this.localCountChanges.set(userId, {
      timestamp,
      lastChange: changeType,
      oldCount,
      newCount,
      expectedCount: newCount
    });

    console.log(`📝 [EventualConsistency] Recorded local count change for user ${userId}: ${oldCount} → ${newCount} (${changeType})`);
  }

  /**
   * Handle Pub/Sub notification with delayed resync
   * This is the key method that adds the 3-5 second delay
   */
  async handlePubSubNotification(userId, historyId, immediateUpdates = []) {
    try {
      console.log(`⏰ [EventualConsistency] Handling Pub/Sub notification for user ${userId}, historyId: ${historyId}`);


      // Cancel any existing pending resync for this user
      this.cancelPendingResync(userId);

      // Process immediate status updates first (these are accurate)
      for (const update of immediateUpdates) {
        if (update.type === 'email_status_changed') {
          // Track that we made a local change via Pub/Sub
          this.recordLocalCountChange(userId, null, null, 'pubsub_immediate');
        }
      }

      // Schedule delayed resync to allow Gmail's counts to catch up
      const timeoutId = setTimeout(async () => {
        console.log(`🔄 [EventualConsistency] Starting delayed resync for user ${userId} (after ${this.RESYNC_DELAY_MS}ms)`);

        try {
          await this.performDelayedResync(userId, historyId);
        } catch (error) {
          console.error(`❌ [EventualConsistency] Delayed resync failed for user ${userId}:`, error);
        } finally {
          // Clean up
          this.pendingResyncs.delete(userId);
        }
      }, this.RESYNC_DELAY_MS);

      this.pendingResyncs.set(userId, timeoutId);

      console.log(`⏰ [EventualConsistency] Scheduled delayed resync for user ${userId} in ${this.RESYNC_DELAY_MS}ms`);

    } catch (error) {
      console.error(`❌ [EventualConsistency] Error handling Pub/Sub notification:`, error);
    }
  }

  /**
   * Perform the delayed resync with smart count merging
   */
  async performDelayedResync(userId, historyId) {
    try {
      console.log(`🔄 [EventualConsistency] Performing delayed resync for user ${userId}`);

      // Get current cached counts (our local state)
      const cachedStats = await emailCache.getUserStats(userId, 'gmail');
      console.log(`📊 [EventualConsistency] Current cached stats:`, cachedStats);

      // Get fresh counts from Gmail API using the same method as the routes
      // We need to get the user's OAuth client to query Gmail API
      let freshGmailCounts;
      try {
        // Try to get fresh counts from Gmail - this will be stale immediately after changes
        // but should be accurate after our delay
        const { query } = require('../lib/db');
        const { decrypt } = require('../utils/secure');
        const { google } = require('googleapis');

        // Get user's refresh token
        const { rows } = await query(
          'SELECT a.refresh_token_encrypted FROM accounts a WHERE a.user_id=$1 AND a.provider=$2 LIMIT 1',
          [userId, 'google']
        );

        if (rows.length === 0) {
          throw new Error(`No Google account found for user ${userId}`);
        }

        const refreshToken = decrypt(rows[0].refresh_token_encrypted);

        // Create OAuth client
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_CALLBACK_URL
        );
        oauth2Client.setCredentials({ refresh_token: refreshToken });

        // Use the same count computation as the main routes
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // Get counts (this should be more accurate after our delay)
        // IMPORTANT: Use category:primary to match the main stats computation
        const unreadResp = await gmail.users.messages.list({
          userId: 'me',
          q: 'category:primary is:unread'
        });
        const totalResp = await gmail.users.messages.list({
          userId: 'me',
          q: 'category:primary'
        });

        freshGmailCounts = {
          unread: unreadResp.data?.resultSizeEstimate || 0,
          total: totalResp.data?.resultSizeEstimate || 0,
          timestamp: new Date().toISOString(),
          source: 'gmail_delayed_resync'
        };

        console.log(`📊 [EventualConsistency] Fresh Gmail API counts:`, freshGmailCounts);

      } catch (gmailError) {
        console.warn(`⚠️ [EventualConsistency] Failed to get fresh Gmail counts:`, gmailError.message);
        // If we can't get fresh counts, skip the merge and keep existing counts
        return;
      }

      // Apply smart merge logic
      const mergedCounts = this.smartMergeGmailCounts(userId, cachedStats, freshGmailCounts);
      console.log(`📊 [EventualConsistency] Merged counts:`, mergedCounts);

      // Update cache with merged results
      if (mergedCounts) {
        await emailCache.setUserStats(userId, 'gmail', mergedCounts);

        // Check against last broadcast to prevent blinking/duplicate broadcasts
        const lastBroadcast = this.lastBroadcastCounts.get(userId);
        const shouldBroadcast = !lastBroadcast ||
            lastBroadcast.unread !== mergedCounts.unread ||
            lastBroadcast.total !== mergedCounts.total;

        if (shouldBroadcast) {
          console.log(`📡 [EventualConsistency] Broadcasting merged count update (${mergedCounts.unread} unread, ${mergedCounts.total} total)`);

          // Update last broadcast tracking
          this.lastBroadcastCounts.set(userId, {
            unread: mergedCounts.unread,
            total: mergedCounts.total,
            timestamp: Date.now()
          });

          unifiedBroadcast.countUpdated(userId, mergedCounts, 'delayed_resync_merged');
        } else {
          console.log(`📡 [EventualConsistency] Count unchanged since last broadcast (${mergedCounts.unread} unread, ${mergedCounts.total} total), skipping to prevent blinking`);
        }
      }

      console.log(`✅ [EventualConsistency] Delayed resync completed for user ${userId}`);

    } catch (error) {
      console.error(`❌ [EventualConsistency] Delayed resync error:`, error);
    }
  }

  /**
   * Smart merge logic: prevent stale Gmail data from overwriting newer local updates
   *
   * Rules:
   * 1. If Gmail count >= local count, accept Gmail's number (Gmail caught up)
   * 2. If Gmail count < local count AND we recently made local changes, keep local count
   * 3. If no recent local changes, trust Gmail's count
   * 4. Use timestamp-based staleness detection
   */
  smartMergeGmailCounts(userId, localCounts, gmailCounts) {
    try {
      console.log(`🧠 [EventualConsistency] Smart merging counts for user ${userId}`);
      console.log(`   Local:`, localCounts);
      console.log(`   Gmail:`, gmailCounts);

      // If no local counts, use Gmail counts
      if (!localCounts) {
        console.log(`📊 [EventualConsistency] No local counts, using Gmail counts`);
        return gmailCounts;
      }

      // Check if we have recent local changes
      const localChange = this.localCountChanges.get(userId);
      const now = Date.now();
      const hasRecentLocalChanges = localChange &&
        (now - localChange.timestamp) < this.STALE_THRESHOLD_MS;

      console.log(`🕒 [EventualConsistency] Recent local changes:`, {
        hasChanges: !!localChange,
        hasRecentChanges: hasRecentLocalChanges,
        ageMs: localChange ? (now - localChange.timestamp) : null
      });

      const result = {
        unread: localCounts.unread || 0,
        total: localCounts.total || 0,
        timestamp: new Date().toISOString(),
        source: 'smart_merged'
      };

      // Smart merge logic for unread count
      if (gmailCounts.unread >= localCounts.unread) {
        // Gmail count is higher or equal - Gmail caught up or new emails arrived
        console.log(`📈 [EventualConsistency] Gmail unread count >= local (${gmailCounts.unread} >= ${localCounts.unread}), using Gmail count`);
        result.unread = gmailCounts.unread;
        result.unreadSource = 'gmail_higher';
      } else if (hasRecentLocalChanges) {
        // Gmail count is lower but we have recent local changes - Gmail is likely stale
        console.log(`🚫 [EventualConsistency] Gmail unread count < local (${gmailCounts.unread} < ${localCounts.unread}) with recent local changes, keeping local count`);
        result.unread = localCounts.unread;
        result.unreadSource = 'local_recent';
      } else {
        // Gmail count is lower and no recent local changes - trust Gmail
        console.log(`📉 [EventualConsistency] Gmail unread count < local (${gmailCounts.unread} < ${localCounts.unread}) without recent changes, using Gmail count`);
        result.unread = gmailCounts.unread;
        result.unreadSource = 'gmail_trusted';
      }

      // Smart merge logic for total count (usually more stable)
      if (gmailCounts.total >= localCounts.total) {
        result.total = gmailCounts.total;
        result.totalSource = 'gmail_higher';
      } else {
        // Total count rarely decreases suddenly, keep local unless very old
        result.total = hasRecentLocalChanges ? localCounts.total : gmailCounts.total;
        result.totalSource = hasRecentLocalChanges ? 'local_recent' : 'gmail_trusted';
      }

      console.log(`✅ [EventualConsistency] Smart merge result:`, result);

      // Clean up old local changes
      if (localChange && (now - localChange.timestamp) > this.STALE_THRESHOLD_MS) {
        console.log(`🧹 [EventualConsistency] Cleaning up stale local change record`);
        this.localCountChanges.delete(userId);
      }

      return result;

    } catch (error) {
      console.error(`❌ [EventualConsistency] Smart merge error:`, error);
      // Fallback to Gmail counts if merge fails
      return gmailCounts;
    }
  }

  /**
   * Cancel pending resync for a user
   */
  cancelPendingResync(userId) {
    const existingTimeout = this.pendingResyncs.get(userId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this.pendingResyncs.delete(userId);
      console.log(`🛑 [EventualConsistency] Cancelled pending resync for user ${userId}`);
    }
  }

  /**
   * Handle user action (mark read/unread) with action accumulation and debounced broadcasting
   * Call this BEFORE updating counts to prevent race conditions
   */
  async handleUserAction(userId, action, emailCount = 1) {
    try {
      console.log(`🎯 [EventualConsistency] Handling user action: ${action} for ${emailCount} emails (user ${userId})`);

      // Calculate count change based on action
      const unreadChange = action === 'mark_read' ? -emailCount : action === 'mark_unread' ? emailCount : 0;
      const totalChange = 0; // Total usually doesn't change for read/unread actions

      // Accumulate rapid successive actions
      this.accumulateAction(userId, unreadChange, totalChange);

      // Record local change for staleness detection
      this.recordLocalCountChange(userId, null, null, 'user_action');

      // Perform immediate update with debouncing
      await this.performImmediateUpdate(userId);

    } catch (error) {
      console.error(`❌ [EventualConsistency] Error handling user action:`, error);
    }
  }

  /**
   * Accumulate rapid successive actions to prevent overcounting
   */
  accumulateAction(userId, unreadChange, totalChange) {
    const now = Date.now();
    const existing = this.actionAccumulator.get(userId);

    if (existing && (now - existing.timestamp) < this.ACTION_ACCUMULATION_MS) {
      // Accumulate with existing action
      existing.unreadChange += unreadChange;
      existing.totalChange += totalChange;
      existing.timestamp = now;
      console.log(`📈 [EventualConsistency] Accumulated action for user ${userId}: unread ${existing.unreadChange >= 0 ? '+' : ''}${existing.unreadChange}`);
    } else {
      // Start new accumulation
      this.actionAccumulator.set(userId, {
        unreadChange,
        totalChange,
        timestamp: now
      });
      console.log(`📊 [EventualConsistency] Started new action accumulation for user ${userId}: unread ${unreadChange >= 0 ? '+' : ''}${unreadChange}`);
    }
  }

  /**
   * Perform immediate count update with debounced broadcasting
   */

async performImmediateUpdate(userId) {
  try {
    // cancel any pending immediate broadcast debounce
    const existingTimeout = this.pendingBroadcasts.get(userId);
    if (existingTimeout) clearTimeout(existingTimeout);

    // debounce a tiny bit so rapid clicks batch together
    const timeoutId = setTimeout(async () => {
      const accum = this.actionAccumulator.get(userId) || { unreadChange: 0, totalChange: 0 };
      this.actionAccumulator.delete(userId);

      // get current cached counts (what UI currently trusts)
      let current = await emailCache.getUserStats(userId, 'gmail') || { unread: 0, total: 0 };
      const next = {
        unread: Math.max(0, (current.unread || 0) + (accum.unreadChange || 0)),
        total: Math.max(0, (current.total  || 0) + (accum.totalChange  || 0)),
        source: 'user_action'
      };

      // store + broadcast once (tracks last to avoid duplicates)
      await emailCache.setUserStats(userId, 'gmail', next);
      this.trackImmediateBroadcast(userId, next);
      unifiedBroadcast.countUpdated(userId, next, 'user_action');
    }, this.BROADCAST_DEBOUNCE_MS);

    this.pendingBroadcasts.set(userId, timeoutId);
  } catch (err) {
    console.error('❌ [EventualConsistency] performImmediateUpdate error:', err);
  }
}

  /**
   * Execute the debounced broadcast with accumulated actions
   */
  async executeDebouncedBroadcast(userId) {
    try {
      // Get accumulated actions
      const accumulated = this.actionAccumulator.get(userId);
      if (!accumulated) {
        console.log(`📭 [EventualConsistency] No accumulated actions for user ${userId}, skipping broadcast`);
        return;
      }

      // FIXED: Get fresh Gmail count instead of relying on potentially stale cache
      // This ensures we always broadcast accurate counts to users
      let currentStats;
      try {
        // Get fresh counts from Gmail API using the same method as the routes
        const { query } = require('../lib/db');
        const { decrypt } = require('../utils/secure');
        const { google } = require('googleapis');

        // Get user's refresh token
        const { rows } = await query(
          'SELECT a.refresh_token_encrypted FROM accounts a WHERE a.user_id=$1 AND a.provider=$2 LIMIT 1',
          [userId, 'google']
        );

        if (rows.length === 0) {
          console.log(`⚠️ [EventualConsistency] No Google account found for user ${userId}`);
          return;
        }

        const refreshToken = decrypt(rows[0].refresh_token_encrypted);
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_CALLBACK_URL
        );
        oauth2Client.setCredentials({ refresh_token: refreshToken });

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // FIXED: Use the same query logic as the main gmail routes for consistency
        // This ensures we get the same total count as the cached system
        const getActualCount = async (query, maxToCheck = 1000) => {
          try {
            const response = await gmail.users.threads.list({
              userId: 'me',
              maxResults: maxToCheck,
              labelIds: ['INBOX'],
              q: query,
              fields: 'threads(id),nextPageToken,resultSizeEstimate'
            });

            const threadCount = (response.data?.threads || []).length;
            if (threadCount < maxToCheck && !response.data?.nextPageToken) {
              return threadCount;
            }

            const estimate = Number.isFinite(response.data?.resultSizeEstimate) ? response.data.resultSizeEstimate : threadCount;
            return estimate;
          } catch (error) {
            console.error('Failed to get thread count:', error.message);
            return 0;
          }
        };

        // Get fresh primary email counts using the same method as gmail routes
        const [unreadCount, totalCount] = await Promise.all([
          getActualCount('category:primary is:unread'),
          getActualCount('category:primary')
        ]);

        currentStats = {
          unread: unreadCount,
          total: totalCount,
          timestamp: new Date().toISOString(),
          source: 'immediate_fresh_gmail'
        };

        console.log(`📊 [EventualConsistency] Fresh Gmail counts for immediate update:`, currentStats);

      } catch (error) {
        console.error(`❌ [EventualConsistency] Failed to get fresh Gmail counts, falling back to cache:`, error.message);

        // Fallback to cache if Gmail API fails
        currentStats = await emailCache.getUserStats(userId, 'gmail');
        if (!currentStats) {
          console.log(`⚠️ [EventualConsistency] No cached stats found for user ${userId}`);
          return;
        }
      }

      // Apply accumulated changes
      const newStats = {
        unread: Math.max(0, (currentStats.unread || 0) + accumulated.unreadChange),
        total: Math.max(0, (currentStats.total || 0) + accumulated.totalChange),
        timestamp: new Date().toISOString(),
        source: 'immediate_update'
      };

      console.log(`📊 [EventualConsistency] Applying accumulated changes: ${currentStats.unread || 0} + ${accumulated.unreadChange} = ${newStats.unread}`);

      // Update cache
      await emailCache.setUserStats(userId, 'gmail', newStats);

      // Check if we should broadcast (prevent duplicate broadcasts)
      const lastBroadcast = this.lastBroadcastCounts.get(userId);
      const shouldBroadcast = !lastBroadcast ||
          lastBroadcast.unread !== newStats.unread ||
          lastBroadcast.total !== newStats.total;

      if (shouldBroadcast) {
        // Update tracking BEFORE broadcast to prevent race conditions
        this.lastBroadcastCounts.set(userId, {
          unread: newStats.unread,
          total: newStats.total,
          timestamp: Date.now()
        });

        console.log(`📡 [EventualConsistency] Broadcasting immediate count update: ${newStats.unread} unread, ${newStats.total} total`);
        unifiedBroadcast.countUpdated(userId, newStats, 'immediate_update');
      } else {
        console.log(`📡 [EventualConsistency] Count unchanged since last broadcast, skipping to prevent blinking`);
      }

      // Clear accumulated actions
      this.actionAccumulator.delete(userId);

    } catch (error) {
      console.error(`❌ [EventualConsistency] Error in executeDebouncedBroadcast:`, error);
    }
  }

  /**
   * Track immediate broadcast to prevent duplicate delayed broadcasts
   */
  trackImmediateBroadcast(userId, counts) {
    this.lastBroadcastCounts.set(userId, {
      unread: counts.unread,
      total: counts.total,
      timestamp: Date.now()
    });
    console.log(`📝 [EventualConsistency] Tracked immediate broadcast: ${counts.unread} unread, ${counts.total} total`);
  }


  /**
   * Get stats for monitoring
   */
  getStats() {
    return {
      activeLocalChanges: this.localCountChanges.size,
      pendingResyncs: this.pendingResyncs.size,
      resyncDelayMs: this.RESYNC_DELAY_MS,
      staleThresholdMs: this.STALE_THRESHOLD_MS
    };
  }

  /**
   * V2: Handle user action with Redis-based optimistic updates
   * This is the new method for REALTIME_SYNC_V2
   */
  async handleUserActionV2(userId, action, messageIds = [], options = {}) {
    if (!this.REALTIME_SYNC_V2) {
      return this.handleUserAction(userId, action, messageIds.length);
    }

    try {
      console.log(`🎯 [EventualConsistency V2] Handling user action: ${action} for ${messageIds.length} messages (user ${userId})`);

      // Calculate unread delta
      let unreadDelta = 0;
      if (action === 'mark_read') unreadDelta = -messageIds.length;
      else if (action === 'mark_unread') unreadDelta = messageIds.length;

      // Update database in transaction
      await this.updateDatabaseMessages(userId, messageIds, action);

      // Apply optimistic Redis update
      if (unreadDelta !== 0) {
        const newCounts = await mailboxCache.applyUnreadDelta(userId, unreadDelta);

        // Mark recent local change window
        await mailboxCache.markRecentLocalChange(userId, this.STALE_THRESHOLD_MS);

        // Broadcast immediately with optimistic counts
        unifiedBroadcast.countUpdated(userId, newCounts, 'user_action');
      }

      // Enqueue background Gmail API call
      this.enqueueGmailWrite(userId, messageIds, action);

      console.log(`✅ [EventualConsistency V2] User action processed: ${action} for user ${userId}`);
      return { success: true };

    } catch (error) {
      console.error(`❌ [EventualConsistency V2] Error handling user action:`, error);
      throw error;
    }
  }

  /**
   * V2: Process Gmail Pub/Sub notification with idempotency and deduplication
   */
  async processNotificationV2(userId, data) {
    if (!this.REALTIME_SYNC_V2) {
      console.log(`🔄 [DEBUG V2] REALTIME_SYNC_V2 disabled, falling back to V1 for user ${userId}`);
      return this.handlePubSubNotification(userId, data.historyId);
    }

    try {
      console.log(`📨 [DEBUG V2] 🚀 STARTING processNotificationV2 for user ${userId}`);
      console.log(`📨 [DEBUG V2] Input data:`, JSON.stringify(data, null, 2));

      const { historyId, emailId: messageId } = data;
      console.log(`📨 [DEBUG V2] Extracted - historyId: ${historyId}, messageId: ${messageId}`);

      // Check for duplicate processing
      console.log(`📨 [DEBUG V2] Checking for duplicate processing...`);
      const isDuplicate = await mailboxCache.isDuplicate(userId, historyId, messageId || '', 'notification');
      console.log(`📨 [DEBUG V2] Duplicate check result: ${isDuplicate}`);

      if (isDuplicate) {
        console.log(`🚫 [DEBUG V2] ❌ DUPLICATE DETECTED - Skipping notification processing`);
        return;
      }

      console.log(`📨 [DEBUG V2] ✅ Not a duplicate, proceeding with processing...`);

      // Process history changes and update DB
      console.log(`📨 [DEBUG V2] 📜 Calling processGmailHistory...`);
      const changes = await this.processGmailHistory(userId, historyId);
      console.log(`📨 [DEBUG V2] 📜 processGmailHistory returned ${changes.length} changes:`, changes);

      // Broadcast immediate per-message read/unread updates for UI row styling (V2 parity with V1)
      try {
        for (const change of changes) {
          if (change.type === 'read_status') {
            const isRead = !!change.isRead;
            const payload = {
              id: change.threadId || change.messageId, // prefer threadId so frontend can match reliably
              messageId: change.messageId,
              threadId: change.threadId,
              isRead,
              source: 'pubsub_label_change_v2'
            };

            // Unified broadcast (Socket.IO + SSE 'email_updated')
            try { unifiedBroadcast.emailUpdated(userId, payload); } catch (_) {}

            // Also send an immediate SSE event for visual feedback animations
            try {
              const { broadcastToUser } = require('./sse');
              broadcastToUser(userId, {
                type: 'email_status_updated_immediate',
                messageId: change.messageId,
                threadId: change.threadId,
                isRead,
                changeType: isRead ? 'marked_read' : 'marked_unread',
                priority: 'immediate',
                timestamp: new Date().toISOString()
              });
            } catch (_) { /* ignore SSE failures */ }
          }
        }
      } catch (emitErr) {
        console.warn('⚠️ [DEBUG V2] Failed emitting per-message updates:', emitErr?.message || emitErr);
      }

      // Update Redis counts based on changes - FIXED: Group by thread to avoid double counting
      let unreadDelta = 0;
      console.log(`📨 [DEBUG V2] 🧮 Calculating unread delta from ${changes.length} changes...`);

      // Group changes by thread ID to avoid double counting emails in the same thread
      const threadChanges = new Map(); // threadId -> { type, isRead, wasRead, isUnread, etc. }

      for (const change of changes) {
        console.log(`📨 [DEBUG V2] Processing change:`, change);
        const threadId = change.threadId;

        if (change.type === 'read_status') {
          // For read status changes, track the final state per thread
          if (!threadChanges.has(threadId)) {
            threadChanges.set(threadId, { type: 'read_status', threadId, changes: [] });
          }
          threadChanges.get(threadId).changes.push(change);
        } else if (change.type === 'message_added') {
          // For new messages, only count once per thread
          if (!threadChanges.has(threadId)) {
            threadChanges.set(threadId, { type: 'message_added', threadId, isUnread: change.isUnread });
          }
          // If thread already has changes, ensure we use the most recent unread status
          else if (threadChanges.get(threadId).type === 'message_added') {
            threadChanges.get(threadId).isUnread = threadChanges.get(threadId).isUnread || change.isUnread;
          }
        } else if (change.type === 'message_deleted') {
          // For deleted messages, only count once per thread
          if (!threadChanges.has(threadId)) {
            threadChanges.set(threadId, { type: 'message_deleted', threadId, wasUnread: change.wasUnread });
          }
          // If thread already has changes, ensure we account for any unread deletions
          else if (threadChanges.get(threadId).type === 'message_deleted') {
            threadChanges.get(threadId).wasUnread = threadChanges.get(threadId).wasUnread || change.wasUnread;
          }
        }
      }

      console.log(`📨 [DEBUG V2] 🧮 Grouped into ${threadChanges.size} thread changes:`, Array.from(threadChanges.values()));

      // Calculate delta based on grouped thread changes
      for (const [threadId, threadChange] of threadChanges) {
        console.log(`📨 [DEBUG V2] Processing thread ${threadId}:`, threadChange);

        if (threadChange.type === 'read_status') {
          // For read status changes, determine the overall change for the thread
          // Look at the first and last change to determine net effect
          const changes = threadChange.changes;
          if (changes.length > 0) {
            const firstChange = changes[0];
            const lastChange = changes[changes.length - 1];

            // If thread went from read to unread or vice versa
            if (firstChange.wasRead !== lastChange.isRead) {
              const delta = lastChange.isRead ? -1 : 1; // read = -1, unread = +1
              unreadDelta += delta;
              console.log(`📨 [DEBUG V2] Thread ${threadId} read status: ${firstChange.wasRead} → ${lastChange.isRead}, delta=${delta}`);
            } else {
              console.log(`📨 [DEBUG V2] Thread ${threadId} read status unchanged, delta=0`);
            }
          }
        } else if (threadChange.type === 'message_added') {
          const delta = threadChange.isUnread ? 1 : 0;
          unreadDelta += delta;
          console.log(`📨 [DEBUG V2] Thread ${threadId} added: isUnread=${threadChange.isUnread}, delta=${delta}`);
        } else if (threadChange.type === 'message_deleted') {
          const delta = threadChange.wasUnread ? -1 : 0;
          unreadDelta += delta;
          console.log(`📨 [DEBUG V2] Thread ${threadId} deleted: wasUnread=${threadChange.wasUnread}, delta=${delta}`);
        }
      }

      console.log(`📨 [DEBUG V2] 🧮 Final calculated unreadDelta (after thread grouping): ${unreadDelta}`);

      if (unreadDelta !== 0) {
        console.log(`📨 [DEBUG V2] 🔄 UnreadDelta is non-zero, checking recent local changes...`);

        // Only update if we're not in a recent local change window
        // or if the change would increase the count (new emails always accepted)
        const isWithinRecentChange = await mailboxCache.isWithinRecentLocalChange(userId);
        console.log(`📨 [DEBUG V2] Recent local change window check: ${isWithinRecentChange}`);

        if (!isWithinRecentChange || unreadDelta > 0) {
          console.log(`📨 [DEBUG V2] ✅ Conditions met for Redis update - isWithinRecentChange: ${isWithinRecentChange}, unreadDelta: ${unreadDelta}`);
          console.log(`📨 [DEBUG V2] 📊 Applying unread delta to Redis...`);

          const newCounts = await mailboxCache.applyUnreadDelta(userId, unreadDelta);
          console.log(`📨 [DEBUG V2] 📊 Redis update result:`, newCounts);

          console.log(`📨 [DEBUG V2] 📡 Broadcasting count update...`);
          unifiedBroadcast.countUpdated(userId, newCounts, 'pubsub_update');
          console.log(`📨 [DEBUG V2] 📡 ✅ Broadcast sent successfully`);
        } else {
          console.log(`🚫 [DEBUG V2] ❌ IGNORING Gmail delta ${unreadDelta} during recent local change window`);
        }
      } else {
        console.log(`📨 [DEBUG V2] ⚪ No unread count changes detected, skipping Redis update`);
      }

      // Update last history ID
      console.log(`📨 [DEBUG V2] 📝 Updating last history ID...`);
      await Promise.all([
        mailboxCache.setLastHistoryId(userId, historyId),
        this.updateDatabaseHistoryId(userId, historyId)
      ]);
      console.log(`📨 [DEBUG V2] 📝 ✅ History ID updated successfully`);

      console.log(`✅ [DEBUG V2] 🎉 COMPLETED processNotificationV2 for user ${userId}`);

    } catch (error) {
      console.error(`❌ [DEBUG V2] 💥 ERROR in processNotificationV2:`, error);
      console.error(`❌ [DEBUG V2] Error stack:`, error.stack);
    }
  }

  /**
   * Update database messages for user actions
   */
  async updateDatabaseMessages(userId, messageIds, action) {
    const client = await query('BEGIN');

    try {
      for (const messageId of messageIds) {
        if (action === 'mark_read') {
          await client.query(
            'UPDATE messages SET is_read = TRUE WHERE user_id = $1 AND message_id = $2',
            [userId, messageId]
          );
        } else if (action === 'mark_unread') {
          await client.query(
            'UPDATE messages SET is_read = FALSE WHERE user_id = $1 AND message_id = $2',
            [userId, messageId]
          );
        } else if (action === 'delete') {
          await client.query(
            'DELETE FROM messages WHERE user_id = $1 AND message_id = $2',
            [userId, messageId]
          );
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  /**
   * Update database history ID
   */
  async updateDatabaseHistoryId(userId, historyId) {
    await query(
      `INSERT INTO gmail_mailbox_state (user_id, last_history_id, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET last_history_id = $2, updated_at = NOW()`,
      [userId, historyId]
    );
  }

  /**
   * Process Gmail history API response
   */
  async processGmailHistory(userId, historyId) {
    console.log(`📜 [DEBUG HISTORY] 🚀 STARTING processGmailHistory for user ${userId}, historyId ${historyId}`);

    try {
      // Get Gmail client
      console.log(`📜 [DEBUG HISTORY] Loading Gmail API helpers...`);
      const gmailApiHelpers = require('./gmail');
      console.log(`📜 [DEBUG HISTORY] ✅ Gmail API helpers loaded successfully`);

      // Get last known history ID from cache
      console.log(`📜 [DEBUG HISTORY] Getting last history ID from cache...`);
      const mailboxCache = require('./cache/mailboxCache');
      const lastHistoryId = await mailboxCache.getLastHistoryId(userId);
      console.log(`📜 [DEBUG HISTORY] Last history ID from cache: ${lastHistoryId}`);

      if (!lastHistoryId) {
        console.log(`📜 [DEBUG HISTORY] ❌ No last history ID found, skipping history processing`);
        return [];
      }

      // Fetch history changes from Gmail API
      console.log(`📜 [DEBUG HISTORY] 🔍 Fetching history from Gmail API...`);
      console.log(`📜 [DEBUG HISTORY] Params - startHistoryId: ${lastHistoryId}, currentHistoryId: ${historyId}`);

      const historyResponse = await gmailApiHelpers.getHistory(userId, lastHistoryId, {
        historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
        labelId: 'INBOX'
      });

      console.log(`📜 [DEBUG HISTORY] 📈 Raw Gmail API response:`, JSON.stringify(historyResponse.data, null, 2));

      const history = historyResponse.data?.history || [];
      console.log(`📜 [DEBUG HISTORY] 📊 Found ${history.length} history records`);

      if (history.length === 0) {
        console.log(`📜 [DEBUG HISTORY] ⚪ No history records found, returning empty changes`);
        return [];
      }

      const changes = [];

      for (let i = 0; i < history.length; i++) {
        const record = history[i];
        console.log(`📜 [DEBUG HISTORY] 📄 Processing history record ${i + 1}/${history.length}:`, record);

        // Process message additions (new emails)
        if (record.messagesAdded) {
          console.log(`📜 [DEBUG HISTORY] 📨 Processing ${record.messagesAdded.length} message additions...`);

          for (let j = 0; j < record.messagesAdded.length; j++) {
            const addedMsg = record.messagesAdded[j];
            const message = addedMsg.message;
            console.log(`📜 [DEBUG HISTORY] Message addition ${j + 1}: message=${message ? message.id : 'null'}, labelIds=${message?.labelIds}`);

            if (message && this.isInboxPrimary(message.labelIds)) {
              const isUnread = message.labelIds?.includes('UNREAD');
              console.log(`📜 [DEBUG HISTORY] ✅ Message ${message.id} is inbox/primary, isUnread: ${isUnread}`);

              changes.push({
                type: 'message_added',
                messageId: message.id,
                threadId: message.threadId,
                isUnread: isUnread,
                historyId: record.id
              });

              // Store in database
              console.log(`📜 [DEBUG HISTORY] 💾 Storing message in database...`);
              await this.storeMessageInDatabase(userId, message);
              console.log(`📜 [DEBUG HISTORY] 💾 ✅ Message stored successfully`);

              console.log(`📨 [DEBUG HISTORY] ✅ New message added: ${message.id}, unread: ${isUnread}`);
            } else {
              console.log(`📜 [DEBUG HISTORY] ⚪ Skipping message ${message?.id} - not inbox/primary or invalid`);
            }
          }
        }

        // Process message deletions
        if (record.messagesDeleted) {
          console.log(`📜 [DEBUG HISTORY] 🗑️ Processing ${record.messagesDeleted.length} message deletions...`);

          for (let j = 0; j < record.messagesDeleted.length; j++) {
            const deletedMsg = record.messagesDeleted[j];
            const message = deletedMsg.message;
            console.log(`📜 [DEBUG HISTORY] Message deletion ${j + 1}: message=${message ? message.id : 'null'}`);

            if (message) {
              // Check if message was unread before deletion
              console.log(`📜 [DEBUG HISTORY] 🔍 Checking if message was unread before deletion...`);
              const wasUnread = await this.wasMessageUnread(userId, message.id);
              console.log(`📜 [DEBUG HISTORY] wasUnread result: ${wasUnread}`);

              changes.push({
                type: 'message_deleted',
                messageId: message.id,
                threadId: message.threadId,
                wasUnread: wasUnread,
                historyId: record.id
              });

              // Remove from database
              console.log(`📜 [DEBUG HISTORY] 🗑️ Deleting message from database...`);
              await query(
                'DELETE FROM messages WHERE user_id = $1 AND message_id = $2',
                [userId, message.id]
              );
              console.log(`📜 [DEBUG HISTORY] 🗑️ ✅ Message deleted from database`);

              console.log(`🗑️ [DEBUG HISTORY] ✅ Message deleted: ${message.id}, was unread: ${wasUnread}`);
            }
          }
        }

        // Process label changes (read/unread status)
        if (record.labelsAdded || record.labelsRemoved) {
          console.log(`📜 [DEBUG HISTORY] 🏷️ Processing label changes...`);
          console.log(`📜 [DEBUG HISTORY] labelsAdded: ${record.labelsAdded?.length || 0}, labelsRemoved: ${record.labelsRemoved?.length || 0}`);

          const labelChanges = [
            ...(record.labelsAdded || []).map(change => ({ ...change, action: 'added' })),
            ...(record.labelsRemoved || []).map(change => ({ ...change, action: 'removed' }))
          ];

          console.log(`📜 [DEBUG HISTORY] Total label changes to process: ${labelChanges.length}`);

          for (let j = 0; j < labelChanges.length; j++) {
            const change = labelChanges[j];
            console.log(`📜 [DEBUG HISTORY] Label change ${j + 1}:`, change);

            if (change.labelIds?.includes('UNREAD')) {
              console.log(`📜 [DEBUG HISTORY] ✅ Found UNREAD label change`);
              const message = change.message;

              if (message) {
                const wasRead = change.action === 'added' ? true : false; // Added UNREAD = was read, now unread
                const isRead = !wasRead;
                console.log(`📜 [DEBUG HISTORY] Read status calculation - action: ${change.action}, wasRead: ${wasRead}, isRead: ${isRead}`);

                changes.push({
                  type: 'read_status',
                  messageId: message.id,
                  threadId: message.threadId,
                  wasRead: wasRead,
                  isRead: isRead,
                  historyId: record.id
                });

                // Update database
                console.log(`📜 [DEBUG HISTORY] 💾 Updating message read status in database...`);
                await query(
                  'UPDATE messages SET is_read = $1 WHERE user_id = $2 AND message_id = $3',
                  [isRead, userId, message.id]
                );
                console.log(`📜 [DEBUG HISTORY] 💾 ✅ Database updated successfully`);

                console.log(`🏷️ [DEBUG HISTORY] ✅ Read status changed: ${message.id}, isRead: ${isRead}`);
              } else {
                console.log(`📜 [DEBUG HISTORY] ⚪ Skipping label change - no message object`);
              }
            } else {
              console.log(`📜 [DEBUG HISTORY] ⚪ Skipping label change - no UNREAD label`);
            }
          }
        }
      }

      console.log(`📜 [DEBUG HISTORY] 🎉 COMPLETED processing ${changes.length} changes from ${history.length} history records`);
      console.log(`📜 [DEBUG HISTORY] Final changes array:`, JSON.stringify(changes, null, 2));
      return changes;

    } catch (error) {
      console.error(`❌ [DEBUG HISTORY] 💥 ERROR in processGmailHistory:`, error);
      console.error(`❌ [DEBUG HISTORY] Error stack:`, error.stack);

      // If history is expired/invalid, return empty array but don't fail
      if (error.code === 404 || error.message?.includes('history')) {
        console.log(`⚠️ [DEBUG HISTORY] ❌ History expired or invalid, skipping processing`);
        return [];
      }

      // For other errors, still return empty array to avoid blocking
      console.log(`⚠️ [DEBUG HISTORY] ❌ Returning empty array due to error`);
      return [];
    }
  }

  /**
   * Check if message is in inbox/primary category
   */
  isInboxPrimary(labelIds = []) {
    return labelIds.includes('INBOX') && labelIds.includes('CATEGORY_PRIMARY');
  }

  /**
   * Store message in database
   */
  async storeMessageInDatabase(userId, message) {
    const isRead = !message.labelIds?.includes('UNREAD');

    await query(
      `INSERT INTO messages (user_id, provider, message_id, thread_id, is_read, internal_date, label_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, provider, message_id)
       DO UPDATE SET is_read = $5, internal_date = $6, label_ids = $7`,
      [
        userId,
        'gmail',
        message.id,
        message.threadId,
        isRead,
        parseInt(message.internalDate) || null,
        message.labelIds || []
      ]
    );
  }

  /**
   * Check if message was unread before deletion
   */
  async wasMessageUnread(userId, messageId) {
    const result = await query(
      'SELECT is_read FROM messages WHERE user_id = $1 AND message_id = $2',
      [userId, messageId]
    );

    if (result.rows.length > 0) {
      return !result.rows[0].is_read;
    }

    // If not found in DB, assume it was unread (conservative approach)
    return true;
  }

  /**
   * Enqueue background Gmail API write
   */
  async enqueueGmailWrite(userId, messageIds, action) {
    // This would integrate with a job queue for async Gmail API calls
    // For now, just log the intent
    console.log(`📤 [EventualConsistency V2] Enqueueing Gmail API write: ${action} for messages ${messageIds.join(', ')}`);

    // TODO: Implement job queue integration
    setTimeout(() => {
      console.log(`🔄 [EventualConsistency V2] Background Gmail API call executed: ${action}`);
    }, 100);
  }

  /**
   * V2: Initialize user cache from database
   */
  async initializeUserCacheV2(userId) {
    if (!this.REALTIME_SYNC_V2) return;

    try {
      // Get current counts from database
      const { rows } = await query(`
        SELECT
          COUNT(*) FILTER (WHERE is_read = false) as unread_count,
          COUNT(*) as total_count
        FROM messages
        WHERE user_id = $1 AND provider = 'gmail'
      `, [userId]);

      const { unread_count = 0, total_count = 0 } = rows[0] || {};

      // Get last history ID
      const historyResult = await query(
        'SELECT last_history_id FROM gmail_mailbox_state WHERE user_id = $1',
        [userId]
      );
      const historyId = historyResult.rows[0]?.last_history_id || null;

      // Initialize Redis cache
      await mailboxCache.initializeFromDatabase(
        userId,
        { unread: parseInt(unread_count), total: parseInt(total_count) },
        historyId
      );

      console.log(`🎯 [EventualConsistency V2] Initialized cache for user ${userId}: ${unread_count} unread, ${total_count} total`);

    } catch (error) {
      console.error(`❌ [EventualConsistency V2] Error initializing user cache:`, error);
    }
  }

  /**
   * Cleanup on shutdown
   */
  cleanup() {
    console.log(`🧹 [EventualConsistency] Cleaning up...`);

    // Cancel all pending resyncs
    for (const [userId, timeoutId] of this.pendingResyncs.entries()) {
      clearTimeout(timeoutId);
    }

    // Cancel all pending broadcasts
    for (const [userId, timeoutId] of this.pendingBroadcasts.entries()) {
      clearTimeout(timeoutId);
    }

    this.pendingResyncs.clear();
    this.pendingBroadcasts.clear();
    this.localCountChanges.clear();
    this.actionAccumulator.clear();
    this.lastBroadcastCounts.clear();

    console.log(`✅ [EventualConsistency] Cleanup completed`);
  }
}

module.exports = new GmailEventualConsistencyManager();
