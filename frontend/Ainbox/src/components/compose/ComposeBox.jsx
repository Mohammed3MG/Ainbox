import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  Minus,
  Maximize2,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Type,
  Palette,
  Smile,
  Table,
  Paperclip,
  Send,
  Sparkles,
  Plus,
  Eye,
  EyeOff
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import RecipientInput from './RecipientInput';
import RichTextEditor from './RichTextEditor';
import AiConversationChat from '../ai/AiConversationChat';
import AttachmentManager from './AttachmentManager';
import AttachButton from './AttachButton';
import MiniColorPicker from './MiniColorPicker';
import { useDraftAutoSave } from '../../hooks/useDraftAutoSave';
import { useAccessibility, useFocusManagement } from './AccessibilityProvider';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useSession } from '../../hooks/useSession';

const FONT_SIZES = [12, 14, 16, 18, 24];
const FONT_FAMILIES = [
  { label: 'System', value: 'system-ui, -apple-system, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Mono', value: 'Monaco, Consolas, monospace' }
];

const COLORS = [
  '#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
  '#800000', '#008000', '#000080', '#808000', '#800080', '#008080', '#808080'
];

export default function ComposeBox({
  isOpen = false,
  onClose,
  onMinimize,
  isMinimized = false,
  position = { bottom: 20, right: 20 },
  replyTo = null,
  forwardEmail = null,
  draftId = null,
  isActive = false
}) {
  const [recipients, setRecipients] = useState({
    to: [],
    cc: [],
    bcc: []
  });
  const [toInputValue, setToInputValue] = useState('');
  const [showCC, setShowCC] = useState(false);
  const [showBCC, setShowBCC] = useState(false);
  const [subject, setSubject] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [showAIAssist, setShowAIAssist] = useState(false);
  const [height, setHeight] = useState(600);
  const [isDragOver, setIsDragOver] = useState(false);

  const composeRef = useRef(null);
  const editorRef = useRef(null);
  const subjectRef = useRef(null);

  // Accessibility hooks
  const { announce, highContrast, reducedMotion } = useAccessibility();
  const { saveFocus, restoreFocus, trapFocus } = useFocusManagement();
  const { user } = useSession();

  // Auto-save hook
  const { saveStatus, lastSaved } = useDraftAutoSave({
    recipients,
    subject,
    content: editorContent,
    attachments,
    draftId,
    enabled: isOpen && !isMinimized
  });

  // Initialize with reply/forward data
  useEffect(() => {
    if (replyTo) {
      const senderEmail = replyTo.from?.match(/<(.+)>/)?.[1] || replyTo.from;
      setRecipients(prev => ({
        ...prev,
        to: senderEmail ? [{ email: senderEmail, name: replyTo.fromName || '' }] : []
      }));
      setSubject(`Re: ${replyTo.subject || ''}`);
      if (replyTo.content) {
        const quotedContent = `\n\n---\nOn ${replyTo.date}, ${replyTo.from} wrote:\n\n${replyTo.content}`;
        setEditorContent(quotedContent);
      }
    } else if (forwardEmail) {
      setSubject(`Fwd: ${forwardEmail.subject || ''}`);
      if (forwardEmail.content) {
        const forwardContent = `\n\n---\nForwarded message:\nFrom: ${forwardEmail.from}\nDate: ${forwardEmail.date}\nSubject: ${forwardEmail.subject}\n\n${forwardEmail.content}`;
        setEditorContent(forwardContent);
      }
    }
  }, [replyTo, forwardEmail]);

  // Handle send function
  const handleSend = useCallback(async () => {
    // Validate recipients
    if (recipients.to.length === 0) {
      announce('Please add at least one recipient', 'assertive');
      // Focus the To field
      const toInput = composeRef.current?.querySelector('input[aria-label*="To"]');
      toInput?.focus();
      return;
    }

    // Warn about empty subject
    if (!subject.trim()) {
      const shouldSend = confirm('Send without a subject?');
      if (!shouldSend) {
        subjectRef.current?.focus();
        announce('Subject field focused for editing');
        return;
      }
    }

    setIsSending(true);
    announce('Sending email...');

    try {
      // Prepare email data for backend
      const emailData = {
        provider: 'gmail', // Default to Gmail
        from: user?.email || 'user@example.com', // Use user's email from session
        to: recipients.to.map(r => r.email),
        cc: recipients.cc.map(r => r.email),
        bcc: recipients.bcc.map(r => r.email),
        subject,
        text: editorContent.replace(/<[^>]*>/g, ''), // Strip HTML for text version
        html: editorContent,
        attachments: attachments.map(att => ({
          filename: att.name,
          contentType: att.type,
          data: att.data // Assuming base64 encoded data
        })),
        ...(replyTo && {
          inReplyTo: replyTo.messageId,
          references: replyTo.references
        })
      };

      // Send email via backend API
      const response = await fetch('/compose', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('Email sent successfully:', result);

      // Clear the composer
      setRecipients({ to: [], cc: [], bcc: [] });
      setSubject('');
      setEditorContent('');
      setAttachments([]);

      announce('Email sent successfully', 'assertive');

      // Restore focus before closing
      restoreFocus();
      onClose?.();
    } catch (error) {
      console.error('Failed to send email:', error);
      announce(`Failed to send email: ${error.message}`, 'assertive');
    } finally {
      setIsSending(false);
    }
  }, [recipients, subject, subjectRef, composeRef, announce, restoreFocus, onClose]);

  // Keyboard shortcuts
  const shortcuts = {
    'escape': () => {
      if (isMinimized) {
        onClose?.();
        announce('Compose window closed');
      } else {
        onMinimize?.(true);
        announce('Compose window minimized');
      }
    },
    'ctrl+enter': () => {
      handleSend();
    },
    'ctrl+b': () => {
      if (document.activeElement === editorRef.current?.querySelector('[contenteditable]')) {
        document.execCommand('bold', false);
        announce('Bold formatting toggled');
      }
    },
    'ctrl+i': () => {
      if (document.activeElement === editorRef.current?.querySelector('[contenteditable]')) {
        document.execCommand('italic', false);
        announce('Italic formatting toggled');
      }
    },
    'ctrl+u': () => {
      if (document.activeElement === editorRef.current?.querySelector('[contenteditable]')) {
        document.execCommand('underline', false);
        announce('Underline formatting toggled');
      }
    }
  };

  useKeyboardShortcuts(shortcuts, [isOpen, isMinimized, handleSend]);

  // Focus management
  useEffect(() => {
    if (isOpen && !isMinimized && isActive) {
      // Save current focus before opening
      saveFocus();

      // Focus the first recipient input after a brief delay
      setTimeout(() => {
        const firstInput = composeRef.current?.querySelector('input[type="text"]');
        firstInput?.focus();
      }, 100);

      // Trap focus within the compose window
      if (composeRef.current) {
        const cleanup = trapFocus(composeRef.current);
        return cleanup;
      }
    }
  }, [isOpen, isMinimized, isActive]);


  const handleClose = useCallback(async () => {
    // Auto-save before closing
    if (recipients.to.length > 0 || subject.trim() || editorContent.trim() || attachments.length > 0) {
      // TODO: Trigger final save
      console.log('Auto-saving draft before close...');
    }
    onClose?.();
  }, [recipients, subject, editorContent, attachments, onClose]);

  // Global drag and drop handlers
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    // Only hide overlay if leaving the compose window entirely
    if (!composeRef.current?.contains(e.relatedTarget)) {
      setIsDragOver(false);
    }
  }, []);

  const validateFile = (file) => {
    // Check file extension for blocked types
    const BLOCKED_TYPES = ['.html', '.js', '.exe', '.bat', '.cmd', '.scr', '.vbs', '.jar'];
    const ext = '.' + file.name.toLowerCase().split('.').pop();
    if (BLOCKED_TYPES.includes(ext)) {
      return `File type ${ext} is not allowed for security reasons`;
    }

    // Check file size (general limit of 25MB)
    const maxSize = 25 * 1024 * 1024;
    if (file.size > maxSize) {
      const formatSize = (bytes) => {
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      };
      return `File size (${formatSize(file.size)}) exceeds limit of ${formatSize(maxSize)}`;
    }

    return null;
  };

  const handleFiles = async (files) => {
    for (const file of files) {
      const validationError = validateFile(file);

      const attachment = {
        id: Date.now() + Math.random(),
        name: file.name,
        size: file.size,
        type: file.type,
        status: validationError ? 'error' : 'uploading',
        progress: validationError ? undefined : 0,
        error: validationError,
        file
      };

      // Add to attachments immediately
      setAttachments(prev => [...prev, attachment]);

      // If validation passed, start upload simulation
      if (!validationError) {
        // Simulate upload progress
        let progress = 0;
        const progressInterval = setInterval(() => {
          progress += Math.random() * 25;
          if (progress >= 100) {
            progress = 100;
            clearInterval(progressInterval);

            // Mark as complete
            setAttachments(prev => prev.map(att =>
              att.id === attachment.id
                ? { ...att, status: 'complete', progress: 100, file: undefined }
                : att
            ));
          } else {
            // Update progress
            setAttachments(prev => prev.map(att =>
              att.id === attachment.id
                ? { ...att, progress: Math.round(progress) }
                : att
            ));
          }
        }, 300);
      }
    }
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files?.length) {
      handleFiles(Array.from(files));
    }
  }, []);

  if (!isOpen) return null;

  if (isMinimized) {
    return (
      <div
        ref={composeRef}
        className="fixed bg-white border border-gray-300 rounded-t-lg shadow-lg z-50 w-80"
        style={{ bottom: position.bottom, right: position.right }}
      >
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-t-lg border-b">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {subject || 'New Message'}
            </p>
            <p className="text-xs text-gray-500 truncate">
              To: {recipients.to.map(r => r.email).join(', ') || 'Recipients...'}
            </p>
          </div>
          <div className="flex items-center gap-1 ml-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onMinimize?.(false)}
              className="p-1 h-6 w-6"
              aria-label="Expand compose window"
            >
              <Maximize2 className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              className="p-1 h-6 w-6"
              aria-label="Close compose window"
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={composeRef}
      className={cn(
        "fixed bg-white border border-gray-300 rounded-t-lg shadow-2xl z-50 flex flex-col",
        highContrast && "border-2 border-black",
        !reducedMotion && "transition-all duration-200"
      )}
      style={{
        bottom: position.bottom,
        right: position.right,
        width: 700,
        height: height,
        minHeight: 280,
        maxHeight: '100vh'
      }}
      role="dialog"
      aria-label="Compose email"
      aria-modal="true"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-blue-50 bg-opacity-95 border-2 border-blue-400 border-dashed rounded-t-lg flex items-center justify-center z-50">
          <div className="text-center">
            <Paperclip className="w-12 h-12 text-blue-500 mx-auto mb-4" />
            <p className="text-blue-700 font-semibold text-lg">Drop files to attach</p>
            <p className="text-blue-600 text-sm mt-1">Images, PDFs, docs up to 25MB each</p>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-t-lg border-b">
        <h3 className="text-sm font-medium text-gray-900">New Message</h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onMinimize?.(true)}
            className="p-1 h-6 w-6"
            aria-label="Minimize compose window"
          >
            <Minus className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="p-1 h-6 w-6"
            aria-label="Close compose window"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Recipients */}
      <div className="flex-shrink-0 border-b border-gray-100">
        <div className="px-3 py-2 border-b border-gray-100 last:border-b-0">
          <div className="flex items-start gap-3">
            {/* Label */}
            <div className="flex items-center gap-2 min-w-0 w-12">
              <label className="text-sm font-medium text-gray-700 block">
                To
                <span className="text-red-500 ml-1">*</span>
              </label>
            </div>

            {/* Recipients input area */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap gap-1 items-center">
                {/* Recipient chips */}
                {recipients.to.map((recipient, index) => (
                  <div
                    key={`${recipient.email}-${index}`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm border bg-blue-50 border-blue-200 text-blue-700"
                  >
                    <span className="truncate max-w-48">
                      {recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const newRecipients = recipients.to.filter((_, i) => i !== index);
                        setRecipients(prev => ({ ...prev, to: newRecipients }));
                      }}
                      className="p-0 h-4 w-4 hover:bg-transparent"
                      aria-label={`Remove ${recipient.email}`}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}

                {/* Input field */}
                <Input
                  value={toInputValue}
                  onChange={(e) => setToInputValue(e.target.value)}
                  placeholder="Recipients"
                  className="border-0 shadow-none focus:ring-0 px-0 h-auto min-w-32 flex-1"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
                      e.preventDefault();
                      // Handle adding recipient
                      if (toInputValue.trim()) {
                        const trimmed = toInputValue.trim();
                        const match = trimmed.match(/^(.+?)\s*<(.+?)>$/);
                        const parsed = match ? {
                          name: match[1].trim().replace(/^["']|["']$/g, ''),
                          email: match[2].trim()
                        } : {
                          name: '',
                          email: trimmed
                        };

                        // Basic email validation
                        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                        if (emailRegex.test(parsed.email)) {
                          // Check for duplicates
                          const isDuplicate = recipients.to.some(r => r.email.toLowerCase() === parsed.email.toLowerCase());
                          if (!isDuplicate) {
                            setRecipients(prev => ({
                              ...prev,
                              to: [...prev.to, parsed]
                            }));
                          }
                        }
                        setToInputValue('');
                      }
                    }
                  }}
                />
              </div>
            </div>

            {/* CC/BCC buttons on the right */}
            {!showCC && !showBCC && (
              <div className="flex gap-1 ml-1 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCC(true)}
                  className="text-xs h-5 px-1.5 text-gray-500 hover:text-gray-700"
                >
                  CC
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowBCC(true)}
                  className="text-xs h-5 px-1.5 text-gray-500 hover:text-gray-700"
                >
                  BCC
                </Button>
              </div>
            )}
          </div>
        </div>

        {showCC && (
          <RecipientInput
            label="CC"
            recipients={recipients.cc}
            onChange={(newRecipients) => setRecipients(prev => ({ ...prev, cc: newRecipients }))}
            placeholder="CC recipients"
            onRemoveField={() => setShowCC(false)}
          />
        )}

        {showBCC && (
          <RecipientInput
            label="BCC"
            recipients={recipients.bcc}
            onChange={(newRecipients) => setRecipients(prev => ({ ...prev, bcc: newRecipients }))}
            placeholder="BCC recipients"
            onRemoveField={() => setShowBCC(false)}
          />
        )}

        {/* Subject */}
        <div className="px-3 pb-3">
          <Input
            ref={subjectRef}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="border-0 border-b border-gray-200 rounded-none focus:ring-0 focus:border-blue-500 px-0"
          />
        </div>
      </div>

      {/* Editor without toolbar */}
      <div className="flex-1 flex flex-col min-h-0">
        <RichTextEditor
          ref={editorRef}
          content={editorContent}
          onChange={setEditorContent}
          onAIAssist={() => setShowAIAssist(true)}
          showToolbar={false}
          className="text-base"
        />
      </div>

      {/* Attachments - shown between editor and toolbar with scrolling */}
      <AttachmentManager
        attachments={attachments}
        onChange={setAttachments}
        onAttachClick={() => {}} // No action needed here, just for consistency
      />

      {/* Toolbar moved below editor */}
      <div className="flex-shrink-0 border-t border-gray-200 p-2">
        <div className="flex items-center justify-between">
          {/* Left side - Formatting tools */}
          <div className="flex items-center gap-1">
            {/* Text formatting */}
            <div className="flex items-center gap-1 border-r border-gray-200 pr-2 mr-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  document.execCommand('bold', false);
                  announce('Bold formatting toggled');
                }}
                className="p-1 h-8 w-8"
                aria-label="Bold"
              >
                <Bold className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  document.execCommand('italic', false);
                  announce('Italic formatting toggled');
                }}
                className="p-1 h-8 w-8"
                aria-label="Italic"
              >
                <Italic className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  document.execCommand('underline', false);
                  announce('Underline formatting toggled');
                }}
                className="p-1 h-8 w-8"
                aria-label="Underline"
              >
                <Underline className="w-4 h-4" />
              </Button>
            </div>

            {/* Font size */}
            <div className="flex items-center gap-1 border-r border-gray-200 pr-2 mr-2">
              <select
                onChange={(e) => {
                  const size = e.target.value;
                  document.execCommand('fontSize', false, '3');
                  const selection = window.getSelection();
                  if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    const span = document.createElement('span');
                    span.style.fontSize = `${size}px`;
                    try {
                      range.surroundContents(span);
                    } catch (e) {
                      document.execCommand('insertHTML', false, `<span style="font-size: ${size}px">${range.toString()}</span>`);
                    }
                  }
                  announce(`Font size changed to ${size}px`);
                }}
                className="text-xs border border-gray-300 rounded px-1 py-1 h-7 w-12"
                aria-label="Font size"
                defaultValue="16"
              >
                <option value="12">12</option>
                <option value="14">14</option>
                <option value="16">16</option>
                <option value="18">18</option>
                <option value="24">24</option>
              </select>

              {/* Font family */}
              <select
                onChange={(e) => {
                  document.execCommand('fontName', false, e.target.value);
                  announce(`Font changed to ${e.target.options[e.target.selectedIndex].text}`);
                }}
                className="text-xs border border-gray-300 rounded px-1 py-1 h-7 w-16"
                aria-label="Font family"
                defaultValue="system-ui, -apple-system, sans-serif"
              >
                <option value="system-ui, -apple-system, sans-serif">System</option>
                <option value="Arial, sans-serif">Arial</option>
                <option value="Georgia, serif">Georgia</option>
                <option value="Monaco, Consolas, monospace">Mono</option>
              </select>
            </div>

            {/* Colors */}
            <div className="flex items-center gap-2 border-r border-gray-200 pr-2 mr-2">
              {/* Text color picker */}
              <MiniColorPicker
                type="text"
                onColorSelect={(color) => {
                  document.execCommand('foreColor', false, color);
                  announce(`Text color changed to ${color}`);
                }}
              />

              {/* Background color picker */}
              <MiniColorPicker
                type="background"
                onColorSelect={(color) => {
                  document.execCommand('backColor', false, color);
                  announce(`Background color changed to ${color}`);
                }}
              />
            </div>

            {/* Attach button */}
            <AttachButton
              onFilesSelected={(files) => {
                handleFiles(Array.from(files));
              }}
            />

            {/* AI Assist button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAIAssist(true)}
              className="flex items-center gap-1 px-2 h-8 text-sm"
              aria-label="Write with AI"
            >
              <Sparkles className="w-4 h-4" />
              AI
            </Button>
          </div>

          {/* Right side - Send button */}
          <Button
            onClick={handleSend}
            disabled={isSending || recipients.to.length === 0}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4"
            size="sm"
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
        </div>
      </div>


      {/* Footer with save status and resize */}
      <div className="flex-shrink-0 flex items-center justify-between p-2 bg-gray-50 border-t">
        <div className="text-xs text-gray-500">
          {saveStatus === 'saving' && 'Saving...'}
          {saveStatus === 'saved' && lastSaved && `Saved ${lastSaved.toLocaleTimeString()}`}
          {saveStatus === 'error' && 'Save failed'}
        </div>

        {/* Resize handle */}
        <div
          className="w-4 h-4 bg-gray-300 rounded cursor-ns-resize opacity-50 hover:opacity-100"
          onMouseDown={(e) => {
            const startY = e.clientY;
            const startHeight = height;

            const handleMouseMove = (e) => {
              const deltaY = startY - e.clientY;
              const newHeight = Math.max(280, Math.min(window.innerHeight * 0.8, startHeight + deltaY));
              setHeight(newHeight);
            };

            const handleMouseUp = () => {
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
          }}
        />
      </div>

      {/* AI Conversational Chat Panel - positioned absolutely over entire compose window */}
      {showAIAssist && (
        <div className="absolute inset-0 bg-white z-50 rounded-lg shadow-lg border">
          <AiConversationChat
            onEmailGenerated={(text) => {
              console.log('🔗 ComposeBox onEmailGenerated called with text:', text);
              console.log('📝 Current editorContent before:', editorContent);

              // Convert plain text formatting to HTML for rich text editor
              const formatTextToHTML = (plainText) => {
                return plainText
                  // Convert line breaks to <br> tags
                  .replace(/\n\n/g, '</p><p>')  // Double line breaks = new paragraphs
                  .replace(/\n/g, '<br>')      // Single line breaks = <br>

                  // Convert bullet points
                  .replace(/^[\s]*[-*•]\s+(.+)$/gm, '<li>$1</li>')  // Bullet points to list items
                  .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')       // Wrap in <ul> tags
                  .replace(/<\/ul>\s*<ul>/g, '')                    // Remove adjacent ul tags

                  // Convert numbered lists
                  .replace(/^[\s]*(\d+)[\.\)]\s+(.+)$/gm, '<li>$2</li>')  // Numbered lists
                  .replace(/(<li>.*<\/li>)/gs, (match) => {
                    if (!match.includes('<ul>')) return '<ol>' + match + '</ol>';
                    return match;
                  })
                  .replace(/<\/ol>\s*<ol>/g, '')                    // Remove adjacent ol tags

                  // Convert emphasis
                  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') // Bold **text**
                  .replace(/\*(.+?)\*/g, '<em>$1</em>')            // Italic *text*
                  .replace(/__(.+?)__/g, '<strong>$1</strong>')     // Bold __text__
                  .replace(/_(.+?)_/g, '<em>$1</em>')              // Italic _text_

                  // Wrap in paragraphs if not already
                  .replace(/^(?!<[pul])/gm, '<p>')                 // Start paragraphs
                  .replace(/(?<!>)$/gm, '</p>')                    // End paragraphs
                  .replace(/<p><\/p>/g, '')                        // Remove empty paragraphs
                  .replace(/<p>(<[ul])/g, '$1')                    // Don't wrap lists in p tags
                  .replace(/(<\/[ul]>)<\/p>/g, '$1')               // Don't wrap lists in p tags

                  // Clean up extra tags
                  .replace(/<p><br><\/p>/g, '<br>')                // Clean up line breaks in paragraphs
                  .trim();
              };

              const formattedHTML = formatTextToHTML(text);
              console.log('🎨 Formatted HTML to be added:', formattedHTML);

              setEditorContent(prev => {
                const newContent = prev + formattedHTML;
                console.log('📄 Setting new editorContent:', newContent);
                return newContent;
              });
            }}
            onClose={() => setShowAIAssist(false)}
          />
        </div>
      )}
    </div>
  );
}