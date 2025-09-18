const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { chat } = require('../lib/ollama');
const { summarizePrompt, suggestRepliesPrompt } = require('../prompts/email');

const router = express.Router();

// Summarize an email thread
// POST /ai/summarize { subject, messages: [{ from, date, html, text }] }
router.post('/ai/summarize', requireAuth, async (req, res) => {
  try {
    const { subject, messages = [], tone } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages are required' });
    }
    const prompt = summarizePrompt(subject, messages);
    const out = await chat(prompt, { options: { temperature: 0.2 } });
    return res.json({ summary: out.content });
  } catch (e) {
    console.error('AI summarize failed:', e?.message);
    return res.status(500).json({ error: 'summarize_failed' });
  }
});

// Suggest replies for latest message
// POST /ai/suggest-replies { subject, lastMessage: { html, text }, tone }
router.post('/ai/suggest-replies', requireAuth, async (req, res) => {
  try {
    const { subject, lastMessage = null, tone = 'neutral' } = req.body || {};
    if (!lastMessage) return res.status(400).json({ error: 'lastMessage required' });
    const prompt = suggestRepliesPrompt(subject, lastMessage, { tone });
    const out = await chat(prompt, { options: { temperature: 0.4 } });
    return res.json({ suggestions: out.content });
  } catch (e) {
    console.error('AI suggest failed:', e?.message);
    return res.status(500).json({ error: 'suggest_failed' });
  }
});

module.exports = router;

