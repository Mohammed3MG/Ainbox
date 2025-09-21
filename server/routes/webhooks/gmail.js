const express = require('express');
const router = express.Router();
const gmailPubSub = require('../../lib/pubsub/gmailPubSub');
const socketIOService = require('../../lib/socketio');

/**
 * Gmail Push Notification Webhook Endpoint
 * This endpoint receives notifications from Google Cloud Pub/Sub
 * when Gmail mailbox changes occur
 */
router.post('/gmail/notifications', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    console.log('📨 Received Gmail Push notification');

    // Parse Pub/Sub message
    const pubsubMessage = JSON.parse(req.body.toString());

    if (!pubsubMessage.message || !pubsubMessage.message.data) {
      console.warn('⚠️  Invalid Pub/Sub message format');
      return res.status(400).json({ error: 'Invalid message format' });
    }

    // Decode base64 data
    const messageData = JSON.parse(
      Buffer.from(pubsubMessage.message.data, 'base64').toString()
    );

    console.log('📧 Gmail notification data:', messageData);

    const { emailAddress, historyId } = messageData;

    if (!emailAddress || !historyId) {
      console.warn('⚠️  Missing required fields in Gmail notification');
      return res.status(400).json({ error: 'Missing emailAddress or historyId' });
    }

    // Find user by email address (you'll need to implement this based on your user storage)
    const userId = await findUserByEmail(emailAddress);

    if (!userId) {
      console.warn(`⚠️  User not found for email: ${emailAddress}`);
      return res.status(404).json({ error: 'User not found' });
    }

    // Process the Gmail history changes
    const result = await processGmailChanges(userId, historyId);

    // Send real-time updates to frontend
    await sendRealTimeUpdates(userId, result);

    // Acknowledge the webhook
    res.status(200).json({
      success: true,
      processed: result.totalChanges || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error processing Gmail webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Process Gmail history changes
 */
async function processGmailChanges(userId, historyId) {
  try {
    const userWatch = gmailPubSub.getWatchInfo(userId);
    if (!userWatch) {
      throw new Error(`No watch info found for user ${userId}`);
    }

    // Process history changes since last known historyId
    const changes = await gmailPubSub.processGmailHistoryChanges(userId, userWatch.historyId);

    // Get updated inbox counts
    const inboxCounts = await gmailPubSub.getInboxCounts(userId);

    console.log(`📊 Processed changes for user ${userId}:`, {
      emailChanges: changes.emailChanges.length,
      labelChanges: changes.labelChanges.length,
      newCounts: inboxCounts
    });

    return {
      userId,
      emailChanges: changes.emailChanges,
      labelChanges: changes.labelChanges,
      inboxCounts,
      totalChanges: changes.emailChanges.length + changes.labelChanges.length,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error(`❌ Failed to process Gmail changes for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Send real-time updates to frontend via SSE/WebSocket
 */
async function sendRealTimeUpdates(userId, updateData) {
  try {
    console.log(`📡 Sending real-time updates for user ${userId}:`, {
      emailChanges: updateData.emailChanges?.length || 0,
      labelChanges: updateData.labelChanges?.length || 0,
      detailedUpdates: updateData.detailedEmailUpdates?.length || 0
    });

    // Send inbox count updates FIRST (fastest)
    if (updateData.inboxCounts) {
      const countUpdate = {
        type: 'unread_count_updated',
        unread: updateData.inboxCounts.unread,
        total: updateData.inboxCounts.total,
        source: 'pubsub_notification',
        timestamp: updateData.timestamp
      };

      // Send via Socket.IO (if available)
      if (socketIOService && socketIOService.io) {
        socketIOService.io.to(userId).emit('gmailUpdate', countUpdate);
      }

      // Send via SSE (your existing SSE implementation)
      sendSSEUpdate(userId, countUpdate);
    }

    // Send IMMEDIATE detailed email status updates (for instant UI changes)
    if (updateData.detailedEmailUpdates) {
      for (const emailUpdate of updateData.detailedEmailUpdates) {
        const immediateUpdate = {
          type: 'email_status_updated_immediate',
          messageId: emailUpdate.messageId,
          isRead: emailUpdate.isRead,
          changeType: emailUpdate.changeType,
          subject: emailUpdate.subject,
          from: emailUpdate.from,
          timestamp: emailUpdate.timestamp,
          priority: 'immediate' // Mark as high priority for instant UI update
        };

        console.log(`⚡ Sending IMMEDIATE email status update:`, immediateUpdate);

        // Send via Socket.IO (PRIORITY: Immediate email status update)
        if (socketIOService && socketIOService.io) {
          socketIOService.io.to(userId).emit('gmailUpdate', immediateUpdate);

          // ALSO send via existing Socket.IO email update system for React hooks
          socketIOService.io.to(userId).emit('emailUpdated', {
            emailId: emailUpdate.messageId,
            isRead: emailUpdate.isRead,
            source: 'pubsub_immediate',
            timestamp: emailUpdate.timestamp
          });
        }

        // Send via SSE
        sendSSEUpdate(userId, immediateUpdate);
      }
    }

    // Send individual email updates (new/deleted emails)
    for (const emailChange of updateData.emailChanges) {
      const emailUpdate = {
        type: 'email_updated',
        changeType: emailChange.type,
        messageId: emailChange.messageId,
        threadId: emailChange.threadId,
        emailDetail: emailChange.emailDetail,
        timestamp: updateData.timestamp
      };

      // Send via Socket.IO
      if (socketIOService && socketIOService.io) {
        socketIOService.io.to(userId).emit('gmailUpdate', emailUpdate);
      }

      // Send via SSE
      sendSSEUpdate(userId, emailUpdate);
    }

    // Send label changes (read/unread status) - ENHANCED
    for (const labelChange of updateData.labelChanges) {
      let isRead = true;

      // Determine read status based on label change
      if (labelChange.type === 'label_added' && labelChange.isUnreadAdded) {
        isRead = false;
      } else if (labelChange.type === 'label_removed' && labelChange.isUnreadRemoved) {
        isRead = true;
      }

      const statusUpdate = {
        type: 'email_status_updated',
        messageId: labelChange.messageId,
        changeType: labelChange.type,
        labelIds: labelChange.labelIds,
        isRead: isRead,
        emailDetail: labelChange.emailDetail,
        timestamp: updateData.timestamp
      };

      console.log(`📧 Sending label change update:`, statusUpdate);

      // Send via Socket.IO
      if (socketIOService && socketIOService.io) {
        socketIOService.io.to(userId).emit('gmailUpdate', statusUpdate);
      }

      // Send via SSE
      sendSSEUpdate(userId, statusUpdate);
    }

    console.log(`✅ Real-time updates sent for user ${userId}`);

  } catch (error) {
    console.error(`❌ Failed to send real-time updates for user ${userId}:`, error);
  }
}

/**
 * Send SSE update (integrate with your existing SSE implementation)
 */
function sendSSEUpdate(userId, data) {
  try {
    // This should integrate with your existing SSE implementation
    // You may need to modify this based on how you're managing SSE connections

    // Example: if you have a global SSE manager
    if (global.sseManager) {
      global.sseManager.sendToUser(userId, data);
    }

    console.log(`📡 SSE update sent to user ${userId}:`, data.type);
  } catch (error) {
    console.error(`❌ Failed to send SSE update:`, error);
  }
}

/**
 * Find user by email address
 * You'll need to implement this based on your user storage system
 */
async function findUserByEmail(emailAddress) {
  try {
    // TODO: Implement based on your user storage
    // This could be database query, Redis lookup, etc.

    // Example with database:
    // const user = await db.query('SELECT id FROM users WHERE email = ?', [emailAddress]);
    // return user?.id;

    // For now, return a placeholder
    console.log(`🔍 Looking up user for email: ${emailAddress}`);

    // You'll need to replace this with actual user lookup logic
    return emailAddress; // Using email as userId for now

  } catch (error) {
    console.error('❌ Failed to find user by email:', error);
    return null;
  }
}

module.exports = router;