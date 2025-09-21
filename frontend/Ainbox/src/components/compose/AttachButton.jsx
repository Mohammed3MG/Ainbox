import React, { useRef } from 'react';
import { Paperclip } from 'lucide-react';
import { Button } from '../ui/button';

const ALLOWED_TYPES = {
  'image/*': true,
  'application/pdf': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': true,
  'text/plain': true,
};

export default function AttachButton({ onFilesSelected, disabled = false }) {
  const fileInputRef = useRef(null);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (event) => {
    const files = event.target.files;
    if (files?.length) {
      onFilesSelected(files);
    }
    // Reset input
    event.target.value = '';
  };

  const acceptedTypes = Object.keys(ALLOWED_TYPES).join(',') + ',.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf';

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={acceptedTypes}
        onChange={handleFileSelect}
        className="hidden"
        aria-label="Attach files"
      />

      <Button
        variant="ghost"
        size="sm"
        onClick={handleClick}
        disabled={disabled}
        className="p-1 h-8 w-8"
        aria-label="Attach files"
        title="Attach files"
      >
        <Paperclip className="w-4 h-4" />
      </Button>
    </>
  );
}