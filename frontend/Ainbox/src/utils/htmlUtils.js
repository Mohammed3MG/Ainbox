// Utility functions for safely parsing and rendering HTML email content

/**
 * Sanitize HTML content by removing dangerous elements and attributes
 * @param {string} html - Raw HTML content
 * @returns {string} - Sanitized HTML
 */
export function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return ''

  // Create a temporary DOM element to parse HTML
  const temp = document.createElement('div')
  temp.innerHTML = html

  // List of allowed tags
  const allowedTags = [
    'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'a', 'img', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'blockquote',
    'pre', 'code', 'hr', 'small', 'sub', 'sup'
  ]

  // List of allowed attributes
  const allowedAttributes = {
    'a': ['href', 'title', 'target'],
    'img': ['src', 'alt', 'width', 'height', 'style'],
    'table': ['style', 'width', 'border', 'cellpadding', 'cellspacing'],
    'td': ['style', 'width', 'height', 'align', 'valign'],
    'th': ['style', 'width', 'height', 'align', 'valign'],
    'tr': ['style'],
    'div': ['style', 'align'],
    'span': ['style'],
    'p': ['style', 'align'],
    'h1': ['style'], 'h2': ['style'], 'h3': ['style'], 'h4': ['style'], 'h5': ['style'], 'h6': ['style']
  }

  // Remove dangerous elements
  const dangerousElements = temp.querySelectorAll('script, style, object, embed, iframe, form, input, button')
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

    // Sanitize img src
    if (el.tagName.toLowerCase() === 'img' && el.src) {
      const src = el.getAttribute('src')
      if (src && !src.match(/^(https?:\/\/|data:image\/)/i)) {
        el.removeAttribute('src')
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
export function processEmailContent(content) {
  if (!content) {
    return {
      content: '',
      isHtml: false,
      safeHtml: ''
    }
  }

  const isHtml = isHtmlContent(content)

  if (isHtml) {
    const sanitized = sanitizeHtml(content)
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