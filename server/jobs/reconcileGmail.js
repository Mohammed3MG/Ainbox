const { query } = require('../lib/db');
const mailboxCache = require('../lib/cache/mailboxCache');
const unifiedBroadcast = require('../lib/unifiedBroadcast');
const { google } = require('googleapis');
const { decrypt } = require('../utils/secure');

class GmailReconciler {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
    this.RECONCILE_INTERVAL_MS = parseInt(process.env.SYNC_RECONCILE_INTERVAL_MS) || 300000; // 5 minutes
    this.FEATURE_ENABLED = process.env.REALTIME_SYNC_V2 === 'true';
  }

  /**
   * Start the periodic reconciler
   */
  start() {
    if (!this.FEATURE_ENABLED) {
      console.log('📍 [Gmail Reconciler] Skipping - REALTIME_SYNC_V2 not enabled');
      return;
    }

    if (this.intervalId) {
      console.log('📍 [Gmail Reconciler] Already running');
      return;
    }

    console.log(`🔄 [Gmail Reconciler] Starting periodic reconciliation every ${this.RECONCILE_INTERVAL_MS}ms`);

    this.intervalId = setInterval(async () => {
      if (!this.isRunning) {
        await this.runReconciliation();
      }
    }, this.RECONCILE_INTERVAL_MS);

    // Run initial reconciliation after a short delay
    setTimeout(() => {
      if (!this.isRunning) {
        this.runReconciliation();
      }
    }, 30000); // 30 seconds after startup
  }

  /**
   * Stop the periodic reconciler
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('🛑 [Gmail Reconciler] Stopped periodic reconciliation');
    }
  }

  /**
   * Run reconciliation for all active mailboxes
   */
  async runReconciliation() {
    if (this.isRunning) return;

    this.isRunning = true;
    const startTime = Date.now();

    try {
      console.log('🔄 [Gmail Reconciler] Starting reconciliation cycle');

      // Get all active Gmail users
      const activeUsers = await this.getActiveGmailUsers();
      console.log(`📊 [Gmail Reconciler] Found ${activeUsers.length} active Gmail users`);

      let successCount = 0;
      let errorCount = 0;

      for (const user of activeUsers) {
        try {
          await this.reconcileUser(user);
          successCount++;
        } catch (error) {
          errorCount++;
          console.error(`❌ [Gmail Reconciler] Failed to reconcile user ${user.user_id}:`, error.message);
        }
      }

      const duration = Date.now() - startTime;
      console.log(`✅ [Gmail Reconciler] Reconciliation completed in ${duration}ms: ${successCount} success, ${errorCount} errors`);

    } catch (error) {
      console.error('❌ [Gmail Reconciler] Reconciliation cycle failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get all active Gmail users that need reconciliation
   */
  async getActiveGmailUsers() {
    const { rows } = await query(`
      SELECT DISTINCT
        u.id as user_id,
        a.email,
        a.refresh_token_encrypted,
        gms.last_history_id,
        gms.updated_at,
        COALESCE(gms.updated_at, u.created_at) as sort_timestamp
      FROM users u
      JOIN accounts a ON u.id = a.user_id
      LEFT JOIN gmail_mailbox_state gms ON u.id = gms.user_id
      WHERE a.provider = 'gmail'
        AND a.refresh_token_encrypted IS NOT NULL
        AND (gms.updated_at IS NULL OR gms.updated_at < NOW() - INTERVAL '1 hour')
      ORDER BY sort_timestamp ASC
      LIMIT 50
    `);

    return rows.map(row => ({
      ...row,
      refresh_token: decrypt(row.refresh_token_encrypted)
    }));
  }

  /**
   * Reconcile a single user's mailbox
   */
  async reconcileUser(user) {
    console.log(`🔍 [Gmail Reconciler] Reconciling user ${user.user_id} (${user.email})`);

    // Setup Gmail API client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_CALLBACK_URL
    );
    oauth2Client.setCredentials({ refresh_token: user.refresh_token });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get current profile to check history ID
    let currentHistoryId;
    try {
      const profile = await gmail.users.getProfile({ userId: 'me' });
      currentHistoryId = profile.data.historyId;
    } catch (error) {
      if (error.code === 401) {
        console.warn(`⚠️ [Gmail Reconciler] Auth expired for user ${user.user_id}`);
        return;
      }
      throw error;
    }

    const lastKnownHistoryId = user.last_history_id;

    // Check if we need to process history
    if (lastKnownHistoryId && lastKnownHistoryId !== currentHistoryId) {
      try {
        await this.processHistoryDelta(gmail, user, lastKnownHistoryId, currentHistoryId);
      } catch (historyError) {
        if (historyError.message.includes('historyId')) {
          console.log(`🔄 [Gmail Reconciler] History expired for user ${user.user_id}, performing full resync`);
          await this.performFullResync(gmail, user);
        } else {
          throw historyError;
        }
      }
    }

    // Always recompute and update counts from fresh Gmail data
    await this.updateCountsFromGmail(gmail, user);

    // Update last history ID in database
    await query(
      `INSERT INTO gmail_mailbox_state (user_id, last_history_id, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET last_history_id = $2, updated_at = NOW()`,
      [user.user_id, currentHistoryId]
    );

    console.log(`✅ [Gmail Reconciler] Reconciled user ${user.user_id}: historyId updated to ${currentHistoryId}`);
  }

  /**
   * Process history delta between last known and current history ID
   */
  async processHistoryDelta(gmail, user, startHistoryId, endHistoryId) {
    console.log(`📜 [Gmail Reconciler] Processing history delta for user ${user.user_id}: ${startHistoryId} -> ${endHistoryId}`);

    let pageToken = undefined;
    let processedChanges = 0;

    do {
      const response = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: startHistoryId,
        historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
        pageToken,
        maxResults: 100
      });

      const history = response.data.history || [];

      for (const historyRecord of history) {
        processedChanges += await this.processHistoryRecord(user, historyRecord);
      }

      pageToken = response.data.nextPageToken;
    } while (pageToken);

    console.log(`📜 [Gmail Reconciler] Processed ${processedChanges} changes for user ${user.user_id}`);
  }

  /**
   * Process a single history record
   */
  async processHistoryRecord(user, historyRecord) {
    let changeCount = 0;

    // Process message additions
    if (historyRecord.messagesAdded) {
      for (const addedMsg of historyRecord.messagesAdded) {
        const messageId = addedMsg.message?.id;
        if (messageId) {
          // Check for idempotency
          const isDuplicate = await mailboxCache.isDuplicate(
            user.user_id,
            historyRecord.id,
            messageId,
            'message_added'
          );

          if (!isDuplicate) {
            // Store in database
            await this.storeMessage(user, addedMsg.message);
            changeCount++;
          }
        }
      }
    }

    // Process message deletions
    if (historyRecord.messagesDeleted) {
      for (const deletedMsg of historyRecord.messagesDeleted) {
        const messageId = deletedMsg.message?.id;
        if (messageId) {
          const isDuplicate = await mailboxCache.isDuplicate(
            user.user_id,
            historyRecord.id,
            messageId,
            'message_deleted'
          );

          if (!isDuplicate) {
            await query(
              'DELETE FROM messages WHERE user_id = $1 AND message_id = $2',
              [user.user_id, messageId]
            );
            changeCount++;
          }
        }
      }
    }

    // Process label changes
    if (historyRecord.labelsAdded || historyRecord.labelsRemoved) {
      changeCount += await this.processLabelChanges(user, historyRecord);
    }

    return changeCount;
  }

  /**
   * Process label changes (read/unread status)
   */
  async processLabelChanges(user, historyRecord) {
    let changeCount = 0;

    // Process labels added
    if (historyRecord.labelsAdded) {
      for (const labelChange of historyRecord.labelsAdded) {
        const messageId = labelChange.message?.id;
        if (messageId && labelChange.labelIds?.includes('UNREAD')) {
          await query(
            'UPDATE messages SET is_read = FALSE WHERE user_id = $1 AND message_id = $2',
            [user.user_id, messageId]
          );
          changeCount++;
        }
      }
    }

    // Process labels removed
    if (historyRecord.labelsRemoved) {
      for (const labelChange of historyRecord.labelsRemoved) {
        const messageId = labelChange.message?.id;
        if (messageId && labelChange.labelIds?.includes('UNREAD')) {
          await query(
            'UPDATE messages SET is_read = TRUE WHERE user_id = $1 AND message_id = $2',
            [user.user_id, messageId]
          );
          changeCount++;
        }
      }
    }

    return changeCount;
  }

  /**
   * Store a message in the database
   */
  async storeMessage(user, message) {
    const isRead = !message.labelIds?.includes('UNREAD');

    await query(
      `INSERT INTO messages (user_id, provider, message_id, thread_id, is_read, internal_date, label_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, provider, message_id)
       DO UPDATE SET is_read = $5, internal_date = $6, label_ids = $7`,
      [
        user.user_id,
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
   * Perform full resync when history is expired
   */
  async performFullResync(gmail, user) {
    console.log(`🔄 [Gmail Reconciler] Performing full resync for user ${user.user_id}`);

    // Get recent messages from Gmail (last 1000)
    const response = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      maxResults: 1000
    });

    const messageIds = response.data.messages?.map(m => m.id) || [];

    // Process messages in batches
    const batchSize = 100;
    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      await this.processBatchMessages(gmail, user, batch);
    }

    console.log(`✅ [Gmail Reconciler] Full resync completed for user ${user.user_id}: processed ${messageIds.length} messages`);
  }

  /**
   * Process a batch of messages
   */
  async processBatchMessages(gmail, user, messageIds) {
    const batchRequest = gmail.users.messages.list({
      userId: 'me',
      ids: messageIds,
      format: 'minimal'
    });

    // This is a simplified version - in production you'd want to use batch requests
    for (const messageId of messageIds) {
      try {
        const message = await gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'minimal'
        });

        await this.storeMessage(user, message.data);
      } catch (error) {
        console.warn(`⚠️ [Gmail Reconciler] Failed to process message ${messageId}:`, error.message);
      }
    }
  }

  /**
   * Update counts from fresh Gmail data and broadcast if changed
   */
  async updateCountsFromGmail(gmail, user) {
    try {
      // Get fresh counts from Gmail
      const [unreadResponse, totalResponse] = await Promise.all([
        gmail.users.messages.list({
          userId: 'me',
          q: 'in:inbox is:unread',
          maxResults: 1
        }),
        gmail.users.messages.list({
          userId: 'me',
          q: 'in:inbox',
          maxResults: 1
        })
      ]);

      const freshCounts = {
        unread: unreadResponse.data.resultSizeEstimate || 0,
        total: totalResponse.data.resultSizeEstimate || 0
      };

      // Recompute counts from database
      const { rows } = await query(`
        SELECT
          COUNT(*) FILTER (WHERE is_read = false) as unread_count,
          COUNT(*) as total_count
        FROM messages
        WHERE user_id = $1 AND provider = 'gmail'
      `, [user.user_id]);

      const dbCounts = {
        unread: parseInt(rows[0]?.unread_count || 0),
        total: parseInt(rows[0]?.total_count || 0)
      };

      // Use the higher of Gmail or DB counts (Gmail is authoritative but may be stale)
      const finalCounts = {
        unread: Math.max(freshCounts.unread, dbCounts.unread),
        total: Math.max(freshCounts.total, dbCounts.total)
      };

      // Get current Redis counts to check for changes
      const currentCounts = await mailboxCache.getCounts(user.user_id);

      // Update Redis cache
      await mailboxCache.setCounts(user.user_id, finalCounts);

      // Broadcast if counts changed
      if (currentCounts.unread !== finalCounts.unread || currentCounts.total !== finalCounts.total) {
        console.log(`📡 [Gmail Reconciler] Broadcasting updated counts for user ${user.user_id}: ${finalCounts.unread} unread, ${finalCounts.total} total`);

        unifiedBroadcast.countUpdated(user.user_id, {
          unread: finalCounts.unread,
          total: finalCounts.total,
          timestamp: new Date().toISOString(),
          source: 'reconciler'
        }, 'reconcile');
      }

      console.log(`📊 [Gmail Reconciler] Updated counts for user ${user.user_id}: Gmail(${freshCounts.unread}/${freshCounts.total}) DB(${dbCounts.unread}/${dbCounts.total}) Final(${finalCounts.unread}/${finalCounts.total})`);

    } catch (error) {
      console.error(`❌ [Gmail Reconciler] Failed to update counts for user ${user.user_id}:`, error.message);
    }
  }

  /**
   * Manual reconciliation trigger (for testing/admin)
   */
  async reconcileUserById(userId) {
    if (!this.FEATURE_ENABLED) {
      throw new Error('REALTIME_SYNC_V2 not enabled');
    }

    const { rows } = await query(`
      SELECT
        u.id as user_id,
        a.email,
        a.refresh_token_encrypted,
        gms.last_history_id
      FROM users u
      JOIN accounts a ON u.id = a.user_id
      LEFT JOIN gmail_mailbox_state gms ON u.id = gms.user_id
      WHERE u.id = $1 AND a.provider = 'gmail'
    `, [userId]);

    if (rows.length === 0) {
      throw new Error(`No Gmail account found for user ${userId}`);
    }

    const user = {
      ...rows[0],
      refresh_token: decrypt(rows[0].refresh_token_encrypted)
    };

    await this.reconcileUser(user);
    return { success: true, userId: userId };
  }

  /**
   * Health check
   */
  getStatus() {
    return {
      enabled: this.FEATURE_ENABLED,
      running: this.isRunning,
      intervalMs: this.RECONCILE_INTERVAL_MS,
      hasInterval: !!this.intervalId
    };
  }
}

// Export singleton instance
module.exports = new GmailReconciler();