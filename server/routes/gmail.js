const express = require('express');
const { google } = require('googleapis');
const { requireAuth } = require('../middleware/auth');
const { getGoogleOAuthClientFromCookies } = require('../utils/googleClient');
const cache = require('../lib/cache');
const emailCache = require('../lib/emailCache');
const socketIOService = require('../lib/socketio');
const gmailSync = require('../lib/gmailSync');
const gmailSyncService = require('../lib/gmailSyncService');
const unifiedBroadcast = require('../lib/unifiedBroadcast');
const readState = require('../lib/readState');
const gmailEventualConsistencyManager = require('../lib/gmailEventualConsistencyManager');
const gmailApiHelpers = require('../lib/gmail');

const router = express.Router();

// Helpers to extract message content and attachments
function base64UrlToBuffer(data) {
  if (!data) return Buffer.alloc(0);
  // Gmail uses base64url; normalize to standard base64
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64');
}

function headerValue(headers, name) {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;
}

async function extractMessage(gmail, message, opts = {}) {
  const { includeAttachments = false } = opts;
  const headers = message.payload.headers || [];
  const header = (name) => headerValue(headers, name);

  let text = '';
  let html = '';
  const attachments = [];

  async function walk(part) {
    if (!part) return;
    const mime = part.mimeType || '';
    const body = part.body || {};

    const disp = (part.headers || []).find(h => h.name.toLowerCase() === 'content-disposition')?.value || '';
    const cid = (part.headers || []).find(h => h.name.toLowerCase() === 'content-id')?.value;

    // Handle inline text/html - prioritize HTML content for better formatting
    if (mime === 'text/plain' && body.data && !text) {
      text = base64UrlToBuffer(body.data).toString('utf-8');
    } else if (mime === 'text/html' && body.data) {
      html = base64UrlToBuffer(body.data).toString('utf-8');
    }

    // Handle attachments (including inline images)
    if (includeAttachments && body.attachmentId) {
      const att = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: message.id,
        id: body.attachmentId,
      });
      const dataBuf = base64UrlToBuffer(att.data.data);
      attachments.push({
        filename: part.filename || null,
        mimeType: mime,
        size: body.size || (dataBuf ? dataBuf.length : 0),
        contentId: cid || null,
        inline: /inline/i.test(disp),
        data: dataBuf.toString('base64'),
      });
    }

    // Recurse into multipart
    if (Array.isArray(part.parts)) {
      for (const p of part.parts) {
        // eslint-disable-next-line no-await-in-loop
        await walk(p);
      }
    }
  }

  await walk(message.payload);

  return {
    id: message.id,
    threadId: message.threadId,
    subject: header('Subject'),
    from: header('From'),
    to: header('To'),
    date: header('Date'),
    snippet: message.snippet,
    labelIds: message.labelIds,
    text,
    html,
    attachments,
  };
}

// Helper: compute Primary Inbox counts (total + unread) using Gmail API
async function computePrimaryInboxCounts(oauth2Client) {
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Get actual thread count by fetching more threads and using precise counting
  async function getActualCount(q, maxToCheck = 1000) {
    try {
      // For accurate counts, we need to actually fetch threads rather than rely on estimates
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

      // If there are more threads, fall back to estimate but log a warning
      const estimate = Number.isFinite(resp.data?.resultSizeEstimate) ? resp.data.resultSizeEstimate : threadCount;
      console.log(`📊 Using estimate for large mailbox: ${estimate} (checked ${threadCount} threads)`);
      return estimate;
    } catch (error) {
      console.error('Failed to get thread count:', error.message);
      return 0;
    }
  }

  const total = await getActualCount('category:primary');
  const unread = await getActualCount('category:primary is:unread');

  console.log(`📊 Gmail Primary stats: ${unread} unread / ${total} total`);
  return { total, unread };
}

router.get('/emails', requireAuth, async (req, res) => {
  try {
    const oauth2Client = await getGoogleOAuthClientFromCookies(req);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 2,
      labelIds: ['INBOX'],
      q: 'category:primary'
    });

    const messages = [];
    if (response.data.messages) {
      for (let msg of response.data.messages) {
        const fullMsg = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full'
        });

        const headers = fullMsg.data.payload.headers;
        const subject = headers.find(h => h.name === 'Subject')?.value;
        const from = headers.find(h => h.name === 'From')?.value;
        const to = headers.find(h => h.name === 'To')?.value;
        const date = headers.find(h => h.name === 'Date')?.value;

        let body = '';
        const payload = fullMsg.data.payload;
        if (payload.parts) {
          for (const part of payload.parts) {
            if (part.mimeType === 'text/plain' && part.body.data) {
              body = Buffer.from(part.body.data, 'base64').toString('utf-8');
              break;
            }
            if (part.mimeType === 'text/html' && part.body.data) {
              body = Buffer.from(part.body.data, 'base64').toString('utf-8');
              break;
            }
          }
        } else if (payload.body && payload.body.data) {
          body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
        }

        messages.push({
          id: msg.id,
          subject,
          from,
          to,
          date,
          snippet: fullMsg.data.snippet,
          body,
          labelIds: fullMsg.data.labelIds,
          threadId: fullMsg.data.threadId
        });
      }
    }

    res.json(messages);
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: 'Unable to access Gmail. Reconnect Google.' });
  }
});

  // Inbox stats: Primary category (category:primary) within INBOX - REAL-TIME with no caching
  router.get('/gmail/inbox-stats', requireAuth, async (req, res) => {
      try {
        const userId = String(req.auth?.sub);
        console.log(`📊 [INBOX-STATS] 🚀 Fetching REAL-TIME stats from Gmail API for user ${userId}`);

        // REAL-TIME: Always fetch fresh from Gmail API, no caching
        const oauth2Client = await getGoogleOAuthClientFromCookies(req);
        const freshStats = await computePrimaryInboxCounts(oauth2Client);

        console.log(`📊 [INBOX-STATS] ✅ Fresh Gmail stats: ${freshStats.unread} unread / ${freshStats.total} total`);

        // No caching, no Redis storage - just return fresh data immediately
        return res.json(freshStats);
    } catch (err) {
      console.error('❌ [INBOX-STATS] Real-time Gmail fetch failed:', err);
      return res.status(401).json({ error: 'Unable to access Gmail. Reconnect Google.' });
    }
  });

// Mark Gmail threads read/unread (batch)
router.post('/gmail/mark-read', requireAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const originalIds = Array.isArray(req.body?.originalIds) ? req.body.originalIds : ids;
    console.log(`📧 Gmail mark-read request received for ${ids.length} email(s):`, ids);
    console.log(`📧 Original message IDs for Socket.IO:`, originalIds);
    if (!ids.length) return res.status(400).json({ error: 'ids required' });
    const oauth2Client = await getGoogleOAuthClientFromCookies(req);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    let ok = 0;
    for (let i = 0; i < ids.length; i++) {
      let threadId = ids[i];
      const originalId = originalIds[i] || threadId;

      // CRITICAL FIX: Convert message ID to thread ID if needed
      // The frontend may send message IDs, but Gmail API requires thread IDs
      try {
        // First check if this is already a valid thread ID by trying to get the thread
        await gmail.users.threads.get({ userId: 'me', id: threadId, fields: 'id' });
        console.log(`✅ Valid thread ID confirmed: ${threadId}`);
      } catch (threadError) {
        if (threadError.status === 404) {
          console.log(`🔄 ID ${threadId} is not a valid thread ID, attempting to convert from message ID...`);

          try {
            // Try to get the message and extract its thread ID
            const messageResp = await gmail.users.messages.get({
              userId: 'me',
              id: threadId,
              fields: 'threadId'
            });

            if (messageResp.data.threadId) {
              const convertedThreadId = messageResp.data.threadId;
              console.log(`✅ Converted message ID ${threadId} to thread ID ${convertedThreadId}`);
              threadId = convertedThreadId;
            } else {
              throw new Error('No threadId found in message response');
            }
          } catch (messageError) {
            console.error(`❌ Failed to convert ${threadId} to thread ID:`, messageError.message);
            console.log(`⚠️ Skipping invalid ID ${threadId}`);
            continue; // Skip this invalid ID
          }
        } else {
          console.error(`❌ Unexpected error checking thread ID ${threadId}:`, threadError.message);
          continue; // Skip this ID
        }
      }

      try {
        const uid = String(req.auth?.sub);
        await readState.setOverride(uid, 'gmail', threadId, 'read');
        await readState.removeUnread(uid, 'gmail', threadId);
        // Notify UI instantly for the row; counts broadcast later using Primary-only stats
        try {
          // Use original message ID for unified broadcast so frontend can match properly
          unifiedBroadcast.emailUpdated(uid, { id: originalId, isRead: true, source: 'user_action' });
          console.log(`📧 Unified broadcast event sent for message ID ${originalId} (thread ${threadId})`);
        } catch (_) {}
        ok += 1;
        // background sync to provider
        setImmediate(async () => {
          try {
            console.log(`🔄 Syncing read state to Gmail for thread ${threadId}`);
            await gmail.users.threads.modify({ userId: 'me', id: threadId, requestBody: { removeLabelIds: ['UNREAD'] } });
            console.log(`✅ Successfully synced read state to Gmail for thread ${threadId}`);
            await readState.clearOverrideOnSuccess(uid, 'gmail', threadId, true);
          } catch (err) {
            if (err.status === 404 || err.code === 404) {
              console.warn(`⚠️ Thread ${threadId} not found in Gmail (404) - this can happen after read state changes. Treating as successful read update.`);
              // Thread may not be accessible anymore after read state change, but this is often normal Gmail behavior
              // Clear the override and treat as success since the frontend already shows the email as read
              await readState.clearOverrideOnSuccess(uid, 'gmail', threadId, true);
              // Invalidate any cached data for this thread
              try {
                await emailCache.invalidateThread(uid, 'gmail', threadId);
              } catch (_) {}
              // Don't notify frontend to delete the email - it should remain in the list as read
              console.log(`✅ Read state successfully updated for ${originalId} (Gmail API returned 404, but email remains in list as read)`);
            } else {
              console.error(`❌ Failed to sync read state for ${threadId}:`, {
                error: err.message,
                code: err.code,
                status: err.status,
                threadId: threadId,
                userId: uid
              });
              await readState.clearOverrideOnSuccess(uid, 'gmail', threadId, false);
            }
          }
        });
      } catch (_) {}
    }

    // Gmail Eventual Consistency: Handle user action with debounced broadcasting
    try {
      const userId = String(req.auth?.sub);
      console.log(`📊 [EventualConsistency] Handling mark-read action for ${ids.length} emails`);

      // This handles: action accumulation, debounced broadcasting, and race condition prevention
      await gmailEventualConsistencyManager.handleUserAction(userId, 'mark_read', ids.length);
    } catch (err) {
      console.error('❌ [EventualConsistency] Failed to handle user action:', err.message);
    }

    // Invalidate cache after marking emails as read (lists/threads) and clear stats cache
    {
      const userId = String(req.auth?.sub);
      try { await cache.del(`inbox:stats:gmail:${userId}`); } catch (_) {}
      await emailCache.invalidateOnAction(userId, 'gmail', 'mark_read', ids);
    }

    // Gmail Eventual Consistency: Use smart delayed resync instead of simple timeout
    // This handles the case where Gmail API count queries lag behind individual state changes
    const userId = String(req.auth?.sub);
    console.log(`🔄 [EventualConsistency] Triggering delayed resync for user ${userId} after mark-read action`);

    // The eventual consistency manager will:
    // 1. Wait 4 seconds for Gmail to catch up
    // 2. Query fresh counts from Gmail API
    // 3. Smart merge with local counts to prevent stale overwrites
    // 4. Only broadcast if counts actually changed
    setImmediate(async () => {
      try {
        await gmailEventualConsistencyManager.handlePubSubNotification(userId, null, [
          { type: 'user_action', action: 'mark_read', count: ids.length }
        ]);
      } catch (err) {
        console.error('❌ [EventualConsistency] Failed to handle user action:', err.message);
      }
    });

    // Return REAL-TIME count update from Gmail API
    try {
      const oauth2Client = await getGoogleOAuthClientFromCookies(req);
      const freshStats = await computePrimaryInboxCounts(oauth2Client);
      console.log(`📊 [MARK-READ] Fresh Gmail counts after action: ${freshStats.unread} unread / ${freshStats.total} total`);

      return res.json({
        ok,
        total: ids.length,
        newCounts: {
          unread: freshStats.unread,
          total: freshStats.total
        }
      });
    } catch (_) {
      return res.json({ ok, total: ids.length });
    }
  } catch (e) {
    console.error('gmail/mark-read failed:', e);
    return res.status(401).json({ error: 'Unable to mark Gmail threads as read' });
  }
});

// Spam stats (Gmail): threads in SPAM label
router.get('/gmail/spam-stats', requireAuth, async (req, res) => {
  try {
    const userId = String(req.auth?.sub);
    const key = `spam:stats:gmail:${userId}`;
    const value = await cache.wrap(key, 45_000, async () => {
      const oauth2Client = await getGoogleOAuthClientFromCookies(req);
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const label = await gmail.users.labels.get({ userId: 'me', id: 'SPAM' });
      const data = label.data || {};
      const total = Number.isFinite(data.threadsTotal) ? data.threadsTotal : data.messagesTotal || 0;
      const unread = Number.isFinite(data.threadsUnread) ? data.threadsUnread : data.messagesUnread || 0;
      return { total, unread };
    });
    return res.json(value);
  } catch (err) {
    console.error(err);
    return res.status(401).json({ error: 'Unable to access Gmail spam stats' });
  }
});

router.post('/gmail/mark-unread', requireAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    console.log(`📧 Gmail mark-unread request received for ${ids.length} email(s):`, ids);
    if (!ids.length) return res.status(400).json({ error: 'ids required' });
    const oauth2Client = await getGoogleOAuthClientFromCookies(req);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    let ok = 0;
    for (const id of ids) {
      try {
        const uid = String(req.auth?.sub);
        await readState.setOverride(uid, 'gmail', id, 'unread');
        await readState.addUnread(uid, 'gmail', id);
        try {
          unifiedBroadcast.emailUpdated(uid, { id, isRead: false, source: 'user_action' });
        } catch (_) {}
        ok += 1;
        setImmediate(async () => {
          try {
            console.log(`🔄 Syncing unread state to Gmail for thread ${id}`);
            await gmail.users.threads.modify({ userId: 'me', id, requestBody: { addLabelIds: ['UNREAD'] } });
            console.log(`✅ Successfully synced unread state to Gmail for thread ${id}`);
            await readState.clearOverrideOnSuccess(uid, 'gmail', id, true);
          } catch (err) {
            if (err.status === 404 || err.code === 404) {
              console.warn(`⚠️ Thread ${id} not found in Gmail (404) - thread may have been deleted. Clearing override.`);
              // Thread doesn't exist anymore, clear the override and treat as success
              await readState.clearOverrideOnSuccess(uid, 'gmail', id, true);
              // Invalidate any cached data for this thread
              try {
                await emailCache.invalidateThread(uid, 'gmail', id);
              } catch (_) {}
            } else {
              console.error(`❌ Failed to sync unread state for ${id}:`, {
                error: err.message,
                code: err.code,
                status: err.status,
                threadId: id,
                userId: uid
              });
              await readState.clearOverrideOnSuccess(uid, 'gmail', id, false);
            }
          }
        });
      } catch (_) {}
    }
    // Invalidate cache after marking emails as unread (lists/threads) and clear stats cache
    {
      const userId = String(req.auth?.sub);
      try { await cache.del(`inbox:stats:gmail:${userId}`); } catch (_) {}
      await emailCache.invalidateOnAction(userId, 'gmail', 'mark_unread', ids);
    }

    // Gmail Eventual Consistency: Handle user action with debounced broadcasting
    try {
      const userId = String(req.auth?.sub);
      console.log(`📊 [EventualConsistency] Handling mark-unread action for ${ids.length} emails`);

      // This handles: action accumulation, debounced broadcasting, and race condition prevention
      await gmailEventualConsistencyManager.handleUserAction(userId, 'mark_unread', ids.length);
    } catch (err) {
      console.error('❌ [EventualConsistency] Failed to handle user action:', err.message);
    }

    // Gmail Eventual Consistency: Use smart delayed resync instead of simple timeout
    const userId = String(req.auth?.sub);
    console.log(`🔄 [EventualConsistency] Triggering delayed resync for user ${userId} after mark-unread action`);

    setImmediate(async () => {
      try {
        await gmailEventualConsistencyManager.handlePubSubNotification(userId, null, [
          { type: 'user_action', action: 'mark_unread', count: ids.length }
        ]);
      } catch (err) {
        console.error('❌ [EventualConsistency] Failed to handle user action:', err.message);
      }
    });

    // Return REAL-TIME count update from Gmail API
    try {
      const oauth2Client = await getGoogleOAuthClientFromCookies(req);
      const freshStats = await computePrimaryInboxCounts(oauth2Client);
      console.log(`📊 [MARK-UNREAD] Fresh Gmail counts after action: ${freshStats.unread} unread / ${freshStats.total} total`);

      return res.json({
        ok,
        total: ids.length,
        newCounts: {
          unread: freshStats.unread,
          total: freshStats.total
        }
      });
    } catch (_) {
      return res.json({ ok, total: ids.length });
    }
  } catch (e) {
    console.error('gmail/mark-unread failed:', e);
    return res.status(401).json({ error: 'Unable to mark Gmail threads as unread' });
  }
});

// Move Gmail threads to Trash (delete)
router.post('/gmail/trash', requireAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: 'ids required' });
    const oauth2Client = await getGoogleOAuthClientFromCookies(req);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const uid = String(req.auth?.sub);
    let ok = 0;
    for (const id of ids) {
      try {
        await gmail.users.threads.trash({ userId: 'me', id });
        await readState.removeUnread(uid, 'gmail', id);
        ok += 1;
      } catch (_) {}
    }
    // Invalidate cache for lists/threads and clear stats cache; broadcast row deletion
    try {
      try { await cache.del(`inbox:stats:gmail:${uid}`); } catch (_) {}
      await emailCache.invalidateOnAction(uid, 'gmail', 'delete', ids);
      // Note: Socket.IO service doesn't have emailDeleted method yet, using emailUpdated
    } catch (_) {}

    // Instant Redis-backed update: decrement total quickly, then background resync
    try {
      const cur = (await emailCache.getUserStats(uid, 'gmail')) || null;
      if (cur) {
        const next = { ...cur, total: Math.max(0, (cur.total || 0) - ids.length) };
        await emailCache.setUserStats(uid, 'gmail', next);
        broadcastToUser(uid, { type: 'unread_count_updated', unread: next.unread, total: next.total });
      }
    } catch (_) {}

    setImmediate(async () => {
      try {
        const oauth2Client2 = await getGoogleOAuthClientFromCookies(req);
        const stats = await computePrimaryInboxCounts(oauth2Client2);
        await emailCache.setUserStats(uid, 'gmail', stats);
        broadcastToUser(uid, { type: 'unread_count_updated', unread: stats.unread, total: stats.total });
      } catch (_) {}
    });
    return res.json({ ok, total: ids.length });
  } catch (e) {
    console.error('gmail/trash failed:', e);
    return res.status(401).json({ error: 'Unable to move to trash' });
  }
});

// Simple concurrency-limited mapper
async function mapWithLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await mapper(items[i], i);
    }
  }
  const workers = Array(Math.min(limit, items.length)).fill(0).map(() => worker());
  await Promise.all(workers);
  return results;
}

// List INBOX threads: latest message metadata only
router.get('/threads', requireAuth, async (req, res) => {
  try {
    // Ensure browser does not cache inbox list responses
    res.set('Cache-Control', 'no-store');
    const userId = String(req.auth?.sub);
    const maxResults = Math.min(parseInt(req.query.maxResults || '20', 10), 50);
    const pageToken = req.query.pageToken || undefined;
    const unread = String(req.query.unread || 'false') === 'true';
    const q = req.query.q || undefined;

    // Create cache key based on request parameters
    const cacheKey = `${maxResults}:${pageToken || 'first'}:${unread}:${q || 'all'}`;

    // Skip server-side inbox list cache to avoid stale lists; rely on realtime updates

    console.log('🔄 Fetching inbox from Gmail API');
    const oauth2Client = await getGoogleOAuthClientFromCookies(req);
    const gmail = google.gmail({
      version: 'v1', auth: oauth2Client
    });

    // Select label filter and query based on folder
    let labelIds = [];
    let queryParam = q || '';
    const qStr = (q || '').toLowerCase();

    if (qStr.includes('in:trash')) {
      labelIds = ['TRASH'];
    } else if (qStr.includes('in:spam')) {
      labelIds = ['SPAM'];
    } else if (qStr.includes('in:archive')) {
      // archive => messages without INBOX
      labelIds = [];
      queryParam = queryParam + ' in:archive';
    } else {
      // default Inbox Primary - use query parameter instead of CATEGORY_PERSONAL label
      labelIds = ['INBOX'];
      if (!q) {
        queryParam = 'category:primary';
      } else {
        queryParam = q + ' category:primary';
      }
    }

    if (unread) {
      if (queryParam) {
        queryParam += ' is:unread';
      } else {
        queryParam = 'is:unread';
      }
    }

    const listResp = await gmail.users.threads.list({
      userId: 'me',
      maxResults,
      labelIds: labelIds.length ? labelIds : undefined,
      pageToken,
      q: queryParam || undefined,
      // include resultSizeEstimate for totals
      fields: 'nextPageToken,threads/id,resultSizeEstimate'
    });

    const ids = (listResp.data.threads || []).map(t => t.id);
    const details = await mapWithLimit(ids, 8, async (id) => {
      const t = await gmail.users.threads.get({
        userId: 'me',
        id,
        fields: 'id,messages(id,labelIds,payload/headers(name,value),snippet)'
      });
      const msgs = t.data.messages || [];
      const latest = msgs[msgs.length - 1];
      // Determine original sender: earliest inbound message (not SENT), fallback to first
      const firstInbound = msgs.find(m => !(m.labelIds || []).includes('SENT')) || msgs[0];
      const originHeaders = firstInbound?.payload?.headers || [];
      const originFrom = headerValue(originHeaders, 'From');
      const latestHeaders = latest?.payload?.headers || [];
      const latestFrom = headerValue(latestHeaders, 'From');
      return latest ? {
        threadId: t.data.id,
        id: latest.id,
        subject: headerValue(latestHeaders, 'Subject'),
        // For backward compatibility, set from to origin sender and also expose both fields
        from: originFrom,
        originFrom,
        latestFrom,
        to: headerValue(latestHeaders, 'To'),
        date: headerValue(latestHeaders, 'Date'),
        snippet: latest.snippet,
        labelIds: latest.labelIds,
        isUnread: (latest.labelIds || []).includes('UNREAD')
      } : null;
    });

    // Apply local overrides (instant read/unread via Redis)
    const adjusted = await Promise.all((details || []).map(async (item) => {
      if (!item) return null;
      const ov = await readState.getOverride(userId, 'gmail', item.threadId);
      if (ov === 'read') item.isUnread = false;
      if (ov === 'unread') item.isUnread = true;
      return item;
    }));

    const response = {
      nextPageToken: listResp.data.nextPageToken || null,
      threads: adjusted.filter(Boolean),
      total: typeof listResp.data.resultSizeEstimate === 'number' ? listResp.data.resultSizeEstimate : undefined
    };

    // Do not cache inbox responses to ensure immediate freshness

    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: 'Unable to access Gmail. Reconnect Google.' });
  }
});

// Sent threads list: latest message metadata only
router.get('/threads/sent', requireAuth, async (req, res) => {
  try {
    const oauth2Client = await getGoogleOAuthClientFromCookies(req);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const maxResults = Math.min(parseInt(req.query.maxResults || '20', 10), 50);
    const pageToken = req.query.pageToken || undefined;
    const unread = String(req.query.unread || 'false') === 'true';
    const q = req.query.q || undefined;

    const labelIds = ['SENT'];
    if (unread) labelIds.push('UNREAD');

    const listResp = await gmail.users.threads.list({
      userId: 'me',
      maxResults,
      labelIds,
      pageToken,
      q,
      fields: 'nextPageToken,threads/id,resultSizeEstimate'
    });

    const ids = (listResp.data.threads || []).map(t => t.id);
    const details = await mapWithLimit(ids, 8, async (id) => {
      const t = await gmail.users.threads.get({
        userId: 'me',
        id,
        fields: 'id,messages(id,labelIds,payload/headers(name,value),snippet)'
      });
      const msgs = t.data.messages || [];
      const latest = msgs[msgs.length - 1];
      const headers = latest?.payload?.headers || [];
      return latest ? {
        threadId: t.data.id,
        id: latest.id,
        subject: headerValue(headers, 'Subject'),
        from: headerValue(headers, 'From'),
        to: headerValue(headers, 'To'),
        date: headerValue(headers, 'Date'),
        snippet: latest.snippet,
        labelIds: latest.labelIds,
        isUnread: (latest.labelIds || []).includes('UNREAD')
      } : null;
    });

    res.json({
      nextPageToken: listResp.data.nextPageToken || null,
      threads: details.filter(Boolean),
      total: typeof listResp.data.resultSizeEstimate === 'number' ? listResp.data.resultSizeEstimate : undefined
    });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: 'Unable to access Gmail. Reconnect Google.' });
  }
});

// Thread details with optional attachments
router.get('/threads/:id', requireAuth, async (req, res) => {
  try {
    const userId = String(req.auth?.sub);
    const threadId = req.params.id;
    const includeAttachments = String(req.query.includeAttachments || 'true') === 'true';

    // Try to get from cache first
    const cached = await emailCache.getThread(userId, 'gmail', threadId);
    if (cached) {
      console.log('📦 Serving thread from cache');
      return res.json(cached);
    }

    console.log('🔄 Fetching thread from Gmail API');
    const oauth2Client = await getGoogleOAuthClientFromCookies(req);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const t = await gmail.users.threads.get({
      userId: 'me',
      id: req.params.id,
      format: 'full',
      // Corrected fields selector: nest header subfields under headers(...),
      // and include mimeType + recursive part fields for attachment parsing.
      fields:
        'id,' +
        'messages(' +
          'id,threadId,labelIds,snippet,' +
          'payload(' +
            'headers(name,value),' +
            'mimeType,filename,' +
            'body(attachmentId,data,size),' +
            'parts(' +
              'filename,mimeType,' +
              'headers(name,value),' +
              'body(attachmentId,data,size),' +
              'parts' +
            ')' +
          ')' +
        ')'
    });

    const out = [];
    for (const m of t.data.messages || []) {
      // eslint-disable-next-line no-await-in-loop
      const parsed = await extractMessage(gmail, m, { includeAttachments });
      out.push(parsed);
    }

    const response = { threadId: t.data.id, messages: out };

    // Cache the thread response
    await emailCache.setThread(userId, 'gmail', threadId, response);
    console.log('💾 Cached thread response');

    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: 'Unable to access Gmail. Reconnect Google.' });
  }
});

// Drafts list: latest metadata only
router.get('/drafts', requireAuth, async (req, res) => {
  try {
    const oauth2Client = await getGoogleOAuthClientFromCookies(req);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const maxResults = Math.min(parseInt(req.query.maxResults || '20', 10), 50);
    const pageToken = req.query.pageToken || undefined;

    const listResp = await gmail.users.drafts.list({
      userId: 'me',
      maxResults,
      pageToken,
      fields: 'nextPageToken,drafts/id,drafts/message/id'
    });

    const ids = (listResp.data.drafts || []).map(d => d.id);
    const details = await mapWithLimit(ids, 8, async (id) => {
      const d = await gmail.users.drafts.get({
        userId: 'me',
        id,
        fields: 'id,message(id,labelIds,payload/headers(name,value),snippet)'
      });
      const m = d.data.message || {};
      const headers = m?.payload?.headers || [];
      return {
        draftId: d.data.id,
        id: m.id,
        subject: headerValue(headers, 'Subject'),
        from: headerValue(headers, 'From'),
        to: headerValue(headers, 'To'),
        date: headerValue(headers, 'Date'),
        snippet: m.snippet,
        labelIds: m.labelIds,
      };
    });

    res.json({
      nextPageToken: listResp.data.nextPageToken || null,
      drafts: details.filter(Boolean)
    });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: 'Unable to access Gmail. Reconnect Google.' });
  }
});

// Draft details with optional attachments
router.get('/drafts/:id', requireAuth, async (req, res) => {
  try {
    const includeAttachments = String(req.query.includeAttachments || 'false') === 'true';
    const oauth2Client = await getGoogleOAuthClientFromCookies(req);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const d = await gmail.users.drafts.get({
      userId: 'me',
      id: req.params.id,
      fields: 'id,message(id,labelIds,payload(headers,name,value,filename,body/attachmentId,body/data,body/size,parts),snippet,threadId)'
    });

    const parsed = await extractMessage(gmail, d.data.message, { includeAttachments });
    res.json({ draftId: d.data.id, message: parsed });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: 'Unable to access Gmail. Reconnect Google.' });
  }
});

// Test endpoint to simulate new email arrival (for development/testing)
router.post('/test/simulate-new-email', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id || 1; // Get user ID from session

    // Create a mock email object with proper structure
    const mockEmail = {
      id: `test_${Date.now()}`,
      threadId: `thread_${Date.now()}`,
      subject: 'Test New Email Arrival',
      from: 'Test Sender <test@example.com>',
      to: req.user?.email || 'user@example.com',
      date: new Date().toISOString(),
      time: new Date().toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }),
      isRead: false, // New emails are unread
      isStarred: false,
      snippet: 'This is a test email to simulate new email arrival functionality.',
      preview: 'This is a test email to simulate new email arrival functionality.',
      labels: ['new'],
      hasAttachment: false
    };

    console.log(`🧪 Simulating new email arrival for user ${userId}`);

    // Broadcast new email via Socket.IO
    socketIOService.newEmail(userId, mockEmail);

    // Also update counts
    socketIOService.countUpdated(userId, {
      unread: 999, // Use a test number
      total: 9999
    }, 'test_simulation');

    res.json({
      success: true,
      message: 'New email arrival simulated',
      email: mockEmail
    });

  } catch (err) {
    console.error('Error simulating new email:', err);
    res.status(500).json({ error: 'Failed to simulate new email' });
  }
});

// Import link sanitizer
const { sanitizeLinks } = require('../lib/linkSanitizer');

// Simple email content endpoint for EmailContent component
router.get('/emails/:emailId/content', requireAuth, async (req, res) => {
  try {
    const { emailId } = req.params;
    console.log(`📧 EMAIL CONTENT REQUEST RECEIVED for: ${emailId}`);
    console.log(`📧 Request URL: ${req.originalUrl}`);
    console.log(`📧 Request headers:`, req.headers);

    // Get Gmail OAuth client
    const oauth2Client = await getGoogleOAuthClientFromCookies(req);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Fetch the email message
    const response = await gmail.users.messages.get({
      userId: 'me',
      id: emailId
    });

    const message = response.data;
    if (!message) {
      return res.status(404).json({ error: 'Email not found' });
    }

    // Extract email content using existing helper
    const extracted = await extractMessage(gmail, message, { includeAttachments: true });

    const headers = message.payload.headers || [];
    const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;

    // Create a simple HTML srcDoc from the content
    let htmlContent = extracted.html || extracted.text || 'No content available';

    // If it's plain text, convert to HTML
    if (!extracted.html && extracted.text) {
      htmlContent = '<pre style="font-family: Arial, sans-serif; white-space: pre-wrap; word-wrap: break-word;">' + extracted.text + '</pre>';
    }

    // Sanitize all links for security
    console.log('🔒 Sanitizing links in email content...');
    htmlContent = sanitizeLinks(htmlContent);

    // Basic HTML document for iframe
    const srcDoc = '<!DOCTYPE html>' +
      '<html>' +
      '<head>' +
      '<meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<style>' +
      'body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }' +
      'img { max-width: 100%; height: auto; }' +
      'a { color: #0066cc; text-decoration: underline; }' +
      'a:hover { color: #004499; }' +
      '.link-warning-low { border-bottom: 2px dotted #ffc107; }' +
      '.link-warning-medium { border-bottom: 2px dotted #fd7e14; background-color: #fff3cd; }' +
      '.link-warning-high { border-bottom: 2px dotted #dc3545; background-color: #f8d7da; color: #721c24; }' +
      '.link-warning-low:hover, .link-warning-medium:hover, .link-warning-high:hover { opacity: 0.8; }' +
      '</style>' +
      '<script>' +
      'document.addEventListener("DOMContentLoaded", function() {' +
      '  document.addEventListener("click", function(e) {' +
      '    if (e.target.tagName === "A" || e.target.closest("a")) {' +
      '      e.preventDefault();' +
      '      const link = e.target.tagName === "A" ? e.target : e.target.closest("a");' +
      '      if (link && link.href) {' +
      '        window.parent.open(link.href, "_blank", "noopener,noreferrer");' +
      '      }' +
      '    }' +
      '  });' +
      '});' +
      '</script>' +
      '</head>' +
      '<body>' +
      htmlContent +
      '</body>' +
      '</html>';

    // Return data in format expected by EmailContent component
    const jsonResponse = {
      id: emailId,
      subject: getHeader('Subject') || 'No Subject',
      from: {
        name: '',
        email: getHeader('From') || ''
      },
      to: [],
      cc: [],
      bcc: [],
      date: getHeader('Date') || new Date().toISOString(),
      hasHtml: !!extracted.html,
      srcDoc,
      textFallback: extracted.text || 'No text content',
      inlineCidCount: 0,
      attachments: extracted.attachments || []
    };

    console.log(`📧 Sending JSON response for ${emailId}:`, {
      subject: jsonResponse.subject,
      hasHtml: jsonResponse.hasHtml,
      responseSize: JSON.stringify(jsonResponse).length
    });

    res.json(jsonResponse);

  } catch (error) {
    console.error('❌ Failed to fetch email content:', error);
    res.status(500).json({
      error: 'Failed to fetch email content',
      details: error.message
    });
  }
});

// ====================================================================
// V2 API ENDPOINTS - Redis-based Optimistic Updates with Retry Logic
// ====================================================================

// Check if V2 is enabled
function isV2Enabled() {
  return process.env.REALTIME_SYNC_V2 === 'true';
}

// V2: Mark messages as read
router.post('/api/gmail/messages/:id/mark-read', requireAuth, async (req, res) => {
  if (!isV2Enabled()) {
    return res.status(404).json({ error: 'V2 API not enabled' });
  }

  try {
    const { id } = req.params;
    const userId = String(req.auth?.sub);

    console.log(`🚀 [V2] Mark read request for message ${id} by user ${userId}`);

    // Use V2 Gmail Event Manager
    await gmailEventualConsistencyManager.handleUserActionV2(userId, 'mark_read', [id]);

    res.json({ success: true });
  } catch (error) {
    console.error('❌ [V2] Mark read failed:', error);
    res.status(500).json({ error: 'Failed to mark message as read' });
  }
});

// V2: Mark messages as unread
router.post('/api/gmail/messages/:id/mark-unread', requireAuth, async (req, res) => {
  if (!isV2Enabled()) {
    return res.status(404).json({ error: 'V2 API not enabled' });
  }

  try {
    const { id } = req.params;
    const userId = String(req.auth?.sub);

    console.log(`🚀 [V2] Mark unread request for message ${id} by user ${userId}`);

    // Use V2 Gmail Event Manager
    await gmailEventualConsistencyManager.handleUserActionV2(userId, 'mark_unread', [id]);

    res.json({ success: true });
  } catch (error) {
    console.error('❌ [V2] Mark unread failed:', error);
    res.status(500).json({ error: 'Failed to mark message as unread' });
  }
});

// V2: Delete messages
router.delete('/api/gmail/messages/:id', requireAuth, async (req, res) => {
  if (!isV2Enabled()) {
    return res.status(404).json({ error: 'V2 API not enabled' });
  }

  try {
    const { id } = req.params;
    const userId = String(req.auth?.sub);

    console.log(`🚀 [V2] Delete request for message ${id} by user ${userId}`);

    // Use V2 Gmail Event Manager
    await gmailEventualConsistencyManager.handleUserActionV2(userId, 'delete', [id]);

    res.json({ success: true });
  } catch (error) {
    console.error('❌ [V2] Delete failed:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// V2: Batch email actions
router.post('/api/gmail/batch-actions', requireAuth, async (req, res) => {
  if (!isV2Enabled()) {
    return res.status(404).json({ error: 'V2 API not enabled' });
  }

  try {
    const { action, messageIds } = req.body;
    const userId = String(req.auth?.sub);

    if (!action || !Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: 'action and messageIds are required' });
    }

    console.log(`🚀 [V2] Batch ${action} request for ${messageIds.length} messages by user ${userId}`);

    // Use V2 Gmail Event Manager
    await gmailEventualConsistencyManager.handleUserActionV2(userId, action, messageIds);

    res.json({ success: true, processed: messageIds.length });
  } catch (error) {
    console.error('❌ [V2] Batch action failed:', error);
    res.status(500).json({ error: 'Failed to perform batch action' });
  }
});

// V2: Get Gmail health status
router.get('/api/gmail/health', requireAuth, async (req, res) => {
  if (!isV2Enabled()) {
    return res.status(404).json({ error: 'V2 API not enabled' });
  }

  try {
    const userId = String(req.auth?.sub);

    const [gmailHealth, managerStats, cacheHealth] = await Promise.all([
      gmailApiHelpers.healthCheck(userId).catch(e => ({ healthy: false, error: e.message })),
      Promise.resolve(gmailEventualConsistencyManager.getStats()),
      require('../lib/cache/mailboxCache').getHealth().catch(e => ({ healthy: false, error: e.message }))
    ]);

    res.json({
      timestamp: new Date().toISOString(),
      v2Enabled: true,
      gmail: gmailHealth,
      eventManager: managerStats,
      cache: cacheHealth
    });
  } catch (error) {
    console.error('❌ [V2] Health check failed:', error);
    res.status(500).json({ error: 'Health check failed' });
  }
});

// V2: Manual reconciliation trigger (admin/dev only)
router.post('/api/gmail/reconcile', requireAuth, async (req, res) => {
  if (!isV2Enabled()) {
    return res.status(404).json({ error: 'V2 API not enabled' });
  }

  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }

  try {
    const userId = String(req.auth?.sub);
    const reconciler = require('../jobs/reconcileGmail');

    const result = await reconciler.reconcileUserById(userId);
    res.json(result);
  } catch (error) {
    console.error('❌ [V2] Manual reconciliation failed:', error);
    res.status(500).json({ error: 'Manual reconciliation failed' });
  }
});

// V2: Initialize user cache (admin/dev only)
router.post('/api/gmail/init-cache', requireAuth, async (req, res) => {
  if (!isV2Enabled()) {
    return res.status(404).json({ error: 'V2 API not enabled' });
  }

  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }

  try {
    const userId = String(req.auth?.sub);

    await gmailEventualConsistencyManager.initializeUserCacheV2(userId);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ [V2] Cache initialization failed:', error);
    res.status(500).json({ error: 'Cache initialization failed' });
  }
});

module.exports = router;
