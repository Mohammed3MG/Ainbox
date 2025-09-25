// Socket.IO real-time communication service
import { io } from 'socket.io-client';
import { API_BASE_URL } from '../config';

// Use the same API base as the rest of the app; Socket.IO connects to the server origin
const API_BASE = API_BASE_URL;

class SocketIOService {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.listeners = new Map();
    this.userId = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  // Connect to Socket.IO server
  connect(userId, token) {
    if (this.socket) {
      console.log('🔌 Socket already connected');
      return;
    }

    this.userId = userId;

    try {
      this.socket = io(API_BASE, {
        transports: ['websocket', 'polling'],
        timeout: 5000,
        forceNew: true,
        withCredentials: true
      });

      this.setupEventHandlers();

      // Authenticate after connection
      this.socket.on('connect', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        console.log('🔌 Connected to Socket.IO server:', this.socket.id);

        // Authenticate with server
        this.socket.emit('authenticate', {
          userId: userId,
          token: token || 'dummy-token' // In production, use real JWT token
        });

        // Join user room
        this.socket.emit('join_user_room', userId);

        this.notifyListeners('connect', { connected: true });
      });

    } catch (error) {
      console.error('❌ Failed to connect to Socket.IO:', error);
    }
  }

  // Set up all event handlers
  setupEventHandlers() {
    // Connection events
    this.socket.on('connected', (data) => {
      console.log('🚀 Socket.IO welcome message:', data.message);
    });

    this.socket.on('authenticated', (data) => {
      console.log('✅ Socket.IO authenticated for user:', data.userId);
    });

    this.socket.on('authentication_error', (data) => {
      console.error('❌ Socket.IO authentication failed:', data.error);
    });

    // Email update events
    this.socket.on('email_updated', (data) => {
      console.log('📧 Socket.IO email updated RAW:', data);
      console.log('📧 data.email:', data.email);
      console.log('📧 data.email.id:', data.email?.id);

      const mappedData = {
        emailId: data.email?.id,
        gmailMessageId: data.email?.id, // Add gmailMessageId as alias
        messageId: data.email?.id,      // Add messageId as alias
        id: data.email?.id,             // Add id as alias
        isRead: data.email?.isRead,
        timestamp: data.timestamp,
        source: data.source
      };

      console.log('📧 Mapped data for emailUpdated:', mappedData);
      this.notifyListeners('emailUpdated', mappedData);
    });

    // Count update events
    this.socket.on('unread_count_updated', (data) => {
      console.log('📊 Socket.IO count updated:', data);
      this.notifyListeners('unreadCountUpdate', {
        unread: data.unread,
        total: data.total,
        timestamp: data.timestamp,
        source: data.source
      });
    });

    // New email events
    this.socket.on('new_email', (data) => {
      console.log('\n' + '='.repeat(60));
      console.log('🚨 [SOCKET TRACE] NEW EMAIL EVENT RECEIVED');
      console.log('='.repeat(60));
      console.log('🚨 [SOCKET TRACE] Raw new_email event received:', JSON.stringify(data, null, 2));
      console.log('🚨 [SOCKET TRACE] Event data type:', typeof data);
      console.log('🚨 [SOCKET TRACE] Event data.email:', data.email);
      console.log('🚨 [SOCKET TRACE] Event timestamp:', data.timestamp);
      console.log('🚨 [SOCKET TRACE] Event source:', data.source);
      console.log('🚨 [SOCKET TRACE] Has listeners for newEmail:', this.listeners.has('newEmail'));
      console.log('🚨 [SOCKET TRACE] Number of listeners:', this.listeners.get('newEmail')?.size || 0);

      this.notifyListeners('newEmail', {
        email: data.email,
        timestamp: data.timestamp,
        source: data.source
      });

      console.log('🚨 [SOCKET TRACE] ✅ Notified listeners for newEmail event');
      console.log('='.repeat(60) + '\n');
    });

    // Email deletion events
    this.socket.on('email_deleted', (data) => {
      console.log('🗑️ Socket.IO email deleted:', data);
      this.notifyListeners('emailDeleted', {
        emailId: data.emailId,
        threadId: data.threadId,
        reason: data.reason,
        timestamp: data.timestamp,
        source: data.source
      });
    });

    // Bidirectional email action broadcasts
    this.socket.on('email_action_broadcast', (data) => {
      console.log('📡 Socket.IO email action broadcast:', data);
      this.notifyListeners('emailActionBroadcast', {
        action: data.action,
        emailIds: data.emailIds,
        provider: data.provider,
        source: data.source,
        fromSocket: data.fromSocket
      });
    });

    // Sync response events
    this.socket.on('sync_response', (data) => {
      console.log('🔄 Socket.IO sync response:', data);
      this.notifyListeners('syncResponse', data);
    });

    // Error events
    this.socket.on('error', (data) => {
      console.error('❌ Socket.IO error:', data);
      this.notifyListeners('error', data);
    });

    // Disconnect events
    this.socket.on('disconnect', (reason) => {
      this.isConnected = false;
      console.log('🔌 Socket.IO disconnected:', reason);
      this.notifyListeners('disconnect', { connected: false, reason });

      // Attempt to reconnect
      this.handleReconnect();
    });

    // Reconnect events
    this.socket.on('reconnect', () => {
      this.isConnected = true;
      console.log('🔄 Socket.IO reconnected');
      this.notifyListeners('reconnect', { connected: true });
    });

    this.socket.on('reconnect_error', (error) => {
      console.error('❌ Socket.IO reconnect error:', error);
    });
  }

  // Handle reconnection attempts
  handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

      setTimeout(() => {
        if (!this.isConnected && this.userId) {
          this.disconnect();
          this.connect(this.userId);
        }
      }, 2000 * this.reconnectAttempts); // Exponential backoff
    } else {
      console.error('❌ Max reconnection attempts reached');
    }
  }

  // Send email action to server (bidirectional communication)
  sendEmailAction(action, emailIds, provider) {
    if (!this.isConnected || !this.socket) {
      console.warn('⚠️ Socket not connected, cannot send email action');
      return;
    }

    console.log(`📧 Sending email action: ${action} on ${emailIds?.length || 0} emails`);
    this.socket.emit('email_action', {
      action,
      emailIds,
      provider,
      timestamp: Date.now()
    });
  }

  // Request sync from server
  requestSync(provider, forceSync = false) {
    if (!this.isConnected || !this.socket) {
      console.warn('⚠️ Socket not connected, cannot request sync');
      return;
    }

    console.log(`🔄 Requesting sync for ${provider}, force: ${forceSync}`);
    this.socket.emit('request_sync', {
      provider,
      forceSync,
      timestamp: Date.now()
    });
  }

  // Disconnect from server
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      console.log('🔌 Disconnected from Socket.IO server');
      this.notifyListeners('disconnect', { connected: false });
    }
  }

  // Add event listener
  addEventListener(event, callback) {
    console.log(`🔔 Adding listener for event: ${event}`);

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
    console.log(`📢 Notifying listeners for event: ${event}, listener count: ${eventListeners?.size || 0}`, data);

    if (eventListeners) {
      eventListeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`❌ Listener error for event ${event}:`, error);
        }
      });
    } else {
      console.warn(`⚠️ No listeners found for event: ${event}`);
    }
  }

  // Get connection status
  getConnectionStatus() {
    return {
      connected: this.isConnected,
      socketId: this.socket?.id,
      userId: this.userId,
      listenerCount: Array.from(this.listeners.values()).reduce((total, set) => total + set.size, 0)
    };
  }

  // Cleanup on unmount
  cleanup() {
    this.disconnect();
    this.listeners.clear();
  }
}

// Export singleton instance
export default new SocketIOService();
