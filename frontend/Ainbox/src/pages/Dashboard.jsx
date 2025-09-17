import { useState, useEffect } from 'react'
import { useSession } from '../hooks/useSession'
import { useEmail } from '../hooks/useEmail'
import EmailSidebar from '../components/email/EmailSidebar'
import EmailHeader from '../components/email/EmailHeader'
import EmailList from '../components/email/EmailList'
import EmailThread from '../components/email/EmailThread'
import ComposeEmail from '../components/email/ComposeEmail'

export default function Dashboard() {
  const { user, terms } = useSession()
  const {
    emails,
    loading,
    error,
    hasMore,
    hasPrev,
    total,
    currentPage,
    // expose unreadCount state from hook
    // (added to hook in this change set)
    // @ts-ignore
    unreadCount,
    selectedEmails,
    loadFirstPage,
    loadNextPage,
    loadPrevPage,
    searchEmails,
    toggleEmailSelection,
    selectAllEmails,
    clearSelection,
    performEmailAction,
    sendEmail: sendEmailMessage
  } = useEmail()

  const [activeFolder, setActiveFolder] = useState('inbox')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEmailId, setSelectedEmailId] = useState(null)
  const [showCompose, setShowCompose] = useState(false)
  const [composeData, setComposeData] = useState(null)
  const [view, setView] = useState('list') // 'list' or 'thread'

  // Load emails when folder changes
  useEffect(() => {
    loadFirstPage(activeFolder, searchQuery)
  }, [activeFolder, loadFirstPage])

  // Handle search with debouncing
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery) {
        searchEmails(searchQuery)
      } else {
        loadFirstPage(activeFolder, '')
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery, activeFolder, loadFirstPage, searchEmails])

  const handleFolderChange = (folder) => {
    setActiveFolder(folder)
    setSelectedEmailId(null)
    setView('list')
    clearSelection()
    // Always reset to first page on folder click, even if same folder
    loadFirstPage(folder, '')
  }

  const handleEmailSelect = (emailId) => {
    // Optimistically mark as read when opening an email
    const selected = emails.find(e => e.id === emailId)
    console.log('Email selected:', emailId, 'Current isRead:', selected?.isRead)

    if (selected && !selected.isRead) {
      console.log('Marking email as read:', emailId)
      // Fire-and-forget; hook updates local state + unread counter
      performEmailAction('read', [emailId]).catch(error => {
        console.error('Failed to mark email as read:', error)
      })
    }

    setSelectedEmailId(emailId)
    setView('thread')
  }

  const handleEmailAction = async (action, emailIds) => {
    try {
      await performEmailAction(action, emailIds)
    } catch (error) {
      console.error('Email action failed:', error)
      // You could show a toast notification here
    }
  }

  const handleCompose = (data = null) => {
    setComposeData(data)
    setShowCompose(true)
  }

  const handleComposeClose = () => {
    setShowCompose(false)
    setComposeData(null)
  }

  const handleSendEmail = async (emailData) => {
    try {
      await sendEmailMessage(emailData)
      setShowCompose(false)
      setComposeData(null)
      // Refresh inbox if currently viewing it
      if (activeFolder === 'inbox') {
        loadFirstPage('inbox', searchQuery)
      }
    } catch (error) {
      console.error('Failed to send email:', error)
      throw error
    }
  }

  const handleBackToList = () => {
    setView('list')
    setSelectedEmailId(null)
  }

  return (
    <div className="h-screen w-full bg-gray-50 flex flex-col">
      {/* Header */}
      <EmailHeader
        currentFolder={activeFolder}
        onCompose={handleCompose}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <EmailSidebar
          activeFolder={activeFolder}
          onFolderChange={handleFolderChange}
          onCompose={handleCompose}
          inboxUnread={unreadCount}
        />

        {/* Main content area */}
        {view === 'list' ? (
          <EmailList
            emails={emails}
            loading={loading}
            error={error}
            hasMore={hasMore}
            hasPrev={hasPrev}
            total={total}
            currentPage={currentPage}
            selectedEmails={selectedEmails}
            selectedEmailId={selectedEmailId}
            onEmailSelect={handleEmailSelect}
            onEmailAction={handleEmailAction}
            onToggleSelection={toggleEmailSelection}
            onSelectAll={selectAllEmails}
            onClearSelection={clearSelection}
            onLoadNext={() => loadNextPage(activeFolder, searchQuery)}
            onLoadPrev={() => loadPrevPage(activeFolder, searchQuery)}
          />
        ) : (
          <EmailThread
            threadId={selectedEmailId}
            onReply={(message) => handleCompose({ replyTo: message })}
            onReplyAll={(message) => handleCompose({ replyTo: message, replyAll: true })}
            onForward={(message) => handleCompose({ forward: message })}
            onArchive={() => handleEmailAction('archive', [selectedEmailId])}
            onDelete={() => handleEmailAction('delete', [selectedEmailId])}
            onBack={handleBackToList}
          />
        )}
      </div>

      {/* Compose modal */}
      <ComposeEmail
        isOpen={showCompose}
        onClose={handleComposeClose}
        onSend={handleSendEmail}
        replyTo={composeData?.replyTo}
        forward={composeData?.forward}
        replyAll={composeData?.replyAll}
      />
    </div>
  )
}
