// Performance Monitoring Routes for 400-1000 users
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const connectionManager = require('../lib/connectionManager');
const smartCache = require('../lib/smartCache');
const jobQueue = require('../lib/jobQueue');
const rateLimiter = require('../lib/rateLimiter');

const router = express.Router();

// Get comprehensive system metrics
router.get('/metrics', requireAuth, (req, res) => {
  const metrics = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    system: {
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      version: process.version,
      platform: process.platform
    },
    connections: connectionManager.getStats(),
    cache: smartCache.getStats(),
    jobs: jobQueue.getStats(),
    rateLimits: rateLimiter.getStats()
  };

  res.json(metrics);
});

// Get user-specific metrics
router.get('/user/:userId', requireAuth, async (req, res) => {
  try {
    const userId = req.params.userId;

    // Verify user can access their own data or is admin
    const requestingUserId = String(req.auth?.sub);
    if (userId !== requestingUserId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const userMetrics = {
      userId,
      timestamp: new Date().toISOString(),
      isActive: connectionManager.isUserActive(userId),
      rateLimits: await rateLimiter.getUserUsage(userId),
      cache: {
        // User-specific cache stats would go here
        // This would require modifications to smartCache to track per-user stats
      }
    };

    res.json(userMetrics);
  } catch (error) {
    console.error('Error fetching user metrics:', error);
    res.status(500).json({ error: 'Failed to fetch user metrics' });
  }
});

// Health check with detailed status
router.get('/health', (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      connections: {
        status: connectionManager.getStats().activeConnections < connectionManager.maxConnections ? 'healthy' : 'degraded',
        active: connectionManager.getStats().activeConnections,
        max: connectionManager.maxConnections
      },
      cache: {
        status: smartCache.getStats().overall.hitRate > 70 ? 'healthy' : 'degraded',
        hitRate: smartCache.getStats().overall.hitRate,
        l2Connected: smartCache.getStats().l2.connected
      },
      jobs: {
        status: jobQueue.getStats().queues.total < 1000 ? 'healthy' : 'degraded',
        queueSize: jobQueue.getStats().queues.total,
        activeWorkers: jobQueue.getStats().workers.totalActive
      }
    }
  };

  // Determine overall health
  const serviceStatuses = Object.values(health.services).map(service => service.status);
  if (serviceStatuses.some(status => status === 'unhealthy')) {
    health.status = 'unhealthy';
    res.status(503);
  } else if (serviceStatuses.some(status => status === 'degraded')) {
    health.status = 'degraded';
    res.status(200); // Still accepting traffic but with warnings
  }

  res.json(health);
});

// Performance alerts endpoint
router.get('/alerts', requireAuth, (req, res) => {
  const alerts = [];
  const stats = {
    connections: connectionManager.getStats(),
    cache: smartCache.getStats(),
    jobs: jobQueue.getStats(),
    memory: process.memoryUsage()
  };

  // Connection alerts
  if (stats.connections.activeConnections > stats.connections.maxConnections * 0.9) {
    alerts.push({
      level: 'warning',
      type: 'connections',
      message: `High connection usage: ${stats.connections.activeConnections}/${stats.connections.maxConnections}`,
      timestamp: new Date().toISOString()
    });
  }

  // Cache alerts
  if (stats.cache.overall.hitRate < 70) {
    alerts.push({
      level: 'warning',
      type: 'cache',
      message: `Low cache hit rate: ${stats.cache.overall.hitRate}%`,
      timestamp: new Date().toISOString()
    });
  }

  if (!stats.cache.l2.connected) {
    alerts.push({
      level: 'error',
      type: 'cache',
      message: 'Redis L2 cache disconnected',
      timestamp: new Date().toISOString()
    });
  }

  // Job queue alerts
  if (stats.jobs.queues.total > 1000) {
    alerts.push({
      level: 'warning',
      type: 'jobs',
      message: `High job queue size: ${stats.jobs.queues.total}`,
      timestamp: new Date().toISOString()
    });
  }

  // Memory alerts
  const memoryUsagePercent = (stats.memory.heapUsed / stats.memory.heapTotal) * 100;
  if (memoryUsagePercent > 85) {
    alerts.push({
      level: 'warning',
      type: 'memory',
      message: `High memory usage: ${memoryUsagePercent.toFixed(1)}%`,
      timestamp: new Date().toISOString()
    });
  }

  res.json({
    alerts,
    alertCount: alerts.length,
    timestamp: new Date().toISOString()
  });
});

// Manual operations for admins
router.post('/operations/reset-user-limits/:userId', requireAuth, async (req, res) => {
  try {
    const userId = req.params.userId;

    // Admin check would go here in production
    // For now, allow users to reset their own limits
    const requestingUserId = String(req.auth?.sub);
    if (userId !== requestingUserId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await rateLimiter.resetUserLimits(userId);

    res.json({
      message: `Rate limits reset for user ${userId}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error resetting user limits:', error);
    res.status(500).json({ error: 'Failed to reset rate limits' });
  }
});

router.post('/operations/clear-cache', requireAuth, async (req, res) => {
  try {
    const userId = String(req.auth?.sub);
    const { pattern } = req.body;

    // Clear user's own cache or specific pattern
    await smartCache.invalidateUser(userId, pattern);

    res.json({
      message: `Cache cleared for user ${userId}`,
      pattern: pattern || '*',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

// Real-time metrics stream (SSE)
router.get('/stream', requireAuth, (req, res) => {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  const userId = String(req.auth?.sub);

  // Send initial metrics
  const sendMetrics = () => {
    const metrics = {
      connections: connectionManager.getStats(),
      cache: smartCache.getStats(),
      jobs: jobQueue.getStats(),
      memory: process.memoryUsage(),
      timestamp: Date.now()
    };

    res.write(`data: ${JSON.stringify(metrics)}\n\n`);
  };

  // Send metrics immediately
  sendMetrics();

  // Send metrics every 30 seconds
  const interval = setInterval(sendMetrics, 30000);

  // Handle client disconnect
  req.on('close', () => {
    clearInterval(interval);
    console.log(`📊 Metrics stream closed for user ${userId}`);
  });

  req.on('error', () => {
    clearInterval(interval);
  });

  console.log(`📊 Metrics stream started for user ${userId}`);
});

// Export current configuration
router.get('/config', requireAuth, (req, res) => {
  const config = {
    connections: {
      maxConnections: connectionManager.maxConnections,
      heartbeatInterval: 30000,
      cleanupInterval: 60000
    },
    cache: {
      l1TTL: 5000,
      l2TTL: 30000,
      maxKeys: 1000
    },
    jobs: {
      workers: jobQueue.getStats().workers,
      rateLimits: {
        maxJobsPerUserPerMinute: 60
      }
    },
    rateLimits: rateLimiter.limits
  };

  res.json(config);
});

module.exports = router;