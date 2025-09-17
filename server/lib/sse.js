// Minimal SSE client registry and broadcaster
const clients = new Map(); // userId -> Set<res>

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
  const set = clients.get(uid);
  if (!set) return 0;
  for (const res of set) send(res, data);
  return set.size;
}

function broadcastAll(data) {
  let count = 0;
  for (const [, set] of clients) {
    for (const res of set) { send(res, data); count++; }
  }
  return count;
}

module.exports = { addClient, removeClient, broadcastToUser, broadcastAll };

