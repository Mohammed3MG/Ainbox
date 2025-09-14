// Utility to detect mail provider capabilities for custom domains
// Returns one of: "EWS" or "IMAP/SMTP"

const dns = require('dns').promises;
const fetch = require('node-fetch');

// Known MX indicators for hosted providers we already support elsewhere
const GOOGLE_MX_HINTS = [
  'aspmx.l.google.com',
  'google.com',
  'googlemail.com',
  'gmail-smtp-in.l.google.com',
];

const MICROSOFT_MX_HINTS = [
  'protection.outlook.com',
  'outlook.com',
  'office365.com',
  'microsoft.com',
];

function isHostedBy(mxHost, hints) {
  const host = String(mxHost || '').toLowerCase();
  return hints.some((h) => host.includes(h));
}

async function tryAutodiscover(domain) {
  const url = `https://autodiscover.${domain}/autodiscover/autodiscover.xml`;
  try {
    // node-fetch v2 supports a timeout option (milliseconds)
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'text/xml, application/xml;q=0.9, */*;q=0.8',
      },
      timeout: 5000,
    });
    // Treat any non-network response other than a hard 404 as a sign EWS/Autodiscover exists
    // Many EWS endpoints return 401/403 without credentials, which is fine for detection
    if (resp && resp.status && resp.status !== 404) {
      return true;
    }
  } catch (err) {
    // Network/TLS errors mean autodiscover likely not reachable
  }
  return false;
}

/**
 * Detects provider type for a given email.
 * - Extracts domain from the email
 * - MX lookup via dns/promises
 * - If not hosted by Google/Microsoft, probes Autodiscover for Exchange (EWS)
 * - Returns "EWS" if Autodiscover responds, otherwise "IMAP/SMTP"
 *
 * @param {string} email
 * @returns {Promise<'EWS'|'IMAP/SMTP'>}
 */
async function detectMailProvider(email) {
  if (typeof email !== 'string' || !email.includes('@')) {
    return 'IMAP/SMTP';
  }
  const domain = email.split('@')[1].trim().toLowerCase();
  if (!domain) return 'IMAP/SMTP';

  let mxRecords = [];
  try {
    mxRecords = await dns.resolveMx(domain);
  } catch (_) {
    // If MX lookup fails, fall back to IMAP/SMTP
    return 'IMAP/SMTP';
  }

  // If domain is clearly hosted by Google or Microsoft, skip autodiscover and default to IMAP/SMTP
  const isGoogleHosted = mxRecords.some((mx) => isHostedBy(mx.exchange, GOOGLE_MX_HINTS));
  const isMicrosoftHosted = mxRecords.some((mx) => isHostedBy(mx.exchange, MICROSOFT_MX_HINTS));

  if (!isGoogleHosted && !isMicrosoftHosted) {
    const hasAutodiscover = await tryAutodiscover(domain);
    if (hasAutodiscover) return 'EWS';
  }

  return 'IMAP/SMTP';
}

module.exports = { detectMailProvider };

// Example usage (run this file directly: `node utils/detectMailProvider.js`)
if (require.main === module) {
  const testEmail = process.argv[2] || 'mohammed@korektel.com';
  detectMailProvider(testEmail)
    .then((result) => {
      console.log(`Provider for ${testEmail}: ${result}`);
    })
    .catch((err) => {
      console.error('Detection error:', err && err.message ? err.message : err);
      console.log('Falling back to IMAP/SMTP');
    });
}

