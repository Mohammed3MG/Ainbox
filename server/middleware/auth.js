const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query } = require('../lib/db');
const { parseBearer, signAccessToken, signRefreshToken, msFromExp, cookieOpts } = require('../lib/tokens');

function redirectIfAuthenticated(req, res, next) {
  try {
    const token = parseBearer(req) || req.cookies.access_token;
    if (token) {
      jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      return res.redirect('/me');
    }
  } catch (_) { /* ignore */ }
  return next();
}

async function requireAuth(req, res, next) {
  const token = parseBearer(req) || req.cookies.access_token;
  const refreshCookie = req.cookies.refresh_token;

  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      req.auth = payload;
      req.user = { id: Number(payload.sub) };
      return next();
    } catch (_) {
       return res.status(401).json({ error: "Invalid token" });
    }
  }

  try {
    if (!refreshCookie) return res.status(401).json({ error: 'Invalid/expired token' });

    let payload;
    try {
      payload = jwt.verify(refreshCookie, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid/expired token' });
    }

    const userId = Number(payload.sub);
    const { rows } = await query(
      `SELECT id, refresh_token_hash, expires_at, is_active FROM sessions
       WHERE user_id = $1 AND is_active = TRUE AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [userId]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid/expired token' });

    let matched = null;
    for (const s of rows) {
      if (await bcrypt.compare(refreshCookie, s.refresh_token_hash)) { matched = s; break; }
    }
    if (!matched) return res.status(401).json({ error: 'Invalid/expired token' });

    await query('UPDATE sessions SET is_active = FALSE WHERE id = $1', [matched.id]);

    const newAccess = signAccessToken({ sub: String(userId) });
    const newRefreshPlain = signRefreshToken({ sub: String(userId) });
    const newRefreshHash = await bcrypt.hash(newRefreshPlain, 10);
    const newSessionId = require('uuid').v4();
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

    req.auth = require('jsonwebtoken').verify(newAccess, process.env.JWT_ACCESS_SECRET);
    req.user = { id: userId };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid/expired token' });
  }
}

module.exports = { requireAuth, redirectIfAuthenticated };

