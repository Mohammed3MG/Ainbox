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

module.exports = router;

