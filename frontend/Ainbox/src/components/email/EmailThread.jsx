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
import { processEmailContent, applyEmailStyles } from '../../utils/htmlUtils'
import { summarizeThread, suggestReplies } from '../../services/aiApi'
import AIContentBox from '../ui/AIContentBox'

// Using real thread data from useEmailThread hook

// Component for rendering email content (HTML or plain text)
const EmailContent = ({ content }) => {
  const processedContent = processEmailContent(content)

  if (!processedContent.safeHtml) {
    return (
      <div className="text-gray-900 text-sm leading-relaxed">
        No content available
      </div>
    )
  }

  return (
    <div
      className="email-content text-sm leading-relaxed"
      dangerouslySetInnerHTML={{
        __html: applyEmailStyles(processedContent.safeHtml)
      }}
      style={{
        wordWrap: 'break-word',
        maxWidth: '100%',
        overflow: 'hidden'
      }}
    />
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

      // Enhanced context for smart replies
      const contextData = {
        subject: thread.subject,
        lastMessage: {
          html: lastMessage.html,
          text: lastMessage.text,
          from: lastMessage.from
        },
        tone: 'neutral',
        fullThread: thread.messages.map(m => ({
          from: m.from,
          html: m.html,
          text: m.text,
          date: m.date
        })),
        currentUserEmail: 'user@example.com' // You can get this from session context
      }

      const out = await suggestReplies(contextData.subject, contextData.lastMessage, {
        tone: contextData.tone,
        fullThread: contextData.fullThread,
        currentUserEmail: contextData.currentUserEmail
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
      {/* Thread header */}
      <div className="flex-shrink-0 border-b border-gray-200 p-6">
        {/* Back button */}
        <div className="flex items-center gap-4 mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="group text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-all duration-200 rounded-lg"
          >
            <ArrowLeft className="w-4 h-4 mr-2 group-hover:translate-x-[-2px] transition-transform duration-200" />
            <span className="font-medium">Back to emails</span>
          </Button>
        </div>

        <div className="flex items-start justify-between mb-6">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3">
              <h1 className="text-xl font-semibold text-gray-900">{thread.subject}</h1>
              <div className="flex items-center gap-2">
                {/* Thread status indicators */}
                <div className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  Active
                </div>
                <Badge variant="secondary" className="text-xs">
                  <MessageSquare className="w-3 h-3 mr-1" />
                  {thread.messages.length}
                </Badge>
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <div className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                <span>{thread.messages.length} messages</span>
              </div>
              <span>•</span>
              <div className="flex items-center gap-2">
                <div className="flex -space-x-1">
                  {thread.participants.slice(0, 3).map((participant, idx) => (
                    <div
                      key={idx}
                      className="w-6 h-6 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full border-2 border-white flex items-center justify-center text-xs font-medium text-white"
                    >
                      {participant.charAt(0).toUpperCase()}
                    </div>
                  ))}
                  {thread.participants.length > 3 && (
                    <div className="w-6 h-6 bg-gray-300 rounded-full border-2 border-white flex items-center justify-center text-xs font-medium text-gray-600">
                      +{thread.participants.length - 3}
                    </div>
                  )}
                </div>
                <span>{thread.participants.length} participants</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* AI Summarize Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleSummarize}
              disabled={summarizing}
              className={cn(
                "group relative overflow-hidden transition-all duration-300",
                "hover:bg-gradient-to-r hover:from-yellow-50 hover:to-orange-50",
                "hover:border-yellow-300 hover:shadow-md",
                "disabled:opacity-60 disabled:cursor-not-allowed",
                summarizing && "bg-yellow-50 border-yellow-200"
              )}
            >
              <div className="flex items-center gap-2">
                {summarizing ? (
                  <div className="relative">
                    <Sparkles className="w-4 h-4 text-yellow-600 animate-spin" />
                    <div className="absolute inset-0 w-4 h-4 bg-yellow-200 rounded-full animate-ping opacity-20" />
                  </div>
                ) : (
                  <Sparkles className="w-4 h-4 text-yellow-600 group-hover:text-yellow-700 transition-colors" />
                )}
                <span className="font-medium">
                  {summarizing ? `Analyzing ${thread?.messages?.length || 0} messages…` : `AI Summary`}
                </span>
              </div>
              {!summarizing && (
                <div className="absolute inset-0 bg-gradient-to-r from-yellow-400/0 via-yellow-400/10 to-yellow-400/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
              )}
            </Button>

            {/* AI Suggest Replies Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleSuggestReplies}
              disabled={suggesting}
              className={cn(
                "group relative overflow-hidden transition-all duration-300",
                "hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50",
                "hover:border-blue-300 hover:shadow-md",
                "disabled:opacity-60 disabled:cursor-not-allowed",
                suggesting && "bg-blue-50 border-blue-200"
              )}
            >
              <div className="flex items-center gap-2">
                {suggesting ? (
                  <div className="relative">
                    <Brain className="w-4 h-4 text-blue-600 animate-pulse" />
                    <div className="absolute inset-0 w-4 h-4 bg-blue-200 rounded-full animate-ping opacity-20" />
                  </div>
                ) : (
                  <Wand2 className="w-4 h-4 text-blue-600 group-hover:text-blue-700 transition-colors" />
                )}
                <span className="font-medium">
                  {suggesting ? 'Crafting…' : 'Smart Replies'}
                </span>
              </div>
              {!suggesting && (
                <div className="absolute inset-0 bg-gradient-to-r from-blue-400/0 via-blue-400/10 to-blue-400/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={expandAll}
              className="group text-blue-600 hover:text-blue-700 hover:bg-blue-50 transition-all duration-200"
            >
              <ChevronDown className="w-4 h-4 mr-1 group-hover:scale-110 transition-transform" />
              Expand all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={collapseAll}
              className="group text-gray-600 hover:text-gray-700 hover:bg-gray-50 transition-all duration-200"
            >
              <ChevronUp className="w-4 h-4 mr-1 group-hover:scale-110 transition-transform" />
              Collapse all
            </Button>

            <div className="w-px h-6 bg-gray-300 mx-2" />

            <Button variant="ghost" size="sm">
              <Archive className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm">
              <Trash2 className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm">
              <Star className="w-4 h-4" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Mark as unread</DropdownMenuItem>
                <DropdownMenuItem>Add label</DropdownMenuItem>
                <DropdownMenuItem>Print</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-3">
          <Button
            onClick={() => onReply(thread.messages[thread.messages.length - 1])}
            className="group bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg transition-all duration-200"
          >
            <Reply className="w-4 h-4 mr-2 group-hover:scale-110 transition-transform" />
            <span className="font-medium">Reply</span>
          </Button>
          <Button
            variant="outline"
            onClick={() => onReplyAll(thread.messages[thread.messages.length - 1])}
            className="group border-blue-200 text-blue-600 hover:bg-blue-50 hover:border-blue-300 transition-all duration-200"
          >
            <ReplyAll className="w-4 h-4 mr-2 group-hover:scale-110 transition-transform" />
            <span className="font-medium">Reply All</span>
          </Button>
          <Button
            variant="outline"
            onClick={() => onForward(thread.messages[thread.messages.length - 1])}
            className="group border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all duration-200"
          >
            <Forward className="w-4 h-4 mr-2 group-hover:scale-110 transition-transform" />
            <span className="font-medium">Forward</span>
          </Button>
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

      {/* Thread messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-4">
          {thread.messages.map((message, index) => {
            const isExpanded = expandedMessages.has(message.id)
            const isLast = index === thread.messages.length - 1

            return (
              <div
                key={message.id}
                className={cn(
                  "border border-gray-200 rounded-lg overflow-hidden",
                  isLast && "border-blue-200 bg-blue-50/30"
                )}
              >
                {/* Message header */}
                <div
                  className={cn(
                    "p-4 cursor-pointer hover:bg-gray-50 transition-colors",
                    isExpanded && "border-b border-gray-200"
                  )}
                  onClick={() => toggleMessage(message.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar className="w-8 h-8">
                        {hasValidAvatar(message.avatar) && <AvatarImage src={message.avatar} />}
                        <AvatarFallback className={cn(
                          generateAvatarProps(message.from, message.fromEmail).colorClass,
                          generateAvatarProps(message.from, message.fromEmail).textColor,
                          "text-xs font-medium"
                        )}>
                          {generateAvatarProps(message.from, message.fromEmail).initials}
                        </AvatarFallback>
                      </Avatar>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">
                            {message.from}
                          </span>
                          {message.labels.map((label, index) => (
                            <Badge key={`${message.id}-${label}-${index}`} variant={label} className="text-xs">
                              {label}
                            </Badge>
                          ))}
                        </div>
                        <div className="text-sm text-gray-500">
                          to {Array.isArray(message.to) ? message.to.join(', ') : message.to || 'unknown'}
                          {message.cc && message.cc.length > 0 && ` • cc ${Array.isArray(message.cc) ? message.cc.join(', ') : message.cc}`}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500">
                        {formatDate(message.date)}
                      </span>
                      {message.attachments.length > 0 && (
                        <Paperclip className="w-4 h-4 text-gray-400" />
                      )}
                      <Button variant="ghost" size="sm" className="p-1">
                        <Star className="w-4 h-4 text-gray-400" />
                      </Button>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Message content */}
                {isExpanded && (
                  <div className="p-4 pt-0">
                    <div className="max-w-none">
                      <EmailContent content={message.body} />
                    </div>

                    {/* Attachments */}
                    {message.attachments.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <h4 className="text-sm font-medium text-gray-700 mb-3">
                          {message.attachments.length} attachment{message.attachments.length > 1 ? 's' : ''}
                        </h4>
                        <div className="space-y-2">
                          {message.attachments.map((attachment) => (
                            <div
                              key={attachment.id}
                              className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                            >
                              <div className="w-8 h-8 bg-blue-100 rounded flex items-center justify-center flex-shrink-0">
                                <Paperclip className="w-4 h-4 text-blue-600" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-gray-900 truncate">
                                  {attachment.name}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {formatFileSize(attachment.size)}
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="p-2 text-gray-400 hover:text-gray-600"
                              >
                                <Download className="w-4 h-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Message actions */}
                    <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onReply(message)}
                      >
                        <Reply className="w-4 h-4 mr-1" />
                        Reply
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onReplyAll(message)}
                      >
                        <ReplyAll className="w-4 h-4 mr-1" />
                        Reply All
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onForward(message)}
                      >
                        <Forward className="w-4 h-4 mr-1" />
                        Forward
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
