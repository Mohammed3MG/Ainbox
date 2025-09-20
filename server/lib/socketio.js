// Socket.IO real-time communication service with Redis scaling support
const { Server } = require('socket.io');

// Make Redis adapter optional
let createAdapter = null;
try {
  createAdapter = require('@socket.io/redis-adapter').createAdapter;
} catch (error) {
  console.warn('⚠️ Redis adapter not available, running without Redis scaling');
}

class SocketIOService {
  constructor() {
    this.io = null;
    this.userSockets = new Map(); // userId -> Set<socketId>
    this.socketUsers = new Map(); // socketId -> userId
    this.redisAdapter = null;
  }

  // Initialize Socket.IO with HTTP server
  initialize(httpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: true, // Allow all origins in development
        credentials: true,
        methods: ["GET", "POST"]
      },
      transports: ['websocket', 'polling']
    });

    // Set up Redis adapter for scaling (optional)
    this.setupRedisAdapter();

    // Handle connections
    this.io.on('connection', (socket) => {
      console.log(`🔌 Socket connected: ${socket.id}`);

      // Handle authentication
      socket.on('authenticate', (data) => {
        this.authenticateSocket(socket, data);
      });

      // Handle user joining rooms
      socket.on('join_user_room', (userId) => {
        this.addUserSocket(userId, socket);
      });

      // Handle bidirectional email actions
      socket.on('email_action', (data) => {
        this.handleEmailAction(socket, data);
      });

      // Handle sync requests
      socket.on('request_sync', (data) => {
        this.handleSyncRequest(socket, data);
      });

      // Handle disconnect
      socket.on('disconnect', (reason) => {
        console.log(`🔌 Socket disconnected: ${socket.id}, reason: ${reason}`);
        this.removeSocket(socket);
      });

      // Send welcome message
      socket.emit('connected', {
        message: 'Connected to Ainbox real-time service',
        socketId: socket.id,
        timestamp: Date.now()
      });
    });

    console.log('🚀 Socket.IO service initialized');
    return this.io;
  }

  // Set up Redis adapter for horizontal scaling
  async setupRedisAdapter() {
    try {
      if (process.env.REDIS_URL && createAdapter) {
        const { createClient } = require('redis');
        const pubClient = createClient({ url: process.env.REDIS_URL });
        const subClient = pubClient.duplicate();

        await Promise.all([
          pubClient.connect(),
          subClient.connect()
        ]);

        this.redisAdapter = createAdapter(pubClient, subClient);
        this.io.adapter(this.redisAdapter);
        console.log('✅ Socket.IO Redis adapter configured');
      } else {
        console.log('📡 Socket.IO running without Redis adapter');
      }
    } catch (error) {
      console.warn('⚠️  Socket.IO Redis adapter setup failed:', error.message);
    }
  }

  // Authenticate socket with user credentials
  authenticateSocket(socket, data) {
    const { userId, token } = data;

    // Basic authentication - in production you'd validate the token
    if (userId && token) {
      socket.userId = userId;
      socket.authenticated = true;

      // Join user-specific room
      socket.join(`user:${userId}`);
      this.addUserSocket(userId, socket);

      socket.emit('authenticated', {
        success: true,
        userId,
        timestamp: Date.now()
      });

      console.log(`✅ Socket ${socket.id} authenticated for user ${userId}`);
    } else {
      socket.emit('authentication_error', {
        error: 'Invalid credentials'
      });
    }
  }

  // Add socket to user tracking
  addUserSocket(userId, socket) {
    const userIdStr = String(userId);

    // Track socket -> user mapping
    this.socketUsers.set(socket.id, userIdStr);

    // Track user -> sockets mapping
    if (!this.userSockets.has(userIdStr)) {
      this.userSockets.set(userIdStr, new Set());
    }
    this.userSockets.get(userIdStr).add(socket.id);

    console.log(`👤 User ${userIdStr} connected via socket ${socket.id}`);
  }

  // Remove socket from tracking
  removeSocket(socket) {
    const userId = this.socketUsers.get(socket.id);

    if (userId) {
      // Remove from user -> sockets mapping
      const userSocketSet = this.userSockets.get(userId);
      if (userSocketSet) {
        userSocketSet.delete(socket.id);
        if (userSocketSet.size === 0) {
          this.userSockets.delete(userId);
        }
      }

      // Remove from socket -> user mapping
      this.socketUsers.delete(socket.id);

      console.log(`👤 User ${userId} disconnected from socket ${socket.id}`);
    }
  }

  // Handle email actions from client
  handleEmailAction(socket, data) {
    const { action, emailIds, provider } = data;
    const userId = socket.userId;

    if (!socket.authenticated || !userId) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    console.log(`📧 Email action from client: ${action} on ${emailIds?.length || 0} emails`);

    // Broadcast action to other user sessions
    this.broadcastToUser(userId, 'email_action_broadcast', {
      action,
      emailIds,
      provider,
      source: 'client_action',
      fromSocket: socket.id,
      timestamp: Date.now()
    }, socket.id); // Exclude the sender socket
  }

  // Handle sync requests
  handleSyncRequest(socket, data) {
    const { provider, forceSync } = data;
    const userId = socket.userId;

    if (!socket.authenticated || !userId) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    console.log(`🔄 Sync request from client: ${provider}, force: ${forceSync}`);

    // Trigger sync and respond
    socket.emit('sync_response', {
      provider,
      status: 'initiated',
      timestamp: Date.now()
    });
  }

  // Broadcast to specific user (all their connected sockets)
  broadcastToUser(userId, event, data, excludeSocketId = null) {
    const userIdStr = String(userId);
    const userSocketIds = this.userSockets.get(userIdStr);

    if (!userSocketIds || userSocketIds.size === 0) {
      console.log(`📡 No sockets found for user ${userIdStr}`);
      return 0;
    }

    let broadcastCount = 0;
    for (const socketId of userSocketIds) {
      if (excludeSocketId && socketId === excludeSocketId) {
        continue; // Skip the sender socket
      }

      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit(event, data);
        broadcastCount++;
      }
    }

    console.log(`📡 Broadcasted ${event} to ${broadcastCount} sockets for user ${userIdStr}`);
    return broadcastCount;
  }

  // Broadcast to all connected users
  broadcastToAll(event, data) {
    this.io.emit(event, data);
    console.log(`📡 Broadcasted ${event} to all connected users`);
  }

  // Send email update notification
  emailUpdated(userId, emailData) {
    this.broadcastToUser(userId, 'email_updated', {
      type: 'email_updated',
      email: emailData,
      timestamp: Date.now(),
      source: emailData.source || 'server_update'
    });
  }

  // Send new email notification
  newEmail(userId, emailData) {
    this.broadcastToUser(userId, 'new_email', {
      type: 'new_email',
      email: emailData,
      timestamp: Date.now(),
      source: 'external_arrival'
    });
  }

  // Send count update notification
  countUpdated(userId, counts, source = 'server_update') {
    this.broadcastToUser(userId, 'unread_count_updated', {
      type: 'unread_count_updated',
      unread: counts.unread,
      total: counts.total,
      timestamp: Date.now(),
      source
    });
  }

  // Send email deletion notification
  emailDeleted(userId, emailData) {
    this.broadcastToUser(userId, 'email_deleted', {
      type: 'email_deleted',
      emailId: emailData.id,
      timestamp: emailData.timestamp,
      source: emailData.source || 'external_deletion'
    });
  }

  // Get service statistics
  getStats() {
    return {
      connectedSockets: this.io.engine.clientsCount,
      authenticatedUsers: this.userSockets.size,
      totalRooms: this.io.sockets.adapter.rooms.size,
      redisAdapter: !!this.redisAdapter
    };
  }

  // Graceful shutdown
  async shutdown() {
    if (this.io) {
      console.log('🛑 Shutting down Socket.IO service...');
      this.io.close();
      this.userSockets.clear();
      this.socketUsers.clear();
    }
  }
}

// Export singleton instance
module.exports = new SocketIOService();