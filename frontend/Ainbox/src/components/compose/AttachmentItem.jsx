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

export default function AttachmentItem({ attachment, onRemove, totalFiles = 1 }) {
  const IconComponent = getFileIcon(attachment.type, attachment.name);
  const isUploading = attachment.status === 'uploading';
  const hasError = attachment.status === 'error';
  const isComplete = attachment.status === 'complete';

  // Determine layout mode based on file count
  const isCompact = totalFiles > 5;
  const isMinimal = totalFiles > 10;

  if (isMinimal) {
    // Minimal mode: Just filename + size for > 10 files
    return (
      <div className={cn(
        "flex items-center gap-0.5 px-0.5 py-0 bg-white rounded text-xs border-0",
        hasError ? "bg-red-50" : isComplete ? "bg-green-50" : "bg-gray-50"
      )}>
        {/* Micro status indicator */}
        <div className={cn(
          "w-0.5 h-0.5 rounded-full flex-shrink-0",
          hasError ? "bg-red-500" : isComplete ? "bg-green-500" : "bg-blue-500"
        )}>
        </div>

        {/* Filename only */}
        <span className="flex-1 truncate font-normal text-gray-900 text-xs">
          {attachment.name}
        </span>

        {/* Size */}
        <span className="text-gray-500 text-xs">
          {formatFileSize(attachment.size)}
        </span>

        {/* Progress for uploading */}
        {isUploading && attachment.progress !== undefined && (
          <span className="text-blue-600 text-xs">
            {Math.round(attachment.progress)}%
          </span>
        )}

        {/* Micro remove button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onRemove(attachment.id)}
          className="p-0 h-1.5 w-1.5 hover:bg-red-100 hover:text-red-600 flex-shrink-0"
          aria-label={`Remove ${attachment.name}`}
        >
          <X className="w-1 h-1" />
        </Button>
      </div>
    );
  }

  if (isCompact) {
    // Compact mode: Ultra small items for 6-10 files
    return (
      <div className={cn(
        "flex items-center gap-0.5 px-0.5 py-0 bg-white rounded text-xs border-0",
        hasError ? "bg-red-50" : isComplete ? "bg-green-50" : "bg-gray-50"
      )}>
        {/* Micro icon */}
        <div className={cn(
          "flex-shrink-0 w-1.5 h-1.5 rounded flex items-center justify-center",
          hasError ? "bg-red-100" : isComplete ? "bg-green-100" : "bg-blue-100"
        )}>
          {isUploading ? (
            <Loader2 className="w-0.5 h-0.5 text-blue-600 animate-spin" />
          ) : hasError ? (
            <AlertCircle className="w-0.5 h-0.5 text-red-600" />
          ) : isComplete ? (
            <CheckCircle className="w-0.5 h-0.5 text-green-600" />
          ) : (
            <IconComponent className={cn(
              "w-0.5 h-0.5",
              hasError ? "text-red-600" : isComplete ? "text-green-600" : "text-blue-600"
            )} />
          )}
        </div>

        {/* File info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-0.5 text-xs leading-none">
            <span className="flex-1 truncate font-normal text-gray-900">
              {attachment.name}
            </span>
            <span className="text-gray-500 text-xs">{formatFileSize(attachment.size)}</span>
            {isUploading && attachment.progress !== undefined && (
              <span className="text-blue-600 text-xs">{Math.round(attachment.progress)}%</span>
            )}
          </div>

          {/* Hair-thin progress bar */}
          {isUploading && attachment.progress !== undefined && (
            <div className="mt-0.5 w-full bg-gray-200 rounded-full h-0.5">
              <div
                className="bg-blue-600 h-0.5 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${attachment.progress}%` }}
              />
            </div>
          )}
        </div>

        {/* Micro remove button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onRemove(attachment.id)}
          className="p-0 h-1.5 w-1.5 hover:bg-red-100 hover:text-red-600 flex-shrink-0"
          aria-label={`Remove ${attachment.name}`}
        >
          <X className="w-0.5 h-0.5" />
        </Button>
      </div>
    );
  }

  // Normal mode: Micro compact size for ≤ 5 files
  return (
    <div className={cn(
      "flex items-center gap-0.5 px-0.5 py-0 bg-white rounded text-xs border-0",
      hasError ? "bg-red-50" : isComplete ? "bg-green-50" : "bg-gray-50"
    )}>
      {/* Micro file icon */}
      <div className={cn(
        "flex-shrink-0 w-2 h-2 rounded flex items-center justify-center",
        hasError ? "bg-red-100" : isComplete ? "bg-green-100" : "bg-blue-100"
      )}>
        {isUploading ? (
          <Loader2 className="w-1 h-1 text-blue-600 animate-spin" />
        ) : hasError ? (
          <AlertCircle className="w-1 h-1 text-red-600" />
        ) : isComplete ? (
          <CheckCircle className="w-1 h-1 text-green-600" />
        ) : (
          <IconComponent className={cn(
            "w-1 h-1",
            hasError ? "text-red-600" : isComplete ? "text-green-600" : "text-blue-600"
          )} />
        )}
      </div>

      {/* File info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-normal text-gray-900 truncate leading-none">
          {attachment.name}
        </p>
        <div className="flex items-center gap-0.5 text-xs text-gray-500 leading-none">
          <span>{formatFileSize(attachment.size)}</span>
          {isUploading && attachment.progress !== undefined && (
            <span>• {Math.round(attachment.progress)}%</span>
          )}
          {hasError && <span className="text-red-600">• Failed</span>}
          {isComplete && <span className="text-green-600">• Done</span>}
        </div>

        {/* Hair-thin progress bar */}
        {isUploading && attachment.progress !== undefined && (
          <div className="mt-0.5 w-full bg-gray-200 rounded-full h-0.5">
            <div
              className="bg-blue-600 h-0.5 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${attachment.progress}%` }}
            />
          </div>
        )}

        {/* Error message */}
        {hasError && attachment.error && (
          <div className="mt-0.5 text-xs text-red-600 leading-none">
            {attachment.error}
          </div>
        )}
      </div>

      {/* Micro remove button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onRemove(attachment.id)}
        className="p-0 h-1.5 w-1.5 hover:bg-red-100 hover:text-red-600 flex-shrink-0"
        aria-label={`Remove ${attachment.name}`}
      >
        <X className="w-1 h-1" />
      </Button>
    </div>
  );
}