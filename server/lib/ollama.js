const DEFAULT_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3';

async function fetchCompat(url, opts) {
  if (typeof fetch === 'function') return fetch(url, opts);
  const fetch2 = (await import('node-fetch')).default;
  return fetch2(url, opts);
}

async function chat(messages, { model = DEFAULT_MODEL, options = {} } = {}) {
  const url = `${DEFAULT_ENDPOINT.replace(/\/$/, '')}/api/chat`;
  const body = {
    model,
    messages,
    stream: false,
    options: {
      temperature: 0.3,
      num_ctx: 4096,
      ...options,
    },
  };
  const res = await fetchCompat(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let text = '';
    try { text = await res.text(); } catch (_) {}
    const err = new Error(`Ollama chat failed: HTTP ${res.status}`);
    err.details = text;
    throw err;
  }
  const json = await res.json();
  const content = json?.message?.content || '';
  return { content, raw: json };
}

module.exports = { chat };
