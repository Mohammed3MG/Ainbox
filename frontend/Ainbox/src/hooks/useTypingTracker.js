/**
 * Typing Speed Tracker Hook
 *
 * Tracks user typing patterns to determine when to trigger suggestions:
 * - Fast typing (< 100ms between keystrokes): No suggestions
 * - Slow typing or paused (> 250ms): Consider suggestions
 * - Semantic boundaries: Always consider suggestions
 *
 * This prevents interrupting users while they're actively typing.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

const FAST_TYPING_THRESHOLD = 30; // ms - very fast typing (reduced for better UX)
const PAUSE_THRESHOLD = 50; // ms - shorter pause for faster response
const TYPING_SPEED_SAMPLE_SIZE = 3; // Number of keystrokes to average for speed calculation (reduced for faster response)

export function useTypingTracker() {
  const [typingSpeed, setTypingSpeed] = useState(0); // Average ms between keystrokes
  const [isPaused, setIsPaused] = useState(false);
  const [isTypingFast, setIsTypingFast] = useState(false);
  const [lastActivity, setLastActivity] = useState(Date.now());

  const keystrokeTimesRef = useRef([]); // Circular buffer of recent keystroke times
  const pauseTimeoutRef = useRef(null);
  const lastKeystrokeRef = useRef(Date.now());

  /**
   * Records a keystroke and updates typing metrics
   */
  const recordKeystroke = useCallback(() => {
    const now = Date.now();
    const timeSinceLastKey = now - lastKeystrokeRef.current;

    // Update keystroke history (circular buffer)
    keystrokeTimesRef.current.push(timeSinceLastKey);
    if (keystrokeTimesRef.current.length > TYPING_SPEED_SAMPLE_SIZE) {
      keystrokeTimesRef.current.shift();
    }

    // Calculate average typing speed
    if (keystrokeTimesRef.current.length > 1) {
      const averageInterval = keystrokeTimesRef.current.reduce((a, b) => a + b, 0) / keystrokeTimesRef.current.length;
      setTypingSpeed(averageInterval);
      setIsTypingFast(averageInterval < FAST_TYPING_THRESHOLD);
    }

    // User is actively typing, not paused
    setIsPaused(false);
    setLastActivity(now);
    lastKeystrokeRef.current = now;

    // Clear existing pause timeout
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
    }

    // Set new pause timeout
    pauseTimeoutRef.current = setTimeout(() => {
      setIsPaused(true);
    }, PAUSE_THRESHOLD);

  }, []);

  /**
   * Determines if suggestions should be triggered based on typing state
   */
  const shouldTriggerSuggestions = useCallback((isAtSemanticBoundary = false) => {
    console.log('🔍 shouldTriggerSuggestions called:', {
      isAtSemanticBoundary,
      isTypingFast,
      isPaused,
      typingSpeed,
      timeSinceLastActivity: Date.now() - lastActivity
    });

    // Always suggest at semantic boundaries (end of sentences, etc.)
    if (isAtSemanticBoundary) {
      console.log('✅ Allowing suggestion - at semantic boundary');
      return true;
    }

    // IMPROVED UX: Only block if typing EXTREMELY fast (< 30ms)
    if (isTypingFast && typingSpeed < 30) {
      console.log('❌ Blocking suggestion - typing extremely fast');
      return false;
    }

    // IMPROVED UX: Allow suggestions even if not paused, just after brief delay
    const timeSinceActivity = Date.now() - lastActivity;
    if (isPaused || timeSinceActivity > 100) {
      console.log('✅ Allowing suggestion - user paused or brief delay');
      return true;
    } else {
      console.log('⏳ Waiting for brief pause');
      return false;
    }
  }, [isTypingFast, isPaused, typingSpeed, lastActivity]);

  /**
   * Gets current typing state for debugging/monitoring
   */
  const getTypingState = useCallback(() => {
    return {
      typingSpeed,
      isPaused,
      isTypingFast,
      timeSinceLastActivity: Date.now() - lastActivity,
      shouldSuggest: shouldTriggerSuggestions()
    };
  }, [typingSpeed, isPaused, isTypingFast, lastActivity, shouldTriggerSuggestions]);

  /**
   * Resets typing state (useful when changing focus, etc.)
   */
  const reset = useCallback(() => {
    keystrokeTimesRef.current = [];
    setTypingSpeed(0);
    setIsPaused(false);
    setIsTypingFast(false);
    setLastActivity(Date.now());

    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
    }
  }, []);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
      }
    };
  }, []);

  return {
    // Core functions
    recordKeystroke,
    shouldTriggerSuggestions,
    reset,

    // State getters
    typingSpeed,
    isPaused,
    isTypingFast,
    lastActivity,
    getTypingState,

    // Computed properties
    timeSinceLastActivity: Date.now() - lastActivity,
    isActivelyTyping: !isPaused && Date.now() - lastActivity < PAUSE_THRESHOLD
  };
}

/**
 * Enhanced version with debouncing for suggestion triggers
 */
export function useTypingTrackerWithDebounce(debounceMs = 20) {
  const typingTracker = useTypingTracker();
  const [debouncedShouldSuggest, setDebouncedShouldSuggest] = useState(false);
  const debounceTimeoutRef = useRef(null);

  const checkSuggestions = useCallback((isAtSemanticBoundary = false) => {
    // Clear existing debounce
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Set new debounced check
    debounceTimeoutRef.current = setTimeout(() => {
      const shouldSuggest = typingTracker.shouldTriggerSuggestions(isAtSemanticBoundary);
      setDebouncedShouldSuggest(shouldSuggest);
    }, debounceMs);
  }, [typingTracker, debounceMs]);

  const recordKeystroke = useCallback(() => {
    typingTracker.recordKeystroke();
    setDebouncedShouldSuggest(false); // Immediately stop suggestions when typing
  }, [typingTracker]);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  return {
    ...typingTracker,
    recordKeystroke,
    checkSuggestions,
    debouncedShouldSuggest
  };
}

export default useTypingTracker;