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
  ChevronRight,
  Mail,
  MailOpen
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
import { getInboxDisplayName, getInboxAvatarProps } from '../../utils/emailDisplay'
import { useSession } from '../../hooks/useSession'

// EmailList Component - Fixed for stable rendering and proper background colors
// Key fixes:
// 1. VirtualList itemKey includes read state + index for proper re-rendering
// 2. Background colors use CSS classes with clear precedence (selection > read/unread)
// 3. Smooth transitions with CSS duration-200
// 4. Removed conflicting inline styles

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
  const { user } = useSession()
  const currentUserEmail = user?.email?.toLowerCase() || null

  const filteredEmails = emails
  const pageSize = 50
  const rangeStart = (currentPage - 1) * pageSize + 1
  const rangeEnd = rangeStart + Math.max(0, filteredEmails.length - 1)

  // Smart action logic: prioritize unread emails
  const selectedEmailObjects = useMemo(() => {
    return filteredEmails.filter(email => selectedEmails.has(email.id))
  }, [filteredEmails, selectedEmails])

  const hasUnreadSelected = selectedEmailObjects.some(email => !email.isRead)
  const hasReadSelected = selectedEmailObjects.some(email => email.isRead)

  // Priority logic: if ANY unread emails are selected, show "mark as read" action
  const primaryReadAction = hasUnreadSelected ? 'read' : 'unread'
  const ReadActionIcon = hasUnreadSelected ? MailOpen : Mail
  const readActionText = hasUnreadSelected ? 'Mark as read' : 'Mark as unread'

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
          {/* Beautiful select all checkbox */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer group">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={selectAll}
                  onChange={handleSelectAll}
                  className="w-4 h-4 text-blue-600 bg-white border-2 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 transition-all duration-200 cursor-pointer group-hover:border-blue-400"
                />
              </div>
              <span className="text-sm text-gray-600 font-medium">Select all</span>
            </label>

            {selectedEmails.size > 0 && (
              <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full font-medium">
                {selectedEmails.size} selected
              </span>
            )}
          </div>

          {/* Action toolbar - only visible when emails are selected */}
          <div className="flex items-center gap-3 flex-1">
            {selectedEmails.size > 0 && (
              <div className="flex items-center gap-1 ml-4">
                {/* Smart read/unread action button */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEmailAction(primaryReadAction, Array.from(selectedEmails))}
                  className="hover:bg-blue-50 hover:text-blue-700"
                  title={readActionText}
                >
                  <ReadActionIcon className="w-4 h-4" />
                </Button>

                {/* Archive button */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEmailAction('archive', Array.from(selectedEmails))}
                  className="hover:bg-green-50 hover:text-green-700"
                  title="Archive"
                >
                  <Archive className="w-4 h-4" />
                </Button>

                {/* Delete button */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEmailAction('delete', Array.from(selectedEmails))}
                  className="hover:bg-red-50 hover:text-red-700"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            )}

            {/* Pagination controls */}
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
    // FIXED: Include read state AND index for proper re-rendering when status changes
    const id = e?.id || e?.threadId || e?.messageId || index;
    const readState = e?.isRead ? 'read' : 'unread';
    const key = `${id}-${readState}-${index}`;
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

            // FIXED: Clear background color precedence - selection > read/unread state
            const isSelected = selectedEmailId === email.id;
            const baseClasses = "email-item flex items-center gap-4 p-3 cursor-pointer border-b border-gray-100 transition-colors duration-200";

            console.log(`🎨 Email ${email.id} rendering: selected=${isSelected}, isRead=${email.isRead}`);

            return (
              <div
                key={`${email.id || email.threadId}-${email.isRead ? 'read' : 'unread'}-${index}`}
                style={style}
                className={cn(
                  baseClasses,
                  // FIXED: Clear precedence - selection highlight overrides read/unread
                  isSelected
                    ? "bg-blue-50 border-r-2 border-blue-500" // Selection takes priority
                    : email.isRead
                      ? "bg-gray-50/30 hover:bg-gray-100/50" // Read email styling
                      : "font-medium", // Unread email styling with custom background
                  // Apply custom unread background color
                  !isSelected && !email.isRead && "unread-email-bg",
                  "hover:bg-gray-100" // Hover state for all emails
                )}
                data-message-id={email.id}
                data-thread-id={email.threadId}
                data-message-id-raw={email.messageId}
                data-read-status={email.isRead ? 'read' : 'unread'}
                onClick={() => onEmailSelect(email.id)}
              >
                {/* Beautiful checkbox */}
                <div
                  className="relative flex items-center justify-center cursor-pointer group"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleEmailSelect(email.id)
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedEmails.has(email.id)}
                    onChange={() => {}}
                    className="w-4 h-4 text-blue-600 bg-white border-2 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 transition-all duration-200 cursor-pointer group-hover:border-blue-400"
                  />
                </div>

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
