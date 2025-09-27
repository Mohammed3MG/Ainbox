import { useState, useRef, useCallback, useEffect } from 'react';
import { useTypingTrackerWithDebounce } from './useTypingTracker';
import patternMatching from '../services/patternMatching';
import sentenceDetector from '../services/sentenceDetection';

// Tunables (tuned for “fast feel”)
const AI_REQUEST_TIMEOUT = 1200;    // give streaming AI enough time to show partials
const DEBOUNCE_DELAY = 30;          // very fast debounce for immediate response
const CACHE_SIZE = 300;             // larger cache
const MIN_TEXT_LENGTH = 2;          // allow very short contexts
const MIN_WORD_BOUNDARY = 1;        // keep, but less strict

// ---------- Utils ----------
const lastLine = (text = '', pos) => {
  const upTo = typeof pos === 'number' ? text.slice(0, pos) : text;
  const parts = upTo.split(/\r?\n/);
  return parts[parts.length - 1] || '';
};

// ---------- Cache ----------
class SuggestionCache {
  constructor(maxSize = CACHE_SIZE) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }
  getKey(text, position, context) {
    // Key by last-line window instead of tiny ±30 chars
    const ll = lastLine(text, position).slice(-200);
    return `${ll}__${JSON.stringify(context || {})}`;
  }
  get(text, position, context) {
    const key = this.getKey(text, position, context);
    return this.cache.get(key) || null;
  }
  set(text, position, context, suggestions) {
    const key = this.getKey(text, position, context);
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { suggestions, timestamp: Date.now() });
  }
  clear() { this.cache.clear(); }
}

export function useSmartCompletion(options = {}) {
  const {
    enableAI = true,
    enablePatterns = true,
    aiTimeout = AI_REQUEST_TIMEOUT,
    debounceMs = DEBOUNCE_DELAY,
    maxSuggestions = 1
  } = options;

  // ----- State (preserving your names) -----
  const [currentSuggestion, setCurrentSuggestion] = useState('');
  const [isLoading, setIsLoading] = useState(false); // overall AI loading flag
  const [isVisible, setIsVisible] = useState(false);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(''); // 'pattern' | 'pattern-local' | 'ai' | 'ai-stream' | 'ai-cached' | 'instant' | ''

  // ----- Refs -----
  const currentTextRef = useRef('');
  const currentPositionRef = useRef(0);
  const abortControllerRef = useRef(null);
  const cacheRef = useRef(new SuggestionCache());
  const requestIdRef = useRef(0);           // overall request id
  const lastRequestTimeRef = useRef(0);
  const throttleTimeoutRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const aiReqIdRef = useRef(0);
  const patReqIdRef = useRef(0);
  const lastAppliedSuggestionRef = useRef(null);
  const applySuggestionTimeRef = useRef(0);

  // Typing tracker (keep your integration)
  const typingTracker = useTypingTrackerWithDebounce(debounceMs);

  // ---------- Networking helpers ----------

  // Pattern suggestions (server + local fallback), returns array
  const fetchPatternSuggestions = useCallback(async (text, position, emailContext, thisPatId) => {
    try {
      const response = await fetch('/api/instant-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: lastLine(text, position).slice(-200),
          cursorPosition: Math.min(200, position),
          emailContext,
          maxSuggestions
        })
      });
      if (!response.ok) throw new Error('Pattern matching failed');
      const data = await response.json();
      if (thisPatId !== patReqIdRef.current) return [];
      return (data.suggestions || []).slice(0, maxSuggestions);
    } catch (err) {
      // Local fallback
      const local = patternMatching.getInstantSuggestions(text, position, emailContext).slice(0, maxSuggestions);
      return local;
    }
  }, [maxSuggestions]);

  // AI suggestions (STREAMING). onPartial(acc) will update ghost incrementally.
  const fetchAISuggestionsStreaming = useCallback(async (text, position, emailContext, thisAiId, onPartial) => {
    // Abort any in-flight stream
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const body = JSON.stringify({
      text: lastLine(text, position).slice(-400),    // last-line only
      cursorPosition: Math.min(400, position),
      emailContext,
      stream: true,                                  // tell backend to stream
      maxTokens: 60,
      temperature: 0.25,
      mode: 'fast'
    });

    setIsLoading(true);

    try {
      const resp = await fetch('/api/ai-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal
      });

      // If server doesn't stream, fallback to JSON
      if (!resp.body) {
        const data = await resp.json().catch(() => ({}));

        // Handle blocked suggestions properly
        if (data.source === 'flow-blocked' || !data.suggestions || data.suggestions.length === 0) {
          console.log('🚫 Backend blocked suggestion:', data.reason || 'No suggestions available');
          return [];
        }

        const s = (data?.suggestions?.[0] || '').toString();
        return s ? [s] : [];
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      let finished = false;

      // Timeout so we never hang
      const timeout = setTimeout(() => {
        try { controller.abort(); } catch {}
      }, aiTimeout);

      while (true) {
        const { done, value } = await reader.read();
        if (done) { finished = true; break; }
        const chunk = decoder.decode(value, { stream: true });

        // Support both NDJSON (token/response fields), complete JSON response, and raw text
        const lines = chunk.split('\n').filter(Boolean);
        let appended = false;
        for (const line of lines) {
          try {
            const j = JSON.parse(line);
            if (typeof j.token === 'string') {
              acc += j.token; appended = true;
            }
            else if (typeof j.response === 'string') {
              acc += j.response; appended = true;
            }
            else if (j.suggestions && Array.isArray(j.suggestions)) {
              // Complete JSON response from backend
              if (j.suggestions.length > 0 && j.suggestions[0]) {
                acc = j.suggestions[0]; appended = true;
              } else {
                // Empty suggestions array - stop processing and hide
                acc = ''; appended = true;
                return [];
              }
            }
          } catch {
            acc += line; appended = true;
          }
        }
        if (!appended && chunk) acc += chunk;

        // Only update if this request is still current
        if (thisAiId === aiReqIdRef.current) {
          onPartial && onPartial(acc);
          setSource('ai-stream');
          setIsVisible(!!acc);
        } else {
          break; // superseded by newer request
        }
      }

      clearTimeout(timeout);
      return acc ? [acc] : [];
    } catch (err) {
      if (err.name !== 'AbortError') {
        // non-cancel errors
        // console.warn('AI stream error:', err);
      }
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [aiTimeout]);

  // ---------- Core hybrid logic (parallel race) ----------
  const getSuggestions = useCallback(async (text, position, emailContext = {}) => {
    // New overall request
    const requestId = ++requestIdRef.current;
    const thisAiId = ++aiReqIdRef.current;
    const thisPatId = ++patReqIdRef.current;

    // Basic checks
    if (text.length < MIN_TEXT_LENGTH || position < 0) return [];

    // Prevent immediate re-suggestion after applying a suggestion
    const timeSinceLastApply = Date.now() - applySuggestionTimeRef.current;
    if (timeSinceLastApply < 500) { // 500ms cooldown
      console.log('🚫 Preventing re-suggestion too soon after applying:', timeSinceLastApply + 'ms');
      return [];
    }

    // Keep current state refs
    currentTextRef.current = text;
    currentPositionRef.current = position;

    // SIMPLIFIED: Only trigger at clear word boundaries
    const beforeCursor = text.substring(0, position);
    const lastChar = beforeCursor.slice(-1);

    // Only suggest after space or punctuation
    const shouldTrigger = lastChar === ' ' || /[.,!?;:)]/.test(lastChar);

    if (!shouldTrigger) {
      console.log('🚫 Not at word boundary, no suggestions');
      return [];
    }

    console.log('✅ At word boundary, proceeding with suggestions');

    // Start both in parallel
    const patternPromise = enablePatterns
      ? fetchPatternSuggestions(text, position, emailContext, thisPatId).catch(() => [])
      : Promise.resolve([]);

    const cached = enableAI ? cacheRef.current.get(text, position, emailContext) : null;

    const aiPromise = enableAI
      ? (cached
          ? Promise.resolve(cached.suggestions)
          : fetchAISuggestionsStreaming(
              text, position, emailContext, thisAiId,
              // onPartial: live ghost
              (partial) => {
                if (thisAiId === aiReqIdRef.current && requestId === requestIdRef.current) {
                  setCurrentSuggestion(partial);
                  setSource('ai-stream');
                  setIsVisible(!!partial);
                }
              }
            ))
      : Promise.resolve([]);

    // Show patterns ASAP if they land first (but allow AI to overwrite)
    patternPromise.then(ps => {
      if (thisPatId !== patReqIdRef.current || requestId !== requestIdRef.current) return;
      const p = ps?.[0] || '';
      if (p) {
        // Only show if AI hasn't already started showing partials
        setCurrentSuggestion(prev => prev || p);
        setSource(prev => prev || 'pattern');
        setIsVisible(true);
      }
    });

    // Await both; prefer AI final
    const [pats, ai] = await Promise.allSettled([patternPromise, aiPromise]);

    if (thisAiId !== aiReqIdRef.current || requestId !== requestIdRef.current) return [];

    const p = pats.status === 'fulfilled' ? (pats.value?.[0] || '') : '';
    const a = ai.status === 'fulfilled' ? (ai.value?.[0] || '') : '';

    const best = a || p || '';
    if (!best) return [];

    // Validate still relevant
    if (!patternMatching.isSuggestionStillValid(best, text, position)) return [];

    // Cache AI final (if any)
    if (a) cacheRef.current.set(text, position, emailContext, [a]);

    // Set final suggestion
    if (text === currentTextRef.current && position === currentPositionRef.current) {
      setCurrentSuggestion(best);
      setSource(a ? 'ai' : (source || 'pattern'));
      setIsVisible(true);

      console.log('✅ Final suggestion set:', best.slice(0, 30) + '...');
    }
    return [best];
  }, [enablePatterns, enableAI, fetchPatternSuggestions, fetchAISuggestionsStreaming, typingTracker, source]);

  // ---------- Triggers ----------
  const handleTextChange = useCallback(async (text, position, emailContext = {}) => {
    // record keystroke for your tracker
    typingTracker.recordKeystroke();

    // hide quickly if too short
    if (!text || text.length < MIN_TEXT_LENGTH) {
      setIsVisible(false);
      setCurrentSuggestion('');
      setError(null);
      if (abortControllerRef.current) abortControllerRef.current.abort();
      return;
    }

    // avoid suggestions in the middle of a word (caret has alnum to the right)
    const afterCursor = text.substring(position);
    const isInMiddleOfWord = afterCursor.length > 0 && /^\w/.test(afterCursor);
    if (isInMiddleOfWord) {
      setIsVisible(false);
      if (abortControllerRef.current) abortControllerRef.current.abort();
      return;
    }

    // micro-instant completions (don't wait for network)
    const before = text.substring(0, position);
    const lastFew = before.trim().toLowerCase();
    const lastWord = (before.trim().split(/\s+/).pop() || '').toLowerCase();

    // Immediate completions for common patterns (CONTEXT AWARE)
    const quick = {
      // Greetings
      'hi': ' there,',
      'hello': ' there,',
      'dear': ' Sir/Madam,',
      'good morning': ',',
      'good afternoon': ',',
      'good evening': ',',

      // Gratitude
      'thanks': ' for your',
      'thank': ' you for',
      'appreciate': ' your',

      // Wishes and hopes (SMART CONTEXT)
      'i wish': ' you all the best',
      'i hope': ' this email finds you well',
      'hope': ' you are doing well',
      'wish': ' you a wonderful',
      'wishing': ' you all the best',

      // Requests
      'please': ' let me know',
      'could you': ' please',
      'would you': ' be able to',
      'can you': ' please',

      // Professional
      'looking': ' forward to',
      'i am': ' writing to',
      'we are': ' pleased to',
      'best': ' regards,',
      'kind': ' regards,',

      // Common phrases
      'let me': ' know if',
      'feel free': ' to contact',
      'don\'t hesitate': ' to reach out'
    };

    // Check for exact word match or phrase ending
    let instantSuggestion = quick[lastWord];
    if (!instantSuggestion) {
      for (const [phrase, completion] of Object.entries(quick)) {
        if (lastFew.endsWith(phrase)) {
          instantSuggestion = completion;
          break;
        }
      }
    }

    if (instantSuggestion) {
      // Clear any pending network requests to prevent overlap
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

      setCurrentSuggestion(instantSuggestion);
      setSource('instant');
      setIsVisible(true);
      return; // Don't continue to network request for instant suggestions
    }

    // Debounce the actual fetch/race
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      getSuggestions(text, position, emailContext).catch(err => {
        setError(err?.message || 'Suggestion error');
        setIsVisible(false);
      });
    }, debounceMs);
  }, [debounceMs, getSuggestions, typingTracker]);

  // ---------- Apply/Hide/Reset ----------
  const applySuggestion = useCallback((suggestionToApply = currentSuggestion) => {
    if (!suggestionToApply) return null;

    const text = currentTextRef.current;
    const position = currentPositionRef.current;

    const beforeCursor = text.substring(0, position);
    const afterCursor = text.substring(position);

    // Intelligent spacing logic
    let finalSuggestion = suggestionToApply;

    // Check if cursor is after a word character (letter/number)
    const lastChar = beforeCursor.slice(-1);
    const isAfterWord = /\w/.test(lastChar);
    const isAfterSpace = lastChar === ' ';
    const suggestionStartsWithSpace = finalSuggestion.startsWith(' ');

    // Rules:
    // 1. If written text ends with space + suggestion starts with space = remove extra space
    // 2. If written text ends with word + suggestion doesn't start with space = add space
    // 3. Otherwise keep as is

    if (isAfterSpace && suggestionStartsWithSpace) {
      // Remove extra space: "Dear " + " Sir/Madam," = "Dear Sir/Madam,"
      finalSuggestion = finalSuggestion.substring(1);
    } else if (isAfterWord && !suggestionStartsWithSpace) {
      // Add space: "Dear" + "Sir/Madam," = "Dear Sir/Madam,"
      finalSuggestion = ' ' + finalSuggestion;
    }

    console.log('🔧 Spacing logic:', {
      beforeCursor: beforeCursor.slice(-5),
      lastChar,
      isAfterWord,
      isAfterSpace,
      suggestionStartsWithSpace,
      original: suggestionToApply,
      final: finalSuggestion
    });

    const newText = beforeCursor + finalSuggestion + afterCursor;
    const newPosition = position + finalSuggestion.length;

    // Clear suggestions and prevent immediate re-triggering
    setCurrentSuggestion('');
    setIsVisible(false);

    // Clear cache to prevent suggesting the same text again
    cacheRef.current.clear();

    // Abort any in-flight requests
    if (abortControllerRef.current) abortControllerRef.current.abort();

    // Record the applied suggestion and time to prevent immediate re-suggestion
    lastAppliedSuggestionRef.current = suggestionToApply;
    applySuggestionTimeRef.current = Date.now();

    console.log('✅ Applied suggestion, setting cooldown:', suggestionToApply);

    return { text: newText, position: newPosition, appliedSuggestion: suggestionToApply };
  }, [currentSuggestion]);

  const hideSuggestion = useCallback(() => {
    setIsVisible(false);
    setCurrentSuggestion('');
    if (abortControllerRef.current) abortControllerRef.current.abort();
  }, []);

  const reset = useCallback(() => {
    setCurrentSuggestion('');
    setIsVisible(false);
    setIsLoading(false);
    setError(null);
    setSource('');

    currentTextRef.current = '';
    currentPositionRef.current = 0;

    if (abortControllerRef.current) abortControllerRef.current.abort();
    cacheRef.current.clear();
    typingTracker.reset();

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (throttleTimeoutRef.current) clearTimeout(throttleTimeoutRef.current);
  }, [typingTracker]);

  // ---------- Cleanup ----------
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (throttleTimeoutRef.current) clearTimeout(throttleTimeoutRef.current);
    };
  }, []);

  // ---------- Debug ----------
  const getDebugInfo = useCallback(() => {
    return {
      currentSuggestion,
      isVisible,
      isLoading,
      source,
      error,
      typingState: typingTracker.getTypingState(),
      cacheSize: cacheRef.current.cache.size,
      currentText: currentTextRef.current.slice(-120),
      currentPosition: currentPositionRef.current,
      aiReqId: aiReqIdRef.current,
      patReqId: patReqIdRef.current
    };
  }, [currentSuggestion, isVisible, isLoading, source, error, typingTracker]);

  return {
    // Core
    handleTextChange,
    applySuggestion,
    hideSuggestion,
    reset,

    // State
    currentSuggestion,
    isVisible,
    isLoading,
    error,
    source,

    // Typing info (preserved)
    typingSpeed: typingTracker.typingSpeed,
    isPaused: typingTracker.isPaused,
    isTypingFast: typingTracker.isTypingFast,

    // Debug
    getDebugInfo
  };
}

export default useSmartCompletion;
