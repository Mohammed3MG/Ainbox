const Fuse = require('fuse.js');
const chrono = require('chrono-node');

// Note: wink-nlp requires a model which we'll load when needed
// For now we'll use simpler tokenization

/**
 * Enhanced NLP Text Processor for Email Suggestions
 * Provides clean, professional text completion using proper NLP
 */
class NLPProcessor {
  constructor() {
    // High-quality email patterns database
    this.emailPatterns = [
      // Professional greetings
      { pattern: 'Dear Sir/Madam,', context: 'formal_greeting', score: 95 },
      { pattern: 'Dear [Name],', context: 'personal_greeting', score: 90 },
      { pattern: 'Hello [Name],', context: 'casual_greeting', score: 85 },
      { pattern: 'Good morning,', context: 'time_greeting', score: 80 },
      { pattern: 'Good afternoon,', context: 'time_greeting', score: 80 },

      // Professional expressions
      { pattern: 'I hope this email finds you well.', context: 'opening', score: 90 },
      { pattern: 'I hope you are doing well.', context: 'opening', score: 85 },
      { pattern: 'Thank you for your email.', context: 'acknowledgment', score: 90 },
      { pattern: 'Thank you for your time.', context: 'gratitude', score: 85 },
      { pattern: 'I appreciate your help.', context: 'gratitude', score: 85 },

      // Professional requests
      { pattern: 'Could you please', context: 'polite_request', score: 90 },
      { pattern: 'Would you be able to', context: 'polite_request', score: 85 },
      { pattern: 'I would appreciate it if you could', context: 'polite_request', score: 92 },
      { pattern: 'Please let me know', context: 'request_info', score: 85 },

      // Professional closings
      { pattern: 'Looking forward to hearing from you.', context: 'closing', score: 90 },
      { pattern: 'Best regards,', context: 'sign_off', score: 95 },
      { pattern: 'Kind regards,', context: 'sign_off', score: 90 },
      { pattern: 'Thank you for your consideration.', context: 'closing', score: 85 },
      { pattern: 'Please feel free to contact me.', context: 'closing', score: 80 }
    ];

    // Initialize Fuse.js for intelligent pattern matching
    this.fuse = new Fuse(this.emailPatterns, {
      keys: ['pattern', 'context'],
      threshold: 0.4,
      includeScore: true
    });

    // Enhanced word corrections and completions
    this.corrections = new Map([
      // Fix critical typos first
      ['hell', 'Hello'],
      ['wis', 'wish'],
      ['wishe', 'wish'],
      ['ther', 'there'],
      ['thier', 'their'],
      ['recieve', 'receive'],
      ['beleive', 'believe'],
      ['seperate', 'separate'],
      ['definately', 'definitely'],
      ['occured', 'occurred'],
      ['neccessary', 'necessary'],
      ['teh', 'the'],
      ['adn', 'and'],
      ['taht', 'that'],
      ['wiht', 'with'],
      ['fro', 'for'],
      ['tiem', 'time'],
      ['ahve', 'have'],
      ['alot', 'a lot'],
      ['incase', 'in case'],

      // Truncated words - common email patterns
      ['dea', 'Dear'],
      ['hel', 'Hello'],
      ['tha', 'Thank'],
      ['bes', 'Best'],
      ['ple', 'Please'],
      ['sin', 'Sincerely'],
      ['loo', 'Looking'],
      ['for', 'forward'],
      ['app', 'appreciate'],
      ['con', 'contact'],
      ['inf', 'information'],
      ['mee', 'meeting'],

      // Missing contractions
      ['dont', "don't"],
      ['cant', "can't"],
      ['wont', "won't"],
      ['isnt', "isn't"],
      ['arent', "aren't"],
      ['wasnt', "wasn't"],
      ['hasnt', "hasn't"],
      ['doesnt', "doesn't"],
      ['didnt', "didn't"],
      ['wouldnt', "wouldn't"],
      ['couldnt', "couldn't"],
      ['shouldnt', "shouldn't"]
    ]);
  }

  /**
   * Analyze text context to understand where the user is in their email
   */
  analyzeContext(text, cursorPosition) {
    const beforeCursor = text.substring(0, cursorPosition).toLowerCase().trim();

    console.log('📝 Raw text analysis:', {
      beforeCursor: beforeCursor,
      length: beforeCursor.length
    });

    // Clean text by removing repeated patterns and fixing punctuation
    const cleanedText = this.cleanRepeatedPatterns(beforeCursor);
    const words = cleanedText.split(/\s+/).filter(word => word.length > 0);
    const lastSentence = cleanedText.split(/[.!?]+/).pop().trim();

    console.log('🧹 Cleaned text analysis:', {
      cleanedText: cleanedText,
      words: words.slice(-5), // Show last 5 words
      wordCount: words.length
    });

    // Detect actual email phases based on content
    const isGreeting = this.detectGreeting(cleanedText, words);
    const isOpening = this.detectOpening(cleanedText, words);
    const isClosing = this.detectClosing(cleanedText, words);

    // Everything else is body content (default to body if uncertain)
    const isBody = !isGreeting && !isOpening && !isClosing;

    // Clean lastWords by removing punctuation
    const cleanWords = words.slice(-3).map(word => word.replace(/[.,!?;:]/g, ''));
    const lastWords = cleanWords.join(' ');

    const result = {
      isGreeting,
      isOpening,
      isBody,
      isClosing,
      lastWords,
      sentenceLength: lastSentence.split(/\s+/).length,
      hasCompletion: cleanedText.endsWith(',') || cleanedText.endsWith('.')
    };

    console.log('🎯 Context analysis result:', result);
    return result;
  }

  /**
   * Clean repeated patterns that corrupt the text
   */
  cleanRepeatedPatterns(text) {
    let cleaned = text;

    // Remove repeated phrases (like "Good evening,Good evening,")
    cleaned = cleaned.replace(/\b(good\s+(morning|afternoon|evening)),?\s*\1[,\s]*/gi, '$1, ');

    // Remove multiple consecutive commas
    cleaned = cleaned.replace(/,{2,}/g, ',');

    // Remove trailing commas and spaces
    cleaned = cleaned.replace(/,+\s*$/, '');

    // Fix spaces around punctuation
    cleaned = cleaned.replace(/\s*,\s*/g, ', ');
    cleaned = cleaned.replace(/\s*\.\s*/g, '. ');

    return cleaned.trim();
  }

  /**
   * Detect if text contains greeting patterns
   */
  detectGreeting(text, words) {
    // Short text starting with greeting words
    if (words.length <= 3 && /^(dear|hi|hello|hey)/.test(text)) {
      return true;
    }

    // Explicit greeting patterns
    if (/^(dear\s+\w+|hi\s+\w+|hello\s+\w+|good\s+(morning|afternoon|evening))/.test(text)) {
      return true;
    }

    return false;
  }

  /**
   * Detect if text contains opening patterns
   */
  detectOpening(text, words) {
    // Look for common opening phrases (including typos)
    const openingPatterns = [
      /i\s+hop[e]?\s+(you|this)/,  // "i hope" or "i hop" (typo)
      /thank\s+you\s+for/,
      /i\s+am\s+writing/,
      /i\s+wanted\s+to/,
      /i\s+am\s+reaching\s+out/,
      /i\s+trust\s+this/,
      /i\s+trust\s+you/
    ];

    for (const pattern of openingPatterns) {
      if (pattern.test(text)) {
        console.log('✅ Opening pattern matched:', pattern);
        return true;
      }
    }

    return false;
  }

  /**
   * Detect if text contains closing patterns
   */
  detectClosing(text, words) {
    const closingPatterns = [
      'regards',
      'sincerely',
      'best wishes',
      'looking forward',
      'thank you for your time',
      'please feel free to contact',
      'i look forward to hearing'
    ];

    return closingPatterns.some(pattern => text.includes(pattern));
  }

  /**
   * Clean and preprocess text input
   */
  preprocessText(text) {
    if (!text || typeof text !== 'string') {
      return { original: text, cleaned: text, changes: false };
    }

    const original = text;
    let cleaned = text.trim();
    let changes = false;

    // Simple tokenization (without wink-nlp for now)
    const tokens = cleaned.split(/(\s+|[.,!?;:])/);

    // Apply corrections to individual tokens
    const correctedTokens = tokens.map(token => {
      const lower = token.toLowerCase();
      if (this.corrections.has(lower)) {
        changes = true;
        const correction = this.corrections.get(lower);

        // Preserve original case pattern
        if (token === token.toUpperCase()) {
          return correction.toUpperCase();
        } else if (token[0] === token[0].toUpperCase()) {
          return correction[0].toUpperCase() + correction.slice(1);
        }
        return correction.toLowerCase();
      }
      return token;
    });

    cleaned = correctedTokens.join('');

    // Clean up spacing and punctuation
    cleaned = cleaned.replace(/\s+/g, ' ');
    cleaned = cleaned.replace(/\s*,\s*/g, ', ');
    cleaned = cleaned.replace(/\s*\.\s*/g, '. ');

    // Fix capitalization
    cleaned = cleaned.replace(/\bi\b/g, 'I'); // Standalone 'i' to 'I'
    cleaned = cleaned.replace(/^\w/, match => match.toUpperCase()); // Capitalize first letter
    cleaned = cleaned.replace(/([.!?]\s*)([a-z])/g, (match, punct, letter) =>
      punct + letter.toUpperCase()
    ); // Capitalize after sentence endings

    cleaned = cleaned.trim();

    if (cleaned !== original) {
      changes = true;
    }

    return { original, cleaned, changes };
  }

  /**
   * Generate dynamic, intelligent email suggestions based on context
   */
  generateSuggestions(text, cursorPosition, maxSuggestions = 3) {
    const beforeCursor = text.substring(0, cursorPosition);
    const context = this.analyzeContext(text, cursorPosition);
    const words = beforeCursor.toLowerCase().trim().split(/\s+/);
    const lastWord = words[words.length - 1] || '';
    const lastTwoWords = words.slice(-2).join(' ');
    const lastThreeWords = words.slice(-3).join(' ');

    console.log('🧠 Dynamic NLP Analysis:', {
      lastWord,
      lastTwoWords,
      lastThreeWords,
      context: context
    });

    // 1. DYNAMIC WORD COMPLETION - highest priority
    if (lastWord.length >= 2) {
      const completions = this.getDynamicWordCompletions(lastWord, beforeCursor);
      if (completions.length > 0) {
        console.log('✅ Word completions found:', completions);
        return completions.slice(0, maxSuggestions);
      }
    }

    // 2. DYNAMIC PHRASE COMPLETION - based on context patterns
    const phraseCompletions = this.getDynamicPhraseCompletions(lastThreeWords, beforeCursor, context);
    if (phraseCompletions.length > 0) {
      console.log('✅ Phrase completions found:', phraseCompletions);
      return phraseCompletions.slice(0, maxSuggestions);
    }

    // 3. CONTEXTUAL SENTENCE STARTERS - only when truly starting new content
    if (this.isStartingNewContent(beforeCursor)) {
      const contextualStarters = this.getContextualSentenceStarters(beforeCursor, context);
      console.log('✅ Contextual starters found:', contextualStarters);
      return contextualStarters.slice(0, maxSuggestions);
    }

    // 4. SEMANTIC FUZZY MATCHING - fallback using AI patterns
    const semanticSuggestions = this.getSemanticSuggestions(lastThreeWords, context);
    console.log('✅ Semantic suggestions:', semanticSuggestions);
    return semanticSuggestions.slice(0, maxSuggestions);
  }

  /**
   * Dynamic word completion based on context and patterns
   */
  getDynamicWordCompletions(partialWord, fullContext) {
    const lower = partialWord.toLowerCase();
    const completions = [];

    // Enhanced word patterns with contextual awareness
    const contextualWordMap = this.buildContextualWordMap(fullContext);

    // 1. Exact prefix matching
    for (const [prefix, words] of Object.entries(contextualWordMap)) {
      if (lower.startsWith(prefix)) {
        const remainders = words
          .filter(word => word.toLowerCase().startsWith(lower))
          .map(word => word.substring(lower.length))
          .filter(remainder => remainder.length > 0);
        completions.push(...remainders);
      }
    }

    // 2. Fuzzy word matching using edit distance
    if (completions.length === 0) {
      const fuzzyMatches = this.getFuzzyWordMatches(lower, fullContext);
      completions.push(...fuzzyMatches);
    }

    // 3. Spell correction completions
    if (completions.length === 0 && this.corrections.has(lower)) {
      const correction = this.corrections.get(lower);
      if (correction.length > lower.length) {
        completions.push(correction.substring(lower.length));
      }
    }

    return [...new Set(completions)].slice(0, 3);
  }

  /**
   * Build contextual word map based on email content
   */
  buildContextualWordMap(context) {
    const baseMap = {
      'appr': ['approval', 'appropriate', 'appreciate', 'approach', 'approved'],
      'regar': ['regarding', 'regards'],
      'rece': ['receive', 'received', 'recent', 'reception'],
      'info': ['information', 'inform', 'informative'],
      'meet': ['meeting', 'meetings', 'meet'],
      'proj': ['project', 'projects', 'projection'],
      'proc': ['process', 'procedure', 'proceed', 'processing'],
      'conf': ['confirm', 'confirmation', 'conference', 'confident'],
      'assi': ['assist', 'assistance', 'assignment', 'associate'],
      'disc': ['discuss', 'discussion', 'discover', 'discount'],
      'sched': ['schedule', 'scheduled', 'scheduling'],
      'upda': ['update', 'updated', 'updating'],
      'avai': ['available', 'availability', 'avail'],
      'impl': ['implement', 'implementation', 'implementing'],
      'deta': ['details', 'detailed', 'detail'],
      'requ': ['request', 'require', 'required', 'requirements'],
      'resp': ['response', 'responsible', 'respect', 'respond'],
      'foll': ['follow', 'following', 'followup'],
      'addr': ['address', 'addressed', 'addressing'],
      'atta': ['attached', 'attachment', 'attach'],
      'unde': ['understand', 'understanding', 'understood'],
      'revi': ['review', 'revision', 'revised', 'revise']
    };

    // Add contextual words based on email content analysis
    const contextLower = context.toLowerCase();

    if (contextLower.includes('meeting') || contextLower.includes('schedule')) {
      baseMap['time'] = ['timeline', 'timeframe', 'timely'];
      baseMap['agen'] = ['agenda', 'agent'];
    }

    if (contextLower.includes('project') || contextLower.includes('work')) {
      baseMap['dead'] = ['deadline', 'deadlines'];
      baseMap['deli'] = ['deliver', 'delivery', 'deliverable'];
    }

    if (contextLower.includes('thank') || contextLower.includes('appreciate')) {
      baseMap['grat'] = ['grateful', 'gratitude'];
      baseMap['kind'] = ['kindly', 'kindness'];
    }

    return baseMap;
  }

  /**
   * Get fuzzy word matches using simple edit distance
   */
  getFuzzyWordMatches(partialWord, context) {
    const commonWords = [
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'have', 'let', 'put', 'say', 'she', 'too', 'use',
      'about', 'after', 'again', 'before', 'could', 'every', 'first', 'found', 'great', 'group', 'house', 'know', 'large', 'last', 'leave', 'life', 'little', 'look', 'made', 'make', 'many', 'most', 'move', 'much', 'name', 'need', 'never', 'number', 'other', 'over', 'place', 'public', 'right', 'same', 'seem', 'small', 'state', 'still', 'such', 'take', 'than', 'that', 'their', 'them', 'these', 'they', 'think', 'this', 'those', 'through', 'time', 'under', 'very', 'want', 'water', 'well', 'went', 'were', 'what', 'where', 'which', 'while', 'will', 'with', 'without', 'work', 'world', 'would', 'write', 'year', 'your',
      // Business/email specific
      'please', 'thank', 'thanks', 'regards', 'sincerely', 'meeting', 'project', 'schedule', 'information', 'regarding', 'attached', 'response', 'follow', 'update', 'confirm', 'available', 'appreciate', 'understand', 'request', 'require', 'discuss', 'review', 'process', 'details', 'assistance'
    ];

    const matches = [];
    for (const word of commonWords) {
      if (word.startsWith(partialWord) && word.length > partialWord.length) {
        matches.push(word.substring(partialWord.length));
      }
    }

    return matches.slice(0, 3);
  }

  /**
   * Dynamic phrase completion based on contextual patterns
   */
  getDynamicPhraseCompletions(lastThreeWords, fullContext, emailContext) {
    const completions = [];
    const contextLower = fullContext.toLowerCase();

    // Analyze semantic patterns in the last few words
    if (lastThreeWords.includes('regarding the')) {
      // Look for what typically follows "regarding the" in business emails
      const followUps = this.analyzeSemanticContext(contextLower, 'regarding');
      completions.push(...followUps);
    }

    if (lastThreeWords.includes('i would like')) {
      completions.push('to discuss', 'to schedule', 'to request', 'to follow up');
    }

    if (lastThreeWords.includes('please let me')) {
      completions.push('know if', 'know when', 'know your thoughts');
    }

    if (lastThreeWords.includes('thank you for')) {
      completions.push('your time', 'your response', 'your email', 'the opportunity');
    }

    if (lastThreeWords.includes('i hope this')) {
      completions.push('email finds you well', 'message finds you', 'helps clarify');
    }

    if (lastThreeWords.includes('looking forward to')) {
      completions.push('hearing from you', 'your response', 'our meeting');
    }

    // Context-aware business phrases
    if (lastThreeWords.includes('could you please')) {
      if (contextLower.includes('meeting') || contextLower.includes('schedule')) {
        completions.push('confirm the meeting time', 'let me know your availability');
      } else if (contextLower.includes('document') || contextLower.includes('file')) {
        completions.push('review the attached document', 'send me the file');
      } else {
        completions.push('provide more information', 'help me with', 'clarify this');
      }
    }

    return [...new Set(completions)];
  }

  /**
   * Analyze semantic context to provide intelligent suggestions
   */
  analyzeSemanticContext(contextText, keyword) {
    const suggestions = [];

    if (keyword === 'regarding') {
      // Analyze what the email might be about based on context
      if (contextText.includes('meeting') || contextText.includes('schedule')) {
        suggestions.push('meeting we discussed', 'upcoming appointment', 'scheduled call');
      } else if (contextText.includes('project') || contextText.includes('work')) {
        suggestions.push('project timeline', 'work proposal', 'project status');
      } else if (contextText.includes('invoice') || contextText.includes('payment')) {
        suggestions.push('invoice #', 'payment terms', 'billing inquiry');
      } else if (contextText.includes('order') || contextText.includes('purchase')) {
        suggestions.push('order confirmation', 'purchase request', 'delivery status');
      } else {
        suggestions.push('your recent inquiry', 'our conversation', 'the matter we discussed');
      }
    }

    return suggestions;
  }

  /**
   * Check if user is starting new content (not mid-sentence)
   */
  isStartingNewContent(text) {
    const trimmed = text.trim();

    // Empty or very short text
    if (trimmed.length === 0) return true;

    // Ends with sentence terminators
    if (/[.!?]\s*$/.test(trimmed)) return true;

    // Ends with paragraph breaks
    if (/\n\s*$/.test(trimmed)) return true;

    // Starts with greeting patterns
    if (/^(dear|hi|hello|good\s+(morning|afternoon|evening))/i.test(trimmed)) return true;

    return false;
  }

  /**
   * Get contextual sentence starters based on email phase
   */
  getContextualSentenceStarters(fullContext, emailContext) {
    const starters = [];
    const contextLower = fullContext.toLowerCase();

    // ONLY suggest when truly starting new content - be very restrictive
    if (fullContext.trim().length === 0) {
      // Only for completely empty email
      starters.push('Dear', 'Hello', 'Hi');
    }

    // No time-based greetings - they're causing random "Good Evening" suggestions
    // No generic sentence starters - they're causing poor suggestions

    return starters;
  }

  /**
   * Get semantic suggestions using fuzzy matching and AI patterns
   */
  getSemanticSuggestions(lastWords, context) {
    // Use the existing Fuse.js fuzzy search
    const searchResults = this.fuse.search(lastWords);

    const suggestions = [];

    if (searchResults.length > 0) {
      // Get relevant patterns and adapt them
      const relevantPatterns = searchResults
        .slice(0, 2)
        .map(result => {
          let pattern = result.item.pattern;
          // Make patterns more dynamic
          pattern = pattern.replace('[Name]', 'you');
          pattern = pattern.replace(/^(I |We |Dear |Hello )/, '');
          return pattern;
        })
        .filter(pattern => pattern.length > 0);

      suggestions.push(...relevantPatterns);
    }

    // If no good fuzzy matches, provide contextual fallbacks
    if (suggestions.length === 0) {
      if (context.isBody) {
        suggestions.push('and I wanted to', 'which would be', 'that we discussed');
      } else {
        suggestions.push('I hope you', 'please let me', 'thank you for');
      }
    }

    return suggestions;
  }

  /**
   * Extract dates and times from text
   */
  extractDates(text) {
    return chrono.parse(text);
  }

  /**
   * Validate email structure and suggest improvements
   */
  validateEmailStructure(text) {
    const issues = [];
    const suggestions = [];

    // Check for proper greeting
    if (!text.match(/^(Dear|Hello|Hi|Good morning|Good afternoon)/i)) {
      issues.push('Missing proper greeting');
      suggestions.push('Add a greeting like "Dear [Name]," or "Hello,"');
    }

    // Check for proper closing
    if (!text.match(/(Best regards|Kind regards|Sincerely|Thank you)/i)) {
      issues.push('Missing proper closing');
      suggestions.push('Add a closing like "Best regards," or "Thank you,"');
    }

    // Check for double spaces
    if (text.includes('  ')) {
      issues.push('Multiple spaces found');
      suggestions.push('Remove extra spaces for better formatting');
    }

    return { issues, suggestions };
  }
}

module.exports = new NLPProcessor();