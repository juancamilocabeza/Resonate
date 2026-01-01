// Enhanced Cache System for Resonate
// Provides caching for search results and metadata with TTL and size limits

const CACHE_CONSTANTS = {
  ENHANCED_CACHE: {
    MAX_ITEMS_PER_TYPE: 100,
    DEFAULT_TTL_MS: 30 * 60 * 1000,
    CLEANUP_INTERVAL_MS: 5 * 60 * 1000
  },
  AUDIO_FETCH_QUEUE: {
    DEFAULT_CONCURRENCY: 3
  },
  AUDIO_CACHE: {
    CACHE_NAME: 'audio-cache-v1',
    DB_NAME: 'ResonateAudioCache',
    DB_VERSION: 8,
    DEFAULT_MAX_BYTES: 500 * 1024 * 1024,
    LIMIT_STEP_BYTES: 3 * 1024 * 1024 * 1024,
    MIN_FREE_BUFFER_BYTES: 50 * 1024 * 1024,
    MAX_BYTES_STORAGE_KEY: 'resonate_audio_cache_max_bytes',
    LIMIT_PROMPT_COOLDOWN_MS: 60 * 1000,
    LOADING_WATCHDOG_MS: 30 * 1000
  }
};

function nowMs() {
  return Date.now();
}

function logCache(level, message) {
  try {
    window.logger?.[level]?.(message, 'CACHE');
  } catch {
    // ignore
  }
}

class EnhancedCache {
  constructor() {
    this.cache = new Map();
    this.maxSize = CACHE_CONSTANTS.ENHANCED_CACHE.MAX_ITEMS_PER_TYPE; // Maximum items per cache type
    this.defaultTTL = CACHE_CONSTANTS.ENHANCED_CACHE.DEFAULT_TTL_MS; // Default TTL
  }

  // Get item from cache
  get(type, key) {
    const typeCache = this.cache.get(type);
    if (!typeCache) return null;

    const item = typeCache.get(key);
    if (!item) return null;

    // Check if expired
    if (nowMs() > item.expires) {
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
      expires: nowMs() + ttl,
      timestamp: nowMs()
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
      const now = nowMs();
      stats[type] = {
        size: typeCache.size,
        items: Array.from(typeCache.entries()).map(([key, item]) => ({
          key,
          expires: new Date(item.expires),
          age: now - item.timestamp
        }))
      };
    }
    return stats;
  }

  // Clean expired items
  cleanup() {
    const now = nowMs();
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
function createPriorityQueue(limit = CACHE_CONSTANTS.AUDIO_FETCH_QUEUE.DEFAULT_CONCURRENCY) {
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
const audioFetchQueue = createPriorityQueue(CACHE_CONSTANTS.AUDIO_FETCH_QUEUE.DEFAULT_CONCURRENCY);

// Periodic cleanup every 5 minutes
setInterval(() => {
  enhancedCache.cleanup();
}, CACHE_CONSTANTS.ENHANCED_CACHE.CLEANUP_INTERVAL_MS);

// Enhanced Audio Cache using Cache API and IndexedDB
// Provides real offline caching for audio files
class AudioCache {
  // Contextos definidos
  static CONTEXTS = {
    FAVORITES: 'favorites',
    SEARCH: 'search',
    OFFLINE: 'offline',
  };

  // Número mínimo de pistas por contexto
  static MIN_TRACKS_PER_CONTEXT = 10;

  // Obtiene pistas cacheadas por contexto
  async getCachedTracksByContext(context) {
    if (!this.isInitialized) await this.init();
    const metadata = await this.getAllMetadata();
    switch (context) {
      case AudioCache.CONTEXTS.FAVORITES:
        return metadata.filter(item => item.isFavorite);
      case AudioCache.CONTEXTS.SEARCH:
        return metadata.filter(item => item.context === AudioCache.CONTEXTS.SEARCH);
      case AudioCache.CONTEXTS.OFFLINE:
        return metadata;
      default:
        return [];
    }
  }

  // Garantiza mínimo de pistas cacheadas por contexto
  async ensureMinTracksPerContext(context, tracks) {
    if (!tracks || tracks.length === 0) return;
    const cached = await this.getCachedTracksByContext(context);
    if (cached.length >= AudioCache.MIN_TRACKS_PER_CONTEXT) return;
    // Prioriza favoritas si aplica
    let toCache = tracks;
    if (context === AudioCache.CONTEXTS.FAVORITES) {
      toCache = tracks.filter(t => t.isFavorite);
      if (toCache.length < AudioCache.MIN_TRACKS_PER_CONTEXT) {
        // Rellena con otras si faltan
        const others = tracks.filter(t => !t.isFavorite);
        toCache = toCache.concat(others).slice(0, AudioCache.MIN_TRACKS_PER_CONTEXT);
      } else {
        toCache = toCache.slice(0, AudioCache.MIN_TRACKS_PER_CONTEXT);
      }
    } else {
      toCache = toCache.slice(0, AudioCache.MIN_TRACKS_PER_CONTEXT);
    }
    // Preload las necesarias
    await this.preloadTracks(toCache, true);
  }
    // Calcula el hash SHA-256 de un blob
    async computeBlobHash(blob) {
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (err) {
        logCache('warn', `Error calculando hash de blob: ${err}`);
        return null;
      }
    }
  constructor() {
    this.cache = null;
    this.db = null;
    this.dbName = CACHE_CONSTANTS.AUDIO_CACHE.DB_NAME;
    this.dbVersion = CACHE_CONSTANTS.AUDIO_CACHE.DB_VERSION;
    this.favoritesQueue = [];
    this.maxCacheSizeKey = CACHE_CONSTANTS.AUDIO_CACHE.MAX_BYTES_STORAGE_KEY;
    this.maxCacheSizeStepBytes = CACHE_CONSTANTS.AUDIO_CACHE.LIMIT_STEP_BYTES; // +3GB per user approval
    this.minFreeBufferBytes = CACHE_CONSTANTS.AUDIO_CACHE.MIN_FREE_BUFFER_BYTES; // Keep ~50MB buffer to avoid thrashing
    this.maxCacheSize = this.loadPersistedMaxCacheSize() ?? CACHE_CONSTANTS.AUDIO_CACHE.DEFAULT_MAX_BYTES;
    this.isInitialized = false;
    this.isPreloadingFavorites = false;
    this.lastLimitPromptAt = 0;
    this.limitPromptCooldownMs = CACHE_CONSTANTS.AUDIO_CACHE.LIMIT_PROMPT_COOLDOWN_MS;
  }

  async init() {
    try {
      // Initialize Cache API for audio files
      this.cache = await caches.open(CACHE_CONSTANTS.AUDIO_CACHE.CACHE_NAME);

      // Initialize IndexedDB for metadata
      await this.initIndexedDB();

      this.isInitialized = true;
      logCache('info', `Audio cache initialized successfully (limit: ${this.formatBytes(this.maxCacheSize)})`);
    } catch (error) {
      logCache('error', `Failed to initialize audio cache: ${error.message}`);
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

        let store;
        if (!db.objectStoreNames.contains('audioMetadata')) {
          store = db.createObjectStore('audioMetadata', { keyPath: 'url' });
        } else {
          store = event.target.transaction.objectStore('audioMetadata');
        }

        // Ensure indexes exist for all versions (safe on upgrades)
        if (!store.indexNames.contains('lastAccessed')) {
          store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
        }
        if (!store.indexNames.contains('size')) {
          store.createIndex('size', 'size', { unique: false });
        }
        if (!store.indexNames.contains('isFavorite')) {
          store.createIndex('isFavorite', 'isFavorite', { unique: false });
        }
        if (!store.indexNames.contains('cachedAt')) {
          store.createIndex('cachedAt', 'cachedAt', { unique: false });
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
        await this.updateMetadata(url, { lastAccessed: nowMs() });
        // Convert Response to blob for playback compatibility
        const blob = await cachedResponse.blob();
        // Verificar integridad si existe hash
        try {
          const meta = await this.getMetadata(url);
          if (meta && meta.hash) {
            const actualHash = await this.computeBlobHash(blob);
            if (actualHash !== meta.hash) {
              logCache('error', `Integridad fallida para ${url}: esperado ${meta.hash}, obtenido ${actualHash}`);
              if (typeof window.showStatus === 'function') {
                window.showStatus('Archivo de audio corrupto detectado y eliminado: ' + url, 'error', 8000, 'error');
              } else {
                alert('Archivo de audio corrupto detectado y eliminado: ' + url);
              }
              // Eliminar archivo corrupto
              await this.remove(url);
              return null;
            }
          }
        } catch (err) {
          logCache('warn', `Error verificando integridad de ${url}: ${err}`);
        }
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
      logCache('warn', `Failed to get cached audio: ${error.message}`);
      return null;
    }
  }

  async put(url, data, isFavorite = false, metadata = {}) {
    if (!this.isInitialized) await this.init();

    try {
      const size = await this.getResponseSize(data);
      const interactive = !!isFavorite;
      const canCache = await this.ensureSpaceFor(size, { isFavorite, interactive, url });
      if (!canCache) {
        this.notifyCacheLimitReached(size, isFavorite);
        return;
      }

      // Calcular hash para integridad
      const blob = await data.clone().blob();
      const hash = await this.computeBlobHash(blob);

      // Store in Cache API (best-effort + quota recovery)
      const stored = await this.putWithQuotaRecovery(url, data, { size, isFavorite, metadata });
      if (!stored) {
        this.notifyCacheLimitReached(size, isFavorite);
        return;
      }

      // Store metadata in IndexedDB (con hash)
      await this.storeMetadata(url, {
        url,
        size,
        lastAccessed: nowMs(),
        isFavorite,
        cachedAt: nowMs(),
        title: metadata.title,
        creator: metadata.creator,
        hash
      });

      // Enforce logical cache size (never evict favorites)
      await this.enforceCacheSize({ interactive, reasonUrl: url });

      logCache('debug', `Cached audio file: ${url} (${this.formatBytes(size)})`);
    } catch (error) {
      logCache('warn', `Failed to cache audio: ${error.message}`);
    }
  }

  async remove(url) {
    if (!this.isInitialized) await this.init();

    try {
      await this.cache.delete(url);
      await this.deleteMetadata(url);
      this.removeFromFavoritesQueue(url);
      logCache('info', `Removed from cache: ${url}`);
    } catch (error) {
      logCache('warn', `Failed to remove from cache: ${error.message}`);
    }
  }

  async prefetchAudio(url, priority = false) {
    if (!url || url === 'undefined') {
      logCache('warn', 'Skipping prefetch: invalid or undefined url');
      return;
    }
    if (!this.isInitialized) await this.init();

    try {
      const shouldFetch = await this.shouldPrefetch(priority);
      if (!shouldFetch) {
        logCache('info', `Skipping prefetch due to network or quota limits: ${url}`);
        return;
      }

      await audioFetchQueue.enqueuePrefetch(async () => {
        const existing = await this.cache.match(url);
        if (existing) {
          logCache('debug', `Audio already cached: ${url}`);
          return; // Already cached
        }

        logCache('info', `Pre-fetching audio: ${url}`);
        const response = await fetch(url);
        if (response && response.ok) {
          await this.put(url, response, priority);
        } else {
          throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`);
        }
      });
    } catch (error) {
      logCache('warn', `Failed to prefetch audio: ${error.message}`);
      if (error.message.includes('503')) {
        logCache('warn', 'Service Unavailable - Offline. Retrying...');
        // Implement retry logic or fallback here
      }
    }
  }

  async preloadFavorites(favorites) {
    if (!this.isInitialized) await this.init();
    if (!favorites || favorites.length === 0) return;
    if (this.isPreloadingFavorites) {
      logCache('info', 'Favorites preload already in progress, skipping duplicate run');
      return;
    }

    const shouldFetch = await this.shouldPrefetch(true);
    if (!shouldFetch) {
      logCache('info', 'Skipping favorites preload due to network or quota limits');
      throw new Error('Skipping favorites preload due to network or quota limits');
    }

    logCache('info', `Preloading ${favorites.length} favorites for offline playback`);
    // Garantiza mínimo de favoritas cacheadas
    await this.ensureMinTracksPerContext(AudioCache.CONTEXTS.FAVORITES, favorites);
  }

  // Nuevo: Preload mínimo de resultados de búsqueda
  async preloadSearchResults(tracks) {
    await this.ensureMinTracksPerContext(AudioCache.CONTEXTS.SEARCH, tracks);
  }

  // Nuevo: Preload mínimo para modo offline (todas las pistas)
  async preloadOffline(tracks) {
    await this.ensureMinTracksPerContext(AudioCache.CONTEXTS.OFFLINE, tracks);
  }

  // --- El siguiente bloque pertenece a preloadFavorites, reubicado correctamente ---
  // (esto estaba después del cierre de preloadOffline por error de indentación)

  // (Método: preloadFavorites, continuación)
  // NOTA: Este bloque debe estar dentro de preloadFavorites, después de await this.ensureMinTracksPerContext(...)

  // El siguiente código debe estar dentro de preloadFavorites, después de await this.ensureMinTracksPerContext(...)
  // (pero aquí lo dejamos comentado para referencia, ya que la lógica ya está implementada correctamente arriba)
  //
  // this.isPreloadingFavorites = true;
  // ...

  async preloadTracks(tracks, priority = false) {
    if (!this.isInitialized) await this.init();
    if (!tracks || tracks.length === 0) return;

    const shouldFetch = await this.shouldPrefetch(priority);
    if (!shouldFetch) {
      logCache('info', 'Skipping track preload due to network or quota limits');
      return;
    }

    const prefetchPromises = tracks
      .filter(track => track && track.url && track.url !== 'undefined')
      .map(track =>
        this.prefetchAudio(track.url, priority).catch(error => {
          logCache('warn', `Failed to preload track: ${track.title}`);
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
      logCache('warn', `Failed to get usage stats: ${error.message}`);
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
    const appState = window.state;
    if (!appState) return;

    appState.lastFetchController = new AbortController();
    appState.loadingWatchdogId = setTimeout(() => {
      if (appState.lastFetchController) {
        appState.lastFetchController.abort();
        logCache('warn', 'Loading operation timed out, aborting');
      }
    }, CACHE_CONSTANTS.AUDIO_CACHE.LOADING_WATCHDOG_MS);
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
        logCache('info', 'Cache nearly full, skipping non-priority prefetch');
        return false;
      }

      return true;
    } catch (error) {
      logCache('warn', `Prefetch guard failed: ${error.message}`);
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
      try {
        const transaction = this.db.transaction(['audioMetadata'], 'readwrite');
        const store = transaction.objectStore('audioMetadata');
        const request = store.put(metadata);
        request.onsuccess = () => resolve();
        request.onerror = () => {
          logCache('error', `IndexedDB storeMetadata error: ${request.error}`);
          try {
            if (typeof window.showStatus === 'function') {
              window.showStatus('Error al guardar metadatos en almacenamiento offline: ' + request.error, 'error', 8000, 'error');
            }
          } catch {}
          reject(request.error);
        };
      } catch (err) {
        logCache('error', `IndexedDB storeMetadata exception: ${err}`);
        try {
          if (typeof window.showStatus === 'function') {
            window.showStatus('Error al guardar metadatos en almacenamiento offline: ' + err, 'error', 8000, 'error');
          }
        } catch {}
        reject(err);
      }
    });
  }

  async getMetadata(url) {
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction(['audioMetadata'], 'readonly');
        const store = transaction.objectStore('audioMetadata');
        const request = store.get(url);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          logCache('error', `IndexedDB getMetadata error: ${request.error}`);
          try {
            if (typeof window.showStatus === 'function') {
              window.showStatus('Error al leer metadatos de almacenamiento offline: ' + request.error, 'error', 8000, 'error');
            }
          } catch {}
          reject(request.error);
        };
      } catch (err) {
        logCache('error', `IndexedDB getMetadata exception: ${err}`);
        try {
          if (typeof window.showStatus === 'function') {
            window.showStatus('Error al leer metadatos de almacenamiento offline: ' + err, 'error', 8000, 'error');
          }
        } catch {}
        reject(err);
      }
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

  async enforceCacheSize({ interactive = false, reasonUrl = null } = {}) {
    return this.enforceCacheSizeInternal({ interactive, reasonUrl });
  }

  async enforceCacheSizeInternal({ interactive = false, reasonUrl = null } = {}) {
    try {
      const metadata = await this.getAllMetadata();
      const totalSize = metadata.reduce((sum, item) => sum + (item.size || 0), 0);

      // No-op if within logical limit
      if (totalSize <= this.maxCacheSize) return true;

      // Evict non-favorites only (favorites are pinned forever)
      const nonFavorites = metadata
        .filter(item => !item.isFavorite)
        .sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0));

      if (nonFavorites.length === 0) {
        // All cached items are pinned favorites; cannot evict. Offer to increase limit.
        if (interactive) {
          const increased = await this.maybeIncreaseLimitInteractively({ reason: 'favorites-only', reasonUrl });
          if (!increased) {
            try {
              if (typeof window.showStatus === 'function') {
                window.showStatus('La caché está llena solo con favoritos. No se puede liberar espacio para nuevos archivos.', 'warning', 8000, 'warning');
              } else {
                alert('La caché está llena solo con favoritos. No se puede liberar espacio para nuevos archivos.');
              }
            } catch {}
          }
          return increased;
        }
        try {
          if (typeof window.showStatus === 'function') {
            window.showStatus('La caché está llena solo con favoritos. No se puede liberar espacio para nuevos archivos.', 'warning', 8000, 'warning');
          } else {
            alert('La caché está llena solo con favoritos. No se puede liberar espacio para nuevos archivos.');
          }
        } catch {}
        return false;
      }

      const targetSize = Math.max(0, this.maxCacheSize - this.minFreeBufferBytes);
      let runningTotal = totalSize;

      for (const item of nonFavorites) {
        if (runningTotal <= targetSize) break;
        await this.remove(item.url);
        runningTotal -= item.size || 0;
        logCache('info', `Removed old cached item to free space: ${item.url}`);
      }

      return runningTotal <= this.maxCacheSize;
    } catch (error) {
      logCache('warn', `Failed to enforce cache size: ${error.message}`);
      return false;
    }
  }

  async ensureSpaceFor(requiredBytes, { isFavorite = false, interactive = false, url = null } = {}) {
    try {
      const metadata = await this.getAllMetadata();
      const totalSize = metadata.reduce((sum, item) => sum + (item.size || 0), 0);

      const effectiveLimit = Math.max(0, this.maxCacheSize - this.minFreeBufferBytes);
      if (totalSize + requiredBytes <= effectiveLimit) return true;

      // Evict non-favorites to make room (favorites are never evicted)
      const nonFavorites = metadata
        .filter(item => !item.isFavorite)
        .sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0));

      let runningTotal = totalSize;
      for (const item of nonFavorites) {
        if (runningTotal + requiredBytes <= effectiveLimit) break;
        await this.remove(item.url);
        runningTotal -= item.size || 0;
      }

      if (runningTotal + requiredBytes <= effectiveLimit) return true;

      if (!interactive) return false;
      return await this.maybeIncreaseLimitInteractively({
        reason: isFavorite ? 'favorite-quota' : 'quota',
        reasonUrl: url,
        requiredBytes
      });
    } catch (error) {
      // Fail open: don't block playback paths, but caching may fail later.
      logCache('warn', `ensureSpaceFor failed: ${error.message}`);
      return true;
    }
  }

  async putWithQuotaRecovery(url, data, { size, isFavorite, metadata }) {
    const attemptPut = async () => {
      await this.cache.put(url, data.clone());
      return true;
    };

    try {
      return await attemptPut();
    } catch (error) {
      if (!this.isQuotaError(error)) {
        logCache('warn', `Cache.put failed: ${error.message}`);
        return false;
      }

      // Quota exceeded: try eviction of non-favorites and retry once.
      await this.enforceCacheSizeInternal({ interactive: false, reasonUrl: url });
      try {
        return await attemptPut();
      } catch (error2) {
        if (!this.isQuotaError(error2)) {
          logCache('warn', `Cache.put retry failed: ${error2.message}`);
          return false;
        }

        // Still quota exceeded: offer interactive increase only for favorites (pinned items)
        if (!isFavorite) return false;
        const increased = await this.maybeIncreaseLimitInteractively({
          reason: 'favorite-put',
          reasonUrl: url,
          requiredBytes: size
        });
        if (!increased) return false;

        try {
          return await attemptPut();
        } catch (error3) {
          logCache('warn', `Cache.put after limit increase failed: ${error3.message}`);
          return false;
        }
      }
    }
  }

  isQuotaError(error) {
    const name = (error && error.name) ? String(error.name) : '';
    const message = (error && error.message) ? String(error.message) : '';
    return name === 'QuotaExceededError' || message.toLowerCase().includes('quota');
  }

  notifyCacheLimitReached(size, isFavorite) {
    const base = isFavorite
      ? 'No hay espacio para guardar este favorito offline.'
      : 'Cache offline lleno. No se pudo guardar este audio.';

    const msg = `${base} Tamaño: ${this.formatBytes(size)}.`;
    try {
      if (typeof window.showStatus === 'function') {
        window.showStatus(msg, 'warning', 6000, 'warning');
      } else {
        alert(msg);
      }
    } catch {
      // ignore
    }
  }

  loadPersistedMaxCacheSize() {
    try {
      const raw = localStorage.getItem(this.maxCacheSizeKey);
      if (!raw) return null;
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) return null;
      return value;
    } catch {
      return null;
    }
  }

  persistMaxCacheSize() {
    try {
      localStorage.setItem(this.maxCacheSizeKey, String(this.maxCacheSize));
    } catch {
      // ignore
    }
  }

  async maybeIncreaseLimitInteractively({ reason, reasonUrl = null, requiredBytes = null } = {}) {
    const now = nowMs();
    if (now - this.lastLimitPromptAt < this.limitPromptCooldownMs) return false;
    this.lastLimitPromptAt = now;

    const current = this.maxCacheSize;
    const next = current + this.maxCacheSizeStepBytes;

    const humanCurrent = this.formatBytes(current);
    const humanNext = this.formatBytes(next);
    const humanRequired = requiredBytes ? this.formatBytes(requiredBytes) : null;

    const message = humanRequired
      ? `Almacenamiento offline lleno (${humanCurrent}). ¿Aumentar el límite +3GB (a ${humanNext}) para guardar ${humanRequired}?`
      : `Almacenamiento offline lleno (${humanCurrent}). ¿Aumentar el límite +3GB (a ${humanNext})?`;

    try {
      if (typeof window.showStatus === 'function') {
        window.showStatus('Almacenamiento offline lleno. Se requiere tu confirmación.', 'warning', 5000, 'warning');
      }
    } catch {
      // ignore
    }

    let accepted = false;
    try {
      accepted = confirm(message);
    } catch {
      accepted = false;
    }

    if (!accepted) return false;

    this.maxCacheSize = next;
    this.persistMaxCacheSize();
    await this.requestPersistentStorage();

    logCache('info', `User increased offline cache limit to ${humanNext} (reason: ${reason}${reasonUrl ? `, url: ${reasonUrl}` : ''})`);
    try {
      if (typeof window.showStatus === 'function') {
        window.showStatus(`Límite de almacenamiento offline aumentado a ${humanNext}`, 'info', 4000, 'info');
      }
    } catch {
      // ignore
    }

    return true;
  }

  async requestPersistentStorage() {
    try {
      if (!navigator.storage || typeof navigator.storage.persist !== 'function') return false;
      return await navigator.storage.persist();
    } catch {
      return false;
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
  window.logger.info('Enhanced cache initialized', 'CACHE');
  window.logger.info('Basic audioCache stub initialized', 'CACHE');
}
