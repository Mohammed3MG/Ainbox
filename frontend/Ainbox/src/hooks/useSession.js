import { useContext } from 'react';
import { SessionContext } from '../components/session/SessionProvider';

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    // Soft fallback to avoid hard crash if provider not mounted
    return { loading: true, user: null, terms: { required: false, version: null, acceptedAt: null }, error: null, refresh: async () => {} };
  }
  return ctx;
}
