const Redis = require('redis');
const fs = require('fs');
const path = require('path');

class RedisClient {
  constructor() {
    this.client = null;
    this.luaScripts = new Map();
    this.scriptSHAs = new Map();
  }

  async connect() {
    if (this.client) return this.client;

    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    console.log(`🔗 Connecting to Redis: ${redisUrl}`);

    this.client = Redis.createClient({
      url: redisUrl,
      retry_unfulfilled_commands: true,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error('❌ Redis max reconnect attempts reached');
            return false;
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    this.client.on('error', (err) => {
      console.error('❌ Redis Client Error:', err);
    });

    this.client.on('connect', () => {
      console.log('✅ Redis Client Connected');
    });

    this.client.on('disconnect', () => {
      console.log('🔌 Redis Client Disconnected');
    });

    await this.client.connect();

    // Load Lua scripts
    await this.loadLuaScripts();

    return this.client;
  }

  async loadLuaScripts() {
    const luaDir = path.join(__dirname, 'lua');

    // Ensure lua directory exists
    if (!fs.existsSync(luaDir)) {
      fs.mkdirSync(luaDir, { recursive: true });
    }

    // Load atomic count delta script
    const atomicCountDeltaScript = `
-- KEYS[1] = unread_count key
-- ARGV[1] = delta (integer)
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local delta = tonumber(ARGV[1])
local next = current + delta
if next < 0 then next = 0 end
redis.call('SET', KEYS[1], next)
return next
`;

    // Load set if newer timestamp script
    const setIfNewerTsScript = `
-- KEYS[1] = recent_local_change_until
-- ARGV[1] = newUntilTs (epoch ms)
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local incoming = tonumber(ARGV[1])
if incoming > current then
  redis.call('SET', KEYS[1], incoming)
  return incoming
end
return current
`;

    this.luaScripts.set('atomicCountDelta', atomicCountDeltaScript);
    this.luaScripts.set('setIfNewerTs', setIfNewerTsScript);

    // Register scripts with Redis and cache their SHAs
    for (const [name, script] of this.luaScripts.entries()) {
      try {
        const sha = await this.client.scriptLoad(script);
        this.scriptSHAs.set(name, sha);
        console.log(`📜 Loaded Lua script '${name}' with SHA: ${sha.substring(0, 8)}...`);
      } catch (error) {
        console.error(`❌ Failed to load Lua script '${name}':`, error);
      }
    }
  }

  async get(key) {
    if (!this.client) await this.connect();
    return this.client.get(key);
  }

  async set(key, value, options = {}) {
    if (!this.client) await this.connect();

    if (options.ttl) {
      return this.client.setEx(key, options.ttl, value);
    } else if (options.px) {
      return this.client.pSetEx(key, options.px, value);
    } else {
      return this.client.set(key, value);
    }
  }

  async del(key) {
    if (!this.client) await this.connect();
    return this.client.del(key);
  }

  async exists(key) {
    if (!this.client) await this.connect();
    return this.client.exists(key);
  }

  async incr(key) {
    if (!this.client) await this.connect();
    return this.client.incr(key);
  }

  async decr(key) {
    if (!this.client) await this.connect();
    return this.client.decr(key);
  }

  async incrBy(key, increment) {
    if (!this.client) await this.connect();
    return this.client.incrBy(key, increment);
  }

  async expire(key, seconds) {
    if (!this.client) await this.connect();
    return this.client.expire(key, seconds);
  }

  async ttl(key) {
    if (!this.client) await this.connect();
    return this.client.ttl(key);
  }

  async evalsha(scriptName, keys = [], args = []) {
    if (!this.client) await this.connect();

    const sha = this.scriptSHAs.get(scriptName);
    if (!sha) {
      throw new Error(`Lua script '${scriptName}' not found. Available scripts: ${Array.from(this.scriptSHAs.keys()).join(', ')}`);
    }

    try {
      return await this.client.evalSha(sha, {
        keys: keys,
        arguments: args
      });
    } catch (error) {
      // If script not in cache, reload and retry
      if (error.message.includes('NOSCRIPT')) {
        console.log(`🔄 Reloading Lua script '${scriptName}' due to NOSCRIPT error`);
        await this.loadLuaScripts();
        const newSha = this.scriptSHAs.get(scriptName);
        return await this.client.evalSha(newSha, {
          keys: keys,
          arguments: args
        });
      }
      throw error;
    }
  }

  async eval(script, keys = [], args = []) {
    if (!this.client) await this.connect();
    return this.client.eval(script, {
      keys: keys,
      arguments: args
    });
  }

  async flushall() {
    if (!this.client) await this.connect();
    return this.client.flushAll();
  }

  async ping() {
    if (!this.client) await this.connect();
    return this.client.ping();
  }

  async close() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  // Health check
  async isHealthy() {
    try {
      await this.ping();
      return true;
    } catch (error) {
      console.error('Redis health check failed:', error);
      return false;
    }
  }

  // Get client stats
  getStats() {
    return {
      connected: this.client?.isReady || false,
      loadedScripts: this.scriptSHAs.size,
      availableScripts: Array.from(this.scriptSHAs.keys())
    };
  }
}

// Export singleton instance
module.exports = new RedisClient();