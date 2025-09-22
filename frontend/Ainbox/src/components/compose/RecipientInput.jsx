import React, { useState, useRef, useEffect } from 'react';
import { X, Eye, EyeOff } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function RecipientChip({ recipient, onRemove, isInvalid = false }) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm border",
        isInvalid
          ? "bg-red-50 border-red-200 text-red-700"
          : "bg-blue-50 border-blue-200 text-blue-700"
      )}
    >
      <span className="truncate max-w-48">
        {recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRemove}
        className="p-0 h-4 w-4 hover:bg-transparent"
        aria-label={`Remove ${recipient.email}`}
      >
        <X className="w-3 h-3" />
      </Button>
    </div>
  );
}

export default function RecipientInput({
  label,
  recipients = [],
  onChange,
  placeholder = "",
  required = false,
  onRemoveField = null
}) {
  const [inputValue, setInputValue] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [invalidEmails, setInvalidEmails] = useState(new Set());
  const inputRef = useRef(null);

  const parseEmailInput = (input) => {
    const trimmed = input.trim();
    if (!trimmed) return null;

    // Try to parse "Name <email>" format
    const match = trimmed.match(/^(.+?)\s*<(.+?)>$/);
    if (match) {
      const [, name, email] = match;
      return {
        name: name.trim().replace(/^["']|["']$/g, ''), // Remove quotes
        email: email.trim()
      };
    }

    // Just an email address
    return {
      name: '',
      email: trimmed
    };
  };

  const validateEmail = (email) => {
    return EMAIL_REGEX.test(email);
  };

  const addRecipient = (input) => {
    const parsed = parseEmailInput(input);
    if (!parsed) return false;

    // Check if email is valid
    if (!validateEmail(parsed.email)) {
      setInvalidEmails(prev => new Set([...prev, parsed.email]));
      return false;
    }

    // Check for duplicates
    const isDuplicate = recipients.some(r => r.email.toLowerCase() === parsed.email.toLowerCase());
    if (isDuplicate) {
      return false;
    }

    // Add the recipient
    const newRecipients = [...recipients, parsed];
    onChange(newRecipients);
    setInvalidEmails(prev => {
      const newSet = new Set(prev);
      newSet.delete(parsed.email);
      return newSet;
    });
    return true;
  };

  const removeRecipient = (index) => {
    const newRecipients = recipients.filter((_, i) => i !== index);
    onChange(newRecipients);
  };

  const handleInputKeyDown = (e) => {
    const value = inputValue.trim();

    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      if (value && addRecipient(value)) {
        setInputValue('');
      }
    } else if (e.key === 'Backspace' && !inputValue && recipients.length > 0) {
      // Remove last recipient when backspacing on empty input
      removeRecipient(recipients.length - 1);
    } else if (e.key === 'Tab' && value) {
      // Add recipient on tab if there's a value
      if (addRecipient(value)) {
        setInputValue('');
      }
    }
  };

  const handleInputBlur = () => {
    setIsInputFocused(false);
    const value = inputValue.trim();
    if (value && addRecipient(value)) {
      setInputValue('');
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');

    // Split by common delimiters and add each email
    const emails = pastedText
      .split(/[,;\n]/)
      .map(email => email.trim())
      .filter(email => email);

    let addedCount = 0;
    emails.forEach(email => {
      if (addRecipient(email)) {
        addedCount++;
      }
    });

    if (addedCount > 0) {
      setInputValue('');
    }
  };

  return (
    <div className="px-3 py-2 border-b border-gray-100 last:border-b-0">
      <div className="flex items-start gap-3">
        {/* Label */}
        <div className="flex items-center gap-2 min-w-0 w-12">
          <label className="text-sm font-medium text-gray-700 block">
            {label}
            {required && <span className="text-red-500 ml-1">*</span>}
          </label>
          {onRemoveField && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemoveField}
              className="p-0 h-4 w-4 hover:bg-transparent text-gray-400 hover:text-gray-600"
              aria-label={`Hide ${label} field`}
            >
              <EyeOff className="w-3 h-3" />
            </Button>
          )}
        </div>

        {/* Recipients and input */}
        <div
          className={cn(
            "flex-1 min-h-8 px-2 py-1 border rounded focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-200 bg-white cursor-text",
            isInputFocused ? "border-blue-500 ring-1 ring-blue-200" : "border-gray-200"
          )}
          onClick={() => inputRef.current?.focus()}
        >
          <div className="flex flex-wrap gap-1 items-center">
            {/* Recipient chips */}
            {recipients.map((recipient, index) => (
              <RecipientChip
                key={`${recipient.email}-${index}`}
                recipient={recipient}
                onRemove={() => removeRecipient(index)}
                isInvalid={invalidEmails.has(recipient.email)}
              />
            ))}

            {/* Input field */}
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => {
                const newValue = e.target.value;
                setInputValue(newValue);

                // Auto-convert to badge when valid email is typed
                const trimmed = newValue.trim();
                if (trimmed && validateEmail(trimmed) && !recipients.some(r => r.email.toLowerCase() === trimmed.toLowerCase())) {
                  // Small delay to allow user to continue typing
                  setTimeout(() => {
                    if (inputValue.trim() === trimmed && validateEmail(trimmed)) {
                      if (addRecipient(trimmed)) {
                        setInputValue('');
                      }
                    }
                  }, 1000);
                }
              }}
              onKeyDown={handleInputKeyDown}
              onFocus={() => setIsInputFocused(true)}
              onBlur={handleInputBlur}
              onPaste={handlePaste}
              placeholder={recipients.length === 0 ? placeholder : ""}
              className="flex-1 min-w-32 outline-none bg-transparent text-sm"
              autoComplete="email"
              aria-label={`${label} recipients`}
              aria-describedby={`${label.toLowerCase()}-help`}
            />
          </div>
        </div>
      </div>

      {/* Error messages */}
      {invalidEmails.size > 0 && (
        <div className="mt-1 ml-15 text-xs text-red-600" role="alert">
          Invalid email format: {Array.from(invalidEmails).join(', ')}
        </div>
      )}

      {/* Help text */}
      <div id={`${label.toLowerCase()}-help`} className="sr-only">
        Enter email addresses separated by commas or press Enter after each email
      </div>
    </div>
  );
}