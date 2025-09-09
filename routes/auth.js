const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const { signAccessToken, signRefreshToken, msFromExp, cookieOpts } = require('../lib/tokens');

const router = express.Router();

router.get('/auth/failure', (req, res) => {
  res.status(401).send('Authentication failed.');
});

router.get('/me', requireAuth, async (req, res) => {
  const userId = Number(req.auth.sub);
  const { rows } = await query('SELECT id, email, name, picture, created_at FROM users WHERE id = $1', [userId]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
});

router.get('/profile', requireAuth, (req, res) => {
  res.send(`Welcome user ${req.auth.sub}`);
});

router.post('/auth/refresh', async (req, res) => {
  try {
    const refreshCookie = req.cookies.refresh_token;
    if (!refreshCookie) return res.status(401).json({ error: 'Missing refresh token' });

    let payload;
    try {
      payload = jwt.verify(refreshCookie, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const userId = Number(payload.sub);
    const { rows } = await query(
      `SELECT id, refresh_token_hash, expires_at, is_active FROM sessions
       WHERE user_id = $1 AND is_active = TRUE AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [userId]
    );
    if (!rows.length) return res.status(401).json({ error: 'No active session' });

    const session = rows[0];
    const match = await bcrypt.compare(refreshCookie, session.refresh_token_hash);
    if (!match) return res.status(401).json({ error: 'Refresh token not recognized' });

    await query('UPDATE sessions SET is_active = FALSE WHERE id = $1', [session.id]);

    const newAccess = signAccessToken({ sub: String(userId) });
    const newRefreshPlain = signRefreshToken({ sub: String(userId) });
    const newRefreshHash = await bcrypt.hash(newRefreshPlain, 10);
    const newSessionId = uuidv4();
    const ua = req.headers['user-agent'] || null;
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
    const expiresAt = new Date(Date.now() + msFromExp(process.env.JWT_REFRESH_EXPIRES));

    await query(
      `INSERT INTO sessions (id, user_id, refresh_token_hash, user_agent, ip, is_active, expires_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6)`,
      [newSessionId, userId, newRefreshHash, ua, ip, expiresAt]
    );

    res.cookie('access_token', newAccess, cookieOpts(msFromExp(process.env.JWT_ACCESS_EXPIRES)));
    res.cookie('refresh_token', newRefreshPlain, cookieOpts(msFromExp(process.env.JWT_REFRESH_EXPIRES)));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Refresh failed' });
  }
});

async function logoutHandler(req, res) {
  try {
    const refreshCookie = req.cookies.refresh_token;
    if (refreshCookie) {
      const payload = jwt.verify(refreshCookie, process.env.JWT_REFRESH_SECRET);
      const userId = Number(payload.sub);
      const { rows } = await query(
        `SELECT id, refresh_token_hash FROM sessions
         WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at DESC`,
        [userId]
      );
      if (rows.length) {
        for (const s of rows) {
          const match = await bcrypt.compare(refreshCookie, s.refresh_token_hash);
          if (match) {
            await query('UPDATE sessions SET is_active = FALSE WHERE id = $1', [s.id]);
            break;
          }
        }
      }
    }
  } catch (_) {
    // ignore
  } finally {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
    res.clearCookie('google_access_token', { path: '/' });
    res.clearCookie('google_refresh_token', { path: '/' });
    if (req.method === 'GET') return res.redirect('/');
    return res.json({ ok: true });
  }
}

router.post('/auth/logout', logoutHandler);
router.get('/auth/logout', logoutHandler);

module.exports = router;

// --- Dev helpers (disabled in production) ---
if (process.env.NODE_ENV !== 'production') {
  const jwt = require('jsonwebtoken');

  // Mint a dev access token for Postman testing
  router.get('/dev/token', (req, res) => {
    try {
      const sub = (req.query.sub || '1').toString();
      const email = (req.query.email || 'test@example.com').toString();
      const token = jwt.sign({ sub, email }, process.env.JWT_ACCESS_SECRET, { expiresIn: process.env.JWT_ACCESS_EXPIRES });
      res.json({ token });
    } catch (e) {
      res.status(500).json({ error: 'Failed to mint token' });
    }
  });

  // Show whether Google tokens are present (cookies only)
  router.get('/dev/google-tokens', (req, res) => {
    const cookies = req.cookies || {};
    const rt = cookies.google_refresh_token ? 'present' : 'missing';
    const at = cookies.google_access_token ? 'present' : 'missing';
    res.json({ google_refresh_token: rt, google_access_token: at });
  });
}

