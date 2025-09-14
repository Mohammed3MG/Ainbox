const jwt = require('jsonwebtoken');

const isProd = process.env.NODE_ENV === 'production';

function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, { expiresIn: process.env.JWT_ACCESS_EXPIRES });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES });
}

function cookieOpts(maxAgeMs) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}

function parseBearer(req) {
  const h = req.headers.authorization;
  if (!h) return null;
  const [type, token] = h.split(' ');
  return type === 'Bearer' ? token : null;
}

function msFromExp(expString) {
  const n = parseInt(expString, 10);
  if (!expString) return 0;
  if (expString.endsWith('m')) return n * 60 * 1000;
  if (expString.endsWith('h')) return n * 60 * 60 * 1000;
  if (expString.endsWith('d')) return n * 24 * 60 * 60 * 1000;
  return n; // fallback ms
}

module.exports = {
  isProd,
  signAccessToken,
  signRefreshToken,
  cookieOpts,
  parseBearer,
  msFromExp,
};

