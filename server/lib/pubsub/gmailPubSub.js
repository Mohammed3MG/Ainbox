const { PubSub } = require('@google-cloud/pubsub');
const { google } = require('googleapis');

class GmailPubSubService {
  constructor() {
    this.pubsub = new PubSub({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE, // Optional: Use service account key
    });

    this.gmail = null;
    this.topicName = process.env.GMAIL_PUBSUB_TOPIC || 'gmail-notifications';
    this.subscriptionName = process.env.GMAIL_PUBSUB_SUBSCRIPTION || 'gmail-notifications-sub';
    this.watchedUsers = new Map(); // Track watched mailboxes
  }

  /**
   * Initialize Gmail API client for a user
   */
  async initializeGmailClient(accessToken, refreshToken) {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_CALLBACK_URL
    );

    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    return this.gmail;
  }

  /**
   * Set up Gmail Push Notification for a user's mailbox
   */
  async setupGmailWatch(userId, accessToken, refreshToken) {
    try {
      console.log(`📡 Setting up Gmail Push notification for user ${userId}`);

      // Initialize Gmail client
      await this.initializeGmailClient(accessToken, refreshToken);

      // Create or get the topic
      await this.ensureTopicExists();

      // Set up watch request
      const watchRequest = {
        userId: 'me',
        requestBody: {
          topicName: this.topicName, // Already contains full path: projects/ainbox-471417/topics/fylApp
          labelIds: ['INBOX'], // Watch only INBOX
          labelFilterBehavior: 'include', // Gmail API uses 'labelFilterBehavior' not 'labelFilterAction'
        },
      };

      const response = await this.gmail.users.watch(watchRequest);

      // Store watch information
      this.watchedUsers.set(userId, {
        historyId: response.data.historyId,
        expiration: response.data.expiration,
        accessToken,
        refreshToken,
        watchedAt: new Date(),
      });

      console.log(`✅ Gmail watch set up for user ${userId}:`, {
        historyId: response.data.historyId,
        expiration: new Date(parseInt(response.data.expiration)),
      });

      return response.data;
    } catch (error) {
      console.error(`❌ Failed to setup Gmail watch for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Stop Gmail Push notification for a user
   */
  async stopGmailWatch(userId, accessToken, refreshToken) {
    try {
      console.log(`🛑 Stopping Gmail Push notification for user ${userId}`);

      await this.initializeGmailClient(accessToken, refreshToken);

      await this.gmail.users.stop({ userId: 'me' });

      // Remove from watched users
      this.watchedUsers.delete(userId);

      console.log(`✅ Gmail watch stopped for user ${userId}`);
    } catch (error) {
      console.error(`❌ Failed to stop Gmail watch for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Ensure Pub/Sub topic exists
   */
  async ensureTopicExists() {
    try {
      // Extract just the topic name from the full path
      const topicName = this.topicName.split('/').pop(); // Gets 'fylApp' from 'projects/ainbox-471417/topics/fylApp'
      const topic = this.pubsub.topic(topicName);
      const [exists] = await topic.exists();

      if (!exists) {
        console.log(`📊 Creating Pub/Sub topic: ${this.topicName}`);
        await topic.create();
        console.log(`✅ Pub/Sub topic created: ${this.topicName}`);
      } else {
        console.log(`✅ Pub/Sub topic exists: ${this.topicName}`);
      }

      // Create subscription if it doesn't exist
      await this.ensureSubscriptionExists();

      return topic;
    } catch (error) {
      console.error('❌ Failed to ensure topic exists:', error);
      throw error;
    }
  }

  /**
   * Ensure Pub/Sub subscription exists
   */
  async ensureSubscriptionExists() {
    try {
      // Extract just the subscription name from the full path
      const subscriptionName = this.subscriptionName.split('/').pop(); // Gets 'fylApp_push'
      const topicName = this.topicName.split('/').pop(); // Gets 'fylApp'

      const subscription = this.pubsub.subscription(subscriptionName);
      const [exists] = await subscription.exists();

      if (!exists) {
        console.log(`📊 Creating Pub/Sub subscription: ${subscriptionName}`);
        await this.pubsub.topic(topicName).createSubscription(subscriptionName);
        console.log(`✅ Pub/Sub subscription created: ${this.subscriptionName}`);
      } else {
        console.log(`✅ Pub/Sub subscription exists: ${this.subscriptionName}`);
      }
    } catch (error) {
      console.error('❌ Failed to ensure subscription exists:', error);
      throw error;
    }
  }

  /**
   * Process Gmail history changes with detailed email information
   */
  async processGmailHistoryChanges(userId, startHistoryId) {
    try {
      const userWatch = this.watchedUsers.get(userId);
      if (!userWatch) {
        console.warn(`⚠️  No watch data found for user ${userId}`);
        return;
      }

      await this.initializeGmailClient(userWatch.accessToken, userWatch.refreshToken);

      // Get history changes
      const historyResponse = await this.gmail.users.history.list({
        userId: 'me',
        startHistoryId: startHistoryId,
        labelId: 'INBOX',
      });

      const changes = historyResponse.data.history || [];
      console.log(`📨 Processing ${changes.length} history changes for user ${userId}`);

      const emailChanges = [];
      const labelChanges = [];
      const detailedEmailUpdates = [];

      for (const change of changes) {
        // Process messages added
        if (change.messagesAdded) {
          for (const msgAdded of change.messagesAdded) {
            const emailDetail = await this.getEmailDetails(msgAdded.message.id);
            emailChanges.push({
              type: 'added',
              messageId: msgAdded.message.id,
              threadId: msgAdded.message.threadId,
              emailDetail
            });
          }
        }

        // Process messages deleted
        if (change.messagesDeleted) {
          for (const msgDeleted of change.messagesDeleted) {
            emailChanges.push({
              type: 'deleted',
              messageId: msgDeleted.message.id,
              threadId: msgDeleted.message.threadId,
            });
          }
        }

        // Process label changes (read/unread status) with detailed info
        if (change.labelsAdded) {
          for (const labelAdded of change.labelsAdded) {
            const emailDetail = await this.getEmailDetails(labelAdded.message.id);
            const isUnreadAdded = labelAdded.labelIds.includes('UNREAD');

            labelChanges.push({
              type: 'label_added',
              messageId: labelAdded.message.id,
              labelIds: labelAdded.labelIds,
              isUnreadAdded,
              emailDetail
            });

            // Send immediate UI update for read/unread changes
            if (isUnreadAdded) {
              detailedEmailUpdates.push({
                messageId: labelAdded.message.id,
                isRead: false,
                changeType: 'marked_unread',
                subject: emailDetail?.subject,
                from: emailDetail?.from,
                timestamp: new Date().toISOString()
              });
            }
          }
        }

        if (change.labelsRemoved) {
          for (const labelRemoved of change.labelsRemoved) {
            const emailDetail = await this.getEmailDetails(labelRemoved.message.id);
            const isUnreadRemoved = labelRemoved.labelIds.includes('UNREAD');

            labelChanges.push({
              type: 'label_removed',
              messageId: labelRemoved.message.id,
              labelIds: labelRemoved.labelIds,
              isUnreadRemoved,
              emailDetail
            });

            // Send immediate UI update for read/unread changes
            if (isUnreadRemoved) {
              detailedEmailUpdates.push({
                messageId: labelRemoved.message.id,
                isRead: true,
                changeType: 'marked_read',
                subject: emailDetail?.subject,
                from: emailDetail?.from,
                timestamp: new Date().toISOString()
              });
            }
          }
        }
      }

      // Update last processed history ID
      if (historyResponse.data.historyId) {
        userWatch.historyId = historyResponse.data.historyId;
      }

      return {
        emailChanges,
        labelChanges,
        detailedEmailUpdates,
        newHistoryId: historyResponse.data.historyId,
      };

    } catch (error) {
      console.error(`❌ Failed to process Gmail history for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get detailed email information for immediate UI updates
   */
  async getEmailDetails(messageId) {
    try {
      const messageResponse = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date']
      });

      const message = messageResponse.data;
      const headers = message.payload.headers;

      const getHeader = (name) => {
        const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
        return header ? header.value : '';
      };

      return {
        id: messageId,
        subject: getHeader('Subject'),
        from: getHeader('From'),
        date: getHeader('Date'),
        isRead: !message.labelIds.includes('UNREAD'),
        labelIds: message.labelIds || [],
        snippet: message.snippet
      };

    } catch (error) {
      console.error(`❌ Failed to get email details for ${messageId}:`, error);
      return null;
    }
  }

  /**
   * Get current inbox counts
   */
  async getInboxCounts(userId) {
    try {
      const userWatch = this.watchedUsers.get(userId);
      if (!userWatch) {
        throw new Error(`No watch data found for user ${userId}`);
      }

      await this.initializeGmailClient(userWatch.accessToken, userWatch.refreshToken);

      // Get unread count
      const unreadResponse = await this.gmail.users.messages.list({
        userId: 'me',
        labelIds: ['INBOX', 'UNREAD'],
      });

      // Get total inbox count
      const totalResponse = await this.gmail.users.messages.list({
        userId: 'me',
        labelIds: ['INBOX'],
      });

      const unreadCount = unreadResponse.data.resultSizeEstimate || 0;
      const totalCount = totalResponse.data.resultSizeEstimate || 0;

      return {
        unread: unreadCount,
        total: totalCount,
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      console.error(`❌ Failed to get inbox counts for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get watched users
   */
  getWatchedUsers() {
    return Array.from(this.watchedUsers.keys());
  }

  /**
   * Get watch info for a user
   */
  getWatchInfo(userId) {
    return this.watchedUsers.get(userId);
  }

  /**
   * Renew watch for a user (before expiration)
   */
  async renewWatch(userId) {
    try {
      const userWatch = this.watchedUsers.get(userId);
      if (!userWatch) {
        throw new Error(`No watch data found for user ${userId}`);
      }

      console.log(`🔄 Renewing Gmail watch for user ${userId}`);
      return await this.setupGmailWatch(userId, userWatch.accessToken, userWatch.refreshToken);
    } catch (error) {
      console.error(`❌ Failed to renew watch for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Start listening for Pub/Sub messages from Gmail
   * THIS IS CRITICAL - Without this, no real-time updates work!
   */
  async startPubSubListener() {
    try {
      console.log(`📡 Starting Pub/Sub listener for subscription: ${this.subscriptionName}`);

      const subscriptionName = this.subscriptionName.split('/').pop(); // Gets 'fylApp_push'
      const subscription = this.pubsub.subscription(subscriptionName);

      // Handle incoming messages from Gmail
      subscription.on('message', async (message) => {
        try {
          console.log('📨 Received Gmail Pub/Sub notification:', message.id);

          // Parse the message data
          const data = JSON.parse(message.data.toString());
          console.log('📧 Gmail notification data:', data);

          // Extract userId and historyId from the message
          const { emailAddress, historyId } = data;

          // Find the user by email address
          let userId = null;
          for (const [id, watchData] of this.watchedUsers.entries()) {
            if (watchData.userEmail === emailAddress) {
              userId = id;
              break;
            }
          }

          if (!userId) {
            console.warn(`⚠️ No watched user found for email: ${emailAddress}`);
            message.ack();
            return;
          }

          console.log(`📧 Processing history changes for user ${userId} from historyId ${historyId}`);

          // Process the history changes
          const result = await this.processGmailHistoryChanges(userId, historyId);

          // Send real-time updates to frontend
          if (result && result.detailedEmailUpdates.length > 0) {
            const gmailSyncService = require('../gmailSyncService');

            for (const update of result.detailedEmailUpdates) {
              // Send immediate status update
              gmailSyncService.sendRealTimeUpdate(userId, {
                type: 'email_status_updated_immediate',
                messageId: update.messageId,
                isRead: update.isRead,
                changeType: update.changeType,
                subject: update.subject,
                from: update.from,
                priority: 'immediate',
                timestamp: update.timestamp
              });
            }
          }

          // Send count updates
          const counts = await this.getInboxCounts(userId);
          const gmailSyncService = require('../gmailSyncService');
          gmailSyncService.sendRealTimeUpdate(userId, {
            type: 'unread_count_updated',
            unread: counts.unread,
            total: counts.total,
            source: 'pubsub_notification',
            timestamp: counts.timestamp
          });

          // Acknowledge the message
          message.ack();
          console.log(`✅ Processed Gmail notification for user ${userId}`);

        } catch (error) {
          console.error('❌ Error processing Gmail Pub/Sub message:', error);
          message.nack(); // Negative acknowledge - will retry
        }
      });

      subscription.on('error', (error) => {
        console.error('❌ Gmail Pub/Sub subscription error:', error);
      });

      console.log(`✅ Gmail Pub/Sub listener started successfully`);

    } catch (error) {
      console.error('❌ Failed to start Gmail Pub/Sub listener:', error);
      throw error;
    }
  }

  /**
   * Stop Pub/Sub listener
   */
  async stopPubSubListener() {
    try {
      const subscriptionName = this.subscriptionName.split('/').pop(); // Gets 'fylApp_push'
      const subscription = this.pubsub.subscription(subscriptionName);
      subscription.removeAllListeners();
      console.log(`🛑 Gmail Pub/Sub listener stopped`);
    } catch (error) {
      console.error('❌ Failed to stop Gmail Pub/Sub listener:', error);
    }
  }
}

module.exports = new GmailPubSubService();