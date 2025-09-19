// Smart Multi-Layer Caching for 400-1000 users
const redis = require('redis');
const crypto = require('crypto');

class SmartCache {
  constructor() {
    // L1 Cache - Memory (fastest, smallest) - Simple Map implementation
    this.l1Cache = new Map();
    this.l1Config = {
      stdTTL: 5000, // 5 seconds in ms
      maxKeys: 1000 // Limit memory usage
    };

    // L2 Cache - Redis (fast, larger)
    this.l2Cache = null;
    this.initRedis();

    // Cache statistics
    this.stats = {
      l1Hits: 0,
      l1Misses: 0,
      l2Hits: 0,
      l2Misses: 0,
      sets: 0,
      deletes: 0
    };

    // Hot keys tracking
    this.hotKeys = new Map(); // key -> access count
    this.keyAccessTimes = new Map(); // key -> last access time

    // Start analytics
    this.startAnalytics();
  }

  async initRedis() {
    try {
      this.l2Cache = redis.createClient({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            return new Error('Redis server connection refused');
          }
          if (options.times_connected > 10) {
            return undefined;
          }
          return Math.min(options.attempt * 100, 3000);
        }
      });

      this.l2Cache.on('connect', () => {
        console.log('📡 Redis L2 cache connected');
      });

      this.l2Cache.on('error', (err) => {
        console.error('❌ Redis L2 cache error:', err);
      });

    } catch (error) {
      console.error('❌ Failed to initialize Redis:', error);
    }
  }

  // Generate cache key with user context
  generateKey(prefix, userId, ...parts) {
    const keyParts = [prefix, userId, ...parts].filter(Boolean);
    return keyParts.join(':');
  }

  // Hash large keys to prevent Redis key size issues
  hashLargeKey(key) {
    if (key.length > 200) {
      return crypto.createHash('sha256').update(key).digest('hex');
    }
    return key;
  }

  async get(key) {
    const hashedKey = this.hashLargeKey(key);

    // Track key access
    this.trackKeyAccess(hashedKey);

    // L1 Cache check
    const l1Value = this.l1Cache.get(hashedKey);
    if (l1Value !== undefined) {
      this.stats.l1Hits++;
      return l1Value;
    }
    this.stats.l1Misses++;

    // L2 Cache check
    if (this.l2Cache && this.l2Cache.connected) {
      try {
        const l2Value = await new Promise((resolve, reject) => {
          this.l2Cache.get(hashedKey, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });

        if (l2Value !== null) {
          this.stats.l2Hits++;
          const parsed = JSON.parse(l2Value);

          // Promote to L1 cache if it's a hot key
          if (this.isHotKey(hashedKey)) {
            this.l1Cache.set(hashedKey, parsed, 5);
          }

          return parsed;
        }
      } catch (err) {
        console.error('L2 cache get error:', err);
      }
    }

    this.stats.l2Misses++;
    return null;
  }

  async set(key, value, ttlSeconds = 30) {
    const hashedKey = this.hashLargeKey(key);
    this.stats.sets++;

    // Always set in L1 for immediate access
    this.l1Cache.set(hashedKey, value, Math.min(ttlSeconds, 5));

    // Set in L2 cache
    if (this.l2Cache && this.l2Cache.connected) {
      try {
        await new Promise((resolve, reject) => {
          this.l2Cache.setex(hashedKey, ttlSeconds, JSON.stringify(value), (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } catch (err) {
        console.error('L2 cache set error:', err);
      }
    }

    return true;
  }

  async del(pattern) {
    this.stats.deletes++;

    // Delete from L1
    if (pattern.includes('*')) {
      // Pattern deletion
      const keys = this.l1Cache.keys();
      const matchingKeys = keys.filter(key => this.matchPattern(key, pattern));
      matchingKeys.forEach(key => this.l1Cache.del(key));
    } else {
      const hashedKey = this.hashLargeKey(pattern);
      this.l1Cache.del(hashedKey);
    }

    // Delete from L2
    if (this.l2Cache && this.l2Cache.connected) {
      try {
        if (pattern.includes('*')) {
          // Use Redis SCAN for pattern deletion
          const keys = await this.scanKeys(pattern);
          if (keys.length > 0) {
            await new Promise((resolve, reject) => {
              this.l2Cache.del(keys, (err) => {
                if (err) reject(err);
                else resolve();
              });
            });
          }
        } else {
          const hashedKey = this.hashLargeKey(pattern);
          await new Promise((resolve, reject) => {
            this.l2Cache.del(hashedKey, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
      } catch (err) {
        console.error('L2 cache delete error:', err);
      }
    }
  }

  async scanKeys(pattern) {
    return new Promise((resolve, reject) => {
      this.l2Cache.keys(pattern, (err, keys) => {
        if (err) reject(err);
        else resolve(keys || []);
      });
    });
  }

  matchPattern(key, pattern) {
    const regex = pattern.replace(/\*/g, '.*');
    return new RegExp(`^${regex}$`).test(key);
  }

  trackKeyAccess(key) {
    const now = Date.now();
    this.keyAccessTimes.set(key, now);

    const currentCount = this.hotKeys.get(key) || 0;
    this.hotKeys.set(key, currentCount + 1);
  }

  isHotKey(key, threshold = 10) {
    const accessCount = this.hotKeys.get(key) || 0;
    const lastAccess = this.keyAccessTimes.get(key) || 0;
    const isRecent = Date.now() - lastAccess < 60000; // 1 minute

    return accessCount >= threshold && isRecent;
  }

  startAnalytics() {
    // Clean up old access data every 5 minutes
    setInterval(() => {
      const cutoff = Date.now() - 300000; // 5 minutes

      for (const [key, time] of this.keyAccessTimes) {
        if (time < cutoff) {
          this.keyAccessTimes.delete(key);
          this.hotKeys.delete(key);
        }
      }
    }, 300000);

    // Log cache statistics every minute
    setInterval(() => {
      const hitRate = (this.stats.l1Hits + this.stats.l2Hits) /
                     (this.stats.l1Hits + this.stats.l1Misses + this.stats.l2Hits + this.stats.l2Misses) * 100;

      console.log(`📊 Cache Stats: L1 Hit Rate: ${(this.stats.l1Hits / (this.stats.l1Hits + this.stats.l1Misses) * 100).toFixed(1)}%, Overall Hit Rate: ${hitRate.toFixed(1)}%, Hot Keys: ${this.hotKeys.size}`);
    }, 60000);
  }

  getStats() {
    const totalRequests = this.stats.l1Hits + this.stats.l1Misses + this.stats.l2Hits + this.stats.l2Misses;
    const overallHitRate = totalRequests > 0 ?
      (this.stats.l1Hits + this.stats.l2Hits) / totalRequests * 100 : 0;

    return {
      l1: {
        hits: this.stats.l1Hits,
        misses: this.stats.l1Misses,
        hitRate: this.stats.l1Hits > 0 ? this.stats.l1Hits / (this.stats.l1Hits + this.stats.l1Misses) * 100 : 0,
        keys: this.l1Cache.keys().length
      },
      l2: {
        hits: this.stats.l2Hits,
        misses: this.stats.l2Misses,
        hitRate: this.stats.l2Hits > 0 ? this.stats.l2Hits / (this.stats.l2Hits + this.stats.l2Misses) * 100 : 0,
        connected: this.l2Cache ? this.l2Cache.connected : false
      },
      overall: {
        hitRate: overallHitRate,
        sets: this.stats.sets,
        deletes: this.stats.deletes,
        hotKeys: this.hotKeys.size
      }
    };
  }

  // User-specific cache methods
  async getUserInbox(userId, folder = 'inbox', cacheKey = 'default') {
    const key = this.generateKey('inbox', userId, folder, cacheKey);
    return await this.get(key);
  }

  async setUserInbox(userId, folder, cacheKey, data, ttl = 30) {
    const key = this.generateKey('inbox', userId, folder, cacheKey);
    return await this.set(key, data, ttl);
  }

  async getUserThread(userId, threadId) {
    const key = this.generateKey('thread', userId, threadId);
    return await this.get(key);
  }

  async setUserThread(userId, threadId, data, ttl = 300) {
    const key = this.generateKey('thread', userId, threadId);
    return await this.set(key, data, ttl);
  }

  async invalidateUser(userId, pattern = '*') {
    const deletePattern = this.generateKey(pattern, userId);
    await this.del(deletePattern);
  }
}

module.exports = new SmartCache();