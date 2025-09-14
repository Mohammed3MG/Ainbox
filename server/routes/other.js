const express = require('express');
const { detectMailProvider } = require('../utils/detectMailProvider');
const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');
const fetch = require('node-fetch');
const https = require('https');
const { encrypt, decrypt } = require('../utils/secure');
const { getOtherAccount } = require('../utils/otherSession');

const router = express.Router();

// Simple UI to try the "Other" flow and test detection
router.get('/other', (req, res) => {
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Login with Other (Custom Domain)</title>
      <style>
        body { font-family: -apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif; padding: 24px; }
        .box { max-width: 560px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
        .row { display: flex; gap: 8px; align-items: center; }
        input[type=email] { flex: 1; padding: 8px 10px; font-size: 16px; }
        button { padding: 8px 12px; font-size: 14px; cursor: pointer; }
        .hint { color: #6b7280; font-size: 14px; margin-top: 8px; }
        .result { margin-top: 12px; font-weight: 600; }
        .back { margin-top: 16px; display: inline-block; }
        code { background: #f3f4f6; padding: 2px 4px; border-radius: 4px; }
      </style>
    </head>
    <body>
      <div class="box">
        <h2>Login with Other (Custom Domain)</h2>
        <p>Enter your email to detect whether your domain likely supports Exchange Web Services (EWS) or IMAP/SMTP.</p>
        <div class="row">
          <input id="email" type="email" placeholder="you@yourdomain.com" />
          <button id="detect">Detect Provider</button>
        </div>
        <div class="hint">Tip: If your domain is hosted on Google Workspace or Microsoft 365, please use the dedicated buttons on the home page for the best experience.</div>
        <div id="out" class="result"></div>
        <a class="back" href="/">← Back to home</a> | <a class="back" href="/other/login">Login with Other</a>
      </div>

      <script src="/other.js"></script>
    </body>
  </html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// API endpoint to detect provider
router.get('/other/detect', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Missing or invalid email' });
    }
    const provider = await detectMailProvider(email);
    const note = provider === 'EWS'
      ? 'Autodiscover responded. Exchange Web Services appears available.'
      : 'Defaulting to IMAP/SMTP (read/write mail).';
    return res.json({ provider, note });
  } catch (e) {
    console.error('Detect error:', e);
    return res.status(500).json({ error: 'Detection failed' });
  }
});

module.exports = { router: router };

// --- Login UI ---
router.get('/other/login', (req, res) => {
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Login with Other (Custom Domain)</title>
      <style>
        body { font-family: -apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif; padding: 24px; }
        .box { max-width: 720px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
        .row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
        label { width: 160px; font-size: 14px; color: #374151; }
        input, select { flex: 1; padding: 8px 10px; font-size: 14px; }
        .hint { color: #6b7280; font-size: 14px; margin: 6px 0 12px; }
        .result { margin-top: 12px; font-weight: 600; }
        .section { border-top: 1px dashed #e5e7eb; margin-top: 12px; padding-top: 12px; }
        button { padding: 8px 12px; font-size: 14px; cursor: pointer; }
        .back { margin-top: 16px; display: inline-block; }
        code { background: #f3f4f6; padding: 2px 4px; border-radius: 4px; }
      </style>
    </head>
    <body>
      <div class="box">
        <h2>Login with Other (Custom Domain)</h2>
        <p>Enter your credentials. We will detect provider and verify access. For Exchange (EWS), provide the EWS URL if known.</p>

        <div class="row"><label>Email</label><input id="email" type="email" placeholder="you@yourdomain.com" /></div>
        <div class="row"><label>Username (optional)</label><input id="username" type="text" placeholder="Default: same as email" /></div>
        <div class="row"><label>Password / App Password</label><input id="password" type="password" placeholder="Password or App Password" /></div>
        <div class="row"><label>Mode</label>
          <select id="mode">
            <option value="auto" selected>Auto (detect)</option>
            <option value="imap">IMAP/SMTP</option>
            <option value="ews">EWS (Exchange)</option>
          </select>
        </div>
        <div class="row"><label></label><button id="suggest">Suggest Settings</button><span class="hint">Prefills hosts/ports from email domain</span></div>

        <div id="imapSection" class="section" style="display:none">
          <h3>IMAP/SMTP Settings</h3>
          <div class="row"><label>IMAP Host</label><input id="imapHost" placeholder="imap.domain.com" /></div>
          <div class="row"><label>IMAP Port</label><input id="imapPort" type="number" placeholder="993" /></div>
          <div class="row"><label>IMAP Secure (TLS)</label><select id="imapSecure"><option value="true">true</option><option value="false">false</option></select></div>
          <div class="row"><label>SMTP Host</label><input id="smtpHost" placeholder="smtp.domain.com" /></div>
          <div class="row"><label>SMTP Port</label><input id="smtpPort" type="number" placeholder="465" /></div>
          <div class="row"><label>SMTP Secure (TLS)</label><select id="smtpSecure"><option value="true">true</option><option value="false">false</option></select></div>
        </div>

        <div id="ewsSection" class="section" style="display:none">
          <h3>EWS Settings</h3>
          <div class="row"><label>EWS URL</label><input id="ewsUrl" placeholder="https://mail.domain.com/EWS/Exchange.asmx" /></div>
          <div class="row"><label>Allow insecure TLS</label><select id="ewsInsecure"><option value="false">false</option><option value="true">true</option></select></div>
        </div>

        <div class="row"><label></label><button id="login">Test & Save</button></div>
        <div id="out" class="result"></div>
        <a class="back" href="/">← Back to home</a>
      </div>

      <script src="/other-login.js"></script>
    </body>
  </html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Suggest default settings based on domain
router.get('/other/suggest', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim();
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Invalid email' });
    const domain = email.split('@')[1].toLowerCase();
    const provider = await detectMailProvider(email);
    // Provider-specific hints (GMX, WEB.DE, etc.)
    let imapHost = `imap.${domain}`;
    let smtpHost = `smtp.${domain}`;
    if (/(^|\.)gmx\.(de|net|at|ch|com|es|fr|it)$/i.test(domain)) {
      imapHost = 'imap.gmx.net';
      smtpHost = 'mail.gmx.net'; // GMX uses mail.gmx.net for SMTP
    } else if (/(^|\.)web\.de$/i.test(domain)) {
      imapHost = 'imap.web.de';
      smtpHost = 'smtp.web.de';
    }
    const ewsUrl = `https://mail.${domain}/EWS/Exchange.asmx`;
    return res.json({ provider, imap: { host: imapHost, port: 993, secure: true }, smtp: { host: smtpHost, port: 465, secure: true }, ews: { url: ewsUrl } });
  } catch (e) {
    return res.status(500).json({ error: 'Suggestion failed' });
  }
});

// Verify and save settings
router.post('/other/login', async (req, res) => {
  try {
    const { email, username, password, mode = 'auto', imap, smtp, ews } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const user = (username && String(username).trim()) || String(email).trim();
    const chosen = String(mode);

    // Decide path
    let type = chosen;
    if (type === 'auto') {
      const detected = await detectMailProvider(email);
      type = detected === 'EWS' ? 'ews' : 'imap';
    }

    if (type === 'imap') {
      // Validate IMAP/SMTP config
      const imapCfg = imap || {};
      const smtpCfg = smtp || {};
      const imapHost = String(imapCfg.host || '').trim();
      const imapPort = Number(imapCfg.port || 993);
      const imapSecure = String(imapCfg.secure ?? 'true') === 'true';
      const smtpHost = String(smtpCfg.host || '').trim();
      const smtpPort = Number(smtpCfg.port || 465);
      const smtpSecure = String(smtpCfg.secure ?? 'true') === 'true';
      if (!imapHost || !imapPort || !smtpHost || !smtpPort) return res.status(400).json({ error: 'Incomplete IMAP/SMTP settings' });

      // Test IMAP auth with a minimized, robust handshake
      try {
        const client = new ImapFlow({
          host: imapHost,
          port: imapPort,
          secure: imapSecure,
          servername: imapHost,
          disableCompression: true,
          disableAutoIdle: true,
          disableAutoEnable: true,
          verifyOnly: true, // authenticate then disconnect
          auth: { user, pass: password, loginMethod: 'LOGIN' },
          tls: imapSecure ? { servername: imapHost, minVersion: 'TLSv1.2' } : undefined,
          logger: false,
        });
        await client.connect();
      } catch (e) {
        const reason = e?.response?.text || e?.message || 'Unable to login via IMAP. Ensure IMAP is enabled and credentials are correct (for GMX use App Password if 2FA).';
        return res.status(401).json({ error: 'IMAP authentication failed', reason });
      }

      // Test SMTP auth (verify connection and auth)
      try {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpSecure,
          auth: { user, pass: password },
        });
        await transporter.verify();
      } catch (e) {
        return res.status(401).json({ error: 'SMTP authentication failed', reason: e?.message || 'Unable to login via SMTP. Check server/port and credentials.' });
      }

      // Save session in encrypted cookie
      const payload = {
        type: 'imap_smtp',
        email,
        auth: { user, pass: password },
        imap: { host: imapHost, port: imapPort, secure: imapSecure },
        smtp: { host: smtpHost, port: smtpPort, secure: smtpSecure },
        createdAt: Date.now(),
      };
      const token = encrypt(JSON.stringify(payload));
      res.cookie('other_account', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 3600 * 1000, // 30 days
      });
      return res.json({ ok: true, provider: 'IMAP/SMTP' });
    }

    if (type === 'ews') {
      const domain = email.split('@')[1].toLowerCase();
      const ewsUrl = (ews && ews.url) || `https://mail.${domain}/EWS/Exchange.asmx`;
      const allowInsecure = String(ews && ews.insecure) === 'true';
      if (!ewsUrl) return res.status(400).json({ error: 'Missing EWS URL' });

      // Minimal GetFolder call to verify credentials
      const soapBody = `<?xml version="1.0" encoding="utf-8"?>
        <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
          <soap:Body>
            <GetFolder xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
              <FolderShape><t:BaseShape>Default</t:BaseShape></FolderShape>
              <FolderIds><t:DistinguishedFolderId Id="inbox"/></FolderIds>
            </GetFolder>
          </soap:Body>
        </soap:Envelope>`;
      const basic = Buffer.from(`${user}:${password}`).toString('base64');
      const agent = new https.Agent({ rejectUnauthorized: !allowInsecure });
      const resp = await fetch(ewsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'Authorization': `Basic ${basic}`,
          'User-Agent': 'Ainbox/1.0',
        },
        body: soapBody,
        agent,
      });
      if (!resp.ok) {
        return res.status(401).json({ error: `EWS auth failed (HTTP ${resp.status})` });
      }

      // Save session
      const payload = {
        type: 'ews',
        email,
        auth: { user, pass: password },
        ews: { url: ewsUrl },
        createdAt: Date.now(),
      };
      const token = encrypt(JSON.stringify(payload));
      res.cookie('other_account', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 3600 * 1000,
      });
      return res.json({ ok: true, provider: 'EWS' });
    }

    return res.status(400).json({ error: 'Unsupported mode' });
  } catch (e) {
    console.error('Other login error:', e);
    return res.status(400).json({ error: e?.message || 'Login failed' });
  }
});

router.get('/other/status', (req, res) => {
  try {
    const token = req.cookies.other_account;
    if (!token) return res.json({ loggedIn: false });
    const json = JSON.parse(decrypt(token));
    return res.json({ loggedIn: true, type: json.type, email: json.email, hasAuth: !!json.auth });
  } catch (_) {
    return res.json({ loggedIn: false });
  }
});

router.post('/other/logout', (req, res) => {
  res.clearCookie('other_account', { path: '/' });
  res.json({ ok: true });
});

router.get('/other/logout', (req, res) => {
  res.clearCookie('other_account', { path: '/' });
  return res.redirect('/');
});

// --- Mail actions using saved Other cookie ---
function requireOther(req, res) {
  const acct = getOtherAccount(req);
  if (!acct) {
    res.status(401).json({ error: 'No Other account saved. POST /other/login first.' });
    return null;
  }
  return acct;
}

router.get('/other/inbox', async (req, res) => {
  const acct = requireOther(req, res); if (!acct) return;
  if (acct.type !== 'imap_smtp') return res.status(501).json({ error: 'Listing only supported for IMAP/SMTP accounts' });
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '20', 10)));
  const { host, port, secure } = acct.imap;
  const { user, pass } = acct.auth;
  const client = new ImapFlow({ host, port, secure, auth: { user, pass } });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const total = client.mailbox.exists || 0;
      const fromSeq = Math.max(1, total - limit + 1);
      const items = [];
      for await (const msg of client.fetch(`${fromSeq}:*`, { envelope: true, flags: true, internalDate: true, uid: true, bodyStructure: true })) {
        const env = msg.envelope || {};
        const subj = env.subject || '';
        const from = (env.from && env.from[0]) ? `${env.from[0].name || ''} <${env.from[0].address || ''}>`.trim() : '';
        const hasAttachments = !!(msg.bodyStructure && Array.isArray(msg.bodyStructure.childNodes) && msg.bodyStructure.childNodes.some(p => /attachment/i.test(p.disposition?.type || '')));
        items.push({
          uid: msg.uid,
          subject: subj,
          from,
          date: msg.internalDate,
          flags: Array.from(msg.flags || []),
          hasAttachments,
        });
      }
      // newest last by seq; reverse to newest-first
      items.reverse();
      res.json({ mailbox: 'INBOX', total, items });
    } finally {
      lock.release();
    }
  } catch (e) {
    console.error('other/inbox error:', e);
    res.status(400).json({ error: 'Unable to list INBOX', reason: e?.message });
  } finally {
    try { await client.logout(); } catch (_) {}
  }
});

// List all available mailboxes to help troubleshoot Sent/Drafts mapping
router.get('/other/mailboxes', async (req, res) => {
  const acct = requireOther(req, res); if (!acct) return;
  if (acct.type !== 'imap_smtp') return res.status(501).json({ error: 'Only for IMAP/SMTP accounts' });
  const { host, port, secure } = acct.imap;
  const { user, pass } = acct.auth;
  const client = new ImapFlow({ host, port, secure, auth: { user, pass } });
  try {
    await client.connect();
    const listed = await client.list();
    const boxes = (listed || []).map(box => ({
      name: box.name || box.path,
      path: box.path || box.name,
      flags: box.flags ? Array.from(box.flags).map(String) : [],
      specialUse: box.specialUse || null,
      delimiter: box.delimiter || '/'
    }));
    res.json({ boxes });
  } catch (e) {
    console.error('other/mailboxes error:', e);
    res.status(400).json({ error: 'Unable to list mailboxes', reason: e?.message });
  } finally {
    try { await client.logout(); } catch (_) {}
  }
});

// Helper to find best match for special folders (Sent/Drafts) across locales/providers
async function resolveSpecialMailbox(client, kind) {
  const EN_SENT = ['Sent', 'Sent Items', 'Sent Mail', 'Sent Messages'];
  const EN_DRAFTS = ['Drafts'];
  const I18N_SENT = [
    'Gesendet', 'Gesendete Elemente', 'Gesendete Objekte', 'Versendet',
    'Enviados', 'Elementos enviados', 'Itens enviados',
    'Envoyés', 'Envoyes',
    'Posta inviata', 'Elementi inviati',
    'Skickat', 'Sendt'
  ];
  const I18N_DRAFTS = ['Entwürfe', 'Entwurfe', 'Borradores', 'Rascunhos', 'Brouillons', 'Bozze'];
  const candidates = (kind === 'sent') ? [...EN_SENT, ...I18N_SENT] : [...EN_DRAFTS, ...I18N_DRAFTS];

  let boxes = [];
  try { boxes = await client.list(); } catch (_) { boxes = []; }

  const lc = (s) => String(s || '').toLowerCase();
  const nameOf = (b) => (b.name || b.path || '').toString();
  const pathOf = (b) => (b.path || b.name || '').toString();

  // 1) Prefer special-use flags
  const byFlag = boxes.find((b) => {
    const su = lc(b.specialUse || (Array.isArray(b.flags) ? b.flags.find(f => /\\(sent|drafts)/i.test(String(f))) : ''));
    return kind === 'sent' ? su.includes('sent') : su.includes('drafts');
  });
  if (byFlag) return pathOf(byFlag);

  // 2) Exact name/path match for common names (try both name and path)
  for (const c of candidates) {
    const l = lc(c);
    const m = boxes.find((b) => lc(nameOf(b)) === l || lc(pathOf(b)) === l || lc(pathOf(b)).endsWith('/' + l) || lc(pathOf(b)).endsWith('.' + l));
    if (m) return pathOf(m);
  }

  // 3) Substring heuristic
  const substr = (kind === 'sent') ? ['sent', 'gesendet', 'gesendete', 'envoy', 'enviad', 'inviat', 'skick', 'send']
                                   : ['draft', 'entwurf', 'borrador', 'rascunho', 'brouillon', 'bozz'];
  const bySub = boxes.find((b) => {
    const n = lc(nameOf(b));
    const p = lc(pathOf(b));
    return substr.some((s) => n.includes(s) || p.includes(s));
  });
  if (bySub) return pathOf(bySub);

  // 4) Fallback
  return kind === 'sent' ? 'Sent' : (kind === 'drafts' ? 'Drafts' : 'INBOX');
}

// Generic list endpoint
router.get('/other/list', async (req, res) => {
  const acct = requireOther(req, res); if (!acct) return;
  if (acct.type !== 'imap_smtp') return res.status(501).json({ error: 'Listing only supported for IMAP/SMTP accounts' });
  const folder = String(req.query.folder || 'inbox').toLowerCase();
  const unreadOnly = String(req.query.unreadOnly || 'false') === 'true';
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || '50', 10)));

  const { host, port, secure } = acct.imap;
  const { user, pass } = acct.auth;
  const client = new ImapFlow({ host, port, secure, auth: { user, pass }, disableAutoIdle: true });
  try {
    await client.connect();
    let mailbox = 'INBOX';
    if (folder === 'sent') mailbox = await resolveSpecialMailbox(client, 'sent');
    if (folder === 'drafts') mailbox = await resolveSpecialMailbox(client, 'drafts');
    try {
      await client.mailboxOpen(mailbox, { readOnly: true });
    } catch (openErr) {
      return res.status(400).json({ error: 'Unable to open folder', reason: openErr?.message || 'Open failed', mailbox });
    }
    try {
      const total = client.mailbox?.exists || 0;
      const fromSeq = total > 0 ? Math.max(1, total - limit + 1) : 1;
      const items = [];
      for await (const msg of client.fetch(`${fromSeq}:*`, { envelope: true, flags: true, internalDate: true, uid: true })) {
        const env = msg.envelope || {};
        const subj = env.subject || '';
        const from = (env.from && env.from[0]) ? `${env.from[0].name || ''} <${env.from[0].address || ''}>`.trim() : '';
        const to = (env.to && env.to[0]) ? `${env.to[0].name || ''} <${env.to[0].address || ''}>`.trim() : '';
        const flagsArr = Array.from(msg.flags || []).map(f => f.toString().toLowerCase());
        const seen = flagsArr.includes('\\seen');
        const isDraft = flagsArr.includes('\\draft');
        if (folder === 'drafts' && !isDraft) continue; // Only unsent drafts
        if (unreadOnly && seen) continue;
        items.push({ uid: msg.uid, subject: subj, from, to, date: msg.internalDate, seen });
      }
      items.reverse();
      res.json({ mailbox, total, unreadOnly, items });
    } finally {
      // no explicit lock used with mailboxOpen
    }
  } catch (e) {
    console.error('other/list error:', e);
    res.status(400).json({ error: 'Unable to list folder', reason: e?.message });
  } finally {
    try { await client.logout(); } catch (_) {}
  }
});

// HTML pages
router.get('/other/me', (req, res) => {
  const acct = getOtherAccount(req);
  if (!acct) return res.redirect('/other/login');
  const email = acct.email || 'Unknown';
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Other Mail</title>
      <style>
        body { font-family: -apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif; padding: 24px; }
        .nav a { margin-right: 12px; }
      </style>
    </head>
    <body>
      <h2>Other Account</h2>
      <div>Signed in as <strong>${email}</strong> (${acct.type})</div>
      <p class="nav">
        <a href="/other/folder/inbox">Inbox</a>
        <a href="/other/folder/unread">Unread</a>
        <a href="/other/folder/sent">Sent</a>
        <a href="/other/folder/drafts">Drafts</a>
        <a href="/other/compose">Compose</a>
        <a href="/other/logout">Logout</a>
      </p>
    </body>
  </html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

router.get('/other/folder/:name', (req, res) => {
  const acct = getOtherAccount(req);
  if (!acct) return res.redirect('/other/login');
  const name = req.params.name;
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title}</title>
      <style>
        body { font-family: -apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif; padding: 24px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border-bottom: 1px solid #e5e7eb; padding: 8px; text-align: left; }
        th { background: #f9fafb; }
        .nav a { margin-right: 12px; }
      </style>
    </head>
    <body>
      <div class="nav">
        <a href="/other/me">← Back</a>
        <a href="/other/compose" style="float:right">Compose</a>
      </div>
      <h2>${title}</h2>
      <div id="list">Loading...</div>
      <script src="/other-folder.js" data-folder="${encodeURIComponent(name)}"></script>
    </body>
  </html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

router.get('/other/compose', (req, res) => {
  const acct = getOtherAccount(req);
  if (!acct) return res.redirect('/other/login');
  const email = acct.email || 'unknown@domain';
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Compose</title>
      <style>
        body { font-family: -apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif; padding: 24px; }
        .row { display: flex; gap: 8px; margin-bottom: 8px; }
        label { width: 80px; }
        input, textarea { flex: 1; padding: 8px; }
        textarea { height: 200px; }
        .hint { color: #6b7280; font-size: 14px; margin-bottom: 8px; }
      </style>
    </head>
    <body>
      <div><a href="/other/me">← Back</a></div>
      <h2>Compose</h2>
      <div class="hint">Sending as <strong>${email}</strong></div>
      <div class="row"><label>To</label><input id="to" placeholder="someone@example.com" /></div>
      <div class="row"><label>Subject</label><input id="subject" /></div>
      <div class="row"><label>Text</label><textarea id="text"></textarea></div>
      <div class="row"><label>HTML</label><textarea id="html"></textarea></div>
      <div class="row"><label>Files</label><input id="files" type="file" multiple /></div>
      <div class="row"><label></label><button id="send">Send</button></div>
      <div id="out"></div>
      <script src="/other-compose.js"></script>
    </body>
  </html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// (Settings UI and overrides removed per request)

router.post('/other/send', async (req, res) => {
  const acct = requireOther(req, res); if (!acct) return;
  if (acct.type !== 'imap_smtp') return res.status(501).json({ error: 'Send only supported for IMAP/SMTP accounts' });
  try {
    const { from, to, cc, bcc, subject = '', text = '', html = '', attachments = [], draftUid } = req.body || {};
    if (!to) return res.status(400).json({ error: 'to is required' });
    const fromAddr = (from && String(from).trim()) || acct.email;
    const transporter = nodemailer.createTransport({
      host: acct.smtp.host,
      port: acct.smtp.port,
      secure: acct.smtp.secure,
      auth: acct.auth,
    });
    const info = await transporter.sendMail({
      from: fromAddr,
      to,
      cc,
      bcc,
      subject,
      text,
      html,
      attachments: (attachments || []).map(a => ({ filename: a.filename, content: Buffer.from(a.data, 'base64'), contentType: a.contentType })),
    });
    // Append to Sent on server to ensure it appears in Sent folder
    try {
      const { host, port, secure } = acct.imap;
      const { user, pass } = acct.auth;
      const client = new ImapFlow({ host, port, secure, auth: { user, pass } });
      await client.connect();
      try {
        const sentBox = await resolveSpecialMailbox(client, 'sent');
        // Build MIME including Message-ID returned by SMTP
        const mime = buildMime({ from: fromAddr, to: String(to).split(',').map(s=>s.trim()).filter(Boolean), cc: cc?String(cc).split(',').map(s=>s.trim()).filter(Boolean):[], bcc: bcc?String(bcc).split(',').map(s=>s.trim()).filter(Boolean):[], subject, text, html, attachments, messageId: info.messageId });
        try { await client.mailboxCreate(sentBox); } catch (_) {}
        await client.append(sentBox, Buffer.from(mime, 'utf-8'), ['\\Seen'], new Date());
        // If we had a draft UID, remove it from Drafts
        if (draftUid) {
          const draftsBox = await resolveSpecialMailbox(client, 'drafts');
          const lock = await client.getMailboxLock(draftsBox);
          try { await client.messageDelete(String(draftUid), { uid: true }); } catch (_) {}
          finally { lock.release(); }
        }
      } finally {
        try { await client.logout(); } catch (_) {}
      }
    } catch (appendErr) {
      // best-effort: log but do not fail the send
      console.error('Append to Sent failed:', appendErr);
    }
    res.json({ ok: true, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected });
  } catch (e) {
    console.error('other/send error:', e);
    res.status(400).json({ error: e?.message || 'Send failed' });
  }
});

// Build a simple MIME message for drafts (text+html+attachments)
function buildMime({ from, to = [], cc = [], bcc = [], subject = '', text = '', html = '', attachments = [], messageId }) {
  const boundaryMixed = 'mix_' + Math.random().toString(16).slice(2);
  const boundaryAlt = 'alt_' + Math.random().toString(16).slice(2);
  const lines = [];
  if (from) lines.push(`From: ${from}`);
  if (to.length) lines.push(`To: ${to.join(', ')}`);
  if (cc.length) lines.push(`Cc: ${cc.join(', ')}`);
  if (bcc.length) lines.push(`Bcc: ${bcc.join(', ')}`);
  if (subject) lines.push(`Subject: ${subject}`);
  if (messageId) lines.push(`Message-ID: ${messageId}`);
  lines.push('MIME-Version: 1.0');
  if (attachments.length) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundaryMixed}"`);
    lines.push('');
    lines.push(`--${boundaryMixed}`);
  }
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
  if (attachments.length) {
    for (const a of attachments) {
      const { filename, contentType, data } = a;
      lines.push('');
      lines.push(`--${boundaryMixed}`);
      lines.push(`Content-Type: ${contentType || 'application/octet-stream'}; name="${filename || 'file'}"`);
      lines.push('Content-Transfer-Encoding: base64');
      lines.push(`Content-Disposition: attachment; filename="${filename || 'file'}"`);
      lines.push('');
      const wrapped = String(data || '').replace(/.{1,76}/g, '$&\r\n');
      lines.push(wrapped);
    }
    lines.push(`--${boundaryMixed}--`);
  }
  return lines.join('\r\n');
}

// Save a draft by appending to IMAP Drafts with \\Draft flag
router.post('/other/draft', async (req, res) => {
  const acct = requireOther(req, res); if (!acct) return;
  if (acct.type !== 'imap_smtp') return res.status(501).json({ error: 'Drafts only supported for IMAP/SMTP accounts' });
  try {
    const { to, cc, bcc, subject = '', text = '', html = '', attachments = [], prevUid } = req.body || {};
    const toList = to ? String(to).split(',').map(s => s.trim()).filter(Boolean) : [];
    const ccList = cc ? String(cc).split(',').map(s => s.trim()).filter(Boolean) : [];
    const bccList = bcc ? String(bcc).split(',').map(s => s.trim()).filter(Boolean) : [];
    const mime = buildMime({ from: acct.email, to: toList, cc: ccList, bcc: bccList, subject, text, html, attachments });

    const { host, port, secure } = acct.imap;
    const { user, pass } = acct.auth;
    const client = new ImapFlow({ host, port, secure, auth: { user, pass } });
    await client.connect();
    try {
      const draftsBox = await resolveSpecialMailbox(client, 'drafts');
      try { await client.mailboxCreate(draftsBox); } catch (_) {}
      const lock = await client.getMailboxLock(draftsBox);
      try {
        // Replace previous draft if provided
        if (prevUid) {
          try { await client.messageDelete(String(prevUid), { uid: true }); } catch (_) { /* ignore */ }
        }
        const appendRes = await client.append(draftsBox, Buffer.from(mime, 'utf-8'), ['\\Draft'], new Date());
        const newUid = appendRes && appendRes.uid ? String(appendRes.uid) : null;
        res.json({ ok: true, mailbox: draftsBox, uid: newUid });
      } finally {
        lock.release();
      }
    } finally {
      try { await client.logout(); } catch (_) {}
    }
  } catch (e) {
    console.error('other/draft error:', e);
    res.status(400).json({ error: e?.message || 'Save draft failed' });
  }
});
