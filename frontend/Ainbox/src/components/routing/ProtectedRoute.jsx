import { Navigate } from 'react-router-dom';
import { useSession } from '../../hooks/useSession';

export default function ProtectedRoute({ children }) {
  const { loading, user, terms } = useSession();

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

  if (terms?.required) {
    return <Navigate to="/terms" replace />;
  }

  return children;
}

