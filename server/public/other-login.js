(() => {
  const $ = (id) => document.getElementById(id);
  const emailEl = $('email');
  const usernameEl = $('username');
  const passwordEl = $('password');
  const modeEl = $('mode');
  const imapSection = $('imapSection');
  const ewsSection = $('ewsSection');
  const out = $('out');

  const imapHostEl = $('imapHost');
  const imapPortEl = $('imapPort');
  const imapSecureEl = $('imapSecure');
  const smtpHostEl = $('smtpHost');
  const smtpPortEl = $('smtpPort');
  const smtpSecureEl = $('smtpSecure');

  const ewsUrlEl = $('ewsUrl');
  const ewsInsecureEl = $('ewsInsecure');

  function updateSections() {
    const v = modeEl.value;
    imapSection.style.display = (v === 'imap') ? '' : 'none';
    ewsSection.style.display = (v === 'ews') ? '' : 'none';
  }

  modeEl.addEventListener('change', () => updateSections());
  updateSections();

  $('suggest').addEventListener('click', async () => {
    const email = emailEl.value.trim();
    out.textContent = '';
    if (!email || !email.includes('@')) { out.textContent = 'Enter a valid email'; return; }
    try {
      const resp = await fetch('/other/suggest?email=' + encodeURIComponent(email));
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || 'Suggest failed');
      if (json.provider === 'EWS') modeEl.value = 'ews'; else modeEl.value = 'imap';
      updateSections();
      if (json.imap) {
        imapHostEl.value = json.imap.host;
        imapPortEl.value = json.imap.port;
        imapSecureEl.value = String(json.imap.secure);
      }
      if (json.smtp) {
        smtpHostEl.value = json.smtp.host;
        smtpPortEl.value = json.smtp.port;
        smtpSecureEl.value = String(json.smtp.secure);
      }
      if (json.ews) {
        ewsUrlEl.value = json.ews.url;
      }
      out.textContent = 'Suggested ' + json.provider + ' settings filled.';
    } catch (e) {
      out.textContent = 'Suggest error: ' + (e.message || e);
    }
  });

  $('login').addEventListener('click', async () => {
    const email = emailEl.value.trim();
    const username = usernameEl.value.trim();
    const password = passwordEl.value;
    const mode = modeEl.value;
    out.textContent = '';
    if (!email || !email.includes('@')) { out.textContent = 'Enter a valid email'; return; }
    if (!password) { out.textContent = 'Enter your password or app password'; return; }
    const body = { email, username, password, mode };
    if (mode === 'imap') {
      body.imap = { host: imapHostEl.value.trim(), port: Number(imapPortEl.value || 993), secure: imapSecureEl.value === 'true' };
      body.smtp = { host: smtpHostEl.value.trim(), port: Number(smtpPortEl.value || 465), secure: smtpSecureEl.value === 'true' };
    }
    if (mode === 'ews') {
      body.ews = { url: ewsUrlEl.value.trim(), insecure: ewsInsecureEl.value === 'true' };
    }
    const btn = $('login');
    btn.disabled = true; btn.textContent = 'Verifying...';
    try {
      const resp = await fetch('/other/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await resp.json();
      if (!resp.ok) {
        const reason = json && json.reason ? (' - ' + json.reason) : '';
        throw new Error((json && json.error ? json.error : 'Login failed') + reason);
      }
      // Redirect to dashboard
      window.location.href = '/other/me';
    } catch (e) {
      out.textContent = 'Login error: ' + (e.message || e);
    } finally {
      btn.disabled = false; btn.textContent = 'Test & Save';
    }
  });
})();
