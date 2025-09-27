const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { chat } = require('../lib/ollama');
const { summarizePrompt, suggestRepliesPrompt } = require('../prompts/email');
const emailCache = require('../lib/emailCache');
const nlpProcessor = require('../lib/nlpProcessor');

const router = express.Router();

/**
 * Enhanced spell checking using NLP processor
 */
function correctSpelling(text) {
  if (!text || typeof text !== 'string') return text;

  // Use the enhanced NLP processor for intelligent text preprocessing
  const result = nlpProcessor.preprocessText(text);

  return result.cleaned;
}

// Summarize an email thread
// POST /ai/summarize { subject, messages: [{ from, date, html, text }] }
router.post('/ai/summarize', requireAuth, async (req, res) => {
  try {
    const { subject, messages = [], tone } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages are required' });
    }

    // Create a unique key for this summary request
    const messageId = messages[0]?.id || 'unknown';
    const messagesContent = messages.map(m => ({ subject: m.subject, from: m.from, text: m.text || m.html }));

    // Try to get from cache first
    const cached = await emailCache.getAISummary(messageId, messagesContent);
    if (cached) {
      console.log('📦 Serving AI summary from cache');
      // Apply spell checking to cached summary too
      const correctedCached = correctSpelling(cached);
      return res.json({ summary: correctedCached });
    }

    console.log('🤖 Generating new AI summary');
    const prompt = summarizePrompt(subject, messages);
    const out = await chat(prompt, { options: { temperature: 0.2 } });

    // Apply spell checking to AI-generated summary
    const correctedSummary = correctSpelling(out.content);

    // Cache the corrected response
    await emailCache.setAISummary(messageId, messagesContent, correctedSummary);
    console.log('💾 Cached AI summary');

    return res.json({ summary: correctedSummary });
  } catch (e) {
    console.error('AI summarize failed:', e?.message);
    return res.status(500).json({ error: 'summarize_failed' });
  }
});

// Suggest replies for latest message with full context
// POST /ai/suggest-replies { subject, lastMessage: { html, text }, tone, fullThread, currentUserEmail, replyToSender, replyToEmail }
router.post('/ai/suggest-replies', requireAuth, async (req, res) => {
  try {
    const {
      subject,
      lastMessage = null,
      tone = 'neutral',
      fullThread = [],
      currentUserEmail = '',
      replyToSender = '',
      replyToEmail = ''
    } = req.body || {};

    if (!lastMessage) return res.status(400).json({ error: 'lastMessage required' });

    // Create cache key from message content and context
    const messageId = lastMessage.id || 'unknown';
    const content = {
      subject,
      lastMessage: { html: lastMessage.html, text: lastMessage.text },
      fullThread: fullThread.map(m => ({ from: m.from, text: m.text || m.html })),
      currentUserEmail,
      replyToSender,
      replyToEmail
    };

    // Try to get from cache first
    const cached = await emailCache.getAIReplies(messageId, content, tone);
    if (cached) {
      console.log('📦 Serving AI reply suggestions from cache');
      // Apply spell checking to cached suggestions too
      const correctedCached = cached.map(suggestion => correctSpelling(suggestion));
      return res.json({ suggestions: correctedCached });
    }

    console.log('🤖 Generating new AI reply suggestions');
    const prompt = suggestRepliesPrompt(subject, lastMessage, {
      tone,
      fullThread,
      currentUserEmail,
      replyToSender,
      replyToEmail
    });

    const out = await chat(prompt, { options: { temperature: 0.4 } });

    // Apply spell checking to AI-generated suggestions
    const correctedSuggestions = out.content.map(suggestion => correctSpelling(suggestion));

    // Cache the corrected response
    await emailCache.setAIReplies(messageId, content, tone, correctedSuggestions);
    console.log('💾 Cached AI reply suggestions');

    return res.json({ suggestions: correctedSuggestions });
  } catch (e) {
    console.error('AI suggest failed:', e?.message);
    return res.status(500).json({ error: 'suggest_failed' });
  }
});

// Generate email content using Ollama with conversational context
router.post('/ai/generate-email', async (req, res) => {
  const {
    prompt,
    conversation = {},
    model = 'gemma2:2b',
    maxTokens = 150,
    temperature = 0.3
  } = req.body;

  try {
    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required'
      });
    }

    console.log('🤖 Generating conversational email with AI');
    console.log('📝 Conversation context:', conversation.messageCount || 0, 'messages');

    // Create contextual prompt that considers conversation history
    let contextualPrompt = `You are an expert email writer. Write a SHORT, CLEAR, and PROFESSIONAL email.

USER REQUEST: "${prompt}"`;

    // Add conversation context if available
    if (conversation.messages && conversation.messages.length > 0) {
      contextualPrompt += `\n\nCONVERSATION CONTEXT:`;
      const recentMessages = conversation.messages.slice(-4); // Last 4 messages for context
      recentMessages.forEach((msg, index) => {
        if (msg.type === 'user') {
          contextualPrompt += `\nUser asked: "${msg.content}"`;
        } else if (msg.type === 'ai' && msg.emailContent) {
          contextualPrompt += `\nAI generated: "${msg.emailContent.substring(0, 150)}..."`;
        }
      });
      contextualPrompt += `\n\nImprove or refine based on this conversation history.`;
    }

    contextualPrompt += `\n\nRULES:
1. Write ONLY the email body (no subject line)
2. Keep it SHORT - maximum 3-4 sentences
3. Use simple, clear language
4. Be polite and professional
5. Start with proper greeting (Dear [Name] or Hi [Name])
6. End with appropriate closing (Best regards, Thank you, etc.)
7. Stay focused on the main request
8. Be ethical and respectful
9. If this is a refinement request, improve the previous email accordingly

WRITE THE EMAIL NOW:`;

    const messages = [
      {
        role: 'user',
        content: contextualPrompt
      }
    ];

    const out = await chat(messages, {
      model: model,
      options: {
        temperature: Math.min(1.0, Math.max(0.1, temperature)),
        num_predict: Math.min(300, Math.max(50, maxTokens)),
        top_p: 0.9,
        stop: ['USER:', 'RULES:', 'Human:', 'Assistant:', '\n\n\n']
      }
    });

    // Clean up the generated text
    let emailContent = out.content
      .replace(/^(WRITE THE EMAIL NOW:|Email content:|Email:|Dear Sir\/Madam,?\s*)/i, '')
      .replace(/^\s*[\*\-•]\s*/gm, '') // Remove bullet points
      .replace(/^(Here is|Here's|Below is).*?:\s*/i, '') // Remove intro phrases
      .replace(/\n\s*\n\s*\n/g, '\n\n') // Fix excessive line breaks
      .replace(/^Dear\s*,\s*/i, 'Dear [Name],\n\n') // Fix empty greeting
      .trim();

    // Ensure proper greeting
    if (!emailContent.match(/^(Dear|Hi|Hello|Good morning|Good afternoon)/i)) {
      emailContent = 'Dear [Name],\n\n' + emailContent;
    }

    // Ensure proper closing
    if (!emailContent.match(/(Best regards|Sincerely|Thank you|Best|Regards),?\s*$/i)) {
      emailContent = emailContent + '\n\nBest regards,';
    }

    // Generate explanation based on context
    let explanation = 'Generated a professional email based on your request.';
    if (conversation.messages && conversation.messages.length > 0) {
      explanation = 'Refined the email based on our conversation history.';
    }

    // Generate dynamic suggestions based on the email content
    console.log('🎯 Generating dynamic suggestions for email');
    const suggestionsPrompt = `Given this email, suggest 4 improvements:

EMAIL: "${emailContent}"

REQUEST: "${prompt}"

Suggest exactly 4 short improvements (3-5 words each):
1. [suggestion]
2. [suggestion]
3. [suggestion]
4. [suggestion]`;

    try {
      const suggestionsResponse = await chat([{ role: 'user', content: suggestionsPrompt }], {
        model: 'gemma2:2b',
        options: { temperature: 0.7, num_predict: 150 }
      });

      console.log('🤖 Raw AI suggestions response:', suggestionsResponse.content);

      // Parse suggestions from AI response
      let content = suggestionsResponse.content;

      // Remove common intro phrases
      content = content.replace(/^(Here are|Here's|Below are|I suggest).*?(suggestions?|improvements?):?\s*/i, '');
      content = content.replace(/^(For this email|To improve this email).*?\s*/i, '');

      let rawSuggestions = content
        .split('\n')
        .map(s => s.trim())
        .map(s => s.replace(/^\d+\.\s*/, '')) // Remove numbering like "1. "
        .map(s => s.replace(/^-\s*/, '')) // Remove dashes
        .map(s => s.replace(/^\*\s*/, '')) // Remove asterisks
        .map(s => s.replace(/^\[suggestion\]/, '')) // Remove placeholder text
        .map(s => s.trim());

      console.log('📝 Raw split suggestions:', rawSuggestions);

      let filteredSuggestions = rawSuggestions
        .filter(s => s.length > 2 && s.length < 60) // Better length limits
        .filter(s => !s.toLowerCase().includes('suggestion')) // Remove placeholder lines
        .filter(s => !s.toLowerCase().includes('improvement')) // Remove meta text
        .filter(s => !s.toLowerCase().includes('here are')); // Remove intro text

      console.log('🔍 Filtered suggestions:', filteredSuggestions);

      let dynamicSuggestions = filteredSuggestions.slice(0, 4);

      // Fallback if AI doesn't generate good suggestions
      if (dynamicSuggestions.length < 3) {
        console.log('⚠️ Not enough dynamic suggestions, using fallback. Count:', dynamicSuggestions.length);
        dynamicSuggestions = [
          "Make it more professional",
          "Make it shorter",
          "Add more details",
          "Change the tone"
        ];
      }

      console.log('✨ Final dynamic suggestions:', dynamicSuggestions);

      // Apply spell checking to email content and suggestions
      const correctedEmailContent = correctSpelling(emailContent);
      const correctedSuggestions = dynamicSuggestions.map(suggestion => correctSpelling(suggestion));

      res.json({
        success: true,
        emailContent: correctedEmailContent,
        explanation: explanation,
        suggestions: correctedSuggestions,
        conversationId: Date.now().toString(),
        model: model,
        timestamp: new Date().toISOString()
      });

    } catch (suggestionsError) {
      console.log('⚠️ Suggestions generation failed, using fallback');

      // Apply spell checking to email content for fallback too
      const correctedEmailContent = correctSpelling(emailContent);

      res.json({
        success: true,
        emailContent: correctedEmailContent,
        explanation: explanation,
        suggestions: [
          "Make it more professional",
          "Make it shorter",
          "Add more details",
          "Change the tone"
        ],
        conversationId: Date.now().toString(),
        model: model,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('AI email generation error:', error);

    return res.status(500).json({
      success: false,
      error: 'AI generation failed',
      details: error.message,
      note: 'Ollama connection issue. Please check if Ollama is running and the model is available.'
    });
  }
});



// Enhanced instant pattern matching with NLP
router.post('/api/instant-suggest', async (req, res) => {
  const {
    text,
    cursorPosition,
    emailContext = {},
    maxSuggestions = 3
  } = req.body;

  try {
    if (!text || cursorPosition === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Text and cursor position are required'
      });
    }

    console.log('⚡ Enhanced pattern matching request');
    console.log('📝 Context:', text.substring(Math.max(0, cursorPosition - 20), cursorPosition + 20));

    // Don't suggest if cursor is in the middle of a word (prevents junk completions)
    const afterCursor = text.substring(cursorPosition);
    if (/^\w/.test(afterCursor)) {
      return res.json({
        success: true,
        suggestions: [],
        source: 'nlp-pattern',
        responseTime: '<5ms',
        timestamp: new Date().toISOString()
      });
    }

    // Use NLP processor for instant suggestions
    const beforeCursor = text.substring(0, cursorPosition);
    const suggestions = nlpProcessor.generateSuggestions(beforeCursor, cursorPosition, maxSuggestions);

    console.log('✨ NLP pattern suggestions:', suggestions);

    res.json({
      success: true,
      suggestions: suggestions,
      source: 'nlp-pattern',
      responseTime: '<5ms',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Pattern matching error:', error);

    res.status(500).json({
      success: false,
      error: 'Pattern matching failed',
      suggestions: [] // Return empty suggestions on error
    });
  }
});

// AI-powered suggestion endpoint with enhanced NLP
router.post('/api/ai-suggest', async (req, res) => {
  const {
    text,
    cursorPosition,
    emailContext = {},
    maxSuggestions = 1
  } = req.body;

  try {
    if (!text || cursorPosition === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Text and cursor position are required'
      });
    }

    console.log('🤖 AI suggestion request with enhanced NLP');
    console.log('📝 Context length:', text.length, 'Cursor at:', cursorPosition);

    // Use NLP processor for text analysis
    const localBeforeCursor = text.substring(0, cursorPosition);
    const preprocessResult = nlpProcessor.preprocessText(localBeforeCursor);
    const beforeCursor = preprocessResult.cleaned;

    console.log('🔧 NLP preprocessing:', {
      original: localBeforeCursor.slice(-30),
      cleaned: beforeCursor.slice(-30),
      changes: preprocessResult.changes
    });

    // Analyze email context using NLP processor - use local cursor position
    const context = nlpProcessor.analyzeContext(beforeCursor, beforeCursor.length);

    console.log('📧 Email context analysis:', context);

    // Generate suggestions using NLP processor
    const nlpSuggestions = nlpProcessor.generateSuggestions(beforeCursor, cursorPosition, maxSuggestions);

    if (nlpSuggestions.length > 0) {
      console.log('✨ NLP suggestions:', nlpSuggestions);
      return res.json({
        success: true,
        suggestions: nlpSuggestions,
        source: 'nlp',
        responseTime: '<10ms',
        timestamp: new Date().toISOString()
      });
    }

    // Fallback to AI if no NLP suggestions
    console.log('🤖 Falling back to AI for complex suggestions');

    // Create intelligent prompt based on NLP analysis
    let completionPrompt = `You are completing an email. Provide contextually appropriate suggestions.

TEXT TO COMPLETE: "${beforeCursor.slice(-50)}"
EMAIL CONTEXT: ${JSON.stringify(context)}`;

    if (context.isGreeting) {
      completionPrompt += `\nGUIDANCE: This is a greeting. Complete with names, titles, or greeting endings.`;
    } else if (context.isOpening) {
      completionPrompt += `\nGUIDANCE: This is an opening. Complete with purpose or polite expressions.`;
    } else if (context.isBody) {
      completionPrompt += `\nGUIDANCE: This is the main content. Focus on the specific topic.`;
    } else if (context.isClosing) {
      completionPrompt += `\nGUIDANCE: This is closing. Use appropriate closing phrases.`;
    }

    completionPrompt += `\n\nComplete with ONLY the next 2-5 words that logically continue:`;

    // Use Ollama for AI suggestions
    const startTime = Date.now();
    const response = await chat([{
      role: 'user',
      content: completionPrompt
    }], {
      model: 'gemma2:2b',
      options: {
        temperature: 0.4,
        num_predict: 15,
        top_p: 0.9,
        top_k: 40,
        stop: ['\n', '.', 'GUIDANCE:', 'CONTEXT:', 'Complete with']
      }
    });

    const responseTime = Date.now() - startTime;

    // Clean up AI response
    let suggestion = response.content
      .replace(/^(COMPLETION:|Complete this|Here's a completion:)/i, '')
      .replace(/^\s*["']|["']\s*$/g, '')
      .replace(/^\s*[-•]\s*/, '')
      .trim();

    // Validate and fallback if needed
    if (!suggestion || suggestion.length > 100 || suggestion.length < 2) {
      const fallbacks = [
        'and I look forward to your response.',
        'Please let me know if you have any questions.',
        'Thank you for your time.'
      ];
      suggestion = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    // Apply final spell checking
    const correctedSuggestion = correctSpelling(suggestion);

    console.log(`✨ AI suggestion (${responseTime}ms):`, correctedSuggestion);

    res.json({
      success: true,
      suggestions: [correctedSuggestion],
      source: 'ai',
      model: 'gemma2:2b',
      responseTime: `${responseTime}ms`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('AI suggestion error:', error);

    // Provide fallback suggestions with spell checking
    const fallbackSuggestions = [
      'and I look forward to hearing from you.',
      'Please feel free to reach out with any questions.',
      'Thank you for your consideration.'
    ];

    const correctedFallbacks = fallbackSuggestions
      .slice(0, maxSuggestions)
      .map(suggestion => correctSpelling(suggestion));

    res.json({
      success: true,
      suggestions: correctedFallbacks,
      source: 'fallback',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;

