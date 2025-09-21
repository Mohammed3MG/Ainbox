const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const socketIOService = require('../../lib/socketio');
const cache = require('../../lib/cache');
const { query } = require('../../lib/db');
const { decrypt } = require('../../utils/secure');
const { broadcastToUser } = require('../../lib/sse');

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
      // ACK immediately regardless to avoid redelivery storms
      res.status(200).end();
      return;
    }

    // Decode base64 data
    const messageData = JSON.parse(
      Buffer.from(pubsubMessage.message.data, 'base64').toString()
    );

    console.log('📧 Gmail notification data:', messageData);

    const { emailAddress, historyId } = messageData;

    if (!emailAddress || !historyId) {
      console.warn('⚠️  Missing required fields in Gmail notification');
      res.status(200).end();
      return;
    }

    // ACK immediately, then process asynchronously
    res.status(200).end();

    // Process asynchronously without blocking webhook ACK
    setImmediate(async () => {
      try {
        const user = await findUserByEmail(emailAddress);
        if (!user) {
          console.warn(`⚠️  User not found for email: ${emailAddress}`);
          return;
        }
        await handleGmailNotification(user, historyId);
      } catch (err) {
        console.error('❌ Async processing failed:', err);
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
  console.log(`🔔 Handling Gmail notification for user ${userId} (${user.email})`);

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );
  oauth2Client.setCredentials({ refresh_token: user.refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Bootstrap if we don't have a starting historyId
  let startHistoryId = await cache.get(lastHistoryCacheKey(userId));
  if (!startHistoryId) {
    try {
      const profile = await gmail.users.getProfile({ userId: 'me' });
      startHistoryId = profile.data.historyId;
      await cache.set(lastHistoryCacheKey(userId), String(startHistoryId));
      console.log(`📝 Bootstrapped historyId for user ${userId}: ${startHistoryId}`);
      return; // Nothing to process on first notification
    } catch (e) {
      console.error('❌ Failed to bootstrap historyId:', e?.message || e);
      return;
    }
  }

  // Walk history pages since last processed ID
  let pageToken = undefined;
  const newMessageIds = new Set();
  const labelChanges = [];
  let newLatestHistoryId = null;

  do {
    const resp = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: String(startHistoryId),
      historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
      pageToken,
      labelId: 'INBOX',
    });
    newLatestHistoryId = resp.data.historyId || newLatestHistoryId;
    const history = resp.data.history || [];
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
      try { socketIOService.newEmail(userId, message); } catch (_) {}

      // Also emit via SSE for any listeners
      try { broadcastToUser(userId, { type: 'email_updated', changeType: 'added', messageId: message.id, threadId: message.threadId, emailDetail: message, timestamp: new Date().toISOString() }); } catch (_) {}

    } catch (e) {
      console.error('❌ Failed to upsert message', msgId, e?.message || e);
    }
  }

  // Emit label changes as immediate read/unread updates
  for (const ch of labelChanges) {
    const add = ch.add || [];
    const remove = ch.remove || [];
    const isUnreadAdded = add.includes('UNREAD');
    const isUnreadRemoved = remove.includes('UNREAD');
    let isRead = undefined;
    if (isUnreadAdded) isRead = false;
    if (isUnreadRemoved) isRead = true;

    if (typeof isRead === 'boolean') {
      // Socket event for row styling update
      try { socketIOService.emailUpdated(userId, { id: ch.id, isRead, source: 'pubsub_immediate' }); } catch (_) {}
      // SSE immediate event for UI bridge
      try { broadcastToUser(userId, { type: 'email_status_updated_immediate', messageId: ch.id, isRead, changeType: isRead ? 'marked_read' : 'marked_unread', priority: 'immediate', timestamp: new Date().toISOString() }); } catch (_) {}
    }
  }

  // Optionally emit updated counters
  try {
    const counts = await getInboxCounts(gmail);
    try { socketIOService.countUpdated(userId, counts, 'pubsub_notification'); } catch (_) {}
    try { broadcastToUser(userId, { type: 'unread_count_updated', unread: counts.unread, total: counts.total, source: 'pubsub_notification', timestamp: new Date().toISOString() }); } catch (_) {}
  } catch (e) {
    console.warn('⚠️ Failed to compute inbox counts:', e?.message || e);
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
  // Primary inbox counts
  const unreadResp = await gmail.users.messages.list({ userId: 'me', labelIds: ['INBOX', 'UNREAD'] });
  const totalResp = await gmail.users.messages.list({ userId: 'me', labelIds: ['INBOX'] });
  return {
    unread: unreadResp.data?.resultSizeEstimate || 0,
    total: totalResp.data?.resultSizeEstimate || 0,
  };
}

module.exports = router;
