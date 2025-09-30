import { useState, useEffect, useCallback } from 'react';

const useNotifications = () => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchNotifications = useCallback(async (unreadOnly = false) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/notifications?unreadOnly=${unreadOnly}`,
        {
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) throw new Error('Failed to fetch notifications');

      const data = await response.json();
      setNotifications(data.notifications || []);
    } catch (err) {
      setError(err.message);
      console.error('Error fetching notifications:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications/count?unreadOnly=true', {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setUnreadCount(data.count || 0);
      }
    } catch (err) {
      console.error('Error fetching notification count:', err);
    }
  }, []);

  const markAsRead = useCallback(async (notificationId) => {
    try {
      const response = await fetch(`/api/notifications/${notificationId}/read`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) throw new Error('Failed to mark notification as read');

      // Update local state
      setNotifications(prev =>
        prev.map(notification =>
          notification.id === notificationId
            ? { ...notification, is_read: true, read_at: new Date().toISOString() }
            : notification
        )
      );

      // Update unread count
      fetchUnreadCount();

      return true;
    } catch (err) {
      setError(err.message);
      console.error('Error marking notification as read:', err);
      return false;
    }
  }, [fetchUnreadCount]);

  const markAllAsRead = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications/mark-all-read', {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) throw new Error('Failed to mark all notifications as read');

      // Update local state
      setNotifications(prev =>
        prev.map(notification => ({
          ...notification,
          is_read: true,
          read_at: new Date().toISOString()
        }))
      );

      setUnreadCount(0);
      return true;
    } catch (err) {
      setError(err.message);
      console.error('Error marking all notifications as read:', err);
      return false;
    }
  }, []);

  const handleRSVP = useCallback(async (token, response, attendeeName = null) => {
    try {
      const res = await fetch(`/api/notifications/rsvp/${token}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ response, attendeeName })
      });

      if (!res.ok) throw new Error('Failed to submit RSVP response');

      const data = await res.json();

      // Refresh notifications after RSVP
      fetchNotifications();
      fetchUnreadCount();

      return data;
    } catch (err) {
      setError(err.message);
      console.error('Error handling RSVP:', err);
      throw err;
    }
  }, [fetchNotifications, fetchUnreadCount]);

  // Auto-refresh unread count every 30 seconds
  useEffect(() => {
    fetchUnreadCount();

    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  return {
    notifications,
    unreadCount,
    loading,
    error,
    fetchNotifications,
    fetchUnreadCount,
    markAsRead,
    markAllAsRead,
    handleRSVP,
    refresh: useCallback(() => {
      fetchNotifications();
      fetchUnreadCount();
    }, [fetchNotifications, fetchUnreadCount])
  };
};

export default useNotifications;