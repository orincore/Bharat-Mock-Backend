const cacheStore = new Map();

const DEFAULT_TTL_MS = 1000 * 60 * 2; // 2 minutes

const setCache = (key, value, ttlMs = DEFAULT_TTL_MS) => {
  if (!key) return;
  const expiresAt = Date.now() + ttlMs;
  cacheStore.set(key, { value, expiresAt });
};

const getCache = (key) => {
  if (!key || !cacheStore.has(key)) {
    return null;
  }
  const entry = cacheStore.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    cacheStore.delete(key);
    return null;
  }
  return entry.value;
};

const deleteCacheByPrefix = (keyPrefix) => {
  if (!keyPrefix) return;
  for (const key of cacheStore.keys()) {
    if (key.startsWith(keyPrefix)) {
      cacheStore.delete(key);
    }
  }
};

const clearCache = () => {
  cacheStore.clear();
};

module.exports = {
  setCache,
  getCache,
  clearCache,
  deleteCacheByPrefix,
};
