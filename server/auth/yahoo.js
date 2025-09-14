const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../lib/db');
const { signAccessToken, signRefreshToken, cookieOpts, msFromExp } = require('../lib/tokens');
const { encrypt } = require('../utils/secure');
const { ImapFlow } = require('imapflow');

async function httpPostForm(url, params, basicAuthHeader) {
  const body = new URLSearchParams(params);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (basicAuthHeader) headers.Authorization = basicAuthHeader;
  const opts = { method: 'POST', headers, body };
  if (typeof fetch === 'function') return fetch(url, opts);
  const fetch2 = (await import('node-fetch')).default;
  return fetch2(url, opts);
}

async function httpGetJson(url, headers = {}) {
  const opts = { method: 'GET', headers };
  if (typeof fetch === 'function') return fetch(url, opts);
  const fetch2 = (await import('node-fetch')).default;
  return fetch2(url, opts);
}

const router = express.Router();

function yahooAuthUrls() {
  return {
    authorize: 'https://api.login.yahoo.com/oauth2/request_auth',
    token: 'https://api.login.yahoo.com/oauth2/get_token',
    userinfo: 'https://api.login.yahoo.com/openid/v1/userinfo'
  };
}

router.get('/auth/yahoo', (req, res) => {
  try {
    const { authorize } = yahooAuthUrls();
    // Use scopes exactly as configured; default to basic OpenID scopes
    const scope = (process.env.YAHOO_SCOPES || 'openid profile email mail-r')
      .split(/[\s,]+/)
      .filter(Boolean)
      .join(' ');
    const state = uuidv4();
    const nonce = uuidv4();
    res.cookie('yahoo_oauth_state', state, cookieOpts(10 * 60 * 1000));

    const params = new URLSearchParams({
      client_id: process.env.YAHOO_CLIENT_ID,
      redirect_uri: process.env.YAHOO_REDIRECT_URI,
      response_type: 'code',
      response_mode: 'query',
      scope,
      state,
      prompt: 'consent',
      nonce,
    });
    return res.redirect(`${authorize}?${params.toString()}`);
  } catch (e) {
    console.error(e);
    return res.redirect('/auth/failure');
  }
});

router.get('/auth/yahoo/callback', async (req, res) => {
  try {
    const code = req.query.code;
    const state = req.query.state;
    const err = req.query.error;
    const errDesc = req.query.error_description;
    const cookieState = req.cookies.yahoo_oauth_state;
    if (err) {
      if (process.env.NODE_ENV !== 'production') {
        return res.status(401).json({ error: 'Yahoo authorization error', code: err, description: errDesc || null });
      }
      return res.redirect('/auth/failure');
    }
    if (!code || !state || state !== cookieState) {
      if (process.env.NODE_ENV !== 'production') {
        return res.status(401).json({
          error: 'Yahoo callback state mismatch or missing code',
          details: {
            receivedState: state || null,
            cookieState: cookieState || null,
            hasCode: !!code,
            hint: 'Ensure you started login at the same origin (http/https + host + port) as this callback and that cookies are present.'
          }
        });
      }
      return res.redirect('/auth/failure');
    }

    const { token, userinfo } = yahooAuthUrls();
    const basic = 'Basic ' + Buffer.from(`${process.env.YAHOO_CLIENT_ID}:${process.env.YAHOO_CLIENT_SECRET}`).toString('base64');
    const tResp = await httpPostForm(token, {
      grant_type: 'authorization_code',
      redirect_uri: process.env.YAHOO_REDIRECT_URI,
      code,
    }, basic);
    const tJson = await tResp.json();
    if (!tResp.ok) {
      console.error('Yahoo token error:', tJson);
      if (process.env.NODE_ENV !== 'production') return res.status(401).json({ error: 'Yahoo token exchange failed', details: tJson });
      return res.redirect('/auth/failure');
    }

    const accessToken = tJson.access_token;
    const refreshToken = tJson.refresh_token;
    const expiresIn = tJson.expires_in;

    const uResp = await httpGetJson(userinfo, { Authorization: `Bearer ${accessToken}` });
    const uJson = await uResp.json();
    if (!uResp.ok) {
      console.error('Yahoo userinfo error:', uJson);
      if (process.env.NODE_ENV !== 'production') return res.status(401).json({ error: 'Yahoo userinfo failed', details: uJson });
      return res.redirect('/auth/failure');
    }

    const email = uJson.email || uJson.preferred_username || uJson.sub;
    const name = uJson.name || uJson.given_name || email;
    const yahooId = uJson.sub;
    if (!email) {
      if (process.env.NODE_ENV !== 'production') {
        return res.status(401).json({
          error: 'Yahoo profile missing email',
          details: uJson,
          hint: 'Ensure YAHOO_SCOPES includes email, and re-consent at /auth/yahoo.'
        });
      }
      return res.redirect('/auth/failure');
    }

    const insertSql = `
      INSERT INTO users (google_id, email, name, picture)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name,
        picture = EXCLUDED.picture
      RETURNING id, google_id, email, name, picture;
    `;
    const { rows } = await query(insertSql, [
      `yh:${yahooId}`,
      email,
      name,
      null,
    ]);
    const user = rows[0];

    const appAccess = signAccessToken({ sub: String(user.id), email: user.email });
    const appRefreshPlain = signRefreshToken({ sub: String(user.id) });
    const refreshHash = await bcrypt.hash(appRefreshPlain, 10);
    const sessionId = uuidv4();
    const ua = req.headers['user-agent'] || null;
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
    const expiresAt = new Date(Date.now() + msFromExp(process.env.JWT_REFRESH_EXPIRES));

    await query(
      `INSERT INTO sessions (id, user_id, refresh_token_hash, user_agent, ip, is_active, expires_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6)`,
      [sessionId, user.id, refreshHash, ua, ip, expiresAt]
    );

    res.cookie('access_token', appAccess, cookieOpts(msFromExp(process.env.JWT_ACCESS_EXPIRES)));
    res.cookie('refresh_token', appRefreshPlain, cookieOpts(msFromExp(process.env.JWT_REFRESH_EXPIRES)));
    // Yahoo tokens for IMAP/API
    res.cookie('yh_access_token', accessToken, cookieOpts(Math.max(1, Number(expiresIn || 3600)) * 1000));
    if (refreshToken) res.cookie('yh_refresh_token', refreshToken, cookieOpts(msFromExp('30d')));

    return res.redirect('/me');
  } catch (e) {
    console.error(e);
    if (process.env.NODE_ENV !== 'production') return res.status(401).json({ error: 'Yahoo callback failed', reason: e?.message });
    return res.redirect('/auth/failure');
  }
});

module.exports = { router };

// Password-based Yahoo IMAP login (app password recommended)
// POST /auth/yahoo/password { email, appPassword }
router.post('/auth/yahoo/password', async (req, res) => {
  try {
    const { email, appPassword } = req.body || {};
    if (!email || !appPassword) return res.status(400).json({ error: 'email and appPassword are required' });

    // Verify IMAP login
    const client = new ImapFlow({
      host: 'imap.mail.yahoo.com',
      port: 993,
      secure: true,
      auth: { user: email, pass: appPassword }
    });
    await client.connect();
    await client.logout();

    // Upsert user by email
    const insertSql = `
      INSERT INTO users (google_id, email, name, picture)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name
      RETURNING id, email;
    `;
    const { rows } = await query(insertSql, [
      'yh:pw',
      email,
      email,
      null,
    ]);
    const user = rows[0];

    // Issue app tokens + persist refresh session
    const appAccess = signAccessToken({ sub: String(user.id), email: user.email });
    const appRefreshPlain = signRefreshToken({ sub: String(user.id) });
    const refreshHash = await bcrypt.hash(appRefreshPlain, 10);
    const sessionId = require('uuid').v4();
    const ua = req.headers['user-agent'] || null;
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
    const expiresAt = new Date(Date.now() + msFromExp(process.env.JWT_REFRESH_EXPIRES));
    await query(
      `INSERT INTO sessions (id, user_id, refresh_token_hash, user_agent, ip, is_active, expires_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6)`,
      [sessionId, user.id, refreshHash, ua, ip, expiresAt]
    );

    // Set app cookies
    res.cookie('access_token', appAccess, cookieOpts(msFromExp(process.env.JWT_ACCESS_EXPIRES)));
    res.cookie('refresh_token', appRefreshPlain, cookieOpts(msFromExp(process.env.JWT_REFRESH_EXPIRES)));
    // Store Yahoo app password encrypted in cookie (httpOnly)
    res.cookie('yh_pw', encrypt(appPassword), cookieOpts(msFromExp('30d')));

    return res.json({ ok: true, id: user.id, email: user.email });
  } catch (e) {
    console.error(e);
    return res.status(401).json({ error: 'Yahoo password auth failed', reason: e?.message });
  }
});
