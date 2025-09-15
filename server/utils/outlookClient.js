const net = require('net');

async function httpPostForm(url, params) {
  const body = new URLSearchParams(params);
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body };
  if (typeof fetch === 'function') return fetch(url, opts);
  const fetch2 = (await import('node-fetch')).default;
  return fetch2(url, opts);
}

function msAuthority() {
  const tenant = process.env.MICROSOFT_TENANT_ID || 'consumers';
  return `https://login.microsoftonline.com/${tenant}`;
}

function tokenEndpoint() {
  return `${msAuthority()}/oauth2/v2.0/token`;
}

function computeScopes() {
  // Ensure essential scopes present (User.Read used for /me)
  const raw = (process.env.MICROSOFT_SCOPES || 'openid profile email offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send');
  const set = new Set(raw.split(/[\s,]+/).filter(Boolean));
  set.add('User.Read');
  set.add('offline_access');
  set.add('openid');
  set.add('profile');
  return Array.from(set).join(' ');
}

function decodeJwtExp(token) {
  try {
    const [, payload] = token.split('.');
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof json.exp === 'number' ? json.exp : null;
  } catch (_) {
    return null;
  }
}

const { query } = require('../lib/db');
const { decrypt, encrypt } = require('./secure');

async function refreshMsAccessToken(refreshToken, req, res) {
  const resp = await httpPostForm(tokenEndpoint(), {
    client_id: process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: computeScopes(),
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
  });
  const json = await resp.json();
  if (!resp.ok) {
    const err = new Error(json.error_description || json.error || 'Failed to refresh Microsoft access token');
    err.details = json;
    throw err;
  }
    // 🔎 Debug scopes
  console.log("Refreshed MS token scopes:", json.scope);

  
  const accessToken = json.access_token;
  const expiresIn = Math.max(1, Number(json.expires_in || 3600));
  res.cookie('ms_access_token', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: expiresIn * 1000,
  });
  // If refresh token rotated, persist to DB and update cookie
  if (json.refresh_token) {
    try {
      const userId = Number(req.auth?.sub);
      if (userId) {
        const enc = encrypt(json.refresh_token);
        await query(
          `UPDATE accounts SET refresh_token_encrypted=$1, updated_at=NOW() WHERE user_id=$2 AND provider='microsoft'`,
          [enc, userId]
        );
      }
    } catch (_) {}
    res.cookie('ms_refresh_token', json.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 3600 * 1000,
    });
  }
  return accessToken;
}

async function ensureMsAccessToken(req, res) {
  const cookies = req.cookies || {};
  const refreshToken = cookies.ms_refresh_token;
  let accessToken = cookies.ms_access_token;
  // Fallback: try DB for refresh token
  async function dbRefresh() {
    try {
      const userId = Number(req.auth?.sub);
      if (!userId) return null;
      const { rows } = await query('SELECT refresh_token_encrypted FROM accounts WHERE user_id=$1 AND provider=$2', [userId, 'microsoft']);
      const enc = rows[0]?.refresh_token_encrypted;
      return enc ? decrypt(enc) : null;
    } catch (_) {
      return null;
    }
  }

  // If we have an access token, verify it isn't expired (or close to expiring)
  if (accessToken) {
    const exp = decodeJwtExp(accessToken);
    const now = Math.floor(Date.now() / 1000);
    if (exp && exp - now > 60) {
      return accessToken;
    }
    // Expired or unknown exp: try to refresh if we have a refresh token
    if (refreshToken) {
      try {
        return await refreshMsAccessToken(refreshToken, req, res);
      } catch (e) {
        // Fall through to db fallback
      }
    }
    const rt2 = await dbRefresh();
    if (rt2) {
      try {
        return await refreshMsAccessToken(rt2, req, res);
      } catch (_) {}
    }
  }

  const rt = refreshToken || await dbRefresh();
  if (!rt) throw new Error('Missing Microsoft tokens; login via /auth/outlook');
  return refreshMsAccessToken(rt, req, res);
}

module.exports = { ensureMsAccessToken };
