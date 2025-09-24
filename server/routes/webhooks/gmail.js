const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const socketIOService = require('../../lib/socketio');
const cache = require('../../lib/cache');
const { query } = require('../../lib/db');
const { decrypt } = require('../../utils/secure');
const { broadcastToUser } = require('../../lib/sse');
const gmailEventualConsistencyManager = require('../../lib/gmailEventualConsistencyManager');

/**
 * Gmail Push Notification Webhook Endpoint
 * This endpoint receives notifications from Google Cloud Pub/Sub
 * when Gmail mailbox changes occur
 */

router.post('/gmail/notifications', express.json(), async (req, res) => {
  try {
    console.log('📨 [DEBUG] Received Gmail Push notification at', new Date().toISOString());
    console.log('📨 [DEBUG] Request headers:', JSON.stringify(req.headers, null, 2));
    console.log('📨 [DEBUG] Request body:', JSON.stringify(req.body, null, 2));

    // Parse Pub/Sub message (already parsed by express.json())
    const pubsubMessage = req.body;

    if (!pubsubMessage.message || !pubsubMessage.message.data) {
      console.warn('⚠️  Invalid Pub/Sub message format');
      // ACK immediately regardless to avoid redelivery storms
      res.status(200).end();
      return;
    }

    // Decode base64 data
    const messageData = JSON.parse(
      Buffer.from(pubsubMessage.message.data, 'base64').toString()
    );

    console.log('📧 [DEBUG] Gmail notification data:', JSON.stringify(messageData, null, 2));

    const { emailAddress, historyId } = messageData;
    console.log('📧 [DEBUG] Extracted emailAddress:', emailAddress);
    console.log('📧 [DEBUG] Extracted historyId:', historyId);

    if (!emailAddress || !historyId) {
      console.warn('⚠️ [DEBUG] Missing required fields in Gmail notification');
      res.status(200).end();
      return;
    }

    // ACK immediately, then process asynchronously
    res.status(200).end();

    // Process asynchronously without blocking webhook ACK
    setImmediate(async () => {
      try {
        console.log(`🔍 [DEBUG] Looking up user for email: ${emailAddress}`);
        const user = await findUserByEmail(emailAddress);
        if (!user) {
          console.warn(`⚠️  User not found for email: ${emailAddress}`);
          return;
        }
        console.log(`✅ [DEBUG] Found user: ${user.id} for email: ${emailAddress}`);

        // Check if we should use V2 system
        if (process.env.REALTIME_SYNC_V2 === 'true') {
          console.log('🚀 [V2 DEBUG] Processing notification with new Redis-based system');
          console.log(`🚀 [V2 DEBUG] Data being sent to processNotificationV2:`, {
            userId: user.id,
            historyId: historyId,
            emailId: messageData.messageId || null,
            emailAddress: emailAddress,
            timestamp: new Date().toISOString()
          });

          await gmailEventualConsistencyManager.processNotificationV2(user.id, {
            historyId: historyId,
            emailId: messageData.messageId || null,
            emailAddress: emailAddress,
            timestamp: new Date().toISOString()
          });

          console.log(`✅ [V2 DEBUG] processNotificationV2 completed for user ${user.id}`);
        } else {
          console.log('🔄 [V1] Processing notification with legacy system');
          await handleGmailNotification(user, historyId);
        }
      } catch (err) {
        console.error('❌ [DEBUG] Async processing failed:', err);
        console.error('❌ [DEBUG] Error stack:', err.stack);
      }
    });

  } catch (error) {
    console.error('❌ Error processing Gmail webhook:', error);
    // Always ACK to avoid redelivery loops
    try { res.status(200).end(); } catch (_) {}
  }
});

// Cache key helpers for storing last processed historyId per user
function lastHistoryCacheKey(userId) {
  return `gmail:lastHistoryId:${userId}`;
}

// Main handler for Gmail notifications
async function handleGmailNotification(user, notificationHistoryId) {
  const userId = String(user.id);
  console.log(`🔔 [DEBUG] Handling Gmail notification for user ${userId} (${user.email})`);
  console.log(`🔔 [DEBUG] Notification historyId: ${notificationHistoryId}`);
  console.log(`🔔 [DEBUG] User refresh token exists: ${!!user.refreshToken}`);

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );
  oauth2Client.setCredentials({ refresh_token: user.refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  console.log(`🔔 [DEBUG] Gmail API client created successfully`);

  // Bootstrap if we don't have a starting historyId
  let startHistoryId = await cache.get(lastHistoryCacheKey(userId));
  console.log(`🔔 [DEBUG] Current startHistoryId from cache: ${startHistoryId}`);

  if (!startHistoryId) {
    try {
      console.log(`🔔 [DEBUG] No startHistoryId found, bootstrapping...`);
      const profile = await gmail.users.getProfile({ userId: 'me' });
      startHistoryId = profile.data.historyId;
      await cache.set(lastHistoryCacheKey(userId), String(startHistoryId));
      console.log(`📝 [DEBUG] Bootstrapped historyId for user ${userId}: ${startHistoryId}`);
      return; // Nothing to process on first notification
    } catch (e) {
      console.error('❌ [DEBUG] Failed to bootstrap historyId:', e?.message || e);
      return;
    }
  }

  console.log(`🔔 [DEBUG] Processing history changes from ${startHistoryId} to ${notificationHistoryId}`);

  if (startHistoryId === notificationHistoryId) {
    console.log(`🔔 [DEBUG] No changes - historyId unchanged: ${startHistoryId}`);
    return;
  }

  // Walk history pages since last processed ID
  let pageToken = undefined;
  const newMessageIds = new Set();
  const labelChanges = [];
  let newLatestHistoryId = null;

  do {
    console.log(`🔔 [DEBUG] Calling Gmail history API with startHistoryId: ${startHistoryId}, pageToken: ${pageToken}`);
    const resp = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: String(startHistoryId),
      historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
      pageToken,
      labelId: 'INBOX',
    });
    newLatestHistoryId = resp.data.historyId || newLatestHistoryId;
    const history = resp.data.history || [];
    console.log(`🔔 [DEBUG] Gmail API returned ${history.length} history items, newLatestHistoryId: ${newLatestHistoryId}`);
    for (const h of history) {
      if (Array.isArray(h.messagesAdded)) {
        for (const m of h.messagesAdded) {
          if (m?.message?.id) newMessageIds.add(m.message.id);
        }
      }
      if (Array.isArray(h.labelsAdded)) {
        for (const la of h.labelsAdded) {
          if (la?.message?.id) {
            labelChanges.push({ id: la.message.id, add: la.labelIds || [] });
          }
        }
      }
      if (Array.isArray(h.labelsRemoved)) {
        for (const lr of h.labelsRemoved) {
          if (lr?.message?.id) {
            labelChanges.push({ id: lr.message.id, remove: lr.labelIds || [] });
          }
        }
      }
    }
    pageToken = resp.data.nextPageToken;
  } while (pageToken);

  // Upsert new/changed messages: fetch minimal metadata for UI
  const upserts = Array.from(newMessageIds);
  for (const msgId of upserts) {
    try {
      const m = await gmail.users.messages.get({
        userId: 'me',
        id: msgId,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'To', 'Date']
      });
      const message = serializeForUI(m.data);

      // Invalidate inbox cache so refresh shows consistent state
      try {
        const emailCache = require('../../lib/emailCache');
        await emailCache.invalidateUserInbox(userId, 'gmail');
      } catch (_) {}

      // Emit via Socket.IO using standardized event names
      try {
        console.log(`🔔 [DEBUG] Sending newEmail via Socket.IO for user ${userId}, messageId: ${message.id}`);
        socketIOService.newEmail(userId, message);
        console.log(`🔔 [DEBUG] ✅ Socket.IO newEmail sent successfully`);
      } catch (e) {
        console.error(`🔔 [DEBUG] ❌ Socket.IO newEmail failed:`, e);
      }

      // Also emit via SSE for any listeners
      try {
        console.log(`🔔 [DEBUG] Sending email_updated via SSE for user ${userId}, messageId: ${message.id}`);
        broadcastToUser(userId, { type: 'email_updated', changeType: 'added', messageId: message.id, threadId: message.threadId, emailDetail: message, timestamp: new Date().toISOString() });
        console.log(`🔔 [DEBUG] ✅ SSE email_updated sent successfully`);
      } catch (e) {
        console.error(`🔔 [DEBUG] ❌ SSE email_updated failed:`, e);
      }

    } catch (e) {
      console.error('❌ Failed to upsert message', msgId, e?.message || e);
    }
  }

  // Emit label changes as immediate read/unread updates
  console.log(`🔍 Processing ${labelChanges.length} label changes for user ${userId}`);
  for (const ch of labelChanges) {
    const add = ch.add || [];
    const remove = ch.remove || [];
    const isUnreadAdded = add.includes('UNREAD');
    const isUnreadRemoved = remove.includes('UNREAD');
    let isRead = undefined;
    if (isUnreadAdded) isRead = false;
    if (isUnreadRemoved) isRead = true;

    console.log(`🔍 Label change - MessageId: ${ch.id}, Added: [${add.join(',')}], Removed: [${remove.join(',')}], IsRead: ${isRead}`);

    if (typeof isRead === 'boolean') {
      console.log(`⚡ IMMEDIATE STATUS UPDATE - MessageId: ${ch.id}, IsRead: ${isRead}, Change: ${isRead ? 'marked_read' : 'marked_unread'}`);

      // Socket event for row styling update
      try {
        socketIOService.emailUpdated(userId, { id: ch.id, isRead, source: 'pubsub_immediate' });
        console.log(`✅ Socket.IO update sent for message ${ch.id}`);
      } catch (e) {
        console.error(`❌ Socket.IO update failed:`, e);
      }

      // SSE immediate event for UI bridge
      try {
        const sseData = { type: 'email_status_updated_immediate', messageId: ch.id, isRead, changeType: isRead ? 'marked_read' : 'marked_unread', priority: 'immediate', timestamp: new Date().toISOString() };
        broadcastToUser(userId, sseData);
        console.log(`✅ SSE update sent for message ${ch.id}:`, sseData);
      } catch (e) {
        console.error(`❌ SSE update failed:`, e);
      }
    }
  }

  // Gmail Eventual Consistency: Use delayed resync instead of immediate count updates
  // Immediate count queries often return stale data, so we let the eventual consistency manager handle this
  console.log(`🔄 [EventualConsistency] Triggering delayed resync for Pub/Sub notification (user: ${userId}, historyId: ${notificationHistoryId})`);

  // Collect immediate status updates for the consistency manager
  const immediateUpdates = [];
  for (const ch of labelChanges) {
    if (ch.add?.includes('UNREAD') || ch.remove?.includes('UNREAD')) {
      immediateUpdates.push({
        type: 'email_status_changed',
        messageId: ch.id,
        isRead: ch.remove?.includes('UNREAD') ? true : false,
        source: 'pubsub_label_change'
      });
    }
  }

  // Use the eventual consistency manager for smart delayed resync
  try {
    await gmailEventualConsistencyManager.handlePubSubNotification(userId, notificationHistoryId, immediateUpdates);
  } catch (e) {
    console.error('❌ [EventualConsistency] Failed to handle Pub/Sub notification:', e?.message || e);
  }

  // Advance last processed historyId (monotonic)
  if (newLatestHistoryId) {
    await cache.set(lastHistoryCacheKey(userId), String(newLatestHistoryId));
    console.log(`✅ Advanced historyId for user ${userId} -> ${newLatestHistoryId}`);
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

      // Send via Socket.IO helper (broadcast to user's sockets)
      try { socketIOService.countUpdated(userId, { unread: countUpdate.unread, total: countUpdate.total }, countUpdate.source); } catch (_) {}

      // Send via SSE (existing SSE implementation)
      try { broadcastToUser(userId, countUpdate); } catch (_) {}
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

        // Socket.IO standardized event name (email_updated)
        try { socketIOService.emailUpdated(userId, { id: emailUpdate.messageId, isRead: emailUpdate.isRead, source: 'pubsub_immediate' }); } catch (_) {}
        // SSE
        try { broadcastToUser(userId, immediateUpdate); } catch (_) {}
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

      // Send via Socket.IO and SSE
      try { socketIOService.newEmail(userId, emailUpdate.emailDetail); } catch (_) {}
      try { broadcastToUser(userId, emailUpdate); } catch (_) {}
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

      // Socket immediate row update + SSE bridge
      try { socketIOService.emailUpdated(userId, { id: statusUpdate.messageId, isRead: statusUpdate.isRead, source: 'pubsub_label_change' }); } catch (_) {}
      try { broadcastToUser(userId, statusUpdate); } catch (_) {}
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
    broadcastToUser(userId, data);
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
    console.log(`🔍 Looking up user for email: ${emailAddress}`);
    const { rows } = await query(
      'SELECT u.id, u.email, a.refresh_token_encrypted FROM users u JOIN accounts a ON a.user_id=u.id AND a.provider=$2 WHERE a.email=$1 LIMIT 1',
      [emailAddress, 'google']
    );
    const row = rows[0];
    if (!row) return null;
    const refreshToken = row.refresh_token_encrypted ? decrypt(row.refresh_token_encrypted) : null;
    if (!refreshToken) {
      console.warn(`⚠️  No refresh token for user with email ${emailAddress}`);
      return null;
    }
    return { id: row.id, email: row.email || emailAddress, refreshToken };
  } catch (error) {
    console.error('❌ Failed to find user by email:', error);
    return null;
  }
}

// Minimal serializer for UI consumption (aligns with frontend formatter)
function serializeForUI(message) {
  const headers = message?.payload?.headers || [];
  const getHeader = (name) => headers.find(h => h.name === name)?.value || '';
  return {
    id: message.id,
    threadId: message.threadId,
    subject: getHeader('Subject') || '(No Subject)',
    from: getHeader('From') || '',
    to: getHeader('To') || '',
    date: getHeader('Date') || new Date().toISOString(),
    snippet: message.snippet || '',
    labelIds: message.labelIds || [],
    // Derived UI flags
    isRead: !(message.labelIds || []).includes('UNREAD'),
    isStarred: (message.labelIds || []).includes('STARRED'),
    preview: message.snippet || ''
  };
}

async function getInboxCounts(gmail) {
  // Primary inbox counts - FIXED: Use category:primary to only count primary emails (not promotions/social/etc)
  const unreadResp = await gmail.users.messages.list({
    userId: 'me',
    q: 'category:primary is:unread'
  });
  const totalResp = await gmail.users.messages.list({
    userId: 'me',
    q: 'category:primary'
  });
  return {
    unread: unreadResp.data?.resultSizeEstimate || 0,
    total: totalResp.data?.resultSizeEstimate || 0,
  };
}

module.exports = router;
