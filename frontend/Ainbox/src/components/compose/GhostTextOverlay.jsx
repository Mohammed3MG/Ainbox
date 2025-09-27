import React, { useEffect, useRef, useState, useCallback } from 'react';
import { cn } from '../../lib/utils';

const GhostTextOverlay = ({
  targetElement,
  suggestion = '',
  isVisible = false,
  onAccept,
  onDismiss,
  className = ''
}) => {
  const ghostRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0, height: 0 });
  const [isPositioned, setIsPositioned] = useState(false);

  /**
   * Calculates the exact cursor position for displaying ghost text
   */
  const calculateCursorPosition = useCallback(() => {
    if (!targetElement || !isVisible || !suggestion) {
      setIsPositioned(false);
      return;
    }

    try {
      const selection = window.getSelection();
      if (!selection.rangeCount) {
        setIsPositioned(false);
        return;
      }

      const range = selection.getRangeAt(0);

      // For contenteditable elements
      if (targetElement.contentEditable === 'true' || targetElement.isContentEditable) {
        const rect = range.getBoundingClientRect();
        const containerRect = targetElement.getBoundingClientRect();

        if (rect.width === 0 && rect.height === 0) {
          // Cursor is at a position, create a temporary element to get dimensions
          const tempSpan = document.createElement('span');
          tempSpan.style.visibility = 'hidden';
          tempSpan.style.position = 'absolute';
          tempSpan.textContent = '|';

          // Insert temporary element at cursor
          const tempRange = range.cloneRange();
          tempRange.insertNode(tempSpan);

          const tempRect = tempSpan.getBoundingClientRect();
          setPosition({
            top: tempRect.top - containerRect.top + targetElement.scrollTop,
            left: tempRect.right - containerRect.left + targetElement.scrollLeft,
            height: tempRect.height || 20
          });

          // Clean up
          tempSpan.remove();

          // Restore selection
          selection.removeAllRanges();
          selection.addRange(range);

          setIsPositioned(true);
        } else {
          setPosition({
            top: rect.top - containerRect.top + targetElement.scrollTop,
            left: rect.right - containerRect.left + targetElement.scrollLeft,
            height: rect.height || 20
          });
          setIsPositioned(true);
        }
      }
      // For textarea elements
      else if (targetElement.tagName === 'TEXTAREA' || targetElement.tagName === 'INPUT') {
        const cursorPosition = targetElement.selectionStart;
        const textBeforeCursor = targetElement.value.substring(0, cursorPosition);

        // Create a mirror element to measure text
        const mirror = document.createElement('div');
        const computedStyle = window.getComputedStyle(targetElement);

        // Copy styles from textarea
        mirror.style.position = 'absolute';
        mirror.style.visibility = 'hidden';
        mirror.style.whiteSpace = 'pre-wrap';
        mirror.style.wordWrap = 'break-word';
        mirror.style.fontFamily = computedStyle.fontFamily;
        mirror.style.fontSize = computedStyle.fontSize;
        mirror.style.fontWeight = computedStyle.fontWeight;
        mirror.style.lineHeight = computedStyle.lineHeight;
        mirror.style.letterSpacing = computedStyle.letterSpacing;
        mirror.style.padding = computedStyle.padding;
        mirror.style.border = computedStyle.border;
        mirror.style.width = targetElement.offsetWidth + 'px';

        mirror.textContent = textBeforeCursor;
        document.body.appendChild(mirror);

        const containerRect = targetElement.getBoundingClientRect();
        const textHeight = parseFloat(computedStyle.lineHeight) || parseFloat(computedStyle.fontSize) || 20;

        // Calculate cursor line position
        const lines = textBeforeCursor.split('\n');
        const currentLineIndex = lines.length - 1;
        const currentLineText = lines[currentLineIndex];

        // Create temporary element for current line measurement
        const lineDiv = document.createElement('div');
        lineDiv.style.position = 'absolute';
        lineDiv.style.visibility = 'hidden';
        lineDiv.style.fontFamily = computedStyle.fontFamily;
        lineDiv.style.fontSize = computedStyle.fontSize;
        lineDiv.style.fontWeight = computedStyle.fontWeight;
        lineDiv.style.lineHeight = computedStyle.lineHeight;
        lineDiv.style.letterSpacing = computedStyle.letterSpacing;
        lineDiv.style.whiteSpace = 'pre';
        lineDiv.textContent = currentLineText;
        document.body.appendChild(lineDiv);

        setPosition({
          top: currentLineIndex * textHeight,
          left: lineDiv.offsetWidth,
          height: textHeight
        });

        document.body.removeChild(lineDiv);

        document.body.removeChild(mirror);
        setIsPositioned(true);
      }
    } catch (error) {
      console.warn('Could not calculate cursor position for ghost text:', error);
      setIsPositioned(false);
    }
  }, [targetElement, isVisible, suggestion]);

  /**
   * Updates position when dependencies change
   */
  useEffect(() => {
    if (!isVisible || !suggestion) {
      setIsPositioned(false);
      return;
    }

    calculateCursorPosition();

    // Recalculate on scroll or resize
    const updatePosition = () => calculateCursorPosition();

    const targetScrollContainer = targetElement?.closest('[data-scroll-container]') || targetElement;

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    targetScrollContainer?.addEventListener('scroll', updatePosition);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      targetScrollContainer?.removeEventListener('scroll', updatePosition);
    };
  }, [calculateCursorPosition, targetElement, isVisible, suggestion]);

  /**
   * Handles keyboard events for accepting/dismissing suggestions
   */
  useEffect(() => {
    if (!isVisible || !suggestion) return;

    const handleKeyDown = (e) => {
      switch (e.key) {
        case 'Tab':
          e.preventDefault();
          e.stopPropagation();
          onAccept?.(suggestion);
          break;

        case 'Escape':
          e.preventDefault();
          onDismiss?.();
          break;

        case 'ArrowRight':
          // Accept on right arrow if at end of current text
          if (targetElement) {
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
              const range = selection.getRangeAt(0);
              const isAtEnd = targetElement.contentEditable
                ? range.endOffset === range.endContainer.textContent?.length
                : targetElement.selectionStart === targetElement.value?.length;

              if (isAtEnd) {
                e.preventDefault();
                onAccept?.(suggestion);
              }
            }
          }
          break;

        default:
          // Dismiss on any other typing
          if (e.key.length === 1 || ['Backspace', 'Delete'].includes(e.key)) {
            onDismiss?.();
          }
          break;
      }
    };

    // Add event listener with capture to ensure we get the event first
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isVisible, suggestion, onAccept, onDismiss, targetElement]);

  // Don't render if not visible or no suggestion
  if (!isVisible || !suggestion) {
    console.log('👻 GhostTextOverlay not rendering:', { isVisible, suggestion, isPositioned, targetElement });
    return null;
  }

  // TEMPORARY: Skip position requirement for debugging
  if (!isPositioned) {
    console.log('⚠️ GhostTextOverlay: position not calculated, using fallback position');
    // Use a fallback position for debugging
  }

  console.log('👻 GhostTextOverlay rendering:', { suggestion, position, targetElement });

  return (
    <span
      ref={ghostRef}
      className={cn(
        'absolute pointer-events-none select-none z-10',
        'text-gray-400 opacity-60',
        'font-inherit text-inherit leading-inherit',
        'whitespace-nowrap',
        className
      )}
      style={{
        top: isPositioned ? position.top : 50,
        left: isPositioned ? position.left : 20,
        lineHeight: isPositioned ? `${position.height}px` : '20px',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        fontWeight: 'inherit',
        backgroundColor: isPositioned ? 'transparent' : 'rgba(255, 255, 0, 0.1)' // Yellow highlight for debugging
      }}
      aria-hidden="true"
    >
      {suggestion}
    </span>
  );
};

/**
 * Enhanced version with animation support
 */
export const AnimatedGhostTextOverlay = ({
  targetElement,
  suggestion = '',
  isVisible = false,
  onAccept,
  onDismiss,
  className = '',
  animationDuration = 200
}) => {
  const [shouldRender, setShouldRender] = useState(isVisible);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isVisible && !shouldRender) {
      setShouldRender(true);
      setIsAnimating(true);
      setTimeout(() => setIsAnimating(false), animationDuration);
    } else if (!isVisible && shouldRender) {
      setIsAnimating(true);
      setTimeout(() => {
        setShouldRender(false);
        setIsAnimating(false);
      }, animationDuration);
    }
  }, [isVisible, shouldRender, animationDuration]);

  if (!shouldRender) return null;

  return (
    <GhostTextOverlay
      targetElement={targetElement}
      suggestion={suggestion}
      isVisible={true}
      onAccept={onAccept}
      onDismiss={onDismiss}
      className={cn(
        className,
        'transition-opacity duration-200',
        isAnimating && !isVisible ? 'opacity-0' : 'opacity-60'
      )}
    />
  );
};

/**
 * Hook for managing ghost text state
 */
export function useGhostText() {
  const [suggestion, setSuggestion] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const [targetElement, setTargetElement] = useState(null);

  const showSuggestion = useCallback((newSuggestion, element = null) => {
    setSuggestion(newSuggestion);
    setIsVisible(true);
    if (element) setTargetElement(element);
  }, []);

  const hideSuggestion = useCallback(() => {
    setIsVisible(false);
    // Don't clear suggestion immediately to allow for smooth transitions
    setTimeout(() => setSuggestion(''), 200);
  }, []);

  const acceptSuggestion = useCallback((onAcceptCallback) => {
    if (suggestion && onAcceptCallback) {
      onAcceptCallback(suggestion);
    }
    hideSuggestion();
  }, [suggestion, hideSuggestion]);

  return {
    suggestion,
    isVisible,
    targetElement,
    setTargetElement,
    showSuggestion,
    hideSuggestion,
    acceptSuggestion
  };
}

export default GhostTextOverlay;