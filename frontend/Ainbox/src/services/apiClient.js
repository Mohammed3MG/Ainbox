export async function apiFetch(path, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });
  // Try to parse JSON; fall back to status only
  let json = null;
  try { json = await res.json(); } catch (_) { /* ignore */ }
  if (!res.ok) {
    const err = new Error(json?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

