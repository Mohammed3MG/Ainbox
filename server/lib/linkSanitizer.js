/**
 * Link Security and Sanitization Module
 * Handles link decoding, sanitization, and security warnings
 */

/**
 * Common tracking link patterns and their decoders
 */
const TRACKING_PATTERNS = [
  // AWS SES tracking
  {
    pattern: /^https?:\/\/[^\/]*\.awstrack\.me\/L0\/([^\/]+)\//,
    decode: (match, encodedUrl) => {
      try {
        return decodeURIComponent(encodedUrl);
      } catch (e) {
        return null;
      }
    }
  },

  // SendGrid click tracking
  {
    pattern: /^https?:\/\/sendgrid\.net\/wf\/click\?upn=([^&]+)/,
    decode: (match, encodedUrl) => {
      try {
        return decodeURIComponent(encodedUrl.replace(/_/g, '/').replace(/-/g, '+'));
      } catch (e) {
        return null;
      }
    }
  },

  // Mailchimp tracking
  {
    pattern: /^https?:\/\/[^\/]*\.list-manage\.com\/track\/click\?u=[^&]+&id=[^&]+&e=[^&]+$/,
    decode: (match) => {
      const urlParam = new URL(match).searchParams.get('url');
      return urlParam ? decodeURIComponent(urlParam) : null;
    }
  },

  // HubSpot tracking
  {
    pattern: /^https?:\/\/[^\/]*\.hs-sites\.com\/_hcms\/tracking\/[^?]+\?data=([^&]+)/,
    decode: (match, data) => {
      try {
        const decoded = decodeURIComponent(data);
        const parsed = JSON.parse(decoded);
        return parsed.url || null;
      } catch (e) {
        return null;
      }
    }
  },

  // Outlook SafeLinks
  {
    pattern: /^https?:\/\/[^\/]*\.safelinks\.protection\.outlook\.com\/\?url=([^&]+)/,
    decode: (match, encodedUrl) => {
      try {
        return decodeURIComponent(encodedUrl);
      } catch (e) {
        return null;
      }
    }
  },

  // Google click tracking
  {
    pattern: /^https?:\/\/www\.google\.com\/url\?.*[&?]url=([^&]+)/,
    decode: (match, encodedUrl) => {
      try {
        return decodeURIComponent(encodedUrl);
      } catch (e) {
        return null;
      }
    }
  },

  // Generic URL parameter tracking
  {
    pattern: /^https?:\/\/[^\/]+\/.*[&?](?:url|link|redirect|target)=([^&]+)/i,
    decode: (match, encodedUrl) => {
      try {
        const decoded = decodeURIComponent(encodedUrl);
        // Only return if it looks like a valid URL
        return decoded.match(/^https?:\/\//) ? decoded : null;
      } catch (e) {
        return null;
      }
    }
  }
];

/**
 * Decode tracking/redirect links to their real destination
 */
function decodeTrackingLink(url) {
  for (const pattern of TRACKING_PATTERNS) {
    const match = url.match(pattern.pattern);
    if (match) {
      const decoded = pattern.decode(match, ...match.slice(1));
      if (decoded && decoded !== url) {
        console.log(`🔗 Decoded tracking link: ${url.substring(0, 100)}... -> ${decoded.substring(0, 100)}...`);
        // Recursively decode in case of nested tracking
        return decodeTrackingLink(decoded);
      }
    }
  }
  return url;
}

/**
 * Check if a URL is suspicious
 */
function analyzeLinkSecurity(originalUrl, displayText = '') {
  const url = decodeTrackingLink(originalUrl);
  const warnings = [];

  try {
    const parsed = new URL(url);

    // Check for non-HTTPS
    if (parsed.protocol !== 'https:') {
      warnings.push({
        type: 'insecure',
        message: 'This link uses insecure HTTP instead of HTTPS'
      });
    }

    // Check for suspicious protocols
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      warnings.push({
        type: 'suspicious-protocol',
        message: `Suspicious protocol: ${parsed.protocol}`
      });
    }

    // Check for punycode/IDN homograph attacks
    if (parsed.hostname.includes('xn--')) {
      warnings.push({
        type: 'punycode',
        message: 'This link contains international characters that may be deceptive'
      });
    }

    // Check for IP addresses instead of domains
    if (parsed.hostname.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      warnings.push({
        type: 'ip-address',
        message: 'This link goes to an IP address instead of a domain name'
      });
    }

    // Check for mismatched display text
    if (displayText && displayText.match(/^https?:\/\//)) {
      try {
        const displayParsed = new URL(displayText);
        if (displayParsed.hostname !== parsed.hostname) {
          warnings.push({
            type: 'display-mismatch',
            message: `Link text shows ${displayParsed.hostname} but actually goes to ${parsed.hostname}`
          });
        }
      } catch (e) {
        // Display text isn't a valid URL, that's fine
      }
    }

    // Check for suspicious TLDs
    const suspiciousTlds = ['.tk', '.ml', '.ga', '.cf', '.click', '.download', '.science'];
    const tld = '.' + parsed.hostname.split('.').pop();
    if (suspiciousTlds.includes(tld)) {
      warnings.push({
        type: 'suspicious-tld',
        message: `This link uses a domain ending (${tld}) often associated with spam`
      });
    }

    // Check for excessive subdomains (potential typosquatting)
    const parts = parsed.hostname.split('.');
    if (parts.length > 4) {
      warnings.push({
        type: 'excessive-subdomains',
        message: 'This link has many subdomains, which could be suspicious'
      });
    }

  } catch (e) {
    warnings.push({
      type: 'invalid-url',
      message: 'This link appears to be malformed or invalid'
    });
  }

  return {
    originalUrl,
    decodedUrl: url,
    warnings,
    isTracking: url !== originalUrl,
    riskLevel: warnings.length === 0 ? 'safe' :
              warnings.some(w => ['suspicious-protocol', 'ip-address', 'display-mismatch'].includes(w.type)) ? 'high' :
              warnings.length > 2 ? 'medium' : 'low'
  };
}

/**
 * Sanitize an HTML string by processing all links
 */
function sanitizeLinks(html) {
  if (!html) return html;

  // Replace all <a> tags with sanitized versions
  return html.replace(/<a\s+([^>]*?)>(.*?)<\/a>/gi, (match, attributes, content) => {
    const hrefMatch = attributes.match(/href\s*=\s*["']([^"']*?)["']/i);

    if (!hrefMatch || !hrefMatch[1]) {
      // No href, remove the link but keep content
      return content;
    }

    const originalHref = hrefMatch[1];
    const displayText = content.replace(/<[^>]*>/g, '').trim(); // Strip HTML tags

    // Skip non-HTTP(S) links that are safe
    if (originalHref.startsWith('mailto:') || originalHref.startsWith('#')) {
      return `<a href="${originalHref}" target="_blank" rel="noopener noreferrer">${content}</a>`;
    }

    // Skip javascript: and data: URLs entirely
    if (originalHref.match(/^(javascript|data|vbscript):/i)) {
      console.log(`🚫 Blocked dangerous link: ${originalHref}`);
      return `<span style="color: #dc3545; text-decoration: line-through;" title="Dangerous link blocked">${content}</span>`;
    }

    try {
      const analysis = analyzeLinkSecurity(originalHref, displayText);
      const finalUrl = analysis.decodedUrl;

      let linkClass = '';
      let titleText = `Goes to: ${finalUrl}`;

      if (analysis.warnings.length > 0) {
        linkClass = `link-warning-${analysis.riskLevel}`;
        titleText += '\n⚠️ Security warnings:\n' + analysis.warnings.map(w => '• ' + w.message).join('\n');
      }

      if (analysis.isTracking) {
        titleText += '\n🔗 Original tracking link was decoded';
      }

      // Always open in new tab with security attributes
      return `<a href="${finalUrl}" target="_blank" rel="noopener noreferrer" class="${linkClass}" title="${titleText}">${content}</a>`;

    } catch (e) {
      console.error('Error sanitizing link:', originalHref, e);
      // If there's an error, just make it safe
      return `<span style="color: #dc3545;" title="Invalid link">${content}</span>`;
    }
  });
}

module.exports = {
  decodeTrackingLink,
  analyzeLinkSecurity,
  sanitizeLinks
};