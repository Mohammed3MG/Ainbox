import { apiFetch } from './apiClient'

export async function summarizeThread(subject, messages) {
  const res = await apiFetch('/ai/summarize', {
    method: 'POST',
    body: { subject, messages }
  })
  return res.summary
}

export async function suggestReplies(subject, lastMessage, { tone = 'neutral', fullThread = [], currentUserEmail = '' } = {}) {
  const res = await apiFetch('/ai/suggest-replies', {
    method: 'POST',
    body: {
      subject,
      lastMessage,
      tone,
      fullThread,
      currentUserEmail
    }
  })
  return res.suggestions
}

