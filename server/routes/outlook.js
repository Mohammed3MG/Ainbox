const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { ensureMsAccessToken } = require('../utils/outlookClient');

const router = express.Router();
const cache = require('../lib/cache');
const emailCache = require('../lib/emailCache');
const { broadcastToUser } = require('../lib/sse');
const readState = require('../lib/readState');

async function httpGet(url, accessToken, extraHeaders = {}) {
  const headers = { Authorization: `Bearer ${accessToken}`, ...extraHeaders };
  if (typeof fetch === 'function') return fetch(url, { headers });
  const fetch2 = (await import('node-fetch')).default;
  return fetch2(url, { headers });
}

async function httpPostJson(url, accessToken, body) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };
  const opts = { method: 'POST', headers, body: JSON.stringify(body) };
  if (typeof fetch === 'function') return fetch(url, opts);
  const fetch2 = (await import('node-fetch')).default;
  return fetch2(url, opts);
}

async function httpPatchJson(url, accessToken, body) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };
  const opts = { method: 'PATCH', headers, body: JSON.stringify(body) };
  if (typeof fetch === 'function') return fetch(url, opts);
  const fetch2 = (await import('node-fetch')).default;
  return fetch2(url, opts);
}

async function httpBatch(token, requests) {
  const url = 'https://graph.microsoft.com/v1.0/$batch';
  const body = { requests };
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (typeof fetch === 'function') return fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const fetch2 = (await import('node-fetch')).default;
  return fetch2(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function batchPatchMessages(token, messageIds, isRead) {
  const chunk = (arr, n) => arr.length ? [arr.slice(0, n), ...chunk(arr.slice(n), n)] : [];
  const batches = chunk(messageIds, 20);
  for (const group of batches) {
    const requests = group.map((id, idx) => ({
      id: String(idx + 1),
      method: 'PATCH',
      url: `/me/messages/${id}`,
      headers: { 'Content-Type': 'application/json' },
      body: { isRead }
    }));
    const resp = await httpBatch(token, requests);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Graph $batch failed: ${resp.status} ${text}`);
    }
  }
}

async function readJsonSafe(resp) {
  try {
    return await resp.json();
  } catch (_) {
    try {
      const text = await resp.text();
      return { _raw: text };
    } catch {
      return { _raw: null };
    }
  }
}

function mapMessageSummary(m) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    subject: m.subject,
    from: m.from?.emailAddress?.name ? `${m.from.emailAddress.name} <${m.from.emailAddress.address}>` : m.from?.emailAddress?.address,
    to: (m.toRecipients || []).map(r => r.emailAddress?.address),
    date: m.receivedDateTime || m.sentDateTime || m.createdDateTime,
    snippet: m.bodyPreview,
    isRead: !!m.isRead,
    hasAttachments: !!m.hasAttachments,
    importance: m.importance,
  };
}


// Core list handler by folder
async function listMessages(req, res) {
  try {
    const folderRaw = (req.query.folder || 'inbox').toString();
    const f = folderRaw.toLowerCase();
    const folder = f === 'inbox' ? 'inbox' : f === 'sentitems' || f === 'sent' ? 'sentitems' : f === 'drafts' ? 'drafts' : folderRaw;
    const top = Math.min(parseInt(req.query.top || '20', 10), 50);
    const unread = String(req.query.unread || 'false') === 'true';
    const skiptoken = req.query.skiptoken; // pass-through pagination token

    const token = await ensureMsAccessToken(req, res);
    const base = `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages`;
    const params = new URLSearchParams();
    params.set('$top', String(top));
    params.set('$orderby', folder === 'sentitems' ? 'sentDateTime desc' : 'receivedDateTime desc');
    const select = ['id','conversationId','subject','from','toRecipients','receivedDateTime','sentDateTime','createdDateTime','isRead','bodyPreview','hasAttachments','importance'];
    params.set('$select', select.join(','));
    // ask Graph for total count of the current query
    params.set('$count', 'true');
    const filters = [];
    if (unread) filters.push('isRead eq false');
    if (filters.length) params.set('$filter', filters.join(' and '));
    let url = `${base}?${params.toString()}`;
    if (skiptoken) url += `&$skiptoken=${encodeURIComponent(skiptoken)}`;

    // $count requires this header
    const resp = await httpGet(url, token, { 'ConsistencyLevel': 'eventual' });
    const json = await readJsonSafe(resp);
    if (!resp.ok) {
      const payload = {
        error: json.error?.message || json._raw || `HTTP ${resp.status}`,
        code: json.error?.code,
        innerError: json.error?.innerError,
        status: resp.status,
        source: 'graph:listMessages'
      };
      return res.status(401).json(payload);
    }

    let items = (json.value || []).map(mapMessageSummary);
    // Apply local overrides
    const userId = String(req.auth?.sub);
    items = await Promise.all(items.map(async (m) => {
      const ov = await readState.getOverride(userId, 'outlook', m.conversationId || m.id);
      if (ov === 'read') m.isRead = true;
      if (ov === 'unread') m.isRead = false;
      return m;
    }));
    // Enhance: compute origin (first inbound) sender per conversation and set it as from
    try {
      const convIds = Array.from(new Set(items.map(m => m.conversationId || m.id).filter(Boolean)));
      if (convIds.length) {
        // Discover current user email to exclude self-sent
        const meResp = await httpGet('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', token);
        const meJson = await readJsonSafe(meResp);
        const myEmail = (meJson.mail || meJson.userPrincipalName || '').toLowerCase();

        // Batch fetch earliest messages for each conversation
        const requests = convIds.map((cid, idx) => ({
          id: String(idx + 1),
          method: 'GET',
          url: `/me/messages?$select=id,from,receivedDateTime&$filter=conversationId eq '${cid}'&$orderby=receivedDateTime asc&$top=5`
        }));
        const batchResp = await httpBatch(token, requests);
        const batchJson = await readJsonSafe(batchResp);
        const originMap = new Map();
        if (batchResp.ok && Array.isArray(batchJson.responses)) {
          for (const r of batchJson.responses) {
            const body = r.body || {};
            const arr = body.value || [];
            let origin = null;
            for (const m of arr) {
              const addr = (m.from?.emailAddress?.address || '').toLowerCase();
              const name = m.from?.emailAddress?.name;
              if (!addr || addr === myEmail) continue;
              origin = name ? `${name} <${addr}>` : addr;
              break;
            }
            if (!origin && arr[0]?.from?.emailAddress?.address) {
              const a = arr[0].from.emailAddress.address;
              const n = arr[0].from.emailAddress.name;
              origin = n ? `${n} <${a}>` : a;
            }
            const idxNum = Number(r.id) - 1;
            const convId = convIds[idxNum];
            if (convId && origin) originMap.set(convId, origin);
          }
        }
        // Apply origin to items
        items = items.map(it => {
          const cid = it.conversationId || it.id;
          const origin = originMap.get(cid);
          if (origin) {
            it.latestFrom = it.from;
            it.originFrom = origin;
            it.from = origin;
          }
          return it;
        });
      }
    } catch (_) { /* ignore origin errors */ }

    const nextLink = json['@odata.nextLink'] || null;
    let nextSkip = null;
    if (nextLink) {
      const u = new URL(nextLink);
      nextSkip = u.searchParams.get('$skiptoken');
    }
    const total = typeof json['@odata.count'] === 'number' ? json['@odata.count'] : undefined;
    return res.json({ folder, unreadOnly: unread, nextSkipToken: nextSkip, messages: items, total });
  } catch (e) {
    console.error(e);
    return res.status(401).json({ error: 'Unable to access Outlook', reason: e?.message, source: 'listMessages' });
  }
}

router.get('/outlook/messages', requireAuth, listMessages);

// Convenience endpoints to mirror Gmail structure
router.get('/outlook/inbox', requireAuth, async (req, res) => {
  req.query.folder = 'inbox';
  return listMessages(req, res);
});

router.get('/outlook/sent', requireAuth, async (req, res) => {
  req.query.folder = 'sentitems';
  return listMessages(req, res);
});

router.get('/outlook/drafts', requireAuth, async (req, res) => {
  req.query.folder = 'drafts';
  return listMessages(req, res);
});

// Inbox stats: total + unread counts via Graph (focused/primary emails only)
router.get('/outlook/inbox-stats', requireAuth, async (req, res) => {
  try {
    const userId = String(req.auth?.sub);
    const key = `inbox:stats:outlook:${userId}`;
    const value = await cache.wrap(key, 45_000, async () => {
      const token = await ensureMsAccessToken(req, res);

      // Count total focused/primary emails in inbox
      const totalUrl = "https://graph.microsoft.com/v1.0/me/messages?$filter=parentFolderId eq 'Inbox' and inferenceClassification eq 'focused'&$count=true&$top=1";
      const totalResp = await httpGet(totalUrl, token, { 'ConsistencyLevel': 'eventual' });
      const totalJson = await readJsonSafe(totalResp);

      // Count unread focused/primary emails in inbox
      const unreadUrl = "https://graph.microsoft.com/v1.0/me/messages?$filter=parentFolderId eq 'Inbox' and inferenceClassification eq 'focused' and isRead eq false&$count=true&$top=1";
      const unreadResp = await httpGet(unreadUrl, token, { 'ConsistencyLevel': 'eventual' });
      const unreadJson = await readJsonSafe(unreadResp);

      if (!totalResp.ok) {
        const err = new Error(totalJson.error?.message || totalJson._raw || `HTTP ${totalResp.status}`);
        err.status = totalResp.status;
        throw err;
      }

      return {
        total: totalJson['@odata.count'] || 0,
        unread: unreadJson['@odata.count'] || 0
      };
    });
    // Persist latest stats so UI can use Redis-backed stats immediately elsewhere
    try { await emailCache.setUserStats(userId, 'outlook', value); } catch (_) {}
    return res.json(value);
  } catch (e) {
    console.error(e);
    return res.status(401).json({ error: 'Unable to access Outlook inbox stats' });
  }
});

// Spam stats (Outlook): Junk Email folder
router.get('/outlook/spam-stats', requireAuth, async (req, res) => {
  try {
    const userId = String(req.auth?.sub);
    const key = `spam:stats:outlook:${userId}`;
    const value = await require('../lib/cache').wrap(key, 45_000, async () => {
      const token = await ensureMsAccessToken(req, res);
      const url = 'https://graph.microsoft.com/v1.0/me/mailFolders/JunkEmail?$select=totalItemCount,unreadItemCount';
      const resp = await httpGet(url, token);
      const json = await readJsonSafe(resp);
      if (!resp.ok) {
        const err = new Error(json.error?.message || json._raw || `HTTP ${resp.status}`);
        err.status = resp.status;
        throw err;
      }
      return { total: json.totalItemCount || 0, unread: json.unreadItemCount || 0 };
    });
    return res.json(value);
  } catch (e) {
    console.error(e);
    return res.status(401).json({ error: 'Unable to access Outlook spam stats' });
  }
});

// Mark Outlook conversations read/unread
async function listConversationMessageIds(token, conversationId) {
  const ids = [];
  let url = `https://graph.microsoft.com/v1.0/me/messages?$select=id,conversationId,isRead&$filter=conversationId eq '${conversationId}'&$top=50`;
  while (url) {
    const resp = await httpGet(url, token);
    const json = await resp.json();
    if (!resp.ok) break;
    for (const m of json.value || []) ids.push(m.id);
    url = json['@odata.nextLink'] || null;
  }
  return ids;
}

router.post('/outlook/mark-read', requireAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: 'ids required' });
    const token = await ensureMsAccessToken(req, res);
    let ok = 0;
    for (const convId of ids) {
      try {
        const userId = String(req.auth?.sub);
        await readState.setOverride(userId, 'outlook', convId, 'read');
        try { broadcastToUser(userId, { type: 'email_updated', email: { id: convId, isRead: true } }); } catch (_) {}
        const msgIds = await listConversationMessageIds(token, convId);
        try {
          const unreadNow = await readState.unreadCount(userId, 'outlook');
          broadcastToUser(userId, { type: 'unread_count_updated', unread: unreadNow });
        } catch (_) {}
        if (msgIds.length > 1) {
          await batchPatchMessages(token, msgIds, true);
          await readState.clearOverrideOnSuccess(userId, 'outlook', convId, true);
        } else if (msgIds[0]) {
          await httpPatchJson(`https://graph.microsoft.com/v1.0/me/messages/${msgIds[0]}`, token, { isRead: true });
          await readState.clearOverrideOnSuccess(userId, 'outlook', convId, true);
        }
        ok += 1;
      } catch (_) {}
    }
    // Invalidate stats cache and update Redis-backed stats immediately with a delta
    try {
      const userId = String(req.auth?.sub);
      cache.del(`inbox:stats:outlook:${userId}`);
      const cur = (await emailCache.getUserStats(userId, 'outlook')) || null;
      if (cur) {
        const next = { ...cur, unread: Math.max(0, (cur.unread || 0) - ids.length) };
        await emailCache.setUserStats(userId, 'outlook', next);
        broadcastToUser(userId, { type: 'unread_count_updated', unread: next.unread, total: next.total });
      }
    } catch (_) {}

    // Background recount from Graph for accuracy, then refresh Redis stats and broadcast
    setImmediate(async () => {
      try {
        const userId = String(req.auth?.sub);
        const token2 = await ensureMsAccessToken(req, res);
        const unreadUrl = "https://graph.microsoft.com/v1.0/me/messages?$filter=parentFolderId eq 'Inbox' and inferenceClassification eq 'focused' and isRead eq false&$count=true&$top=1";
        const totalUrl = "https://graph.microsoft.com/v1.0/me/messages?$filter=parentFolderId eq 'Inbox' and inferenceClassification eq 'focused'&$count=true&$top=1";
        const [unreadResp, totalResp] = await Promise.all([
          httpGet(unreadUrl, token2, { 'ConsistencyLevel': 'eventual' }),
          httpGet(totalUrl, token2, { 'ConsistencyLevel': 'eventual' })
        ]);
        const [unreadJson, totalJson] = await Promise.all([
          readJsonSafe(unreadResp),
          readJsonSafe(totalResp)
        ]);
        if (unreadResp.ok && totalResp.ok) {
          const stats = { unread: unreadJson['@odata.count'] || 0, total: totalJson['@odata.count'] || 0 };
          await emailCache.setUserStats(userId, 'outlook', stats);
          broadcastToUser(userId, { type: 'unread_count_updated', unread: stats.unread, total: stats.total });
        }
      } catch (_) {}
    });
    try {
      const userId = String(req.auth?.sub);
      await emailCache.invalidateOnAction(userId, 'outlook', 'mark_read', ids);
    } catch (_) {}
    // Return immediate count update to frontend
    try {
      const userId = String(req.auth?.sub);
      const currentStats = (await emailCache.getUserStats(userId, 'outlook')) || { unread: 0, total: 0 };
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
    console.error('outlook/mark-read failed:', e);
    return res.status(401).json({ error: 'Unable to mark Outlook conversations as read' });
  }
});

router.post('/outlook/mark-unread', requireAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: 'ids required' });
    const token = await ensureMsAccessToken(req, res);
    let ok = 0;
    for (const convId of ids) {
      try {
        const userId = String(req.auth?.sub);
        await readState.setOverride(userId, 'outlook', convId, 'unread');
        try { broadcastToUser(userId, { type: 'email_updated', email: { id: convId, isRead: false } }); } catch (_) {}
        const msgIds = await listConversationMessageIds(token, convId);
        try {
          const unreadNow = await readState.unreadCount(userId, 'outlook');
          broadcastToUser(userId, { type: 'unread_count_updated', unread: unreadNow });
        } catch (_) {}
        if (msgIds.length > 1) {
          await batchPatchMessages(token, msgIds, false);
          await readState.clearOverrideOnSuccess(userId, 'outlook', convId, true);
        } else if (msgIds[0]) {
          await httpPatchJson(`https://graph.microsoft.com/v1.0/me/messages/${msgIds[0]}`, token, { isRead: false });
          await readState.clearOverrideOnSuccess(userId, 'outlook', convId, true);
        }
        ok += 1;
      } catch (_) {}
    }
    // Invalidate stats cache and update Redis-backed stats immediately with a delta
    try {
      const userId = String(req.auth?.sub);
      cache.del(`inbox:stats:outlook:${userId}`);
      const cur = (await emailCache.getUserStats(userId, 'outlook')) || null;
      if (cur) {
        const next = { ...cur, unread: Math.max(0, (cur.unread || 0) + ids.length) };
        await emailCache.setUserStats(userId, 'outlook', next);
        broadcastToUser(userId, { type: 'unread_count_updated', unread: next.unread, total: next.total });
      }
    } catch (_) {}

    // Background recount from Graph for accuracy, then refresh Redis stats and broadcast
    setImmediate(async () => {
      try {
        const userId = String(req.auth?.sub);
        const token2 = await ensureMsAccessToken(req, res);
        const unreadUrl = "https://graph.microsoft.com/v1.0/me/messages?$filter=parentFolderId eq 'Inbox' and inferenceClassification eq 'focused' and isRead eq false&$count=true&$top=1";
        const totalUrl = "https://graph.microsoft.com/v1.0/me/messages?$filter=parentFolderId eq 'Inbox' and inferenceClassification eq 'focused'&$count=true&$top=1";
        const [unreadResp, totalResp] = await Promise.all([
          httpGet(unreadUrl, token2, { 'ConsistencyLevel': 'eventual' }),
          httpGet(totalUrl, token2, { 'ConsistencyLevel': 'eventual' })
        ]);
        const [unreadJson, totalJson] = await Promise.all([
          readJsonSafe(unreadResp),
          readJsonSafe(totalResp)
        ]);
        if (unreadResp.ok && totalResp.ok) {
          const stats = { unread: unreadJson['@odata.count'] || 0, total: totalJson['@odata.count'] || 0 };
          await emailCache.setUserStats(userId, 'outlook', stats);
          broadcastToUser(userId, { type: 'unread_count_updated', unread: stats.unread, total: stats.total });
        }
      } catch (_) {}
    });
    try {
      const userId = String(req.auth?.sub);
      await emailCache.invalidateOnAction(userId, 'outlook', 'mark_unread', ids);
    } catch (_) {}
    // Return immediate count update to frontend
    try {
      const userId = String(req.auth?.sub);
      const currentStats = (await emailCache.getUserStats(userId, 'outlook')) || { unread: 0, total: 0 };
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
    console.error('outlook/mark-unread failed:', e);
    return res.status(401).json({ error: 'Unable to mark Outlook conversations as unread' });
  }
});

// Thread (conversation) details
router.get('/outlook/thread/:conversationId', requireAuth, async (req, res) => {
  try {
    const includeAttachments = String(req.query.includeAttachments || 'false') === 'true';
    const token = await ensureMsAccessToken(req, res);
    const convId = req.params.conversationId;
    const params = new URLSearchParams();
    const select = ['id','conversationId','subject','from','toRecipients','receivedDateTime','sentDateTime','createdDateTime','isRead','body','bodyPreview','hasAttachments'];
    params.set('$select', select.join(','));
    params.set('$filter', `conversationId eq '${convId}'`);
    const url = `https://graph.microsoft.com/v1.0/me/messages?${params.toString()}`;
    const resp = await httpGet(url, token);
    const json = await readJsonSafe(resp);
    if (!resp.ok) {
      const payload = {
        error: json.error?.message || json._raw || `HTTP ${resp.status}`,
        code: json.error?.code,
        innerError: json.error?.innerError,
        status: resp.status,
        source: 'graph:thread'
      };
      return res.status(401).json(payload);
    }

    const byDateAsc = (a, b) => new Date(a.receivedDateTime || a.sentDateTime || a.createdDateTime) - new Date(b.receivedDateTime || b.sentDateTime || b.createdDateTime);
    const ordered = (json.value || []).slice().sort(byDateAsc);
    const messages = [];
    for (const m of ordered) {
      const mapped = mapMessageSummary(m);
      // bodies
      const body = m.body || {};
      const content = body.content || '';
      const ctype = (body.contentType || '').toLowerCase();
      mapped.html = ctype === 'html' ? content : null;
      mapped.text = ctype === 'text' ? content : null;

      if (includeAttachments && m.hasAttachments) {
        const aResp = await httpGet(`https://graph.microsoft.com/v1.0/me/messages/${m.id}/attachments?$select=id,name,contentType,size,isInline,contentBytes,contentId`, token);
        const aJson = await aResp.json();
        if (aResp.ok) {
          mapped.attachments = (aJson.value || [])
            .filter(a => a['@odata.type'] && a['@odata.type'].includes('fileAttachment'))
            .map(a => ({
              filename: a.name,
              mimeType: a.contentType,
              size: a.size,
              inline: !!a.isInline,
              contentId: a.contentId || null,
              data: a.contentBytes || null,
            }));
        } else {
          mapped.attachments = [];
        }
      }
      messages.push(mapped);
    }
    return res.json({ threadId: convId, messages });
  } catch (e) {
    console.error(e);
    return res.status(401).json({ error: 'Unable to access Outlook', reason: e?.message, source: 'thread' });
  }
});

// Single message details (full body + optional attachments)
router.get('/outlook/message/:id', requireAuth, async (req, res) => {
  try {
    const includeAttachments = String(req.query.includeAttachments || 'false') === 'true';
    const token = await ensureMsAccessToken(req, res);
    const id = encodeURIComponent(req.params.id);

    const select = ['id','conversationId','parentFolderId','subject','from','toRecipients','receivedDateTime','sentDateTime','createdDateTime','isRead','body','bodyPreview','hasAttachments'];
    const url = `https://graph.microsoft.com/v1.0/me/messages/${id}?$select=${select.join(',')}`;
    const resp = await httpGet(url, token);
    const json = await readJsonSafe(resp);
    if (!resp.ok) {
      return res.status(401).json({
        error: json.error?.message || json._raw || `HTTP ${resp.status}`,
        code: json.error?.code,
        innerError: json.error?.innerError,
        status: resp.status,
        source: 'graph:message'
      });
    }

    const m = json;
    const mapped = mapMessageSummary(m);
    mapped.parentFolderId = m.parentFolderId || null;
    // bodies
    const body = m.body || {};
    const content = body.content || '';
    const ctype = (body.contentType || '').toLowerCase();
    mapped.html = ctype === 'html' ? content : null;
    mapped.text = ctype === 'text' ? content : null;

    if (includeAttachments && m.hasAttachments) {
      const aResp = await httpGet(`https://graph.microsoft.com/v1.0/me/messages/${req.params.id}/attachments?$select=id,name,contentType,size,isInline,contentBytes,contentId`, token);
      const aJson = await readJsonSafe(aResp);
      if (aResp.ok) {
        mapped.attachments = (aJson.value || [])
          .filter(a => a['@odata.type'] && a['@odata.type'].includes('fileAttachment'))
          .map(a => ({
            filename: a.name,
            mimeType: a.contentType,
            size: a.size,
            inline: !!a.isInline,
            contentId: a.contentId || null,
            data: a.contentBytes || null,
          }));
      } else {
        mapped.attachments = [];
      }
    }

    return res.json(mapped);
  } catch (e) {
    console.error(e);
    return res.status(401).json({ error: 'Unable to access Outlook', reason: e?.message, source: 'message' });
  }
});

module.exports = router;

// -------- Compose (send) via Microsoft Graph --------
// Allowed file types/extensions (aligned with Gmail/SMTP compose)
const ALLOWED_MIME = new Set([
  'application/pdf',
  'text/plain',
  'text/html',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
]);
const FORBIDDEN_EXT = new Set(['.exe', '.bat', '.cmd', '.sh', '.js', '.msi', '.apk', '.dmg', '.iso', '.dll', '.scr']);

function toArray(x) {
  if (!x) return [];
  return Array.isArray(x) ? x.filter(Boolean) : String(x).split(',').map(s => s.trim()).filter(Boolean);
}

function validateEmailAddress(addr) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr);
}

function hasForbiddenExtension(filename) {
  const lower = (filename || '').toLowerCase();
  for (const ext of FORBIDDEN_EXT) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function base64LenToBytes(b64) {
  const len = b64.length;
  const padding = (b64.endsWith('==') ? 2 : (b64.endsWith('=') ? 1 : 0));
  return Math.floor((len * 3) / 4) - padding;
}

function validateAttachments(attachments, maxTotalBytes) {
  let total = 0;
  for (const a of attachments) {
    if (!a || typeof a !== 'object') throw new Error('Invalid attachment');
    const { filename, contentType, data } = a;
    if (!filename || !contentType || !data) throw new Error('Attachment missing fields');
    if (hasForbiddenExtension(filename)) throw new Error(`Forbidden file type: ${filename}`);
    if (!ALLOWED_MIME.has(contentType)) throw new Error(`Unsupported MIME type: ${contentType}`);
    const bytes = base64LenToBytes(data);
    if (bytes <= 0) throw new Error(`Invalid attachment data for ${filename}`);
    total += bytes;
    if (bytes > 25 * 1024 * 1024) throw new Error(`Attachment too large (>25MB): ${filename}`);
  }
  if (total > maxTotalBytes) throw new Error('Total attachments exceed allowed size');
  return total;
}

function sanitizeHtml(html) {
  return String(html || '').replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
}

router.post('/outlook/compose', requireAuth, async (req, res) => {
  try {
    const {
      to,
      cc,
      bcc,
      subject = '',
      text = '',
      html = '',
      attachments = [], // [{ filename, contentType, data(base64), inline?, contentId? }]
      saveToSentItems = true,
      returnId = true
    } = req.body || {};

    const toList = toArray(to);
    const ccList = toArray(cc);
    const bccList = toArray(bcc);

    if (!toList.length) return res.status(400).json({ error: 'At least one recipient required' });
    for (const addr of [...toList, ...ccList, ...bccList]) {
      if (!validateEmailAddress(addr)) return res.status(400).json({ error: `Invalid recipient: ${addr}` });
    }

    const MAX_TOTAL_BYTES = Math.min((parseInt(process.env.MAX_EMAIL_TOTAL_MB || '25', 10)) * 1024 * 1024, 50 * 1024 * 1024);
    validateAttachments(attachments, MAX_TOTAL_BYTES);

    const token = await ensureMsAccessToken(req, res);
    const bodyContent = html ? sanitizeHtml(html) : (text || '');
    const bodyType = html ? 'HTML' : 'Text';

    const toRecipients = toList.map(a => ({ emailAddress: { address: a } }));
    const ccRecipients = ccList.map(a => ({ emailAddress: { address: a } }));
    const bccRecipients = bccList.map(a => ({ emailAddress: { address: a } }));

    const graphAttachments = attachments.map(a => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.filename,
      contentType: a.contentType,
      contentBytes: a.data,
      isInline: !!a.inline,
      contentId: a.contentId || undefined
    }));

    if (returnId) {
      // Create, then send — returns the message id before sending
      const createBody = {
        subject,
        body: { contentType: bodyType, content: bodyContent },
        toRecipients,
        ccRecipients: ccRecipients.length ? ccRecipients : undefined,
        bccRecipients: bccRecipients.length ? bccRecipients : undefined,
        attachments: graphAttachments.length ? graphAttachments : undefined
      };
      const createResp = await httpPostJson('https://graph.microsoft.com/v1.0/me/messages', token, createBody);
      const created = await readJsonSafe(createResp);
      if (!createResp.ok) {
        return res.status(400).json({ error: created.error?.message || created._raw || `HTTP ${createResp.status}`, code: created.error?.code, source: 'graph:createMessage' });
      }
      const messageId = created.id;
      const sendResp = await httpPostJson(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}/send`, token, {});
      if (!sendResp.ok && sendResp.status !== 202) {
        const s = await readJsonSafe(sendResp);
        return res.status(400).json({ error: s.error?.message || s._raw || `HTTP ${sendResp.status}`, code: s.error?.code, source: 'graph:sendMessage' });
      }
      if (!saveToSentItems) {
        // Graph send always saves to Sent by default; skipping deletion to keep logic simple
      }
      return res.json({ ok: true, id: messageId });
    } else {
      // Direct sendMail (no id returned)
      const sendBody = {
        message: {
          subject,
          body: { contentType: bodyType, content: bodyContent },
          toRecipients,
          ccRecipients: ccRecipients.length ? ccRecipients : undefined,
          bccRecipients: bccRecipients.length ? bccRecipients : undefined,
          attachments: graphAttachments.length ? graphAttachments : undefined
        },
        saveToSentItems
      };
      const resp = await httpPostJson('https://graph.microsoft.com/v1.0/me/sendMail', token, sendBody);
      if (!resp.ok && resp.status !== 202) {
        const j = await readJsonSafe(resp);
        return res.status(400).json({ error: j.error?.message || j._raw || `HTTP ${resp.status}`, code: j.error?.code, source: 'graph:sendMail' });
      }
      return res.json({ ok: true });
    }
  } catch (e) {
    console.error(e);
    return res.status(400).json({ error: e?.message || 'Compose failed' });
  }
});
