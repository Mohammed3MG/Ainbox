const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { ensureMsAccessToken } = require('../utils/outlookClient');

const router = express.Router();

async function httpGet(url, accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  if (typeof fetch === 'function') return fetch(url, { headers });
  const fetch2 = (await import('node-fetch')).default;
  return fetch2(url, { headers });
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
    const filters = [];
    if (unread) filters.push('isRead eq false');
    if (filters.length) params.set('$filter', filters.join(' and '));
    let url = `${base}?${params.toString()}`;
    if (skiptoken) url += `&$skiptoken=${encodeURIComponent(skiptoken)}`;

    const resp = await httpGet(url, token);
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

    const items = (json.value || []).map(mapMessageSummary);
    const nextLink = json['@odata.nextLink'] || null;
    let nextSkip = null;
    if (nextLink) {
      const u = new URL(nextLink);
      nextSkip = u.searchParams.get('$skiptoken');
    }
    return res.json({ folder, unreadOnly: unread, nextSkipToken: nextSkip, messages: items });
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
