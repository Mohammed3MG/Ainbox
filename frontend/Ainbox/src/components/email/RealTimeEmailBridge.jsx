import { useEffect } from 'react';
import gmailSyncService from '../../services/syncApi.js';

/**
 * Bridge component to connect Gmail Pub/Sub real-time updates with React state
 * This component bridges the gap between:
 * 1. Gmail Pub/Sub → SSE → syncApi.js (immediate UI updates)
 * 2. React state management in useEmail hook
 */
export default function RealTimeEmailBridge() {
  useEffect(() => {
    console.log('🌉 Initializing Real-Time Email Bridge');

    // Set up automatic UI updates for immediate visual feedback
    gmailSyncService.setupAutoUIUpdates();

    // Start Gmail Pub/Sub sync
    gmailSyncService.startSync().then(() => {
      console.log('✅ Gmail Pub/Sub sync started successfully');
    }).catch(error => {
      console.error('❌ Failed to start Gmail Pub/Sub sync:', error);
    });

    // Bridge Gmail Pub/Sub immediate updates with React state
    const handleImmediateEmailUpdate = (data) => {
      console.log('⚡ Bridge: Immediate email update received:', data);

      // Update React state for email items that exist in the DOM
      const emailElements = document.querySelectorAll(`[data-message-id="${data.messageId}"]`);

      if (emailElements.length > 0) {
        console.log(`⚡ Bridge: Found ${emailElements.length} email elements to update`);

        // Trigger React state update by dispatching a custom event
        const reactUpdateEvent = new CustomEvent('reactEmailStatusUpdate', {
          detail: {
            emailId: data.messageId,
            isRead: data.isRead,
            changeType: data.changeType,
            source: 'pubsub_immediate',
            timestamp: data.timestamp
          }
        });

        window.dispatchEvent(reactUpdateEvent);
      } else {
        console.warn(`⚠️ Bridge: No email elements found for message ID: ${data.messageId}`);
      }
    };

    // Listen for immediate email status updates from Gmail Pub/Sub
    const unsubscribeImmediate = gmailSyncService.addEventListener(
      'emailStatusUpdatedImmediate',
      handleImmediateEmailUpdate
    );

    // Handle new email arrivals
    const handleNewEmailUpdate = (data) => {
      console.log('📧 Bridge: New email update received:', data);

      // Dispatch React event for new emails
      const newEmailEvent = new CustomEvent('reactNewEmail', {
        detail: {
          email: data.emailDetail,
          timestamp: data.timestamp
        }
      });

      window.dispatchEvent(newEmailEvent);
    };

    // Listen for new email updates
    const unsubscribeNewEmail = gmailSyncService.addEventListener(
      'emailUpdated',
      (data) => {
        if (data.changeType === 'added') {
          handleNewEmailUpdate(data);
        }
      }
    );

    // Handle email deletions
    const handleEmailDeletion = (data) => {
      console.log('🗑️ Bridge: Email deletion received:', data);

      // Dispatch React event for email deletions
      const deleteEmailEvent = new CustomEvent('reactEmailDeleted', {
        detail: {
          emailId: data.messageId,
          timestamp: data.timestamp
        }
      });

      window.dispatchEvent(deleteEmailEvent);
    };

    // Listen for email deletions
    const unsubscribeDeleteEmail = gmailSyncService.addEventListener(
      'emailUpdated',
      (data) => {
        if (data.changeType === 'deleted') {
          handleEmailDeletion(data);
        }
      }
    );

    console.log('✅ Real-Time Email Bridge initialized');

    // Cleanup
    return () => {
      console.log('🧹 Cleaning up Real-Time Email Bridge');
      unsubscribeImmediate();
      unsubscribeNewEmail();
      unsubscribeDeleteEmail();
      gmailSyncService.cleanup();
    };
  }, []);

  // This is a bridge component - no UI needed
  return null;
}

/**
 * Hook to integrate with the Real-Time Email Bridge
 * Use this in your email components that need real-time updates
 */
export function useRealTimeEmailBridge(onEmailStatusUpdate, onNewEmail, onEmailDeleted) {
  useEffect(() => {
    // Listen for bridged React events
    const handleReactEmailStatusUpdate = (event) => {
      if (onEmailStatusUpdate) {
        onEmailStatusUpdate(event.detail);
      }
    };

    const handleReactNewEmail = (event) => {
      if (onNewEmail) {
        onNewEmail(event.detail);
      }
    };

    const handleReactEmailDeleted = (event) => {
      if (onEmailDeleted) {
        onEmailDeleted(event.detail);
      }
    };

    // Add event listeners
    window.addEventListener('reactEmailStatusUpdate', handleReactEmailStatusUpdate);
    window.addEventListener('reactNewEmail', handleReactNewEmail);
    window.addEventListener('reactEmailDeleted', handleReactEmailDeleted);

    // Cleanup
    return () => {
      window.removeEventListener('reactEmailStatusUpdate', handleReactEmailStatusUpdate);
      window.removeEventListener('reactNewEmail', handleReactNewEmail);
      window.removeEventListener('reactEmailDeleted', handleReactEmailDeleted);
    };
  }, [onEmailStatusUpdate, onNewEmail, onEmailDeleted]);
}