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

// Priority queue for audio fetches: high-priority playback, low-priority prefetch
function createPriorityQueue(limit = 3) {
  let active = 0;
  let concurrency = Math.max(1, limit);
  const highQueue = []; // playback requests (user is playing now)
  const lowQueue = [];  // prefetch requests (background)

  const runNext = () => {
    if (active >= concurrency) return;
    
    // Always prioritize playback (high) over prefetch (low)
    const next = highQueue.shift() || lowQueue.shift();
    if (!next) return;

    active++;
    next()
      .catch(() => {}) // Swallow; individual tasks handle logging
      .finally(() => {
        active--;
        runNext();
      });
  };

  return {
    setLimit(newLimit) {
      concurrency = Math.max(1, newLimit);
      for (let i = 0; i < newLimit; i++) runNext();
    },
    enqueuePlayback(taskFactory) {
      return new Promise((resolve, reject) => {
        highQueue.unshift(() => taskFactory().then(resolve).catch(reject));
        runNext();
      });
    },
    enqueuePrefetch(taskFactory) {
      return new Promise((resolve, reject) => {
        lowQueue.push(() => taskFactory().then(resolve).catch(reject));
        runNext();
      });
    },
    stats() {
      return { active, pendingPlayback: highQueue.length, pendingPrefetch: lowQueue.length, limit: concurrency };
    }
  };
}

// Shared queue for audio fetches: playback has priority over prefetch
const audioFetchQueue = createPriorityQueue(3);

// Periodic cleanup every 5 minutes
setInterval(() => {
  enhancedCache.cleanup();
}, 5 * 60 * 1000);

// Enhanced Audio Cache using Cache API and IndexedDB
// Provides real offline caching for audio files
class AudioCache {
  constructor() {
    this.cache = null;
    this.db = null;
    this.dbName = 'ResonateAudioCache';
    this.dbVersion = 7;
    this.favoritesQueue = [];
    this.maxCacheSize = 500 * 1024 * 1024; // 500MB max cache size
    this.isInitialized = false;
    this.isPreloadingFavorites = false;
  }

  async init() {
    try {
      // Initialize Cache API for audio files
      this.cache = await caches.open('audio-cache-v1');

      // Initialize IndexedDB for metadata
      await this.initIndexedDB();

      this.isInitialized = true;
      window.logger?.info('Audio cache initialized successfully', 'CACHE');
    } catch (error) {
      window.logger?.error(`Failed to initialize audio cache: ${error.message}`, 'CACHE');
      throw error;
    }
  }

  async initIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('audioMetadata')) {
          const store = db.createObjectStore('audioMetadata', { keyPath: 'url' });
          store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
          store.createIndex('size', 'size', { unique: false });
        }
      };
    });
  }

  async get(url, isPlayback = false) {
    if (!this.isInitialized) await this.init();

    try {
      // Try Cache API first (fastest path)
      const cachedResponse = await this.cache.match(url);
      if (cachedResponse) {
        // Update access time in IndexedDB
        await this.updateMetadata(url, { lastAccessed: Date.now() });
        // Convert Response to blob for playback compatibility
        const blob = await cachedResponse.blob();
        return { blob, fromCache: true };
      }

      // Fallback to fetch: playback gets priority, prefetch waits
      const queueFn = isPlayback ? 'enqueuePlayback' : 'enqueuePrefetch';
      const response = await audioFetchQueue[queueFn](() => fetch(url));
      if (response && response.ok) {
        // Cache in background for future use
        this.put(url, response.clone());
        // Return blob for immediate playback
        const blob = await response.blob();
        return { blob, fromCache: false };
      }
      return null;
    } catch (error) {
      window.logger?.warn(`Failed to get cached audio: ${error.message}`, 'CACHE');
      return null;
    }
  }

  async put(url, data, isFavorite = false, metadata = {}) {
    if (!this.isInitialized) await this.init();

    try {
      // Store in Cache API
      await this.cache.put(url, data.clone());

      // Store metadata in IndexedDB
      const size = await this.getResponseSize(data);
      await this.storeMetadata(url, {
        url,
        size,
        lastAccessed: Date.now(),
        isFavorite,
        cachedAt: Date.now(),
        title: metadata.title,
        creator: metadata.creator
      });

      // Clean up if cache is too large
      await this.enforceCacheSize();

      window.logger?.debug(`Cached audio file: ${url} (${this.formatBytes(size)})`, 'CACHE');
    } catch (error) {
      window.logger?.warn(`Failed to cache audio: ${error.message}`, 'CACHE');
    }
  }

  async remove(url) {
    if (!this.isInitialized) await this.init();

    try {
      await this.cache.delete(url);
      await this.deleteMetadata(url);
      this.removeFromFavoritesQueue(url);
      window.logger?.info(`Removed from cache: ${url}`, 'CACHE');
    } catch (error) {
      window.logger?.warn(`Failed to remove from cache: ${error.message}`, 'CACHE');
    }
  }

  async prefetchAudio(url, priority = false) {
    if (!this.isInitialized) await this.init();

    try {
      const shouldFetch = await this.shouldPrefetch(priority);
      if (!shouldFetch) {
        window.logger?.info(`Skipping prefetch due to network or quota limits: ${url}`, 'CACHE');
        return;
      }

      await audioFetchQueue.enqueuePrefetch(async () => {
        const existing = await this.cache.match(url);
        if (existing) {
          window.logger?.debug(`Audio already cached: ${url}`, 'CACHE');
          return; // Already cached
        }

        window.logger?.info(`Pre-fetching audio: ${url}`, 'CACHE');
        const response = await fetch(url);
        if (response && response.ok) {
          await this.put(url, response, priority);
        }
      });
    } catch (error) {
      window.logger?.warn(`Failed to prefetch audio: ${error.message}`, 'CACHE');
    }
  }

  async preloadFavorites(favorites) {
    if (!this.isInitialized) await this.init();
    if (!favorites || favorites.length === 0) return;
    if (this.isPreloadingFavorites) {
      window.logger?.info('Favorites preload already in progress, skipping duplicate run', 'CACHE');
      return;
    }

    const shouldFetch = await this.shouldPrefetch(true);
    if (!shouldFetch) {
      window.logger?.info('Skipping favorites preload due to network or quota limits', 'CACHE');
      return;
    }

    window.logger?.info(`Preloading ${favorites.length} favorites for offline playback`, 'CACHE');

    this.isPreloadingFavorites = true;

    // Load favorites queue
    this.favoritesQueue = favorites.map(f => f.url);

    // Prefetch favorites in background
    const prefetchPromises = favorites.map(favorite =>
      this.prefetchAudio(favorite.url, true).catch(error => {
        window.logger?.warn(`Failed to preload favorite: ${favorite.title} - ${error.message}`, 'CACHE');
      })
    );

    // Wait for all to complete (with timeout)
    await Promise.allSettled(prefetchPromises);
    window.logger?.info('Favorites preload completed', 'CACHE');
    this.isPreloadingFavorites = false;
  }

  async preloadTracks(tracks, priority = false) {
    if (!this.isInitialized) await this.init();
    if (!tracks || tracks.length === 0) return;

    const shouldFetch = await this.shouldPrefetch(priority);
    if (!shouldFetch) {
      window.logger?.info('Skipping track preload due to network or quota limits', 'CACHE');
      return;
    }

    const prefetchPromises = tracks.map(track =>
      this.prefetchAudio(track.url, priority).catch(error => {
        window.logger?.warn(`Failed to preload track: ${track.title}`, 'CACHE');
      })
    );

    await Promise.allSettled(prefetchPromises);
  }

  getFavoritesQueue() {
    return [...this.favoritesQueue];
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
    const index = this.favoritesQueue.indexOf(oldUrl);
    if (index > -1) {
      if (newUrl) {
        this.favoritesQueue[index] = newUrl;
      } else {
        this.favoritesQueue.splice(index, 1);
      }
    }
  }

  async markAsFullyListened(url) {
    // Could be used for cache management strategies
    await this.updateMetadata(url, { fullyListened: true });
  }

  async getUsageStats() {
    if (!this.isInitialized) await this.init();

    try {
      const metadata = await this.getAllMetadata();
      const totalSize = metadata.reduce((sum, item) => sum + (item.size || 0), 0);
      const usagePercentage = (totalSize / this.maxCacheSize) * 100;

      return {
        usagePercentage: Math.min(usagePercentage, 100),
        totalSize,
        availableSpace: Math.max(0, this.maxCacheSize - totalSize),
        itemCount: metadata.length
      };
    } catch (error) {
      window.logger?.warn(`Failed to get usage stats: ${error.message}`, 'CACHE');
      return {
        usagePercentage: 0,
        totalSize: 0,
        availableSpace: this.maxCacheSize,
        itemCount: 0
      };
    }
  }

  setupLoadingSafety() {
    // Setup safety mechanisms for loading operations
    state.lastFetchController = new AbortController();
    state.loadingWatchdogId = setTimeout(() => {
      if (state.lastFetchController) {
        state.lastFetchController.abort();
        window.logger?.warn('Loading operation timed out, aborting', 'CACHE');
      }
    }, 30000); // 30 second timeout
  }

  async shouldPrefetch(priority = false) {
    try {
      // Avoid aggressive downloads on slow or metered networks unless priority
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (connection) {
        if (connection.saveData && !priority) return false;
        const slowTypes = ['slow-2g', '2g'];
        if (slowTypes.includes(connection.effectiveType) && !priority) return false;
      }

      // Stop if cache is near full
      const stats = await this.getUsageStats();
      if (stats.usagePercentage >= 95 && !priority) {
        window.logger?.info('Cache nearly full, skipping non-priority prefetch', 'CACHE');
        return false;
      }

      return true;
    } catch (error) {
      window.logger?.warn(`Prefetch guard failed: ${error.message}`, 'CACHE');
      return true; // Fail open to avoid blocking playback paths
    }
  }

  // Helper methods
  async getResponseSize(response) {
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      return parseInt(contentLength, 10);
    }

    // Fallback: clone and measure
    const clone = response.clone();
    const buffer = await clone.arrayBuffer();
    return buffer.byteLength;
  }

  async storeMetadata(url, metadata) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['audioMetadata'], 'readwrite');
      const store = transaction.objectStore('audioMetadata');
      const request = store.put(metadata);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getMetadata(url) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['audioMetadata'], 'readonly');
      const store = transaction.objectStore('audioMetadata');
      const request = store.get(url);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async updateMetadata(url, updates) {
    try {
      const existing = await this.getMetadata(url);
      if (existing) {
        const updated = { ...existing, ...updates };
        await this.storeMetadata(url, updated);
      }
    } catch (error) {
      // Silently fail for metadata updates
    }
  }

  async deleteMetadata(url) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['audioMetadata'], 'readwrite');
      const store = transaction.objectStore('audioMetadata');
      const request = store.delete(url);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getAllMetadata() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['audioMetadata'], 'readonly');
      const store = transaction.objectStore('audioMetadata');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async enforceCacheSize() {
    try {
      const metadata = await this.getAllMetadata();
      const totalSize = metadata.reduce((sum, item) => sum + (item.size || 0), 0);

      if (totalSize > this.maxCacheSize) {
        // Sort by last accessed (oldest first), but keep favorites
        const sortedItems = metadata
          .filter(item => !item.isFavorite) // Don't delete favorites automatically
          .sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0));

        let freedSpace = 0;
        const targetSize = totalSize - this.maxCacheSize + (50 * 1024 * 1024); // Leave 50MB buffer

        for (const item of sortedItems) {
          if (freedSpace >= targetSize) break;

          await this.remove(item.url);
          freedSpace += item.size || 0;
          window.logger?.info(`Removed old cached item to free space: ${item.url}`, 'CACHE');
        }
      }
    } catch (error) {
      window.logger?.warn(`Failed to enforce cache size: ${error.message}`, 'CACHE');
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
