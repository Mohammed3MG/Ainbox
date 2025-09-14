const express = require('express');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const net = require('net');
const { requireAuth } = require('../middleware/auth');
const { getGoogleOAuthClientFromCookies } = require('../utils/googleClient');

const router = express.Router();

// Allowed file types/extensions
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

function base64LenToBytes(b64) {
  // Base64 length to bytes: 3/4 of length minus padding
  const len = b64.length;
  const padding = (b64.endsWith('==') ? 2 : (b64.endsWith('=') ? 1 : 0));
  return Math.floor((len * 3) / 4) - padding;
}

function toArray(x) {
  if (!x) return [];
  return Array.isArray(x) ? x.filter(Boolean) : String(x).split(',').map(s => s.trim()).filter(Boolean);
}

function encodeBase64Url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function validateEmailAddress(addr) {
  // Simple RFC 5322-like validation for common addresses
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr);
}

function hasForbiddenExtension(filename) {
  const lower = (filename || '').toLowerCase();
  for (const ext of FORBIDDEN_EXT) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
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
    if (contentType === 'application/zip' || contentType === 'application/x-zip-compressed') {
      // Basic ZIP bomb guard: limit zip size to 25MB (provider limits typically 20-25MB)
      // Deep inspection would require parsing the zip; omitted here.
    }
  }
  if (total > maxTotalBytes) throw new Error('Total attachments exceed allowed size');
  return total;
}

function sanitizeHtml(html) {
  // Very basic sanitization: strip script tags; for full XSS filtering use DOMPurify in frontend
  return String(html || '').replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
}

function buildMime({ from, to = [], cc = [], bcc = [], subject = '', text = '', html = '', attachments = [], inReplyTo, references, }) {
  const boundaryMixed = 'mix_' + Math.random().toString(16).slice(2);
  const boundaryAlt = 'alt_' + Math.random().toString(16).slice(2);

  const lines = [];
  lines.push(`From: ${from}`);
  if (to.length) lines.push(`To: ${to.join(', ')}`);
  if (cc.length) lines.push(`Cc: ${cc.join(', ')}`);
  if (subject) lines.push(`Subject: ${subject}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push('MIME-Version: 1.0');

  if (attachments.length) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundaryMixed}"`);
    lines.push('');
    lines.push(`--${boundaryMixed}`);
  }

  // Alternative part for text+html
  lines.push(`Content-Type: multipart/alternative; boundary="${boundaryAlt}"`);
  lines.push('');
  // text
  lines.push(`--${boundaryAlt}`);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: 7bit');
  lines.push('');
  lines.push(text || '');
  // html
  if (html) {
    lines.push(`--${boundaryAlt}`);
    lines.push('Content-Type: text/html; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(html);
  }
  lines.push(`--${boundaryAlt}--`);

  // attachments
  if (attachments.length) {
    for (const a of attachments) {
      const { filename, contentType, data } = a;
      lines.push('');
      lines.push(`--${boundaryMixed}`);
      lines.push(`Content-Type: ${contentType}; name="${filename}"`);
      lines.push('Content-Transfer-Encoding: base64');
      lines.push(`Content-Disposition: attachment; filename="${filename}"`);
      lines.push('');
      // wrap base64 at 76-char lines
      const wrapped = data.replace(/.{1,76}/g, '$&\r\n');
      lines.push(wrapped);
    }
    lines.push(`--${boundaryMixed}--`);
  }

  return lines.join('\r\n');
}

async function scanWithClamAV(buffers) {
  const host = process.env.CLAMAV_HOST;
  const port = parseInt(process.env.CLAMAV_PORT || '3310', 10);
  if (!host) return { ok: true };

  function scanBuffer(buf) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let result = '';
      socket.connect(port, host, () => {
        socket.write('zINSTREAM\0');
        let offset = 0;
        while (offset < buf.length) {
          const chunk = buf.subarray(offset, Math.min(offset + 1024 * 32, buf.length));
          const len = Buffer.alloc(4);
          len.writeUInt32BE(chunk.length, 0);
          socket.write(len);
          socket.write(chunk);
          offset += chunk.length;
        }
        const zero = Buffer.alloc(4);
        zero.writeUInt32BE(0, 0);
        socket.write(zero);
      });
      socket.on('data', (d) => { result += d.toString(); });
      socket.on('error', (e) => reject(e));
      socket.on('close', () => {
        // Result like: stream: OK or stream: Eicar-Test-Signature FOUND
        if (/FOUND/i.test(result)) return resolve({ ok: false, result });
        return resolve({ ok: true, result });
      });
    });
  }

  for (const b of buffers) {
    const res = await scanBuffer(b);
    if (!res.ok) return res;
  }
  return { ok: true };
}

function smtpTransportFromBody(smtp) {
  // Supports user/pass or OAuth2
  if (!smtp || typeof smtp !== 'object') throw new Error('Missing smtp config');
  const { host, port, secure, auth } = smtp;
  if (!host || !port || !auth) throw new Error('Incomplete smtp config');
  return nodemailer.createTransport({ host, port, secure: !!secure, auth });
}

function getGoogleTokensFromReq(req) {
  const cookies = req.cookies || {};
  const bodyTokens = (req.body && req.body.googleTokens) || {};
  const refreshToken = bodyTokens.refreshToken || cookies.google_refresh_token;
  const accessToken = bodyTokens.accessToken || cookies.google_access_token;
  return { refreshToken, accessToken };
}

// Compose and send email via provider
router.post('/compose', requireAuth, async (req, res) => {
  try {
    const {
      provider = 'gmail',
      from,
      to,
      cc,
      bcc,
      subject = '',
      text = '',
      html = '',
      attachments = [], // [{ filename, contentType, data(base64) }]
      inReplyTo,
      references,
      smtp, // { host, port, secure, auth: { user, pass } or OAuth2 }
    } = req.body || {};

    const toList = toArray(to);
    const ccList = toArray(cc);
    const bccList = toArray(bcc);

    // Validate addresses
    const allRecipients = [...toList, ...ccList, ...bccList];
    if (!from || !validateEmailAddress(from)) return res.status(400).json({ error: 'Invalid from address' });
    if (!toList.length) return res.status(400).json({ error: 'At least one recipient required' });
    for (const addr of allRecipients) {
      if (!validateEmailAddress(addr)) return res.status(400).json({ error: `Invalid recipient: ${addr}` });
    }

    // Security validations
    const MAX_TOTAL_BYTES = Math.min((parseInt(process.env.MAX_EMAIL_TOTAL_MB || '25', 10)) * 1024 * 1024, 50 * 1024 * 1024);
    validateAttachments(attachments, MAX_TOTAL_BYTES);
    const cleanHtml = sanitizeHtml(html);

    // Build MIME
    // Optional AV scan (if configured)
    try {
      const buffersToScan = attachments.map(a => Buffer.from(a.data, 'base64'));
      const av = await scanWithClamAV(buffersToScan);
      if (!av.ok) return res.status(400).json({ error: 'Malicious content detected by AV', detail: av.result });
    } catch (e) {
      // If AV is configured but fails, block send for safety
      if (process.env.CLAMAV_HOST) return res.status(400).json({ error: 'AV scan failed, message blocked' });
    }

    const mime = buildMime({ from, to: toList, cc: ccList, bcc: bccList, subject, text, html: cleanHtml, attachments, inReplyTo, references });
    const raw = encodeBase64Url(Buffer.from(mime, 'utf-8'));

    if (provider === 'gmail') {
      const oauth2Client = getGoogleOAuthClientFromCookies(req);
      // Preferred: refresh token; fallback access token for short-lived sends
      const { refreshToken, accessToken } = getGoogleTokensFromReq(req);
      if (refreshToken) oauth2Client.setCredentials({ refresh_token: refreshToken });
      else if (accessToken) oauth2Client.setCredentials({ access_token: accessToken });
      else return res.status(400).json({ error: 'Missing Google tokens. Login at /google or pass googleTokens.refreshToken in body.' });
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const sent = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      return res.json({ ok: true, id: sent.data.id, threadId: sent.data.threadId, labelIds: sent.data.labelIds || [] });
    }

    // SMTP providers (Outlook/Yahoo/Generic)
    if (provider === 'smtp' || provider === 'outlook' || provider === 'yahoo') {
      const transporter = smtpTransportFromBody(smtp);
      const info = await transporter.sendMail({
        from,
        to: toList.join(', '),
        cc: ccList.length ? ccList.join(', ') : undefined,
        bcc: bccList.length ? bccList.join(', ') : undefined,
        subject,
        text,
        html: cleanHtml,
        headers: {
          ...(inReplyTo ? { 'In-Reply-To': inReplyTo } : {}),
          ...(references ? { References: references } : {}),
        },
        attachments: attachments.map(a => ({ filename: a.filename, content: Buffer.from(a.data, 'base64'), contentType: a.contentType })),
      });
      return res.json({ ok: true, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected });
    }

    return res.status(501).json({ error: 'Provider not supported. Use provider="gmail" or provider="smtp".' });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ error: err.message || 'Compose failed' });
  }
});

// Reply to a message/thread
router.post('/reply', requireAuth, async (req, res) => {
  try {
    const { provider = 'gmail', threadId, messageId, from, to, cc, bcc, subject = '', text = '', html = '', attachments = [], smtp } = req.body || {};
    const toList = toArray(to);
    const ccList = toArray(cc);
    const bccList = toArray(bcc);
    if (!from || !validateEmailAddress(from)) return res.status(400).json({ error: 'Invalid from address' });

    let inReplyTo;
    let references;

    if (provider === 'gmail') {
      const oauth2Client = getGoogleOAuthClientFromCookies(req);
      const { refreshToken, accessToken } = getGoogleTokensFromReq(req);
      if (refreshToken) oauth2Client.setCredentials({ refresh_token: refreshToken });
      else if (accessToken) oauth2Client.setCredentials({ access_token: accessToken });
      else return res.status(400).json({ error: 'Missing Google tokens. Login at /google or pass googleTokens.refreshToken in body.' });
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      let originalHeaders = [];
      if (messageId) {
        const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'metadata', metadataHeaders: ['Message-ID', 'References'] });
        originalHeaders = msg.data.payload.headers || [];
      } else if (threadId) {
        const t = await gmail.users.threads.get({ userId: 'me', id: threadId, fields: 'messages(id,payload/headers(name,value))' });
        const last = (t.data.messages || [])[t.data.messages.length - 1];
        originalHeaders = last?.payload?.headers || [];
      } else {
        return res.status(400).json({ error: 'threadId or messageId is required' });
      }
      inReplyTo = originalHeaders.find(h => h.name.toLowerCase() === 'message-id')?.value;
      const prevRefs = originalHeaders.find(h => h.name.toLowerCase() === 'references')?.value;
      references = prevRefs ? `${prevRefs} ${inReplyTo || ''}`.trim() : (inReplyTo || undefined);

      // Optional AV scan
      try {
        const buffersToScan = attachments.map(a => Buffer.from(a.data, 'base64'));
        const av = await scanWithClamAV(buffersToScan);
        if (!av.ok) return res.status(400).json({ error: 'Malicious content detected by AV', detail: av.result });
      } catch (e) {
        if (process.env.CLAMAV_HOST) return res.status(400).json({ error: 'AV scan failed, message blocked' });
      }

      const cleanHtml = sanitizeHtml(html);
      const mime = buildMime({ from, to: toList, cc: ccList, bcc: bccList, subject, text, html: cleanHtml, attachments, inReplyTo, references });
      const raw = encodeBase64Url(Buffer.from(mime, 'utf-8'));
      const sent = await gmail.users.messages.send({ userId: 'me', requestBody: { raw, threadId } });
      return res.json({ ok: true, id: sent.data.id, threadId: sent.data.threadId, labelIds: sent.data.labelIds || [] });
    }

    if (provider === 'smtp' || provider === 'outlook' || provider === 'yahoo') {
      const transporter = smtpTransportFromBody(smtp);
      const headers = {};
      if (req.body.inReplyTo) headers['In-Reply-To'] = req.body.inReplyTo;
      if (req.body.references) headers['References'] = req.body.references;
      const info = await transporter.sendMail({
        from,
        to: toList.join(', '),
        cc: ccList.length ? ccList.join(', ') : undefined,
        bcc: bccList.length ? bccList.join(', ') : undefined,
        subject,
        text,
        html: sanitizeHtml(html),
        headers,
        attachments: attachments.map(a => ({ filename: a.filename, content: Buffer.from(a.data, 'base64'), contentType: a.contentType })),
      });
      return res.json({ ok: true, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected });
    }

    return res.status(501).json({ error: 'Provider not supported for reply' });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ error: err.message || 'Reply failed' });
  }
});

// Fetch a single sent message (Gmail only)
router.get('/message/:id', requireAuth, async (req, res) => {
  try {
    const provider = (req.query.provider || 'gmail').toString();
    if (provider !== 'gmail') return res.status(501).json({ error: 'Fetching messages only supported for Gmail in this API' });
    const oauth2Client = getGoogleOAuthClientFromCookies(req);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const msg = await gmail.users.messages.get({ userId: 'me', id: req.params.id, format: 'full' });
    return res.json(msg.data);
  } catch (err) {
    console.error(err);
    return res.status(400).json({ error: err.message || 'Fetch failed' });
  }
});

module.exports = router;
