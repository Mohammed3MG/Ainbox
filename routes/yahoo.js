const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { ensureYahooAccessToken } = require('../utils/yahooClient');
const { ImapFlow } = require('imapflow');

const router = express.Router();

async function withImap(email, accessToken, fn) {
  const client = new ImapFlow({
    host: 'imap.mail.yahoo.com',
    port: 993,
    secure: true,
    auth: {
      user: email,
      accessToken,
      method: 'XOAUTH2'
    }
  });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    try { await client.logout(); } catch (_) {}
  }
}

function mapEnvelope(envelope) {
  const from = envelope.from && envelope.from[0] ? `${envelope.from[0].name || ''} <${envelope.from[0].address}>`.trim() : null;
  const to = (envelope.to || []).map(a => a.address);
  return { subject: envelope.subject || '', from, to, date: envelope.date ? new Date(envelope.date).toISOString() : null };
}

router.get('/yahoo/messages', requireAuth, async (req, res) => {
  try {
    const folder = (req.query.folder || 'INBOX').toString(); // IMAP names
    const limit = Math.min(parseInt(req.query.top || '20', 10), 50);
    const unreadOnly = String(req.query.unread || 'false') === 'true';
    const emailHeader = req.auth?.email; // app auth contains email we stored

    if (!emailHeader) return res.status(400).json({ error: 'Missing user email in token' });

    const access = await ensureYahooAccessToken(req, res);
    const items = await withImap(emailHeader, access, async (imap) => {
      await imap.mailboxOpen(folder, { readOnly: true });
      // Get last N sequence numbers
      const lock = await imap.getMailboxLock(folder);
      try {
        const total = imap.mailbox.exists || 0;
        const start = Math.max(1, total - limit + 1);
        const seq = `${start}:*`;
        const messages = [];
        for await (const msg of imap.fetch(seq, { envelope: true, flags: true, bodyStructure: true })) {
          if (unreadOnly && msg.flags && msg.flags.includes('Seen')) continue;
          const env = mapEnvelope(msg.envelope || {});
          const hasAttachments = !!(msg.bodyStructure && Array.isArray(msg.bodyStructure.childNodes) && msg.bodyStructure.childNodes.some(p => /attachment/i.test(p.disposition?.type || '')));
          messages.push({
            id: String(msg.uid),
            conversationId: null,
            subject: env.subject,
            from: env.from,
            to: env.to,
            date: env.date,
            snippet: '',
            isRead: !(msg.flags && msg.flags.includes('Seen')) ? false : true,
            hasAttachments,
            importance: 'normal'
          });
        }
        // Sort by date desc similar to others
        messages.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        return messages.slice(0, limit);
      } finally {
        lock.release();
      }
    });
    return res.json({ folder, unreadOnly, nextCursor: null, messages: items });
  } catch (e) {
    console.error(e);
    return res.status(401).json({ error: 'Unable to access Yahoo Mail', reason: e?.message });
  }
});

router.get('/yahoo/message/:uid', requireAuth, async (req, res) => {
  try {
    const folder = (req.query.folder || 'INBOX').toString();
    const uid = Number(req.params.uid);
    const emailHeader = req.auth?.email;
    if (!emailHeader) return res.status(400).json({ error: 'Missing user email in token' });
    const access = await ensureYahooAccessToken(req, res);
    const includeAttachments = String(req.query.includeAttachments || 'false') === 'true';

    const data = await withImap(emailHeader, access, async (imap) => {
      await imap.mailboxOpen(folder, { readOnly: true });
      const fetchOpts = { envelope: true, source: true, bodyStructure: true, flags: true };
      const iter = imap.fetch({ uid }, fetchOpts);
      const result = await iter.next();
      if (!result || !result.value) return null;
      const msg = result.value;
      const env = mapEnvelope(msg.envelope || {});

      let html = null;
      let text = null;
      const attachments = [];

      // Parse MIME tree to extract parts
      let parts = [];
      const walk = (node) => {
        if (!node) return;
        if (node.type === 'text' && node.subtype) {
          parts.push(node);
        }
        if (Array.isArray(node.childNodes)) node.childNodes.forEach(walk);
      };
      walk(msg.bodyStructure);
      // Fetch bodies for text/html parts
      for (const p of parts) {
        try {
          const part = await imap.download({ uid, part: p.part }, {});
          let buf = Buffer.alloc(0);
          for await (const chunk of part.content) buf = Buffer.concat([buf, chunk]);
          const content = buf.toString('utf8');
          const subtype = (p.subtype || '').toLowerCase();
          if (subtype === 'html') html = content;
          else if (subtype === 'plain') text = content;
        } catch (_) {}
      }

      if (includeAttachments) {
        const collect = [];
        const walkA = (node) => {
          if (!node) return;
          const disp = (node.disposition && node.disposition.type || '').toLowerCase();
          if (disp === 'attachment' || (node.type && node.type.toLowerCase() !== 'text' && node.size)) {
            collect.push(node);
          }
          if (Array.isArray(node.childNodes)) node.childNodes.forEach(walkA);
        };
        walkA(msg.bodyStructure);
        for (const a of collect) {
          try {
            const part = await imap.download({ uid, part: a.part }, {});
            let buf = Buffer.alloc(0);
            for await (const chunk of part.content) buf = Buffer.concat([buf, chunk]);
            attachments.push({
              filename: a.disposition?.params?.filename || a.parameters?.name || 'attachment',
              mimeType: `${a.type}/${a.subtype}`,
              size: a.size,
              inline: (a.disposition?.type || '').toLowerCase() === 'inline',
              contentId: a.id || null,
              data: buf.toString('base64')
            });
          } catch (_) {}
        }
      }

      return {
        id: String(msg.uid),
        folder,
        subject: env.subject,
        from: env.from,
        to: env.to,
        date: env.date,
        snippet: '',
        isRead: !(msg.flags && msg.flags.includes('Seen')) ? false : true,
        hasAttachments: attachments.length > 0,
        text,
        html,
        attachments
      };
    });

    if (!data) return res.status(404).json({ error: 'Message not found' });
    return res.json(data);
  } catch (e) {
    console.error(e);
    return res.status(401).json({ error: 'Unable to access Yahoo Mail', reason: e?.message });
  }
});

module.exports = router;

