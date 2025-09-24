const redisClient = require('./redisClient');

class MailboxCache {
  constructor() {
    this.SYNC_STALE_WINDOW_MS = parseInt(process.env.SYNC_STALE_WINDOW_MS) || 10000;
  }

  // Redis key helpers
  getUnreadCountKey(userId) {
    return `mailbox:${userId}:unread_count`;
  }

  getTotalCountKey(userId) {
    return `mailbox:${userId}:total_count`;
  }

  getLastHistoryIdKey(userId) {
    return `mailbox:${userId}:last_history_id`;
  }

  getDedupeKey(userId, historyId, messageId, change) {
    return `mailbox:${userId}:dedupe:${historyId}:${messageId}:${change}`;
  }

  getRecentLocalChangeKey(userId) {
    return `mailbox:${userId}:recent_local_change_until`;
  }

  // Get current counts from Redis
  async getCounts(userId) {
    try {
      const [unread, total] = await Promise.all([
        redisClient.get(this.getUnreadCountKey(userId)),
        redisClient.get(this.getTotalCountKey(userId))
      ]);

      return {
        unread: parseInt(unread) || 0,
        total: parseInt(total) || 0,
        timestamp: new Date().toISOString(),
        source: 'redis_cache'
      };
    } catch (error) {
      console.error('❌ [MailboxCache] Error getting counts:', error);
      return { unread: 0, total: 0, timestamp: new Date().toISOString(), source: 'error_fallback' };
    }
  }

  // Set counts in Redis
  async setCounts(userId, { unread, total }) {
    try {
      await Promise.all([
        redisClient.set(this.getUnreadCountKey(userId), unread.toString()),
        redisClient.set(this.getTotalCountKey(userId), total.toString())
      ]);

      console.log(`📊 [MailboxCache] Set counts for user ${userId}: unread=${unread}, total=${total}`);
      return true;
    } catch (error) {
      console.error('❌ [MailboxCache] Error setting counts:', error);
      return false;
    }
  }

  // Apply unread count delta atomically using Lua script
  async applyUnreadDelta(userId, delta) {
    try {
      if (delta === 0) return await this.getCounts(userId);

      const unreadCountKey = this.getUnreadCountKey(userId);
      const newUnreadCount = await redisClient.evalsha('atomicCountDelta', [unreadCountKey], [delta.toString()]);

      // Get total count for complete result
      const totalCount = parseInt(await redisClient.get(this.getTotalCountKey(userId))) || 0;

      const result = {
        unread: parseInt(newUnreadCount),
        total: totalCount,
        timestamp: new Date().toISOString(),
        source: 'atomic_delta'
      };

      console.log(`📈 [MailboxCache] Applied unread delta ${delta} for user ${userId}: ${result.unread} unread`);
      return result;
    } catch (error) {
      console.error('❌ [MailboxCache] Error applying unread delta:', error);
      // Fallback to getting current counts
      return await this.getCounts(userId);
    }
  }

  // Mark recent local change using Lua script
  async markRecentLocalChange(userId, windowMs = null) {
    try {
      windowMs = windowMs || this.SYNC_STALE_WINDOW_MS;
      const untilTimestamp = Date.now() + windowMs;

      const recentChangeKey = this.getRecentLocalChangeKey(userId);
      const actualTimestamp = await redisClient.evalsha('setIfNewerTs', [recentChangeKey], [untilTimestamp.toString()]);

      console.log(`🕒 [MailboxCache] Marked recent local change for user ${userId} until ${new Date(parseInt(actualTimestamp)).toISOString()}`);
      return parseInt(actualTimestamp);
    } catch (error) {
      console.error('❌ [MailboxCache] Error marking recent local change:', error);
      return Date.now() + windowMs;
    }
  }

  // Check if we're within recent local change window
  async isWithinRecentLocalChange(userId) {
    try {
      const recentChangeKey = this.getRecentLocalChangeKey(userId);
      const untilTimestamp = await redisClient.get(recentChangeKey);

      if (!untilTimestamp) return false;

      const isWithin = Date.now() < parseInt(untilTimestamp);
      console.log(`🕒 [MailboxCache] Recent local change check for user ${userId}: ${isWithin}`);
      return isWithin;
    } catch (error) {
      console.error('❌ [MailboxCache] Error checking recent local change:', error);
      return false;
    }
  }

  // Get/set last history ID
  async getLastHistoryId(userId) {
    try {
      const historyId = await redisClient.get(this.getLastHistoryIdKey(userId));
      return historyId || null;
    } catch (error) {
      console.error('❌ [MailboxCache] Error getting last history ID:', error);
      return null;
    }
  }

  async setLastHistoryId(userId, historyId) {
    try {
      await redisClient.set(this.getLastHistoryIdKey(userId), historyId);
      console.log(`📝 [MailboxCache] Set last history ID for user ${userId}: ${historyId}`);
      return true;
    } catch (error) {
      console.error('❌ [MailboxCache] Error setting last history ID:', error);
      return false;
    }
  }

  // Deduplication helpers
  async isDuplicate(userId, historyId, messageId, change, ttlSeconds = 300) {
    try {
      const dedupeKey = this.getDedupeKey(userId, historyId, messageId, change);
      const exists = await redisClient.exists(dedupeKey);

      if (exists) {
        console.log(`🔍 [MailboxCache] Duplicate detected: ${dedupeKey}`);
        return true;
      }

      // Mark as processed with TTL
      await redisClient.set(dedupeKey, '1', { ttl: ttlSeconds });
      return false;
    } catch (error) {
      console.error('❌ [MailboxCache] Error checking duplicate:', error);
      return false; // On error, allow processing
    }
  }

  // Batch operations for efficiency
  async batchSetCounts(updates) {
    try {
      const pipeline = redisClient.client?.multi() || null;
      if (!pipeline) {
        console.warn('⚠️ [MailboxCache] Redis pipeline not available, using individual sets');
        for (const { userId, unread, total } of updates) {
          await this.setCounts(userId, { unread, total });
        }
        return true;
      }

      for (const { userId, unread, total } of updates) {
        pipeline.set(this.getUnreadCountKey(userId), unread.toString());
        pipeline.set(this.getTotalCountKey(userId), total.toString());
      }

      await pipeline.exec();
      console.log(`📊 [MailboxCache] Batch updated ${updates.length} user counts`);
      return true;
    } catch (error) {
      console.error('❌ [MailboxCache] Error in batch set counts:', error);
      return false;
    }
  }

  // Clear all cache data for a user
  async clearUserCache(userId) {
    try {
      const keys = [
        this.getUnreadCountKey(userId),
        this.getTotalCountKey(userId),
        this.getLastHistoryIdKey(userId),
        this.getRecentLocalChangeKey(userId)
      ];

      await Promise.all(keys.map(key => redisClient.del(key)));
      console.log(`🧹 [MailboxCache] Cleared cache for user ${userId}`);
      return true;
    } catch (error) {
      console.error('❌ [MailboxCache] Error clearing user cache:', error);
      return false;
    }
  }

  // Health check and stats
  async getHealth() {
    try {
      const isHealthy = await redisClient.isHealthy();
      const stats = redisClient.getStats();

      return {
        healthy: isHealthy,
        redis: stats,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ [MailboxCache] Health check failed:', error);
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Initialize cache with database values
  async initializeFromDatabase(userId, dbCounts, historyId) {
    try {
      await Promise.all([
        this.setCounts(userId, dbCounts),
        this.setLastHistoryId(userId, historyId)
      ]);

      console.log(`🎯 [MailboxCache] Initialized cache for user ${userId} from database`);
      return true;
    } catch (error) {
      console.error('❌ [MailboxCache] Error initializing from database:', error);
      return false;
    }
  }

  // Warm cache for multiple users (on startup)
  async warmCache(userDataArray) {
    try {
      console.log(`🔥 [MailboxCache] Warming cache for ${userDataArray.length} users`);

      const results = await Promise.allSettled(
        userDataArray.map(({ userId, unread, total, historyId }) =>
          this.initializeFromDatabase(userId, { unread, total }, historyId)
        )
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      console.log(`🔥 [MailboxCache] Cache warming completed: ${successful}/${userDataArray.length} successful`);

      return { successful, total: userDataArray.length };
    } catch (error) {
      console.error('❌ [MailboxCache] Error warming cache:', error);
      return { successful: 0, total: userDataArray.length };
    }
  }
}

// Export singleton instance
module.exports = new MailboxCache();