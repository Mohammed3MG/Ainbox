// Advanced Rate Limiter for API Management (400-1000 users)
const redis = require('redis');

class RateLimiter {
  constructor() {
    this.client = null;
    this.fallbackMemory = new Map(); // Fallback when Redis is unavailable
    this.initRedis();

    // Rate limit configurations
    this.limits = {
      gmail: {
        perUser: { requests: 250, window: 100 }, // 250 requests per 100 seconds per user
        global: { requests: 40000, window: 86400 } // 40k requests per day globally
      },
      outlook: {
        perUser: { requests: 10000, window: 600 }, // 10k requests per 10 minutes per user
        global: { requests: 100000, window: 86400 } // 100k requests per day globally
      },
      api: {
        perUser: { requests: 1000, window: 3600 }, // 1k API calls per hour per user
        perIP: { requests: 5000, window: 3600 } // 5k API calls per hour per IP
      }
    };

    // Track global usage
    this.globalCounters = new Map();
    this.startGlobalTracking();
  }

  async initRedis() {
    try {
      this.client = redis.createClient({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379
      });

      this.client.on('connect', () => {
        console.log('🚀 Rate limiter Redis connected');
      });

      this.client.on('error', (err) => {
        console.error('❌ Rate limiter Redis error:', err);
        console.log('📝 Falling back to memory-based rate limiting');
      });

    } catch (error) {
      console.error('❌ Failed to initialize Redis for rate limiter:', error);
    }
  }

  // Check if request is within rate limits
  async checkLimit(type, identifier, customLimits = null) {
    const limits = customLimits || this.limits[type];
    if (!limits) {
      throw new Error(`Unknown rate limit type: ${type}`);
    }

    const key = `ratelimit:${type}:${identifier}`;
    const now = Date.now();
    const windowStart = now - (limits.window * 1000);

    try {
      if (this.client && this.client.connected) {
        return await this.checkRedisLimit(key, limits, now, windowStart);
      } else {
        return await this.checkMemoryLimit(key, limits, now, windowStart);
      }
    } catch (error) {
      console.error('Rate limit check error:', error);
      // On error, allow the request but log it
      return { allowed: true, remaining: limits.requests, resetTime: now + (limits.window * 1000) };
    }
  }

  // Redis-based rate limiting (preferred)
  async checkRedisLimit(key, limits, now, windowStart) {
    return new Promise((resolve, reject) => {
      // Use Redis sorted sets for sliding window
      const multi = this.client.multi();

      // Remove expired entries
      multi.zremrangebyscore(key, '-inf', windowStart);

      // Count current requests
      multi.zcard(key);

      // Add current request
      multi.zadd(key, now, `${now}-${Math.random()}`);

      // Set expiry
      multi.expire(key, limits.window + 60); // Extra buffer

      multi.exec((err, results) => {
        if (err) {
          reject(err);
          return;
        }

        const currentCount = results[1] || 0;
        const allowed = currentCount < limits.requests;
        const resetTime = now + (limits.window * 1000);

        if (!allowed) {
          // Remove the request we just added since it's not allowed
          this.client.zrem(key, `${now}-${Math.random()}`);
        }

        resolve({
          allowed,
          remaining: Math.max(0, limits.requests - currentCount - 1),
          resetTime,
          currentCount: currentCount + (allowed ? 1 : 0)
        });
      });
    });
  }

  // Memory-based fallback rate limiting
  async checkMemoryLimit(key, limits, now, windowStart) {
    let requests = this.fallbackMemory.get(key) || [];

    // Remove expired requests
    requests = requests.filter(timestamp => timestamp > windowStart);

    const allowed = requests.length < limits.requests;

    if (allowed) {
      requests.push(now);
    }

    this.fallbackMemory.set(key, requests);

    return {
      allowed,
      remaining: Math.max(0, limits.requests - requests.length),
      resetTime: now + (limits.window * 1000),
      currentCount: requests.length
    };
  }

  // Check Gmail API limits
  async checkGmailLimit(userId) {
    const userLimit = await this.checkLimit('gmail', `user:${userId}`, this.limits.gmail.perUser);
    const globalLimit = await this.checkGlobalLimit('gmail');

    return {
      allowed: userLimit.allowed && globalLimit.allowed,
      userRemaining: userLimit.remaining,
      globalRemaining: globalLimit.remaining,
      resetTime: Math.max(userLimit.resetTime, globalLimit.resetTime),
      limitedBy: !userLimit.allowed ? 'user' : !globalLimit.allowed ? 'global' : null
    };
  }

  // Check Outlook API limits
  async checkOutlookLimit(userId) {
    const userLimit = await this.checkLimit('outlook', `user:${userId}`, this.limits.outlook.perUser);
    const globalLimit = await this.checkGlobalLimit('outlook');

    return {
      allowed: userLimit.allowed && globalLimit.allowed,
      userRemaining: userLimit.remaining,
      globalRemaining: globalLimit.remaining,
      resetTime: Math.max(userLimit.resetTime, globalLimit.resetTime),
      limitedBy: !userLimit.allowed ? 'user' : !globalLimit.allowed ? 'global' : null
    };
  }

  // Check general API limits
  async checkApiLimit(userId, userIP) {
    const userLimit = await this.checkLimit('api', `user:${userId}`, this.limits.api.perUser);
    const ipLimit = await this.checkLimit('api', `ip:${userIP}`, this.limits.api.perIP);

    return {
      allowed: userLimit.allowed && ipLimit.allowed,
      userRemaining: userLimit.remaining,
      ipRemaining: ipLimit.remaining,
      resetTime: Math.max(userLimit.resetTime, ipLimit.resetTime),
      limitedBy: !userLimit.allowed ? 'user' : !ipLimit.allowed ? 'ip' : null
    };
  }

  // Check global limits
  async checkGlobalLimit(provider) {
    const globalLimits = this.limits[provider].global;
    return await this.checkLimit(provider, 'global', globalLimits);
  }

  // Express middleware for rate limiting
  createMiddleware(type = 'api') {
    return async (req, res, next) => {
      try {
        const userId = req.auth?.sub || 'anonymous';
        const userIP = req.ip || req.connection.remoteAddress;

        let result;

        switch (type) {
          case 'gmail':
            result = await this.checkGmailLimit(userId);
            break;
          case 'outlook':
            result = await this.checkOutlookLimit(userId);
            break;
          case 'api':
          default:
            result = await this.checkApiLimit(userId, userIP);
            break;
        }

        // Add rate limit headers
        res.set({
          'X-RateLimit-Allowed': result.allowed,
          'X-RateLimit-User-Remaining': result.userRemaining || result.remaining,
          'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
          'X-RateLimit-Limited-By': result.limitedBy || 'none'
        });

        if (!result.allowed) {
          const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
          res.set('Retry-After', retryAfter);

          return res.status(429).json({
            error: 'Rate limit exceeded',
            message: `Too many requests from ${result.limitedBy}`,
            retryAfter,
            resetTime: new Date(result.resetTime).toISOString()
          });
        }

        // Store rate limit info for logging
        req.rateLimit = result;
        next();

      } catch (error) {
        console.error('Rate limiting middleware error:', error);
        // On error, allow the request to proceed
        next();
      }
    };
  }

  // Start global tracking for analytics
  startGlobalTracking() {
    setInterval(() => {
      this.updateGlobalStats();
    }, 60000); // Every minute
  }

  async updateGlobalStats() {
    try {
      const providers = ['gmail', 'outlook'];

      for (const provider of providers) {
        const globalLimit = await this.checkGlobalLimit(provider);
        const usage = this.limits[provider].global.requests - globalLimit.remaining;

        this.globalCounters.set(provider, {
          usage,
          limit: this.limits[provider].global.requests,
          remaining: globalLimit.remaining,
          usagePercentage: (usage / this.limits[provider].global.requests * 100).toFixed(1),
          resetTime: globalLimit.resetTime
        });
      }
    } catch (error) {
      console.error('Failed to update global stats:', error);
    }
  }

  // Get comprehensive statistics
  getStats() {
    const stats = {
      redis: {
        connected: this.client ? this.client.connected : false,
        memoryFallback: !this.client || !this.client.connected
      },
      limits: this.limits,
      global: Object.fromEntries(this.globalCounters),
      memory: {
        keys: this.fallbackMemory.size,
        fallbackActive: !this.client || !this.client.connected
      }
    };

    return stats;
  }

  // Manual rate limit override (admin function)
  async resetUserLimits(userId) {
    const patterns = [
      `ratelimit:gmail:user:${userId}`,
      `ratelimit:outlook:user:${userId}`,
      `ratelimit:api:user:${userId}`
    ];

    if (this.client && this.client.connected) {
      for (const pattern of patterns) {
        this.client.del(pattern);
      }
    } else {
      for (const pattern of patterns) {
        this.fallbackMemory.delete(pattern);
      }
    }

    console.log(`🔄 Reset rate limits for user ${userId}`);
  }

  // Get user's current usage
  async getUserUsage(userId) {
    const usage = {};

    for (const type of ['gmail', 'outlook', 'api']) {
      const key = `ratelimit:${type}:user:${userId}`;
      const limits = this.limits[type].perUser || this.limits[type];

      try {
        if (this.client && this.client.connected) {
          const count = await new Promise((resolve, reject) => {
            this.client.zcard(key, (err, result) => {
              if (err) reject(err);
              else resolve(result || 0);
            });
          });

          usage[type] = {
            used: count,
            limit: limits.requests,
            remaining: Math.max(0, limits.requests - count),
            percentage: (count / limits.requests * 100).toFixed(1)
          };
        } else {
          const requests = this.fallbackMemory.get(key) || [];
          usage[type] = {
            used: requests.length,
            limit: limits.requests,
            remaining: Math.max(0, limits.requests - requests.length),
            percentage: (requests.length / limits.requests * 100).toFixed(1)
          };
        }
      } catch (error) {
        usage[type] = { error: error.message };
      }
    }

    return usage;
  }
}

module.exports = new RateLimiter();