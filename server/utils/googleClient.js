const { google } = require('googleapis');

function getGoogleOAuthClientFromCookies(req) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );

  const access = req.cookies.google_access_token;
  const refresh = req.cookies.google_refresh_token;

  if (refresh) {
    oauth2Client.setCredentials({ refresh_token: refresh });
  } else if (access) {
    oauth2Client.setCredentials({ access_token: access });
  }

  return oauth2Client;
}

module.exports = { getGoogleOAuthClientFromCookies };

