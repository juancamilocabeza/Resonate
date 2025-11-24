// Main configuration
const SEARCH_CONFIG = {
  maxResults: 50,
  resultsPerPage: 5,
  timeout: 20000,
  enableLazyLoading: true,
  cacheDuration: 10 * 60 * 1000,
  preloadMetadata: true
};

// Enhanced search cache system
class EnhancedSearchCache {
  constructor() {
    this.searchCache = new Map();
    this.metadataCache = new Map();
    this.audioCache = new Map();
    this.maxSize = 100;
  }

  get(type, key) {
    const cache = this[`${type}Cache`];
    if (!cache) return null;
    const item = cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiry) {
      cache.delete(key);
      return null;
    }
    return item.data;
  }

  set(type, key, data, ttl = SEARCH_CONFIG.cacheDuration) {
    const cache = this[`${type}Cache`];
    if (!cache) return;
    if (cache.size >= this.maxSize) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    cache.set(key, {
      data,
      expiry: Date.now() + ttl
    });
  }

  clear(type = null) {
    if (type) {
      const cache = this[`${type}Cache`];
      if (cache) cache.clear();
    } else {
      this.searchCache.clear();
      this.metadataCache.clear();
      this.audioCache.clear();
    }
  }
}

// Advanced audio caching system
class AdvancedAudioCache {
  constructor() {
    this.dbName = 'ResonateAudioCache';
    this.dbVersion = 6;
    this.storeName = 'audioFiles';
    this.maxSize = 10 * 1024 * 1024 * 1024; // 10GB máximo
    this.currentSize = 0;
    this.db = null;
    this.initialized = false;
    this.listenStats = new Map();
    this.favoritesQueue = []; // Cola FIFO para favoritos precargados
    this.maxFavorites = 5; // Máximo de favoritos precargados
    this.favoritesQueueLock = false; // Bloqueo para evitar conflictos
  }

  async init() {
    if (this.initialized) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('Error abriendo IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = async () => {
        this.db = request.result;
        this.initialized = true;
        try {
          this.currentSize = await this.calculateSize();
          resolve();
        } catch (err) {
          console.warn('Error calculating IndexedDB size:', err);
          resolve();
        }
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'url' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('size', 'size', { unique: false });
          store.createIndex('playCount', 'playCount', { unique: false });
          store.createIndex('lastPlayed', 'lastPlayed', { unique: false });
          store.createIndex('fullyListened', 'fullyListened', { unique: false });
          store.createIndex('isFavorite', 'isFavorite', { unique: false });
          store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
        } else {
          const store = event.currentTarget.transaction.objectStore(this.storeName);
          store.createIndex('lastAccessed', 'lastAccessed', { unique: false });

          if (!store.indexNames.contains('playCount')) {
            store.createIndex('playCount', 'playCount', { unique: false });
          }
          if (!store.indexNames.contains('lastPlayed')) {
            store.createIndex('lastPlayed', 'lastPlayed', { unique: false });
          }
          if (!store.indexNames.contains('fullyListened')) {
            store.createIndex('fullyListened', { unique: false });
          }
        }
        resolve(true);
      };
      request.onerror = () => resolve(false);
    });
  }

  async markAsFullyListened(url) {
    if (!this.initialized) await this.init();

    return new Promise((resolve) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(url);

      request.onsuccess = () => {
        if (request.result) {
          const item = request.result;
          item.fullyListened = true;
          item.lastPlayed = Date.now();
          store.put(item);
          resolve(true);
        } else {
          resolve(false);
        }
      };

      request.onerror = () => resolve(false);
    });
  }

  async remove(url) {
    if (!this.initialized) await this.init();

    return new Promise((resolve) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(url);

      request.onsuccess = () => {
        if (request.result) {
          this.currentSize -= request.result.size;
          store.delete(url);

          this.removeFromFavoritesQueue(url);
          resolve(true);
        } else {
          resolve(false);
        }
      };

      request.onerror = () => resolve(false);
    });
  }

  // Favorites queue management
  addToFavoritesQueue(url) {
    this.removeFromFavoritesQueue(url);
    this.favoritesQueue.push(url);
  }

  removeFromFavoritesQueue(url) {
    const index = this.favoritesQueue.indexOf(url);
    if (index !== -1) {
      this.favoritesQueue.splice(index, 1);
    }
  }

  getFavoritesQueue() {
    return [...this.favoritesQueue];
  }

  async replaceFavoritesQueueItem(oldUrl, newUrl, favorites) {
    if (this.favoritesQueueLock) {
      return false;
    }

    this.favoritesQueueLock = true;

    try {
      this.removeFromFavoritesQueue(oldUrl);

      if (!newUrl && favorites && favorites.length > 0) {
        const availableFavorites = favorites.filter(fav =>
          fav && fav.url && !this.favoritesQueue.includes(fav.url)
        );

        if (availableFavorites.length > 0) {
          const randomIndex = Math.floor(Math.random() * availableFavorites.length);
          newUrl = availableFavorites[randomIndex].url;

          this.addToFavoritesQueue(newUrl);
          await this.prefetchAudio(newUrl, true);
          return true;
        }
      } else if (newUrl) {
        this.addToFavoritesQueue(newUrl);
        await this.prefetchAudio(newUrl, true);
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error('Error in replaceFavoritesQueueItem:', error);
      return false;
    } finally {
      this.favoritesQueueLock = false;
    }
  }

  async loadFavoritesQueue(favorites, shuffle = true) {
    if (!favorites || favorites.length === 0) {
      return;
    }

    this.favoritesQueue = [];

    let favoritesToLoad;

    if (shuffle) {
      favoritesToLoad = this.shuffleArray([...favorites]).slice(0, this.maxFavorites);
    } else {
      const currentIndex = state.playbackHistory.length;
      favoritesToLoad = favorites.slice(currentIndex, currentIndex + this.maxFavorites);
    }

    const preloadPromises = [];

    for (const favorite of favoritesToLoad) {
      if (favorite && favorite.url) {
        this.addToFavoritesQueue(favorite.url);
        preloadPromises.push(this.prefetchAudio(favorite.url, true));
      }
    }

    await Promise.allSettled(preloadPromises);
  }

  async preloadFavorites(favorites) {
    if (!this.initialized) await this.init();

    await this.loadFavoritesQueue(favorites, state.shuffleFavorites);
  }

  async prefetchFavorite(favorite) {
    try {
      const existing = await this.get(favorite.url);
      if (!existing) {
        await this.prefetchAudio(favorite.url, true);
      } else {
        this.addToFavoritesQueue(favorite.url);
        await this.markAsFavorite(favorite.url);
      }
    } catch (error) {
      console.error('Error preloading favorite:', error);
    }
  }

  // Randomize array using Fisher-Yates shuffle
  shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
  }

  async calculateSize() {
    return new Promise((resolve) => {
      if (!this.initialized) {
        resolve(0);
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        const items = request.result;
        this.currentSize = items.reduce((total, item) => total + (item.size || 0), 0);
        resolve(this.currentSize);
      };

      request.onerror = () => {
        console.warn('Error calculating size:', request.error);
        resolve(0);
      };
    });
  }

  async get(url) {
    if (!this.initialized) await this.init();

    return new Promise((resolve) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(url);

      request.onsuccess = () => {
        const result = request.result;
        if (result && result.blob && result.blob instanceof Blob) {
          // Update lastAccessed time
          result.lastAccessed = Date.now();
          store.put(result).onerror = () => {
            // Ignore update errors - don't fail the operation
          };
          resolve(result);
        } else {
          // Invalid or corrupted data (silent cleanup)
          store.delete(url).onerror = () => {
            // Ignore delete errors
          };
          resolve(null);
        }
      };

      request.onerror = () => {
        console.warn('Error retrieving from cache:', request.error);
        resolve(null);
      };
    });
  }

  async put(url, blob, isInitial = false, isFavorite = false) {
    if (!this.initialized) await this.init();

    try {
      const blobSize = blob.size;
      const data = {
        url,
        blob,
        size: blobSize,
        timestamp: Date.now(),
        lastAccessed: Date.now(),
        playCount: 0,
        lastPlayed: null,
        fullyListened: false,
        isFavorite
      };

      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      // Check if we need to make space
      await this.ensureSpace();

      const request = store.put(data);

      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          this.currentSize += blobSize;
          resolve(true);
        };

        request.onerror = () => {
          console.error('Error storing in cache:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('Error in put operation:', error);
      return false;
    }
  }

  async ensureSpace() {
    if (this.currentSize <= this.maxSize) return;

    const transaction = this.db.transaction([this.storeName], 'readwrite');
    const store = transaction.objectStore(this.storeName);
    const index = store.index('lastAccessed');

    const request = index.getAll();

    request.onsuccess = async () => {
      const items = request.result.sort((a, b) => {
        if (a.isFavorite !== b.isFavorite) {
          return a.isFavorite ? 1 : -1;
        }
        if (a.fullyListened !== b.fullyListened) {
          return a.fullyListened ? 1 : -1;
        }
        return a.lastAccessed - b.lastAccessed;
      });

      let freedSpace = 0;
      const targetSize = this.maxSize * 0.85;

      for (const item of items) {
        if (this.currentSize - freedSpace <= targetSize) break;

        if (this.favoritesQueue.includes(item.url)) {
          continue;
        }

        const deleteRequest = store.delete(item.url);
        freedSpace += item.size;

        deleteRequest.onsuccess = () => {
          this.currentSize -= item.size;
        };
      }

      if (this.currentSize > this.maxSize * 0.9) {
        this.showStorageWarning();
      }
    };
  }

  showStorageWarning() {
    if (document.hidden || !state.userInteracted) return;

    showStatus('El almacenamiento está casi lleno. ¿Desea aumentar el límite en 3GB?', 'error', 10000);

    setTimeout(() => {
      if (confirm('El almacenamiento de Resonate está casi lleno. ¿Desea aumentar el límite en 3GB para continuar almacenando pistas?')) {
        this.increaseStorageLimit(3 * 1024 * 1024 * 1024);
        showStatus('Límite aumentado exitosamente', 'info', 3000);
      }
    }, 1000);
  }

  increaseStorageLimit(additionalBytes) {
    this.maxSize += additionalBytes;
  }

  setupLoadingSafety() {
    setInterval(() => {
      if (state.isLoading) {
        console.warn('state.isLoading stuck, resetting...');

        // Attempt to abort any pending network fetch associated with loading
        try {
          if (state.lastFetchController && typeof state.lastFetchController.abort === 'function') {
            state.lastFetchController.abort();
          }
        } catch (e) {
          console.warn('Error aborting pending fetch during loading safety:', e);
        } finally {
          try { state.lastFetchController = null; } catch (e) { }
        }

        // Try to recover audio element state
        try {
          if (elements.audio) {
            // Pause and clear source to break any stuck loading
            elements.audio.pause();
            if (state.currentBlobUrl) {
              try { URL.revokeObjectURL(state.currentBlobUrl); } catch (e) { }
              state.currentBlobUrl = null;
            }
            elements.audio.removeAttribute('src');
            elements.audio.load();
          }
        } catch (e) {
          console.warn('Error while resetting audio element during loading safety:', e);
        }

        // Reset state and UI
        state.isLoading = false;
        try {
          if (elements.playBtn) elements.playBtn.disabled = false;
          if (elements.playBtn) elements.playBtn.textContent = '▶';
        } catch (e) { }
      }
    }, 30000);
  }

  async preloadTracks(tracks, isInitial = false) {
    if (!this.initialized) await this.init();

    const count = isInitial ? 10 : 1;
    const preloadPromises = [];

    for (const track of tracks.slice(0, count)) {
      if (track && track.url) {
        try {
          const existing = await this.get(track.url);
          if (!existing) {
            preloadPromises.push(this.prefetchAudio(track.url));
          }
        } catch (error) {
          console.error('Error preloading track:', error);
        }
      }
    }

    await Promise.allSettled(preloadPromises);
  }

  async prefetchAudio(url, isFavorite = false) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const blob = await response.blob();
        await this.put(url, blob, true, isFavorite);
        return true;
      }
    } catch (error) {
      console.error('Error in prefetch:', error);
    }
    return false;
  }

  async markAsFavorite(url) {
    if (!this.initialized) await this.init();
    return new Promise((resolve) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(url);
      request.onsuccess = () => {
        if (request.result) {
          const item = request.result;
          item.isFavorite = true;
          store.put(item);
        }
        resolve(true);
      };
      request.onerror = () => resolve(false);
    });
  }

  async getUsageStats() {
    if (!this.initialized) await this.init();

    return new Promise((resolve) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        const items = request.result;
        const stats = {
          totalTracks: items.length,
          totalSize: this.currentSize,
          fullyListened: items.filter(item => item.fullyListened).length,
          favorites: items.filter(item => item.isFavorite).length,
          favoritesPreloaded: this.favoritesQueue.length,
          maxSize: this.maxSize,
          usagePercentage: (this.currentSize / this.maxSize) * 100
        };
        resolve(stats);
      };

      request.onerror = () => resolve(null);
    });
  }
}

// WebAssembly Audio Processor
class WebAssemblyAudioProcessor {
  constructor() {
    this.wasmModule = null;
    this.instance = null;
    this.memory = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    try {
      const response = await fetch('wasm/audio-processor.wasm');
      const bytes = await response.arrayBuffer();
      const result = await WebAssembly.instantiate(bytes, {
        env: {},
        console: {
          log: (ptr, len) => console.log(this.getString(ptr, len))
        }
      });
      this.wasmModule = result.module;
      this.instance = result.instance;
      this.memory = this.instance.exports.memory;
      this.initialized = true;
      console.log('WebAssembly audio processor initialized');
    } catch (error) {
      console.warn('WebAssembly not available, using fallback processing:', error);
      // Fallback to JavaScript implementation will be used
    }
  }

  // Apply volume adjustment using WebAssembly
  applyVolumeAdjustment(audioData, volume) {
    if (!this.initialized) {
      return this.applyVolumeAdjustmentJS(audioData, volume);
    }

    try {
      const length = audioData.length;
      const ptr = this.instance.exports.malloc(length * 4); // Float32Array

      if (!ptr) {
        console.warn('WebAssembly malloc failed, using JS fallback');
        return this.applyVolumeAdjustmentJS(audioData, volume);
      }

      const wasmArray = new Float32Array(this.memory.buffer, ptr, length);
      wasmArray.set(audioData);

      this.instance.exports.apply_volume(ptr, length, volume);

      const result = new Float32Array(audioData);
      result.set(wasmArray);

      this.instance.exports.free(ptr);
      return result;
    } catch (error) {
      console.warn('WebAssembly volume adjustment failed:', error);
      return this.applyVolumeAdjustmentJS(audioData, volume);
    }
  }

  // JavaScript fallback for volume adjustment
  applyVolumeAdjustmentJS(audioData, volume) {
    const result = new Float32Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
      result[i] = audioData[i] * volume;
    }
    return result;
  }

  // Simple echo effect using WebAssembly
  applyEchoEffect(audioData, delay = 0.5, decay = 0.3) {
    if (!this.initialized) {
      return this.applyEchoEffectJS(audioData, delay, decay);
    }

    try {
      const sampleRate = 44100; // Assume 44.1kHz
      const delaySamples = Math.floor(delay * sampleRate);
      const length = audioData.length + delaySamples;
      const ptr = this.instance.exports.malloc(length * 4);

      if (!ptr) {
        console.warn('WebAssembly malloc failed, using JS fallback');
        return this.applyEchoEffectJS(audioData, delay, decay);
      }

      const inputPtr = ptr;
      const outputPtr = ptr + (audioData.length * 4);

      const inputArray = new Float32Array(this.memory.buffer, inputPtr, audioData.length);
      const outputArray = new Float32Array(this.memory.buffer, outputPtr, audioData.length + delaySamples);

      inputArray.set(audioData);

      this.instance.exports.apply_echo(inputPtr, outputPtr, audioData.length, delaySamples, decay);

      const result = new Float32Array(audioData.length);
      result.set(outputArray.subarray(0, audioData.length));

      this.instance.exports.free(ptr);
      return result;
    } catch (error) {
      console.warn('WebAssembly echo effect failed:', error);
      return this.applyEchoEffectJS(audioData, delay, decay);
    }
  }

  // JavaScript fallback for echo effect
  applyEchoEffectJS(audioData, delay = 0.5, decay = 0.3) {
    const sampleRate = 44100;
    const delaySamples = Math.floor(delay * sampleRate);
    const result = new Float32Array(audioData.length);

    for (let i = 0; i < audioData.length; i++) {
      result[i] = audioData[i];
      if (i >= delaySamples) {
        result[i] += audioData[i - delaySamples] * decay;
      }
    }

    return result;
  }

  getString(ptr, len) {
    const view = new Uint8Array(this.memory.buffer, ptr, len);
    return new TextDecoder('utf-8').decode(view);
  }
}

const enhancedCache = new EnhancedSearchCache();
const audioCache = new AdvancedAudioCache();

// Function to check if track is favorite (used in cache.js)
function isTrackFavorite(track) {
  if (!track || !track.url) return false;
  return state.favorites.some(fav => fav.url === track.url);
}

function testWebAssemblyAudio() {
  const testBuffer = new Float32Array(1024);
  // Fill with test data (sine wave)
  for (let i = 0; i < testBuffer.length; i++) {
    testBuffer[i] = Math.sin(i * 0.1) * 0.5;
  }

  const volume = 0.8;
  const processed = audioCache.applyVolumeAdjustment(testBuffer, volume);

  console.log('WebAssembly audio test completed, processed', processed.length, 'samples');
  return processed;
}

window.isTrackFavorite = isTrackFavorite;
window.audioCache = audioCache;
window.enhancedCache = enhancedCache;

// Initialize WebAssembly processor
async function initializeWebAssembly() {
  try {
    await wasmAudioProcessor.init();
    showStatus('WebAssembly audio processor cargado', 'info');
  } catch (error) {
    console.warn('WebAssembly initialization failed, using fallback processing:', error);
    showStatus('Usando procesamiento JavaScript (WebAssembly no disponible)', 'info');
  }
}
