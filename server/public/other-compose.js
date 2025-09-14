(() => {
  const $ = (id) => document.getElementById(id);
  const toEl = $('to');
  const subjectEl = $('subject');
  const textEl = $('text');
  const htmlEl = $('html');
  const filesEl = $('files');
  const out = $('out');
  const btn = $('send');
  const saveBtn = document.getElementById('saveDraft');
  let draftUid = null;
  let autosaveTimer = null;
  let lastAutosavePayload = '';

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read ' + file.name));
      reader.onload = () => {
        // result can be ArrayBuffer or DataURL depending on method
        const res = reader.result;
        if (typeof res === 'string' && res.startsWith('data:')) {
          const comma = res.indexOf(',');
          const base64 = res.slice(comma + 1);
          resolve({
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            data: base64,
          });
        } else if (res instanceof ArrayBuffer) {
          const base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(res)));
          resolve({
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            data: base64,
          });
        } else {
          reject(new Error('Unsupported FileReader result'));
        }
      };
      // Use DataURL to avoid manual encoding
      reader.readAsDataURL(file);
    });
  }

  async function sendNow() {
    out.textContent = '';
    const files = Array.from(filesEl.files || []);
    let attachments = [];
    if (files.length) {
      try { attachments = await Promise.all(files.map(readFileAsBase64)); }
      catch (err) { out.textContent = 'Attachment error: ' + (err.message || err); return; }
    }
    const body = {
      to: toEl.value.trim(),
      subject: subjectEl.value,
      text: textEl.value,
      html: htmlEl.value,
      attachments,
      draftUid: draftUid || undefined,
    };
    if (!body.to) { out.textContent = 'To is required'; return; }
    btn.disabled = true; btn.textContent = 'Sending...';
    try {
      const resp = await fetch('/other/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || 'Send failed');
      out.textContent = 'Sent! Message-ID: ' + json.messageId;
    } catch (e2) {
      out.textContent = 'Error: ' + (e2.message || e2);
    } finally {
      btn.disabled = false; btn.textContent = 'Send';
    }
  }

  async function saveDraftNow(includeFiles) {
    out.textContent = '';
    const files = includeFiles ? Array.from(filesEl.files || []) : [];
    let attachments = [];
    if (files.length) {
      try { attachments = await Promise.all(files.map(readFileAsBase64)); }
      catch (e) { out.textContent = 'Attachment error: ' + (e.message || e); return; }
    }
    const body = {
      to: toEl.value.trim(),
      subject: subjectEl.value,
      text: textEl.value,
      html: htmlEl.value,
      attachments,
      prevUid: draftUid || undefined,
    };
    try {
      const resp = await fetch('/other/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || 'Save draft failed');
      draftUid = json.uid || draftUid;
      out.textContent = 'Draft saved to ' + (json.mailbox || 'Drafts');
    } catch (e) {
      out.textContent = 'Error: ' + (e.message || e);
    }
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', () => saveDraftNow(true));
  }

  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(doAutosave, 5000); // debounce 5s after last change
  }

  async function doAutosave() {
    try {
      const payload = JSON.stringify({
        to: toEl.value.trim(),
        subject: subjectEl.value,
        text: textEl.value,
        html: htmlEl.value,
      });
      if (payload === lastAutosavePayload) return; // no changes
      lastAutosavePayload = payload;
      await saveDraftNow(false);
      if (draftUid) {
        out.textContent = 'Draft auto-saved';
        setTimeout(() => { if (out.textContent === 'Draft auto-saved') out.textContent = ''; }, 1500);
      }
    } catch (_) { /* ignore autosave errors */ }
  }

  // Trigger autosave on edits
  ['to','subject','text','html'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('input', scheduleAutosave);
  });
  // When files change, save immediately including attachments
  if (filesEl) filesEl.addEventListener('change', () => saveDraftNow(true));

  // Autosave when tab is hidden or user navigates away
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveDraftNow(false);
    }
  });
  window.addEventListener('beforeunload', (e) => {
    // Schedule a last autosave; keepalive true helps but is best-effort
    saveDraftNow(false);
  });

  btn.addEventListener('click', (e) => { e.preventDefault(); sendNow(); });
})();
