// Read/unread override state to make UI instant. Uses Redis if available,
// falls back to in-memory Maps.
let redis = null; let enabled = false;
try {
  if (process.env.REDIS_URL) {
    const { createClient } = require('redis');
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on('error', () => {});
    redis.connect().then(() => { enabled = true; }).catch(() => { enabled = false; });
  }
} catch (_) {}

const mem = {
  read: new Map(),   // key -> Set(ids)
  unread: new Map(), // key -> Set(ids)
};

function keyFor(userId, provider, type) {
  return `ainbox:override:${type}:${userId}:${provider}`; // type: read|unread
}

function unreadKey(userId, provider) {
  return `ainbox:unread:${userId}:${provider}`;
}

async function addToSet(k, id) {
  if (enabled && redis) return redis.sAdd(k, String(id));
  const set = mem.read.get(k) || new Set();
  set.add(String(id));
  mem.read.set(k, set);
}

async function removeFromSet(k, id) {
  if (enabled && redis) return redis.sRem(k, String(id));
  const set = mem.read.get(k);
  if (set) set.delete(String(id));
}

async function members(k) {
  if (enabled && redis) return (await redis.sMembers(k)) || [];
  const set = mem.read.get(k);
  return set ? Array.from(set) : [];
}

async function size(k) {
  if (enabled && redis) return redis.sCard(k);
  const set = mem.read.get(k);
  return set ? set.size : 0;
}

async function setOverride(userId, provider, id, state /* 'read'|'unread' */) {
  const rKey = keyFor(userId, provider, 'read');
  const uKey = keyFor(userId, provider, 'unread');
  if (state === 'read') {
    await addToSet(rKey, id);
    await removeFromSet(uKey, id);
  } else if (state === 'unread') {
    await addToSet(uKey, id);
    await removeFromSet(rKey, id);
  }
}

async function clearOverride(userId, provider, id) {
  await removeFromSet(keyFor(userId, provider, 'read'), id);
  await removeFromSet(keyFor(userId, provider, 'unread'), id);
}

async function getOverride(userId, provider, id) {
  const rKey = keyFor(userId, provider, 'read');
  const uKey = keyFor(userId, provider, 'unread');
  const sid = String(id);
  if (enabled && redis) {
    const [inRead, inUnread] = await Promise.all([
      redis.sIsMember(rKey, sid),
      redis.sIsMember(uKey, sid),
    ]);
    if (inRead) return 'read';
    if (inUnread) return 'unread';
    return null;
  }
  const r = mem.read.get(rKey); if (r && r.has(sid)) return 'read';
  const u = mem.read.get(uKey); if (u && u.has(sid)) return 'unread';
  return null;
}

async function deltaCounts(userId, provider) {
  const r = await size(keyFor(userId, provider, 'read'));
  const u = await size(keyFor(userId, provider, 'unread'));
  return { forceRead: r, forceUnread: u };
}

module.exports = {
  setOverride,
  clearOverride,
  getOverride,
  deltaCounts,
  // Unread set helpers
  async addUnread(userId, provider, id) {
    const k = unreadKey(userId, provider);
    const sid = String(id);
    if (enabled && redis) return redis.sAdd(k, sid);
    const set = mem.unread.get(k) || new Set();
    set.add(sid); mem.unread.set(k, set);
  },
  async removeUnread(userId, provider, id) {
    const k = unreadKey(userId, provider);
    const sid = String(id);
    if (enabled && redis) return redis.sRem(k, sid);
    const set = mem.unread.get(k); if (set) set.delete(sid);
  },
  async unreadCount(userId, provider) {
    const k = unreadKey(userId, provider);
    if (enabled && redis) return (await redis.sCard(k)) || 0;
    const set = mem.unread.get(k); return set ? set.size : 0;
  },
};
