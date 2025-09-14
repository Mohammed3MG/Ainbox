async function httpPostForm(url, params, basicAuthHeader) {
  const body = new URLSearchParams(params);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (basicAuthHeader) headers.Authorization = basicAuthHeader;
  const opts = { method: 'POST', headers, body };
  if (typeof fetch === 'function') return fetch(url, opts);
  const fetch2 = (await import('node-fetch')).default;
  return fetch2(url, opts);
}

function yahooTokenEndpoint() {
  return 'https://api.login.yahoo.com/oauth2/get_token';
}

async function ensureYahooAccessToken(req, res) {
  const access = req.cookies.yh_access_token;
  const refresh = req.cookies.yh_refresh_token;
  if (access) return access;
  if (!refresh) throw new Error('Missing Yahoo tokens; login via /auth/yahoo or /auth/yahoo/password');

  const basic =
    'Basic ' + Buffer.from(`${process.env.YAHOO_CLIENT_ID}:${process.env.YAHOO_CLIENT_SECRET}`).toString('base64');
  const resp = await httpPostForm(
    yahooTokenEndpoint(),
    {
      grant_type: 'refresh_token',
      refresh_token: refresh,
      redirect_uri: process.env.YAHOO_REDIRECT_URI,
    },
    basic
  );
  const json = await resp.json();
  if (!resp.ok) {
    const err = new Error(json.error_description || json.error || 'Yahoo token refresh failed');
    err.details = json;
    throw err;
  }
  const accessToken = json.access_token;
  const expiresIn = Math.max(1, Number(json.expires_in || 3600));
  res.cookie('yh_access_token', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: expiresIn * 1000,
  });
  return accessToken;
}

module.exports = { ensureYahooAccessToken };

