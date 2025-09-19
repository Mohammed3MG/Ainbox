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

    // Poll every 10 seconds for faster updates
    const interval = setInterval(async () => {
      await this.pollGmailChanges(userId, cookies);
    }, 10000);

    this.pollingIntervals.set(userId, interval);
    console.log(`⏰ Set up Gmail polling for user ${userId} (every 10s)`);
  }

  // Poll Gmail for changes and update cache/frontend
  async pollGmailChanges(userId, cookies) {
    try {
      const oauth2Client = await getGoogleOAuthClientFromCookies({ cookies });
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // Get current inbox stats
      const newStats = await this.getGmailStats(gmail);
      const cachedStats = await emailCache.getUserStats(userId, 'gmail');

      // Compare with cached stats
      if (this.hasStatsChanged(cachedStats, newStats)) {
        console.log(`📊 Gmail stats changed for user ${userId}`, {
          old: cachedStats ? { unread: cachedStats.unread, total: cachedStats.total } : null,
          new: { unread: newStats.unread, total: newStats.total }
        });

        // Update cache
        await emailCache.setUserStats(userId, 'gmail', newStats);

        // Invalidate related caches
        await emailCache.invalidateUserInbox(userId, 'gmail');

        // Broadcast real-time update to frontend
        broadcastToUser(userId, {
          type: 'unread_count_updated',
          unread: newStats.unread,
          total: newStats.total,
          timestamp: Date.now(),
          source: 'external_change'
        });

        console.log(`📡 Broadcasted Gmail update to user ${userId}`);
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
  }
}

// Export singleton instance
module.exports = new GmailSyncService();
