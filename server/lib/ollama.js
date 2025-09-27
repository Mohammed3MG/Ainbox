const DEFAULT_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3';

async function fetchCompat(url, opts) {
  if (typeof fetch === 'function') return fetch(url, opts);
  const fetch2 = (await import('node-fetch')).default;
  return fetch2(url, opts);
}

async function chat(messages, { model = DEFAULT_MODEL, options = {}, stream = false } = {}) {
  const url = `${DEFAULT_ENDPOINT.replace(/\/$/, '')}/api/chat`;
  const body = {
    model,
    messages,
    stream,
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

  if (stream) {
    // Return an async generator for streaming
    return streamResponse(res);
  } else {
    const json = await res.json();
    const content = json?.message?.content || '';
    return { content, raw: json };
  }
}

async function* streamResponse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Process any remaining data in buffer
        if (buffer.trim()) {
          try {
            const json = JSON.parse(buffer);
            yield json;
          } catch (e) {
            console.warn('Failed to parse final chunk:', buffer);
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Split by newlines and process complete JSON objects
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          try {
            const json = JSON.parse(trimmed);
            yield json;
          } catch (e) {
            console.warn('Failed to parse JSON chunk:', trimmed);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

module.exports = { chat };
