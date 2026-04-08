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
    DB_VERSION: 9,
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

function fnv1aHash(input) {
  const str = String(input || '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function hashTrackListSignature(tracks, maxItems = 24) {
  try {
    const list = Array.isArray(tracks) ? tracks : [];
    const urls = [];
    for (let i = 0; i < list.length && urls.length < maxItems; i++) {
      const url = list[i] && list[i].url ? String(list[i].url) : '';
      if (url) urls.push(url);
    }
    const payload = `${urls.join('|')}|${list.length}`;
    return fnv1aHash(payload);
  } catch {
    return '';
  }
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

    // Enforce size limit - remove oldest items if needed (skip eviction when updating an existing key)
    if (typeCache.size >= this.maxSize && !typeCache.has(key)) {
      const oldestKey = typeCache.keys().next().value;
      typeCache.delete(oldestKey);
    }

    const now = nowMs();
    const item = {
      data: data,
      expires: now + ttl,
      timestamp: now
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

function getNetworkProfile() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const downlink = connection && typeof connection.downlink === 'number' ? connection.downlink : 0;
  const effectiveType = connection && connection.effectiveType ? connection.effectiveType : '';

  if (effectiveType === '5g' || downlink >= 20) return { tier: '5g', concurrency: 4 };
  if (effectiveType === '4g' || downlink >= 5) return { tier: '4g', concurrency: 3 };
  if (effectiveType === '3g' || downlink >= 1.5) return { tier: '3g', concurrency: 2 };
  if (effectiveType === '2g' || effectiveType === 'slow-2g' || downlink > 0) return { tier: '2g', concurrency: 1 };
  return { tier: 'online', concurrency: 3 };
}

function applyNetworkConcurrency(profile) {
  try {
    audioFetchQueue.setLimit(profile.concurrency);
  } catch {}
}

// Periodic cleanup every 5 minutes
setInterval(() => {
  enhancedCache.cleanup();
}, CACHE_CONSTANTS.ENHANCED_CACHE.CLEANUP_INTERVAL_MS);

// Enhanced Audio Cache using Cache API and IndexedDB
// Provides real offline caching for audio files
class AudioCache {
  // Contextos definidos
  static CONTEXTS = {
    // Preferred naming
    RESONTES: 'resontes',
    // Legacy naming (some call sites still use "favorites")
    FAVORITES: 'favorites',
    SEARCH: 'search',
    OFFLINE: 'offline',
  };

  // Número mínimo de pistas por contexto
  static MIN_TRACKS_PER_CONTEXT = 10;

  getAdaptiveMinTracks(context, tracks) {
    const total = Array.isArray(tracks) ? tracks.length : 0;
    const base = AudioCache.MIN_TRACKS_PER_CONTEXT;
    const isResonteContext = context === AudioCache.CONTEXTS.RESONTES || context === AudioCache.CONTEXTS.FAVORITES;
    const ratio = isResonteContext ? 0.25 : 0.15;
    const cap = isResonteContext ? 25 : 15;
    if (!total) return base;
    return Math.max(base, Math.min(cap, Math.ceil(total * ratio)));
  }

  // Obtiene pistas cacheadas por contexto
  async getCachedTracksByContext(context) {
    if (!this.isInitialized) await this.init();
    const metadata = await this.getAllMetadata();
    switch (context) {
      case AudioCache.CONTEXTS.FAVORITES:
      case AudioCache.CONTEXTS.RESONTES:
        return metadata.filter(item => item.isFavorite || item.isResonte);
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
    const targetMin = this.getAdaptiveMinTracks(context, tracks);
    if (cached.length >= targetMin) return;
    // Prioriza favoritas si aplica
    let toCache = tracks;
    if (context === AudioCache.CONTEXTS.FAVORITES || context === AudioCache.CONTEXTS.RESONTES) {
      toCache = tracks.filter(t => t.isFavorite);
      if (toCache.length < targetMin) {
        // Rellena con otras si faltan
        const others = tracks.filter(t => !t.isFavorite);
        toCache = toCache.concat(others).slice(0, targetMin);
      } else {
        toCache = toCache.slice(0, targetMin);
      }
    } else {
      toCache = toCache.slice(0, targetMin);
    }
    // Preload las necesarias (prioridad solo para resontes/favorites)
    const isResonteContext = context === AudioCache.CONTEXTS.RESONTES || context === AudioCache.CONTEXTS.FAVORITES;
    await this.preloadTracks(toCache, { priority: isResonteContext, context });
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
    // Keep legacy "favorites" queue APIs working while the app uses "resontes" terminology.
    // Some call sites still use favoritesQueue helpers.
    this.favoritesQueue = [];
    this.resontesQueue = this.favoritesQueue;
    this.maxCacheSizeKey = CACHE_CONSTANTS.AUDIO_CACHE.MAX_BYTES_STORAGE_KEY;
    this.maxCacheSizeStepBytes = CACHE_CONSTANTS.AUDIO_CACHE.LIMIT_STEP_BYTES; // +3GB per user approval
    this.minFreeBufferBytes = CACHE_CONSTANTS.AUDIO_CACHE.MIN_FREE_BUFFER_BYTES; // Keep ~50MB buffer to avoid thrashing
    this.maxCacheSize = this.loadPersistedMaxCacheSize() ?? CACHE_CONSTANTS.AUDIO_CACHE.DEFAULT_MAX_BYTES;
    this.isInitialized = false;
    this.isPreloadingResontes = false;
    this.isPreloadingSearchResults = false;
    this.isPreloadingOffline = false;
    this.lastResontesPreloadSig = null;
    this.lastResontesPreloadAt = 0;
    this.resontesPreloadCooldownMs = 60000;
    this.lastSearchPreloadSig = null;
    this.lastSearchPreloadAt = 0;
    this.searchPreloadCooldownMs = 15000;
    this.lastOfflinePreloadSig = null;
    this.lastOfflinePreloadAt = 0;
    this.offlinePreloadCooldownMs = 60000;
    this.lastLimitPromptAt = 0;
    this.limitPromptCooldownMs = CACHE_CONSTANTS.AUDIO_CACHE.LIMIT_PROMPT_COOLDOWN_MS;
    this.networkProfile = getNetworkProfile();
    this.emptyAudioResponses = new Set();
    this.lastPrefetchBlockReason = null;
    this.prefetchRetryState = { timerId: null, count: 0, pending: null, lastReason: null, lastScheduledAt: 0 };
    this.prefetchRetryMaxCount = 4;
  }

  async init() {
    try {
      // Initialize Cache API for audio files
      this.cache = await caches.open(CACHE_CONSTANTS.AUDIO_CACHE.CACHE_NAME);

      // Initialize IndexedDB for metadata
      await this.initIndexedDB();

      // Apply network-based concurrency
      this.applyNetworkProfile();
      this.attachNetworkProfileListener();
      this.attachPrefetchRetryListener();

      this.isInitialized = true;
      logCache('info', `Audio cache initialized successfully (limit: ${this.formatBytes(this.maxCacheSize)})`);
    } catch (error) {
      logCache('error', `Failed to initialize audio cache: ${error.message}`);
      throw error;
    }
  }

  applyNetworkProfile() {
    this.networkProfile = getNetworkProfile();
    applyNetworkConcurrency(this.networkProfile);
    logCache('debug', `Network profile: ${this.networkProfile.tier} (concurrency ${this.networkProfile.concurrency})`);
  }

  attachNetworkProfileListener() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection || typeof connection.addEventListener !== 'function') return;
    connection.addEventListener('change', () => this.applyNetworkProfile());
  }

  attachPrefetchRetryListener() {
    if (this._prefetchRetryListenerAttached) return;
    this._prefetchRetryListenerAttached = true;
    if (typeof window === 'undefined' || !window.addEventListener) return;
    window.addEventListener('online', () => {
      this.retryPendingPrefetches('online');
    }, { passive: true });
  }

  scheduleSilentPrefetchRetry(task, reason) {
    if (typeof task !== 'function') return;
    const state = this.prefetchRetryState;
    if (!state) return;
    state.pending = task;
    state.lastReason = reason || state.lastReason || 'unknown';
    if (state.timerId) return;
    const attempt = Math.max(0, state.count || 0);
    const delay = Math.min(60000, 2000 * Math.pow(2, attempt));
    state.lastScheduledAt = nowMs();
    state.timerId = setTimeout(() => {
      state.timerId = null;
      this.retryPendingPrefetches('timer');
    }, delay);
  }

  async retryPendingPrefetches(trigger) {
    const state = this.prefetchRetryState;
    if (!state || typeof state.pending !== 'function') return;
    if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
      this.scheduleSilentPrefetchRetry(state.pending, state.lastReason || 'offline');
      return;
    }

    const task = state.pending;
    state.pending = null;

    try {
      await task();
      state.count = 0;
    } catch (err) {
      state.count = Math.min((state.count || 0) + 1, this.prefetchRetryMaxCount);
      if (state.count >= this.prefetchRetryMaxCount) {
        state.pending = null;
        return;
      }
      state.pending = task;
      this.scheduleSilentPrefetchRetry(task, state.lastReason || (err && err.message) || trigger || 'retry');
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

        // Failed download queue (persistent)
        if (!db.objectStoreNames.contains('failedDownloads')) {
          db.createObjectStore('failedDownloads', { keyPath: 'url' });
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
        if (!blob || !blob.size) {
          logCache('warn', `Cached audio empty, removing: ${url}`);
          try { await this.remove(url); } catch {}
          return null;
        }
        // Verificar integridad si existe hash
        try {
          const meta = await this.getMetadata(url);
          if (meta && meta.hash) {
            const actualHash = await this.computeBlobHash(blob);
            if (!actualHash) {
              logCache('warn', `Integridad omitida para ${url}: hash no disponible`);
            } else if (actualHash !== meta.hash) {
              logCache('error', `Integridad fallida para ${url}: esperado ${meta.hash}, obtenido ${actualHash}`);
              if (typeof window.showStatus === 'function') {
                window.showStatus('Corrupted audio detected and removed: ' + url, 'error', 8000, 'error');
              } else {
                alert('Corrupted audio detected and removed: ' + url);
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

  async isCached(url) {
    try {
      if (!this.isInitialized) await this.init();
      const exists = await this.cache.match(url);
      return !!exists;
    } catch {
      return false;
    }
  }

  async put(url, data, isFavorite = false, metadata = {}) {
    if (!this.isInitialized) await this.init();

    try {
      const size = await this.getResponseSize(data);
      const interactive = !!isFavorite;
      const canCache = await this.ensureSpaceFor(size, { isFavorite: interactive, interactive, url });
      if (!canCache) {
        this.notifyCacheLimitReached(size, interactive);
        return;
      }

      // Calcular hash para integridad
      const blob = await data.clone().blob();
      if (!blob || !blob.size) {
        try {
          if (!this.emptyAudioResponses.has(url)) {
            logCache('debug', `Skipping cache for empty audio response: ${url}`);
            this.emptyAudioResponses.add(url);
            if (this.emptyAudioResponses.size > 200) this.emptyAudioResponses.clear();
          }
        } catch {}
        return;
      }
      const hash = await this.computeBlobHash(blob);

      // Store in Cache API (best-effort + quota recovery)
      const stored = await this.putWithQuotaRecovery(url, data, { size, isFavorite: interactive, metadata });
      if (!stored) {
        this.notifyCacheLimitReached(size, interactive);
        return;
      }

      // Store metadata in IndexedDB (con hash)
      await this.storeMetadata(url, {
        url,
        size,
        lastAccessed: nowMs(),
        // Store both flags for backward compatibility.
        isFavorite: interactive,
        isResonte: interactive,
        context: metadata.context,
        cachedAt: nowMs(),
        title: metadata.title,
        creator: metadata.creator,
        trackId: metadata.trackId,
        albumId: metadata.albumId,
        downloadOffline: metadata.downloadOffline === true,
        hash
      });

      // Enforce logical cache size (never evict resontes)
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

  async prefetchAudio(url, options = false) {
    if (!url || url === 'undefined') {
      logCache('warn', 'Skipping prefetch: invalid or undefined url');
      return;
    }
    if (!this.isInitialized) await this.init();

    const opts = (options && typeof options === 'object') ? options : { priority: !!options };
    const priority = !!opts.priority;
    const context = (opts.context && typeof opts.context === 'string') ? opts.context : null;
    const extraMeta = (opts.metadata && typeof opts.metadata === 'object') ? opts.metadata : {};

    try {
      const shouldFetch = await this.shouldPrefetch(priority);
      if (!shouldFetch) {
        logCache('info', `Skipping prefetch due to network or quota limits: ${url}`);
        if (priority) {
          this.scheduleSilentPrefetchRetry(() => this.prefetchAudio(url, opts), this.lastPrefetchBlockReason);
        }
        return;
      }

      await audioFetchQueue.enqueuePrefetch(async () => {
        const existing = await this.cache.match(url);
        if (existing) {
          logCache('debug', `Audio already cached: ${url}`);
          return; // Already cached
        }

        logCache('info', `Pre-fetching audio: ${url}`);
        let isCrossOrigin = false;
        try {
          const targetUrl = new URL(url, window.location.href);
          isCrossOrigin = targetUrl.origin !== window.location.origin;
        } catch {}

        const response = await fetch(url, isCrossOrigin ? { mode: 'cors', credentials: 'omit' } : undefined);
        if (response && response.ok) {
          await this.put(url, response, priority, { ...extraMeta, context: context || extraMeta.context });
        } else {
          throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`);
        }
      });
    } catch (error) {
      logCache('warn', `Failed to prefetch audio: ${error.message}`);
      await this.recordFailedDownload(url, { lastError: error.message, isFavorite: priority, context });
      this.scheduleBackgroundRetry();
    }
  }

  async recordFailedDownload(url, extra = {}) {
    try {
      if (!this.isInitialized) await this.init();
      const tx = this.db.transaction(['failedDownloads'], 'readwrite');
      const store = tx.objectStore('failedDownloads');
      const existingReq = store.get(url);
      existingReq.onsuccess = () => {
        const existing = existingReq.result || {};
        const payload = {
          url,
          retryCount: existing.retryCount || 0,
          lastAttempt: Date.now(),
          isFavorite: !!extra.isFavorite,
          trackId: extra.trackId,
          albumId: extra.albumId,
          downloadOffline: extra.downloadOffline === true,
          lastError: extra.lastError || existing.lastError
        };
        store.put(payload);
      };
    } catch (err) {
      logCache('warn', `Could not record failed download: ${err.message}`);
    }
  }

  scheduleBackgroundRetry() {
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready
        .then(reg => {
          if (reg.sync) {
            return reg.sync.register('retry-failed-downloads');
          }
          throw new Error('Background Sync not supported');
        })
        .catch((err) => logCache('warn', `Background Sync registration failed: ${err.message}`));
    } else {
      // Fallback: attempt retry on next online event
      window.addEventListener('online', () => {
        this.retryFailedDownloads();
      }, { once: true });
    }
  }

  async retryFailedDownloads() {
    try {
      if (!this.isInitialized) await this.init();
      const tx = this.db.transaction(['failedDownloads'], 'readwrite');
      const store = tx.objectStore('failedDownloads');
      const req = store.getAll();
      req.onsuccess = async () => {
        const items = req.result || [];
        for (const item of items) {
          try {
            const response = await fetch(item.url);
            if (!response || !response.ok) throw new Error(`Retry failed: ${response && response.status}`);
            await this.put(item.url, response.clone(), item.isFavorite, {
              trackId: item.trackId,
              albumId: item.albumId,
              downloadOffline: item.downloadOffline
            });
            store.delete(item.url);
          } catch (err) {
            const next = { ...item, retryCount: (item.retryCount || 0) + 1, lastError: err.message, lastAttempt: Date.now() };
            if (next.retryCount > 5) {
              store.delete(item.url);
            } else {
              store.put(next);
            }
          }
        }
      };
    } catch (err) {
      logCache('warn', `retryFailedDownloads failed: ${err.message}`);
    }
  }

  async preloadResontes(resontes) {
    if (!this.isInitialized) await this.init();
    if (!resontes || resontes.length === 0) return;
    if (this.isPreloadingResontes) {
      logCache('info', 'Resontes preload already in progress, skipping duplicate run');
      return;
    }

    const signature = hashTrackListSignature(resontes);
    if (signature && this.lastResontesPreloadSig === signature) {
      const elapsed = nowMs() - (this.lastResontesPreloadAt || 0);
      if (elapsed >= 0 && elapsed < this.resontesPreloadCooldownMs) {
        logCache('debug', 'Resontes preload skipped for duplicate batch');
        return;
      }
    }

    this.isPreloadingResontes = true;
    try {
      const shouldFetch = await this.shouldPrefetch(true);
      if (!shouldFetch) {
        logCache('info', 'Skipping resontes preload due to network or quota limits');
        this.scheduleSilentPrefetchRetry(() => this.preloadResontes(resontes), this.lastPrefetchBlockReason);
        return;
      }

      this.lastResontesPreloadSig = signature || this.lastResontesPreloadSig;
      this.lastResontesPreloadAt = nowMs();

      logCache('info', `Preloading ${resontes.length} resontes for offline playback`);
      // Garantiza mínimo de resontes cacheadas
      await this.ensureMinTracksPerContext(AudioCache.CONTEXTS.RESONTES, resontes);
    } finally {
      this.isPreloadingResontes = false;
    }
  }

  // Legacy alias: some modules still call preloadFavorites()
  async preloadFavorites(favorites) {
    return this.preloadResontes(favorites);
  }

  // Nuevo: Preload mínimo de resultados de búsqueda
  async preloadSearchResults(tracks) {
    if (!this.isInitialized) await this.init();
    if (!tracks || tracks.length === 0) return;
    if (this.isPreloadingSearchResults) {
      logCache('info', 'Search preload already in progress, skipping duplicate run');
      return;
    }

    const signature = hashTrackListSignature(tracks);
    if (signature && this.lastSearchPreloadSig === signature) {
      const elapsed = nowMs() - (this.lastSearchPreloadAt || 0);
      if (elapsed >= 0 && elapsed < this.searchPreloadCooldownMs) {
        logCache('debug', 'Search preload skipped for duplicate batch');
        return;
      }
    }

    const shouldFetch = await this.shouldPrefetch(false);
    if (!shouldFetch) {
      logCache('info', 'Skipping search preload due to network or quota limits');
      this.scheduleSilentPrefetchRetry(() => this.preloadSearchResults(tracks), this.lastPrefetchBlockReason);
      return;
    }

    this.lastSearchPreloadSig = signature || this.lastSearchPreloadSig;
    this.lastSearchPreloadAt = nowMs();

    this.isPreloadingSearchResults = true;
    try {
      await this.ensureMinTracksPerContext(AudioCache.CONTEXTS.SEARCH, tracks);
    } finally {
      this.isPreloadingSearchResults = false;
    }
  }

  // Nuevo: Preload mínimo para modo offline (todas las pistas)
  async preloadOffline(tracks) {
    if (!this.isInitialized) await this.init();
    if (!tracks || tracks.length === 0) return;
    if (this.isPreloadingOffline) {
      logCache('info', 'Offline preload already in progress, skipping duplicate run');
      return;
    }

    const signature = hashTrackListSignature(tracks);
    if (signature && this.lastOfflinePreloadSig === signature) {
      const elapsed = nowMs() - (this.lastOfflinePreloadAt || 0);
      if (elapsed >= 0 && elapsed < this.offlinePreloadCooldownMs) {
        logCache('debug', 'Offline preload skipped for duplicate batch');
        return;
      }
    }

    const shouldFetch = await this.shouldPrefetch(false);
    if (!shouldFetch) {
      logCache('info', 'Skipping offline preload due to network or quota limits');
      this.scheduleSilentPrefetchRetry(() => this.preloadOffline(tracks), this.lastPrefetchBlockReason);
      return;
    }

    this.lastOfflinePreloadSig = signature || this.lastOfflinePreloadSig;
    this.lastOfflinePreloadAt = nowMs();

    this.isPreloadingOffline = true;
    try {
      await this.ensureMinTracksPerContext(AudioCache.CONTEXTS.OFFLINE, tracks);
    } finally {
      this.isPreloadingOffline = false;
    }
  }

  async preloadTracks(tracks, options = false) {
    if (!this.isInitialized) await this.init();
    if (!tracks || tracks.length === 0) return;

    const opts = (options && typeof options === 'object') ? options : { priority: !!options };
    const priority = !!opts.priority;
    const context = (opts.context && typeof opts.context === 'string') ? opts.context : null;
    const shouldFetch = await this.shouldPrefetch(priority);
    if (!shouldFetch) {
      logCache('info', 'Skipping track preload due to network or quota limits');
      this.scheduleSilentPrefetchRetry(() => this.preloadTracks(tracks, opts), this.lastPrefetchBlockReason);
      return;
    }

    const prefetchPromises = tracks
      .filter(track => track && track.url && track.url !== 'undefined')
      .map(track =>
        this.prefetchAudio(track.url, { priority, context }).catch(error => {
          logCache('warn', `Failed to preload track: ${track.title}`);
        })
      );

    await Promise.allSettled(prefetchPromises);
  }

  getFavoritesQueue() {
    const q = this.favoritesQueue || this.resontesQueue || [];
    return Array.isArray(q) ? [...q] : [];
  }

  // Preferred aliases
  getResontesQueue() {
    return this.getFavoritesQueue();
  }

  loadFavoritesQueue(favorites, priority = false) {
    const next = Array.isArray(favorites) ? favorites.map(f => f && f.url).filter(Boolean) : [];
    this.favoritesQueue = next;
    this.resontesQueue = this.favoritesQueue;
  }

  loadResontesQueue(resontes, priority = false) {
    return this.loadFavoritesQueue(resontes, priority);
  }

  removeFromFavoritesQueue(url) {
    if (!this.favoritesQueue && this.resontesQueue) this.favoritesQueue = this.resontesQueue;
    if (!Array.isArray(this.favoritesQueue)) this.favoritesQueue = [];
    if (!url) return;
    const index = this.favoritesQueue.indexOf(url);
    if (index > -1) {
      this.favoritesQueue.splice(index, 1);
    }
  }

  removeFromResontesQueue(url) {
    return this.removeFromFavoritesQueue(url);
  }

  replaceFavoritesQueueItem(oldUrl, newUrl, favorites) {
    if (!this.favoritesQueue && this.resontesQueue) this.favoritesQueue = this.resontesQueue;
    if (!Array.isArray(this.favoritesQueue)) this.favoritesQueue = [];
    if (!oldUrl) return;
    const index = this.favoritesQueue.indexOf(oldUrl);
    if (index > -1) {
      if (newUrl) {
        this.favoritesQueue[index] = newUrl;
      } else {
        this.favoritesQueue.splice(index, 1);
      }
    }
  }

  replaceResontesQueueItem(oldUrl, newUrl, resontes) {
    return this.replaceFavoritesQueueItem(oldUrl, newUrl, resontes);
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
      this.lastPrefetchBlockReason = null;
      if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
        this.lastPrefetchBlockReason = 'offline';
        return false;
      }

      // Avoid aggressive downloads on slow or metered networks unless priority
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (connection) {
        if (connection.saveData && !priority) {
          this.lastPrefetchBlockReason = 'save-data';
          return false;
        }
        const slowTypes = ['slow-2g', '2g'];
        if (slowTypes.includes(connection.effectiveType) && !priority) {
          this.lastPrefetchBlockReason = 'slow-network';
          return false;
        }
      }

      // Stop if cache is near full
      const stats = await this.getUsageStats();
      if (stats.usagePercentage >= 95 && !priority) {
        logCache('info', 'Cache nearly full, skipping non-priority prefetch');
        this.lastPrefetchBlockReason = 'cache-full';
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
              window.showStatus('Failed to save offline metadata: ' + request.error, 'error', 8000, 'error');
            }
          } catch {}
          reject(request.error);
        };
      } catch (err) {
        logCache('error', `IndexedDB storeMetadata exception: ${err}`);
        try {
          if (typeof window.showStatus === 'function') {
            window.showStatus('Failed to save offline metadata: ' + err, 'error', 8000, 'error');
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
              window.showStatus('Failed to read offline metadata: ' + request.error, 'error', 8000, 'error');
            }
          } catch {}
          reject(request.error);
        };
      } catch (err) {
        logCache('error', `IndexedDB getMetadata exception: ${err}`);
        try {
          if (typeof window.showStatus === 'function') {
            window.showStatus('Failed to read offline metadata: ' + err, 'error', 8000, 'error');
          }
        } catch {}
        reject(err);
      }
    });
  }

  async updateMetadata(url, updates) {
    try {
      const existing = await this.getMetadata(url);
      const base = existing || { url, cachedAt: nowMs(), lastAccessed: nowMs() };
      const updated = { ...base, ...updates };
      await this.storeMetadata(url, updated);
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
        .filter(item => !(item.isFavorite || item.isResonte))
        .sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0));

      if (nonFavorites.length === 0) {
        // All cached items are pinned favorites; cannot evict. Offer to increase limit.
        if (interactive) {
          const increased = await this.maybeIncreaseLimitInteractively({ reason: 'favorites-only', reasonUrl });
          if (!increased) {
            try {
              if (typeof window.showStatus === 'function') {
                window.showStatus("Cache is full with resonates only. Can't free space for new files.", 'warning', 8000, 'warning');
              } else {
                alert("Cache is full with resonates only. Can't free space for new files.");
              }
            } catch {}
          }
          return increased;
        }
        try {
          if (typeof window.showStatus === 'function') {
            window.showStatus("Cache is full with resonates only. Can't free space for new files.", 'warning', 8000, 'warning');
          } else {
            alert("Cache is full with resonates only. Can't free space for new files.");
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
        .filter(item => !(item.isFavorite || item.isResonte))
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
      ? 'Not enough space to save this resonte offline.'
      : "Offline cache is full. Couldn't save this audio.";

    const msg = `${base} Size: ${this.formatBytes(size)}.`;
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
      ? `Offline storage is full (${humanCurrent}). Increase the limit by +3GB (to ${humanNext}) to save ${humanRequired}?`
      : `Offline storage is full (${humanCurrent}). Increase the limit by +3GB (to ${humanNext})?`;

    try {
      if (typeof window.showStatus === 'function') {
        window.showStatus('Offline storage is full. Confirmation required.', 'warning', 5000, 'warning');
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
        window.showStatus(`Offline storage limit increased to ${humanNext}`, 'info', 4000, 'info');
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
