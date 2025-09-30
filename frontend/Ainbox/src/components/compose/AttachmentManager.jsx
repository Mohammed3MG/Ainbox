import React, { useRef, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Paperclip,
  X,
  FileText,
  Image,
  File,
  FileSpreadsheet,
  Upload,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { cn } from '../../lib/utils';
import AttachmentItem from './AttachmentItem';

const ALLOWED_TYPES = {
  'image/*': { icon: Image, label: 'Image', maxSize: 10 * 1024 * 1024 }, // 10MB
  'application/pdf': { icon: FileText, label: 'PDF', maxSize: 25 * 1024 * 1024 }, // 25MB
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { icon: FileText, label: 'Word Document', maxSize: 25 * 1024 * 1024 },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { icon: FileSpreadsheet, label: 'Excel Spreadsheet', maxSize: 25 * 1024 * 1024 },
  'text/plain': { icon: FileText, label: 'Text File', maxSize: 5 * 1024 * 1024 }, // 5MB
};

const BLOCKED_TYPES = ['.html', '.js', '.exe', '.bat', '.cmd', '.scr', '.vbs', '.jar'];

function getFileIcon(fileType, fileName) {
  // Check for image types
  if (fileType.startsWith('image/')) return Image;

  // Check specific types
  if (ALLOWED_TYPES[fileType]) return ALLOWED_TYPES[fileType].icon;

  // Check by extension
  const ext = fileName.toLowerCase().split('.').pop();
  if (['pdf'].includes(ext)) return FileText;
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'].includes(ext)) return Image;
  if (['doc', 'docx', 'txt', 'rtf'].includes(ext)) return FileText;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return FileSpreadsheet;

  return File;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Removed - using imported AttachmentItem component instead

export default function AttachmentManager({ attachments, onChange, onAttachClick, dragOverlay = false }) {
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const validateFile = (file) => {
    // Check file extension for blocked types
    const ext = '.' + file.name.toLowerCase().split('.').pop();
    if (BLOCKED_TYPES.includes(ext)) {
      return `File type ${ext} is not allowed for security reasons`;
    }

    // Check file size (general limit of 25MB)
    const maxSize = 25 * 1024 * 1024;
    if (file.size > maxSize) {
      return `File size (${formatFileSize(file.size)}) exceeds limit of ${formatFileSize(maxSize)}`;
    }

    return null;
  };

  const uploadFile = async (file) => {
    // Create FormData for upload
    const formData = new FormData();
    formData.append('file', file);

    try {
      // TODO: Replace with actual upload endpoint
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const result = await response.json();
      return result.fileId || file.name; // Return file ID from server
    } catch (error) {
      throw error;
    }
  };

  const handleFiles = async (files) => {
    const fileArray = Array.from(files);

    for (const file of fileArray) {
      const validationError = validateFile(file);

      const attachment = {
        id: Date.now() + Math.random(), // Temporary ID
        name: file.name,
        size: file.size,
        type: file.type,
        status: validationError ? 'error' : 'uploading',
        progress: validationError ? undefined : 0,
        error: validationError,
        file // Keep reference for upload
      };

      // Add to attachments immediately
      onChange(prev => [...prev, attachment]);

      // Notify parent that attachment was clicked/added
      onAttachClick?.();

      // If validation passed, start upload
      if (!validationError) {
        try {
          // Simulate upload progress
          const progressInterval = setInterval(() => {
            onChange(prev => prev.map(att =>
              att.id === attachment.id
                ? { ...att, progress: Math.min(100, (att.progress || 0) + Math.random() * 30) }
                : att
            ));
          }, 200);

          // Simulate upload delay
          await new Promise(resolve => setTimeout(resolve, 2000));
          clearInterval(progressInterval);

          // TODO: Actual upload
          // const fileId = await uploadFile(file);

          // Mark as complete
          onChange(prev => prev.map(att =>
            att.id === attachment.id
              ? {
                  ...att,
                  status: 'complete',
                  progress: 100,
                  // fileId: fileId, // Store server file ID
                  file: undefined // Remove file reference to save memory
                }
              : att
          ));

        } catch (error) {
          // Mark as error
          onChange(prev => prev.map(att =>
            att.id === attachment.id
              ? {
                  ...att,
                  status: 'error',
                  error: error.message,
                  progress: undefined
                }
              : att
          ));
        }
      }
    }
  };

  const handleFileSelect = (event) => {
    const files = event.target.files;
    if (files?.length) {
      handleFiles(files);
    }
    // Reset input
    event.target.value = '';
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);

    const files = event.dataTransfer.files;
    if (files?.length) {
      handleFiles(files);
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const removeAttachment = (attachmentId) => {
    onChange(prev => prev.filter(att => att.id !== attachmentId));
  };

  const acceptedTypes = Object.keys(ALLOWED_TYPES).join(',') + ',.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf';

  return (
    <div className="flex-shrink-0">
      {/* Attachments list */}
      {attachments.length > 0 && (
        <div className="border-t border-gray-200 p-2 space-y-1">
          <h4 className="text-xs font-medium text-gray-700">
            Attachments ({attachments.length})
          </h4>
          <div className={cn(
            "grid grid-cols-2 gap-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent hover:scrollbar-thumb-gray-400",
            // Set conservative max height to preserve text area - always scrollable after 2 files
            attachments.length <= 2 ? "max-h-none" :
            attachments.length <= 4 ? "max-h-24" :
            attachments.length <= 8 ? "max-h-28" :
            "max-h-32"
          )}>
            {attachments.map((attachment) => (
              <AttachmentItem
                key={attachment.id}
                attachment={attachment}
                onRemove={removeAttachment}
                totalFiles={attachments.length}
              />
            ))}
          </div>
        </div>
      )}


      {/* Drag overlay for entire component */}
      {isDragging && (
        <div className="absolute inset-0 bg-blue-50 bg-opacity-90 border-2 border-blue-400 border-dashed rounded-lg flex items-center justify-center z-10">
          <div className="text-center">
            <Upload className="w-8 h-8 text-blue-500 mx-auto mb-2" />
            <p className="text-blue-700 font-medium">Drop files to attach</p>
          </div>
        </div>
      )}
    </div>
  );
}