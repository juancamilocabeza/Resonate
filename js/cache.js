// Enhanced Cache System for Resonate
// Provides caching for search results and metadata with TTL and size limits

class EnhancedCache {
  constructor() {
    this.cache = new Map();
    this.maxSize = 100; // Maximum items per cache type
    this.defaultTTL = 30 * 60 * 1000; // 30 minutes default TTL
  }

  // Get item from cache
  get(type, key) {
    const typeCache = this.cache.get(type);
    if (!typeCache) return null;

    const item = typeCache.get(key);
    if (!item) return null;

    // Check if expired
    if (Date.now() > item.expires) {
      typeCache.delete(key);
      return null;
    }

    return item.data;
  }

  // Set item in cache
  set(type, key, data, ttl = this.defaultTTL) {
    if (!this.cache.has(type)) {
      this.cache.set(type, new Map());
    }

    const typeCache = this.cache.get(type);

    // Enforce size limit - remove oldest items if needed
    if (typeCache.size >= this.maxSize) {
      const oldestKey = typeCache.keys().next().value;
      typeCache.delete(oldestKey);
    }

    const item = {
      data: data,
      expires: Date.now() + ttl,
      timestamp: Date.now()
    };

    typeCache.set(key, item);
  }

  // Clear specific type or all cache
  clear(type = null) {
    if (type) {
      this.cache.delete(type);
    } else {
      this.cache.clear();
    }
  }

  // Get cache stats
  getStats() {
    const stats = {};
    for (const [type, typeCache] of this.cache.entries()) {
      stats[type] = {
        size: typeCache.size,
        items: Array.from(typeCache.entries()).map(([key, item]) => ({
          key,
          expires: new Date(item.expires),
          age: Date.now() - item.timestamp
        }))
      };
    }
    return stats;
  }

  // Clean expired items
  cleanup() {
    const now = Date.now();
    for (const [type, typeCache] of this.cache.entries()) {
      for (const [key, item] of typeCache.entries()) {
        if (now > item.expires) {
          typeCache.delete(key);
        }
      }
    }
  }
}

// Create global enhanced cache instance
const enhancedCache = new EnhancedCache();

// Periodic cleanup every 5 minutes
setInterval(() => {
  enhancedCache.cleanup();
}, 5 * 60 * 1000);

// Basic Audio Cache Stub
// Provides minimal audioCache implementation for compatibility
class AudioCache {
  constructor() {
    this.cache = new Map();
    this.favoritesQueue = [];
  }

  async init() {
    // No-op for basic implementation
    return Promise.resolve();
  }

  async get(url) {
    return this.cache.get(url) || null;
  }

  async put(url, data, isFavorite = false) {
    this.cache.set(url, data);
    return Promise.resolve();
  }

  async remove(url) {
    this.cache.delete(url);
    return Promise.resolve();
  }

  async prefetchAudio(url, priority = false) {
    // No-op for basic implementation
    return Promise.resolve();
  }

  async preloadFavorites(favorites) {
    // No-op for basic implementation
    return Promise.resolve();
  }

  async preloadTracks(tracks, priority = false) {
    // No-op for basic implementation
    return Promise.resolve();
  }

  getFavoritesQueue() {
    return this.favoritesQueue;
  }

  loadFavoritesQueue(favorites, priority = false) {
    this.favoritesQueue = favorites.map(f => f.url);
  }

  removeFromFavoritesQueue(url) {
    const index = this.favoritesQueue.indexOf(url);
    if (index > -1) {
      this.favoritesQueue.splice(index, 1);
    }
  }

  replaceFavoritesQueueItem(oldUrl, newUrl, favorites) {
    if (newUrl) {
      const index = this.favoritesQueue.indexOf(oldUrl);
      if (index > -1) {
        this.favoritesQueue[index] = newUrl;
      }
    } else {
      this.removeFromFavoritesQueue(oldUrl);
    }
  }

  async markAsFullyListened(url) {
    // No-op for basic implementation
    return Promise.resolve();
  }

  async getUsageStats() {
    return {
      usagePercentage: 0,
      totalSize: 0,
      availableSpace: 100 * 1024 * 1024 // 100MB dummy
    };
  }

  setupLoadingSafety() {
    // No-op for basic implementation
  }
}

// Create global audioCache instance
const audioCache = new AudioCache();

// Expose to global scope
window.enhancedCache = enhancedCache;
window.audioCache = audioCache;

// Debug logging in development
if (window.logger) {
  window.logger.info('Enhanced cache initialized', 'Cache');
  window.logger.info('Basic audioCache stub initialized', 'Cache');
}
