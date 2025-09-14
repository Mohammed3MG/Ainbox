(() => {
  const script = document.currentScript;
  const folder = decodeURIComponent(script.getAttribute('data-folder') || 'inbox');
  const listDiv = document.getElementById('list');

  async function load() {
    try {
      const unreadOnly = folder.toLowerCase() === 'unread';
      const f = unreadOnly ? 'inbox' : folder;
      const resp = await fetch(`/other/list?folder=${encodeURIComponent(f)}&unreadOnly=${unreadOnly}&limit=50`);
      const json = await resp.json();
      if (!resp.ok) {
        const reason = json && json.reason ? ` (${json.reason})` : '';
        throw new Error((json && json.error) ? json.error + reason : 'Failed to load folder');
      }
      const rows = json.items || [];
      if (!rows.length) { listDiv.textContent = 'No messages.'; return; }
      const lines = [];
      lines.push('<table><thead><tr><th>Date</th><th>From</th><th>To</th><th>Subject</th><th>Status</th></tr></thead><tbody>');
      for (const m of rows) {
        const d = m.date ? new Date(m.date).toLocaleString() : '';
        lines.push(`<tr><td>${d}</td><td>${m.from || ''}</td><td>${m.to || ''}</td><td>${escapeHtml(m.subject || '')}</td><td>${m.seen ? '' : 'Unread'}</td></tr>`);
      }
      lines.push('</tbody></table>');
      listDiv.innerHTML = lines.join('');
    } catch (e) {
      listDiv.textContent = 'Error: ' + (e.message || e);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  }

  load();
})();
