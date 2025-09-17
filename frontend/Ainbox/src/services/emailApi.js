import { apiFetch } from './apiClient'

// Get current user's provider from session
let userProvider = null
export async function getCurrentProvider() {
  if (!userProvider) {
    try {
      const session = await apiFetch('/api/v1/session')
      console.log('Session response for provider detection:', session)

      const providers = session.data?.providers || {}
      const user = session.data?.user || {}

      // Try multiple ways to detect Microsoft/Outlook users
      if (providers.microsoft || providers.outlook ||
          user.provider === 'microsoft' || user.provider === 'outlook' ||
          user.email?.includes('@outlook.') || user.email?.includes('@hotmail.') ||
          user.email?.includes('@live.')) {
        userProvider = 'outlook'
      } else if (providers.google || user.provider === 'google' ||
                 user.email?.includes('@gmail.')) {
        userProvider = 'gmail'
      } else {
        // Default based on session data or fallback
        userProvider = 'gmail'
        console.warn('Could not determine provider, defaulting to gmail. Session:', session)
      }

      console.log(`Detected provider: ${userProvider} for user:`, user.email)
    } catch (error) {
      console.error('Failed to detect provider:', error)
      userProvider = 'gmail'
    }
  }
  return userProvider
}

// Reset provider cache when needed
export function resetProviderCache() {
  userProvider = null
}

// Cache for email data to improve performance
const emailCache = new Map()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

function getCacheKey(folder, cursor, limit, search, provider) {
  const c = cursor ? String(cursor) : 'first';
  return `${provider}-${folder}-${c}-${limit}-${search}`
}

function getCachedData(key) {
  const cached = emailCache.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }
  return null
}

function setCachedData(key, data) {
  emailCache.set(key, {
    data,
    timestamp: Date.now()
  })
}

// Email folder management
export async function getEmails(folder = 'inbox', cursor = null, limit = 50, search = '') {
  try {
    const provider = await getCurrentProvider()
    const cacheKey = getCacheKey(folder, cursor, limit, search, provider)

    // Only use cache for first page to ensure pagination works correctly
    const cachedData = !cursor ? getCachedData(cacheKey) : null
    if (cachedData) {
      return cachedData
    }

    let endpoint = ''
    let params = new URLSearchParams()

    if (provider === 'gmail') {
      // Gmail endpoints
      params.set('maxResults', limit.toString())
      // Use pageToken for pagination (no numeric pages)
      if (cursor) params.set('pageToken', String(cursor))

      switch (folder) {
        case 'inbox':
          endpoint = '/threads'
          // Filter for primary emails only (exclude promotions, social, updates)
          params.set('q', 'category:primary')
          break
        case 'starred':
          endpoint = '/threads'
          params.set('q', 'is:starred')
          break
        case 'sent':
          endpoint = '/threads/sent'
          // Optimize sent folder by requesting only essential fields
          params.set('fields', 'threads(threadId,snippet,historyId),nextPageToken')
          break
        case 'drafts':
          endpoint = '/drafts'
          break
        case 'archive':
          endpoint = '/threads'
          params.set('q', 'in:archive')
          break
        case 'trash':
          endpoint = '/threads'
          params.set('q', 'in:trash')
          break
        default:
          endpoint = '/threads'
      }

      // Handle search query combined with folder filters
      if (search) {
        const existingQ = params.get('q') || ''
        const combinedQ = existingQ ? `${existingQ} ${search}` : search
        params.set('q', combinedQ)
      }
    } else if (provider === 'outlook') {
      // Outlook endpoints
      params.set('top', limit.toString())
      // Microsoft Graph uses $skiptoken-based pagination from previous response
      if (cursor) params.set('skiptoken', String(cursor))
      if (search) params.set('q', search)

      switch (folder) {
        case 'inbox':
          endpoint = '/outlook/inbox'
          // Filter for focused inbox (primary emails)
          params.set('filter', "inferenceClassification eq 'focused'")
          break
        case 'starred':
          endpoint = '/outlook/messages'
          params.set('folder', 'inbox')
          params.set('q', 'importance eq high') // Outlook uses importance instead of starred
          break
        case 'sent':
          endpoint = '/outlook/sent'
          // Optimize sent folder with select fields
          params.set('select', 'id,conversationId,subject,bodyPreview,from,receivedDateTime,isRead,importance,hasAttachments')
          break
        case 'drafts':
          endpoint = '/outlook/drafts'
          break
        case 'archive':
          endpoint = '/outlook/messages'
          params.set('folder', 'archive')
          break
        case 'trash':
          endpoint = '/outlook/messages'
          params.set('folder', 'deleteditems')
          break
        default:
          endpoint = '/outlook/inbox'
      }
    }

    let response
    try {
      response = await apiFetch(`${endpoint}?${params}`)
    } catch (apiError) {
      if (apiError.status === 401) {
        console.log('Authentication failed for getEmails, resetting provider cache and retrying...')

        // Reset provider cache and try to refresh session
        resetProviderCache()

        try {
          // Try to refresh the session
          await apiFetch('/api/v1/session/refresh', { method: 'POST' })

          // Retry the original request once more
          response = await apiFetch(`${endpoint}?${params}`)
        } catch (refreshError) {
          console.error('Session refresh failed in getEmails:', refreshError)
          throw new Error('Authentication expired. Please refresh the page and try again.')
        }
      } else {
        throw apiError
      }
    }

    // Transform the response to match our expected format
    let emails = []

    if (provider === 'gmail') {
      if (folder === 'drafts') {
        emails = (response.drafts || []).map(draft => ({
          id: draft.draftId,
          threadId: draft.id,
          from: draft.from || 'Draft',
          fromEmail: draft.from || '',
          subject: draft.subject || '(No Subject)',
          preview: draft.snippet || '',
          date: draft.date,
          time: formatTimeFromDate(draft.date),
          isRead: true,
          isStarred: false,
          hasAttachment: false,
          labels: ['drafts'],
          avatar: null
        }))
      } else {
        emails = (response.threads || []).map(thread => ({
          id: thread.threadId,
          threadId: thread.threadId,
          from: extractNameFromEmail(thread.from),
          fromEmail: extractEmailFromString(thread.from),
          subject: thread.subject || '(No Subject)',
          preview: thread.snippet || '',
          date: thread.date,
          time: formatTimeFromDate(thread.date),
          isRead: !thread.isUnread,
          isStarred: (thread.labelIds || []).includes('STARRED'),
          hasAttachment: (thread.labelIds || []).includes('HAS_ATTACHMENT'),
          labels: mapGmailLabelsToCustom(thread.labelIds || []),
          avatar: `https://i.pravatar.cc/40?u=${extractEmailFromString(thread.from)}`
        }))
      }
    } else if (provider === 'outlook') {
      emails = (response.messages || []).map(message => ({
        id: message.conversationId || message.id, // Use conversationId as main ID for threading
        threadId: message.conversationId || message.id,
        messageId: message.id, // Keep original message ID for reference
        from: extractNameFromEmail(message.from),
        fromEmail: extractEmailFromString(message.from),
        subject: message.subject || '(No Subject)',
        preview: message.snippet || message.bodyPreview || '',
        date: message.receivedDateTime || message.date,
        time: formatTimeFromDate(message.receivedDateTime || message.date),
        isRead: message.isRead,
        isStarred: message.importance === 'high',
        hasAttachment: message.hasAttachments,
        labels: mapOutlookLabelsToCustom(message),
        avatar: `https://i.pravatar.cc/40?u=${extractEmailFromString(message.from)}`
      }))
    }

    // Compute pagination cursor
    let nextCursor = null
    if (provider === 'gmail') {
      nextCursor = response.nextPageToken || null
    } else if (provider === 'outlook') {
      nextCursor = response.nextSkipToken || null
    }

    const result = {
      emails,
      total: response.total || emails.length,
      hasMore: !!nextCursor,
      nextCursor
    }

    // Cache the result for better performance (only first page)
    if (!cursor) {
      setCachedData(cacheKey, result)
    }

    return result
  } catch (error) {
    console.error('Failed to fetch emails:', error)
    throw error
  }
}

export async function getEmailThread(threadId) {
  try {
    const provider = await getCurrentProvider()
    let response

    // Add better error handling and validation
    if (!threadId) {
      throw new Error('Thread ID is required')
    }

    console.log(`Loading thread ${threadId} for provider ${provider}`)

    try {
      if (provider === 'gmail') {
        response = await apiFetch(`/threads/${threadId}?includeAttachments=true`)
      } else if (provider === 'outlook') {
        // For Outlook, try different endpoint patterns
        try {
          response = await apiFetch(`/outlook/thread/${threadId}?includeAttachments=true`)
        } catch (outlookError) {
          if (outlookError.status === 404) {
            // Try alternative endpoint format
            console.log('Trying alternative Outlook endpoint format...')
            response = await apiFetch(`/outlook/conversation/${threadId}?includeAttachments=true`)
          } else {
            throw outlookError
          }
        }
      } else {
        throw new Error(`Unsupported provider: ${provider}`)
      }
    } catch (apiError) {
      console.error(`API call failed for ${provider}:`, apiError)

      // Handle specific error cases
      if (apiError.status === 401) {
        console.log('Authentication failed, resetting provider cache and trying to refresh session...')

        // Reset provider cache and try to refresh session
        resetProviderCache()

        try {
          // Try to refresh the session
          const refreshResponse = await apiFetch('/api/v1/session/refresh', { method: 'POST' })
          console.log('Session refresh response:', refreshResponse)

          // Retry the original request once more
          const retryProvider = await getCurrentProvider()
          if (retryProvider === 'gmail') {
            response = await apiFetch(`/threads/${threadId}?includeAttachments=true`)
          } else if (retryProvider === 'outlook') {
            try {
              response = await apiFetch(`/outlook/thread/${threadId}?includeAttachments=true`)
            } catch (retryError) {
              if (retryError.status === 404) {
                response = await apiFetch(`/outlook/conversation/${threadId}?includeAttachments=true`)
              } else {
                throw retryError
              }
            }
          }
        } catch (refreshError) {
          console.error('Session refresh failed:', refreshError)
          throw new Error('Authentication expired. Please log out and log back in.')
        }
      } else if (apiError.status === 403) {
        throw new Error('Access denied. You may not have permission to view this conversation.')
      } else if (apiError.status === 404) {
        throw new Error('Conversation not found. It may have been deleted or moved.')
      } else if (apiError.status >= 500) {
        throw new Error('Server error. Please try again later.')
      } else {
        throw apiError
      }
    }

    if (!response) {
      throw new Error('No response received from server')
    }

    // Transform the thread response to match our expected format
    const messages = (response.messages || []).map(message => {
      let body = ''
      let attachments = []

      if (provider === 'gmail') {
        body = message.text || message.html || ''
        attachments = (message.attachments || []).map(att => ({
          id: att.filename || Math.random().toString(),
          name: att.filename || 'attachment',
          size: att.size || 0,
          type: att.mimeType || 'application/octet-stream'
        }))
      } else if (provider === 'outlook') {
        body = message.html || message.text || ''
        attachments = (message.attachments || []).map(att => ({
          id: att.filename || Math.random().toString(),
          name: att.filename || 'attachment',
          size: att.size || 0,
          type: att.mimeType || 'application/octet-stream'
        }))
      }

      // Ensure safe handling of 'to' field
      let toRecipients = []
      if (message.to) {
        if (Array.isArray(message.to)) {
          toRecipients = message.to
        } else if (typeof message.to === 'string') {
          toRecipients = message.to.split(',').map(s => s.trim()).filter(Boolean)
        }
      }

      return {
        id: message.id || `msg-${Date.now()}-${Math.random()}`,
        from: extractNameFromEmail(message.from) || 'Unknown Sender',
        fromEmail: extractEmailFromString(message.from) || 'unknown@example.com',
        to: toRecipients,
        cc: Array.isArray(message.cc) ? message.cc :
            message.cc ? message.cc.split(',').map(s => s.trim()).filter(Boolean) : [],
        bcc: Array.isArray(message.bcc) ? message.bcc :
             message.bcc ? message.bcc.split(',').map(s => s.trim()).filter(Boolean) : [],
        date: message.date || new Date().toISOString(),
        subject: message.subject || '(No Subject)',
        body: body || 'No content available',
        attachments,
        isRead: provider === 'gmail' ?
                !(message.labelIds || []).includes('UNREAD') :
                message.isRead !== false,
        isStarred: provider === 'gmail' ?
                  (message.labelIds || []).includes('STARRED') :
                  message.importance === 'high',
        labels: provider === 'gmail' ?
                mapGmailLabelsToCustom(message.labelIds || []) :
                mapOutlookLabelsToCustom(message)
      }
    })

    if (messages.length === 0) {
      throw new Error('No messages found in thread')
    }

    const thread = {
      id: response.threadId || threadId,
      subject: messages[0]?.subject || '(No Subject)',
      participants: extractParticipants(messages),
      messages
    }

    console.log(`Successfully loaded thread with ${messages.length} messages`)
    return thread
  } catch (error) {
    console.error('Failed to fetch email thread:', error)
    throw new Error(`Failed to load conversation: ${error.message}`)
  }
}

// Inbox stats (total + unread) - for primary emails only
export async function getInboxStats() {
  try {
    const provider = await getCurrentProvider()
    if (provider === 'gmail') {
      // Get stats for primary emails only
      const res = await apiFetch('/threads/stats?q=category:primary')
      return { total: res.total || 0, unread: res.unread || 0 }
    }
    if (provider === 'outlook') {
      // Get stats for focused inbox (primary emails)
      const res = await apiFetch("/outlook/inbox-stats?filter=" + encodeURIComponent("inferenceClassification eq 'focused'"))
      return { total: res.total || 0, unread: res.unread || 0 }
    }
    return { total: 0, unread: 0 }
  } catch (e) {
    console.warn('Failed to load inbox stats:', e)
    return { total: 0, unread: 0 }
  }
}

export async function getEmailById(emailId) {
  const response = await apiFetch(`/api/v1/emails/${emailId}`)
  return response.data
}

// Email actions - Note: Your backend focuses on reading emails
// For actions like star/archive/delete, you would need to add Gmail API endpoints
// For now, these are placeholder functions that could be implemented
export async function markEmailAsRead(emailIds) {
  const ids = Array.isArray(emailIds) ? emailIds : [emailIds]
  const provider = await getCurrentProvider()

  console.log(`Marking emails as read:`, ids, `Provider:`, provider)

  try {
    if (provider === 'gmail') {
      // Use Gmail API to mark emails as read
      const response = await apiFetch('/threads/read', {
        method: 'POST',
        body: { threadIds: ids }
      })
      console.log('Gmail mark-read response:', response)
      return response
    } else if (provider === 'outlook') {
      // Use Outlook API to mark emails as read
      const response = await apiFetch('/outlook/read', {
        method: 'POST',
        body: { messageIds: ids }
      })
      console.log('Outlook mark-read response:', response)
      return response
    }
  } catch (error) {
    console.error('Failed to mark emails as read on provider:', error)
    // Still return success for local UI updates even if provider sync fails
    console.warn('Provider sync failed, but continuing with local updates')
  }

  return { success: true }
}

export async function markEmailAsUnread(emailIds) {
  const ids = Array.isArray(emailIds) ? emailIds : [emailIds]
  const provider = await getCurrentProvider()

  try {
    if (provider === 'gmail') {
      // Use Gmail API to mark emails as unread
      const response = await apiFetch('/threads/unread', {
        method: 'POST',
        body: { threadIds: ids }
      })
      console.log('Gmail mark-unread response:', response)
      return response
    } else if (provider === 'outlook') {
      // Use Outlook API to mark emails as unread
      const response = await apiFetch('/outlook/unread', {
        method: 'POST',
        body: { messageIds: ids }
      })
      console.log('Outlook mark-unread response:', response)
      return response
    }
  } catch (error) {
    console.error('Failed to mark emails as unread:', error)
    throw error
  }

  return { success: true }
}

export async function starEmail(emailIds) {
  console.log('Star emails:', emailIds)
  // Would need Gmail API endpoint: /gmail/messages/modify with addLabelIds: ['STARRED']
  return { success: true }
}

export async function unstarEmail(emailIds) {
  console.log('Unstar emails:', emailIds)
  // Would need Gmail API endpoint: /gmail/messages/modify with removeLabelIds: ['STARRED']
  return { success: true }
}

export async function archiveEmails(emailIds) {
  console.log('Archive emails:', emailIds)
  // Would need Gmail API endpoint: /gmail/messages/modify with removeLabelIds: ['INBOX']
  return { success: true }
}

export async function deleteEmails(emailIds) {
  console.log('Delete emails:', emailIds)
  // Would need Gmail API endpoint: /gmail/messages/trash
  return { success: true }
}

export async function moveEmails(emailIds, folder) {
  console.log('Move emails to folder:', emailIds, folder)
  // Would need Gmail API endpoint: /gmail/messages/modify with appropriate label changes
  return { success: true }
}

// Compose and send
export async function sendEmail(emailData) {
  try {
    const provider = await getCurrentProvider()

    // Prepare the request body based on provider
    const requestBody = {
      to: emailData.to,
      cc: emailData.cc || [],
      bcc: emailData.bcc || [],
      subject: emailData.subject,
      text: emailData.body,
      html: '', // Could convert text to HTML if needed
      attachments: (emailData.attachments || []).map(att => ({
        filename: att.name || att.file?.name,
        contentType: att.file?.type || 'application/octet-stream',
        data: att.data || '' // Base64 encoded file data
      }))
    }

    let endpoint = ''

    if (provider === 'gmail') {
      // Gmail compose endpoint
      requestBody.provider = 'gmail'
      requestBody.from = emailData.from || 'user@gmail.com' // Would get from session

      if (emailData.replyToId) {
        endpoint = '/reply'
        requestBody.messageId = emailData.replyToId
      } else {
        endpoint = '/compose'
      }
    } else if (provider === 'outlook') {
      // Outlook compose endpoint
      endpoint = '/outlook/compose'
      // Outlook doesn't need explicit from address, uses authenticated user
    }

    return await apiFetch(endpoint, {
      method: 'POST',
      body: requestBody
    })
  } catch (error) {
    console.error('Failed to send email:', error)
    throw error
  }
}

export async function saveDraft(emailData) {
  return await apiFetch('/api/v1/emails/draft', {
    method: 'POST',
    body: emailData
  })
}

export async function uploadAttachment(file, onProgress) {
  const formData = new FormData()
  formData.append('file', file)

  // Create XMLHttpRequest for progress tracking
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const progress = (event.loaded / event.total) * 100
        onProgress?.(progress)
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText)
          resolve(response.data)
        } catch (error) {
          reject(new Error('Invalid response format'))
        }
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`))
      }
    })

    xhr.addEventListener('error', () => {
      reject(new Error('Upload failed'))
    })

    xhr.open('POST', '/api/v1/emails/upload-attachment')
    xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('authToken'))
    xhr.send(formData)
  })
}

// Email search
export async function searchEmails(query, filters = {}) {
  try {
    const provider = await getCurrentProvider()
    let params = new URLSearchParams()
    let endpoint = ''

    if (provider === 'gmail') {
      params.set('q', query)
      params.set('maxResults', '50')
      Object.keys(filters).forEach(key => params.set(key, filters[key]))
      endpoint = '/threads'
    } else if (provider === 'outlook') {
      params.set('q', query)
      params.set('top', '50')
      Object.keys(filters).forEach(key => params.set(key, filters[key]))
      endpoint = '/outlook/messages'
    }

    const response = await apiFetch(`${endpoint}?${params}`)

    // Transform search results to match our expected format
    let emails = []

    if (provider === 'gmail') {
      emails = (response.threads || []).map(thread => ({
        id: thread.threadId,
        threadId: thread.threadId,
        from: extractNameFromEmail(thread.from),
        fromEmail: extractEmailFromString(thread.from),
        subject: thread.subject || '(No Subject)',
        preview: thread.snippet || '',
        date: thread.date,
        time: formatTimeFromDate(thread.date),
        isRead: !thread.isUnread,
        isStarred: (thread.labelIds || []).includes('STARRED'),
        hasAttachment: (thread.labelIds || []).includes('HAS_ATTACHMENT'),
        labels: mapGmailLabelsToCustom(thread.labelIds || []),
        avatar: `https://i.pravatar.cc/40?u=${extractEmailFromString(thread.from)}`
      }))
    } else if (provider === 'outlook') {
      emails = (response.messages || []).map(message => ({
        id: message.id,
        threadId: message.conversationId,
        from: extractNameFromEmail(message.from),
        fromEmail: extractEmailFromString(message.from),
        subject: message.subject || '(No Subject)',
        preview: message.snippet || '',
        date: message.date,
        time: formatTimeFromDate(message.date),
        isRead: message.isRead,
        isStarred: message.importance === 'high',
        hasAttachment: message.hasAttachments,
        labels: mapOutlookLabelsToCustom(message),
        avatar: `https://i.pravatar.cc/40?u=${extractEmailFromString(message.from)}`
      }))
    }

    return {
      emails,
      total: emails.length
    }
  } catch (error) {
    console.error('Failed to search emails:', error)
    throw error
  }
}

// Account management - using existing session API
export async function getConnectedAccounts() {
  try {
    const response = await apiFetch('/api/v1/session')
    return {
      providers: response.data?.providers || {},
      user: response.data?.user || {}
    }
  } catch (error) {
    console.error('Failed to get connected accounts:', error)
    throw error
  }
}

// Real-time updates via WebSocket or Server-Sent Events
export function subscribeToEmailUpdates(onUpdate) {
  // This would typically use WebSocket or Server-Sent Events
  // For now, we'll use polling as fallback
  const eventSource = new EventSource('/api/v1/emails/stream')

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      onUpdate(data)
    } catch (error) {
      console.error('Failed to parse email update:', error)
    }
  }

  eventSource.onerror = (error) => {
    console.error('Email stream error:', error)
  }

  return () => {
    eventSource.close()
  }
}

// Utility functions
export function formatEmailForDisplay(email) {
  return {
    ...email,
    date: new Date(email.date),
    formattedDate: formatTimeFromDate(email.date),
    preview: email.preview || email.body?.substring(0, 150) + '...',
    senderName: email.from || 'Unknown',
    senderEmail: email.fromEmail || 'unknown@email.com'
  }
}

// Utility functions for data transformation
export function extractNameFromEmail(emailString) {
  if (!emailString) return 'Unknown'

  // Format: "Name <email@domain.com>" or just "email@domain.com"
  const match = emailString.match(/^(.+?)\s*<(.+)>$/)
  if (match) {
    return match[1].trim().replace(/^["']|["']$/g, '')
  }

  // Just email, extract name part
  const emailMatch = emailString.match(/^([^@]+)@/)
  return emailMatch ? emailMatch[1] : emailString
}

export function extractEmailFromString(emailString) {
  if (!emailString) return ''

  // Format: "Name <email@domain.com>" or just "email@domain.com"
  const match = emailString.match(/<(.+)>$/)
  if (match) {
    return match[1]
  }

  // Check if it's already just an email
  if (emailString.includes('@')) {
    return emailString
  }

  return ''
}

export function extractParticipants(messages) {
  const participants = new Set()

  messages.forEach(message => {
    if (message.from) {
      participants.add(extractEmailFromString(message.from))
    }
    if (message.to) {
      const toEmails = Array.isArray(message.to) ? message.to :
                     typeof message.to === 'string' ? message.to.split(',') : []
      toEmails.forEach(email => {
        if (email && typeof email === 'string') {
          participants.add(email.trim())
        }
      })
    }
  })

  return Array.from(participants).filter(Boolean)
}

export function mapGmailLabelsToCustom(labelIds) {
  const labelMap = {
    'CATEGORY_PERSONAL': 'personal',
    'CATEGORY_SOCIAL': 'personal',
    'CATEGORY_PROMOTIONS': 'marketing',
    'CATEGORY_UPDATES': 'updates',
    'CATEGORY_FORUMS': 'work',
    'IMPORTANT': 'work',
    'STARRED': 'starred'
  }

  return labelIds.map(labelId => labelMap[labelId] || 'general').filter(Boolean)
}

export function mapOutlookLabelsToCustom(message) {
  const labels = []

  // Map importance to labels
  if (message.importance === 'high') {
    labels.push('starred')
  }

  // Could add more mappings based on categories or other properties
  // For now, just use a basic mapping
  labels.push('general')

  return labels.filter(Boolean)
}

export function formatTimeFromDate(dateString) {
  if (!dateString) return ''

  try {
    const date = new Date(dateString)
    const now = new Date()
    const diff = now - date
    const hours = diff / (1000 * 60 * 60)
    const days = diff / (1000 * 60 * 60 * 24)

    if (hours < 1) {
      return 'Just now'
    } else if (hours < 24) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' })
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    }
  } catch {
    return ''
  }
}

// Error handling wrapper
export function withErrorHandling(apiCall) {
  return async (...args) => {
    try {
      return await apiCall(...args)
    } catch (error) {
      console.error('Email API error:', error)

      // Handle different types of errors
      if (error.status === 401) {
        // Redirect to login or refresh token
        window.location.href = '/'
        return
      } else if (error.status === 403) {
        throw new Error('You do not have permission to perform this action')
      } else if (error.status === 429) {
        throw new Error('Too many requests. Please try again later.')
      } else if (error.status >= 500) {
        throw new Error('Server error. Please try again later.')
      }

      throw error
    }
  }
}
