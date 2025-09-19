import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getEmails,
  getEmailThread,
  markEmailAsRead,
  markEmailAsUnread,
  starEmail,
  unstarEmail,
  archiveEmails,
  deleteEmails,
  sendEmail,
  searchEmails,
  subscribeToEmailUpdates,
  formatEmailForDisplay,
  withErrorHandling,
  getInboxStats,
  getSpamStats,
  clearEmailCache
} from '../services/emailApi'

export function useEmail() {
  const [emails, setEmails] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [currentPage, setCurrentPage] = useState(1) // 1-based index
  const [nextCursor, setNextCursor] = useState(null)
  const [pageCursors, setPageCursors] = useState([null]) // cursor per page index (0 => null)
  const [pageNextCursors, setPageNextCursors] = useState([null]) // nextCursor available from each page
  const [total, setTotal] = useState(0)
  const [selectedEmails, setSelectedEmails] = useState(new Set())
  const [unreadCount, setUnreadCount] = useState(0)
  const [spamUnreadCount, setSpamUnreadCount] = useState(0)
  const unsubscribeRef = useRef(null)

  // Load emails for a specific folder
  const loadEmails = useCallback(withErrorHandling(async (folder = 'inbox', pageOrCursor = 1, search = '', _replace = true) => {
    setLoading(true)
    setError(null)

    try {
      const cursor = typeof pageOrCursor === 'string' ? pageOrCursor : null
      const response = await getEmails(folder, cursor, 50, search)
      const formattedEmails = response.emails.map(formatEmailForDisplay)

      // Always replace current view with the fetched page
      setEmails(formattedEmails)

      setHasMore(response.hasMore)
      setNextCursor(response.nextCursor || null)
      return response
    } catch (err) {
      setError(err.message)
      setEmails([])
      setHasMore(false)
      setNextCursor(null)
      throw err
    } finally {
      setLoading(false)
    }
  }), [])

  // Initialize/Reset to first page
  const loadFirstPage = useCallback(async (folder = 'inbox', search = '') => {
    try {
      const res = await loadEmails(folder, null, search, true)
      setCurrentPage(1)
      setPageCursors([null])
      setPageNextCursors([res?.nextCursor || null])
      setTotal(() => {
        const apiTotal = Number.isFinite(res?.total) ? res.total : 0
        const knownEnd = (res?.emails?.length || 0)
        return Math.max(apiTotal, knownEnd)
      })
      // Load stats: always fetch spam count so badge shows immediately
      // and fetch inbox counts when viewing inbox
      try {
        const s = await getSpamStats()
        setSpamUnreadCount(s.unread || 0)
      } catch (_) { /* ignore */ }
      if (folder === 'inbox') {
        const stats = await getInboxStats()
        setUnreadCount(stats.unread || 0)
        if (Number.isFinite(stats.total)) setTotal(stats.total)
      } else if (folder === 'spam') {
        // already fetched spam stats above
      }
    } catch (_) { /* state already set in loadEmails */ }
  }, [loadEmails])

  // Load next page (replace list)
  const loadNextPage = useCallback(async (folder = 'inbox', search = '') => {
    if (loading) return
    const idx = currentPage - 1
    const next = pageNextCursors[idx]
    if (!next) return
    try {
      const res = await loadEmails(folder, next, search, true)
      const newIndex = idx + 1
      setCurrentPage(newIndex + 1)
      setPageCursors(prev => {
        const arr = prev.slice(0, idx + 1)
        arr.push(next)
        return arr
      })
      setPageNextCursors(prev => {
        const arr = prev.slice(0, idx + 1)
        arr.push(res?.nextCursor || null)
        return arr
      })
      setTotal(prev => {
        const apiTotal = Number.isFinite(res?.total) ? res.total : 0
        const nextPageNum = newIndex + 1
        const pageSize = 50
        const knownEnd = (nextPageNum - 1) * pageSize + (res?.emails?.length || 0)
        return Math.max(prev || 0, apiTotal, knownEnd)
      })
      if (folder === 'inbox') {
        const stats = await getInboxStats()
        setUnreadCount(stats.unread || 0)
        if (Number.isFinite(stats.total)) setTotal(stats.total)
      } else if (folder === 'spam') {
        const s = await getSpamStats()
        setSpamUnreadCount(s.unread || 0)
      }
    } catch (_) { /* already handled */ }
  }, [loading, currentPage, pageNextCursors, loadEmails])

  // Load previous page (replace list)
  const loadPrevPage = useCallback(async (folder = 'inbox', search = '') => {
    if (loading) return
    if (currentPage <= 1) return
    const prevIndex = currentPage - 2 // target page index
    const prevCursor = pageCursors[prevIndex] || null
    try {
      const res = await loadEmails(folder, prevCursor, search, true)
      setCurrentPage(prevIndex + 1)
      setPageCursors(prev => prev.slice(0, prevIndex + 1))
      setPageNextCursors(prev => {
        const arr = prev.slice(0, prevIndex + 1)
        arr[prevIndex] = res?.nextCursor || arr[prevIndex] || null
        return arr
      })
      setTotal(prev => {
        const apiTotal = Number.isFinite(res?.total) ? res.total : 0
        // Keep maximum to avoid shrinking due to estimates
        return Math.max(prev || 0, apiTotal)
      })
      if (folder === 'inbox') {
        const stats = await getInboxStats()
        setUnreadCount(stats.unread || 0)
        if (Number.isFinite(stats.total)) setTotal(stats.total)
      } else if (folder === 'spam') {
        const s = await getSpamStats()
        setSpamUnreadCount(s.unread || 0)
      }
    } catch (_) { /* already handled */ }
  }, [loading, currentPage, pageCursors, loadEmails])

  // Search emails
  const searchEmailsWithFilters = useCallback(withErrorHandling(async (query, filters = {}) => {
    setLoading(true)
    setError(null)

    try {
      const response = await searchEmails(query, filters)
      const formattedEmails = response.emails.map(formatEmailForDisplay)
      setEmails(formattedEmails)
      setTotal(response.total)
      setHasMore(false) // Search results are usually complete
      setCurrentPage(1)
      setPageCursors([null])
      setPageNextCursors([null])
    } catch (err) {
      setError(err.message)
      setEmails([])
    } finally {
      setLoading(false)
    }
  }), [])

  // Email selection management
  const toggleEmailSelection = useCallback((emailId) => {
    setSelectedEmails(prev => {
      const newSet = new Set(prev)
      if (newSet.has(emailId)) {
        newSet.delete(emailId)
      } else {
        newSet.add(emailId)
      }
      return newSet
    })
  }, [])

  const selectAllEmails = useCallback(() => {
    setSelectedEmails(new Set(emails.map(email => email.id)))
  }, [emails])

  const clearSelection = useCallback(() => {
    setSelectedEmails(new Set())
  }, [])

  // Email actions
  const performEmailAction = useCallback(withErrorHandling(async (action, emailIds) => {
    const ids = Array.isArray(emailIds) ? emailIds : [emailIds]

    console.log('performEmailAction called:', action, ids)

    // Update local state optimistically FIRST (match by id, threadId, messageId)
    let unreadDelta = 0
    setEmails(prev => prev.map(email => {
      const matches = ids.includes(email.id) || ids.includes(email.threadId) || ids.includes(email.messageId)
      if (matches) {
        switch (action) {
          case 'read':
            console.log('Updating email to read:', email.id)
            if (!email.isRead) unreadDelta -= 1
            return { ...email, isRead: true }
          case 'unread':
            if (email.isRead) unreadDelta += 1
            return { ...email, isRead: false }
          case 'star':
            return { ...email, isStarred: true }
          case 'unstar':
            return { ...email, isStarred: false }
          case 'archive':
          case 'delete':
            if (!email.isRead) unreadDelta -= 1
            return null // Will be filtered out
          default:
            return email
        }
      }
      return email
    }).filter(Boolean))

    // Adjust unread counters locally first (inbox only)
    setUnreadCount((prev) => Math.max(0, prev + unreadDelta))
    console.log('Unread delta:', unreadDelta)

    // Clear selection after bulk actions
    if (ids.length > 1 || selectedEmails.has(ids[0])) {
      setSelectedEmails(prev => {
        const newSet = new Set(prev)
        ids.forEach(id => newSet.delete(id))
        return newSet
      })
    }

    // Then try to sync with backend (don't wait for it)
    try {
      switch (action) {
        case 'read':
          markEmailAsRead(ids).then(() => clearEmailCache()).catch(error => {
            console.error('Backend sync failed for read:', error)
          })
          break
        case 'unread':
          markEmailAsUnread(ids).then(() => clearEmailCache()).catch(error => {
            console.error('Backend sync failed for unread:', error)
          })
          break
        case 'star':
          starEmail(ids).then(() => {}).catch(error => {
            console.error('Backend sync failed for star:', error)
          })
          break
        case 'unstar':
          unstarEmail(ids).then(() => {}).catch(error => {
            console.error('Backend sync failed for unstar:', error)
          })
          break
        case 'archive':
          archiveEmails(ids).then(() => clearEmailCache()).catch(error => {
            console.error('Backend sync failed for archive:', error)
          })
          break
        case 'delete':
          deleteEmails(ids).then(() => clearEmailCache()).catch(error => {
            console.error('Backend sync failed for delete:', error)
          })
          break
        default:
          throw new Error(`Unknown action: ${action}`)
      }
    } catch (error) {
      console.error('Email action error:', error)
    }

    // Refresh stats from server for accuracy (async)
    setTimeout(async () => {
      try {
        const stats = await getInboxStats()
        setUnreadCount(stats.unread || 0)
        if (Number.isFinite(stats.total)) setTotal(stats.total)
      } catch (_) { /* ignore */ }
      try {
        const s = await getSpamStats()
        setSpamUnreadCount(s.unread || 0)
      } catch (_) { /* ignore */ }
    }, 100)

  }), [selectedEmails])

  // Send email
  const sendEmailMessage = useCallback(withErrorHandling(async (emailData) => {
    try {
      const response = await sendEmail(emailData)
      return response
    } catch (err) {
      setError(err.message)
      throw err
    }
  }), [])

  // Real-time updates
  useEffect(() => {
    const unsubscribe = subscribeToEmailUpdates((update) => {
      switch (update.type) {
        case 'new_email':
          setEmails(prev => [formatEmailForDisplay(update.email), ...prev])
          setTotal(prev => prev + 1)
          if (!update.email?.isRead) setUnreadCount(prev => prev + 1)
          break
        case 'unread_count_updated':
          if (typeof update.unread === 'number') setUnreadCount(update.unread)
          if (typeof update.total === 'number') setTotal(update.total)
          break
        case 'email_updated': {
          const up = update.email || {}
          const upId = up.id
          setEmails(prev => prev.map(email => {
            const match = upId && (
              email.id === upId ||
              email.threadId === upId ||
              email.messageId === upId ||
              email.conversationId === upId
            )
            if (!match) return email
            const next = { ...email }
            if (typeof up.isRead === 'boolean') next.isRead = up.isRead
            return next
          }))
          break
        }
        case 'email_deleted':
          setEmails(prev => prev.filter(email => email.id !== update.emailId))
          setTotal(prev => Math.max(0, prev - 1))
          break
        default:
          console.log('Unknown email update type:', update.type)
      }
    })

    unsubscribeRef.current = unsubscribe

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
      }
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Only handle shortcuts when not typing in an input
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
        return
      }

      switch (event.key) {
        case 'a':
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault()
            selectAllEmails()
          }
          break
        case 'Escape':
          clearSelection()
          break
        case 'e':
          if (selectedEmails.size > 0) {
            performEmailAction('archive', Array.from(selectedEmails))
          }
          break
        case 'r':
          if (selectedEmails.size > 0) {
            performEmailAction('read', Array.from(selectedEmails))
          }
          break
        case 'U':
          if (selectedEmails.size > 0) {
            performEmailAction('unread', Array.from(selectedEmails))
          }
          break
        case 'Delete':
        case 'Backspace':
          if (selectedEmails.size > 0) {
            performEmailAction('delete', Array.from(selectedEmails))
          }
          break
        case 's':
          if (selectedEmails.size > 0) {
            performEmailAction('star', Array.from(selectedEmails))
          }
          break
        default:
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedEmails, selectAllEmails, clearSelection, performEmailAction])

  return {
    // State
    emails,
    loading,
    error,
    hasMore,
    currentPage,
    total,
    selectedEmails,
    nextCursor,
    hasPrev: currentPage > 1,
    unreadCount,
    spamUnreadCount,

    // Actions
    loadEmails, // low-level
    loadFirstPage,
    loadNextPage,
    loadPrevPage,
    searchEmails: searchEmailsWithFilters,
    toggleEmailSelection,
    selectAllEmails,
    clearSelection,
    performEmailAction,
    sendEmail: sendEmailMessage,

    // Utilities
    setError: (error) => setError(error),
    clearError: () => setError(null)
  }
}

// Hook for managing a single email thread
export function useEmailThread(emailId) {
  const [thread, setThread] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const loadThread = useCallback(withErrorHandling(async (id) => {
    if (!id) return

    console.log(`useEmailThread: Loading thread ${id}`)
    setLoading(true)
    setError(null)

    try {
      const threadData = await getEmailThread(id)
      console.log('useEmailThread: Successfully loaded thread data:', threadData)
      setThread(threadData)
    } catch (err) {
      console.error('useEmailThread: Error loading thread:', err)
      setError(err.message)
      setThread(null)
    } finally {
      setLoading(false)
    }
  }), [])

  useEffect(() => {
    loadThread(emailId)
  }, [emailId, loadThread])

  return {
    thread,
    loading,
    error,
    reload: () => loadThread(emailId)
  }
}

// Hook for managing draft emails
export function useDrafts() {
  const [drafts, setDrafts] = useState(new Map())

  const saveDraft = useCallback((key, data) => {
    setDrafts(prev => new Map(prev).set(key, {
      ...data,
      lastSaved: new Date()
    }))
  }, [])

  const getDraft = useCallback((key) => {
    return drafts.get(key)
  }, [drafts])

  const deleteDraft = useCallback((key) => {
    setDrafts(prev => {
      const newMap = new Map(prev)
      newMap.delete(key)
      return newMap
    })
  }, [])

  const clearAllDrafts = useCallback(() => {
    setDrafts(new Map())
  }, [])

  return {
    drafts: Array.from(drafts.values()),
    saveDraft,
    getDraft,
    deleteDraft,
    clearAllDrafts
  }
}
