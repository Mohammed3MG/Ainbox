import { useEffect, useCallback } from 'react';

export function useKeyboardShortcuts(shortcuts, dependencies = []) {
  const handleKeyDown = useCallback((event) => {
    const key = event.key.toLowerCase();
    const ctrl = event.ctrlKey || event.metaKey;
    const shift = event.shiftKey;
    const alt = event.altKey;

    // Build shortcut key string
    let shortcutKey = '';
    if (ctrl) shortcutKey += 'ctrl+';
    if (shift) shortcutKey += 'shift+';
    if (alt) shortcutKey += 'alt+';
    shortcutKey += key;

    // Check if this shortcut exists
    const shortcut = shortcuts[shortcutKey];
    if (shortcut) {
      // Prevent default browser behavior
      event.preventDefault();
      event.stopPropagation();

      // Execute the shortcut handler
      shortcut(event);
    }
  }, [shortcuts]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, ...dependencies]);
}

// Common shortcuts for email applications
export const EMAIL_SHORTCUTS = {
  'ctrl+enter': 'Send email',
  'escape': 'Close/minimize compose window',
  'ctrl+b': 'Bold text',
  'ctrl+i': 'Italic text',
  'ctrl+u': 'Underline text',
  'ctrl+k': 'Insert link',
  '/': 'Focus search',
  'c': 'Compose new email',
  'r': 'Reply to email',
  'a': 'Reply all',
  'f': 'Forward email',
  'ctrl+d': 'Delete email',
  'ctrl+shift+a': 'Archive email',
  's': 'Star/unstar email',
  'm': 'Mark as read/unread'
};

export function useGlobalEmailShortcuts(handlers) {
  const shortcuts = {
    '/': (e) => {
      // Focus search if not in input field
      if (!['input', 'textarea'].includes(e.target.tagName.toLowerCase()) &&
          !e.target.contentEditable) {
        handlers.focusSearch?.();
      }
    },
    'c': (e) => {
      if (!['input', 'textarea'].includes(e.target.tagName.toLowerCase()) &&
          !e.target.contentEditable) {
        handlers.compose?.();
      }
    },
    'r': (e) => {
      if (!['input', 'textarea'].includes(e.target.tagName.toLowerCase()) &&
          !e.target.contentEditable) {
        handlers.reply?.();
      }
    },
    'f': (e) => {
      if (!['input', 'textarea'].includes(e.target.tagName.toLowerCase()) &&
          !e.target.contentEditable) {
        handlers.forward?.();
      }
    },
    's': (e) => {
      if (!['input', 'textarea'].includes(e.target.tagName.toLowerCase()) &&
          !e.target.contentEditable) {
        handlers.toggleStar?.();
      }
    },
    'ctrl+d': handlers.deleteEmail,
    'ctrl+shift+a': handlers.archiveEmail,
    'm': (e) => {
      if (!['input', 'textarea'].includes(e.target.tagName.toLowerCase()) &&
          !e.target.contentEditable) {
        handlers.toggleRead?.();
      }
    }
  };

  useKeyboardShortcuts(shortcuts, [handlers]);
}