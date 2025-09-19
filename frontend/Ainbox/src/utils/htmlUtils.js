// Utility functions for safely parsing and rendering HTML email content

/**
 * Sanitize HTML content by removing dangerous elements and attributes
 * @param {string} html - Raw HTML content
 * @returns {string} - Sanitized HTML
 */
export function sanitizeHtml(html, { allowStyle = false } = {}) {
  if (!html || typeof html !== 'string') return ''

  // Create a temporary DOM element to parse HTML
  const temp = document.createElement('div')
  temp.innerHTML = html

  // Extended list of allowed tags for better email support
  const allowedTags = [
    'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'a', 'img', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'blockquote',
    'pre', 'code', 'hr', 'small', 'sub', 'sup', 'center', 'font', 'strike', 's', 'del', 'ins',
    'caption', 'colgroup', 'col', 'dl', 'dt', 'dd', 'address', 'cite', 'q', 'abbr', 'dfn',
    'time', 'mark', 'ruby', 'rt', 'rp', 'bdi', 'bdo', 'wbr'
  ]
  if (allowStyle) allowedTags.push('style')

  // Comprehensive list of allowed attributes for email content
  const baseAttrs = ['style', 'class', 'align', 'id', 'dir', 'lang', 'title']
  const allowedAttributes = {
    'a': ['href', 'title', 'target', 'name', 'rel', ...baseAttrs],
    'img': ['src', 'alt', 'width', 'height', 'border', 'hspace', 'vspace', 'align', 'usemap', ...baseAttrs],
    'table': ['width', 'height', 'border', 'cellpadding', 'cellspacing', 'bordercolor', 'bgcolor', 'summary', ...baseAttrs],
    'tr': ['height', 'bgcolor', 'valign', ...baseAttrs],
    'td': ['width', 'height', 'align', 'valign', 'bgcolor', 'colspan', 'rowspan', 'nowrap', ...baseAttrs],
    'th': ['width', 'height', 'align', 'valign', 'bgcolor', 'colspan', 'rowspan', 'scope', ...baseAttrs],
    'tbody': [...baseAttrs],
    'thead': [...baseAttrs],
    'tfoot': [...baseAttrs],
    'col': ['width', 'span', 'align', 'valign', ...baseAttrs],
    'colgroup': ['width', 'span', 'align', 'valign', ...baseAttrs],
    'div': ['align', ...baseAttrs],
    'span': [...baseAttrs],
    'p': ['align', ...baseAttrs],
    'font': ['face', 'size', 'color', ...baseAttrs],
    'center': [...baseAttrs],
    'blockquote': ['cite', ...baseAttrs],
    'h1': ['align', ...baseAttrs], 'h2': ['align', ...baseAttrs], 'h3': ['align', ...baseAttrs],
    'h4': ['align', ...baseAttrs], 'h5': ['align', ...baseAttrs], 'h6': ['align', ...baseAttrs],
    'ul': ['type', ...baseAttrs],
    'ol': ['type', 'start', ...baseAttrs],
    'li': ['type', 'value', ...baseAttrs]
  }

  // Remove dangerous elements
  const dangerousElements = temp.querySelectorAll(allowStyle ? 'script, object, embed, iframe, form, input, button' : 'script, style, object, embed, iframe, form, input, button')
  dangerousElements.forEach(el => el.remove())

  // Clean attributes
  const allElements = temp.querySelectorAll('*')
  allElements.forEach(el => {
    const tagName = el.tagName.toLowerCase()

    // Remove elements not in allowed list
    if (!allowedTags.includes(tagName)) {
      el.remove()
      return
    }

    // Clean attributes
    const allowedAttrs = allowedAttributes[tagName] || []
    Array.from(el.attributes).forEach(attr => {
      if (!allowedAttrs.includes(attr.name.toLowerCase())) {
        el.removeAttribute(attr.name)
      }
    })

    // Sanitize href attributes
    if (el.tagName.toLowerCase() === 'a' && el.href) {
      const href = el.getAttribute('href')
      if (href && !href.match(/^(https?:\/\/|mailto:)/i)) {
        el.removeAttribute('href')
      } else if (href && href.match(/^https?:\/\//i)) {
        el.setAttribute('target', '_blank')
        el.setAttribute('rel', 'noopener noreferrer')
      }
    }

    // Sanitize img src - allow more image sources for email content
    if (el.tagName.toLowerCase() === 'img') {
      const src = el.getAttribute('src')
      if (src) {
        // Allow HTTPS images, data URLs, and CID references
        if (src.match(/^(https:\/\/|data:image\/|cid:)/i)) {
          // Keep the src as is
        } else if (src.match(/^http:\/\//i)) {
          // Convert HTTP to HTTPS for security
          el.setAttribute('src', src.replace(/^http:\/\//, 'https://'))
        } else if (!src.match(/^(javascript:|vbscript:|data:(?!image))/i)) {
          // Relative URLs - keep them but they might not load
          // This preserves the original email structure
        } else {
          // Remove dangerous or unsupported URLs
          el.removeAttribute('src')
          el.setAttribute('alt', el.getAttribute('alt') || '[Image not available]')
        }
      }
    }
  })

  return temp.innerHTML
}

/**
 * Detect if content is HTML or plain text
 * @param {string} content - Content to check
 * @returns {boolean} - True if content appears to be HTML
 */
export function isHtmlContent(content) {
  if (!content || typeof content !== 'string') return false

  // Check for common HTML tags
  const htmlPattern = /<\/?[a-z][\s\S]*>/i
  return htmlPattern.test(content)
}

/**
 * Convert plain text to HTML with proper line breaks
 * @param {string} text - Plain text content
 * @returns {string} - HTML formatted text
 */
export function textToHtml(text) {
  if (!text || typeof text !== 'string') return ''

  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\n\r?/g, '<br>')
    .replace(/\s{2,}/g, match => '&nbsp;'.repeat(match.length))
}

/**
 * Process email content for safe rendering
 * @param {string} content - Raw email content
 * @returns {object} - Object with processed content and type
 */
export function processEmailContent(content, opts = {}) {
  if (!content) {
    return {
      content: '',
      isHtml: false,
      safeHtml: ''
    }
  }

  const isHtml = isHtmlContent(content)

  if (isHtml) {
    const sanitized = sanitizeHtml(content, opts)
    return {
      content: content,
      isHtml: true,
      safeHtml: sanitized
    }
  } else {
    const htmlFormatted = textToHtml(content)
    return {
      content: content,
      isHtml: false,
      safeHtml: htmlFormatted
    }
  }
}

// Replace cid:image references with provided data URLs or object URLs.
export function rewriteCidSrc(html, cidMap) {
  if (!html || !cidMap) return html
  return html.replace(/src=["']cid:([^"']+)["']/gi, (m, p1) => {
    const key = p1.replace(/[<>]/g, '').trim()
    const url = cidMap[key]
    if (!url) return m
    return `src="${url}"`
  })
}

export function buildIframeDoc(html) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<base target="_blank" />` +
    `<style>
      html, body {
        margin: 0;
        padding: 16px;
        background: #ffffff;
        color: #202124;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        font-size: 14px;
        line-height: 1.6;
        word-break: break-word;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      /* Image handling */
      img {
        max-width: 100%;
        height: auto;
        display: block;
        margin: 8px 0;
      }

      /* Inline images */
      img[style*="float"], img[align] {
        display: inline-block;
        margin: 0 8px 8px 0;
      }

      /* Table styling for better email layout */
      table {
        border-collapse: collapse;
        width: 100%;
        font-size: inherit;
      }

      td, th {
        padding: 8px;
        vertical-align: top;
      }

      /* Typography improvements */
      p, div {
        margin: 0 0 1em 0;
      }

      p:last-child, div:last-child {
        margin-bottom: 0;
      }

      h1, h2, h3, h4, h5, h6 {
        margin: 1.2em 0 0.6em 0;
        font-weight: 600;
        line-height: 1.3;
      }

      /* Link styling */
      a {
        color: #1a73e8;
        text-decoration: none;
      }

      a:hover {
        text-decoration: underline;
      }

      /* Quote blocks */
      blockquote {
        margin: 16px 0;
        padding: 8px 16px;
        border-left: 4px solid #e8eaed;
        background: #f8f9fa;
        font-style: italic;
      }

      /* Code blocks */
      pre, code {
        font-family: 'Courier New', monospace;
        background: #f8f9fa;
        padding: 4px 8px;
        border-radius: 4px;
      }

      pre {
        padding: 12px;
        overflow-x: auto;
      }

      /* List styling */
      ul, ol {
        padding-left: 24px;
        margin: 8px 0;
      }

      li {
        margin: 4px 0;
      }

      /* Gmail/Outlook specific */
      .gmail_quote {
        margin: 16px 0;
        padding-left: 16px;
        border-left: 3px solid #ccc;
        color: #666;
      }

      .outlook_quote {
        border-left: 3px solid #0078d4;
        padding-left: 12px;
        margin: 12px 0;
      }

      /* Preserve original styling */
      [style] {
        /* Allow inline styles to override */
      }

      /* Fix for Outlook/Exchange emails */
      .MsoNormal {
        margin: 0 0 11pt 0 !important;
      }

      /* Better handling of signatures */
      .signature, .email-signature {
        border-top: 1px solid #e8eaed;
        margin-top: 16px;
        padding-top: 16px;
        font-size: 13px;
        color: #5f6368;
      }

      /* Mobile responsive */
      @media (max-width: 480px) {
        body {
          padding: 12px;
          font-size: 16px;
        }

        table {
          font-size: 14px;
        }
      }
    </style>` +
    `</head><body>${html}</body></html>`
}

/**
 * Apply email-specific styling to HTML content
 * @param {string} html - HTML content
 * @returns {string} - HTML with email styling
 */
export function applyEmailStyles(html) {
  if (!html) return ''

  // Wrap content in a container with email-specific styles
  return `
    <div style="
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #1f2937;
      max-width: 100%;
      word-wrap: break-word;
    ">
      ${html}
    </div>
  `
}
