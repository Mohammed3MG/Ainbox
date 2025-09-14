(() => {
  const out = document.getElementById('out');
  const btn = document.getElementById('detect');
  const emailEl = document.getElementById('email');

  if (!btn) return;

  btn.addEventListener('click', async () => {
    const email = emailEl.value.trim();
    out.textContent = '';
    if (!email || !email.includes('@')) {
      out.textContent = 'Please enter a valid email.';
      return;
    }
    btn.disabled = true; btn.textContent = 'Detecting...';
    try {
      const resp = await fetch('/other/detect?email=' + encodeURIComponent(email));
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || 'Detection failed');
      out.innerHTML = 'Detected provider for <code>' + email + '</code>: <strong>' + json.provider + '</strong>'
        + '<br/>' + (json.note || '');
    } catch (e) {
      out.textContent = 'Detection error: ' + (e && e.message ? e.message : e);
    } finally {
      btn.disabled = false; btn.textContent = 'Detect Provider';
    }
  });
})();

