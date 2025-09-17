const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { query } = require('../lib/db');

const router = express.Router();

function envelope({ data = null, error = null, meta = null, requestId = null }) {
  return { data, error, meta, requestId };
}

function termsMeta() {
  const version = process.env.TERMS_CURRENT_VERSION || 'v1';
  return {
    version,
    title: process.env.TERMS_TITLE || 'Terms of Use',
    htmlUrl: process.env.TERMS_HTML_URL || null,
    mdUrl: process.env.TERMS_MD_URL || null,
    updatedAt: process.env.TERMS_UPDATED_AT || null,
  };
}

// Session bootstrap: who am I + terms status
router.get('/session', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.auth.sub);
    const { rows } = await query('SELECT id, email, name, picture, terms_version, terms_accepted_at FROM users WHERE id = $1', [userId]);
    const u = rows[0];
    if (!u) return res.status(404).json(envelope({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } }));

    const tMeta = termsMeta();
    const required = !u.terms_accepted_at || (u.terms_version || '') !== tMeta.version;
    // Provider presence from accounts
    const acc = await query('SELECT provider FROM accounts WHERE user_id=$1', [userId]);
    const providers = { google: false, microsoft: false };
    for (const r of acc.rows) {
      if (r.provider === 'google') providers.google = true;
      if (r.provider === 'microsoft') providers.microsoft = true;
    }
    const out = {
      user: { id: u.id, email: u.email, name: u.name, picture: u.picture },
      terms: { required, version: tMeta.version, acceptedAt: u.terms_accepted_at },
      providers,
    };
    return res.json(envelope({ data: out }));
  } catch (e) {
    return res.status(500).json(envelope({ error: { code: 'SESSION_FAILED', message: 'Failed to load session' } }));
  }
});

// Get terms definition (metadata; optionally content URLs)
router.get('/terms', (req, res) => {
  return res.json(envelope({ data: termsMeta() }));
});

// Accept current terms version
router.post('/terms/accept', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.auth.sub);
    const version = (req.body && req.body.version) || (process.env.TERMS_CURRENT_VERSION || 'v1');
    await query(
      'UPDATE users SET terms_version = $1, terms_accepted_at = NOW() WHERE id = $2',
      [version, userId]
    );
    return res.json(envelope({ data: { ok: true, version } }));
  } catch (e) {
    return res.status(500).json(envelope({ error: { code: 'TERMS_ACCEPT_FAILED', message: 'Failed to update terms acceptance' } }));
  }
});

module.exports = router;

// --- Real-time updates (SSE) and uploads (stubs) ---
// Keep this at the end to avoid interfering with above exports

// Server-Sent Events: basic stream with keep-alives
router.get('/emails/stream', requireAuth, (req, res) => {
  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Initial ping
  res.write(': connected\n\n');

  const interval = setInterval(() => {
    // Send keepalive ping
    res.write(`event: ping\n`);
    res.write(`data: {}\n\n`);
  }, 25000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// Attachment upload stub: returns a placeholder without parsing multipart
router.post('/emails/upload-attachment', requireAuth, (req, res) => {
  // In a future iteration, switch to multer to process files.
  const fileMeta = {
    id: String(Date.now()),
    name: 'attachment',
    size: 0,
    type: 'application/octet-stream',
    url: null,
  };
  return res.json(envelope({ data: fileMeta }));
});
