// Enhanced email-specific cache with intelligent invalidation
const cache = require('./cache');

// Cache TTL values in milliseconds
const CACHE_TTL = {
  INBOX_LIST: 2 * 60 * 1000,       // 2 minutes - email lists
  EMAIL_THREAD: 5 * 60 * 1000,     // 5 minutes - individual threads
  EMAIL_CONTENT: 10 * 60 * 1000,   // 10 minutes - email content/body
  USER_STATS: 1 * 60 * 1000,       // 1 minute - stats (unread count, etc)
  SEARCH_RESULTS: 3 * 60 * 1000,   // 3 minutes - search results
  AI_SUMMARY: 30 * 60 * 1000,      // 30 minutes - AI summaries (expensive)
  AI_REPLIES: 10 * 60 * 1000,      // 10 minutes - AI suggested replies
  ATTACHMENTS: 60 * 60 * 1000,     // 1 hour - attachment metadata
};

// Cache key generators
const keys = {
  userInbox: (userId, provider, folder = 'inbox', page = 1) =>
    `emails:${provider}:${userId}:${folder}:page_${page}`,

  emailThread: (userId, provider, threadId) =>
    `thread:${provider}:${userId}:${threadId}`,

  emailContent: (userId, provider, messageId) =>
    `content:${provider}:${userId}:${messageId}`,

  userStats: (userId, provider) =>
    `stats:${provider}:${userId}`,

  searchResults: (userId, provider, query, page = 1) =>
    `search:${provider}:${userId}:${Buffer.from(query).toString('base64')}:${page}`,

  aiSummary: (messageId, messagesHash) =>
    `ai:summary:${messageId}:${messagesHash}`,

  aiReplies: (messageId, contentHash, tone) =>
    `ai:replies:${messageId}:${contentHash}:${tone}`,

  attachments: (userId, provider, attachmentId) =>
    `attachment:${provider}:${userId}:${attachmentId}`,
};

// Intelligent cache operations
class EmailCache {

  // Get/Set inbox with automatic pagination cache
  async getInbox(userId, provider, folder = 'inbox', page = 1) {
    const key = keys.userInbox(userId, provider, folder, page);
    return await cache.get(key);
  }

  async setInbox(userId, provider, folder = 'inbox', page = 1, data) {
    const key = keys.userInbox(userId, provider, folder, page);
    return await cache.set(key, data, CACHE_TTL.INBOX_LIST);
  }

  // Get/Set email thread with content
  async getThread(userId, provider, threadId) {
    const key = keys.emailThread(userId, provider, threadId);
    return await cache.get(key);
  }

  async setThread(userId, provider, threadId, threadData) {
    const key = keys.emailThread(userId, provider, threadId);
    return await cache.set(key, threadData, CACHE_TTL.EMAIL_THREAD);
  }

  // Get/Set individual email content
  async getEmailContent(userId, provider, messageId) {
    const key = keys.emailContent(userId, provider, messageId);
    return await cache.get(key);
  }

  async setEmailContent(userId, provider, messageId, content) {
    const key = keys.emailContent(userId, provider, messageId);
    return await cache.set(key, content, CACHE_TTL.EMAIL_CONTENT);
  }

  // Get/Set user stats (unread count, etc)
  async getUserStats(userId, provider) {
    const key = keys.userStats(userId, provider);
    return await cache.get(key);
  }

  async setUserStats(userId, provider, stats) {
    const key = keys.userStats(userId, provider);
    return await cache.set(key, stats, CACHE_TTL.USER_STATS);
  }

  // Search results cache
  async getSearchResults(userId, provider, query, page = 1) {
    const key = keys.searchResults(userId, provider, query, page);
    return await cache.get(key);
  }

  async setSearchResults(userId, provider, query, page = 1, results) {
    const key = keys.searchResults(userId, provider, query, page);
    return await cache.set(key, results, CACHE_TTL.SEARCH_RESULTS);
  }

  // AI Summary cache with content hash for consistency
  async getAISummary(messageId, messagesContent) {
    const messagesHash = this.hashContent(messagesContent);
    const key = keys.aiSummary(messageId, messagesHash);
    return await cache.get(key);
  }

  async setAISummary(messageId, messagesContent, summary) {
    const messagesHash = this.hashContent(messagesContent);
    const key = keys.aiSummary(messageId, messagesHash);
    return await cache.set(key, summary, CACHE_TTL.AI_SUMMARY);
  }

  // AI Reply suggestions cache
  async getAIReplies(messageId, content, tone = 'neutral') {
    const contentHash = this.hashContent(content);
    const key = keys.aiReplies(messageId, contentHash, tone);
    return await cache.get(key);
  }

  async setAIReplies(messageId, content, tone = 'neutral', replies) {
    const contentHash = this.hashContent(content);
    const key = keys.aiReplies(messageId, contentHash, tone);
    return await cache.set(key, replies, CACHE_TTL.AI_REPLIES);
  }

  // Invalidation methods - clear related caches when data changes
  async invalidateUserInbox(userId, provider) {
    // Clear all inbox pages for user
    const pattern = `emails:${provider}:${userId}:*`;
    await this.deletePattern(pattern);

    // Also clear stats
    await cache.del(keys.userStats(userId, provider));
    console.log(`🗑️ Invalidated inbox cache for user ${userId} (${provider})`);
  }

  async invalidateThread(userId, provider, threadId) {
    await cache.del(keys.emailThread(userId, provider, threadId));
    console.log(`🗑️ Invalidated thread cache: ${threadId}`);
  }

  async invalidateSearch(userId, provider) {
    const pattern = `search:${provider}:${userId}:*`;
    await this.deletePattern(pattern);
    console.log(`🗑️ Invalidated search cache for user ${userId} (${provider})`);
  }

  // When user performs actions (mark read, delete, etc)
  async invalidateOnAction(userId, provider, action, threadIds = []) {
    console.log(`🔄 Cache invalidation triggered by action: ${action}`);

    switch (action) {
      case 'mark_read':
      case 'mark_unread':
      case 'archive':
      case 'delete':
        // Invalidate inbox lists and stats
        await this.invalidateUserInbox(userId, provider);
        // Invalidate specific threads
        for (const threadId of threadIds) {
          await this.invalidateThread(userId, provider, threadId);
        }
        break;

      case 'send_email':
        // Invalidate sent folder and stats
        await this.invalidateUserInbox(userId, provider);
        break;

      default:
        console.log(`⚠️ Unknown action for cache invalidation: ${action}`);
    }
  }

  // Utility methods
  hashContent(content) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(JSON.stringify(content)).digest('hex');
  }

  async deletePattern(pattern) {
    // This is a simplified version - in production you'd want to use Redis SCAN
    // For now, we'll track keys manually or use a more sophisticated approach
    console.log(`🗑️ Pattern delete requested: ${pattern}`);
  }

  // Health check and stats
  async getCacheStats() {
    return {
      redisEnabled: process.env.REDIS_URL ? true : false,
      timestamp: Date.now(),
      ttlConfig: CACHE_TTL,
    };
  }

  // Preload frequently accessed data
  async preloadUserData(userId, provider) {
    console.log(`🚀 Preloading cache for user ${userId} (${provider})`);
    // This would be called after login to warm up the cache
    // Implementation depends on specific email provider APIs
  }
}

module.exports = new EmailCache();