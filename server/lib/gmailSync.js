// Real-time Gmail synchronization with push notifications and polling fallback
const { google } = require('googleapis');
const { getGoogleOAuthClientFromCookies } = require('../utils/googleClient');
const emailCache = require('./emailCache');
const { broadcastToUser } = require('./sse');

class GmailSyncService {
  constructor() {
    this.activeSyncs = new Map(); // userId -> sync info
    this.pollingIntervals = new Map(); // userId -> interval ID
    this.watchRequests = new Map(); // userId -> watch request info
    this.historyIds = new Map(); // userId -> lastHistoryId for incremental sync
    this.recentUpdates = new Map(); // userId -> Map(emailId -> { isRead, timestamp })
  }

  // Start real-time sync for a user
  async startSyncForUser(userId, cookies) {
    if (this.activeSyncs.has(userId)) {
      console.log(`🔄 Gmail sync already active for user ${userId}`);
      return;
    }

    console.log(`🚀 Starting Gmail sync for user ${userId}`);

    try {
      // Set up push notifications if possible
      await this.setupPushNotifications(userId, cookies);

      // Always set up polling as fallback
      this.setupPeriodicPolling(userId, cookies);

      this.activeSyncs.set(userId, {
        startTime: Date.now(),
        lastSync: Date.now(),
        pushEnabled: false, // Will be true if push notifications work
        pollingEnabled: true
      });

      console.log(`✅ Gmail sync started for user ${userId}`);

      // Real-time sync is now active for new emails and deletions

    } catch (error) {
      console.error(`❌ Failed to start Gmail sync for user ${userId}:`, error.message);
      // Still try polling even if push notifications fail
      this.setupPeriodicPolling(userId, cookies);
    }
  }

  // Set up Gmail Push Notifications (requires Google Cloud Pub/Sub)
  async setupPushNotifications(userId, cookies) {
    try {
      const oauth2Client = await getGoogleOAuthClientFromCookies({ cookies });
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // For now, we'll skip push notifications setup as it requires:
      // 1. Google Cloud Project with Pub/Sub enabled
      // 2. Service Account credentials
      // 3. Topic and subscription setup
      // 4. Domain verification

      console.log(`📝 Push notifications require Google Cloud setup - using polling for now`);
      return false;
    } catch (error) {
      console.error(`❌ Push notification setup failed:`, error.message);
      return false;
    }
  }

  // Set up periodic polling to check for Gmail changes
  setupPeriodicPolling(userId, cookies) {
    // Clear existing interval if any
    if (this.pollingIntervals.has(userId)) {
      clearInterval(this.pollingIntervals.get(userId));
    }

    // Poll every 5 seconds for updates (tunable)
    const interval = setInterval(async () => {
      await this.pollGmailChanges(userId, cookies);
    }, 5000);

    this.pollingIntervals.set(userId, interval);
    console.log(`⏰ Set up Gmail polling for user ${userId} (every 2s)`);
  }

  // Poll Gmail for changes and update cache/frontend
  async pollGmailChanges(userId, cookies) {
    try {
      const oauth2Client = await getGoogleOAuthClientFromCookies({ cookies });
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // Get current inbox stats
      const newStats = await this.getGmailStats(gmail);
      const cacheKey = `inbox:stats:gmail:${userId}`;
      const cachedStats = await require('./smartCache').get(cacheKey);

      // Detect individual email changes using history
      await this.checkEmailHistoryChanges(userId, gmail);

      // Enable external change detection for immediate updates
      if (this.hasStatsChanged(cachedStats, newStats)) {
        console.log(`📊 Gmail stats changed for user ${userId}`, {
          old: cachedStats ? { unread: cachedStats.unread, total: cachedStats.total } : null,
          new: { unread: newStats.unread, total: newStats.total }
        });

        // Update cache and broadcast via SSE
        await require('./smartCache').set(cacheKey, newStats, 45_000);
        broadcastToUser(userId, {
          type: 'unread_count_updated',
          unread: newStats.unread,
          total: newStats.total,
          source: 'external_change'
        });

        console.log(`📡 Broadcasted Gmail count update to user ${userId} (external change detected)`);
      }

      // Update last sync time
      if (this.activeSyncs.has(userId)) {
        const syncInfo = this.activeSyncs.get(userId);
        syncInfo.lastSync = Date.now();
        this.activeSyncs.set(userId, syncInfo);
      }

    } catch (error) {
      console.error(`❌ Gmail polling failed for user ${userId}:`, error.message);

      // If auth fails, stop sync for this user
      if (error.message.includes('unauthorized') || error.message.includes('invalid_grant')) {
        this.stopSyncForUser(userId);
      }
    }
  }

  // Get Gmail inbox statistics
  async getGmailStats(gmail) {
    try {
      // Get actual thread count by fetching threads for more accurate counting
      async function getActualCount(q, maxToCheck = 1000) {
        try {
          const resp = await gmail.users.threads.list({
            userId: 'me',
            maxResults: maxToCheck,
            labelIds: ['INBOX'],
            q,
            fields: 'threads(id),nextPageToken,resultSizeEstimate'
          });

          // If we got fewer threads than requested, we have the exact count
          const threadCount = (resp.data?.threads || []).length;
          if (threadCount < maxToCheck && !resp.data?.nextPageToken) {
            return threadCount;
          }

          // If there are more threads, fall back to estimate
          const estimate = Number.isFinite(resp.data?.resultSizeEstimate) ? resp.data.resultSizeEstimate : threadCount;
          return estimate;
        } catch (error) {
          console.error('Failed to get thread count:', error.message);
          return 0;
        }
      }

      const total = await getActualCount('category:primary');
      const unread = await getActualCount('category:primary is:unread');
      return { unread, total, timestamp: Date.now() };
    } catch (error) {
      console.error('Failed to get Gmail stats:', error.message);
      return { unread: 0, total: 0, timestamp: Date.now() };
    }
  }

  // Check if Gmail stats have changed
  hasStatsChanged(oldStats, newStats) {
    if (!oldStats) return true;

    return (
      oldStats.unread !== newStats.unread ||
      oldStats.total !== newStats.total
    );
  }

  // Check for individual email changes using Gmail history API
  async checkEmailHistoryChanges(userId, gmail) {
    try {
      const lastHistoryId = this.historyIds.get(userId);

      if (!lastHistoryId) {
        // First time - get current historyId and store it
        const profile = await gmail.users.getProfile({ userId: 'me' });
        this.historyIds.set(userId, profile.data.historyId);
        console.log(`📝 Stored initial historyId for user ${userId}: ${profile.data.historyId}`);
        return;
      }

      // Get history changes since last check
      const historyResponse = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: lastHistoryId,
        labelId: 'INBOX',
        historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']
      });

      const history = historyResponse.data.history || [];
      if (history.length === 0) return;

      console.log(`📧 Found ${history.length} history changes for user ${userId}`);

      // Process each history record
      for (const record of history) {
        await this.processHistoryRecord(userId, gmail, record);
      }

      // Update stored historyId
      if (historyResponse.data.historyId) {
        this.historyIds.set(userId, historyResponse.data.historyId);
      }

    } catch (error) {
      console.error(`❌ Failed to check email history for user ${userId}:`, error.message);
    }
  }

  // Process individual history record for email changes
  async processHistoryRecord(userId, gmail, record) {
    try {
      // Handle messages added (new emails)
      if (record.messagesAdded) {
        for (const addedMsg of record.messagesAdded) {
          if (addedMsg.message && this.isInboxPrimary(addedMsg.message.labelIds)) {
            console.log(`📨 New email detected: ${addedMsg.message.id}`);
            await this.broadcastNewEmail(userId, gmail, addedMsg.message.id);
          }
        }
      }

      // Handle messages deleted (deleted emails)
      if (record.messagesDeleted) {
        for (const deletedMsg of record.messagesDeleted) {
          if (deletedMsg.message) {
            console.log(`🗑️ Email deletion detected: ${deletedMsg.message.id}`);
            await this.broadcastEmailDeleted(userId, gmail, deletedMsg.message.id);
          }
        }
      }

      // Handle label changes (read/unread status)
      if (record.labelsAdded || record.labelsRemoved) {
        const changes = [...(record.labelsAdded || []), ...(record.labelsRemoved || [])];
        for (const change of changes) {
          if (change.message && this.isReadUnreadChange(change.labelIds)) {
            console.log(`🏷️ Read/unread change detected: ${change.message.id}`);
            await this.broadcastEmailStateChange(userId, gmail, change.message.id);
          }
        }
      }

    } catch (error) {
      console.error(`❌ Failed to process history record:`, error.message);
    }
  }

  // Check if message is in inbox/primary
  isInboxPrimary(labelIds = []) {
    return labelIds.includes('INBOX') && labelIds.includes('CATEGORY_PERSONAL');
  }

  // Check if this is a read/unread status change
  isReadUnreadChange(labelIds = []) {
    return labelIds.includes('UNREAD');
  }

  // Broadcast new email arrival
  async broadcastNewEmail(userId, gmail, messageId) {
    try {
      // Get the full message details with payload for attachment checking
      const message = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
      });

      const email = this.formatEmailFromGmail(message.data);
      broadcastToUser(userId, { type: 'new_email', email });

      console.log(`📡 Broadcasted new email arrival for ${messageId}: "${email.subject}"`);
    } catch (error) {
      console.error(`❌ Failed to broadcast new email:`, error.message);
    }
  }

  // Broadcast email deletion
  async broadcastEmailDeleted(userId, gmail, messageId) {
    try {
      let threadId = null;
      try {
        const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'minimal' });
        threadId = msg?.data?.threadId || null;
      } catch (_) {}

      broadcastToUser(userId, {
        type: 'email_deleted',
        emailId: threadId || messageId,
        source: 'external_deletion',
        timestamp: Date.now()
      });
    } catch (error) {
      console.error(`❌ Failed to broadcast email deletion:`, error.message);
    }
  }

  // Broadcast email state change (read/unread)
  async broadcastEmailStateChange(userId, gmail, messageId) {
    try {
      // Get current message state
      const message = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'minimal'
      });

      const isRead = !message.data.labelIds?.includes('UNREAD');

      // Check for recent duplicate update
      if (!this.recentUpdates.has(userId)) {
        this.recentUpdates.set(userId, new Map());
      }
      const userUpdates = this.recentUpdates.get(userId);
      const recent = userUpdates.get(messageId);

      if (recent && recent.isRead === isRead && (Date.now() - recent.timestamp) < 3000) {
        console.log(`🚫 Skipping duplicate email update for ${messageId}: isRead=${isRead}`);
        return;
      }

      // Store this update to prevent duplicates
      userUpdates.set(messageId, { isRead, timestamp: Date.now() });

      // Clean old updates (older than 10 seconds)
      for (const [id, update] of userUpdates.entries()) {
        if (Date.now() - update.timestamp > 10000) {
          userUpdates.delete(id);
        }
      }

      broadcastToUser(userId, {
        type: 'email_updated',
        email: { id: message.data.threadId, threadId: message.data.threadId, isRead },
        source: 'external_change'
      });

      console.log(`📡 Broadcasted email state change for ${messageId}: isRead=${isRead}`);
    } catch (error) {
      console.error(`❌ Failed to broadcast email state change:`, error.message);
    }
  }

  // Format Gmail message for frontend
  formatEmailFromGmail(message) {
    const headers = message.payload?.headers || [];
    const getHeader = (name) => headers.find(h => h.name === name)?.value || '';

    // Extract date and format time
    const rawDate = getHeader('Date');
    const dateObj = rawDate ? new Date(rawDate) : new Date();
    const now = new Date();
    const isToday = dateObj.toDateString() === now.toDateString();
    const time = isToday ?
      dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) :
      dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    // Get basic labels from Gmail label IDs
    const labels = [];
    if (message.labelIds?.includes('CATEGORY_PROMOTIONS')) labels.push('marketing');
    if (message.labelIds?.includes('CATEGORY_UPDATES')) labels.push('updates');
    if (message.labelIds?.includes('CATEGORY_PERSONAL')) labels.push('personal');

    // Check for attachments
    const hasAttachment = this.checkForAttachments(message.payload);

    return {
      id: message.threadId,
      threadId: message.threadId,
      messageId: message.id,
      subject: getHeader('Subject') || '(no subject)',
      from: getHeader('From'),
      to: getHeader('To'),
      date: rawDate,
      time: time,
      isRead: !message.labelIds?.includes('UNREAD'),
      isStarred: message.labelIds?.includes('STARRED') || false,
      snippet: message.snippet || '',
      preview: message.snippet || '',
      labels: labels,
      hasAttachment: hasAttachment
    };
  }

  // Helper function to check for attachments
  checkForAttachments(payload) {
    if (!payload) return false;

    // Check if this part has an attachment
    if (payload.filename && payload.filename.length > 0) {
      return true;
    }

    // Check parts recursively
    if (payload.parts) {
      return payload.parts.some(part => this.checkForAttachments(part));
    }

    return false;
  }

  // Stop sync for a user
  stopSyncForUser(userId) {
    console.log(`🛑 Stopping Gmail sync for user ${userId}`);

    // Clear polling interval
    if (this.pollingIntervals.has(userId)) {
      clearInterval(this.pollingIntervals.get(userId));
      this.pollingIntervals.delete(userId);
    }

    // Remove from active syncs
    this.activeSyncs.delete(userId);

    // Clear stored historyId
    this.historyIds.delete(userId);

    console.log(`✅ Gmail sync stopped for user ${userId}`);
  }

  // Get sync status for a user
  getSyncStatus(userId) {
    const syncInfo = this.activeSyncs.get(userId);
    if (!syncInfo) {
      return { active: false };
    }

    return {
      active: true,
      startTime: syncInfo.startTime,
      lastSync: syncInfo.lastSync,
      pushEnabled: syncInfo.pushEnabled,
      pollingEnabled: syncInfo.pollingEnabled,
      uptime: Date.now() - syncInfo.startTime
    };
  }

  // Get all active syncs (for monitoring)
  getAllSyncStatuses() {
    const statuses = {};
    for (const [userId, syncInfo] of this.activeSyncs) {
      statuses[userId] = this.getSyncStatus(userId);
    }
    return statuses;
  }

  // Force sync for a user (manual trigger)
  async forceSyncForUser(userId, cookies) {
    console.log(`🔄 Force syncing Gmail for user ${userId}`);
    await this.pollGmailChanges(userId, cookies);
  }

  // Cleanup on shutdown
  shutdown() {
    console.log(`🛑 Shutting down Gmail sync service`);

    // Stop all polling intervals
    for (const interval of this.pollingIntervals.values()) {
      clearInterval(interval);
    }

    this.pollingIntervals.clear();
    this.activeSyncs.clear();
    this.watchRequests.clear();
    this.historyIds.clear();
    this.recentUpdates.clear();
  }
}

// Export singleton instance
module.exports = new GmailSyncService();
