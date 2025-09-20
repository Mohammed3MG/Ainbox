const express = require('express');
const { google } = require('googleapis');
const { requireAuth } = require('../middleware/auth');
const { getGoogleOAuthClientFromCookies } = require('../utils/googleClient');
const cache = require('../lib/cache');
const emailCache = require('../lib/emailCache');
const socketIOService = require('../lib/socketio');
const gmailSync = require('../lib/gmailSync');
const readState = require('../lib/readState');

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
      labelIds: ['INBOX', 'CATEGORY_PERSONAL']
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

  // Inbox stats: Primary category (category:primary) within INBOX
  router.get('/gmail/inbox-stats', requireAuth, async (req, res) => {
      try {
        const userId = String(req.auth?.sub);
        const key = `inbox:stats:gmail:${userId}`;
        const value = await cache.wrap(key, 45_000, async () => {
          const oauth2Client = await getGoogleOAuthClientFromCookies(req);
          return computePrimaryInboxCounts(oauth2Client);
        });
        // Persist latest stats to Redis-backed user stats cache for instant updates
        try { await emailCache.setUserStats(userId, 'gmail', value); } catch (_) {}

      // Auto-start Gmail sync for this user when they access Gmail stats
      const syncStatus = gmailSync.getSyncStatus(userId);
      if (!syncStatus.active) {
        console.log(`🚀 Auto-starting Gmail sync for user ${userId}`);
        gmailSync.startSyncForUser(userId, req.cookies).catch(err => {
          console.error('Auto-start Gmail sync failed:', err.message);
        });
      }

      return res.json(value);
    } catch (err) {
      console.error(err);
      return res.status(401).json({ error: 'Unable to access Gmail. Reconnect Google.' });
    }
  });

// Mark Gmail threads read/unread (batch)
router.post('/gmail/mark-read', requireAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: 'ids required' });
    const oauth2Client = await getGoogleOAuthClientFromCookies(req);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    let ok = 0;
    for (const id of ids) {
      try {
        const uid = String(req.auth?.sub);
        await readState.setOverride(uid, 'gmail', id, 'read');
        await readState.removeUnread(uid, 'gmail', id);
        // Notify UI instantly for the row; counts broadcast later using Primary-only stats
        try {
          socketIOService.emailUpdated(uid, { id, isRead: true, source: 'user_action' });
        } catch (_) {}
        ok += 1;
        // background sync to provider
        setImmediate(async () => {
          try {
            await gmail.users.threads.modify({ userId: 'me', id, requestBody: { removeLabelIds: ['UNREAD'] } });
            await readState.clearOverrideOnSuccess(uid, 'gmail', id, true);
          } catch (err) {
            console.log(`❌ Failed to sync read state for ${id}, keeping override:`, err.message);
            await readState.clearOverrideOnSuccess(uid, 'gmail', id, false);
          }
        });
      } catch (_) {}
    }
    // Invalidate cache after marking emails as read (lists/threads) and clear stats cache
    {
      const userId = String(req.auth?.sub);
      try { await cache.del(`inbox:stats:gmail:${userId}`); } catch (_) {}
      await emailCache.invalidateOnAction(userId, 'gmail', 'mark_read', ids);
    }

    // Instant Redis-backed update: decrement unread quickly, then background resync
    try {
      const userId = String(req.auth?.sub);
      const cur = (await emailCache.getUserStats(userId, 'gmail')) || null;
      if (cur) {
        const next = { ...cur, unread: Math.max(0, (cur.unread || 0) - ids.length) };
        await emailCache.setUserStats(userId, 'gmail', next);
        socketIOService.countUpdated(userId, { unread: next.unread, total: next.total }, 'user_action');
      }
    } catch (_) {}

    // Background resync to accurate Primary-only counts
    setImmediate(async () => {
      try {
        const userId = String(req.auth?.sub);
        const oauth2Client2 = await getGoogleOAuthClientFromCookies(req);
        const stats = await computePrimaryInboxCounts(oauth2Client2);
        await emailCache.setUserStats(userId, 'gmail', stats);
        socketIOService.countUpdated(userId, { unread: stats.unread, total: stats.total }, 'user_action');
      } catch (_) {}
    });

    // Return immediate count update to frontend
    try {
      const userId = String(req.auth?.sub);
      const currentStats = (await emailCache.getUserStats(userId, 'gmail')) || { unread: 0, total: 0 };
      return res.json({
        ok,
        total: ids.length,
        newCounts: {
          unread: currentStats.unread,
          total: currentStats.total
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
          socketIOService.emailUpdated(uid, { id, isRead: false, source: 'user_action' });
        } catch (_) {}
        ok += 1;
        setImmediate(async () => {
          try {
            await gmail.users.threads.modify({ userId: 'me', id, requestBody: { addLabelIds: ['UNREAD'] } });
            await readState.clearOverrideOnSuccess(uid, 'gmail', id, true);
          } catch (err) {
            console.log(`❌ Failed to sync unread state for ${id}, keeping override:`, err.message);
            await readState.clearOverrideOnSuccess(uid, 'gmail', id, false);
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

    // Instant Redis-backed update: increment unread quickly, then background resync
    try {
      const userId = String(req.auth?.sub);
      const cur = (await emailCache.getUserStats(userId, 'gmail')) || null;
      if (cur) {
        const next = { ...cur, unread: Math.max(0, (cur.unread || 0) + ids.length) };
        await emailCache.setUserStats(userId, 'gmail', next);
        socketIOService.countUpdated(userId, { unread: next.unread, total: next.total }, 'user_action');
      }
    } catch (_) {}

    // Background resync to accurate Primary-only counts
    setImmediate(async () => {
      try {
        const userId = String(req.auth?.sub);
        const oauth2Client2 = await getGoogleOAuthClientFromCookies(req);
        const stats = await computePrimaryInboxCounts(oauth2Client2);
        await emailCache.setUserStats(userId, 'gmail', stats);
        socketIOService.countUpdated(userId, { unread: stats.unread, total: stats.total }, 'user_action');
      } catch (_) {}
    });

    // Return immediate count update to frontend
    try {
      const userId = String(req.auth?.sub);
      const currentStats = (await emailCache.getUserStats(userId, 'gmail')) || { unread: 0, total: 0 };
      return res.json({
        ok,
        total: ids.length,
        newCounts: {
          unread: currentStats.unread,
          total: currentStats.total
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
    const userId = String(req.auth?.sub);
    const maxResults = Math.min(parseInt(req.query.maxResults || '20', 10), 50);
    const pageToken = req.query.pageToken || undefined;
    const unread = String(req.query.unread || 'false') === 'true';
    const q = req.query.q || undefined;

    // Create cache key based on request parameters
    const cacheKey = `${maxResults}:${pageToken || 'first'}:${unread}:${q || 'all'}`;

    // Try to get from cache first (skip cache for search queries)
    if (!q) {
      const cached = await emailCache.getInbox(userId, 'gmail', 'inbox', cacheKey);
      if (cached) {
        console.log('📦 Serving inbox from cache');
        // Apply local overrides to cached threads so UI reflects instant state
        const adjustedThreads = await Promise.all((cached.threads || []).map(async (item) => {
          if (!item) return null;
          try {
            const ov = await readState.getOverride(userId, 'gmail', item.threadId);
            if (ov === 'read') return { ...item, isUnread: false };
            if (ov === 'unread') return { ...item, isUnread: true };
            return item;
          } catch (_) {
            return item;
          }
        }));
        const adjusted = { ...cached, threads: adjustedThreads.filter(Boolean) };
        return res.json(adjusted);
      }
    }

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

    // Cache the response (skip search queries)
    if (!q) {
      await emailCache.setInbox(userId, 'gmail', 'inbox', cacheKey, response);
      console.log('💾 Cached inbox response');
    }

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

module.exports = router;
