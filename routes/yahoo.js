const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { ensureYahooAccessToken } = require('../utils/yahooClient');
const { query } = require('../lib/db');
const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');

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

async function getUserEmailById(req) {
  const userId = Number(req.auth?.sub);
  if (!userId) throw new Error('Missing user id');
  const { rows } = await query('SELECT email FROM users WHERE id = $1', [userId]);
  if (!rows[0]?.email) throw new Error('User email not found');
  return rows[0].email;
}

router.get('/yahoo/messages', requireAuth, async (req, res) => {
  try {
    const folder = (req.query.folder || 'INBOX').toString(); // IMAP names
    const limit = Math.min(parseInt(req.query.top || '20', 10), 50);
    const unreadOnly = String(req.query.unread || 'false') === 'true';
    const emailHeader = await getUserEmailById(req);

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
    const emailHeader = await getUserEmailById(req);
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

// ---- Yahoo Compose (SMTP XOAUTH2) ----
const ALLOWED_MIME = new Set([
  'application/pdf','text/plain','text/html','image/jpeg','image/png','image/gif','image/webp','image/svg+xml','application/zip','application/x-zip-compressed','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation'
]);
const FORBIDDEN_EXT = new Set(['.exe','.bat','.cmd','.sh','.js','.msi','.apk','.dmg','.iso','.dll','.scr']);
function toArray(x){ if(!x) return []; return Array.isArray(x)?x.filter(Boolean):String(x).split(',').map(s=>s.trim()).filter(Boolean); }
function validateEmailAddress(addr){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr); }
function hasForbiddenExtension(filename){ const lower=(filename||'').toLowerCase(); for(const ext of FORBIDDEN_EXT){ if(lower.endsWith(ext)) return true;} return false; }
function base64LenToBytes(b64){ const len=b64.length; const padding=(b64.endsWith('==')?2:(b64.endsWith('=')?1:0)); return Math.floor((len*3)/4)-padding; }
function validateAttachments(attachments, maxTotal){ let total=0; for(const a of attachments){ if(!a||typeof a!=='object') throw new Error('Invalid attachment'); const {filename,contentType,data}=a; if(!filename||!contentType||!data) throw new Error('Attachment missing fields'); if(hasForbiddenExtension(filename)) throw new Error(`Forbidden file type: ${filename}`); if(!ALLOWED_MIME.has(contentType)) throw new Error(`Unsupported MIME type: ${contentType}`); const bytes=base64LenToBytes(data); if(bytes<=0) throw new Error(`Invalid attachment data for ${filename}`); total+=bytes; if(bytes>25*1024*1024) throw new Error(`Attachment too large (>25MB): ${filename}`);} if(total>maxTotal) throw new Error('Total attachments exceed allowed size'); return total; }
function sanitizeHtml(html){ return String(html||'').replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi,''); }

router.post('/yahoo/compose', requireAuth, async (req,res)=>{
  try{
    const { to, cc, bcc, subject='', text='', html='', attachments=[], returnId=false } = req.body || {};
    const toList=toArray(to), ccList=toArray(cc), bccList=toArray(bcc);
    if(!toList.length) return res.status(400).json({error:'At least one recipient required'});
    for(const addr of [...toList,...ccList,...bccList]){ if(!validateEmailAddress(addr)) return res.status(400).json({error:`Invalid recipient: ${addr}`}); }
    const MAX_TOTAL = Math.min((parseInt(process.env.MAX_EMAIL_TOTAL_MB||'25',10))*1024*1024, 50*1024*1024);
    validateAttachments(attachments, MAX_TOTAL);
    const email = await getUserEmailById(req);
    const access = await ensureYahooAccessToken(req,res);

    const transporter = nodemailer.createTransport({
      host: 'smtp.mail.yahoo.com',
      port: 465,
      secure: true,
      auth: { type: 'OAuth2', user: email, accessToken: access }
    });
    const mail = {
      from: email,
      to: toList.join(', '),
      cc: ccList.length?ccList.join(', '):undefined,
      bcc: bccList.length?bccList.join(', '):undefined,
      subject,
      text: html?undefined:text||undefined,
      html: html?sanitizeHtml(html):undefined,
      attachments: attachments.map(a=>({ filename:a.filename, content: Buffer.from(a.data,'base64'), contentType:a.contentType, cid: a.contentId||undefined }))
    };
    const info = await transporter.sendMail(mail);
    return res.json({ ok:true, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected });
  }catch(e){
    console.error(e);
    return res.status(400).json({ error: e?.message || 'Yahoo compose failed' });
  }
});
