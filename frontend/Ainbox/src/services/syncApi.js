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
            case 'email_updated':
              this.notifyListeners('emailUpdated', {
                emailId: data.email?.id || data.messageId,
                messageId: data.messageId,
                threadId: data.threadId,
                changeType: data.changeType,
                isRead: data.email?.isRead,
                timestamp: data.timestamp
              });
              break;
            case 'email_status_updated':
              this.notifyListeners('emailStatusUpdated', {
                messageId: data.messageId,
                changeType: data.changeType,
                labelIds: data.labelIds,
                isRead: data.isRead,
                timestamp: data.timestamp
              });
              break;
            case 'email_status_updated_immediate':
              console.log('⚡ IMMEDIATE email status update received:', data);
              // Handle immediate status updates with highest priority
              this.handleImmediateEmailStatusUpdate(data);
              this.notifyListeners('emailStatusUpdatedImmediate', {
                messageId: data.messageId,
                isRead: data.isRead,
                changeType: data.changeType,
                subject: data.subject,
                from: data.from,
                priority: data.priority,
                timestamp: data.timestamp
              });
              break;
            case 'sync_started':
              this.notifyListeners('syncStarted', {
                unread: data.unread,
                total: data.total,
                timestamp: data.timestamp
              });
              break;
            case 'sync_stopped':
              this.notifyListeners('syncStopped', {
                timestamp: data.timestamp
              });
              break;
            case 'force_sync_completed':
              this.notifyListeners('forceSyncCompleted', {
                unread: data.unread,
                total: data.total,
                timestamp: data.timestamp
              });
              break;
            case 'fallback_sync_update':
              this.notifyListeners('fallbackSyncUpdate', {
                unread: data.unread,
                total: data.total,
                source: data.source || 'fallback_sync',
                timestamp: data.timestamp
              });
              break;
            case 'watch_renewed':
              console.log('🔄 Gmail watch renewed successfully');
              this.notifyListeners('watchRenewed', {
                timestamp: data.timestamp
              });
              break;
            case 'watch_renewal_failed':
              console.error('❌ Gmail watch renewal failed:', data.error);
              this.notifyListeners('watchRenewalFailed', {
                error: data.error,
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

  // Helper method to subscribe to unread count changes
  onUnreadCountChange(callback) {
    return this.addEventListener('unreadCountUpdate', callback);
  }

  // Helper method to subscribe to email status changes
  onEmailStatusChange(callback) {
    return this.addEventListener('emailStatusUpdated', callback);
  }

  // Helper method to subscribe to new emails
  onEmailUpdated(callback) {
    return this.addEventListener('emailUpdated', callback);
  }

  // Helper method to subscribe to sync events
  onSyncStatusChange(callback) {
    const unsubscribeFunctions = [
      this.addEventListener('syncStarted', callback),
      this.addEventListener('syncStopped', callback),
      this.addEventListener('forceSyncCompleted', callback),
      this.addEventListener('fallbackSyncUpdate', callback)
    ];

    // Return combined unsubscribe function
    return () => {
      unsubscribeFunctions.forEach(unsub => unsub());
    };
  }

  // Helper method to update UI elements with real-time data
  updateInboxCountUI(unread, total, source = 'unknown') {
    try {
      // Update inbox count badges
      const unreadBadges = document.querySelectorAll('.unread-count, [data-unread-count]');
      unreadBadges.forEach(badge => {
        badge.textContent = unread;
        badge.style.display = unread > 0 ? 'block' : 'none';

        // Add visual feedback for real-time updates
        if (source === 'pubsub_notification' || source === 'external_change') {
          badge.classList.add('updated-realtime');
          setTimeout(() => badge.classList.remove('updated-realtime'), 2000);
        }
      });

      // Update total count displays
      const totalCountElements = document.querySelectorAll('.total-count, [data-total-count]');
      totalCountElements.forEach(element => {
        element.textContent = total;
      });

      // Update page title with unread count
      this.updatePageTitle(unread);

      console.log(`📊 UI updated - Unread: ${unread}, Total: ${total}, Source: ${source}`);

    } catch (error) {
      console.error('❌ Failed to update inbox count UI:', error);
    }
  }

  // Helper method to update page title with unread count
  updatePageTitle(unreadCount) {
    try {
      const baseTitle = 'Ainbox';
      document.title = unreadCount > 0 ? `(${unreadCount}) ${baseTitle}` : baseTitle;
    } catch (error) {
      console.error('❌ Failed to update page title:', error);
    }
  }

  // Helper method to show email status changes visually
  updateEmailStatusUI(messageId, isRead, changeType) {
    try {
      // Find email elements by message ID
      const emailElements = document.querySelectorAll(`[data-message-id="${messageId}"]`);

      emailElements.forEach(element => {
        // Update read/unread styling
        if (isRead) {
          element.classList.remove('unread');
          element.classList.add('read');
        } else {
          element.classList.remove('read');
          element.classList.add('unread');
        }

        // Add visual feedback for real-time changes
        element.classList.add('status-updated');
        setTimeout(() => element.classList.remove('status-updated'), 1500);

        // Update any read indicators
        const readIndicators = element.querySelectorAll('.read-status, [data-read-status]');
        readIndicators.forEach(indicator => {
          indicator.textContent = isRead ? '✓' : '●';
          indicator.className = `read-status ${isRead ? 'read' : 'unread'}`;
        });
      });

      console.log(`📧 Email UI updated - Message: ${messageId}, Read: ${isRead}, Type: ${changeType}`);

    } catch (error) {
      console.error('❌ Failed to update email status UI:', error);
    }
  }

  // Handle IMMEDIATE email status updates (highest priority)
  handleImmediateEmailStatusUpdate(data) {
    try {
      console.log(`⚡ IMMEDIATE UI update for email ${data.messageId}:`, data.changeType);

      // Find email elements by message ID
      const emailElements = document.querySelectorAll(`[data-message-id="${data.messageId}"]`);

      if (emailElements.length === 0) {
        console.warn(`⚠️ No email elements found for message ID: ${data.messageId}`);
        return;
      }

      emailElements.forEach(element => {
        // IMMEDIATELY update read/unread styling
        if (data.isRead) {
          element.classList.remove('unread');
          element.classList.add('read');
          element.style.backgroundColor = 'oklch(98.5% 0.002 247.839)'; // Read background - very light cool gray
          element.style.fontWeight = 'normal';
          element.style.opacity = '0.8';
          element.style.borderLeft = '4px solid transparent';
        } else {
          element.classList.remove('read');
          element.classList.add('unread');
          element.style.backgroundColor = 'oklch(95.4% 0.038 75.164)'; // Unread background - light warm yellow
          element.style.fontWeight = '600';
          element.style.opacity = '1';
          element.style.borderLeft = '4px solid #007bff';
        }

        // Add IMMEDIATE visual feedback with stronger animation
        element.classList.add('status-updated-immediate');
        element.style.transform = 'scale(1.02)';
        element.style.boxShadow = data.isRead
          ? '0 2px 8px rgba(108, 117, 125, 0.3)'
          : '0 2px 8px rgba(0, 123, 255, 0.3)';

        // Remove animation after effect
        setTimeout(() => {
          element.classList.remove('status-updated-immediate');
          element.style.transform = '';
          element.style.boxShadow = '';
        }, 800);

        // Update read indicators IMMEDIATELY
        const readIndicators = element.querySelectorAll('.read-status, [data-read-status]');
        readIndicators.forEach(indicator => {
          indicator.textContent = data.isRead ? '✓' : '●';
          indicator.className = `read-status ${data.isRead ? 'read' : 'unread'}`;
          indicator.style.color = data.isRead ? '#6c757d' : '#007bff';
          indicator.style.fontWeight = data.isRead ? 'normal' : 'bold';
        });

        // Update any background color attributes
        element.setAttribute('data-read-status', data.isRead ? 'read' : 'unread');
      });

      console.log(`⚡ IMMEDIATE UI update completed - Message: ${data.messageId}, Read: ${data.isRead}`);

    } catch (error) {
      console.error('❌ Failed to handle immediate email status update:', error);
    }
  }

  // Auto-setup for common UI updates
  setupAutoUIUpdates() {
    // Auto-update inbox counts (fastest)
    this.onUnreadCountChange((data) => {
      this.updateInboxCountUI(data.unread, data.total, data.source);
    });

    // Handle IMMEDIATE email status updates (highest priority)
    this.addEventListener('emailStatusUpdatedImmediate', (data) => {
      console.log('⚡ Processing immediate email status update');
      // This is already handled in handleImmediateEmailStatusUpdate
      // But we can add additional logic here if needed
    });

    // Auto-update email statuses (regular updates)
    this.onEmailStatusChange((data) => {
      this.updateEmailStatusUI(data.messageId, data.isRead, data.changeType);
    });

    // Handle email updates (new/deleted emails)
    this.onEmailUpdated((data) => {
      this.handleEmailListUpdate(data);
    });

    // Log sync status changes
    this.onSyncStatusChange((data) => {
      console.log('🔄 Sync status changed:', data.type || 'unknown', data);
    });

    console.log('✅ Auto UI updates configured with immediate email status handling');
  }

  // Handle email list updates (new/deleted emails)
  handleEmailListUpdate(data) {
    try {
      console.log('📧 Email list update:', data);

      switch (data.changeType) {
        case 'added':
          this.refreshEmailList('new_email');
          this.showNotification('New email received', 'info');
          break;
        case 'deleted':
          this.removeEmailFromList(data.messageId);
          break;
        default:
          this.refreshEmailList('email_updated');
      }

    } catch (error) {
      console.error('❌ Failed to handle email list update:', error);
    }
  }

  // Refresh the email list
  async refreshEmailList(reason = 'update') {
    try {
      console.log(`🔄 Refreshing email list (${reason})`);

      // Dispatch custom event for email list refresh
      const refreshEvent = new CustomEvent('refreshEmailList', {
        detail: { reason, timestamp: Date.now() }
      });
      window.dispatchEvent(refreshEvent);

      // Fetch updated emails from the server
      try {
        const response = await fetch(`${API_BASE}/gmail/emails`, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const emails = await response.json();
          console.log(`📧 Fetched ${emails.length} updated emails`);

          // Dispatch event with updated emails
          const emailUpdateEvent = new CustomEvent('emailListUpdated', {
            detail: { emails, reason, timestamp: Date.now() }
          });
          window.dispatchEvent(emailUpdateEvent);

        } else {
          console.warn('⚠️ Failed to fetch updated emails:', response.statusText);
        }
      } catch (fetchError) {
        console.warn('⚠️ Email fetch failed, using event-only refresh:', fetchError.message);
      }

    } catch (error) {
      console.error('❌ Failed to refresh email list:', error);
    }
  }

  // Remove email from list
  removeEmailFromList(messageId) {
    try {
      const emailElements = document.querySelectorAll(`[data-message-id="${messageId}"]`);

      emailElements.forEach(element => {
        // Add removal animation
        element.style.transition = 'all 0.3s ease';
        element.style.opacity = '0';
        element.style.transform = 'translateX(-100%)';

        // Remove after animation
        setTimeout(() => {
          element.remove();
        }, 300);
      });

      console.log(`🗑️ Email removed from list: ${messageId}`);

    } catch (error) {
      console.error('❌ Failed to remove email from list:', error);
    }
  }

  // Show notification to user
  showNotification(message, type = 'info') {
    try {
      // Create toast notification
      const toast = document.createElement('div');
      toast.className = `realtime-toast ${type}`;
      toast.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-weight: 500;">${message}</span>
          <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; font-size: 16px; cursor: pointer;">×</button>
        </div>
      `;

      document.body.appendChild(toast);

      // Auto-remove after 5 seconds
      setTimeout(() => {
        if (toast.parentElement) {
          toast.remove();
        }
      }, 5000);

    } catch (error) {
      console.error('❌ Failed to show notification:', error);
    }
  }
}

// Export singleton instance
export default new GmailSyncService();