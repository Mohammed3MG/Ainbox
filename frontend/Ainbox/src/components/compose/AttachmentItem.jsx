import React from 'react';
import { Button } from '../ui/button';
import {
  X,
  FileText,
  Image,
  File,
  FileSpreadsheet,
  CheckCircle,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { cn } from '../../lib/utils';

function getFileIcon(fileType, fileName) {
  // Check for image types
  if (fileType.startsWith('image/')) return Image;

  // Check specific types
  if (fileType === 'application/pdf') return FileText;
  if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return FileText;
  if (fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return FileSpreadsheet;
  if (fileType === 'text/plain') return FileText;

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

function getFileExtension(fileName) {
  return fileName.toLowerCase().split('.').pop() || '';
}

export default function AttachmentItem({ attachment, onRemove, totalFiles = 1 }) {
  const isUploading = attachment.status === 'uploading';
  const hasError = attachment.status === 'error';
  const isComplete = attachment.status === 'complete';

  // Subtle beautiful design while keeping text small
  return (
    <div className="flex items-center justify-between gap-2 p-2 text-xs bg-gray-50 rounded-md border border-gray-100 hover:bg-gray-100 transition-colors">
      {/* File info */}
      <div className="flex-1 min-w-0 space-y-1">
        {/* Filename */}
        <div className="truncate font-medium text-gray-800">
          {attachment.name}
        </div>

        {/* Size and status in one line */}
        <div className="flex items-center gap-2 text-gray-500">
          <span>{formatFileSize(attachment.size)}</span>
          <span className="text-gray-300">•</span>

          {/* Status with subtle colors */}
          {isUploading && attachment.progress !== undefined ? (
            <span className="text-blue-600 font-medium">
              {Math.round(attachment.progress)}%
            </span>
          ) : hasError ? (
            <span className="text-red-500">
              Failed
            </span>
          ) : isComplete ? (
            <span className="text-green-600">
              Uploaded
            </span>
          ) : (
            <span className="text-gray-500">
              Ready
            </span>
          )}
        </div>
      </div>

      {/* Styled remove button */}
      <button
        onClick={() => onRemove(attachment.id)}
        className="text-gray-400 hover:text-red-500 hover:bg-red-50 p-1 rounded transition-colors"
        aria-label={`Remove ${attachment.name}`}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}