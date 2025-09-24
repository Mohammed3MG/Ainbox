// Ainbox/frontend/Ainbox/src/components/email/RealTimeEmailBridge.jsx
import { useEffect } from 'react';
import gmailSyncService from '../../services/syncApi.js';

/**
 * Bridge component to connect Gmail Pub/Sub real-time updates with React state
 * FIXES:
 *  - Always dispatch updates (no DOM gating)
 *  - Safe subscribe/unsubscribe
 *  - Do NOT tear down global SSE on unmount
 *  - Prefer connectToSSE() to avoid duplicate watches
 *  - Bridges unread-count updates
 */
export default function RealTimeEmailBridge() {
  useEffect(() => {
    const USE_SSE = false; // Prefer Socket.IO over SSE
    if (!USE_SSE) {
      console.log('🌉 Real-Time Email Bridge (SSE) disabled; using Socket.IO listeners instead');
      return () => {};
    }

    console.log('🌉 Initializing Real-Time Email Bridge');

    // Ensure SSE/stream is connected (idempotent)
    try {
      if (typeof gmailSyncService.connectToSSE === 'function') {
        gmailSyncService.connectToSSE();
      } else if (typeof gmailSyncService.startSync === 'function') {
        gmailSyncService
          .startSync()
          .then(() => {
            console.log('✅ Gmail Pub/Sub sync started successfully');
          })
          .catch((error) => {
            console.error('❌ Failed to start Gmail Pub/Sub sync:', error);
          });
      }
    } catch (e) {
      console.warn('⚠️ Could not ensure SSE connection:', e);
    }

    // ---- Event handlers (no DOM checks; always notify React) ----
    const handleImmediateEmailUpdate = (data) => {
      window.dispatchEvent(
        new CustomEvent('reactEmailStatusUpdate', {
          detail: {
            emailId: data.messageId,
            isRead: data.isRead,
            changeType: data.changeType,
            source: 'pubsub_immediate',
            timestamp: data.timestamp,
          },
        }),
      );
    };

    const handleEmailUpdated = (data) => {
      console.log('🌉 RealTimeEmailBridge handleEmailUpdated:', data);

      if (data?.changeType === 'added') {
        window.dispatchEvent(
          new CustomEvent('reactNewEmail', {
            detail: {
              email: data.emailDetail ?? data.email ?? null,
              timestamp: data.timestamp,
            },
          }),
        );
      } else if (data?.changeType === 'deleted') {
        window.dispatchEvent(
          new CustomEvent('reactEmailDeleted', {
            detail: {
              emailId: data.messageId ?? data.emailId,
              timestamp: data.timestamp,
            },
          }),
        );
      } else {
        // Handle read/unread status changes (no specific changeType)
        console.log('🌉 Processing email status change:', {
          emailId: data.emailId,
          isRead: data.isRead,
          changeType: data.changeType || 'status_change'
        });

        window.dispatchEvent(
          new CustomEvent('reactEmailStatusUpdate', {
            detail: {
              emailId: data.emailId || data.messageId,
              messageId: data.messageId || data.emailId,
              threadId: data.threadId,
              isRead: data.isRead,
              changeType: data.changeType || (data.isRead ? 'marked_read' : 'marked_unread'),
              source: 'sse_email_updated',
              timestamp: data.timestamp || new Date().toISOString(),
            },
          }),
        );
      }
    };

    const handleUnreadCount = (data) => {
      // Expecting shape { count, labelId?, timestamp? }
      if (typeof data?.count === 'number') {
        window.dispatchEvent(
          new CustomEvent('reactUnreadCount', {
            detail: {
              count: data.count,
              labelId: data.labelId,
              timestamp: data.timestamp,
            },
          }),
        );
      }
    };

    // ---- Subscribe safely (supports "unsubscribe fn" OR removeEventListener) ----
    const subs = [];

    const safeAdd = (eventName, handler) => {
      let unsub;
      try {
        if (typeof gmailSyncService.addEventListener === 'function') {
          unsub = gmailSyncService.addEventListener(eventName, handler);
        }
      } catch (e) {
        console.warn(`⚠️ addEventListener failed for ${eventName}:`, e);
      }
      subs.push({ eventName, handler, unsub });
    };

    safeAdd('emailStatusUpdatedImmediate', handleImmediateEmailUpdate);
    safeAdd('emailUpdated', handleEmailUpdated);
    safeAdd('unreadCountUpdate', handleUnreadCount);

    console.log('✅ Real-Time Email Bridge initialized');

    // Cleanup: remove only our listeners (do NOT close global SSE/socket)
    return () => {
      console.log('🧹 Cleaning up Real-Time Email Bridge');
      for (const s of subs) {
        try {
          if (typeof s.unsub === 'function') {
            s.unsub();
          } else if (typeof gmailSyncService.removeEventListener === 'function') {
            gmailSyncService.removeEventListener(s.eventName, s.handler);
          }
        } catch (e) {
          console.warn(`⚠️ Unsubscribe failed for ${s.eventName}:`, e);
        }
      }
      // IMPORTANT: do NOT call gmailSyncService.cleanup() here —
      // it would kill realtime for the whole app.
    };
  }, []);

  return null; // no UI
}

/**
 * Hook to integrate with the Real-Time Email Bridge
 * Added support for unread count via optional 4th callback.
 *
 * Usage:
 *   useRealTimeEmailBridge(onStatus, onNew, onDeleted, onUnreadCount);
 */
export function useRealTimeEmailBridge(
  onEmailStatusUpdate,
  onNewEmail,
  onEmailDeleted,
  onUnreadCountUpdate // optional
) {
  useEffect(() => {
    const handleReactEmailStatusUpdate = (event) => onEmailStatusUpdate?.(event.detail);
    const handleReactNewEmail = (event) => onNewEmail?.(event.detail);
    const handleReactEmailDeleted = (event) => onEmailDeleted?.(event.detail);
    const handleReactUnreadCount = (event) => onUnreadCountUpdate?.(event.detail);

    window.addEventListener('reactEmailStatusUpdate', handleReactEmailStatusUpdate);
    window.addEventListener('reactNewEmail', handleReactNewEmail);
    window.addEventListener('reactEmailDeleted', handleReactEmailDeleted);
    window.addEventListener('reactUnreadCount', handleReactUnreadCount);

    return () => {
      window.removeEventListener('reactEmailStatusUpdate', handleReactEmailStatusUpdate);
      window.removeEventListener('reactNewEmail', handleReactNewEmail);
      window.removeEventListener('reactEmailDeleted', handleReactEmailDeleted);
      window.removeEventListener('reactUnreadCount', handleReactUnreadCount);
    };
  }, [onEmailStatusUpdate, onNewEmail, onEmailDeleted, onUnreadCountUpdate]);
}
