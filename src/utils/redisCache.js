let Redis;
try {
  Redis = require('ioredis');
} catch (_e) {
  Redis = null;
}

const logger = require('../config/logger');

// ---------------------------------------------------------------------------
// In-memory fallback cache (used when Redis is unavailable)
// ---------------------------------------------------------------------------
const memStore = new Map();

const memGet = (key) => {
  const entry = memStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { memStore.delete(key); return null; }
  return entry.value;
};

const memSet = (key, value, ttlSeconds) => {
  memStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
};

const memDel = (key) => memStore.delete(key);

const memDeleteByPattern = (pattern) => {
  // Convert glob-style pattern (e.g. "prefix:*") to regex
  const regex = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  for (const key of memStore.keys()) {
    if (regex.test(key)) memStore.delete(key);
  }
};

// Cleanup expired entries every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memStore.entries()) {
    if (now > entry.expiresAt) memStore.delete(key);
  }
}, 120000);

// ---------------------------------------------------------------------------
// Redis client
// ---------------------------------------------------------------------------
class RedisCache {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this._init();
  }

  _init() {
    if (!Redis) {
      logger.warn('ioredis not installed — using in-memory cache fallback');
      return;
    }

    const redisUrl = process.env.REDIS_URL;
    const redisConfig = redisUrl ? redisUrl : {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      lazyConnect: true,
      keepAlive: 30000,
      connectTimeout: 5000,
      commandTimeout: 3000,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        // Stop retrying after 3 attempts; fall back to memory cache
        if (times > 3) return null;
        return Math.min(times * 200, 1000);
      },
    };

    try {
      this.client = new Redis(redisConfig);

      this.client.on('connect', () => {
        this.isConnected = true;
        logger.info('Redis connected');
      });

      this.client.on('ready', () => {
        this.isConnected = true;
      });

      this.client.on('error', (err) => {
        if (this.isConnected) {
          logger.warn('Redis error — falling back to in-memory cache:', err.message);
        }
        this.isConnected = false;
      });

      this.client.on('close', () => {
        this.isConnected = false;
      });

      // Attempt connection but don't crash if it fails
      this.client.connect().catch((err) => {
        logger.warn('Redis unavailable — using in-memory cache fallback:', err.message);
        this.isConnected = false;
      });
    } catch (err) {
      logger.warn('Redis init failed — using in-memory cache fallback:', err.message);
      this.client = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API — all methods fall back to memStore silently
  // ---------------------------------------------------------------------------

  async get(key) {
    if (this.isConnected && this.client) {
      try {
        const value = await this.client.get(key);
        return value ? JSON.parse(value) : null;
      } catch (_e) {
        // fall through to memory
      }
    }
    return memGet(key);
  }

  async set(key, value, ttlSeconds = 300) {
    if (this.isConnected && this.client) {
      try {
        await this.client.setex(key, ttlSeconds, JSON.stringify(value));
        return true;
      } catch (_e) {
        // fall through to memory
      }
    }
    memSet(key, value, ttlSeconds);
    return true;
  }

  async del(key) {
    if (this.isConnected && this.client) {
      try { await this.client.del(key); } catch (_e) { /* ignore */ }
    }
    memDel(key);
    return true;
  }

  async deleteByPattern(pattern) {
    if (this.isConnected && this.client) {
      try {
        const keys = await this.client.keys(pattern);
        if (keys.length > 0) await this.client.del(...keys);
        return true;
      } catch (_e) {
        // fall through to memory
      }
    }
    memDeleteByPattern(pattern);
    return true;
  }

  async mget(keys) {
    if (!keys.length) return {};

    if (this.isConnected && this.client) {
      try {
        const values = await this.client.mget(...keys);
        const result = {};
        keys.forEach((key, i) => { result[key] = values[i] ? JSON.parse(values[i]) : null; });
        return result;
      } catch (_e) {
        // fall through to memory
      }
    }

    const result = {};
    keys.forEach(key => { result[key] = memGet(key); });
    return result;
  }

  async mset(keyValuePairs, ttlSeconds = 300) {
    if (!keyValuePairs.length) return true;

    if (this.isConnected && this.client) {
      try {
        const pipeline = this.client.pipeline();
        for (const [key, value] of keyValuePairs) {
          pipeline.setex(key, ttlSeconds, JSON.stringify(value));
        }
        await pipeline.exec();
        return true;
      } catch (_e) {
        // fall through to memory
      }
    }

    for (const [key, value] of keyValuePairs) {
      memSet(key, value, ttlSeconds);
    }
    return true;
  }
}

// Singleton
const redisCache = new RedisCache();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CACHE_TTL = {
  CATEGORIES:    3600,  // 1 hour
  SUBCATEGORIES: 3600,
  DIFFICULTIES:  3600,
  POPULAR_TESTS: 1800,  // 30 min
  TEST_SERIES:   1800,
  EXAMS:          900,  // 15 min
  EXAM_DETAILS:  1800,
  SEARCH_RESULTS: 300,  // 5 min
  USER_SPECIFIC:  300,
};

const buildCacheKey = (prefix, ...parts) =>
  `bharat_mock:${prefix}:${parts.filter(p => p !== undefined && p !== null).join(':')}`;

module.exports = { redisCache, CACHE_TTL, buildCacheKey };
