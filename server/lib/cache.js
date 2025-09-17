// Simple in-memory cache with TTL; swap with Redis later via same interface
const store = new Map();

function now() { return Date.now(); }

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value, ttlMs) {
  const expiresAt = ttlMs ? now() + ttlMs : 0;
  store.set(key, { value, expiresAt });
}

function del(key) {
  store.delete(key);
}

async function wrap(key, ttlMs, loader) {
  const cached = get(key);
  if (cached !== null && cached !== undefined) return cached;
  const value = await loader();
  set(key, value, ttlMs);
  return value;
}

module.exports = { get, set, del, wrap };

