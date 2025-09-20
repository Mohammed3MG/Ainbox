// Frontend configuration
// Prefer Vite env var, fallback to local dev server URL
export const API_BASE_URL = (import.meta?.env?.VITE_API_BASE_URL) || 'http://localhost:3002';

