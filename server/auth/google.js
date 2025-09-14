const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../lib/db');
const { signAccessToken, signRefreshToken, msFromExp, cookieOpts } = require('../lib/tokens');

function configureGoogleStrategy(passportInstance) {
  passportInstance.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,
    passReqToCallback: true,
  }, async (req, accessToken, refreshToken, profile, done) => {
    try {
      const googleId = profile.id;
      const email = profile.emails && profile.emails[0]?.value;
      const name = profile.displayName;
      const picture = profile.photos && profile.photos[0]?.value;

      if (!email) return done(new Error('No email returned by Google.'));

      const { rows } = await query(
        `INSERT INTO users (google_id, email, name, picture)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (google_id) DO UPDATE SET email=EXCLUDED.email, name=EXCLUDED.name, picture=EXCLUDED.picture
         RETURNING id, google_id, email, name, picture`,
        [googleId, email, name, picture]
      );
      const user = rows[0];

      done(null, { ...user, googleAccessToken: accessToken, googleRefreshToken: refreshToken });
    } catch (err) {
      done(err);
    }
  }));
}

const router = express.Router();

router.get('/google',
  passport.authenticate('google', {
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
    accessType: 'offline',
    prompt: 'consent',
  })
);

router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/auth/failure' }),
  async (req, res) => {
    try {
      const user = req.user;
      const access = signAccessToken({ sub: String(user.id), email: user.email });
      const refreshPlain = signRefreshToken({ sub: String(user.id) });

      const refreshHash = await bcrypt.hash(refreshPlain, 10);
      const sessionId = uuidv4();
      const ua = req.headers['user-agent'] || null;
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
      const expiresAt = new Date(Date.now() + msFromExp(process.env.JWT_REFRESH_EXPIRES));

      await query(
        `INSERT INTO sessions (id, user_id, refresh_token_hash, user_agent, ip, is_active, expires_at)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6)`,
        [sessionId, user.id, refreshHash, ua, ip, expiresAt]
      );

      res.cookie('access_token', access, cookieOpts(msFromExp(process.env.JWT_ACCESS_EXPIRES)));
      res.cookie('refresh_token', refreshPlain, cookieOpts(msFromExp(process.env.JWT_REFRESH_EXPIRES)));

      if (user.googleAccessToken) {
        res.cookie('google_access_token', user.googleAccessToken, cookieOpts(msFromExp('60m')));
      }
      if (user.googleRefreshToken) {
        res.cookie('google_refresh_token', user.googleRefreshToken, cookieOpts(msFromExp('30d')));
      }

      res.redirect('/me');
    } catch (e) {
      console.error(e);
      res.redirect('/auth/failure');
    }
  }
);

module.exports = { configureGoogleStrategy, router };
