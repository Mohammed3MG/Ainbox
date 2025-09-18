require('dotenv').config();
const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require('express');
const passport = require('passport');
const { redirectIfAuthenticated } = require('./middleware/auth');
const authRouter = require('./routes/auth');
const gmailRouter = require('./routes/gmail');
const outlookMailRouter = require('./routes/outlook');
const { configureGoogleStrategy, router: googleRouter } = require('./auth/google');
const { router: outlookRouter } = require('./auth/outlook');
const { router: yahooRouter } = require('./auth/yahoo');
const { router: otherRouter } = require('./routes/other');
const mailRouter = require('./routes/mail');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const apiV1 = require('./routes/api_v1');
const aiRoutes = require('./routes/ai');

const app = express();
const { runMigrations } = require('./lib/migrate');
app.use(helmet());
// Serve static assets (for CSP-compliant scripts like /other.js)
app.use(express.static('public'));
app.use(cors({
  origin: true, // adjust to your frontend origin in prod
  credentials: true
}));
// Increase JSON limit to allow base64 attachments in compose API (tune per needs)
app.use(express.json({ limit: '35mb' }));
app.use(cookieParser());
app.use(passport.initialize());
// Configure Google OAuth strategy when env is present
const hasGoogle = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL;
if (hasGoogle) {
  configureGoogleStrategy(passport);
} else {
  console.warn('Google OAuth disabled: missing GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL');
}

// Mount routers
app.use(googleRouter);
app.use(outlookRouter);
app.use(authRouter);
app.use(gmailRouter);
app.use(outlookMailRouter);
app.use(yahooRouter);
app.use(require('./routes/yahoo'));
app.use(mailRouter);
app.use(otherRouter);
app.use('/api/v1', apiV1);
app.use(aiRoutes);


// Health endpoints
app.get('/healthz', (req, res) => res.status(200).send('ok'));
app.get('/readyz', (req, res) => res.status(200).send('ready'));

// Public home
app.get('/', redirectIfAuthenticated, (req, res) => {
  res.send('<div style="display:flex;gap:12px;"><a href="/google">Login with Google</a><a href="/auth/outlook">Login with Outlook</a><a href="/auth/yahoo">Login with Yahoo</a><a href="/other">Other (IMAP/SMTP or Exchange)</a></div>');
});


// SSL options from .env (optional for dev)
let sslOptions = null;
try {
  const keyPath = process.env.SSL_KEY;
  const certPath = process.env.SSL_CERT;
  if (keyPath && certPath && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    sslOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
  } else {
    console.warn('HTTPS disabled: SSL_KEY/SSL_CERT not configured or files missing.');
  }
} catch (e) {
  console.warn('HTTPS disabled: failed to read SSL key/cert:', e?.message);
}


// app.listen(3000, () => {
//     console.log('Server is running at Port 3000');
// });

async function startHttp(app) {
  const base = parseInt(process.env.HTTP_PORT || '3000', 10);
  const maxTries = 10;
  for (let i = 0; i < maxTries; i++) {
    const port = base + i;
    try {
      await new Promise((resolve, reject) => {
        const srv = http.createServer(app);
        srv.once('error', (err) => {
          if (err && err.code === 'EADDRINUSE') {
            console.warn(`HTTP port ${port} in use, trying ${port + 1}...`);
            try { srv.close(); } catch (_) {}
            reject(err);
          } else {
            reject(err);
          }
        });
        srv.listen(port, () => {
          console.log(`✅ HTTP server running at http://localhost:${port}`);
          resolve();
        });
      });
      return; // started
    } catch (e) {
      if (!(e && e.code === 'EADDRINUSE')) throw e;
      // else try next port
    }
  }
  throw new Error(`No available HTTP ports from ${base} to ${base + maxTries - 1}`);
}

async function startHttps(app, ssl) {
  const base = parseInt(process.env.HTTPS_PORT || '3443', 10);
  const maxTries = 5;
  for (let i = 0; i < maxTries; i++) {
    const port = base + i;
    try {
      await new Promise((resolve, reject) => {
        const srv = https.createServer(ssl, app);
        srv.once('error', (err) => {
          if (err && err.code === 'EADDRINUSE') {
            console.warn(`HTTPS port ${port} in use, trying ${port + 1}...`);
            try { srv.close(); } catch (_) {}
            reject(err);
          } else {
            reject(err);
          }
        });
        srv.listen(port, () => {
          console.log(`🔒 HTTPS server running at https://localhost:${port}`);
          resolve();
        });
      });
      return; // started
    } catch (e) {
      if (!(e && e.code === 'EADDRINUSE')) throw e;
    }
  }
  console.warn(`HTTPS disabled: no available ports from ${base} to ${base + maxTries - 1}`);
}

// Run minimal migrations and start servers
(async () => {
  try {
    await runMigrations();
    console.log('🛠️  DB migrations applied.');
  } catch (e) {
    console.error('Migration failed:', e);
  }

  await startHttp(app);

  if (sslOptions) await startHttps(app, sslOptions);
})();
