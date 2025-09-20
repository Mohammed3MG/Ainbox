// Utility functions for email display logic

// Extract email address from a "Name <email@domain.com>" format
export function extractEmailAddress(emailString) {
  if (!emailString) return ''

  // Handle "Name <email@domain.com>" format
  const match = emailString.match(/<(.+?)>/)
  if (match) {
    return match[1].toLowerCase()
  }

  // Handle plain email address
  if (emailString.includes('@')) {
    return emailString.toLowerCase()
  }

  return ''
}

// Extract name from a "Name <email@domain.com>" format
export function extractDisplayName(emailString) {
  if (!emailString) return 'Unknown'

  // Handle "Name <email@domain.com>" format
  const match = emailString.match(/^(.+?)\s*<.+?>$/)
  if (match) {
    return match[1].trim()
  }

  // Handle plain email address
  if (emailString.includes('@')) {
    return emailString.split('@')[0]
  }

  return emailString
}

// Get current user email from session
let currentUserEmail = null

export async function getCurrentUserEmail() {
  if (currentUserEmail) return currentUserEmail

  try {
    const response = await fetch('/api/v1/session', { credentials: 'include' })
    if (response.ok) {
      const sessionData = await response.json()
      currentUserEmail = sessionData.data?.user?.email?.toLowerCase() || null
    }
  } catch (error) {
    console.warn('Failed to get current user email:', error)
  }

  return currentUserEmail
}

// Determine what name to show in inbox list
export function getInboxDisplayName(email, currentUserEmail) {
  if (!email) return 'Unknown'

  // Extract sender and recipient email addresses
  const senderEmail = extractEmailAddress(email.from || '')
  const recipientEmail = extractEmailAddress(email.to || '')

  // Check if this is a sent email (user is the sender)
  const isSentByUser = currentUserEmail && senderEmail && senderEmail === currentUserEmail

  if (isSentByUser && email.to) {
    // For sent emails, show recipient with "To: " prefix
    const recipientName = extractDisplayName(email.to)
    return `To: ${recipientName}`
  } else {
    // For received emails, show sender (or fallback if sender is missing)
    return extractDisplayName(email.from || 'Unknown Sender')
  }
}

// Get appropriate avatar props for inbox display
export function getInboxAvatarProps(email, currentUserEmail) {
  const senderEmail = extractEmailAddress(email.from || '')
  const recipientEmail = extractEmailAddress(email.to || '')
  const isSentByUser = currentUserEmail && senderEmail && senderEmail === currentUserEmail

  if (isSentByUser && email.to) {
    // For sent emails, show recipient's avatar
    return {
      name: extractDisplayName(email.to),
      email: recipientEmail
    }
  } else {
    // For received emails, show sender's avatar
    return {
      name: extractDisplayName(email.from || 'Unknown Sender'),
      email: senderEmail
    }
  }
}