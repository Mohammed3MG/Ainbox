const gmailPubSub = require('./pubsub/gmailPubSub');
const socketIOService = require('./socketio');

class GmailSyncService {
  constructor() {
    this.activeUsers = new Map();
    this.syncIntervals = new Map();
    this.watchRenewalInterval = null;

    // Start watch renewal scheduler
    this.startWatchRenewalScheduler();
  }

  /**
   * Start Gmail sync with Pub/Sub notifications for a user
   */
  async startSync(userId, accessToken, refreshToken, userEmail) {
    try {
      console.log(`🚀 Starting enhanced Gmail sync for user ${userId}`);

      // Stop any existing sync for this user
      await this.stopSync(userId);

      // Set up Gmail Push notifications
      const watchData = await gmailPubSub.setupGmailWatch(userId, accessToken, refreshToken);

      // Store user sync data
      this.activeUsers.set(userId, {
        accessToken,
        refreshToken,
        userEmail,
        watchData,
        startedAt: new Date(),
        lastSync: new Date(),
      });

      // Get initial inbox counts
      const initialCounts = await gmailPubSub.getInboxCounts(userId);

      // Send initial counts to frontend
      this.sendRealTimeUpdate(userId, {
        type: 'sync_started',
        unread: initialCounts.unread,
        total: initialCounts.total,
        timestamp: new Date().toISOString(),
      });

      // Set up periodic fallback sync (every 5 minutes as backup)
      const fallbackInterval = setInterval(async () => {
        try {
          await this.performFallbackSync(userId);
        } catch (error) {
          console.error(`❌ Fallback sync failed for user ${userId}:`, error);
        }
      }, 5 * 60 * 1000); // 5 minutes

      this.syncIntervals.set(userId, fallbackInterval);

      console.log(`✅ Enhanced Gmail sync started for user ${userId}`);
      return {
        success: true,
        watchData,
        initialCounts,
        message: 'Gmail Pub/Sub sync started successfully'
      };

    } catch (error) {
      console.error(`❌ Failed to start Gmail sync for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Stop Gmail sync for a user
   */
  async stopSync(userId) {
    try {
      console.log(`🛑 Stopping Gmail sync for user ${userId}`);

      const userData = this.activeUsers.get(userId);
      if (userData) {
        // Stop Gmail Push notifications
        await gmailPubSub.stopGmailWatch(userId, userData.accessToken, userData.refreshToken);
      }

      // Clear intervals
      const interval = this.syncIntervals.get(userId);
      if (interval) {
        clearInterval(interval);
        this.syncIntervals.delete(userId);
      }

      // Remove user data
      this.activeUsers.delete(userId);

      // Send stop notification to frontend
      this.sendRealTimeUpdate(userId, {
        type: 'sync_stopped',
        timestamp: new Date().toISOString(),
      });

      console.log(`✅ Gmail sync stopped for user ${userId}`);
      return { success: true, message: 'Gmail sync stopped successfully' };

    } catch (error) {
      console.error(`❌ Failed to stop Gmail sync for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get sync status for a user
   */
  getSyncStatus(userId) {
    const userData = this.activeUsers.get(userId);
    const watchInfo = gmailPubSub.getWatchInfo(userId);

    if (!userData) {
      return {
        active: false,
        message: 'No active sync found'
      };
    }

    return {
      active: true,
      startedAt: userData.startedAt,
      lastSync: userData.lastSync,
      userEmail: userData.userEmail,
      watchInfo: watchInfo ? {
        historyId: watchInfo.historyId,
        expiration: new Date(parseInt(watchInfo.expiration)),
        watchedAt: watchInfo.watchedAt,
      } : null,
      pubsubEnabled: true,
    };
  }

  /**
   * Force sync for a user (manual trigger)
   */
  async forceSync(userId) {
    try {
      console.log(`🔄 Force sync requested for user ${userId}`);

      const userData = this.activeUsers.get(userId);
      if (!userData) {
        throw new Error('No active sync found for user');
      }

      // Get current inbox counts
      const counts = await gmailPubSub.getInboxCounts(userId);

      // Update last sync time
      userData.lastSync = new Date();

      // Send update to frontend
      this.sendRealTimeUpdate(userId, {
        type: 'force_sync_completed',
        unread: counts.unread,
        total: counts.total,
        timestamp: new Date().toISOString(),
      });

      console.log(`✅ Force sync completed for user ${userId}:`, counts);
      return {
        success: true,
        counts,
        message: 'Force sync completed successfully'
      };

    } catch (error) {
      console.error(`❌ Force sync failed for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Perform fallback sync (backup to Pub/Sub)
   */
  async performFallbackSync(userId) {
    try {
      const userData = this.activeUsers.get(userId);
      if (!userData) return;

      console.log(`🔄 Performing fallback sync for user ${userId}`);

      // Get current inbox counts
      const counts = await gmailPubSub.getInboxCounts(userId);

      // Send update to frontend
      this.sendRealTimeUpdate(userId, {
        type: 'fallback_sync_update',
        unread: counts.unread,
        total: counts.total,
        source: 'fallback_sync',
        timestamp: new Date().toISOString(),
      });

      // Update last sync time
      userData.lastSync = new Date();

      console.log(`✅ Fallback sync completed for user ${userId}:`, counts);

    } catch (error) {
      console.error(`❌ Fallback sync failed for user ${userId}:`, error);
    }
  }

  /**
   * Send real-time update to frontend
   */
  sendRealTimeUpdate(userId, data) {
    try {
      // Send via Socket.IO
      if (socketIOService && socketIOService.io) {
        socketIOService.io.to(userId).emit('gmailSyncUpdate', data);
      }

      // Send via SSE (if you have SSE manager)
      if (global.sseManager) {
        global.sseManager.sendToUser(userId, data);
      }

      console.log(`📡 Real-time update sent to user ${userId}:`, data.type);

    } catch (error) {
      console.error(`❌ Failed to send real-time update:`, error);
    }
  }

  /**
   * Start watch renewal scheduler
   * Gmail watches expire after 7 days, so we need to renew them
   */
  startWatchRenewalScheduler() {
    if (this.watchRenewalInterval) {
      clearInterval(this.watchRenewalInterval);
    }

    // Check every hour for watches that need renewal
    this.watchRenewalInterval = setInterval(async () => {
      try {
        await this.renewExpiredWatches();
      } catch (error) {
        console.error('❌ Watch renewal scheduler error:', error);
      }
    }, 60 * 60 * 1000); // 1 hour

    console.log('🔄 Gmail watch renewal scheduler started');
  }

  /**
   * Renew expired or soon-to-expire watches
   */
  async renewExpiredWatches() {
    try {
      const now = Date.now();
      const renewalThreshold = 24 * 60 * 60 * 1000; // 24 hours before expiration

      for (const [userId, userData] of this.activeUsers) {
        const watchInfo = gmailPubSub.getWatchInfo(userId);

        if (watchInfo && watchInfo.expiration) {
          const expirationTime = parseInt(watchInfo.expiration);
          const timeUntilExpiration = expirationTime - now;

          if (timeUntilExpiration <= renewalThreshold) {
            console.log(`🔄 Renewing Gmail watch for user ${userId} (expires in ${Math.round(timeUntilExpiration / (60 * 60 * 1000))} hours)`);

            try {
              await gmailPubSub.renewWatch(userId);
              console.log(`✅ Watch renewed successfully for user ${userId}`);

              // Send notification to frontend
              this.sendRealTimeUpdate(userId, {
                type: 'watch_renewed',
                timestamp: new Date().toISOString(),
              });

            } catch (error) {
              console.error(`❌ Failed to renew watch for user ${userId}:`, error);

              // Send error notification to frontend
              this.sendRealTimeUpdate(userId, {
                type: 'watch_renewal_failed',
                error: error.message,
                timestamp: new Date().toISOString(),
              });
            }
          }
        }
      }

    } catch (error) {
      console.error('❌ Error in renewExpiredWatches:', error);
    }
  }

  /**
   * Get all active users
   */
  getActiveUsers() {
    return Array.from(this.activeUsers.keys());
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      activeUsers: this.activeUsers.size,
      watchedMailboxes: gmailPubSub.getWatchedUsers().length,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Cleanup on shutdown
   */
  async cleanup() {
    try {
      console.log('🧹 Cleaning up Gmail sync service...');

      // Clear renewal scheduler
      if (this.watchRenewalInterval) {
        clearInterval(this.watchRenewalInterval);
      }

      // Stop all user syncs
      const stopPromises = Array.from(this.activeUsers.keys()).map(userId =>
        this.stopSync(userId).catch(error =>
          console.error(`❌ Failed to stop sync for user ${userId}:`, error)
        )
      );

      await Promise.all(stopPromises);

      console.log('✅ Gmail sync service cleanup completed');

    } catch (error) {
      console.error('❌ Error during cleanup:', error);
    }
  }
}

module.exports = new GmailSyncService();