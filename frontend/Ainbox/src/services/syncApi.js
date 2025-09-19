// Gmail synchronization API service
const API_BASE = process.env.NODE_ENV === 'production'
  ? 'https://yourdomain.com'
  : 'http://localhost:3000';

class GmailSyncService {
  constructor() {
    this.isConnected = false;
    this.eventSource = null;
    this.listeners = new Map();
  }

  // Start Gmail sync for current user
  async startSync() {
    try {
      const response = await fetch(`${API_BASE}/sync/gmail/start`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to start sync: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('📡 Gmail sync started:', result);

      // Start listening for real-time updates
      this.connectToSSE();

      return result;
    } catch (error) {
      console.error('❌ Failed to start Gmail sync:', error);
      throw error;
    }
  }

  // Stop Gmail sync
  async stopSync() {
    try {
      const response = await fetch(`${API_BASE}/sync/gmail/stop`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to stop sync: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('🛑 Gmail sync stopped:', result);

      // Disconnect SSE
      this.disconnectFromSSE();

      return result;
    } catch (error) {
      console.error('❌ Failed to stop Gmail sync:', error);
      throw error;
    }
  }

  // Get sync status
  async getSyncStatus() {
    try {
      const response = await fetch(`${API_BASE}/sync/gmail/status`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get sync status: ${response.statusText}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('❌ Failed to get sync status:', error);
      throw error;
    }
  }

  // Force sync (manual trigger)
  async forceSync() {
    try {
      const response = await fetch(`${API_BASE}/sync/gmail/force`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to force sync: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('🔄 Gmail force sync completed:', result);
      return result;
    } catch (error) {
      console.error('❌ Failed to force sync:', error);
      throw error;
    }
  }

  // Connect to Server-Sent Events for real-time updates
  connectToSSE() {
    if (this.eventSource) {
      console.log('📡 SSE already connected');
      return;
    }

    try {
      this.eventSource = new EventSource(`${API_BASE}/api/v1/emails/stream`, {
        withCredentials: true,
      });

      this.eventSource.onopen = () => {
        this.isConnected = true;
        console.log('📡 Connected to Gmail sync updates');
        this.notifyListeners('connect', { connected: true });
      };

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📨 Gmail sync update received:', data);

          // Handle different types of updates
          switch (data.type) {
            case 'connected':
              console.log('📡 SSE Connection established');
              break;
            case 'unread_count_updated':
              this.notifyListeners('unreadCountUpdate', {
                unread: data.unread,
                total: data.total,
                source: data.source || 'external_change',
                timestamp: data.timestamp
              });
              break;
            case 'gmail_sync_update':
              this.notifyListeners('syncUpdate', data);
              break;
            default:
              console.log('📨 Unknown SSE message type:', data.type, data);
              this.notifyListeners('message', data);
          }
        } catch (error) {
          console.error('❌ Failed to parse SSE message:', error);
        }
      };

      this.eventSource.onerror = (error) => {
        console.error('❌ SSE connection error:', error);
        this.isConnected = false;
        this.notifyListeners('error', error);

        // Attempt to reconnect after 5 seconds
        setTimeout(() => {
          if (!this.isConnected) {
            console.log('🔄 Attempting to reconnect to SSE...');
            this.connectToSSE();
          }
        }, 5000);
      };

    } catch (error) {
      console.error('❌ Failed to connect to SSE:', error);
    }
  }

  // Disconnect from SSE
  disconnectFromSSE() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.isConnected = false;
      console.log('🛑 Disconnected from Gmail sync updates');
      this.notifyListeners('disconnect', { connected: false });
    }
  }

  // Add event listener
  addEventListener(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);

    // Return unsubscribe function
    return () => {
      const eventListeners = this.listeners.get(event);
      if (eventListeners) {
        eventListeners.delete(callback);
      }
    };
  }

  // Remove event listener
  removeEventListener(event, callback) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(callback);
    }
  }

  // Notify all listeners for an event
  notifyListeners(event, data) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`❌ Listener error for event ${event}:`, error);
        }
      });
    }
  }

  // Get connection status
  getConnectionStatus() {
    return {
      connected: this.isConnected,
      hasEventSource: !!this.eventSource,
      listenerCount: Array.from(this.listeners.values()).reduce((total, set) => total + set.size, 0)
    };
  }

  // Cleanup on unmount
  cleanup() {
    this.disconnectFromSSE();
    this.listeners.clear();
  }
}

// Export singleton instance
export default new GmailSyncService();