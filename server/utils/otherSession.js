const { decrypt } = require('./secure');

function getOtherAccount(req) {
  try {
    const token = req.cookies.other_account;
    if (!token) return null;
    const json = JSON.parse(decrypt(token));
    return json;
  } catch (_) {
    return null;
  }
}

module.exports = { getOtherAccount };

