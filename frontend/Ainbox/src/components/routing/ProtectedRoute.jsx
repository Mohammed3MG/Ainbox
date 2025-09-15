import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '../../hooks/useSession';

export default function ProtectedRoute({ children }) {
  const { loading, user, terms } = useSession();
  const location = useLocation();

  if (loading) {
    return (
      <div className="w-full h-screen flex items-center justify-center text-slate-300">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (terms?.required && location.pathname !== '/terms') {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/terms" replace state={{ from }} />;
  }

  // If terms already accepted, block access to /terms
  if (!terms?.required && location.pathname === '/terms') {
    const to = (location.state && location.state.from && location.state.from !== '/terms') ? location.state.from : '/dashboard';
    return <Navigate to={to} replace />;
  }

  return children;
}
