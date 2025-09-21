import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Type,
  Palette,
  Smile,
  Table,
  Sparkles,
  ChevronDown
} from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import EmojiPicker from './EmojiPicker';
import ColorPicker from './ColorPicker';
import TableInserter from './TableInserter';

const FONT_SIZES = [12, 14, 16, 18, 24];
const FONT_FAMILIES = [
  { label: 'System', value: 'system-ui, -apple-system, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Mono', value: 'Monaco, Consolas, monospace' }
];

const RichTextEditor = forwardRef(({ content, onChange, onAIAssist, showToolbar = true, className = '' }, ref) => {
  const editorRef = useRef(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showBgColorPicker, setShowBgColorPicker] = useState(false);
  const [showTableInserter, setShowTableInserter] = useState(false);
  const [currentFontSize, setCurrentFontSize] = useState(14);
  const [currentFontFamily, setCurrentFontFamily] = useState(FONT_FAMILIES[0].value);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    insertText: (text) => {
      if (editorRef.current) {
        document.execCommand('insertText', false, text);
        handleContentChange();
      }
    },
    getSelection: () => {
      if (editorRef.current?.contains(document.activeElement)) {
        return window.getSelection();
      }
      return null;
    }
  }));

  useEffect(() => {
    if (editorRef.current && content !== editorRef.current.innerHTML) {
      editorRef.current.innerHTML = content;
    }
  }, [content]);

  const handleContentChange = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const executeCommand = (command, value = null) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    handleContentChange();
  };

  const insertEmoji = (emoji) => {
    executeCommand('insertText', emoji);
    setShowEmojiPicker(false);
  };

  const applyColor = (color, isBackground = false) => {
    executeCommand(isBackground ? 'backColor' : 'foreColor', color);
    setShowColorPicker(false);
    setShowBgColorPicker(false);
  };

  const insertTable = (rows, cols) => {
    let tableHTML = '<table border="1" style="border-collapse: collapse; width: 100%; margin: 10px 0;">';
    for (let r = 0; r < rows; r++) {
      tableHTML += '<tr>';
      for (let c = 0; c < cols; c++) {
        tableHTML += '<td style="border: 1px solid #ccc; padding: 8px; min-width: 50px;">&nbsp;</td>';
      }
      tableHTML += '</tr>';
    }
    tableHTML += '</table>';

    executeCommand('insertHTML', tableHTML);
    setShowTableInserter(false);
  };

  const changeFontSize = (size) => {
    // Use CSS styling for better email compatibility
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (range.collapsed) {
        // No selection, apply to next typed text
        setCurrentFontSize(size);
        editorRef.current?.style.setProperty('font-size', `${size}px`);
      } else {
        // Apply to selection
        executeCommand('fontSize', '3'); // Reset first
        const span = document.createElement('span');
        span.style.fontSize = `${size}px`;
        try {
          range.surroundContents(span);
        } catch (e) {
          // Fallback for complex selections
          executeCommand('insertHTML', `<span style="font-size: ${size}px">${range.toString()}</span>`);
        }
        selection.removeAllRanges();
        handleContentChange();
      }
    }
  };

  const changeFontFamily = (family) => {
    executeCommand('fontName', family);
    setCurrentFontFamily(family);
  };

  const isCommandActive = (command) => {
    try {
      return document.queryCommandState(command);
    } catch (e) {
      return false;
    }
  };

  return (
    <div className={cn("flex-1 flex flex-col", className)}>
      {/* Toolbar */}
      {showToolbar && (
        <div className="flex-shrink-0 border-b border-gray-200 p-2">
        <div className="flex items-center gap-1 flex-wrap">
          {/* Text formatting */}
          <div className="flex items-center gap-1 border-r border-gray-200 pr-2 mr-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => executeCommand('bold')}
              className={cn(
                "p-1 h-8 w-8",
                isCommandActive('bold') && "bg-blue-100 text-blue-700"
              )}
              aria-label="Bold"
              aria-pressed={isCommandActive('bold')}
            >
              <Bold className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => executeCommand('italic')}
              className={cn(
                "p-1 h-8 w-8",
                isCommandActive('italic') && "bg-blue-100 text-blue-700"
              )}
              aria-label="Italic"
              aria-pressed={isCommandActive('italic')}
            >
              <Italic className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => executeCommand('underline')}
              className={cn(
                "p-1 h-8 w-8",
                isCommandActive('underline') && "bg-blue-100 text-blue-700"
              )}
              aria-label="Underline"
              aria-pressed={isCommandActive('underline')}
            >
              <Underline className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => executeCommand('strikeThrough')}
              className={cn(
                "p-1 h-8 w-8",
                isCommandActive('strikeThrough') && "bg-blue-100 text-blue-700"
              )}
              aria-label="Strikethrough"
              aria-pressed={isCommandActive('strikeThrough')}
            >
              <Strikethrough className="w-4 h-4" />
            </Button>
          </div>

          {/* Font controls */}
          <div className="flex items-center gap-1 border-r border-gray-200 pr-2 mr-2">
            {/* Font size */}
            <select
              value={currentFontSize}
              onChange={(e) => changeFontSize(Number(e.target.value))}
              className="text-sm border border-gray-300 rounded px-2 py-1 h-8"
              aria-label="Font size"
            >
              {FONT_SIZES.map(size => (
                <option key={size} value={size}>{size}px</option>
              ))}
            </select>

            {/* Font family */}
            <select
              value={currentFontFamily}
              onChange={(e) => changeFontFamily(e.target.value)}
              className="text-sm border border-gray-300 rounded px-2 py-1 h-8 max-w-24"
              aria-label="Font family"
            >
              {FONT_FAMILIES.map(font => (
                <option key={font.value} value={font.value}>{font.label}</option>
              ))}
            </select>
          </div>

          {/* Color controls */}
          <div className="flex items-center gap-1 border-r border-gray-200 pr-2 mr-2 relative">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowColorPicker(!showColorPicker);
                setShowBgColorPicker(false);
              }}
              className="p-1 h-8 w-8"
              aria-label="Text color"
              aria-expanded={showColorPicker}
            >
              <Palette className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowBgColorPicker(!showBgColorPicker);
                setShowColorPicker(false);
              }}
              className="p-1 h-8 w-8"
              aria-label="Background color"
              aria-expanded={showBgColorPicker}
            >
              <div className="w-4 h-4 border border-gray-400 bg-yellow-200 rounded-sm" />
            </Button>

            {showColorPicker && (
              <ColorPicker
                onColorSelect={(color) => applyColor(color, false)}
                onClose={() => setShowColorPicker(false)}
              />
            )}

            {showBgColorPicker && (
              <ColorPicker
                onColorSelect={(color) => applyColor(color, true)}
                onClose={() => setShowBgColorPicker(false)}
              />
            )}
          </div>

          {/* Insert controls */}
          <div className="flex items-center gap-1 border-r border-gray-200 pr-2 mr-2 relative">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowEmojiPicker(!showEmojiPicker);
                setShowTableInserter(false);
              }}
              className="p-1 h-8 w-8"
              aria-label="Insert emoji"
              aria-expanded={showEmojiPicker}
            >
              <Smile className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowTableInserter(!showTableInserter);
                setShowEmojiPicker(false);
              }}
              className="p-1 h-8 w-8"
              aria-label="Insert table"
              aria-expanded={showTableInserter}
            >
              <Table className="w-4 h-4" />
            </Button>

            {showEmojiPicker && (
              <EmojiPicker
                onEmojiSelect={insertEmoji}
                onClose={() => setShowEmojiPicker(false)}
              />
            )}

            {showTableInserter && (
              <TableInserter
                onTableInsert={insertTable}
                onClose={() => setShowTableInserter(false)}
              />
            )}
          </div>

          {/* AI Assist */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onAIAssist}
            className="flex items-center gap-1 px-2 h-8 text-sm"
            aria-label="Write with AI"
          >
            <Sparkles className="w-4 h-4" />
            AI Assist
          </Button>
        </div>
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 p-4 overflow-y-auto min-h-0 max-h-48 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent hover:scrollbar-thumb-gray-400">
        <div
          ref={editorRef}
          contentEditable
          onInput={handleContentChange}
          onBlur={handleContentChange}
          className="w-full min-h-32 max-h-none outline-none prose prose-base max-w-none leading-relaxed"
          style={{
            fontSize: showToolbar ? `${currentFontSize}px` : '16px',
            fontFamily: currentFontFamily,
            lineHeight: '1.6'
          }}
          role="textbox"
          aria-label="Email message content"
          aria-multiline="true"
          suppressContentEditableWarning={true}
          placeholder="Type your message here..."
        />
      </div>
    </div>
  );
});

RichTextEditor.displayName = 'RichTextEditor';

export default RichTextEditor;