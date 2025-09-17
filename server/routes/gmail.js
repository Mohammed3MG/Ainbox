const express = require('express');
const { google } = require('googleapis');
const { requireAuth } = require('../middleware/auth');
const { getGoogleOAuthClientFromCookies } = require('../utils/googleClient');
const cache = require('../lib/cache');
const { broadcastToUser } = require('../lib/sse');

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

    // Handle inline text/html
    if (mime === 'text/plain' && body.data) {
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

router.get('/emails', requireAuth, async (req, res) => {
  try {
    const oauth2Client = await getGoogleOAuthClientFromCookies(req);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 2,
      labelIds: ['INBOX']
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

// Inbox stats: total + unread counts via label
router.get('/gmail/inbox-stats', requireAuth, async (req, res) => {
  try {
    const userId = String(req.auth?.sub);
    const key = `inbox:stats:gmail:${userId}`;
    const value = await cache.wrap(key, 45_000, async () => {
      const oauth2Client = await getGoogleOAuthClientFromCookies(req);
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const label = await gmail.users.labels.get({ userId: 'me', id: 'INBOX' });
      const data = label.data || {};
      const threadsTotal = Number.isFinite(data.threadsTotal) ? data.threadsTotal : data.messagesTotal || 0;
      const threadsUnread = Number.isFinite(data.threadsUnread) ? data.threadsUnread : data.messagesUnread || 0;
      return { total: threadsTotal, unread: threadsUnread };
    });
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
        // Remove UNREAD label across the whole thread
        await gmail.users.threads.modify({
          userId: 'me',
          id,
          requestBody: { removeLabelIds: ['UNREAD'] }
        });
        ok += 1;
      } catch (_) {}
    }
    // Invalidate cache, broadcast updated counts
    try {
      const userId = String(req.auth?.sub);
      cache.del(`inbox:stats:gmail:${userId}`);
      const oauth2Client2 = await getGoogleOAuthClientFromCookies(req);
      const gmail2 = google.gmail({ version: 'v1', auth: oauth2Client2 });
      const label = await gmail2.users.labels.get({ userId: 'me', id: 'INBOX' });
      const d = label.data || {};
      const threadsTotal = Number.isFinite(d.threadsTotal) ? d.threadsTotal : d.messagesTotal || 0;
      const threadsUnread = Number.isFinite(d.threadsUnread) ? d.threadsUnread : d.messagesUnread || 0;
      broadcastToUser(userId, { type: 'unread_count_updated', unread: threadsUnread, total: threadsTotal });
    } catch (_) {}
    return res.json({ ok, total: ids.length });
  } catch (e) {
    console.error('gmail/mark-read failed:', e);
    return res.status(401).json({ error: 'Unable to mark Gmail threads as read' });
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
        await gmail.users.threads.modify({
          userId: 'me',
          id,
          requestBody: { addLabelIds: ['UNREAD'] }
        });
        ok += 1;
      } catch (_) {}
    }
    try {
      const userId = String(req.auth?.sub);
      cache.del(`inbox:stats:gmail:${userId}`);
      const oauth2Client2 = await getGoogleOAuthClientFromCookies(req);
      const gmail2 = google.gmail({ version: 'v1', auth: oauth2Client2 });
      const label = await gmail2.users.labels.get({ userId: 'me', id: 'INBOX' });
      const d = label.data || {};
      const threadsTotal = Number.isFinite(d.threadsTotal) ? d.threadsTotal : d.messagesTotal || 0;
      const threadsUnread = Number.isFinite(d.threadsUnread) ? d.threadsUnread : d.messagesUnread || 0;
      broadcastToUser(String(req.auth?.sub), { type: 'unread_count_updated', unread: threadsUnread, total: threadsTotal });
    } catch (_) {}
    return res.json({ ok, total: ids.length });
  } catch (e) {
    console.error('gmail/mark-unread failed:', e);
    return res.status(401).json({ error: 'Unable to mark Gmail threads as unread' });
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
    const oauth2Client = await getGoogleOAuthClientFromCookies(req);
    const gmail = google.gmail({
      version: 'v1', auth: oauth2Client
    });

    const maxResults = Math.min(parseInt(req.query.maxResults || '20', 10), 50);
    const pageToken = req.query.pageToken || undefined;
    const unread = String(req.query.unread || 'false') === 'true';
    const q = req.query.q || undefined;

    // Include all categories within INBOX (no CATEGORY_* filter)
    const labelIds = ['INBOX'];
    if (unread) labelIds.push('UNREAD');

    const listResp = await gmail.users.threads.list({
      userId: 'me',
      maxResults,
      labelIds,
      pageToken,
      q,
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
    const includeAttachments = String(req.query.includeAttachments || 'false') === 'true';
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

    res.json({ threadId: t.data.id, messages: out });
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
