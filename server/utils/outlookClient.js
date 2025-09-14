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

async function refreshMsAccessToken(refreshToken, res) {
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
  return accessToken;
}

async function ensureMsAccessToken(req, res) {
  const cookies = req.cookies || {};
  const refreshToken = cookies.ms_refresh_token;
  let accessToken = cookies.ms_access_token;

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
        return await refreshMsAccessToken(refreshToken, res);
      } catch (e) {
        // Fall through to error below
      }
    }
  }

  if (!refreshToken) throw new Error('Missing Microsoft tokens; login via /auth/outlook');
  return refreshMsAccessToken(refreshToken, res);
}

module.exports = { ensureMsAccessToken };
