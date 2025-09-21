const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { chat } = require('../lib/ollama');
const { summarizePrompt, suggestRepliesPrompt } = require('../prompts/email');
const emailCache = require('../lib/emailCache');

const router = express.Router();

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
      return res.json({ summary: cached });
    }

    console.log('🤖 Generating new AI summary');
    const prompt = summarizePrompt(subject, messages);
    const out = await chat(prompt, { options: { temperature: 0.2 } });

    // Cache the response
    await emailCache.setAISummary(messageId, messagesContent, out.content);
    console.log('💾 Cached AI summary');

    return res.json({ summary: out.content });
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
      return res.json({ suggestions: cached });
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

    // Cache the response
    await emailCache.setAIReplies(messageId, content, tone, out.content);
    console.log('💾 Cached AI reply suggestions');

    return res.json({ suggestions: out.content });
  } catch (e) {
    console.error('AI suggest failed:', e?.message);
    return res.status(500).json({ error: 'suggest_failed' });
  }
});

// Generate email content using Ollama
router.post('/ai/generate-email', async (req, res) => {
  const { prompt } = req.body;

  try {

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Create an optimized prompt for tinyllama
    const fullPrompt = `You are an expert email writer. Write a SHORT, CLEAR, and PROFESSIONAL email.

USER REQUEST: "${prompt}"

RULES:
1. Write ONLY the email body (no subject line)
2. Keep it SHORT - maximum 3-4 sentences
3. Use simple, clear language
4. Be polite and professional
5. Start with proper greeting (Dear [Name] or Hi [Name])
6. End with appropriate closing (Best regards, Thank you, etc.)
7. Stay focused on the main request
8. Be ethical and respectful

WRITE THE EMAIL NOW:`;

    console.log('🤖 Generating email with AI using tinyllama');

    // Use the proper Ollama chat helper
    const messages = [
      {
        role: 'user',
        content: fullPrompt
      }
    ];

    const out = await chat(messages, {
      model: 'gemma2:2b',
      options: {
        temperature: 0.3,  // Lower temperature for more focused responses
        num_predict: 150,  // Shorter responses (150 tokens max)
        top_p: 0.9,       // Focus on most likely words
        stop: ['USER:', 'RULES:', 'Human:', 'Assistant:', '\n\n\n']  // Stop tokens
      }
    });

    // Clean up the generated text for tinyllama
    let cleanedText = out.content
      .replace(/^(WRITE THE EMAIL NOW:|Email content:|Email:|Dear Sir\/Madam,?\s*)/i, '')
      .replace(/^\s*[\*\-•]\s*/gm, '') // Remove bullet points
      .replace(/^(Here is|Here's|Below is).*?:\s*/i, '') // Remove intro phrases
      .replace(/\n\s*\n\s*\n/g, '\n\n') // Fix excessive line breaks
      .replace(/^Dear\s*,\s*/i, 'Dear [Name],\n\n') // Fix empty greeting
      .trim();

    // Ensure proper greeting
    if (!cleanedText.match(/^(Dear|Hi|Hello|Good morning|Good afternoon)/i)) {
      cleanedText = 'Dear [Name],\n\n' + cleanedText;
    }

    // Ensure proper closing
    if (!cleanedText.match(/(Best regards|Sincerely|Thank you|Best|Regards),?\s*$/i)) {
      cleanedText = cleanedText + '\n\nBest regards,';
    }

    res.json({
      email: cleanedText,
      model: 'gemma2:2b',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('AI email generation error:', error);

    // NO FALLBACK - Only real AI responses allowed
    console.log('❌ Ollama failed - returning error instead of fallback template');

    return res.status(500).json({
      error: 'AI generation failed',
      details: error.message,
      note: 'Ollama connection issue. Please check if Ollama is running and the model is available.'
    });
  }
});

module.exports = router;

