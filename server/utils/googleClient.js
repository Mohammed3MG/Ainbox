const { google } = require('googleapis');
const { query } = require('../lib/db');
const { decrypt } = require('./secure');

async function getDbRefreshToken(req) {
  try {
    const userId = Number(req.auth?.sub);
    if (!userId) return null;
    const { rows } = await query('SELECT refresh_token_encrypted FROM accounts WHERE user_id=$1 AND provider=$2', [userId, 'google']);
    const enc = rows[0]?.refresh_token_encrypted;
    return enc ? decrypt(enc) : null;
  } catch (_) {
    return null;
  }
}

function newOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );
}

async function getGoogleOAuthClientFromCookies(req) {
  const oauth2Client = newOAuthClient();
  // Prefer DB refresh token when available
  const dbRefresh = await getDbRefreshToken(req);
  if (dbRefresh) {
    oauth2Client.setCredentials({ refresh_token: dbRefresh });
    return oauth2Client;
  }
  const access = req.cookies.google_access_token;
  const refresh = req.cookies.google_refresh_token;
  if (refresh) oauth2Client.setCredentials({ refresh_token: refresh });
  else if (access) oauth2Client.setCredentials({ access_token: access });
  return oauth2Client;
}

module.exports = { getGoogleOAuthClientFromCookies };
