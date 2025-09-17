import { useState, useRef } from 'react'
import {
  X,
  Paperclip,
  Send,
  Type,
  Image,
  Smile,
  MoreHorizontal,
  Minimize2,
  Maximize2,
  FileText,
  FileImage,
  File
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
  const [to, setTo] = useState(replyTo?.fromEmail || '')
  const [cc, setCc] = useState(replyAll && replyTo ? replyTo.to.filter(email => email !== 'you@ainbox.com').join(', ') : '')
  const [bcc, setBcc] = useState('')
  const [subject, setSubject] = useState(
    replyTo ? `Re: ${replyTo.subject}` :
    forward ? `Fwd: ${forward.subject}` : ''
  )
  const [body, setBody] = useState('')
  const [showCc, setShowCc] = useState(false)
  const [showBcc, setShowBcc] = useState(false)
  const [attachments, setAttachments] = useState([])
  const [isMinimized, setIsMinimized] = useState(false)
  const [isSending, setIsSending] = useState(false)

  const fileInputRef = useRef(null)

  const handleFileSelect = (event) => {
    const files = Array.from(event.target.files)

    files.forEach(file => {
      const newAttachment = {
        id: Date.now() + Math.random(),
        file,
        name: file.name,
        size: file.size,
        progress: 0,
        status: 'uploading'
      }

      setAttachments(prev => [...prev, newAttachment])

      // Simulate file upload progress
      const progressInterval = setInterval(() => {
        setAttachments(prev =>
          prev.map(att => {
            if (att.id === newAttachment.id) {
              const newProgress = Math.min(att.progress + Math.random() * 20, 100)
              return {
                ...att,
                progress: newProgress,
                status: newProgress === 100 ? 'completed' : 'uploading'
              }
            }
            return att
          })
        )
      }, 200)

      // Stop progress after completion
      setTimeout(() => {
        clearInterval(progressInterval)
        setAttachments(prev =>
          prev.map(att =>
            att.id === newAttachment.id
              ? { ...att, progress: 100, status: 'completed' }
              : att
          )
        )
      }, 2000 + Math.random() * 1000)
    })

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const removeAttachment = (attachmentId) => {
    setAttachments(prev => prev.filter(att => att.id !== attachmentId))
  }

  const handleSend = async () => {
    if (!to.trim() || !subject.trim()) {
      alert('Please fill in the To field and Subject')
      return
    }

    setIsSending(true)

    try {
      const emailData = {
        to: to.split(',').map(email => email.trim()).filter(Boolean),
        cc: cc ? cc.split(',').map(email => email.trim()).filter(Boolean) : [],
        bcc: bcc ? bcc.split(',').map(email => email.trim()).filter(Boolean) : [],
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
      setTo('')
      setCc('')
      setBcc('')
      setSubject('')
      setBody('')
      setAttachments([])
      setShowCc(false)
      setShowBcc(false)
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
          "max-w-2xl max-h-[90vh] p-0 gap-0",
          isMinimized && "max-w-md max-h-16"
        )}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b border-gray-200 flex-row items-center justify-between space-y-0">
          <DialogTitle className="text-lg font-semibold">
            {replyTo ? 'Reply' : forward ? 'Forward' : 'New Message'}
          </DialogTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-2"
            >
              {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="p-2"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </DialogHeader>

        {!isMinimized && (
          <>
            {/* Compose form */}
            <div className="flex-1 p-6 space-y-4 overflow-y-auto">
              {/* To field */}
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700 w-12">To</label>
                <Input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="Recipients"
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCc(!showCc)}
                  className="text-blue-600 hover:text-blue-700"
                >
                  Cc
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowBcc(!showBcc)}
                  className="text-blue-600 hover:text-blue-700"
                >
                  Bcc
                </Button>
              </div>

              {/* CC field */}
              {showCc && (
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-gray-700 w-12">Cc</label>
                  <Input
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="Carbon copy"
                    className="flex-1"
                  />
                </div>
              )}

              {/* BCC field */}
              {showBcc && (
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-gray-700 w-12">Bcc</label>
                  <Input
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    placeholder="Blind carbon copy"
                    className="flex-1"
                  />
                </div>
              )}

              {/* Subject field */}
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700 w-12">Subject</label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Subject"
                  className="flex-1"
                />
              </div>

              {/* Body */}
              <div className="space-y-2">
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Compose your message..."
                  className="min-h-[200px] resize-none"
                />
              </div>

              {/* Attachments */}
              {attachments.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-gray-700">Attachments</h4>
                  <div className="space-y-2">
                    {attachments.map((attachment) => {
                      const FileIcon = getFileIcon(attachment.name)

                      return (
                        <div
                          key={attachment.id}
                          className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg bg-gray-50"
                        >
                          <FileIcon className="w-5 h-5 text-gray-500 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium text-gray-900 truncate">
                                {attachment.name}
                              </span>
                              <span className="text-xs text-gray-500">
                                {formatFileSize(attachment.size)}
                              </span>
                            </div>
                            {attachment.status === 'uploading' && (
                              <div className="space-y-1">
                                <Progress value={attachment.progress} className="h-1" />
                                <span className="text-xs text-gray-500">
                                  Uploading... {Math.round(attachment.progress)}%
                                </span>
                              </div>
                            )}
                            {attachment.status === 'completed' && (
                              <Badge variant="secondary" className="text-xs">
                                Ready
                              </Badge>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeAttachment(attachment.id)}
                            className="p-1 text-gray-400 hover:text-gray-600"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleSend}
                  disabled={isSending || !to.trim() || !subject.trim()}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
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
                  variant="ghost"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2"
                >
                  <Paperclip className="w-4 h-4" />
                </Button>

                <Button variant="ghost" size="sm" className="p-2">
                  <Type className="w-4 h-4" />
                </Button>

                <Button variant="ghost" size="sm" className="p-2">
                  <Smile className="w-4 h-4" />
                </Button>

                <Button variant="ghost" size="sm" className="p-2">
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </div>

              <span className="text-xs text-gray-500">
                Ctrl+Enter to send
              </span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}