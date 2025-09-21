import React, { useState, useMemo, useEffect } from 'react'
import { FixedSizeList as VirtualList } from 'react-window'
import {
  Star,
  Paperclip,
  MoreHorizontal,
  Archive,
  Trash2,
  Clock,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '../ui/avatar'
import { ScrollArea } from '../ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { generateAvatarProps, hasValidAvatar } from '../../utils/avatarUtils'
import { getInboxDisplayName, getInboxAvatarProps, getCurrentUserEmail } from '../../utils/emailDisplay'

// No more mock data - using real API data

export default function EmailList({
  emails = [],
  loading = false,
  error = null,
  hasMore = false,
  hasPrev = false,
  total = null,
  currentPage = 1,
  selectedEmails = new Set(),
  selectedEmailId,
  onEmailSelect,
  onEmailAction,
  onToggleSelection,
  onSelectAll,
  onClearSelection,
  onLoadNext,
  onLoadPrev
}) {
  const [selectAll, setSelectAll] = useState(false)
  const [currentUserEmail, setCurrentUserEmail] = useState(null)

  // Get current user email for display logic
  useEffect(() => {
    getCurrentUserEmail().then(email => {
      setCurrentUserEmail(email)
    })
  }, [])

  const filteredEmails = emails
  const pageSize = 50
  const rangeStart = (currentPage - 1) * pageSize + 1
  const rangeEnd = rangeStart + Math.max(0, filteredEmails.length - 1)

  const handleSelectAll = () => {
    if (selectAll) {
      onClearSelection?.()
    } else {
      onSelectAll?.()
    }
    setSelectAll(!selectAll)
  }

  const handleEmailSelect = (emailId) => {
    onToggleSelection?.(emailId)
  }

  // Update selectAll state based on selectedEmails
  React.useEffect(() => {
    setSelectAll(selectedEmails.size === filteredEmails.length && filteredEmails.length > 0)
  }, [selectedEmails.size, filteredEmails.length])

  const getLabelVariant = (label) => {
    const variants = {
      work: 'work',
      personal: 'personal',
      finance: 'finance',
      marketing: 'marketing',
      updates: 'updates',
      new: 'new'
    }
    return variants[label] || 'default'
  }

  const formatTime = (time) => {
    // In a real app, you'd format actual timestamps
    return time
  }


  // Loading state
  if (loading && filteredEmails.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading emails...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Clock className="w-8 h-8 text-red-500" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Failed to load emails
          </h3>
          <p className="text-gray-500 mb-4">{error}</p>
          <Button onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  // Empty state
  if (filteredEmails.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
            <Clock className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No emails found
          </h3>
          <p className="text-gray-500">
            Your inbox is empty or try adjusting your search terms
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 bg-white flex flex-col h-full overflow-hidden">
      {/* Email list controls */}
      <div className="flex-shrink-0 border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selectAll}
              onChange={handleSelectAll}
              className="rounded border-gray-300 cursor-pointer"
            />
            <span className="text-sm text-gray-600">Select all</span>
          </label>

          <div className="flex items-center gap-3 ml-4 flex-1">
            {selectedEmails.size > 0 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEmailAction('archive', Array.from(selectedEmails))}
                >
                  <Archive className="w-4 h-4 mr-1" />
                  Archive
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEmailAction('delete', Array.from(selectedEmails))}
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  Delete
                </Button>
              </div>
            )}

            <div className="ml-auto flex items-center gap-3 text-sm text-gray-600">
              <span className="tabular-nums">
                {`${rangeStart}–${rangeEnd}${typeof total === 'number' ? ` of ${total}` : ''}`}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Previous 50"
                  onClick={onLoadPrev}
                  disabled={loading || !hasPrev}
                  className="h-8 w-8 p-0 rounded-full"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Next 50"
                  onClick={onLoadNext}
                  disabled={loading || !hasMore}
                  className="h-8 w-8 p-0 rounded-full"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Email list (virtualized) */}
      <div className="flex-1 overflow-hidden">
<VirtualList
  height={typeof window !== 'undefined' ? Math.max(240, window.innerHeight - 240) : 600}
  itemCount={filteredEmails.length}
  itemSize={72}
  width={'100%'}
  overscanCount={6}
  itemKey={(index) => {
    const e = filteredEmails[index];
    // Use stable identity; include read-state so a toggle forces a re-render
    const id = e?.id ?? e?.messageId ?? index;
    const r = e?.isRead ? 'r' : 'u';
    const key = `${id}-${r}`;
    console.log(`🔑 VirtualList itemKey for index ${index}: ${key} (email: ${id}, isRead: ${e?.isRead})`);
    return key;
  }}
>


          {({ index, style }) => {
            const email = filteredEmails[index]

            // Always log email rendering for debugging
            console.log(`🎨 EmailList: Rendering email ${email.id} at index ${index}:`, {
              isRead: email.isRead,
              readStatus: email.isRead ? 'READ' : 'UNREAD',
              id: email.id,
              threadId: email.threadId,
              messageId: email.messageId
            });

            const backgroundColor = selectedEmailId === email.id
              ? undefined // Let selection color take precedence
              : email.isRead
                ? 'oklch(98.5% 0.002 247.839)' // Read email background
                : 'oklch(95.4% 0.038 75.164)' // Unread email background

            console.log(`🎨 Background color for ${email.id}: ${backgroundColor || 'selection color'}`);

            return (
              <div
                key={`${email.id}-${email.isRead ? 'read' : 'unread'}`}
                style={{
                  ...style,
                  backgroundColor
                }}
                ref={(el) => {
                  if (el) {
                    console.log(`🎨 EmailList: DOM element for ${email.id} rendered with background: ${el.style.backgroundColor}`);
                  }
                }}
                className={cn(
                  "email-item flex items-center gap-4 p-3 hover:bg-gray-50 cursor-pointer transition-colors border-b border-gray-100",
                  // Apply read/unread background first, then selection highlight so selection wins
                  email.isRead ? "read" : "unread",
                  selectedEmailId === email.id && "bg-blue-50 border-r-2 border-blue-500"
                )}
                data-message-id={email.id}
                data-thread-id={email.threadId}
                data-read-status={email.isRead ? 'read' : 'unread'}
                onClick={() => onEmailSelect(email.id)}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={selectedEmails.has(email.id)}
                  onChange={(e) => {
                    e.stopPropagation()
                    handleEmailSelect(email.id)
                  }}
                  className="rounded border-gray-300"
                />

                {/* Star */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onEmailAction('star', [email.id])
                  }}
                  className={cn(
                    "p-1 rounded cursor-pointer",
                    email.isStarred ? "text-yellow-500" : "text-gray-300 hover:text-gray-500"
                  )}
                >
                  <Star className={cn("w-4 h-4", email.isStarred && "fill-current")} />
                </button>

                {/* Avatar */}
                <Avatar className="w-8 h-8 flex-shrink-0">
                  {hasValidAvatar(email.avatar) && <AvatarImage src={email.avatar} />}
                  <AvatarFallback className={cn(
                    (() => {
                      const avatarProps = getInboxAvatarProps(email, currentUserEmail)
                      const generated = generateAvatarProps(avatarProps.name, avatarProps.email)
                      return `${generated.colorClass} ${generated.textColor}`
                    })(),
                    "text-sm font-medium"
                  )}>
                    {(() => {
                      const avatarProps = getInboxAvatarProps(email, currentUserEmail)
                      const generated = generateAvatarProps(avatarProps.name, avatarProps.email)
                      return generated.initials
                    })()}
                  </AvatarFallback>
                </Avatar>

                {/* Email content */}
                <div className="flex-1 min-w-0">
                  {/* Sender name on top */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn(
                      "font-medium text-gray-900 truncate",
                      !email.isRead && "font-semibold"
                    )}>
                      {getInboxDisplayName(email, currentUserEmail)}
                    </span>
                    {/* {email.labels.map((label, idx) => (
                      <Badge key={`${email.id}-${label}-${idx}`} variant={getLabelVariant(label)} className="text-xs">
                        {label}
                      </Badge>
                    ))} */}
                    {email.hasAttachment && (
                      <Paperclip className="w-3 h-3 text-gray-400" />
                    )}
                  </div>
                  {/* Subject below sender */}
                  <h3 className={cn(
                    "text-sm text-gray-900 truncate mb-1",
                    !email.isRead && "font-semibold"
                  )}>
                    {email.subject}
                  </h3>
                  <p className="text-sm text-gray-500 truncate">
                    {email.preview}
                  </p>
                </div>

                {/* Time and actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-gray-500">
                    {formatTime(email.time)}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="p-1 opacity-0 group-hover:opacity-100"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {email.isRead ? (
                    <DropdownMenuItem onClick={() => onEmailAction('unread', [email.id])}>
                      Mark as unread
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => onEmailAction('read', [email.id])}>
                      Mark as read
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => onEmailAction('archive', [email.id])}>
                    <Archive className="w-4 h-4 mr-2" />
                    Archive
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onEmailAction('delete', [email.id])}>
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            )
          }}
        </VirtualList>
      </div>
    </div>
  )
}
