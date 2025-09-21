// Export all compose-related components and hooks
export { default as ComposeBox } from './ComposeBox';
export { default as ComposeManager, useCompose } from './ComposeManager';
export { default as RecipientInput } from './RecipientInput';
export { default as RichTextEditor } from './RichTextEditor';
export { default as AIAssist } from './AIAssist';
export { default as AttachmentManager } from './AttachmentManager';
export { default as EmojiPicker } from './EmojiPicker';
export { default as ColorPicker } from './ColorPicker';
export { default as TableInserter } from './TableInserter';
export { AccessibilityProvider, useAccessibility, useFocusManagement } from './AccessibilityProvider';

// Re-export hooks
export { useDraftAutoSave } from '../../hooks/useDraftAutoSave';
export { useKeyboardShortcuts, useGlobalEmailShortcuts } from '../../hooks/useKeyboardShortcuts';