import { apiFetch } from './apiClient'

export async function summarizeThread(subject, messages) {
  const res = await apiFetch('/ai/summarize', {
    method: 'POST',
    body: { subject, messages }
  })
  return res.summary
}

export async function suggestReplies(subject, lastMessage, { tone = 'neutral' } = {}) {
  const res = await apiFetch('/ai/suggest-replies', {
    method: 'POST',
    body: { subject, lastMessage, tone }
  })
  return res.suggestions
}

