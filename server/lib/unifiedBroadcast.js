// Unified broadcasting service to prevent conflicts between Socket.IO and SSE
const socketIOService = require('./socketio');
const { broadcastToUser } = require('./sse');

class UnifiedBroadcastService {
  constructor() {
    // Track recent broadcasts to prevent duplicates
    this.recentBroadcasts = new Map(); // userId -> Map(eventKey -> timestamp)
    this.dedupWindow = 2000; // 2 second deduplication window
  }

  // Generate a unique key for deduplication
  generateEventKey(type, data) {
    switch (type) {
      case 'email_updated':
        return `email_updated:${data.id || data.messageId}:${data.isRead}`;
      case 'new_email':
        return `new_email:${data.id || data.messageId}`;
      case 'count_updated':
        return `count_updated:${data.unread}:${data.total}`;
      case 'email_deleted':
        return `email_deleted:${data.id || data.messageId}`;
      default:
        return `${type}:${JSON.stringify(data)}`;
    }
  }

  // Check if we should broadcast (prevent duplicates)
  shouldBroadcast(userId, eventKey) {
    console.log(`📡 [DEBUG DEDUP] Checking shouldBroadcast for user ${userId}, eventKey: ${eventKey}`);

    if (!this.recentBroadcasts.has(userId)) {
      console.log(`📡 [DEBUG DEDUP] No recent broadcasts for user ${userId}, creating new Map`);
      this.recentBroadcasts.set(userId, new Map());
    }

    const userBroadcasts = this.recentBroadcasts.get(userId);
    const lastBroadcast = userBroadcasts.get(eventKey);
    const now = Date.now();

    console.log(`📡 [DEBUG DEDUP] Last broadcast timestamp: ${lastBroadcast}, now: ${now}, dedup window: ${this.dedupWindow}ms`);

    if (lastBroadcast && (now - lastBroadcast) < this.dedupWindow) {
      const timeSinceLastBroadcast = now - lastBroadcast;
      console.log(`🚫 [DEBUG DEDUP] ❌ DUPLICATE - Skipping duplicate broadcast for user ${userId}: ${eventKey} (${timeSinceLastBroadcast}ms ago)`);
      return false;
    }

    console.log(`📡 [DEBUG DEDUP] ✅ ALLOWED - Recording broadcast for user ${userId}: ${eventKey}`);

    // Record this broadcast
    userBroadcasts.set(eventKey, now);

    // Clean old entries
    let cleanedEntries = 0;
    for (const [key, timestamp] of userBroadcasts.entries()) {
      if (now - timestamp > this.dedupWindow * 5) {
        userBroadcasts.delete(key);
        cleanedEntries++;
      }
    }

    if (cleanedEntries > 0) {
      console.log(`📡 [DEBUG DEDUP] Cleaned ${cleanedEntries} old broadcast entries for user ${userId}`);
    }

    console.log(`📡 [DEBUG DEDUP] Current broadcast count for user ${userId}: ${userBroadcasts.size}`);

    return true;
  }

  // Unified email update broadcast
  emailUpdated(userId, data) {
    const eventKey = this.generateEventKey('email_updated', data);
    if (!this.shouldBroadcast(userId, eventKey)) return;

    console.log(`📡 Broadcasting email update for user ${userId}:`, {
      id: data.id,
      isRead: data.isRead,
      source: data.source
    });

    // Broadcast via Socket.IO
    try {
      socketIOService.emailUpdated(userId, data);
    } catch (error) {
      console.error('Socket.IO broadcast failed:', error.message);
    }

    // Broadcast via SSE
    try {
      broadcastToUser(userId, {
        type: 'email_updated',
        email: data,
        source: data.source || 'unified_broadcast',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('SSE broadcast failed:', error.message);
    }
  }

  // Unified new email broadcast
  newEmail(userId, emailData) {
    const eventKey = this.generateEventKey('new_email', emailData);
    if (!this.shouldBroadcast(userId, eventKey)) return;

    console.log(`📡 Broadcasting new email for user ${userId}:`, emailData.subject);

    // Broadcast via Socket.IO
    try {
      socketIOService.newEmail(userId, emailData);
    } catch (error) {
      console.error('Socket.IO new email broadcast failed:', error.message);
    }

    // Broadcast via SSE
    try {
      broadcastToUser(userId, {
        type: 'new_email',
        email: emailData,
        source: 'unified_broadcast',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('SSE new email broadcast failed:', error.message);
    }
  }

  // Unified count update broadcast
  countUpdated(userId, counts, source = 'unified_broadcast') {
    console.log(`📡 [DEBUG BROADCAST] 🚀 STARTING countUpdated for user ${userId}`);
    console.log(`📡 [DEBUG BROADCAST] Input data - counts:`, counts, `source: ${source}`);

    const eventKey = this.generateEventKey('count_updated', counts);
    console.log(`📡 [DEBUG BROADCAST] Generated event key: ${eventKey}`);

    const shouldBcast = this.shouldBroadcast(userId, eventKey);
    console.log(`📡 [DEBUG BROADCAST] Should broadcast check: ${shouldBcast}`);

    if (!shouldBcast) {
      console.log(`📡 [DEBUG BROADCAST] ❌ SKIPPING broadcast due to deduplication`);
      return;
    }

    console.log(`📡 [DEBUG BROADCAST] ✅ Proceeding with broadcast...`);

    // Prepare standardized count update payload
    const countPayload = {
      unread: counts.unread,
      total: counts.total || counts.total,
      source: source,
      timestamp: new Date().toISOString()
    };
    console.log(`📡 [DEBUG BROADCAST] Prepared payload:`, countPayload);

    // Broadcast via Socket.IO
    console.log(`📡 [DEBUG BROADCAST] 🔌 Broadcasting via Socket.IO...`);
    try {
      socketIOService.countUpdated(userId, countPayload, source);
      console.log(`📡 [DEBUG BROADCAST] 🔌 ✅ Socket.IO broadcast successful`);
    } catch (error) {
      console.error(`📡 [DEBUG BROADCAST] 🔌 ❌ Socket.IO count broadcast failed:`, error.message);
      console.error(`📡 [DEBUG BROADCAST] 🔌 Error stack:`, error.stack);
    }

    // Broadcast via SSE with V2 contract support
    console.log(`📡 [DEBUG BROADCAST] 📡 Broadcasting via SSE...`);
    try {
      const ssePayload = {
        type: 'unread_count_updated',
        ...countPayload
      };
      console.log(`📡 [DEBUG BROADCAST] 📡 SSE payload:`, ssePayload);
      broadcastToUser(userId, ssePayload);
      console.log(`📡 [DEBUG BROADCAST] 📡 ✅ SSE broadcast successful`);
    } catch (error) {
      console.error(`📡 [DEBUG BROADCAST] 📡 ❌ SSE count broadcast failed:`, error.message);
      console.error(`📡 [DEBUG BROADCAST] 📡 Error stack:`, error.stack);
    }

    console.log(`📡 [DEBUG BROADCAST] 🎉 COMPLETED countUpdated for user ${userId}`);
  }

  // Unified email deletion broadcast
  emailDeleted(userId, data) {
    const eventKey = this.generateEventKey('email_deleted', data);
    if (!this.shouldBroadcast(userId, eventKey)) return;

    console.log(`📡 Broadcasting email deletion for user ${userId}:`, data.id);

    // Broadcast via Socket.IO
    try {
      socketIOService.emailDeleted(userId, data);
    } catch (error) {
      console.error('Socket.IO deletion broadcast failed:', error.message);
    }

    // Broadcast via SSE
    try {
      broadcastToUser(userId, {
        type: 'email_deleted',
        emailId: data.id,
        threadId: data.threadId,
        reason: data.reason,
        source: data.source || 'unified_broadcast',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('SSE deletion broadcast failed:', error.message);
    }
  }

  // Generic broadcast for other event types
  broadcast(userId, eventType, data, source = 'unified_broadcast') {
    const eventKey = this.generateEventKey(eventType, data);
    if (!this.shouldBroadcast(userId, eventKey)) return;

    console.log(`📡 Broadcasting ${eventType} for user ${userId}`);

    // Broadcast via SSE (Socket.IO may not support all event types)
    try {
      broadcastToUser(userId, {
        type: eventType,
        ...data,
        source: source,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`SSE ${eventType} broadcast failed:`, error.message);
    }
  }

  // Clean up old broadcast records for a user
  cleanup(userId) {
    if (this.recentBroadcasts.has(userId)) {
      this.recentBroadcasts.delete(userId);
    }
  }

  // V2: Email created broadcast (for new emails)
  emailCreated(userId, emailData) {
    const eventKey = this.generateEventKey('email_created', emailData);
    if (!this.shouldBroadcast(userId, eventKey)) return;

    console.log(`📡 Broadcasting email created for user ${userId}:`, emailData.subject);

    // Standardized email created payload
    const createdPayload = {
      messageId: emailData.id || emailData.messageId,
      threadId: emailData.threadId,
      subject: emailData.subject,
      from: emailData.from,
      isRead: emailData.isRead,
      timestamp: new Date().toISOString()
    };

    // Broadcast via Socket.IO
    try {
      socketIOService.newEmail(userId, emailData);
    } catch (error) {
      console.error('Socket.IO email created broadcast failed:', error.message);
    }

    // Broadcast via SSE
    try {
      broadcastToUser(userId, {
        type: 'email_created',
        ...createdPayload,
        email: emailData // Full email data for compatibility
      });
    } catch (error) {
      console.error('SSE email created broadcast failed:', error.message);
    }
  }

  // V2: Enhanced email updated broadcast
  emailUpdatedV2(userId, data) {
    const eventKey = this.generateEventKey('email_updated_v2', data);
    if (!this.shouldBroadcast(userId, eventKey)) return;

    console.log(`📡 Broadcasting email update V2 for user ${userId}:`, {
      messageId: data.messageId,
      isRead: data.isRead,
      source: data.source
    });

    // Standardized email updated payload
    const updatedPayload = {
      messageId: data.messageId || data.id,
      threadId: data.threadId,
      isRead: data.isRead,
      labels: data.labels,
      source: data.source,
      timestamp: new Date().toISOString()
    };

    // Broadcast via Socket.IO
    try {
      socketIOService.emailUpdated(userId, {
        id: updatedPayload.messageId,
        isRead: updatedPayload.isRead,
        source: updatedPayload.source
      });
    } catch (error) {
      console.error('Socket.IO email updated V2 broadcast failed:', error.message);
    }

    // Broadcast via SSE
    try {
      broadcastToUser(userId, {
        type: 'email_updated',
        ...updatedPayload
      });
    } catch (error) {
      console.error('SSE email updated V2 broadcast failed:', error.message);
    }
  }

  // V2: Email deleted broadcast with enhanced payload
  emailDeletedV2(userId, data) {
    const eventKey = this.generateEventKey('email_deleted_v2', data);
    if (!this.shouldBroadcast(userId, eventKey)) return;

    console.log(`📡 Broadcasting email deleted V2 for user ${userId}:`, data.messageId);

    // Standardized email deleted payload
    const deletedPayload = {
      messageId: data.messageId || data.id,
      threadId: data.threadId,
      reason: data.reason || 'deleted',
      source: data.source,
      timestamp: new Date().toISOString()
    };

    // Broadcast via Socket.IO
    try {
      socketIOService.emailDeleted(userId, {
        id: deletedPayload.messageId,
        threadId: deletedPayload.threadId,
        reason: deletedPayload.reason,
        source: deletedPayload.source
      });
    } catch (error) {
      console.error('Socket.IO email deleted V2 broadcast failed:', error.message);
    }

    // Broadcast via SSE
    try {
      broadcastToUser(userId, {
        type: 'email_deleted',
        ...deletedPayload
      });
    } catch (error) {
      console.error('SSE email deleted V2 broadcast failed:', error.message);
    }
  }

  // V2: Batch email updates for efficiency
  batchEmailUpdates(userId, updates) {
    if (!Array.isArray(updates) || updates.length === 0) return;

    console.log(`📡 Broadcasting batch email updates for user ${userId}: ${updates.length} updates`);

    const batchPayload = {
      type: 'batch_email_updates',
      updates: updates.map(update => ({
        messageId: update.messageId || update.id,
        threadId: update.threadId,
        isRead: update.isRead,
        labels: update.labels,
        action: update.action,
        timestamp: update.timestamp || new Date().toISOString()
      })),
      source: 'batch_update',
      timestamp: new Date().toISOString()
    };

    // Send individual Socket.IO updates for compatibility
    try {
      for (const update of updates) {
        socketIOService.emailUpdated(userId, {
          id: update.messageId || update.id,
          isRead: update.isRead,
          source: 'batch_update'
        });
      }
    } catch (error) {
      console.error('Socket.IO batch updates failed:', error.message);
    }

    // Send as single SSE batch event
    try {
      broadcastToUser(userId, batchPayload);
    } catch (error) {
      console.error('SSE batch updates failed:', error.message);
    }
  }

  // Get stats for monitoring
  getStats() {
    return {
      activeUsers: this.recentBroadcasts.size,
      totalTrackedEvents: Array.from(this.recentBroadcasts.values())
        .reduce((sum, userMap) => sum + userMap.size, 0),
      features: {
        realtime_sync_v2: process.env.REALTIME_SYNC_V2 === 'true'
      }
    };
  }
}

// Export singleton instance
module.exports = new UnifiedBroadcastService();