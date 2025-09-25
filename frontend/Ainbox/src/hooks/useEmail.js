import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import socketService from '../services/socketApi'
import { useSession } from './useSession'
// import { useRealTimeEmailBridge } from '../components/email/RealTimeEmailBridge' // DISABLED: Using Socket.IO only
import { queryClient, queryKeys } from '../services/queryClient'

// ✅ Helpers for matching and updating read status
function matchesEmailByAnyId(email, anyId) {
  if (!anyId) return false;
  return (
    email.id === anyId ||
    email.threadId === anyId ||
    email.messageId === anyId ||
    email.conversationId === anyId ||
    email.gmailMessageId === anyId ||
    email.gmailThreadId === anyId
  );
}

function applyReadFlagAndLabels(email, isRead) {
  const next = { ...email, isRead: !!isRead };
  if (Array.isArray(email.labels)) {
    const hasUnread = email.labels.includes('UNREAD');
    if (isRead && hasUnread) next.labels = email.labels.filter(l => l !== 'UNREAD');
    else if (!isRead && !hasUnread) next.labels = [...email.labels, 'UNREAD'];
    else next.labels = email.labels.slice();
  }
  return next;
}

// Debug helper to log email list state changes
function logEmailListState(emails, action, emailId = null) {
  const unreadInList = emails.filter(e => !e.isRead).length;
  const readInList = emails.filter(e => e.isRead).length;

  console.log('\n' + '='.repeat(80));
  console.log(`📧 EMAIL LIST STATE DEBUG - ${action.toUpperCase()}`);
  console.log('='.repeat(80));
  console.log(`📊 Total emails: ${emails.length}`);
  console.log(`📊 Unread emails in list: ${unreadInList}`);
  console.log(`📊 Read emails: ${readInList}`);

  if (emailId) {
    const targetEmail = emails.find(e => e.id === emailId || e.threadId === emailId || e.messageId === emailId);
    if (targetEmail) {
      console.log(`🎯 Target email ${emailId}:`, {
        id: targetEmail.id,
        isRead: targetEmail.isRead,
        subject: targetEmail.subject?.substring(0, 50) + '...',
        from: targetEmail.from
      });
    } else {
      console.log(`❌ Target email ${emailId} NOT FOUND in list`);
    }
  }

  console.log('\n📋 Email List Summary:');
  emails.slice(0, 10).forEach((email, index) => {
    const status = email.isRead ? '✅ READ  ' : '🔴 UNREAD';
    const subject = (email.subject || 'No Subject').substring(0, 40);
    console.log(`  ${index + 1}. ${status} | ${email.id} | ${subject}...`);
  });

  if (emails.length > 10) {
    console.log(`  ... and ${emails.length - 10} more emails`);
  }
  console.log('='.repeat(80) + '\n');
}

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
  const [spamUnreadCount, setSpamUnreadCount] = useState(0)
  const unsubscribeRef = useRef(null)
  const processedEvents = useRef(new Set()) // Track processed events to prevent duplicates

  // 🚀 LOCAL STATE APPROACH: Calculate unread count directly from emails array
  const unreadCount = useMemo(() => {
    const localCount = emails.filter(email => !email.isRead).length
    console.log(`📊 [LOCAL COUNT] Calculated from email list: ${localCount} unread emails`)
    return localCount
  }, [emails])

  // 🚀 LOCAL STATE APPROACH: No complex count management needed!
  // Unread count is now always accurate and derived from email list state

  // 🚀 LOCAL STATE APPROACH: No stats API needed!
  // Count is calculated from email list, total comes from email list fetches

  // 🚀 LOCAL STATE APPROACH: No complex count management functions needed!

  // 🚀 LOCAL STATE APPROACH: Count is always accurate, no validation needed!
  useEffect(() => {
    if (emails.length > 0) {
      console.log(`📧 [LOCAL COUNT] Email list updated: ${emails.length} total, ${unreadCount} unread`)
    }
  }, [emails, unreadCount])

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

      // Populate React Query cache for the current folder/search
      try {
        const key = queryKeys.emails(folder, search)
        queryClient.setQueryData(key, {
          emails: formattedEmails,
          total: response.total || formattedEmails.length,
          hasMore: !!response.nextCursor,
          nextCursor: response.nextCursor || null,
        })
      } catch (_) {}

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
      // Load stats
      try {
        const s = await getSpamStats()
        setSpamUnreadCount(s.unread || 0)
      } catch (_) { /* ignore */ }
      // 🚀 LOCAL STATE APPROACH: Don't override local unread count with server stats
      // Unread count is calculated automatically from email list
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
      // 🚀 LOCAL STATE APPROACH: Don't override local unread count with server stats
      // Unread count is calculated automatically from email list
      if (folder === 'spam') {
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
        return Math.max(prev || 0, apiTotal)
      })
      // 🚀 LOCAL STATE APPROACH: Don't override local unread count with server stats
      // Unread count is calculated automatically from email list
      if (folder === 'spam') {
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
      setHasMore(false)
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

    console.log('📧 performEmailAction called:', action, ids)
    console.log('📧 Current unread count before action:', unreadCount)

    // 🚀 LOCAL STATE APPROACH: Update emails, count updates automatically!
    setEmails(prev => {
      console.log('📧 [LOCAL COUNT] BEFORE optimistic update:', prev.length, 'emails');

      const updated = prev.map(email => {
        const matches = ids.includes(email.id) || ids.includes(email.threadId) || ids.includes(email.messageId)
        if (matches) {
          switch (action) {
            case 'read':
              console.log('📧 [LOCAL COUNT] Marking email as read:', email.id)
              return { ...email, isRead: true }
            case 'unread':
              console.log('📧 [LOCAL COUNT] Marking email as unread:', email.id)
              return { ...email, isRead: false }
            case 'star':
              return { ...email, isStarred: true }
            case 'unstar':
              return { ...email, isStarred: false }
            case 'archive':
            case 'delete':
              console.log('📧 [LOCAL COUNT] Removing email:', email.id)
              return null
            default:
              return email
          }
        }
        return email
      })

      const filtered = updated.filter(Boolean);
      console.log('📧 [LOCAL COUNT] AFTER optimistic update:', filtered.length, 'emails');
      return filtered;
    })

    // Clear selection after bulk actions
    if (ids.length > 1 || selectedEmails.has(ids[0])) {
      setSelectedEmails(prev => {
        const newSet = new Set(prev)
        ids.forEach(id => newSet.delete(id))
        return newSet
      })
    }

    // Send action via Socket.IO for bidirectional communication
    socketService.sendEmailAction(action, ids, 'gmail');

    // Convert message IDs to thread IDs for backend Gmail API calls
    const threadIds = ids.map(id => {
      const email = emails.find(e => e.id === id || e.threadId === id || e.messageId === id)
      if (email && email.threadId) {
        console.log(`📧 Converting message ID ${id} to thread ID ${email.threadId}`)
        return email.threadId
      }
      console.log(`📧 Using original ID ${id} (thread ID or not found)`)
      return id
    })

    console.log(`📧 Sending to backend - Original IDs:`, ids)
    console.log(`📧 Sending to backend - Thread IDs:`, threadIds)

    // Then try to sync with backend (don't wait for it)
    try {
      switch (action) {
        case 'read':
          markEmailAsRead(threadIds, ids).then(() => {
            console.log('📧 [LOCAL COUNT] Backend sync completed for read action')
            clearEmailCache()
          }).catch(error => {
            console.error('Backend sync failed for read:', error)
          })
          break
        case 'unread':
          markEmailAsUnread(threadIds).then(() => {
            console.log('📧 [LOCAL COUNT] Backend sync completed for unread action')
            clearEmailCache()
          }).catch(error => {
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

    // 🚀 LOCAL STATE APPROACH: No server stats needed!
    // Spam counts still use server API for now
    setTimeout(async () => {
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

  // Real-time updates via SSE (disabled; prefer Socket.IO)
  const USE_SSE = false;
  useEffect(() => {
    if (!USE_SSE) {
      console.log('📡 [DEBUG SSE] SSE subscription disabled (using Socket.IO)');
      return () => {};
    }
    console.log(`📡 [DEBUG SSE] 🚀 SETTING UP SSE subscription...`);

    const unsubscribe = subscribeToEmailUpdates((update) => {
      console.log(`📡 [DEBUG SSE] 📨 RAW SSE update received:`, JSON.stringify(update, null, 2));
      console.log(`📡 [DEBUG SSE] Update type: ${update.type}`);

      switch (update.type) {
        case 'new_email':
          console.log(`📡 [DEBUG SSE] 📧 new_email - SKIPPED (handled by Socket.IO/Bridge)`);
          break
        case 'unread_count_updated':
          console.log(`📡 [DEBUG SSE] 📊 unread_count_updated received:`, {
            unread: update.unread,
            total: update.total,
            source: update.source
          });
          console.log(`📡 [DEBUG SSE] 📊 SSE count update ignored - using local count only:`, update.unread);
          // 🚀 LOCAL STATE APPROACH: Ignore server count updates!
          if (typeof update.total === 'number') {
            console.log(`📡 [DEBUG SSE] 📊 Setting total to ${update.total}`);
            setTotal(update.total);
          }
          break
        case 'email_updated': {
          console.log(`📡 [DEBUG SSE] 📧 email_updated received:`, update);
          // Handle email status updates (read/unread changes)
          const emailId = update.emailId;
          const isRead = update.isRead;

          console.log(`📡 [DEBUG SSE] Extracted - emailId: ${emailId}, isRead: ${isRead}`);

          if (emailId && typeof isRead === 'boolean') {
            console.log(`📡 [DEBUG SSE] ✅ Valid email_updated: ${emailId} → ${isRead ? 'read' : 'unread'}`);

            setEmails(prev => {
              console.log(`📡 [DEBUG SSE] Updating emails state, current count: ${prev.length}`);
              const updatedEmails = prev.map(email => {
                if (matchesEmailByAnyId(email, emailId)) {
                  console.log(`📡 [DEBUG SSE] ✅ MATCH FOUND for ${emailId}:`, {
                    emailId: email.id,
                    currentIsRead: email.isRead,
                    newIsRead: isRead
                  });
                  const updatedEmail = applyReadFlagAndLabels(email, isRead);
                  console.log(`📡 [DEBUG SSE] 🎨 EMAIL UPDATE: ${email.id} - ${email.isRead ? 'read' : 'unread'} → ${updatedEmail.isRead ? 'read' : 'unread'}`);
                  return updatedEmail;
                }
                return email;
              });

              console.log(`📡 [DEBUG SSE] 📝 Email list updated via SSE`);
              logEmailListState(updatedEmails, 'SSE_EMAIL_STATUS_UPDATED', emailId);
              return updatedEmails;
            });

            // 🚀 LOCAL STATE APPROACH: Unread count updates automatically when email list changes!
            // No manual count updates needed
          } else {
            console.log(`📡 [DEBUG SSE] ❌ Invalid email_updated data - emailId: ${emailId}, isRead: ${isRead}`);
          }
          break;
        }
        case 'email_deleted':
          console.log(`📡 [DEBUG SSE] 🗑️ email_deleted received:`, update);
          setEmails(prev => prev.filter(email => email.id !== update.emailId))
          setTotal(prev => Math.max(0, prev - 1))
          console.log(`📡 [DEBUG SSE] 🗑️ ✅ Email deleted from state`);
          break
        default:
          console.log(`📡 [DEBUG SSE] ❓ Unknown update type: ${update.type}`);
          break
      }
    })

    unsubscribeRef.current = unsubscribe
    console.log(`📡 [DEBUG SSE] ✅ SSE subscription established`);

    return () => {
      console.log(`📡 [DEBUG SSE] 🛑 CLEANING UP SSE subscription...`);
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        console.log(`📡 [DEBUG SSE] ✅ SSE subscription cleaned up`);
      }
    }
  }, [])

  // Real-time Socket.IO service for instant email state updates
  const { user, loading: sessionLoading } = useSession()
  useEffect(() => {
    if (!window.pageLoadTime) window.pageLoadTime = Date.now()

    if (sessionLoading) {
      console.log('🔌 [HOOK] Waiting for session to load before connecting Socket.IO...')
      return
    }

    const userId = user?.id
    if (!userId) {
      console.warn('🔌 [HOOK] No authenticated user ID found; skipping Socket.IO connect')
      return
    }

    console.log('🔌 [HOOK] Connecting to Socket.IO service with userId:', userId)
    socketService.connect(userId, 'auth-token')
    console.log('🔌 [HOOK] Socket.IO connection initiated')

    const unsubscribeEmailUpdated = socketService.addEventListener('emailUpdated', (data) => {
      console.log('🔥 Socket.IO emailUpdated received:', data);

      const incomingId =
        data.emailId || data.gmailMessageId || data.messageId || data.threadId || data.conversationId || data.id;
      if (!incomingId) {
        console.warn('⚠️ No valid ID found in emailUpdated data:', data);
        return;
      }

      console.log(`🔍 Looking for email with ID: ${incomingId}`);
      console.log(`🔍 Current emails in state:`, emails.map(e => ({ id: e.id, threadId: e.threadId, messageId: e.messageId, isRead: e.isRead })));

      let foundMatch = false;
      setEmails(prev => {
        console.log(`🔍 Checking ${prev.length} emails for match with ${incomingId}`);
        logEmailListState(prev, 'BEFORE_SOCKET_UPDATE', incomingId);

        const updatedEmails = prev.map((email, index) => {
          const isMatch = matchesEmailByAnyId(email, incomingId);
          if (isMatch) {
            foundMatch = true;
            console.log(`✅ MATCH FOUND at index ${index}:`, {
              emailId: email.id,
              threadId: email.threadId,
              messageId: email.messageId,
              gmailMessageId: email.gmailMessageId,
              incomingId: incomingId,
              currentIsRead: email.isRead,
              newIsRead: data.isRead
            });

            if (typeof data.isRead === 'boolean') {
              const updatedEmail = applyReadFlagAndLabels(email, data.isRead);
              console.log(`🎨 COLOR FLIP - Email ${email.id}: ${email.isRead ? 'read' : 'unread'} → ${updatedEmail.isRead ? 'read' : 'unread'}`);
              console.log(`🎨 Updated email object:`, updatedEmail);
              return updatedEmail;
            }
          }
          return email;
        });

        if (!foundMatch) {
          console.warn(`❌ NO MATCH FOUND for ID: ${incomingId}`);
          console.warn(`📧 Available email IDs:`, prev.map(e => e.id));
          console.warn(`📧 Available threadIds:`, prev.map(e => e.threadId));
          console.warn(`📧 Available messageIds:`, prev.map(e => e.messageId));
        }

        console.log('📝 Email list updated via Socket.IO, match found:', foundMatch);
        logEmailListState(updatedEmails, 'AFTER_SOCKET_UPDATE', incomingId);
        return updatedEmails;
      });

      // React Query cache: update current inbox list if present
      try {
        const key = queryKeys.emails('inbox', '')
        queryClient.setQueryData(key, (existing) => {
          if (!existing || !existing.emails) return existing
          const updated = existing.emails.map(e => matchesEmailByAnyId(e, incomingId)
            ? applyReadFlagAndLabels(e, typeof data.isRead === 'boolean' ? data.isRead : e.isRead)
            : e)
          return { ...existing, emails: updated }
        })
      } catch (_) {}
    })

    const unsubscribeCountUpdate = socketService.addEventListener('unreadCountUpdate', (data) => {
      console.log('📊 [LOCAL COUNT] Socket.IO count update received (ignoring - using local count):', data)
      // 🚀 LOCAL STATE APPROACH: Ignore server count updates, use local count only!
      if (typeof data.total === 'number') setTotal(data.total)
    })

    const unsubscribeNewEmail = socketService.addEventListener('newEmail', (data) => {
      console.log('\n' + '🔥'.repeat(60));
      console.log('🔥 [SOCKET TRACE] NEW EMAIL EVENT RECEIVED');
      console.log('🔥'.repeat(60));
      console.log('🔥 [SOCKET TRACE] Received data:', JSON.stringify(data, null, 2));

      if (data.email) {
        const formattedEmail = formatEmailForDisplay(data.email)
        const eventId = `socket-${formattedEmail.id || formattedEmail.messageId || formattedEmail.threadId}-${data.timestamp || Date.now()}`

        console.log('🔥 [SOCKET TRACE] Event ID:', eventId);
        console.log('🔥 [SOCKET TRACE] Already processed?', processedEvents.current.has(eventId));

        // Check if already processed
        if (processedEvents.current.has(eventId)) {
          console.log('🔥 [SOCKET TRACE] ⚠️ Event already processed, skipping');
          return;
        }

        // Mark as processed
        processedEvents.current.add(eventId);

        console.log('🔥 [SOCKET TRACE] Processing new email with chronological sorting...');

        setEmails(prev => {
          // Check if email already exists to prevent duplication (use current state)
          const existsAlready = prev.some(email =>
            matchesEmailByAnyId(email, formattedEmail.id) ||
            matchesEmailByAnyId(email, formattedEmail.messageId) ||
            matchesEmailByAnyId(email, formattedEmail.threadId)
          );

          if (existsAlready) {
            console.log('🔥 [SOCKET TRACE] ⚠️ Email already exists in current list, skipping');
            return prev; // Return unchanged list
          }

          // ✅ FIXED: Insert email in proper chronological position instead of top
          const emailTimestamp = new Date(formattedEmail.timestamp || formattedEmail.date || Date.now()).getTime();

          // Find the correct position to insert (emails should be sorted newest first)
          let insertIndex = 0;
          for (let i = 0; i < prev.length; i++) {
            const existingTimestamp = new Date(prev[i].timestamp || prev[i].date || 0).getTime();
            if (emailTimestamp > existingTimestamp) {
              insertIndex = i;
              break;
            }
            insertIndex = i + 1;
          }

          const newList = [
            ...prev.slice(0, insertIndex),
            formattedEmail,
            ...prev.slice(insertIndex)
          ];

          console.log('🔥 [SOCKET TRACE] New email added at position:', insertIndex);
          return newList;
        });

        setTotal(prev => prev + 1);
        console.log('🔥 [SOCKET TRACE] ✅ Socket.IO new email processed successfully');
      }
      console.log('🔥'.repeat(60) + '\n');
    })

    const unsubscribeEmailDeleted = socketService.addEventListener('emailDeleted', (data) => {
      if (data.emailId) {
        console.log('📧 [LOCAL COUNT] Email deletion event received, unread count will update automatically:', data);
        setEmails(prev => prev.filter(email => !(
          email.id === data.emailId ||
          email.threadId === data.emailId ||
          email.messageId === data.emailId ||
          email.conversationId === data.emailId
        )));
        setTotal(prev => Math.max(0, prev - 1));
        // 🚀 LOCAL STATE APPROACH: Count updates automatically when email list changes!
      }
    })

    const unsubscribeActionBroadcast = socketService.addEventListener('emailActionBroadcast', (data) => {
      if (data.action && data.emailIds) {
        setEmails(prev => prev.map(email => {
          const matches = data.emailIds.includes(email.id) ||
                          data.emailIds.includes(email.threadId) ||
                          data.emailIds.includes(email.messageId)
          if (matches) {
            const updated = { ...email }
            switch (data.action) {
              case 'read':   updated.isRead = true; break
              case 'unread': updated.isRead = false; break
              case 'star':   updated.isStarred = true; break
              case 'unstar': updated.isStarred = false; break
            }
            return updated
          }
          return email
        }))
      }
    })

    return () => {
      unsubscribeEmailUpdated()
      unsubscribeCountUpdate()
      unsubscribeNewEmail()
      unsubscribeEmailDeleted()
      unsubscribeActionBroadcast()
    }
  }, [loadEmails, user, sessionLoading])

  // Real-Time Email Bridge Integration (Gmail Pub/Sub → React State) - DISABLED: Using Socket.IO only
  // useRealTimeEmailBridge(...) // DISABLED to prevent duplication with Socket.IO
  console.log('🚀 [SOCKET-ONLY] RealTimeEmailBridge disabled - using Socket.IO only for real-time updates');

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return
      switch (event.key) {
        // Removed Ctrl+A shortcut - use checkbox instead
        case 'Escape':
          clearSelection()
          break
        case 'e':
          if (selectedEmails.size > 0) performEmailAction('archive', Array.from(selectedEmails))
          break
        case 'r':
          if (selectedEmails.size > 0) performEmailAction('read', Array.from(selectedEmails))
          break
        case 'U':
          if (selectedEmails.size > 0) performEmailAction('unread', Array.from(selectedEmails))
          break
        case 'Delete':
        case 'Backspace':
          if (selectedEmails.size > 0) performEmailAction('delete', Array.from(selectedEmails))
          break
        case 's':
          if (selectedEmails.size > 0) performEmailAction('star', Array.from(selectedEmails))
          break
        default:
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
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
    unreadCount, // 🚀 LOCAL STATE: Always accurate, no V2 complexity needed
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
    clearError: () => setError(null),

    // 🚀 LOCAL STATE APPROACH: Simple and reliable!
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
