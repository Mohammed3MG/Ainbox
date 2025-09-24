const { google } = require('googleapis');
const { decrypt } = require('../utils/secure');
const { query } = require('./db');

class GmailApiHelpers {
  constructor() {
    this.retryDefaults = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      backoffFactor: 2
    };

    this.rateLimitDefaults = {
      perSecond: 250,
      perMinute: 10000,
      per100Seconds: 25000
    };
  }

  /**
   * Get Gmail client for a user with retry capabilities
   */
  async getGmailClient(userId) {
    const { rows } = await query(
      'SELECT a.refresh_token_encrypted FROM accounts a WHERE a.user_id=$1 AND a.provider=$2 LIMIT 1',
      [userId, 'google']
    );

    if (rows.length === 0) {
      throw new Error(`No Google account found for user ${userId}`);
    }

    const refreshToken = decrypt(rows[0].refresh_token_encrypted);

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_CALLBACK_URL
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    return google.gmail({ version: 'v1', auth: oauth2Client });
  }

  /**
   * Execute Gmail API call with retry logic
   */
  async withRetry(operation, options = {}) {
    const config = { ...this.retryDefaults, ...options };
    let lastError;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        // Don't retry on certain errors
        if (this.shouldNotRetry(error)) {
          throw error;
        }

        // If this was the last attempt, throw the error
        if (attempt === config.maxRetries) {
          break;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          config.baseDelay * Math.pow(config.backoffFactor, attempt),
          config.maxDelay
        );

        console.warn(`⚠️ [Gmail API] Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error.message);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Check if an error should not be retried
   */
  shouldNotRetry(error) {
    // Don't retry on auth errors
    if (error.code === 401 || error.message.includes('unauthorized')) {
      return true;
    }

    // Don't retry on permission errors
    if (error.code === 403 && !error.message.includes('quota')) {
      return true;
    }

    // Don't retry on not found errors
    if (error.code === 404) {
      return true;
    }

    // Don't retry on client errors (except rate limiting)
    if (error.code >= 400 && error.code < 500 && error.code !== 429) {
      return true;
    }

    return false;
  }

  /**
   * Sleep for a given number of milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Mark email as read with retry
   */
  async markEmailAsRead(userId, messageIds) {
    if (!Array.isArray(messageIds)) {
      messageIds = [messageIds];
    }

    const gmail = await this.getGmailClient(userId);

    return this.withRetry(async () => {
      const results = [];
      for (const messageId of messageIds) {
        const result = await gmail.users.messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: {
            removeLabelIds: ['UNREAD']
          }
        });
        results.push(result);
      }
      return results;
    });
  }

  /**
   * Mark email as unread with retry
   */
  async markEmailAsUnread(userId, messageIds) {
    if (!Array.isArray(messageIds)) {
      messageIds = [messageIds];
    }

    const gmail = await this.getGmailClient(userId);

    return this.withRetry(async () => {
      const results = [];
      for (const messageId of messageIds) {
        const result = await gmail.users.messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: {
            addLabelIds: ['UNREAD']
          }
        });
        results.push(result);
      }
      return results;
    });
  }

  /**
   * Delete emails with retry
   */
  async deleteEmails(userId, messageIds) {
    if (!Array.isArray(messageIds)) {
      messageIds = [messageIds];
    }

    const gmail = await this.getGmailClient(userId);

    return this.withRetry(async () => {
      const results = [];
      for (const messageId of messageIds) {
        const result = await gmail.users.messages.trash({
          userId: 'me',
          id: messageId
        });
        results.push(result);
      }
      return results;
    });
  }

  /**
   * Get message counts with retry
   */
  async getMessageCounts(userId) {
    const gmail = await this.getGmailClient(userId);

    return this.withRetry(async () => {
      const [unreadResp, totalResp] = await Promise.all([
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

      return {
        unread: unreadResp.data.resultSizeEstimate || 0,
        total: totalResp.data.resultSizeEstimate || 0,
        timestamp: new Date().toISOString()
      };
    });
  }

  /**
   * Get Gmail history with retry
   */
  async getHistory(userId, startHistoryId, options = {}) {
    const gmail = await this.getGmailClient(userId);

    return this.withRetry(async () => {
      return await gmail.users.history.list({
        userId: 'me',
        startHistoryId: startHistoryId,
        historyTypes: options.historyTypes || ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
        labelId: options.labelId || 'INBOX',
        maxResults: options.maxResults || 100,
        pageToken: options.pageToken
      });
    });
  }

  /**
   * Get user profile with retry
   */
  async getUserProfile(userId) {
    const gmail = await this.getGmailClient(userId);

    return this.withRetry(async () => {
      return await gmail.users.getProfile({ userId: 'me' });
    });
  }

  /**
   * Get message with retry
   */
  async getMessage(userId, messageId, format = 'full') {
    const gmail = await this.getGmailClient(userId);

    return this.withRetry(async () => {
      return await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: format
      });
    });
  }

  /**
   * List messages with retry
   */
  async listMessages(userId, options = {}) {
    const gmail = await this.getGmailClient(userId);

    return this.withRetry(async () => {
      return await gmail.users.messages.list({
        userId: 'me',
        q: options.query,
        labelIds: options.labelIds,
        maxResults: options.maxResults || 100,
        pageToken: options.pageToken
      });
    });
  }

  /**
   * Batch modify messages with retry
   */
  async batchModifyMessages(userId, messageIds, modifications) {
    const gmail = await this.getGmailClient(userId);

    return this.withRetry(async () => {
      return await gmail.users.messages.batchModify({
        userId: 'me',
        requestBody: {
          ids: messageIds,
          ...modifications
        }
      });
    });
  }

  /**
   * Get label information with retry
   */
  async getLabels(userId) {
    const gmail = await this.getGmailClient(userId);

    return this.withRetry(async () => {
      return await gmail.users.labels.list({ userId: 'me' });
    });
  }

  /**
   * Watch mailbox for changes (Pub/Sub) with retry
   */
  async watchMailbox(userId, topicName) {
    const gmail = await this.getGmailClient(userId);

    return this.withRetry(async () => {
      return await gmail.users.watch({
        userId: 'me',
        requestBody: {
          topicName: topicName,
          labelIds: ['INBOX'],
          labelFilterAction: 'include'
        }
      });
    });
  }

  /**
   * Stop watching mailbox with retry
   */
  async stopWatchingMailbox(userId) {
    const gmail = await this.getGmailClient(userId);

    return this.withRetry(async () => {
      return await gmail.users.stop({ userId: 'me' });
    });
  }

  /**
   * Health check for Gmail API access
   */
  async healthCheck(userId) {
    try {
      await this.getUserProfile(userId);
      return { healthy: true, timestamp: new Date().toISOString() };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        code: error.code,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Rate limiting helpers
   */
  async withRateLimit(operation, userId) {
    // This is a simplified rate limiter - in production you'd want a more sophisticated one
    const key = `gmail_rate_limit:${userId}`;

    // For now, just execute the operation
    // TODO: Implement proper rate limiting with Redis
    return await operation();
  }

  /**
   * Bulk operation with batching
   */
  async bulkOperation(userId, items, operation, batchSize = 100) {
    const results = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      try {
        const batchResults = await this.withRetry(async () => {
          return await operation(batch);
        });
        results.push(...(Array.isArray(batchResults) ? batchResults : [batchResults]));
      } catch (error) {
        console.error(`❌ [Gmail API] Batch operation failed for batch ${Math.floor(i/batchSize) + 1}:`, error.message);
        // Continue with other batches
      }
    }

    return results;
  }

  /**
   * Smart message fetching with caching hints
   */
  async getMessagesWithMetadata(userId, messageIds, fields = ['id', 'threadId', 'labelIds']) {
    const gmail = await this.getGmailClient(userId);

    return this.withRetry(async () => {
      // Use batch requests when available for efficiency
      const messages = [];

      for (const messageId of messageIds) {
        try {
          const message = await gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Date']
          });
          messages.push(message.data);
        } catch (error) {
          console.warn(`⚠️ [Gmail API] Failed to fetch message ${messageId}:`, error.message);
        }
      }

      return messages;
    });
  }
}

// Export singleton instance
module.exports = new GmailApiHelpers();