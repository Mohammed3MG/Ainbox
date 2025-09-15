import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getSession } from '../../services/sessionApi';

export const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [state, setState] = useState({
    loading: true,
    user: null,
    terms: { required: false, version: null, acceptedAt: null },
    error: null,
  });

  const refresh = useCallback(async () => {
    try {
      setState((s) => ({ ...s, loading: true, error: null }));
      const data = await getSession();
      setState({ loading: false, user: data.user, terms: data.terms, error: null });
    } catch (e) {
      setState({ loading: false, user: null, terms: { required: false, version: null, acceptedAt: null }, error: e });
    }
  }, []);

  // initial load
  useEffect(() => { refresh(); }, [refresh]);

  const markTermsAccepted = useCallback(() => {
    setState((s) => ({
      ...s,
      terms: { required: false, version: s.terms?.version || null, acceptedAt: new Date().toISOString() },
    }));
  }, []);

  const value = { ...state, refresh, markTermsAccepted };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionContext() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSessionContext must be used within SessionProvider');
  return ctx;
}

