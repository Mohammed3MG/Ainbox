import { useEffect, useState } from 'react';
import { getSession } from '../services/sessionApi';

export function useSession() {
  const [state, setState] = useState({ loading: true, user: null, terms: { required: false, version: null, acceptedAt: null }, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getSession();
        if (!cancelled) setState({ loading: false, user: data.user, terms: data.terms, error: null });
      } catch (e) {
        if (!cancelled) setState({ loading: false, user: null, terms: { required: false, version: null, acceptedAt: null }, error: e });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}

