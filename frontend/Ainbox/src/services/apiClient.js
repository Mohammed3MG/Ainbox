import { API_BASE_URL } from '../config';

function buildUrl(path) {
  if (/^https?:\/\//i.test(path)) return path; // already absolute
  const base = API_BASE_URL.replace(/\/$/, '');
  const p = String(path || '').startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

export async function apiFetch(path, { method = 'GET', headers = {}, body } = {}) {
  const url = buildUrl(path);
  const res = await fetch(url, {
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
