import { apiFetch } from './apiClient';

export async function getSession() {
  const res = await apiFetch('/api/v1/session');
  return res.data;
}

export async function getTerms() {
  const res = await apiFetch('/api/v1/terms');
  return res.data;
}

export async function acceptTerms(version) {
  const res = await apiFetch('/api/v1/terms/accept', { method: 'POST', body: { version } });
  return res.data;
}

export async function logout() {
  // Call server logout to clear cookies and invalidate session
  // Using POST for API-style usage (GET would redirect)
  await apiFetch('/auth/logout', { method: 'POST' });
  return { ok: true };
}
