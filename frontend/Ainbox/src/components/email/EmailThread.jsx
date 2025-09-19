import React, { useState } from 'react'
import { useEmailThread } from '../../hooks/useEmail'
import {
  Reply,
  ReplyAll,
  Forward,
  Star,
  Archive,
  Trash2,
  MoreHorizontal,
  Paperclip,
  Download,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Sparkles,
  Brain,
  Zap,
  MessageSquare,
  Wand2,
  FileText,
  Clock
} from 'lucide-react'
import { Avatar, AvatarImage, AvatarFallback } from '../ui/avatar'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { ScrollArea } from '../ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { cn } from '../../lib/utils'
import { generateAvatarProps, hasValidAvatar } from '../../utils/avatarUtils'
import { processEmailContent, applyEmailStyles, sanitizeHtml, rewriteCidSrc, buildIframeDoc } from '../../utils/htmlUtils'
import { summarizeThread, suggestReplies } from '../../services/aiApi'
import AIContentBox from '../ui/AIContentBox'

// Using real thread data from useEmailThread hook

// Render message in a sandboxed iframe, preserving styles and resolving CID images
const EmailHtmlFrame = ({ message }) => {
  const [height, setHeight] = React.useState(420)
  const [loadExternalContent, setLoadExternalContent] = React.useState(true)
  const iframeRef = React.useRef(null)

  React.useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    const onLoad = () => {
      try {
        const doc = iframe.contentWindow?.document
        if (!doc) return
        const newHeight = Math.min(3000, Math.max(240, doc.body?.scrollHeight || 420))
        setHeight(newHeight)
      } catch (_) { /* ignore cross-origin */ }
    }
    iframe.addEventListener('load', onLoad)
    return () => iframe.removeEventListener('load', onLoad)
  }, [message?.id])

  // Map CID to data URL
  const cidMap = {}
  for (const att of (message?.attachments || [])) {
    const cidRaw = att?.contentId || att?.contentID || att?.content_id
    if (!cidRaw) continue
    const cid = String(cidRaw).replace(/[<>]/g, '').trim()
    const mime = att?.mimeType || att?.type || 'application/octet-stream'
    const data = att?.data || att?.contentBytes || ''
    if (cid && data) cidMap[cid] = `data:${mime};base64,${data}`
  }
  let content = message?.html || message?.text || message?.body || ''

  // If we only have plain text, let's convert it to rich HTML with proper formatting
  if (!message?.html && (message?.text || message?.body)) {
    const textContent = message?.text || message?.body || ''
    // Convert plain text to HTML with enhanced formatting
    content = textContent
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Handle different line ending types
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      // Convert line breaks to HTML
      .replace(/\n\n+/g, '</p><p>')  // Double line breaks = new paragraphs
      .replace(/\n/g, '<br>')        // Single line breaks = <br>
      // Wrap in paragraph tags
      .replace(/^/, '<p>')
      .replace(/$/, '</p>')
      // Fix empty paragraphs
      .replace(/<p><\/p>/g, '')
      // Make email addresses clickable
      .replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '<a href="mailto:$1" style="color: #1a73e8; text-decoration: none;">$1</a>')
      // Make URLs clickable
      .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color: #1a73e8; text-decoration: none;">$1</a>')
      // Style quoted text (lines starting with >)
      .replace(/^&gt;\s*(.*?)(<br>|$)/gm, '<div style="border-left: 3px solid #ccc; padding-left: 12px; margin: 8px 0; color: #666; font-style: italic;">&gt; $1</div>')
      // Style signatures (common patterns)
      .replace(/(Mit freundlichen Grüßen|Kind regards|Best regards|Sincerely)([^<]*?)(<\/p>|$)/gi, '<div style="border-top: 1px solid #e0e0e0; margin-top: 16px; padding-top: 12px; color: #666;">$1$2</div>')
      // Make asterisk text bold
      .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
  }

  // If external content loading is disabled, remove external image sources
  if (!loadExternalContent && content) {
    content = content.replace(/<img[^>]+src=["']https?:\/\/[^"']*["'][^>]*>/gi, (match) => {
      return match.replace(/src=["']https?:\/\/[^"']*["']/gi, 'data-original-src="$&" src=""') +
        '<div style="display:inline-block;padding:8px;background:#f5f5f5;border:1px dashed #ccc;color:#666;font-size:12px;">[External image blocked - Click "Load images" to display]</div>'
    })
  }

  let safe = sanitizeHtml(content, { allowStyle: true })
  safe = rewriteCidSrc(safe, cidMap)
  const srcDoc = buildIframeDoc(safe)

  // Check if email contains external images
  const hasExternalImages = (message?.html || message?.text || message?.body || '').includes('http')

  return (
    <div style={{ position: 'relative' }}>
      {hasExternalImages && !loadExternalContent && (
        <div style={{
          padding: '8px 12px',
          backgroundColor: '#fff3cd',
          border: '1px solid #ffeaa7',
          borderRadius: '4px',
          marginBottom: '8px',
          fontSize: '13px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <span>⚠️ This email contains external images that have been blocked for your privacy.</span>
          <button
            onClick={() => setLoadExternalContent(true)}
            style={{
              padding: '4px 8px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            Load images
          </button>
        </div>
      )}
      <iframe
        ref={iframeRef}
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-same-origin"
        srcDoc={srcDoc}
        title={`email-${message?.id}`}
        style={{
          width: '100%',
          border: '1px solid #e0e0e0',
          borderRadius: 8,
          height,
          backgroundColor: '#ffffff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  )
}

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const formatDate = (dateString) => {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now - date
  const hours = diff / (1000 * 60 * 60)

  if (hours < 24) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } else if (hours < 24 * 7) {
    return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
}


export default function EmailThread({
  threadId,
  onReply,
  onReplyAll,
  onForward,
  onArchive,
  onDelete,
  onBack
}) {
  const { thread, loading, error } = useEmailThread(threadId)
  const [expandedMessages, setExpandedMessages] = useState(new Set())
  const [summary, setSummary] = useState('')
  const [summarizing, setSummarizing] = useState(false)
  const [suggestions, setSuggestions] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [summaryTime, setSummaryTime] = useState(null)
  const [suggestionTime, setSuggestionTime] = useState(null)

  const toggleMessage = (messageId) => {
    const newExpanded = new Set(expandedMessages)
    if (newExpanded.has(messageId)) {
      newExpanded.delete(messageId)
    } else {
      newExpanded.add(messageId)
    }
    setExpandedMessages(newExpanded)
  }

  const expandAll = () => {
    if (thread?.messages) {
      setExpandedMessages(new Set(thread.messages.map(m => m.id)))
    }
  }

  const collapseAll = () => {
    if (thread?.messages && thread.messages.length > 0) {
      setExpandedMessages(new Set([thread.messages[thread.messages.length - 1].id]))
    }
  }

  async function handleSummarize() {
    if (!thread) return
    try {
      setSummarizing(true)
      setSummary('')
      setSummaryTime(null)
      const startTime = Date.now()

      // Enhanced message data with better content extraction
      const minimal = thread.messages.map((m, index) => ({
        from: m.from,
        date: m.date,
        html: m.html,
        text: m.text,
        messageNumber: index + 1,
        totalMessages: thread.messages.length
      }))

      // Debug log to verify all messages are included
      console.log(`🔍 Summarizing ${minimal.length} messages:`, minimal.map(m => ({ from: m.from, hasContent: !!(m.html || m.text) })))

      const out = await summarizeThread(thread.subject, minimal)

      const endTime = Date.now()
      setSummaryTime(((endTime - startTime) / 1000).toFixed(1))
      setSummary(out || 'No summary produced.')
    } catch (e) {
      setSummary('Failed to summarize. Ensure Ollama is running (http://localhost:11434) and try again.')
      setSummaryTime(null)
    } finally {
      setSummarizing(false)
    }
  }

  async function handleSuggestReplies() {
    if (!thread) return
    try {
      setSuggesting(true)
      setSuggestions('')
      setSuggestionTime(null)
      const startTime = Date.now()

      const lastMessage = thread.messages[thread.messages.length - 1]

      // Get current user info (we'll need to fetch this from session)
      let currentUserEmail = 'you@example.com' // Fallback
      try {
        // Try to get actual user email from session
        const sessionResponse = await fetch('/api/v1/session', { credentials: 'include' })
        if (sessionResponse.ok) {
          const sessionData = await sessionResponse.json()
          currentUserEmail = sessionData.data?.user?.email || currentUserEmail
        }
      } catch (e) {
        console.warn('Could not get user session:', e)
      }

      // Determine who we're replying TO (the sender of the last message)
      const replyToSender = lastMessage.from
      const replyToEmail = lastMessage.fromEmail || lastMessage.from

      // Enhanced context for smart replies - focusing on the recipient
      const contextData = {
        subject: thread.subject,
        lastMessage: {
          html: lastMessage.html,
          text: lastMessage.text,
          from: lastMessage.from,
          fromEmail: replyToEmail
        },
        tone: 'neutral',
        fullThread: thread.messages.map(m => ({
          from: m.from,
          html: m.html,
          text: m.text,
          date: m.date
        })),
        currentUserEmail: currentUserEmail,
        replyToSender: replyToSender,
        replyToEmail: replyToEmail
      }

      const out = await suggestReplies(contextData.subject, contextData.lastMessage, {
        tone: contextData.tone,
        fullThread: contextData.fullThread,
        currentUserEmail: contextData.currentUserEmail,
        replyToSender: contextData.replyToSender,
        replyToEmail: contextData.replyToEmail
      })

      const endTime = Date.now()
      setSuggestionTime(((endTime - startTime) / 1000).toFixed(1))
      setSuggestions(out || 'No suggestions produced.')
    } catch (e) {
      setSuggestions('Failed to suggest replies. Ensure Ollama is running and try again.')
      setSuggestionTime(null)
    } finally {
      setSuggesting(false)
    }
  }

  // Auto-expand the latest message when thread loads
  React.useEffect(() => {
    if (thread?.messages && thread.messages.length > 0 && expandedMessages.size === 0) {
      setExpandedMessages(new Set([thread.messages[thread.messages.length - 1].id]))
    }
  }, [thread?.messages, expandedMessages.size])

  const handleCopyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (err) {
      console.error('Failed to copy:', err)
      return false
    }
  }

  const handleAIFeedback = (type, aiType) => {
    console.log(`AI Feedback: ${type} for ${aiType}`)
    // Could send feedback to backend for improving AI responses
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading conversation...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Reply className="w-8 h-8 text-red-500" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Failed to load conversation
          </h3>
          <p className="text-gray-500 mb-6 text-sm leading-relaxed">{error}</p>
          <div className="flex gap-3 justify-center">
            <Button
              onClick={() => {
                // Reset any cached data and retry
                window.location.reload()
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Try Again
            </Button>
            <Button variant="outline" onClick={onBack}>
              Go back
            </Button>
          </div>
          {error.includes('Authentication') && (
            <p className="text-xs text-gray-400 mt-4">
              If the problem persists, try logging out and logging back in.
            </p>
          )}
        </div>
      </div>
    )
  }

  if (!thread) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-center">
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No conversation found
          </h3>
          <Button onClick={onBack}>
            Go back
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 bg-white flex flex-col h-full overflow-hidden">
      {/* Compact Thread header */}
      <div className="flex-shrink-0 border-b border-gray-100 bg-white">
        {/* Top row - Back button and actions */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-50">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            <span className="text-sm">Back</span>
          </Button>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="p-1.5">
              <Archive className="w-4 h-4 text-gray-500" />
            </Button>
            <Button variant="ghost" size="sm" className="p-1.5">
              <Trash2 className="w-4 h-4 text-gray-500" />
            </Button>
            <Button variant="ghost" size="sm" className="p-1.5">
              <Star className="w-4 h-4 text-gray-500" />
            </Button>
            <Button variant="ghost" size="sm" className="p-1.5">
              <MoreHorizontal className="w-4 h-4 text-gray-500" />
            </Button>
          </div>
        </div>

        {/* Main header content */}
        <div className="px-4 py-3">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <h1 className="text-lg font-semibold text-gray-900 truncate">{thread.subject}</h1>
                <Badge variant="outline" className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 border-blue-200">
                  {thread.messages.length}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>{thread.messages.length} messages</span>
                </div>
                <span>•</span>
                <div className="flex items-center gap-1">
                  <div className="flex -space-x-0.5">
                    {thread.participants.slice(0, 2).map((participant, idx) => (
                      <div
                        key={idx}
                        className="w-4 h-4 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full border border-white flex items-center justify-center text-xs font-medium text-white"
                      >
                        {participant.charAt(0).toUpperCase()}
                      </div>
                    ))}
                    {thread.participants.length > 2 && (
                      <div className="w-4 h-4 bg-gray-300 rounded-full border border-white flex items-center justify-center text-xs font-medium text-gray-600">
                        +{thread.participants.length - 2}
                      </div>
                    )}
                  </div>
                  <span>{thread.participants.length} people</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Compact AI buttons */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleSummarize}
                disabled={summarizing}
                className="text-xs px-2 py-1 h-7 border-amber-200 text-amber-700 hover:bg-amber-50"
              >
                {summarizing ? (
                  <Sparkles className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Sparkles className="w-3 h-3 mr-1" />
                )}
                {summarizing ? 'Analyzing...' : 'Summarize'}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleSuggestReplies}
                disabled={suggesting}
                className="text-xs px-2 py-1 h-7 border-blue-200 text-blue-700 hover:bg-blue-50"
              >
                {suggesting ? (
                  <Brain className="w-3 h-3 animate-pulse mr-1" />
                ) : (
                  <Wand2 className="w-3 h-3 mr-1" />
                )}
                {suggesting ? 'Thinking...' : 'Suggest'}
              </Button>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={expandAll}
                  className="text-xs px-2 py-1 h-7 text-gray-600 hover:text-blue-600"
                >
                  <ChevronDown className="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={collapseAll}
                  className="text-xs px-2 py-1 h-7 text-gray-600 hover:text-blue-600"
                >
                  <ChevronUp className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Action bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <Button
              onClick={() => onReply(thread.messages[thread.messages.length - 1])}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-1.5 h-8"
            >
              <Reply className="w-3 h-3 mr-1" />
              Reply
            </Button>
            <Button
              variant="outline"
              onClick={() => onReplyAll(thread.messages[thread.messages.length - 1])}
              className="text-sm px-3 py-1.5 h-8 border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              <ReplyAll className="w-3 h-3 mr-1" />
              Reply All
            </Button>
            <Button
              variant="outline"
              onClick={() => onForward(thread.messages[thread.messages.length - 1])}
              className="text-sm px-3 py-1.5 h-8 border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              <Forward className="w-3 h-3 mr-1" />
              Forward
            </Button>
          </div>

          <div className="text-xs text-gray-500">
            {thread.messages.length} {thread.messages.length === 1 ? 'message' : 'messages'} • {thread.participants.length} participants
          </div>
        </div>
      </div>

      <div className="mx-6 my-2">
        <AIContentBox
          title="AI Summary"
          content={summary}
          isLoading={summarizing}
          isError={summary.includes('Failed to summarize')}
          errorMessage="Failed to connect to AI service"
          type="summary"
          generationTime={summaryTime}
          onCopy={handleCopyToClipboard}
          onFeedback={(type) => handleAIFeedback(type, 'summary')}
        />
      </div>

      <div className="mx-6 my-2">
        <AIContentBox
          title="Smart Reply Suggestions"
          content={suggestions}
          isLoading={suggesting}
          isError={suggestions.includes('Failed to suggest')}
          errorMessage="Failed to generate reply suggestions"
          type="suggestions"
          generationTime={suggestionTime}
          onCopy={handleCopyToClipboard}
          onFeedback={(type) => handleAIFeedback(type, 'suggestions')}
        />
      </div>

      {/* Modern Thread messages */}
      <div className="flex-1 overflow-y-auto bg-gray-50/30">
        <div className="max-w-6xl mx-auto p-4 space-y-3">
          {thread.messages.map((message, index) => {
            const isExpanded = expandedMessages.has(message.id)
            const isLast = index === thread.messages.length - 1
            const isFirst = index === 0

            return (
              <div key={message.id} className="relative">
                {/* Timeline connector */}
                {!isLast && (
                  <div className="absolute left-6 top-16 w-0.5 h-8 bg-gray-200 z-0" />
                )}

                {/* Message bubble */}
                <div
                  className={cn(
                    "relative bg-white rounded-xl shadow-sm border transition-all duration-200 hover:shadow-md",
                    isLast && "border-blue-200 shadow-blue-50",
                    isExpanded ? "border-gray-200" : "border-gray-100"
                  )}
                >
                  {/* Message preview header */}
                  <div
                    className={cn(
                      "p-4 cursor-pointer transition-colors rounded-xl",
                      isExpanded && "rounded-b-none bg-gray-50/50 border-b border-gray-100"
                    )}
                    onClick={() => toggleMessage(message.id)}
                  >
                    <div className="flex items-start gap-3">
                      {/* Avatar with status indicator */}
                      <div className="relative flex-shrink-0">
                        <Avatar className="w-10 h-10 ring-2 ring-white shadow-sm">
                          {hasValidAvatar(message.avatar) && <AvatarImage src={message.avatar} />}
                          <AvatarFallback className={cn(
                            generateAvatarProps(message.from, message.fromEmail).colorClass,
                            generateAvatarProps(message.from, message.fromEmail).textColor,
                            "text-sm font-semibold"
                          )}>
                            {generateAvatarProps(message.from, message.fromEmail).initials}
                          </AvatarFallback>
                        </Avatar>
                        {isLast && (
                          <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white" />
                        )}
                      </div>

                      {/* Message info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-gray-900 truncate">
                            {message.from}
                          </span>
                          <span className="text-xs text-gray-500 font-medium">
                            {formatDate(message.date)}
                          </span>
                          {message.labels.map((label, labelIndex) => (
                            <Badge key={`${message.id}-${label}-${labelIndex}`} variant="secondary" className="text-xs px-2 py-0.5">
                              {label}
                            </Badge>
                          ))}
                        </div>

                        <div className="text-sm text-gray-600 mb-2">
                          <span className="font-medium">to</span> {Array.isArray(message.to) ? message.to.join(', ') : message.to || 'unknown'}
                          {message.cc && message.cc.length > 0 && (
                            <span> • <span className="font-medium">cc</span> {Array.isArray(message.cc) ? message.cc.join(', ') : message.cc}</span>
                          )}
                        </div>

                        {/* Message preview */}
                        {!isExpanded && (
                          <div className="text-sm text-gray-700 line-clamp-2">
                            {message.snippet || 'Click to view message content...'}
                          </div>
                        )}

                        {/* Attachments indicator */}
                        {message.attachments && message.attachments.length > 0 && (
                          <div className="flex items-center gap-1 mt-2">
                            <Paperclip className="w-3 h-3 text-gray-400" />
                            <span className="text-xs text-gray-500">
                              {message.attachments.length} attachment{message.attachments.length > 1 ? 's' : ''}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Expand/collapse button */}
                      <div className="flex-shrink-0 flex items-center gap-2">
                        <Button variant="ghost" size="sm" className="p-1.5 h-auto">
                          <Star className="w-4 h-4 text-gray-400 hover:text-yellow-500 transition-colors" />
                        </Button>
                        <Button variant="ghost" size="sm" className="p-1.5 h-auto">
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-gray-600" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-gray-600" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Expanded message content */}
                  {isExpanded && (
                    <div className="px-4 pb-4">
                      {/* Content container with modern styling */}
                      <div className="bg-white rounded-lg border border-gray-100 overflow-hidden">
                        <EmailHtmlFrame message={message} />
                      </div>

                      {/* Modern Attachments */}
                      {message.attachments && message.attachments.length > 0 && (
                        <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
                          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                            <Paperclip className="w-4 h-4" />
                            {message.attachments.length} attachment{message.attachments.length > 1 ? 's' : ''}
                          </h4>
                          <div className="grid gap-2">
                            {message.attachments.map((attachment) => (
                              <div
                                key={attachment.id}
                                className="flex items-center gap-3 p-2 bg-white rounded-lg border border-gray-100 hover:border-blue-200 hover:bg-blue-50/30 transition-all cursor-pointer group"
                              >
                                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200 transition-colors">
                                  <FileText className="w-4 h-4 text-blue-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-900 truncate">
                                    {attachment.name || 'Attachment'}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {formatFileSize(attachment.size || 0)}
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <Download className="w-4 h-4 text-gray-500" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Quick Actions */}
                      <div className="mt-4 flex items-center justify-between pt-3 border-t border-gray-100">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onReply(message)}
                            className="text-xs px-2 py-1.5 h-7 text-blue-600 hover:bg-blue-50"
                          >
                            <Reply className="w-3 h-3 mr-1" />
                            Reply
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onReplyAll(message)}
                            className="text-xs px-2 py-1.5 h-7 text-gray-600 hover:bg-gray-50"
                          >
                            <ReplyAll className="w-3 h-3 mr-1" />
                            Reply All
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onForward(message)}
                            className="text-xs px-2 py-1.5 h-7 text-gray-600 hover:bg-gray-50"
                          >
                            <Forward className="w-3 h-3 mr-1" />
                            Forward
                          </Button>
                        </div>

                        <div className="text-xs text-gray-400">
                          {isLast ? 'Latest message' : `Message ${index + 1} of ${thread.messages.length}`}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
