const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../lib/db');
const { signAccessToken, signRefreshToken, msFromExp, cookieOpts } = require('../lib/tokens');
const gmailSyncService = require('../lib/gmailSyncService');

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
         RETURNING id, google_id, email, name, picture, terms_version, terms_accepted_at`,
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
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify'
    ],
    accessType: 'offline',
    prompt: 'consent',
  })
);

router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/auth/failure' }),
  async (req, res) => {
    try {
      const user = req.user;
      // Decide frontend redirect based on terms acceptance
      const currentTermsVersion = process.env.TERMS_CURRENT_VERSION || 'v1';
      let needsTerms = true;
      try {
        const { rows } = await require('../lib/db').query('SELECT terms_version, terms_accepted_at FROM users WHERE id=$1', [user.id]);
        const u = rows[0];
        needsTerms = !u?.terms_accepted_at || (u?.terms_version || '') !== currentTermsVersion;
      } catch (_) { /* keep default */ }
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
        // Persist refresh token in accounts table (encrypted)
        try {
          const enc = require('../utils/secure').encrypt(user.googleRefreshToken);
          const { v4: uuidv4 } = require('uuid');
          await require('../lib/db').query(
            `INSERT INTO accounts (id, user_id, provider, provider_account_id, email, refresh_token_encrypted, scopes)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (user_id, provider) DO UPDATE SET
               provider_account_id = EXCLUDED.provider_account_id,
               email = EXCLUDED.email,
               refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
               scopes = COALESCE(EXCLUDED.scopes, accounts.scopes),
               updated_at = NOW()`,
            [uuidv4(), user.id, 'google', user.google_id, user.email, enc, 'gmail.readonly gmail.send gmail.modify openid profile email']
          );
        } catch (e) {
          console.error('Failed to persist Google refresh token:', e.message);
        }
        res.cookie('google_refresh_token', user.googleRefreshToken, cookieOpts(msFromExp('30d')));
      }

      // Auto-start enhanced Gmail Pub/Sub sync for this user after successful authentication
      const userId = String(user.id);
      const syncStatus = gmailSyncService.getSyncStatus(userId);
      if (!syncStatus.active && user.googleAccessToken && user.googleRefreshToken) {
        console.log(`🚀 Auto-starting enhanced Gmail Pub/Sub sync for newly authenticated user ${userId}`);
        gmailSyncService.startSync(userId, user.googleAccessToken, user.googleRefreshToken, user.email).catch(err => {
          console.error(`❌ Failed to auto-start enhanced Gmail sync for user ${userId}:`, err.message);
          console.log(`📊 Enhanced Gmail sync failed but continuing without old fallback (EventualConsistency Manager still active)`);
          // DISABLED: No longer falling back to old basic sync as it conflicts with EventualConsistency Manager
          // The enhanced sync will continue to work for count corrections even if Pub/Sub fails
        });
      }

      const base = process.env.FRONTEND_BASE_URL || '';
      const target = needsTerms ? '/terms' : '/dashboard';
      // If base is absolute (starts with http), redirect there; else fall back to API endpoint
      if (base && /^https?:\/\//i.test(base)) {
        return res.redirect(base.replace(/\/$/, '') + target);
      }
      // Fallback: keep legacy behavior
      res.redirect('/me');
    } catch (e) {
      console.error(e);
      res.redirect('/auth/failure');
    }
  }
);

module.exports = { configureGoogleStrategy, router };
