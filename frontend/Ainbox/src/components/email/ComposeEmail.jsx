import React, { useState, useRef, useEffect } from 'react'
import {
  X,
  Paperclip,
  Send,
  Minimize2,
  Maximize2,
  FileText,
  FileImage,
  File,
  Plus
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Badge } from '../ui/badge'
import { Progress } from '../ui/progress'
import { cn } from '../../lib/utils'

const getFileIcon = (fileName) => {
  const extension = fileName.split('.').pop()?.toLowerCase()

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension)) {
    return FileImage
  } else if (['pdf'].includes(extension)) {
    return FileText
  } else {
    return File
  }
}

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export default function ComposeEmail({ isOpen, onClose, onSend, replyTo = null, forward = null, replyAll = false }) {
  // Initialize props changes
  useEffect(() => {
    // No-op: keep effect to react to replyTo changes if needed
  }, [replyTo])

  // Helper function to extract email from "Name <email>" format or just email
  const extractEmailAddress = (fromString) => {
    if (!fromString) return ''
    const match = fromString.match(/<(.+?)>/)
    if (match) {
      return match[1].trim()
    }
    return fromString.trim()
  }

  // Helper function to extract display name from "Name <email>" format
  const extractDisplayName = (fromString) => {
    if (!fromString) return ''
    const match = fromString.match(/^(.*?)\s*</)
    if (match && match[1].trim()) {
      return match[1].trim().replace(/^["']|["']$/g, '') // Remove quotes
    }
    return extractEmailAddress(fromString) // Return email if no name
  }

  // Initialize recipients
  const initializeRecipients = () => {
    if (!replyTo) return []

    console.log('🎯 Initializing recipients for reply')
    const senderEmail = extractEmailAddress(replyTo.from)
    const senderName = extractDisplayName(replyTo.from)

    console.log('📧 Sender email:', senderEmail)
    console.log('👤 Sender name:', senderName)

    if (!senderEmail) {
      console.warn('⚠️ No sender email found!')
      return []
    }

    return [{
      id: `reply-${Date.now()}`,
      email: senderEmail,
      name: senderName,
      display: senderName || senderEmail,
      type: 'to'
    }]
  }

  const [recipients, setRecipients] = useState(initializeRecipients)
  const [newRecipient, setNewRecipient] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState([])
  const [isMinimized, setIsMinimized] = useState(false)
  const [isSending, setIsSending] = useState(false)

  const fileInputRef = useRef(null)

  // Initialize subject and body when replyTo changes
  useEffect(() => {
    if (replyTo) {
      const originalSubject = replyTo.subject || ''
      const replySubject = originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`
      setSubject(replySubject)

      const originalBody = `

On ${replyTo.date || 'Unknown date'}, ${replyTo.from || 'Unknown sender'} wrote:

${replyTo.text || replyTo.html || replyTo.body || ''}
`
      setBody(originalBody)
    } else if (forward) {
      const originalSubject = forward.subject || ''
      const forwardSubject = originalSubject.startsWith('Fwd:') ? originalSubject : `Fwd: ${originalSubject}`
      setSubject(forwardSubject)

      const forwardBody = `

---------- Forwarded message ---------
From: ${forward.from || 'Unknown sender'}
Date: ${forward.date || 'Unknown date'}
Subject: ${forward.subject || 'No subject'}

${forward.text || forward.html || forward.body || ''}
`
      setBody(forwardBody)
    } else {
      setSubject('')
      setBody('')
    }
  }, [replyTo, forward])

  // Re-initialize recipients when props change
  useEffect(() => {
    setRecipients(initializeRecipients())
  }, [replyTo, replyAll])

  const addRecipient = () => {
    if (!newRecipient.trim()) return

    const email = extractEmailAddress(newRecipient)
    const name = extractDisplayName(newRecipient)

    const newRecipientObj = {
      id: Date.now(),
      email: email,
      name: name,
      display: name || email,
      type: 'to'
    }

    setRecipients(prev => [...prev, newRecipientObj])
    setNewRecipient('')
  }

  const removeRecipient = (recipientId) => {
    setRecipients(prev => prev.filter(r => r.id !== recipientId))
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addRecipient()
    }
  }

  const handleFileSelect = (event) => {
    const files = Array.from(event.target.files)

    files.forEach(file => {
      const newAttachment = {
        id: Date.now() + Math.random(),
        file,
        name: file.name,
        size: file.size,
        progress: 100,
        status: 'completed'
      }

      setAttachments(prev => [...prev, newAttachment])
    })

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const removeAttachment = (attachmentId) => {
    setAttachments(prev => prev.filter(att => att.id !== attachmentId))
  }

  const handleSend = async () => {
    if (recipients.length === 0 || !subject.trim()) {
      alert('Please add at least one recipient and a subject')
      return
    }

    setIsSending(true)

    try {
      const emailData = {
        to: recipients.map(r => r.email),
        subject,
        body,
        attachments: attachments.filter(att => att.status === 'completed'),
        replyToId: replyTo?.id,
        forwardId: forward?.id
      }

      if (onSend) {
        await onSend(emailData)
      }

      // Reset form
      setRecipients([])
      setNewRecipient('')
      setSubject('')
      setBody('')
      setAttachments([])
      onClose()
    } catch (error) {
      console.error('Failed to send email:', error)
      alert('Failed to send email. Please try again.')
    } finally {
      setIsSending(false)
    }
  }

  const handleKeyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      handleSend()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className={cn(
          "w-full max-w-4xl h-[80vh] p-0 gap-0 bg-white shadow-2xl",
          isMinimized && "max-w-sm h-16"
        )}
        onKeyDown={handleKeyDown}
      >
        {/* Modern Header */}
        <DialogHeader className="px-6 py-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-100 flex-row items-center justify-between space-y-0">
          <DialogTitle className="text-xl font-semibold text-gray-800 flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
            {replyTo ? 'Reply' : forward ? 'Forward' : 'New Message'}
          </DialogTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-2 hover:bg-white/50 text-gray-600"
            >
              {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="p-2 hover:bg-red-50 hover:text-red-600 text-gray-600"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </DialogHeader>

        {!isMinimized && (
          <div className="flex flex-col h-full">
            {/* Recipients Section */}
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <label className="text-sm font-medium text-gray-700 min-w-12 pt-3">To</label>
                  <div className="flex-1 space-y-2">
                    {/* Recipient Badges */}
                    {recipients.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {recipients.map(recipient => (
                          <Badge
                            key={recipient.id}
                            className="px-3 py-2 bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-2 hover:bg-blue-200 transition-colors"
                          >
                            <span className="text-sm font-medium">{recipient.display}</span>
                            <button
                              onClick={() => removeRecipient(recipient.id)}
                              className="text-blue-600 hover:text-blue-800 hover:bg-blue-300 rounded-full p-0.5"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Add Recipient Input */}
                    <div className="flex gap-2">
                      <Input
                        value={newRecipient}
                        onChange={(e) => setNewRecipient(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Add recipients..."
                        className="flex-1 border-gray-200 focus:border-blue-400 focus:ring-blue-400"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={addRecipient}
                        className="px-3 border-gray-200 hover:border-blue-400 hover:bg-blue-50"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Subject */}
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-gray-700 min-w-12">Subject</label>
                  <Input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Subject"
                    className="flex-1 border-gray-200 focus:border-blue-400 focus:ring-blue-400"
                  />
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 p-6">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Compose your message..."
                className="w-full h-full resize-none border-gray-200 focus:border-blue-400 focus:ring-blue-400 text-base leading-relaxed"
              />
            </div>

            {/* Attachments */}
            {attachments.length > 0 && (
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Attachments</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {attachments.map((attachment) => {
                    const FileIcon = getFileIcon(attachment.name)
                    return (
                      <div
                        key={attachment.id}
                        className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg bg-white hover:shadow-sm transition-shadow"
                      >
                        <FileIcon className="w-5 h-5 text-blue-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-900 truncate">
                              {attachment.name}
                            </span>
                            <span className="text-xs text-gray-500 ml-2">
                              {formatFileSize(attachment.size)}
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeAttachment(attachment.id)}
                          className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 bg-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleSend}
                  disabled={isSending || recipients.length === 0 || !subject.trim()}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 font-medium shadow-sm"
                >
                  {isSending ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Send
                    </>
                  )}
                </Button>

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50"
                >
                  <Paperclip className="w-4 h-4" />
                </Button>
              </div>

              <span className="text-xs text-gray-500">
                Ctrl+Enter to send
              </span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
