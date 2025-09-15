const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../lib/db');
const { signAccessToken, signRefreshToken, cookieOpts, msFromExp } = require('../lib/tokens');

// Use global fetch if available (Node 18+), otherwise lazy import node-fetch@2
async function httpPostForm(url, params) {
  const body = new URLSearchParams(params);
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body };
  if (typeof fetch === 'function') {
    return fetch(url, opts);
  } else {
    const fetch2 = (await import('node-fetch')).default;
    return fetch2(url, opts);
  }
}

async function httpGetJson(url, headers = {}) {
  const opts = { method: 'GET', headers };
  if (typeof fetch === 'function') {
    return fetch(url, opts);
  } else {
    const fetch2 = (await import('node-fetch')).default;
    return fetch2(url, opts);
  }
}

const router = express.Router();

function msAuthority() {
  const tenant = process.env.MICROSOFT_TENANT_ID || 'consumers';
  // Use tenant base without trailing /v2.0; endpoints add /oauth2/v2.0/...
  return `https://login.microsoftonline.com/${tenant}`;
}

function msAuthUrls() {
  const base = msAuthority();
  return { authorize: `${base}/oauth2/v2.0/authorize`, token: `${base}/oauth2/v2.0/token` };
}

router.get('/auth/outlook', (req, res) => {
  try {
    const { authorize } = msAuthUrls();
    const scopeSet = new Set((process.env.MICROSOFT_SCOPES || 'openid profile email offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send')
      .split(/[\s,]+/)
      .filter(Boolean));
    scopeSet.add('User.Read');
    scopeSet.add('openid');
    scopeSet.add('profile');
    scopeSet.add('email');
    scopeSet.add('offline_access');
    const scopes = Array.from(scopeSet).join(' ');

    const state = uuidv4();
    res.cookie('ms_oauth_state', state, cookieOpts(10 * 60 * 1000));

    const params = new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID,
      response_type: 'code',
      redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
      response_mode: 'query',
      scope: scopes,
      state,
    });
    if ((process.env.MICROSOFT_TENANT_ID || '').toLowerCase() === 'consumers') {
      params.set('domain_hint', 'consumers');
    }
    return res.redirect(`${authorize}?${params.toString()}`);
  } catch (e) {
    console.error(e);
    return res.redirect('/auth/failure');
  }
});

router.get('/auth/outlook/callback', async (req, res) => {
  try {
    const code = req.query.code;
    const state = req.query.state;
    const cookieState = req.cookies.ms_oauth_state;
    if (!code || !state || state !== cookieState) {
      return res.redirect('/auth/failure');
    }

    const { token } = msAuthUrls();
    const scopeSet2 = new Set((process.env.MICROSOFT_SCOPES || 'openid profile email offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send')
      .split(/[\s,]+/)
      .filter(Boolean));
    scopeSet2.add('User.Read');
    scopeSet2.add('openid');
    scopeSet2.add('profile');
    scopeSet2.add('email');
    scopeSet2.add('offline_access');
    const scopes = Array.from(scopeSet2).join(' ');

    const tokenResp = await httpPostForm(token, {
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
      scope: scopes,
    });
    const tokenJson = await tokenResp.json();
    if (!tokenResp.ok) {
      console.error('MS token error:', tokenJson);
      if (process.env.NODE_ENV !== 'production') {
        return res.status(401).json({ error: 'Outlook token exchange failed', details: tokenJson });
      }
      return res.redirect('/auth/failure');
    }

    const accessToken = tokenJson.access_token;
    const refreshToken = tokenJson.refresh_token;
    const expiresIn = tokenJson.expires_in; // seconds

    // Get profile from Microsoft Graph
    const meResp = await httpGetJson('https://graph.microsoft.com/v1.0/me', {
      Authorization: `Bearer ${accessToken}`,
    });
    const me = await meResp.json();
    if (!meResp.ok) {
      console.error('MS Graph /me error:', me);
      if (process.env.NODE_ENV !== 'production') {
        return res.status(401).json({ error: 'Outlook /me failed', details: me });
      }
      return res.redirect('/auth/failure');
    }

    const msId = me.id;
    const email = me.mail || me.userPrincipalName;
    const name = me.displayName || email;
    const picture = null; // could call /photo/$value
    if (!email) return res.redirect('/auth/failure');

    // Upsert user: preserve existing google_id (do not overwrite), insert ms:... for new users
    const insertSql = `
      INSERT INTO users (google_id, email, name, picture)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name,
        picture = EXCLUDED.picture
      RETURNING id, google_id, email, name, picture;
    `;
    const { rows } = await query(insertSql, [
      `ms:${msId}`,
      email,
      name,
      picture,
    ]);
    const user = rows[0];

    // Issue app tokens + persist refresh session
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

    // Set app cookies
    res.cookie('access_token', appAccess, cookieOpts(msFromExp(process.env.JWT_ACCESS_EXPIRES)));
    res.cookie('refresh_token', appRefreshPlain, cookieOpts(msFromExp(process.env.JWT_REFRESH_EXPIRES)));
    // Set Microsoft tokens (httpOnly)
    if (accessToken) {
      res.cookie('ms_access_token', accessToken, cookieOpts(Math.max(1, Number(expiresIn || 3600)) * 1000));
    }
    if (refreshToken) {
      // Persist refresh token in accounts table (encrypted)
      try {
        const enc = require('../utils/secure').encrypt(refreshToken);
        const { v4: uuidv4 } = require('uuid');
        await query(
          `INSERT INTO accounts (id, user_id, provider, provider_account_id, email, refresh_token_encrypted, scopes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id, provider) DO UPDATE SET
             provider_account_id = EXCLUDED.provider_account_id,
             email = EXCLUDED.email,
             refresh_token_encrypted = COALESCE(EXCLUDED.refresh_token_encrypted, accounts.refresh_token_encrypted),
             scopes = COALESCE(EXCLUDED.scopes, accounts.scopes),
             updated_at = NOW()`,
          [uuidv4(), user.id, 'microsoft', msId, email, enc, scopes]
        );
      } catch (e) {
        console.error('Failed to persist Microsoft refresh token:', e.message);
      }
      res.cookie('ms_refresh_token', refreshToken, cookieOpts(msFromExp('30d')));
    }

    // Decide frontend redirect based on terms acceptance
    const currentTermsVersion = process.env.TERMS_CURRENT_VERSION || 'v1';
    let needsTerms = true;
    try {
      const { rows: urows } = await query('SELECT terms_version, terms_accepted_at FROM users WHERE id=$1', [user.id]);
      const u = urows[0];
      needsTerms = !u?.terms_accepted_at || (u?.terms_version || '') !== currentTermsVersion;
    } catch (_) { /* keep default */ }

    const base = process.env.FRONTEND_BASE_URL || '';
    const target = needsTerms ? '/terms' : '/dashboard';
    if (base && /^https?:\/\//i.test(base)) {
      return res.redirect(base.replace(/\/$/, '') + target);
    }
    return res.redirect('/me');
  } catch (e) {
    console.error(e);
    if (process.env.NODE_ENV !== 'production') {
      return res.status(401).json({ error: 'Outlook callback failed', reason: e?.message });
    }
    return res.redirect('/auth/failure');
  }
});

module.exports = { router };
