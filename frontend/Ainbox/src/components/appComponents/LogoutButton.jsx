import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { logout } from '../../services/sessionApi';
import { Button } from '../ui/button';

export default function LogoutButton() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function onLogout() {
    try {
      setLoading(true);
      await logout();
      navigate('/', { replace: true });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={onLogout} disabled={loading}>
      {loading ? 'Signing out…' : 'Logout'}
    </Button>
  );
}

