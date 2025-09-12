const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../lib/db');
const { signAccessToken, signRefreshToken, cookieOpts, msFromExp } = require('../lib/tokens');

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
    const scope = (process.env.YAHOO_SCOPES || 'openid profile email').split(/[\s,]+/).filter(Boolean).join(' ');
    const state = uuidv4();
    res.cookie('yahoo_oauth_state', state, cookieOpts(10 * 60 * 1000));

    const params = new URLSearchParams({
      client_id: process.env.YAHOO_CLIENT_ID,
      redirect_uri: process.env.YAHOO_REDIRECT_URI,
      response_type: 'code',
      scope,
      state,
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
    const cookieState = req.cookies.yahoo_oauth_state;
    if (!code || !state || state !== cookieState) return res.redirect('/auth/failure');

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
    if (!email) return res.redirect('/auth/failure');

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

