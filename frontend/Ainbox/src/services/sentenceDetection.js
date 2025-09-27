/**
 * Advanced Sentence Detection Service
 *
 * Detects when a user is starting a new sentence to provide
 * contextually appropriate text suggestions.
 */

/**
 * Sentence ending patterns with confidence scores
 */
const SENTENCE_ENDINGS = [
  { pattern: /[.!?]+\s*$/, confidence: 95, type: 'definitive' },
  { pattern: /[.!?]+\s+[A-Z]/, confidence: 90, type: 'with_capital' },
  { pattern: /\.\s*$/, confidence: 85, type: 'period' },
  { pattern: /!\s*$/, confidence: 85, type: 'exclamation' },
  { pattern: /\?\s*$/, confidence: 85, type: 'question' },
];

/**
 * Paragraph/section ending patterns
 */
const PARAGRAPH_ENDINGS = [
  { pattern: /\n\s*\n/, confidence: 90, type: 'double_newline' },
  { pattern: /\n\s*$/, confidence: 70, type: 'single_newline' },
  { pattern: /^$/, confidence: 60, type: 'empty_start' },
];

/**
 * Email-specific sentence starters
 */
const EMAIL_SENTENCE_STARTERS = [
  // Greetings
  { pattern: /^(dear|hi|hello|good\s+(morning|afternoon|evening))\b/i, type: 'greeting' },

  // Opening statements
  { pattern: /^(i\s+hope|i\s+am\s+writing|i\s+wanted|thank\s+you|thanks)\b/i, type: 'opening' },

  // Requests and questions
  { pattern: /^(could\s+you|would\s+you|can\s+you|please|may\s+i)\b/i, type: 'request' },

  // Information sharing
  { pattern: /^(i\s+would\s+like|just\s+wanted|fyi|for\s+your\s+information)\b/i, type: 'information' },

  // Closing statements
  { pattern: /^(looking\s+forward|best\s+regards|sincerely|thank\s+you\s+again)\b/i, type: 'closing' },

  // Transitional phrases
  { pattern: /^(additionally|furthermore|however|meanwhile|therefore)\b/i, type: 'transition' },
];

/**
 * Advanced sentence detection class
 */
class SentenceDetector {
  constructor() {
    this.previousAnalysis = null;
    this.sentenceHistory = [];
  }

  /**
   * Main function to detect if user is starting a new sentence
   */
  isStartingNewSentence(text, cursorPosition) {
    const analysis = this.analyzeTextContext(text, cursorPosition);

    console.log('🔍 Sentence detection analysis:', {
      isNewSentence: analysis.isNewSentence,
      confidence: analysis.confidence,
      trigger: analysis.trigger,
      sentencePhase: analysis.sentencePhase
    });

    return {
      isNewSentence: analysis.isNewSentence,
      confidence: analysis.confidence,
      sentenceType: analysis.sentenceType,
      suggestedContext: analysis.suggestedContext
    };
  }

  /**
   * Comprehensive text context analysis
   */
  analyzeTextContext(text, cursorPosition) {
    const beforeCursor = text.substring(0, cursorPosition);
    const afterCursor = text.substring(cursorPosition);

    // Get current and previous sentences
    const sentences = this.extractSentences(beforeCursor);
    const currentSentence = sentences[sentences.length - 1] || '';
    const previousSentence = sentences[sentences.length - 2] || '';

    const analysis = {
      isNewSentence: false,
      confidence: 0,
      trigger: 'none',
      sentenceType: 'unknown',
      sentencePhase: this.determineSentencePhase(currentSentence),
      suggestedContext: 'body'
    };

    // 1. Check if we're clearly after a sentence ending
    const sentenceEndResult = this.checkSentenceEnding(beforeCursor);
    if (sentenceEndResult.found) {
      analysis.isNewSentence = true;
      analysis.confidence = sentenceEndResult.confidence;
      analysis.trigger = sentenceEndResult.type;
      analysis.suggestedContext = this.determineEmailContext(beforeCursor, sentences);
      return analysis;
    }

    // 2. Check if we're at the start of the text (new email)
    if (beforeCursor.trim().length === 0) {
      analysis.isNewSentence = true;
      analysis.confidence = 95;
      analysis.trigger = 'email_start';
      analysis.sentenceType = 'greeting';
      analysis.suggestedContext = 'greeting';
      return analysis;
    }

    // 3. Check if we're after a paragraph break
    const paragraphResult = this.checkParagraphBreak(beforeCursor);
    if (paragraphResult.found) {
      analysis.isNewSentence = true;
      analysis.confidence = paragraphResult.confidence;
      analysis.trigger = paragraphResult.type;
      analysis.suggestedContext = this.determineEmailContext(beforeCursor, sentences);
      return analysis;
    }

    // 4. Check if we're starting with a capital letter after space
    const capitalAfterSpaceResult = this.checkCapitalAfterSpace(beforeCursor, afterCursor);
    if (capitalAfterSpaceResult.found) {
      analysis.isNewSentence = true;
      analysis.confidence = capitalAfterSpaceResult.confidence;
      analysis.trigger = 'capital_after_space';
      return analysis;
    }

    // 5. Check if current partial text matches sentence starter patterns
    const starterResult = this.checkSentenceStarters(currentSentence);
    if (starterResult.found) {
      analysis.isNewSentence = true;
      analysis.confidence = Math.max(60, starterResult.confidence);
      analysis.trigger = 'sentence_starter';
      analysis.sentenceType = starterResult.type;
      analysis.suggestedContext = starterResult.type;
      return analysis;
    }

    // 6. Check typing patterns that suggest new sentence
    const typingPatternResult = this.checkTypingPatterns(beforeCursor, currentSentence);
    if (typingPatternResult.found) {
      analysis.isNewSentence = true;
      analysis.confidence = typingPatternResult.confidence;
      analysis.trigger = 'typing_pattern';
      return analysis;
    }

    return analysis;
  }

  /**
   * Extract sentences from text
   */
  extractSentences(text) {
    return text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  /**
   * Check for sentence ending patterns
   */
  checkSentenceEnding(beforeCursor) {
    for (const ending of SENTENCE_ENDINGS) {
      if (ending.pattern.test(beforeCursor)) {
        return {
          found: true,
          confidence: ending.confidence,
          type: ending.type
        };
      }
    }
    return { found: false };
  }

  /**
   * Check for paragraph breaks
   */
  checkParagraphBreak(beforeCursor) {
    for (const ending of PARAGRAPH_ENDINGS) {
      if (ending.pattern.test(beforeCursor)) {
        return {
          found: true,
          confidence: ending.confidence,
          type: ending.type
        };
      }
    }
    return { found: false };
  }

  /**
   * Check if starting with capital letter after space
   */
  checkCapitalAfterSpace(beforeCursor, afterCursor) {
    // Look for pattern: "word. " or "word! " or "word? " followed by capital letter
    const endsWithSentenceAndSpace = /[.!?]\s+$/.test(beforeCursor);
    const startsWithCapital = /^[A-Z]/.test(afterCursor);

    if (endsWithSentenceAndSpace && startsWithCapital) {
      return {
        found: true,
        confidence: 85
      };
    }

    // Check if we're at the end and the last characters suggest sentence ending
    const lastFewChars = beforeCursor.slice(-3);
    if (/[.!?]\s*$/.test(lastFewChars)) {
      return {
        found: true,
        confidence: 75
      };
    }

    return { found: false };
  }

  /**
   * Check for sentence starter patterns
   */
  checkSentenceStarters(currentSentence) {
    const trimmed = currentSentence.trim().toLowerCase();

    for (const starter of EMAIL_SENTENCE_STARTERS) {
      if (starter.pattern.test(trimmed)) {
        return {
          found: true,
          confidence: 70,
          type: starter.type
        };
      }
    }
    return { found: false };
  }

  /**
   * Check typing patterns that suggest new sentence
   */
  checkTypingPatterns(beforeCursor, currentSentence) {
    const words = currentSentence.trim().split(/\s+/);

    // Single word that's likely starting a sentence
    if (words.length === 1) {
      const word = words[0].toLowerCase();
      const isCommonStarter = [
        'i', 'the', 'this', 'that', 'we', 'you', 'they', 'it',
        'please', 'thank', 'dear', 'hello', 'hi', 'good',
        'could', 'would', 'can', 'may', 'should', 'will'
      ].includes(word);

      if (isCommonStarter && beforeCursor.endsWith(' ')) {
        return {
          found: true,
          confidence: 65
        };
      }
    }

    // Two words that form a common sentence start
    if (words.length === 2) {
      const phrase = words.join(' ').toLowerCase();
      const isCommonPhrase = [
        'i am', 'i hope', 'i wanted', 'i would', 'thank you',
        'good morning', 'good afternoon', 'good evening',
        'could you', 'would you', 'can you', 'please let',
        'just wanted', 'looking forward', 'best regards'
      ].includes(phrase);

      if (isCommonPhrase) {
        return {
          found: true,
          confidence: 75
        };
      }
    }

    return { found: false };
  }

  /**
   * Determine what phase of the sentence we're in
   */
  determineSentencePhase(currentSentence) {
    const words = currentSentence.trim().split(/\s+/).filter(w => w.length > 0);

    if (words.length === 0) return 'empty';
    if (words.length <= 2) return 'beginning';
    if (words.length <= 6) return 'middle';
    return 'ending';
  }

  /**
   * Determine email context based on content
   */
  determineEmailContext(beforeCursor, sentences) {
    const text = beforeCursor.toLowerCase();
    const sentenceCount = sentences.length;

    // Greeting phase
    if (sentenceCount <= 1 && /^(dear|hi|hello|good\s+(morning|afternoon|evening))/.test(text)) {
      return 'greeting';
    }

    // Opening phase
    if (sentenceCount <= 2 && /(i hope|thank you|i am writing|i wanted)/.test(text)) {
      return 'opening';
    }

    // Closing phase
    if (/(looking forward|best regards|sincerely|thank you again|please let me know)/.test(text)) {
      return 'closing';
    }

    // Body phase (default)
    return 'body';
  }

  /**
   * Get suggestion context based on sentence detection
   */
  getSuggestionContext(text, cursorPosition) {
    const result = this.isStartingNewSentence(text, cursorPosition);

    return {
      shouldSuggest: result.isNewSentence && result.confidence >= 60,
      confidence: result.confidence,
      emailPhase: result.suggestedContext,
      sentenceType: result.sentenceType,
      trigger: result.trigger || 'none'
    };
  }
}

// Create singleton instance
const sentenceDetector = new SentenceDetector();

// Export both the class and the instance
export default sentenceDetector;
export { SentenceDetector };