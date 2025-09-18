// SSE broadcaster with optional Redis Pub/Sub to scale across replicas
const clients = new Map(); // userId -> Set<res>
let pub = null; let sub = null; let redisEnabled = false;
try {
  if (process.env.REDIS_URL) {
    const { createClient } = require('redis');
    pub = createClient({ url: process.env.REDIS_URL });
    sub = createClient({ url: process.env.REDIS_URL });
    pub.connect().catch(() => {});
    sub.connect().then(() => {
      redisEnabled = true;
      // subscribe per-user via pattern
      sub.pSubscribe('sse:user:*', (message, channel) => {
        try {
          const uid = channel.split(':').pop();
          const data = JSON.parse(message);
          const set = clients.get(String(uid));
          if (!set) return;
          for (const res of set) send(res, data);
        } catch (_) {}
      });
      sub.pSubscribe('sse:all', (message) => {
        try {
          const data = JSON.parse(message);
          for (const [, set] of clients) { for (const res of set) send(res, data); }
        } catch (_) {}
      });
    }).catch(() => {});
  }
} catch (_) { /* ignore */ }

function addClient(userId, res) {
  const uid = String(userId);
  let set = clients.get(uid);
  if (!set) { set = new Set(); clients.set(uid, set); }
  set.add(res);
}

function removeClient(userId, res) {
  const uid = String(userId);
  const set = clients.get(uid);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(uid);
}

function send(res, data) {
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (_) {}
}

function broadcastToUser(userId, data) {
  const uid = String(userId);
  if (redisEnabled && pub) {
    try { pub.publish(`sse:user:${uid}`, JSON.stringify(data)); } catch (_) {}
  }
  const set = clients.get(uid);
  if (!set) return 0;
  for (const res of set) send(res, data);
  return set.size;
}

function broadcastAll(data) {
  if (redisEnabled && pub) {
    try { pub.publish('sse:all', JSON.stringify(data)); } catch (_) {}
  }
  let count = 0;
  for (const [, set] of clients) {
    for (const res of set) { send(res, data); count++; }
  }
  return count;
}

module.exports = { addClient, removeClient, broadcastToUser, broadcastAll };
