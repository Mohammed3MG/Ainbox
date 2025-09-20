const { broadcastToUser } = require('./sse');
const { ensureMsAccessToken } = require('../utils/outlookClient');

async function httpGet(url, accessToken, extraHeaders = {}) {
  const headers = { Authorization: `Bearer ${accessToken}`, ...extraHeaders };
  if (typeof fetch === 'function') return fetch(url, { headers });
  const fetch2 = (await import('node-fetch')).default;
  return fetch2(url, { headers });
}

class OutlookSyncService {
  constructor() {
    this.active = new Map(); // userId -> { cookies, lastSync, seen:Set }
    this.intervals = new Map(); // userId -> intervalId
  }

  async startSyncForUser(userId, cookies) {
    if (this.active.has(userId)) return;
    this.active.set(userId, { cookies, lastSync: 0, seen: new Set() });
    const interval = setInterval(() => this.poll(userId).catch(() => {}), 7000);
    this.intervals.set(userId, interval);
    await this.poll(userId).catch(() => {});
    console.log(`✅ Outlook sync started for user ${userId}`);
  }

  stopSyncForUser(userId) {
    if (this.intervals.has(userId)) {
      clearInterval(this.intervals.get(userId));
      this.intervals.delete(userId);
    }
    this.active.delete(userId);
  }

  async poll(userId) {
    const state = this.active.get(userId);
    if (!state) return;
    // Minimal req/res stubs for token refresh path
    const req = { cookies: state.cookies, auth: { sub: userId } };
    const res = { cookie: () => {} };
    const token = await ensureMsAccessToken(req, res);

    const url = "https://graph.microsoft.com/v1.0/me/messages?$select=id,conversationId,subject,from,receivedDateTime,isRead,bodyPreview,hasAttachments,importance&$filter=parentFolderId eq 'Inbox' and inferenceClassification eq 'focused'&$orderby=receivedDateTime desc&$top=5";
    const resp = await httpGet(url, token, { 'ConsistencyLevel': 'eventual' });
    if (!resp.ok) return;
    const json = await resp.json();
    const items = Array.isArray(json.value) ? json.value : [];
    const seen = state.seen;

    for (const m of items) {
      const convId = m.conversationId || m.id;
      if (!seen.has(convId)) {
        seen.add(convId);
        const fromAddr = m.from?.emailAddress?.address || '';
        const fromName = m.from?.emailAddress?.name || '';
        const from = fromName ? `${fromName} <${fromAddr}>` : fromAddr;
        const time = new Date(m.receivedDateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const email = {
          id: convId,
          threadId: convId,
          messageId: m.id,
          from,
          subject: m.subject || '(No Subject)',
          preview: m.bodyPreview || '',
          date: m.receivedDateTime,
          time,
          isRead: !!m.isRead,
          isStarred: m.importance === 'high',
          hasAttachment: !!m.hasAttachments,
          labels: ['general']
        };
        broadcastToUser(userId, { type: 'new_email', email });
      }
    }

    state.lastSync = Date.now();
    this.active.set(userId, state);
  }
}

module.exports = new OutlookSyncService();

