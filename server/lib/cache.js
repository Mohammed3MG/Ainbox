// Cache with optional Redis backend. Falls back to in-memory if REDIS_URL not set.
let redis = null;
let redisEnabled = false;
try {
  if (process.env.REDIS_URL) {
    // Lazy import to avoid hard dependency
    // eslint-disable-next-line global-require
    const { createClient } = require('redis');
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on('error', () => {});
    // connect, but don't block startup if it fails
    redis.connect().then(() => { redisEnabled = true; }).catch(() => { redisEnabled = false; });
  }
} catch (_) { /* ignore */ }

const store = new Map();

function now() { return Date.now(); }

async function get(key) {
  if (redisEnabled) {
    try {
      const raw = await redis.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { /* fall through */ }
  }
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

async function set(key, value, ttlMs) {
  if (redisEnabled) {
    try {
      const ms = ttlMs ? Math.max(1, Math.floor(ttlMs)) : 0;
      if (ms > 0) await redis.set(key, JSON.stringify(value), { PX: ms });
      else await redis.set(key, JSON.stringify(value));
      return;
    } catch (_) { /* fall through */ }
  }
  const expiresAt = ttlMs ? now() + ttlMs : 0;
  store.set(key, { value, expiresAt });
}

async function del(key) {
  if (redisEnabled) {
    try { await redis.del(key); } catch (_) {}
  }
  store.delete(key);
}

async function wrap(key, ttlMs, loader) {
  const cached = await get(key);
  if (cached !== null && cached !== undefined) return cached;
  const value = await loader();
  await set(key, value, ttlMs);
  return value;
}

module.exports = { get, set, del, wrap };

// Add pattern deletion support for both Redis and in-memory cache
async function delPattern(pattern) {
  // Redis path: use scanIterator to match and delete keys
  if (redisEnabled && redis) {
    try {
      const iter = redis.scanIterator({ MATCH: pattern, COUNT: 100 });
      for await (const key of iter) {
        try { await redis.del(key); } catch (_) {}
      }
      return;
    } catch (_) { /* fall through to in-memory */ }
  }
  // In-memory path: delete keys matching simple glob pattern (*)
  const regex = globToRegExp(pattern);
  for (const key of store.keys()) {
    if (regex.test(key)) {
      store.delete(key);
    }
  }
}

function globToRegExp(glob) {
  const escaped = String(glob)
    .replace(/[.+^${}()|\[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

module.exports.delPattern = delPattern;
