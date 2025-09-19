// Enhanced SSE Connection Manager for 400-1000 users
const EventEmitter = require('events');

class ConnectionManager extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map(); // userId -> connection info
    this.maxConnections = 200; // Limit concurrent connections
    this.connectionQueues = new Map(); // userId -> queued messages
    this.heartbeatInterval = 30000; // 30 seconds
    this.cleanupInterval = 60000; // 1 minute
    this.userActivity = new Map(); // userId -> last activity timestamp

    // Start cleanup processes
    this.startHeartbeat();
    this.startCleanup();
  }

  addConnection(userId, res, req) {
    // Check if we're at connection limit
    if (this.connections.size >= this.maxConnections) {
      // Remove oldest inactive connection
      this.removeOldestConnection();
    }

    // Close existing connection for this user if any
    if (this.connections.has(userId)) {
      this.removeConnection(userId);
    }

    const connection = {
      userId,
      response: res,
      request: req,
      connectedAt: Date.now(),
      lastPing: Date.now(),
      isActive: true
    };

    this.connections.set(userId, connection);
    this.userActivity.set(userId, Date.now());

    // Send queued messages
    this.sendQueuedMessages(userId);

    // Setup connection close handlers
    req.on('close', () => this.removeConnection(userId));
    req.on('error', () => this.removeConnection(userId));

    console.log(`📡 SSE connection added for user ${userId}. Total: ${this.connections.size}`);
    this.emit('connectionAdded', userId);

    return connection;
  }

  removeConnection(userId) {
    const connection = this.connections.get(userId);
    if (connection) {
      try {
        if (!connection.response.headersSent) {
          connection.response.end();
        }
      } catch (err) {
        // Connection already closed
      }

      this.connections.delete(userId);
      console.log(`📡 SSE connection removed for user ${userId}. Total: ${this.connections.size}`);
      this.emit('connectionRemoved', userId);
    }
  }

  removeOldestConnection() {
    let oldestUserId = null;
    let oldestTime = Date.now();

    for (const [userId, connection] of this.connections) {
      const lastActivity = this.userActivity.get(userId) || connection.connectedAt;
      if (lastActivity < oldestTime) {
        oldestTime = lastActivity;
        oldestUserId = userId;
      }
    }

    if (oldestUserId) {
      console.log(`📡 Removing oldest connection for user ${oldestUserId}`);
      this.removeConnection(oldestUserId);
    }
  }

  broadcastToUser(userId, message) {
    this.userActivity.set(userId, Date.now());

    const connection = this.connections.get(userId);
    if (connection && connection.isActive) {
      try {
        const data = JSON.stringify(message);
        connection.response.write(`data: ${data}\n\n`);
        connection.lastPing = Date.now();
        return true;
      } catch (err) {
        console.error(`Failed to send message to user ${userId}:`, err);
        this.removeConnection(userId);
        this.queueMessage(userId, message);
        return false;
      }
    } else {
      // Queue message for when user reconnects
      this.queueMessage(userId, message);
      return false;
    }
  }

  queueMessage(userId, message) {
    if (!this.connectionQueues.has(userId)) {
      this.connectionQueues.set(userId, []);
    }

    const queue = this.connectionQueues.get(userId);
    queue.push({
      message,
      timestamp: Date.now()
    });

    // Limit queue size to prevent memory issues
    if (queue.length > 50) {
      queue.splice(0, queue.length - 50);
    }
  }

  sendQueuedMessages(userId) {
    const queue = this.connectionQueues.get(userId);
    if (!queue || queue.length === 0) return;

    const connection = this.connections.get(userId);
    if (!connection) return;

    console.log(`📦 Sending ${queue.length} queued messages to user ${userId}`);

    for (const { message } of queue) {
      try {
        const data = JSON.stringify(message);
        connection.response.write(`data: ${data}\n\n`);
      } catch (err) {
        console.error(`Failed to send queued message to user ${userId}:`, err);
        break;
      }
    }

    // Clear the queue
    this.connectionQueues.delete(userId);
  }

  startHeartbeat() {
    setInterval(() => {
      const now = Date.now();
      const staleConnections = [];

      for (const [userId, connection] of this.connections) {
        // Send heartbeat
        try {
          connection.response.write(`data: {"type":"heartbeat","timestamp":${now}}\n\n`);

          // Check if connection is stale (no response for 2 minutes)
          if (now - connection.lastPing > 120000) {
            staleConnections.push(userId);
          }
        } catch (err) {
          staleConnections.push(userId);
        }
      }

      // Remove stale connections
      staleConnections.forEach(userId => {
        console.log(`💔 Removing stale connection for user ${userId}`);
        this.removeConnection(userId);
      });

    }, this.heartbeatInterval);
  }

  startCleanup() {
    setInterval(() => {
      // Clean up old queued messages (older than 5 minutes)
      const cutoff = Date.now() - 300000; // 5 minutes

      for (const [userId, queue] of this.connectionQueues) {
        const filtered = queue.filter(item => item.timestamp > cutoff);
        if (filtered.length !== queue.length) {
          if (filtered.length === 0) {
            this.connectionQueues.delete(userId);
          } else {
            this.connectionQueues.set(userId, filtered);
          }
        }
      }

      // Clean up old user activity records
      for (const [userId, lastActivity] of this.userActivity) {
        if (Date.now() - lastActivity > 3600000) { // 1 hour
          this.userActivity.delete(userId);
        }
      }

    }, this.cleanupInterval);
  }

  getStats() {
    return {
      activeConnections: this.connections.size,
      queuedMessages: Array.from(this.connectionQueues.values()).reduce((sum, queue) => sum + queue.length, 0),
      trackedUsers: this.userActivity.size,
      maxConnections: this.maxConnections
    };
  }

  isUserActive(userId) {
    const lastActivity = this.userActivity.get(userId);
    if (!lastActivity) return false;
    return Date.now() - lastActivity < 300000; // 5 minutes
  }

  getActiveUsers() {
    return Array.from(this.userActivity.keys()).filter(userId => this.isUserActive(userId));
  }
}

module.exports = new ConnectionManager();