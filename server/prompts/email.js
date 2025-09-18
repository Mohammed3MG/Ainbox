function summarizePrompt(subject, messages) {
  const clip = (s, n=4000) => (s || '').slice(0, n);
  const body = messages.map((m, i) => `# Message ${i+1} from ${m.from || 'unknown'}\nDate: ${m.date || ''}\n---\n${clip(m.html || m.text || '')}`)
    .join('\n\n');
  return [
    { role: 'system', content: 'You are an expert email assistant. Summarize conversations crisply. Use bullet points, highlight tasks, deadlines, decisions, and next steps. Keep it under 150 words unless asked otherwise.' },
    { role: 'user', content: `Subject: ${subject || '(no subject)'}\n\nConversation:\n${body}\n\nTask: Summarize this thread for a busy professional. Include:\n- One-line executive summary\n- Key points\n- Action items (with owners and due dates if present)\n- Any decisions made`},
  ];
}

function suggestRepliesPrompt(subject, lastMessage, { tone = 'neutral' } = {}) {
  const clip = (s, n=3000) => (s || '').slice(0, n);
  return [
    { role: 'system', content: 'You are an assistant that drafts concise, helpful email replies. Keep tone professional and clear. Offer 2-3 options varying in length and tone when asked.' },
    { role: 'user', content: `Subject: ${subject || '(no subject)'}\n\nLatest message:\n${clip(lastMessage?.html || lastMessage?.text || '')}\n\nTask: Draft 3 reply options. Tone: ${tone}. Keep each under 120 words. Use Markdown with headings "Option 1/2/3".` },
  ];
}

module.exports = { summarizePrompt, suggestRepliesPrompt };

