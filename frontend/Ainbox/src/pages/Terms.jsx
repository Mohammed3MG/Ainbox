import { useEffect, useState } from 'react';
import { acceptTerms, getTerms } from '../services/sessionApi';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../hooks/useSession';

export default function Terms() {
  const [meta, setMeta] = useState({ version: 'v1', title: 'Terms of Use', htmlUrl: null, mdUrl: null });
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { refresh, markTermsAccepted } = useSession() || {};

  useEffect(() => {
    (async () => {
      try { const m = await getTerms(); setMeta(m); } catch (_) { /* ignore */ }
    })();
  }, []);

  async function onAccept() {
    try {
      setSubmitting(true);
      await acceptTerms(meta.version);
      // Update client session quickly to avoid guard bounce
      if (typeof markTermsAccepted === 'function') markTermsAccepted();
      if (typeof refresh === 'function') await refresh();
      navigate('/dashboard', { replace: true });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-950 text-slate-100 px-4">
      <div className="max-w-3xl w-full">
        <h1 className="text-3xl font-bold mb-4">{meta.title}</h1>
        <p className="text-slate-300 mb-2">Version: {meta.version}</p>
        {meta.htmlUrl || meta.mdUrl ? (
          <p className="mb-6 text-slate-300">
            Read the full terms at{' '}
            {meta.htmlUrl ? <a className="text-sky-400 underline" href={meta.htmlUrl} target="_blank" rel="noreferrer">HTML</a> : null}
            {meta.htmlUrl && meta.mdUrl ? ' or ' : ''}
            {meta.mdUrl ? <a className="text-sky-400 underline" href={meta.mdUrl} target="_blank" rel="noreferrer">Markdown</a> : null}.
          </p>
        ) : (
          <p className="mb-6 text-slate-300">Please review our Terms of Use. By continuing you agree to be bound by them.</p>
        )}
        <div className="flex gap-3">
          <button disabled={submitting} onClick={onAccept} className="rounded-lg border px-6 py-2 font-medium border-slate-700 bg-slate-800 hover:bg-slate-700 disabled:opacity-50">
            {submitting ? 'Saving…' : 'I Accept'}
          </button>
          <a href="/" className="rounded-lg border px-6 py-2 font-medium border-slate-700">Cancel</a>
        </div>
      </div>
    </div>
  );
}
