/**
 * Pattern Matching Service for Instant Email Suggestions
 *
 * This service provides <5ms instant suggestions using pre-defined patterns.
 * It's the first layer in our hybrid suggestion system (80% pattern matching + 20% AI).
 *
 * Key features:
 * - Instant response (<5ms)
 * - Context-aware matching
 * - Email-specific patterns
 * - Semantic boundary detection
 */

// Common email completion patterns - optimized for instant lookup
const EMAIL_PATTERNS = {
  // Greetings and openings
  'dear': ['Sir/Madam,', 'team,', 'colleague,'],
  'hi': ['there,', 'team,', 'everyone,'],
  'hello': ['there,', 'team,', 'everyone,'],
  'good morning': [',', ' team,', ' everyone,'],
  'good afternoon': [',', ' team,', ' everyone,'],
  'good evening': [',', ' team,', ' everyone,'],

  // Gratitude expressions
  'thank you': ['for your email.', 'for your time.', 'for the update.', 'for your response.', 'for the information.'],
  'thanks': ['for your email.', 'for your time.', 'for the update.', 'for your response.', 'for reaching out.'],
  'appreciate': ['your time.', 'your help.', 'your response.', 'the update.', 'your feedback.'],

  // Common business phrases
  'i hope': ['this email finds you well.', 'you are doing well.', 'this helps.', 'this clarifies things.'],
  'i wanted': ['to follow up on', 'to reach out about', 'to check in on', 'to update you on', 'to let you know'],
  'i would': ['like to', 'appreciate', 'be happy to', 'love to', 'prefer to'],
  'i am': ['writing to', 'reaching out to', 'pleased to', 'happy to', 'excited to'],
  'we are': ['pleased to', 'excited to', 'happy to', 'writing to', 'reaching out to'],
  'please': ['let me know', 'find attached', 'feel free to', 'don\'t hesitate to', 'reach out if'],
  'please let me know': ['if you have any questions.', 'if you need anything else.', 'your thoughts.', 'if this works for you.'],
  'please feel free': ['to reach out', 'to contact me', 'to ask questions', 'to let me know'],

  // Meeting and scheduling
  'let\'s schedule': ['a meeting', 'a call', 'some time', 'a follow-up'],
  'are you available': ['for a call?', 'for a meeting?', 'next week?', 'this week?'],
  'would you be': ['available for', 'interested in', 'able to'],

  // Follow-ups and actions
  'i look forward': ['to hearing from you.', 'to your response.', 'to working with you.', 'to our meeting.', 'to the next steps.'],
  'looking forward': ['to hearing from you.', 'to your response.', 'to working with you.', 'to our meeting.'],
  'next steps': ['would be to', 'are to', 'include'],
  'action items': ['from our meeting', 'for this project', 'include'],

  // Apologies and clarifications
  'i apologize': ['for the delay.', 'for any confusion.', 'for the inconvenience.', 'for not responding sooner.'],
  'sorry for': ['the delay.', 'any confusion.', 'the inconvenience.', 'the late response.'],
  'to clarify': [',', ' this matter,', ' the situation,'],

  // Closings
  'best': ['regards,', 'wishes,', 'practices include'],
  'kind': ['regards,', 'wishes,'],
  'warm': ['regards,', 'wishes,'],
  'have a': ['great day!', 'wonderful day!', 'good day!', 'great week!'],

  // Questions and requests
  'could you': ['please', 'help me', 'provide', 'send me', 'let me know'],
  'would you': ['be able to', 'mind', 'please', 'consider'],
  'can you': ['please', 'help me', 'provide', 'send me', 'let me know'],
  'do you have': ['any questions?', 'time for', 'availability for', 'thoughts on'],

  // Attachments and documents
  'attached you': ['will find', '\'ll find'],
  'please find': ['attached', 'the document', 'the file'],
  'i\'ve attached': ['the document', 'the file', 'the report', 'the presentation'],

  // Time-related
  'as soon as': ['possible', 'you can', 'convenient'],
  'at your': ['convenience', 'earliest convenience'],
  'when you': ['have time', 'get a chance', 'have a moment'],

  // Project-related
  'the project': ['is on track', 'is progressing well', 'deadline is', 'status is'],
  'we need to': ['discuss', 'review', 'finalize', 'schedule', 'address'],
  'the deadline': ['is approaching', 'has been moved', 'is'],

  // Confirmation and agreement
  'that sounds': ['good', 'great', 'perfect', 'like a plan'],
  'i agree': ['with', 'that', 'completely'],
  'confirmed': ['.', ' for', ' that'],

  // Information sharing
  'just wanted': ['to let you know', 'to update you', 'to follow up', 'to check in'],
  'fyi': [',', ' -', ' that'],
  'for your': ['information', 'reference', 'review', 'consideration'],

  // Availability and scheduling
  'i\'m available': ['on', 'for', 'next week', 'this week'],
  'my calendar': ['is open', 'shows', 'is free'],
  'does': ['this work for you?', 'that sound good?', 'next week work?']
};

// Semantic boundaries where suggestions are appropriate
const SEMANTIC_BOUNDARIES = {
  sentence_end: /[.!?]\s*$/,
  comma_pause: /,\s*$/,
  greeting_end: /^(dear|hi|hello|good morning|good afternoon|good evening)[^,]*,\s*$/i,
  paragraph_start: /^\s*$/,
  after_thanks: /^(thank you|thanks|appreciate)[^.]*\.\s*$/i
};

/**
 * Checks if the current position is at a semantic boundary
 * Only suggest at natural pause points in writing
 */
function isAtSemanticBoundary(text, cursorPosition) {
  const beforeCursor = text.substring(0, cursorPosition).toLowerCase();
  const currentLine = beforeCursor.split('\n').pop() || '';

  // Check each semantic boundary
  for (const [boundary, regex] of Object.entries(SEMANTIC_BOUNDARIES)) {
    if (regex.test(currentLine)) {
      return true;
    }
  }

  // Also check if we're at the start of a new sentence after space
  const lastTwoChars = beforeCursor.slice(-2);
  if (/[.!?]\s$/.test(lastTwoChars)) {
    return true;
  }

  // IMPROVED: More relaxed boundaries for faster suggestions
  // Allow suggestions after any space if we have enough context
  const words = beforeCursor.trim().split(/\s+/);
  if (words.length >= 2 && beforeCursor.endsWith(' ')) {
    return true;
  }

  // Allow suggestions at end of common phrases even without punctuation
  const lastWord = words[words.length - 1] || '';
  if (['you', 'me', 'to', 'for', 'with', 'thank', 'please', 'hope', 'best', 'dear'].includes(lastWord)) {
    return true;
  }

  return false;
}

/**
 * Extracts context for pattern matching
 * Gets the most relevant recent text for pattern matching
 */
function extractContext(text, cursorPosition, contextLength = 50) {
  const beforeCursor = text.substring(0, cursorPosition);

  // Get last sentence or phrase
  const sentences = beforeCursor.split(/[.!?]+/);
  const currentSentence = sentences[sentences.length - 1] || '';

  // Get last few words
  const words = currentSentence.trim().toLowerCase().split(/\s+/);
  const lastWords = words.slice(-5).join(' ').trim();

  return {
    currentSentence: currentSentence.trim().toLowerCase(),
    lastWords,
    beforeCursor: beforeCursor.slice(-contextLength).toLowerCase(),
    wordCount: words.length
  };
}

/**
 * Main pattern matching function
 * Returns instant suggestions based on pre-defined patterns
 */
function getInstantSuggestions(text, cursorPosition, emailContext = {}) {
  // Performance optimization: return early if not at semantic boundary
  const isAtBoundary = isAtSemanticBoundary(text, cursorPosition);
  console.log('🎯 Pattern matching check:', {
    text: text.slice(-20),
    cursorPosition,
    isAtBoundary,
    beforeCursor: text.substring(0, cursorPosition).slice(-10)
  });

  if (!isAtBoundary) {
    console.log('❌ Pattern matching: not at semantic boundary');
    return [];
  }

  const context = extractContext(text, cursorPosition);
  const suggestions = [];

  // Find matching patterns
  for (const [pattern, completions] of Object.entries(EMAIL_PATTERNS)) {
    // Exact phrase match
    if (context.lastWords.endsWith(pattern)) {
      suggestions.push(...completions.slice(0, 3)); // Limit to 3 suggestions per pattern
      break; // Use first exact match only
    }

    // Partial match for longer patterns (minimum 3 characters)
    if (pattern.length > 3 && context.lastWords.length >= 3) {
      const patternWords = pattern.split(' ');
      const contextWords = context.lastWords.split(' ');

      // Check if we're typing the beginning of a pattern
      if (patternWords.length > 1 && contextWords.length > 0) {
        const lastContextWord = contextWords[contextWords.length - 1];
        const patternStart = patternWords.slice(0, contextWords.length).join(' ');

        if (context.lastWords === patternStart && pattern.startsWith(context.lastWords)) {
          // Suggest completion of the pattern itself first
          const remainingPattern = pattern.substring(context.lastWords.length);
          if (remainingPattern) {
            suggestions.unshift(remainingPattern);
          }
        }
      }
    }
  }

  // Remove duplicates and limit suggestions
  const uniqueSuggestions = [...new Set(suggestions)].slice(0, 3);

  // Add context-aware filtering
  return filterByContext(uniqueSuggestions, emailContext, context);
}

/**
 * Filters suggestions based on email context
 * Removes inappropriate suggestions based on email type, recipients, etc.
 */
function filterByContext(suggestions, emailContext, textContext) {
  return suggestions.filter(suggestion => {
    // Filter out suggestions that don't make sense in context

    // Don't suggest formal closings in the middle of email
    if (textContext.wordCount < 10 && suggestion.includes('regards')) {
      return false;
    }

    // Don't suggest greetings if we're not at the beginning
    if (textContext.wordCount > 20 && suggestion.includes('[Name]')) {
      return false;
    }

    // Context-specific filtering based on email type
    if (emailContext.isReply) {
      // In replies, prefer acknowledgment phrases
      if (suggestion.includes('thank you for your email')) {
        return true;
      }
    }

    if (emailContext.subject && emailContext.subject.toLowerCase().includes('meeting')) {
      // In meeting-related emails, prefer scheduling phrases
      if (suggestion.includes('schedule') || suggestion.includes('available')) {
        return true;
      }
    }

    return true;
  });
}

/**
 * Cache for recently used patterns to improve performance
 */
class PatternCache {
  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key) {
    if (this.cache.has(key)) {
      // Move to end (LRU)
      const value = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    return null;
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
}

// Global cache instance
const patternCache = new PatternCache();

/**
 * Cached version of pattern matching for better performance
 */
function getCachedInstantSuggestions(text, cursorPosition, emailContext = {}) {
  const cacheKey = `${text.substring(Math.max(0, cursorPosition - 20), cursorPosition)}_${JSON.stringify(emailContext)}`;

  let suggestions = patternCache.get(cacheKey);
  if (!suggestions) {
    suggestions = getInstantSuggestions(text, cursorPosition, emailContext);
    patternCache.set(cacheKey, suggestions);
  }

  return suggestions;
}

/**
 * Validates if a suggestion is still relevant at the current cursor position
 */
function isSuggestionStillValid(suggestion, text, cursorPosition) {
  const context = extractContext(text, cursorPosition);

  // Check if the suggestion would create a sensible continuation
  const potentialText = context.lastWords + ' ' + suggestion;

  // Basic validation - no repeated words, reasonable length
  const words = potentialText.split(' ');
  const uniqueWords = new Set(words);

  // Don't suggest if it would create immediate repetition
  if (words.length > uniqueWords.size + 1) {
    return false;
  }

  return true;
}

// ES6 exports for React/modern bundlers
const PatternMatchingService = {
  getInstantSuggestions: getCachedInstantSuggestions,
  isAtSemanticBoundary,
  isSuggestionStillValid
};

// CommonJS exports for Node.js compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PatternMatchingService;
}

// ES6 export default
export default PatternMatchingService;