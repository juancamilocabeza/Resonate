// Main configuration
const SEARCH_CONFIG = {
  maxResults: 50,
  resultsPerPage: 10,
  timeout: 10000,
  enableLazyLoading: true,
  cacheDuration: 10 * 60 * 1000,
  preloadMetadata: true
};

// Advanced audio caching system
class AdvancedAudioCache {
  constructor() {
    this.dbName = 'ResonateAudioCache';
    this.dbVersion = 4;
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

      request.onsuccess = () => {
        this.db = request.result;
        this.initialized = true;
        // Calculate current size after db is ready
        this.calculateSize().then(resolve).catch((err) => {
          console.warn('Error calculating IndexedDB size:', err);
          resolve(0);
        });
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
        } else {
          const store = event.currentTarget.transaction.objectStore(this.storeName);
          if (!store.indexNames.contains('playCount')) {
            store.createIndex('playCount', 'playCount', { unique: false });
          }
          if (!store.indexNames.contains('lastPlayed')) {
            store.createIndex('lastPlayed', 'lastPlayed', { unique: false });
          }
          if (!store.indexNames.contains('fullyListened')) {
            store.createIndex('fullyListened', 'fullyListened', { unique: false });
          }
          if (!store.indexNames.contains('isFavorite')) {
            store.createIndex('isFavorite', 'isFavorite', { unique: false });
          }
        }
      };
    });
  }

  async calculateSize() {
    if (!this.db) return 0;
    return new Promise((resolve) => {
      try {
        const transaction = this.db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.getAll();

        request.onsuccess = () => {
          this.currentSize = request.result.reduce((total, item) => total + (item.size || 0), 0);

          if (this.currentSize > this.maxSize * 0.9) {
            this.showStorageWarning();
          }

          resolve(this.currentSize);
        };

        request.onerror = () => resolve(0);
      } catch (err) {
        resolve(0);
      }
    });
  }

  async get(url) {
    if (!this.initialized) await this.init();

    return new Promise((resolve) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(url);

      request.onsuccess = () => {
        if (request.result) {
          request.result.lastAccessed = Date.now();
          request.result.playCount = (request.result.playCount || 0) + 1;
          store.put(request.result);
          resolve(request.result.blob);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => resolve(null);
    });
  }

  async put(url, blob, updateSize = true, isFavorite = false) {
    if (!this.initialized) await this.init();

    const item = {
      url: url,
      blob: blob,
      size: blob.size,
      timestamp: Date.now(),
      lastAccessed: Date.now(),
      playCount: 0,
      fullyListened: false,
      lastPlayed: null,
      isFavorite: isFavorite
    };

    return new Promise(async (resolve) => {
      if (updateSize) {
        this.currentSize += blob.size;
        await this.ensureSpace();
      }

      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(item);

      request.onsuccess = () => {
        if (isFavorite) {
          this.addToFavoritesQueue(url);
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
          item.lastAccessed = Date.now();
          store.put(item);

          this.addToFavoritesQueue(url);
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

// Enhanced search cache system
class EnhancedSearchCache {
  constructor() {
    this.searchCache = new Map();
    this.metadataCache = new Map();
    this.audioCache = new Map();
    this.maxSize = 100;
  }

  // Método genérico para obtener cualquier tipo de dato
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

  // Método genérico para almacenar cualquier tipo de dato
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

const enhancedCache = new EnhancedSearchCache();
const audioCache = new AdvancedAudioCache();

// DOM Elements
const elements = {
  audio: document.getElementById('audio'),
  art: document.getElementById('art'),
  title: document.getElementById('title'),
  creator: document.getElementById('creator'),
  description: document.getElementById('description'),
  statusMessages: document.getElementById('status-messages'),
  progressBar: document.getElementById('progress-bar'),
  progress: document.getElementById('progress'),
  currentTime: document.getElementById('current-time'),
  totalTime: document.getElementById('total-time'),
  prevBtn: document.getElementById('prev-btn'),
  playBtn: document.getElementById('play-btn'),
  nextBtn: document.getElementById('next-btn'),
  favoriteBtn: document.getElementById('favorite-btn'),
  shuffleFavoritesBtn: document.getElementById('shuffle-favorites-btn'),
  castBtn: document.getElementById('cast-btn'),
  genreSelect: document.getElementById('genre-select'),
  searchInput: document.getElementById('search-input'),
  searchResults: document.getElementById('search-results'),
  searchResultsList: document.getElementById('search-results-list'),
  favoritesToggle: document.getElementById('favorites-toggle'),
  favoritesList: document.getElementById('favorites-list'),
  startView: document.getElementById('start-view'),
  startButton: document.getElementById('start-button'),
  app: document.getElementById('app'),
  playerContent: document.getElementById('player-content')
};

// Application state
const state = {
  currentGenre: 'rock',
  currentTrack: null,
  isLoading: false,
  favorites: [],
  userInteracted: false,
  retryCount: 0,
  maxRetries: 5,
  searchResults: [],
  isPlayingFavorites: false,
  favoritesVisible: false,
  isInitialized: false,
  onPlayCallback: null,
  appStarted: false,
  pageVisible: true,
  backgroundPlaybackEnabled: true,
  albumOrigin: null,
  isSeeking: false,
  searchActive: false,
  searchTimeout: null,
  isAndroid: /Android/.test(navigator.userAgent),
  expandedAlbums: new Set(),
  shuffleFavorites: true,
  networkOnline: true,
  currentBlobUrl: null,
  autoPlaySearchResults: true,
  searchPlaylist: [],
  currentTrackListenStart: 0,
  // Internal helpers for guarding stuck loading operations
  lastFetchController: null,
  loadingWatchdogId: null,
  tracksSkippedEarly: new Map(),
  preloadedFavorites: [],
  initialPreloadDone: false,
  playbackHistory: [],
  playbackQueue: [],
  isCasting: false,
  castSession: null,
  castAvailable: false,
  currentSearchPage: 0,
  currentSearchHasMore: false,
  currentSearchQuery: '',
  isLoadingMore: false
};

function setupMediaSession() {
  if (!('mediaSession' in navigator)) {
    // Media Session API not available in this environment
    return;
  }

  try {
    navigator.mediaSession.setActionHandler('play', () => {
      togglePlay();
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      togglePlay();
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      playPrevious();
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      playNext();
    });

    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const skipTime = details.seekOffset || 10;
      elements.audio.currentTime = Math.max(0, elements.audio.currentTime - skipTime);
    });

    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const skipTime = details.seekOffset || 10;
      elements.audio.currentTime = Math.min(elements.audio.duration, elements.audio.currentTime + skipTime);
    });

    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.fastSeek && 'fastSeek' in elements.audio) {
        elements.audio.fastSeek(details.seekTime);
      } else {
        elements.audio.currentTime = details.seekTime;
      }
    });
  } catch (error) {
    console.warn('Some Media Session actions unavailable:', error);
  }
}

function updateMediaSessionMetadata(track, identifier) {
  if (!('mediaSession' in navigator)) return;

  try {
    const artwork = [];
    const archiveCoverUrl = `https://archive.org/services/img/${identifier}`;

    artwork.push({ src: archiveCoverUrl, sizes: '300x300', type: 'image/jpeg' });
    artwork.push({ src: archiveCoverUrl, sizes: '512x512', type: 'image/jpeg' });

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || 'Untitled',
      artist: track.creator || 'Unknown',
      album: track.album || identifier,
      artwork: artwork
    });

    updateMediaPositionState();
  } catch (error) {
    console.error('Error updating Media Session:', error);
  }
}

function updateMediaPositionState() {
  if (!('mediaSession' in navigator) || !elements.audio.duration) return;

  try {
    navigator.mediaSession.setPositionState({
      duration: elements.audio.duration,
      playbackRate: elements.audio.playbackRate,
      position: elements.audio.currentTime
    });
  } catch (error) {
    console.error('Error updating Media Session position:', error);
  }
}

// Connectivity monitoring
function setupConnectivityMonitoring() {
  state.networkOnline = navigator.onLine;

  window.addEventListener('online', () => {
    state.networkOnline = true;
    showStatus('Connection restored', 'info', 2000);
  });

  window.addEventListener('offline', () => {
    state.networkOnline = false;
    showStatus('Offline - Playing from cache', 'error', 3000);
  });
}

// Continuous playback management
class ContinuousPlaybackManager {
  constructor() {
    this.currentContext = null;
    this.contextData = {
      genre: { currentIndex: -1, items: [] },
      search: { currentIndex: -1, items: [] },
      favorites: { currentIndex: -1, items: [] },
      album: { currentIndex: -1, items: [], currentAlbumId: null },
      searchPlaylist: { currentIndex: -1, items: [] }
    };
  }

  setContext(context, items, startIndex = 0, albumId = null) {
    this.currentContext = context;
    this.contextData[context] = {
      currentIndex: startIndex,
      items: items || [],
      currentAlbumId: albumId
    };
  }

  getNextTrack() {
    if (!this.currentContext || !this.contextData[this.currentContext].items.length) {
      return null;
    }

    const context = this.contextData[this.currentContext];

    // Apply shuffle based on shuffleFavorites state for all contexts (album, favorites, search)
    if ((this.currentContext === 'album' || this.currentContext === 'favorites' || this.currentContext === 'search') && state.shuffleFavorites) {
      context.currentIndex = Math.floor(Math.random() * context.items.length);
    } else {
      context.currentIndex = (context.currentIndex + 1) % context.items.length;
    }

    return context.items[context.currentIndex];
  }

  getCurrentContext() {
    return this.currentContext;
  }

  hasNextTrack() {
    const context = this.contextData[this.currentContext];
    return context && context.items.length > 0 &&
      context.currentIndex < context.items.length - 1;
  }

  setAlbumPlaylist(albumId, tracks, startIndex = 0) {
    this.setContext('album', tracks, startIndex, albumId);
  }

  getCurrentAlbumId() {
    return this.contextData.album.currentAlbumId;
  }

  isPlayingAlbum(albumId = null) {
    if (albumId) {
      return this.currentContext === 'album' && this.contextData.album.currentAlbumId === albumId;
    }
    return this.currentContext === 'album';
  }

  setSearchPlaylist(tracks, startIndex = 0) {
    this.setContext('searchPlaylist', tracks, startIndex);
  }

  getPreviousTrack() {
    if (!this.currentContext || !this.contextData[this.currentContext].items.length) {
      return null;
    }

    const context = this.contextData[this.currentContext];
    context.currentIndex = (context.currentIndex - 1 + context.items.length) % context.items.length;

    return context.items[context.currentIndex];
  }
}

const playbackManager = new ContinuousPlaybackManager();

// Load favorites from local storage and update UI
function loadFavorites() {
  try {
    const favorites = localStorage.getItem('resonate_favorites');
    if (favorites) {
      state.favorites = JSON.parse(favorites);

      // Precargar favoritos en cola FIFO
      audioCache.preloadFavorites(state.favorites);
    }

    // Actualizar estado del botón de reproducción
    updatePlayButtonState();
  } catch (e) {
    state.favorites = [];
    updatePlayButtonState();
  }
}
function saveFavorites() {
  try {
    const payload = JSON.stringify(state.favorites || []);
    localStorage.setItem('resonate_favorites', payload);
    // Request preload/update of favorites in cache if available
    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.preloadFavorites === 'function') {
      audioCache.preloadFavorites(state.favorites || []);
    }
  } catch (err) {
    console.error('Error saving favorites:', err);
  }
}

function isTrackFavorite(track) {
  if (!track || !track.url) return false;
  return state.favorites.some(fav => fav.url === track.url);
}

function toggleFavorite(track) {
  if (!track || !track.url) return;

  const isFavorite = isTrackFavorite(track);

  if (isFavorite) {
    state.favorites = state.favorites.filter(fav => fav.url !== track.url);

    // Reemplazar en cola FIFO si se elimina un favorito
    if (state.playbackQueue.some(item => item.url === track.url)) {
      const availableFavorites = state.favorites.filter(fav =>
        !state.playbackQueue.some(item => item.url === fav.url)
      );

      if (availableFavorites.length > 0) {
        const randomIndex = Math.floor(Math.random() * availableFavorites.length);
        const newFavorite = availableFavorites[randomIndex];

        // Replace in queue
        const queueIndex = state.playbackQueue.findIndex(item => item.url === track.url);
        if (queueIndex !== -1) {
          state.playbackQueue[queueIndex] = newFavorite;
        }

        // Preload new favorite
        audioCache.prefetchAudio(newFavorite.url, true);
      }
    }

    audioCache.remove(track.url);
    showStatus('Removed from favorites', 'info');
  } else {
    const favoriteTrack = {
      id: track.id,
      title: track.title || 'Untitled',
      creator: track.creator || 'Unknown',
      url: track.url,
      isAlbumTrack: track.isAlbumTrack || false,
      albumId: track.albumId || track.id,
      trackIndex: track.trackIndex || 0,
      totalTracks: track.totalTracks || 1,
      albumTitle: track.album || track.title
    };
    state.favorites.push(favoriteTrack);

    // Precargar el favorito en caché
    audioCache.prefetchAudio(track.url, true);

    showStatus('Agregado a favoritos', 'info');
  }

  saveFavorites();
  updateFavoriteButton();
  updateFavoritesList();
  updatePlayButtonState();
}

// FUNCIÓN: Agregar todas las pistas de un álbum a favoritos
function addAlbumToFavorites(albumId, files) {
  if (!files || files.length === 0) return;

  let addedCount = 0;

  files.forEach((track, index) => {
    // Verificar si la pista ya está en favoritos
    if (!state.favorites.some(fav => fav.url === track.url)) {
      const favoriteTrack = {
        id: track.id,
        title: track.title || 'Sin título',
        creator: track.creator || 'Desconocido',
        url: track.url,
        isAlbumTrack: true,
        albumId: albumId,
        trackIndex: index,
        totalTracks: files.length,
        albumTitle: track.album || files[0]?.album || 'Álbum'
      };
      state.favorites.push(favoriteTrack);
      addedCount++;

      // Precargar cada favorito en caché
      audioCache.prefetchAudio(track.url, true);
    }
  });

  if (addedCount > 0) {
    saveFavorites();
    updateFavoriteButton();
    updateFavoritesList();
    updatePlayButtonState();
    showStatus(`Álbum agregado a favoritos (${addedCount} pistas)`, 'info');
  } else {
    showStatus('Todas las pistas del álbum ya están en favoritos', 'info');
  }
}

// FUNCIÓN: Remover álbum completo de favoritos
function removeAlbumFromFavorites(albumId) {
  const initialCount = state.favorites.length;
  state.favorites = state.favorites.filter(fav => fav.albumId !== albumId);
  const removedCount = initialCount - state.favorites.length;

  // Remover de la cola FIFO de favoritos
  const favoritesQueue = audioCache.getFavoritesQueue();
  favoritesQueue.forEach(url => {
    const favTrack = state.favorites.find(f => f.url === url);
    if (!favTrack) {
      audioCache.removeFromFavoritesQueue(url);
    }
  });

  saveFavorites();
  updateFavoriteButton();
  updateFavoritesList();
  updatePlayButtonState();

  if (removedCount > 0) {
    showStatus(`Álbum removido de favoritos (${removedCount} pistas)`, 'info');
  }
}

// FUNCIÓN: Verificar si todas las pistas de un álbum están en favoritos
function isAlbumInFavorites(albumId) {
  // Buscar cualquier pista del álbum en favoritos
  return state.favorites.some(fav => fav.albumId === albumId);
}

// FUNCIÓN: Verificar si todas las pistas de un álbum están en favoritos
function isCompleteAlbumInFavorites(albumId, totalTracks) {
  const albumTracks = state.favorites.filter(fav => fav.albumId === albumId);
  return albumTracks.length === totalTracks;
}

// FUNCIÓN: Actualizar el estado de favorito en los resultados de búsqueda
function updateSearchResultFavoriteState(albumId, isFavorite) {
  const resultElements = document.querySelectorAll('.search-result');
  resultElements.forEach(resultEl => {
    const resultInfo = resultEl.querySelector('.result-info');
    if (resultInfo && resultInfo.textContent.includes(albumId)) {
      const favoriteBtn = resultEl.querySelector('.result-favorite');
      if (favoriteBtn) {
        favoriteBtn.classList.toggle('active', isFavorite);
        favoriteBtn.innerHTML = isFavorite ? '❤️' : '🩶';
        favoriteBtn.title = isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos';
      }
    }
  });
}

function updateFavoriteButton() {
  if (state.currentTrack && state.currentTrack.url) {
    const isFavorite = isTrackFavorite(state.currentTrack);
    elements.favoriteBtn.classList.toggle('active', isFavorite);
    elements.favoriteBtn.textContent = isFavorite ? '❤️' : '🩶';
  } else {
    elements.favoriteBtn.classList.remove('active');
    elements.favoriteBtn.textContent = '🩶';
  }
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function showStatus(message, type = 'info', duration = 3000) {
  elements.statusMessages.innerHTML = '';

  const messageEl = document.createElement('div');
  messageEl.className = `status-message status-${type}`;
  messageEl.textContent = message;
  elements.statusMessages.appendChild(messageEl);

  if (duration > 0) {
    setTimeout(() => {
      if (messageEl.parentNode) {
        messageEl.remove();
      }
    }, duration);
  }
}

function hideSearchResults() {
  elements.searchResults.classList.remove('active');
  state.searchActive = false;

  // Opcional: quitar el foco del input para mejor UX en móviles
  if (window.innerWidth < 768) {
    elements.searchInput.blur();
  }
}

function updateShuffleButton() {
  const ctx = playbackManager.getCurrentContext();
  let noun = ctx === 'search' ? 'resultados de búsqueda' : ctx === 'album' ? 'álbum' : 'favoritos';

  // Shuffle button is always enabled for all contexts
  elements.shuffleFavoritesBtn.enable = false;

  if (state.shuffleFavorites) {
    elements.shuffleFavoritesBtn.classList.add('active');
    elements.shuffleFavoritesBtn.setAttribute('aria-label', `Desactivar reproducción aleatoria de ${noun}`);
  } else {
    elements.shuffleFavoritesBtn.classList.remove('active');
    elements.shuffleFavoritesBtn.setAttribute('aria-label', `Activar reproducción aleatoria de ${noun}`);
  }
}

// FUNCIÓN: Cargar cola FIFO según el contexto actual
async function loadPlaybackQueue(context, items, startIndex = 0) {
  state.playbackQueue = [];

  if (!items || items.length === 0) {
    // No items to load into FIFO
    return;
  }

  const queueSize = 10;
  // Queue behavior by context and shuffle mode
  if (context === 'favorites') {
    if (state.shuffleFavorites) {
      // Favorites random mode: load random selection for FIFO queue
      const shuffled = [...items].sort(() => Math.random() - 0.5);
      state.playbackQueue = shuffled.slice(0, queueSize);
    } else {
      // Sequential mode: take next `queueSize` items from startIndex
      for (let i = 0; i < queueSize; i++) {
        const index = (startIndex + i) % items.length;
        if (items[index]) state.playbackQueue.push(items[index]);
      }
    }
  } else if (context === 'search') {
    if (state.shuffleFavorites) {
      // Search random mode: shuffle and play all results
      const shuffledAll = [...items].sort(() => Math.random() - 0.5);
      state.playbackQueue = shuffledAll.slice();
    } else {
      // Sequential mode: play linearly all results from startIndex
      for (let i = 0; i < items.length; i++) {
        const index = (startIndex + i) % items.length;
        if (items[index]) state.playbackQueue.push(items[index]);
      }
    }
  } else {
    // Default behavior (other contexts): load next `queueSize` items
    for (let i = 0; i < queueSize; i++) {
      const index = (startIndex + i) % items.length;
      if (items[index]) state.playbackQueue.push(items[index]);
    }
  }

  // Preload tracks from queue
  if (state.networkOnline) {
    audioCache.preloadTracks(state.playbackQueue, true);
  }
}

function toggleShuffleFavorites() {
  state.shuffleFavorites = !state.shuffleFavorites;

  const context = playbackManager.getCurrentContext() || (state.favorites && state.favorites.length > 0 ? 'favorites' : 'search');

  if (state.shuffleFavorites) {
    // Activar modo aleatorio
    if (context === 'favorites' && state.favorites.length > 0) {
      showStatus('Reproducción aleatoria de favoritos activada', 'info', 2000);
      loadPlaybackQueue('favorites', state.favorites, 0);
      if (audioCache && typeof audioCache.loadFavoritesQueue === 'function') {
        audioCache.loadFavoritesQueue(state.favorites, true);
      }
    } else if (context === 'search' && state.searchResults && state.searchResults.length > 0) {
      showStatus('Reproducción aleatoria de resultados activada', 'info', 2000);
      loadPlaybackQueue('search', state.searchResults, 0);
      if (state.networkOnline) audioCache.preloadTracks(state.playbackQueue, true);
    } else {
      showStatus('Reproducción aleatoria activada', 'info', 2000);
    }
  } else {
    // Desactivar modo aleatorio: volver a modo secuencial
    if (context === 'favorites' && state.favorites.length > 0) {
      showStatus('Reproducción aleatoria de favoritos desactivada', 'info', 2000);
      const ctx = playbackManager.contextData['favorites'] || { currentIndex: 0, items: state.favorites };
      const currentIndex = typeof ctx.currentIndex === 'number' ? ctx.currentIndex : 0;
      loadPlaybackQueue('favorites', ctx.items.length ? ctx.items : state.favorites, currentIndex + 1);
    } else if (context === 'search' && state.searchResults && state.searchResults.length > 0) {
      showStatus('Reproducción secuencial de resultados activada', 'info', 2000);
      const ctx = playbackManager.contextData['search'] || { currentIndex: 0, items: state.searchResults };
      const currentIndex = typeof ctx.currentIndex === 'number' ? ctx.currentIndex : 0;
      loadPlaybackQueue('search', ctx.items.length ? ctx.items : state.searchResults, currentIndex + 1);
    } else {
      showStatus('Reproducción aleatoria desactivada', 'info', 2000);
    }
  }

  updateShuffleButton();
}

// Fetch with timeout for network operations
async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 8000, ...fetchOptions } = options;

  const controller = new AbortController();
  // track the controller globally so we can abort from watchdogs
  try {
    state.lastFetchController = controller;
  } catch (e) {
    // state may not be available in some rare cases during early init
  }
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    const response = await fetch(resource, {
      ...fetchOptions,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    try { state.lastFetchController = null; } catch (e) { }
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    try { state.lastFetchController = null; } catch (e) { }
    if (error && error.name === 'AbortError') {
      throw new Error(`Timeout: La petición tardó más de ${timeout}ms`);
    }
    throw error;
  }
}

async function performOptimizedSearch(query, page = 0) {
  if (!query.trim()) {
    hideSearchResults();
    return { results: [], hasMore: false };
  }

  const cacheKey = `search:${query}:${page}`;
  const cached = enhancedCache.get('search', cacheKey);

  if (cached) {
    console.debug('Cached results count:', cached.results.length);
    return cached;
  }

  elements.searchResults.classList.add('active');
  state.searchActive = true;

  try {
    const startTime = Date.now();

    // Optimized query compatible with Archive.org API
    // Multi-phase search strategy for better relevance
    const baseQuery = `(${query}) AND mediatype:audio`;

    // Phase strategy: search title AND creator first, then general
    // Improves relevance without using incompatible syntax
    const searchPhases = [
      `title:(${query}) AND creator:(${query})`, // Exact match in both
      `title:(${query})`, // Then only in title
      `creator:(${query})`, // Then only in creator
      baseQuery // Finally general search
    ];

    // Build OR query to cover all phases
    const optimizedQuery = searchPhases.join(' OR ');
    const encodedQuery = encodeURIComponent(optimizedQuery);

    const url = `https://archive.org/advancedsearch.php?q=${encodedQuery}&fl[]=identifier,title,creator,description&rows=${SEARCH_CONFIG.resultsPerPage}&page=${page + 1}&output=json&sort[]=downloads+desc`;

    const response = await fetchWithTimeout(url, {
      timeout: SEARCH_CONFIG.timeout,
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) throw new Error('Network error');

    const data = await response.json();
    const results = data.response?.docs || [];

    // Post-process results for improved relevance in client
    const processedResults = results.map(item => ({
      identifier: item.identifier,
      title: item.title || 'Untitled',
      creator: item.creator || 'Unknown',
      description: item.description || '', // Asegurar que la descripción esté incluida
      isAlbum: null,
      trackCount: null,
      relevanceScore: calculateRelevanceScore(item, query)
    }));

    // Sort by calculated relevance score (if many results)
    if (processedResults.length > 1) {
      processedResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
    }

    const hasMore = results.length === SEARCH_CONFIG.resultsPerPage;

    const searchResult = {
      results: processedResults,
      hasMore,
      total: data.response?.numFound || 0
    };

    enhancedCache.set('search', cacheKey, searchResult);

    return searchResult;

  } catch (error) {
    console.error('Error in optimized search:', error);

    // Fallback: try simple query if optimized fails
    try {
      const simpleQuery = encodeURIComponent(`(${query}) AND mediatype:audio`);
      const fallbackUrl = `https://archive.org/advancedsearch.php?q=${simpleQuery}&fl[]=identifier,title,creator&rows=${SEARCH_CONFIG.resultsPerPage}&page=${page + 1}&output=json&sort[]=downloads+desc`;

      const fallbackResponse = await fetchWithTimeout(fallbackUrl, {
        timeout: SEARCH_CONFIG.timeout
      });

      if (fallbackResponse.ok) {
        const fallbackData = await fallbackResponse.json();
        const fallbackResults = fallbackData.response?.docs || [];

        const processedFallbackResults = fallbackResults.map(item => ({
          identifier: item.identifier,
          title: item.title || 'Sin título',
          creator: item.creator || 'Desconocido',
          description: '',
          isAlbum: null,
          trackCount: null,
          relevanceScore: 0.5 // Score neutral para resultados de fallback
        }));

        const searchResult = {
          results: processedFallbackResults,
          hasMore: fallbackResults.length === SEARCH_CONFIG.resultsPerPage,
          total: fallbackData.response?.numFound || 0
        };

        enhancedCache.set('search', cacheKey, searchResult);
        return searchResult;
      }
    } catch (fallbackError) {
      console.error('Fallback también falló:', fallbackError);
    }

    elements.searchResultsList.innerHTML = '<div class="no-results">Error en la búsqueda. Intenta con otros términos.</div>';
    return { results: [], hasMore: false };
  }
}

// Función auxiliar para calcular relevancia en el cliente
function calculateRelevanceScore(item, query) {
  let score = 0;
  const queryLower = query.toLowerCase();
  const titleLower = (item.title || '').toLowerCase();
  const creatorLower = (item.creator || '').toLowerCase();
  const descriptionLower = (item.description || '').toLowerCase();

  // Puntos por coincidencia exacta en título
  if (titleLower.includes(queryLower)) {
    score += 3;
  }

  // Puntos por coincidencia exacta en creador
  if (creatorLower.includes(queryLower)) {
    score += 2;
  }

  // Puntos por coincidencia en descripción
  if (descriptionLower.includes(queryLower)) {
    score += 1;
  }

  // Bonus por coincidencia al inicio del título
  if (titleLower.startsWith(queryLower)) {
    score += 2;
  }

  // Bonus por título y creador que coinciden con la query
  if (titleLower.includes(queryLower) && creatorLower.includes(queryLower)) {
    score += 2;
  }

  return score;
}






















async function fetchOptimizedPlayableFiles(identifier) {
  const cached = enhancedCache.get('metadata', identifier);

  if (cached) {
    return cached;
  }

  const url = `https://archive.org/metadata/${identifier}`;

  try {
    const response = await fetchWithTimeout(url, { timeout: 10000 });
    if (!response.ok) throw new Error('Error al cargar metadatos');
    const metadata = await response.json();

    if (!metadata?.files) {
      throw new Error('Metadatos inválidos');
    }

    const audioFiles = metadata.files.filter(file =>
      isPlayableAudioFile(file)
    ).sort((a, b) => {
      const aIsMp3 = a.name.toLowerCase().endsWith('.mp3');
      const bIsMp3 = b.name.toLowerCase().endsWith('.mp3');

      if (aIsMp3 && !bIsMp3) return -1;
      if (!aIsMp3 && bIsMp3) return 1;

      return (a.size || 0) - (b.size || 0);
    });

    if (audioFiles.length === 0) {
      throw new Error('No hay archivos de audio reproducibles');
    }

    const playableFiles = createPlayableFiles(audioFiles, identifier, metadata);

    enhancedCache.set('metadata', identifier, playableFiles);

    return playableFiles;

  } catch (error) {
    console.error('Error al cargar archivos optimizados:', error);
    throw error;
  }
}

// Check if file is playable audio (filter out metadata, images, archives)
function isPlayableAudioFile(file) {
  if (!file.name) return false;

  const excludePatterns = [
    /_files\.xml$/i,
    /_meta\.xml$/i,
    /_reviews\.xml$/i,
    /_archive\.torrent$/i,
    /_meta\.sqlite$/i,
    /\.png$/i,
    /\.jpg$/i,
    /\.jpeg$/i,
    /\.gif$/i,
    /_thumb\./i,
    /spectrogram/i,
    /preview/i,
    /sample/i,
    /demo/i,
    /\.rar$/i,
    /\.zip$/i,
    /\.7z$/i,
    /\.tar$/i,
    /\.gz$/i
  ];

  const hasExcludedPattern = excludePatterns.some(pattern =>
    pattern.test(file.name)
  );

  if (hasExcludedPattern) return false;

  const audioFormats = ['.mp3', '.ogg', '.wav', '.flac', '.m4a', '.aac'];
  const isAudioFile = audioFormats.some(format =>
    file.name.toLowerCase().endsWith(format)
  );

  if (!isAudioFile) return false;

  const fileSize = file.size || 0;
  if (fileSize < 50000) return false;
  if (fileSize > 500000000) return false;

  return true;
}

function createPlayableFiles(audioFiles, identifier, metadata) {
  let playableFiles;

  if (audioFiles.length > 1) {
    playableFiles = audioFiles
      .map((file, index) => {
        const trackInfo = extractTrackInfo(file, metadata.metadata);

        return {
          url: `https://archive.org/download/${identifier}/${encodeURIComponent(file.name)}`,
          title: trackInfo.title || metadata.metadata?.title || file.name || identifier,
          creator: trackInfo.artist || metadata.metadata?.creator || 'Artista desconocido',
          description: metadata.metadata?.description || '', // Añadido descripción
          id: identifier,
          format: file.name.split('.').pop()?.toUpperCase() || 'MP3',
          trackNumber: trackInfo.trackNumber,
          duration: file.length || 0,
          album: metadata.metadata?.title || identifier,
          isAlbumTrack: true,
          albumId: identifier,
          trackIndex: index,
          totalTracks: audioFiles.length
        };
      })
      .sort((a, b) => {
        if (a.trackNumber !== undefined && b.trackNumber !== undefined) {
          return a.trackNumber - b.trackNumber;
        }
        return (a.title || '').localeCompare(b.title || '');
      });
  } else {
    const audioFile = audioFiles[0];
    const trackInfo = extractTrackInfo(audioFile, metadata.metadata);

    playableFiles = [{
      url: `https://archive.org/download/${identifier}/${encodeURIComponent(audioFile.name)}`,
      title: trackInfo.title || metadata.metadata?.title || audioFile.name || identifier,
      creator: trackInfo.artist || metadata.metadata?.creator || 'Artista desconocido',
      description: metadata.metadata?.description || '', // Añadido descripción
      id: identifier,
      format: audioFile.name.split('.').pop()?.toUpperCase() || 'MP3',
      album: metadata.metadata?.title || identifier,
      isAlbumTrack: false,
      trackIndex: 0,
      totalTracks: 1
    }];
  }

  return playableFiles;
}

function extractTrackInfo(file, itemMetadata) {
  const result = {
    title: null,
    artist: null,
    trackNumber: null
  };

  if (file.title) result.title = file.title;
  if (file.artist) result.artist = file.artist;
  if (file.creator) result.artist = file.creator;
  if (file.track && !isNaN(parseInt(file.track))) {
    result.trackNumber = parseInt(file.track);
  }

  if (!result.title) {
    const baseName = file.name.replace(/\.[^/.]+$/, "");

    const patterns = [
      /^(\d+)[\s\.\-]+\s*(.+?)\s*$/,
      /^(.+?)\s*-\s*(\d+)[\s\.\-]+\s*(.+?)\s*$/,
      /^(.+?)\s*-\s*(.+?)\s*$/
    ];

    for (const pattern of patterns) {
      const match = baseName.match(pattern);
      if (match) {
        if (match.length === 3) {
          result.trackNumber = parseInt(match[1]);
          result.title = match[2].trim();
        } else if (match.length === 4) {
          result.artist = match[1].trim();
          result.trackNumber = parseInt(match[2]);
          result.title = match[3].trim();
        } else if (match.length === 3 && pattern === patterns[2]) {
          result.artist = match[1].trim();
          result.title = match[2].trim();
        }

        if (result.title) break;
      }
    }

    if (!result.title) {
      result.title = itemMetadata?.title || baseName;
    }
  }

  if (!result.artist) {
    result.artist = itemMetadata?.creator;
  }

  return result;
}

// Load audio from cache or network
async function loadAudioWithCache(track) {
  if (!track || !track.url) {
    throw new Error('URL de audio no disponible');
  }

  try {
    // Intentar obtener de la caché primero
    const cachedBlob = await audioCache.get(track.url);

    if (cachedBlob) {
      console.debug('Playing from cache:', track.title);
      const blobUrl = URL.createObjectURL(cachedBlob);
      return blobUrl;
    }

    // Si no está en caché y no hay conexión, no podemos cargarlo
    if (!state.networkOnline) {
      throw new Error('Offline and audio not available in cache');
    }

    // Load from network
    showStatus('Downloading audio...', 'info', 0);
    elements.playBtn.innerHTML = '<span class="loader"></span>';

    const response = await fetchWithTimeout(track.url, { timeout: 15000 });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const blob = await response.blob();

    // Save to cache for future use (background)
    const isFavorite = isTrackFavorite(track);
    audioCache.put(track.url, blob, true, isFavorite).catch(error => {
      console.error('Error saving to cache:', error);
    });

    const blobUrl = URL.createObjectURL(blob);

    showStatus('Audio loaded', 'info', 1000);
    return blobUrl;

  } catch (error) {
    console.error('Error cargando audio:', error);

    // Intentar estrategias de fallback
    if (!state.networkOnline) {
      // Precargar pistas siguientes si estamos en un contexto
      preloadNextTrack();
    }

    throw error;
  }
}

function preloadNextTrack() {
  if (state.playbackQueue.length > 0) {
    const nextTrack = state.playbackQueue[0];
    if (nextTrack && nextTrack.url) {
      audioCache.prefetchAudio(nextTrack.url).catch(console.error);
    }
  }
}

// Track listening statistics
function setupListenTracking() {
  let endedHandlerExecuted = false;

  elements.audio.addEventListener('play', () => {
    endedHandlerExecuted = false;
    if (state.currentTrack) {
      state.currentTrackListenStart = Date.now();
    }
  });

  elements.audio.addEventListener('ended', async () => {
    // PREVENIR EJECUCIÓN MÚLTIPLE
    if (endedHandlerExecuted) {
      return;
    }
    endedHandlerExecuted = true;

    if (state.currentTrack) {
      const listenDuration = Date.now() - state.currentTrackListenStart;
      const trackDuration = elements.audio.duration * 1000; // Convertir a ms

      // Si se escuchó al menos el 90% de la pista, marcarla como escuchada completamente
      if (listenDuration >= trackDuration * 0.9) {
        await audioCache.markAsFullyListened(state.currentTrack.url);
        // Replace in FIFO when playback completes
        if (isTrackFavorite(state.currentTrack)) {
          await audioCache.replaceFavoritesQueueItem(state.currentTrack.url, null, state.favorites);
        }

        // Update usage stats and warn if very high
        const stats = await audioCache.getUsageStats();
        if (stats && stats.usagePercentage > 90) {
          showStatus(`Storage: ${stats.usagePercentage.toFixed(1)}% used`, 'info', 3000);
        }
      } else {
        // Registrar que se saltó temprano
        const skipCount = state.tracksSkippedEarly.get(state.currentTrack.url) || 0;
        state.tracksSkippedEarly.set(state.currentTrack.url, skipCount + 1);
        // Track skipped early: increment skip counter silently
      }

      state.currentTrackListenStart = 0;
    }

    // Small delay before playing next track to prevent cache conflicts
    setTimeout(() => {
      playNextInContext();
    }, 100);
  });

  elements.audio.addEventListener('seeked', () => {
    // Si el usuario busca hacia atrás, reiniciar el contador de escucha
    if (state.currentTrackListenStart > 0) {
      state.currentTrackListenStart = Date.now();
    }
  });
}

// UI setup functions
function setupSearchOnEnter() {
  elements.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      state.currentSearchPage = 0;
      state.currentSearchQuery = elements.searchInput.value.trim();
      if (state.currentSearchQuery) {
        performOptimizedSearch(state.currentSearchQuery, 0)
          .then(result => displaySearchResults(result, true));
      } else {
        hideSearchResults();
      }
    } else if (e.key === 'Escape') {
      hideSearchResults();
    }
  });
}

function setupSearchFocusBehavior() {
  let lastSearchQuery = '';
  let isCleaning = false;

  elements.searchInput.addEventListener('focus', () => {
    if (isCleaning) return;

    // Mostrar resultados solo si hay coincidencia exacta con la última búsqueda
    if (state.searchResults.length > 0 &&
      elements.searchInput.value.trim() === state.currentSearchQuery &&
      state.currentSearchQuery.length > 0) {
      elements.searchResults.classList.add('active');
      state.searchActive = true;
    }
  });

  elements.searchInput.addEventListener('input', (e) => {
    const currentQuery = e.target.value.trim();

    // Detectar si el usuario está borrando
    if (currentQuery.length < lastSearchQuery.length) {
      isCleaning = true;

      // Realizar limpieza completa inmediatamente
      performCompleteCleanup();

      // Si el campo no está vacío después de borrar, 
      // podrías considerar hacer una nueva búsqueda después de un delay
      if (currentQuery.length > 0) {
        setTimeout(() => {
          isCleaning = false;
        }, 100);
      }
    } else {
      isCleaning = false;
    }

    lastSearchQuery = currentQuery;
  });

  // También limpiar cuando el usuario pegue texto (podría ser una modificación)
  elements.searchInput.addEventListener('paste', () => {
    setTimeout(() => {
      performCompleteCleanup();
    }, 50);
  });

  // Limpiar cuando se use el botón "x" nativo del input en algunos navegadores
  elements.searchInput.addEventListener('search', () => {
    if (elements.searchInput.value === '') {
      performCompleteCleanup();
    }
  });
}

function performCompleteCleanup() {
  // Ocultar resultados visualmente
  hideSearchResults();

  // Limpiar estado de búsqueda
  state.searchResults = [];
  state.currentSearchQuery = '';
  state.currentSearchPage = 0;
  state.currentSearchHasMore = false;
  state.isLoadingMore = false;
  state.searchActive = false;

  // Limpiar el DOM
  elements.searchResultsList.innerHTML = '';

  // Limpiar timeouts
  if (state.searchTimeout) {
    clearTimeout(state.searchTimeout);
    state.searchTimeout = null;
  }

  // Limpiar cualquier observador de lazy loading
  const lazyObserver = elements.searchResultsList.querySelector('.lazy-load-observer');
  if (lazyObserver) {
    lazyObserver.remove();
  }

  console.debug('Cleanup complete: search results hidden and state reset');
}

function hideSearchResults() {
  // Ocultar visualmente los resultados
  elements.searchResults.classList.remove('active');
  state.searchActive = false;

  // Limpiar el estado de búsqueda
  state.searchResults = [];
  state.currentSearchQuery = '';
  state.currentSearchPage = 0;
  state.currentSearchHasMore = false;

  // Limpiar el DOM
  elements.searchResultsList.innerHTML = '';

  // Limpiar cualquier timeout pendiente
  if (state.searchTimeout) {
    clearTimeout(state.searchTimeout);
    state.searchTimeout = null;
  }

  // Remover cualquier observador de lazy loading
  const lazyObserver = elements.searchResultsList.querySelector('.lazy-load-observer');
  if (lazyObserver) {
    lazyObserver.remove();
  }

  console.debug('Search results hidden and cleared');
}

function createSearchResultElement(result, globalIndex) {
  const resultEl = document.createElement('div');
  resultEl.className = 'search-result';

  const hasFavoriteTrack = isAlbumInFavorites(result.identifier);

  resultEl.innerHTML = `
    <div class="result-actions">
      <div class="result-info">
        <div class="result-title">
        ${result.title}
        </div>
        <div class="result-creator">${result.creator}</div>
        <div class="result-meta">
          <span class="result-album">Cargando información...</span>
        </div>
      </div>
      <button class="result-play-btn" title="Reproducir">
        <span class="play-icon">▶</span>
      </button>
      <button class="result-favorite ${hasFavoriteTrack ? 'active' : ''}" title="${hasFavoriteTrack ? 'Quitar de favoritos' : 'Agregar a favoritos'}">
        ${hasFavoriteTrack ? '❤️' : '🩶'}
      </button>
      <button class="result-expand" title="Ver pistas del álbum">
        <span class="expand-icon">▼</span>
      </button>
    </div>    
  `;

  // Cargar información de álbum en segundo plano
  loadAlbumInfoBackground(result.identifier, resultEl);

  // Listener para el botón de reproducción
  const playBtn = resultEl.querySelector('.result-play-btn');
  playBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    showStatus(`Cargando: ${result.title}`, 'info', 0);
    await playOptimizedSearchResult(result, globalIndex, state.searchResults);
  });

  // Listener para el resultado completo (área de información)
  const resultInfo = resultEl.querySelector('.result-info');
  resultInfo.addEventListener('click', async (e) => {
    if (e.target.closest('.result-actions')) return;
    showStatus(`Cargando: ${result.title}`, 'info', 0);
    await playOptimizedSearchResult(result, globalIndex, state.searchResults);
  });

  const favoriteBtn = resultEl.querySelector('.result-favorite');
  favoriteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();

    try {
      const files = await fetchOptimizedPlayableFiles(result.identifier);
      if (files.length > 0) {
        if (files.length > 1) {
          // Es un álbum - agregar/remover todas las pistas
          if (hasFavoriteTrack) {
            removeAlbumFromFavorites(result.identifier);
            favoriteBtn.classList.remove('active');
            favoriteBtn.innerHTML = '🩶';
            favoriteBtn.title = 'Agregar a favoritos';
          } else {
            addAlbumToFavorites(result.identifier, files);
            favoriteBtn.classList.add('active');
            favoriteBtn.innerHTML = '❤️';
            favoriteBtn.title = 'Quitar de favoritos';
          }
        } else {
          // Es una pista individual
          const track = files[0];
          toggleFavorite(track);
          const isNowFavorite = isTrackFavorite(track);
          favoriteBtn.classList.toggle('active', isNowFavorite);
          favoriteBtn.innerHTML = isNowFavorite ? '❤️' : '🩶';
          favoriteBtn.title = isNowFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos';
        }
      }
    } catch (error) {
      console.error('Error al gestionar favorito:', error);
      showStatus('Error al gestionar favorito', 'error');
    }
  });

  const expandBtn = resultEl.querySelector('.result-expand');
  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const tracksContainer = resultEl.querySelector('.tracks-container') ||
      document.createElement('div');

    if (!resultEl.contains(tracksContainer)) {
      tracksContainer.className = 'tracks-container';
      tracksContainer.style.display = 'none';
      resultEl.appendChild(tracksContainer);
    }

    toggleAlbumTracks(result.identifier, tracksContainer, expandBtn);
  });

  return resultEl;
}

function displaySearchResults(searchData, clearExisting = true) {
  const { results, hasMore, total } = searchData;

  if (clearExisting) {
    elements.searchResultsList.innerHTML = '';
    state.searchResults = results;
    state.currentSearchPage = 0;
    state.currentSearchHasMore = hasMore;
    state.currentSearchQuery = elements.searchInput.value.trim();
  } else {
    state.searchResults = [...state.searchResults, ...results];
    state.currentSearchHasMore = hasMore;
  }

  if (results.length === 0 && clearExisting) {
    elements.searchResultsList.innerHTML = '<div class="no-results">No se encontraron resultados</div>';
    elements.searchResults.classList.add('active');
    // Volver a deshabilitar los controles si no hay resultados
    if (state.favorites.length === 0) {
      updatePlayButtonState();
    }
    return;
  }

  const fragment = document.createDocumentFragment();

  results.forEach((result, index) => {
    const globalIndex = clearExisting ? index : state.searchResults.length - results.length + index;
    const resultEl = createSearchResultElement(result, globalIndex);
    fragment.appendChild(resultEl);
  });

  if (clearExisting) {
    elements.searchResultsList.appendChild(fragment);
  } else {
    // Eliminar el observador anterior si existe
    const existingObserver = elements.searchResultsList.querySelector('.lazy-load-observer');
    if (existingObserver) {
      existingObserver.remove();
    }

    elements.searchResultsList.appendChild(fragment);
  }

  // Configurar lazy loading si hay más resultados
  if (hasMore && SEARCH_CONFIG.enableLazyLoading) {
    setupLazyLoadingObserver();
  }

  elements.searchResults.classList.add('active');

  // Habilitar controles si hay resultados de búsqueda
  enableControlsForSearchResults();
}

function setupLazyLoadingObserver() {
  // Crear elemento observador
  const observerElement = document.createElement('div');
  observerElement.className = 'lazy-load-observer';
  elements.searchResultsList.appendChild(observerElement);

  // Configurar Intersection Observer
  const observer = new IntersectionObserver(async (entries) => {
    if (entries[0].isIntersecting &&
      state.currentSearchHasMore &&
      !state.isLoadingMore) {

      state.isLoadingMore = true;
      state.currentSearchPage++;

      try {
        const result = await performOptimizedSearch(state.currentSearchQuery, state.currentSearchPage);
        displaySearchResults(result, false);
      } catch (error) {
        console.error('Error en lazy loading:', error);
      } finally {
        state.isLoadingMore = false;
      }
    }
  }, {
    rootMargin: '100px', // Cargar antes de llegar al final
    threshold: 0.1
  });

  observer.observe(observerElement);
}

// Load album info and update result element metadata
async function loadAlbumInfoBackground(identifier, resultEl) {
  try {
    const metadata = await fetchOptimizedPlayableFiles(identifier);
    const isAlbum = metadata.length > 1;
    const trackCount = metadata.length;

    const metaElement = resultEl.querySelector('.result-meta');
    if (metaElement) {
      metaElement.innerHTML = isAlbum ?
        `<span class="album-indicator">Álbum: ${trackCount} pistas</span>` :
        `<span class="album-indicator">Pista individual</span>`;
    }

    // Actualizar el estado del botón de favorito
    const favoriteBtn = resultEl.querySelector('.result-favorite');
    if (favoriteBtn) {
      const isFavorite = isAlbumInFavorites(identifier);
      favoriteBtn.classList.toggle('active', isFavorite);
      favoriteBtn.innerHTML = isFavorite ? '❤️' : '🩶';
      favoriteBtn.title = isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos';
    }

    // Si es un álbum, agregar botón para expandir pistas
    if (isAlbum && !resultEl.querySelector('.expand-tracks')) {
      const expandButton = document.createElement('button');
      expandButton.className = 'expand-tracks';
      expandButton.innerHTML = '▼ <span>Ver pistas</span>';
      resultEl.appendChild(expandButton);

      const tracksContainer = document.createElement('div');
      tracksContainer.className = 'tracks-container';
      tracksContainer.style.display = 'none';
      resultEl.appendChild(tracksContainer);

      expandButton.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent triggering result listener
        toggleAlbumTracks(identifier, tracksContainer, expandButton);
      });
    }
  } catch (error) {
    console.error('Error loading album info:', error);
    const metaElement = resultEl.querySelector('.result-meta');
    if (metaElement) {
      metaElement.innerHTML = '<span style="color: var(--muted); font-size: 10px;">Error cargando información</span>';
    }
  }
}

// Toggle album tracks visibility
function toggleAlbumTracks(albumId, tracksContainer, expandButton) {
  if (tracksContainer.style.display === 'none') {
    displayAlbumTracks(albumId, tracksContainer);
    tracksContainer.style.display = 'block';
    expandButton.innerHTML = '▲ <span>Ocultar pistas</span>';
    state.expandedAlbums.add(albumId);
  } else {
    tracksContainer.style.display = 'none';
    expandButton.innerHTML = '▼ <span>Ver pistas</span>';
    state.expandedAlbums.delete(albumId);
  }
}

// Display tracks for an album
function displayAlbumTracks(albumId, tracksContainer) {
  tracksContainer.innerHTML = '<div class="search-loading"><span class="loader"></span>Cargando pistas...</div>';

  fetchOptimizedPlayableFiles(albumId)
    .then(files => {
      tracksContainer.innerHTML = '';

      if (files.length === 0) {
        tracksContainer.innerHTML = '<div class="no-results">No se encontraron pistas</div>';
        return;
      }

      const tracksList = document.createElement('div');
      tracksList.className = 'tracks-list';

      files.forEach((track, index) => {
        const trackItem = document.createElement('div');
        trackItem.className = 'track-item';

        const isFavorite = isTrackFavorite(track);
        const trackNumber = track.trackNumber || index + 1;

        trackItem.innerHTML = `
          <div class="track-actions">
            <span class="track-number">${trackNumber}</span>
            <button class="track-play" data-url="${track.url}" data-title="${track.title}">▶</button>
            <button class="track-favorite ${isFavorite ? 'active' : ''}">${isFavorite ? '❤️' : '🩶'}</button>
          </div>
          <div class="track-item-info">
            <div class="track-title">${track.title || 'Sin título'}</div>
            <div class="track-creator">${track.creator || 'Desconocido'}</div>
          </div>          
        `;

        const playBtn = trackItem.querySelector('.track-play');
        playBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // Evitar que el clic se propague al resultado principal
          playSpecificTrack(track, albumId, index, files.length);
        });

        const favoriteBtn = trackItem.querySelector('.track-favorite');
        favoriteBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // Evitar que el clic se propague al resultado principal
          toggleFavorite(track);
          const isNowFavorite = isTrackFavorite(track);
          favoriteBtn.classList.toggle('active', isNowFavorite);
          favoriteBtn.textContent = isNowFavorite ? '❤️' : '🩶';
        });

        // Listener para la información de la pista (área de texto)
        const trackInfo = trackItem.querySelector('.track-item-info');
        trackInfo.addEventListener('click', (e) => {
          e.stopPropagation(); // Evitar que el clic se propague al resultado principal
          playSpecificTrack(track, albumId, index, files.length);
        });

        tracksList.appendChild(trackItem);
      });

      tracksContainer.appendChild(tracksList);
    })
    .catch(error => {
      console.error('Error cargando pistas del álbum:', error);
      tracksContainer.innerHTML = '<div class="no-results">Error al cargar las pistas</div>';
    });
}

// Play a specific track from an album
async function playSpecificTrack(track, albumId, trackIndex, totalTracks) {
  if (state.isLoading) return;

  state.isLoading = true;
  elements.playBtn.disabled = true;
  elements.playBtn.innerHTML = '<span class="loader"></span>';

  try {
    hideSearchResults();
    showStatus(`Cargando: ${track.title}`, 'info', 0);

    if (totalTracks > 1) {
      const files = await fetchOptimizedPlayableFiles(albumId);
      playbackManager.setAlbumPlaylist(albumId, files, trackIndex);
      state.albumOrigin = 'search';

      // Cargar cola FIFO con las pistas del álbum
      loadPlaybackQueue('album', files, trackIndex);
    }

    await playAudioTrackOptimized(track, albumId, trackIndex, totalTracks);

    // Ocultar resultados de búsqueda después de seleccionar una pista
    hideSearchResults();

  } catch (error) {
    console.error('Error en playSpecificTrack:', error);
    showStatus(`Error: ${error.message}`, 'error');
  } finally {
    state.isLoading = false;
    elements.playBtn.disabled = false;
    elements.playBtn.textContent = '||';
  }
}

// Play optimized search result
async function playOptimizedSearchResult(result, index, allResults) {
  if (state.isLoading) {
    console.debug('Playback in progress, ignoring click');
    return;
  }

  state.isLoading = true;
  elements.playBtn.disabled = true;
  elements.playBtn.innerHTML = '<span class="loader"></span>';

  try {
    hideSearchResults();
    showStatus(`Cargando: ${result.title}`, 'info', 0);

    const files = await fetchOptimizedPlayableFiles(result.identifier);

    if (files.length > 0) {
      if (files.length > 1) {
        showStatus(`Álbum detectado: ${files.length} pistas`, 'info', 2000);
        state.albumOrigin = 'search';
        playbackManager.setAlbumPlaylist(result.identifier, files, 0);

        // Cargar cola FIFO con las pistas del álbum
        loadPlaybackQueue('album', files, 0);

        const firstTrack = files[0];
        await playAudioTrackOptimized(firstTrack, result.identifier, 0, files.length);
      } else {
        // Crear lista precargada con todos los resultados
        const searchPlaylist = [];

        // Precargar todas las pistas de todos los resultados
        for (let i = 0; i < allResults.length; i++) {
          try {
            const resultFiles = await fetchOptimizedPlayableFiles(allResults[i].identifier);
            if (resultFiles && resultFiles.length > 0) {
              if (resultFiles.length > 1) {
                // Para álbumes, tomar solo la primera pista para simplificar
                searchPlaylist.push(resultFiles[0]);
              } else {
                searchPlaylist.push(resultFiles[0]);
              }
            }
          } catch (error) {
            console.error(`Error precargando resultado ${i}:`, error);
          }
        }

        // Configurar la lista precargada
        setupPreloadedPlayback(searchPlaylist, index);

        // Cargar cola FIFO con los resultados de búsqueda
        loadPlaybackQueue('search', searchPlaylist, index);

        const track = files[0];
        await playAudioTrackOptimized(track, result.identifier);
      }
    } else {
      throw new Error('No se encontraron archivos de audio reproducibles');
    }

  } catch (error) {
    console.error('Error in playOptimizedSearchResult:', error);

    // Restore state even on error
    state.isLoading = false;
    elements.playBtn.disabled = false;
    elements.playBtn.textContent = '▶';

    if (allResults && index < allResults.length - 1) {
      showStatus(`Error with "${result.title}", trying next...`, 'error', 2000);
      setTimeout(() => {
        playOptimizedSearchResult(allResults[index + 1], index + 1, allResults);
      }, 1500);
    } else {
      showStatus(`Error: ${error.message}`, 'error');
    }
  }
  // NOTA: Eliminamos el finally aquí porque manejamos el estado en el catch y en playAudioTrackOptimized
}

// Play audio track with UI updates and state management
async function playAudioTrackOptimized(track, identifier, trackIndex = 0, totalTracks = 1) {
  if (!track || !track.url) {
    throw new Error('Pista no disponible');
  }
  hideSearchResults();
  elements.audio.pause();
  elements.audio.currentTime = 0;

  if (totalTracks > 1) {
    elements.title.textContent = `${track.title || 'Sin título'}`;
    elements.creator.textContent = `${track.creator || 'Desconocido'} (${trackIndex + 1}/${totalTracks})`;
  } else {
    elements.title.textContent = track.title;
    elements.creator.textContent = track.creator;
  }

  // ACTUALIZACIÓN: Mostrar descripción si está disponible de forma segura
  if (elements.description) {
    if (track.description && track.description.trim() !== '') {
      elements.description.textContent = track.description;
      // Asegurar que el contenedor padre esté visible
      if (elements.description.parentElement) {
        elements.description.parentElement.style.display = 'block';
      }
    } else {
      elements.description.textContent = '';
      // Ocultar el contenedor si no hay descripción
      if (elements.description.parentElement) {
        elements.description.parentElement.style.display = 'none';
      }
    }
  }

  await setArtwork(track, identifier);

  state.currentTrack = {
    ...track,
    url: track.url,
    id: track.id || identifier,
    trackIndex: trackIndex,
    totalTracks: totalTracks,
    isAlbumTrack: totalTracks > 1,
    albumId: identifier
  };

  updateFavoriteButton();
  updateMediaSessionMetadata(track, identifier);

  showStatus(`Cargando: ${track.title}`, 'info', 0);
  elements.playBtn.innerHTML = '<span class="loader"></span>';

  return new Promise((resolve, reject) => {
    const audio = elements.audio;
    let timeoutId;

    const onCanPlay = () => {
      cleanup();
      audio.play().then(() => {
        // Restore button state when playback starts
        state.isLoading = false;
        elements.playBtn.disabled = false;
        elements.playBtn.textContent = '| |';

        if (totalTracks > 1) {
          showStatus(`Playing: ${track.title} (${trackIndex + 1}/${totalTracks})`, 'info');
        } else {
          showStatus(`Playing: ${track.title}`, 'info');
        }

        // EJECUTAR CALLBACK ONPLAY
        if (state.onPlayCallback && typeof state.onPlayCallback === 'function') {
          try {
            state.onPlayCallback({
              title: track.title,
              creator: track.creator,
              genre: state.currentGenre,
              duration: audio.duration,
              currentTime: audio.currentTime,
              id: state.currentTrack.id
            });
          } catch (error) {
            console.error('Error ejecutando callback onplay:', error);
          }
        }

        // Preload next track
        preloadNextTrack();

        resolve(true);
      }).catch(error => {
        // Handle playback error
        cleanup();
        state.isLoading = false;
        elements.playBtn.disabled = false;
        elements.playBtn.textContent = '▶';
        reject(error);
      });
    };

    const onError = (e) => {
      cleanup();
      state.isLoading = false;
      elements.playBtn.disabled = false;
      elements.playBtn.textContent = '▶';
      reject(new Error(`Error de audio: ${e.target.error?.message || 'Fuente no compatible'}`));
    };

    const cleanup = () => {
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('error', onError);
      clearTimeout(timeoutId);
    };

    // Cargar audio con caché
    loadAudioWithCache(track)
      .then(blobUrl => {
        // CORRECCIÓN CRÍTICA: Solo ahora limpiar la URL anterior y asignar la nueva
        if (state.currentBlobUrl) {
          URL.revokeObjectURL(state.currentBlobUrl);
        }

        state.currentBlobUrl = blobUrl;
        audio.src = blobUrl;
        audio.load();
        audio.preload = 'auto';

        timeoutId = setTimeout(() => {
          if (audio.readyState < 2) {
            cleanup();
            state.isLoading = false;
            elements.playBtn.disabled = false;
            elements.playBtn.textContent = '▶';
            reject(new Error('Tiempo de espera agotado al cargar audio'));
          }
        }, 20000);

        audio.addEventListener('canplay', onCanPlay, { once: true });
        audio.addEventListener('error', onError, { once: true });
      })
      .catch(error => {
        cleanup();
        state.isLoading = false;
        elements.playBtn.disabled = false;
        elements.playBtn.textContent = '▶';
        reject(error);
      });
  });
}

async function setArtwork(track, identifier) {
  elements.art.innerHTML = '';

  if (!track || !track.id) {
    elements.art.innerHTML = '<span class="hint">Sin portada</span>';
    return;
  }

  const img = new Image();
  img.alt = 'Portada del álbum';

  const archiveCoverUrl = `https://archive.org/services/img/${identifier}`;

  img.onload = () => {
    elements.art.appendChild(img);
  };

  img.onerror = () => {
    setGenericArtwork();
  };

  img.src = archiveCoverUrl;
}

function setGenericArtwork() {
  const genreColors = {
    classical: '#8B4513',
    jazz: '#FF6B35',
    rock: '#DC143C',
    electronic: '#00CED1',
    reggae: '#FFD700',
    blues: '#1E90FF',
    hiphop: '#FF1493',
    pop: '#32CD32',
    metal: '#2F4F4F',
    folk: '#DAA520',
    country: '#FF8C00',
    rnb: '#9932CC',
    latin: '#FF4500',
    ambient: '#4682B4',
    punk: '#00FF00',
    funk: '#FF69B4',
    soul: '#FFD700',
    disco: '#FF00FF',
    indie: '#87CEEB',
    alternative: '#DA70D6'
  };

  const color = genreColors[state.currentGenre] || '#6ee7b7';
  const genreName = elements.genreSelect.options[elements.genreSelect.selectedIndex].text;

  elements.art.innerHTML = `
    <div style="width: 100%; height: 100%; background: ${color}; display: flex; align-items: center; justify-content: center; color: white; flex-direction: column; padding: 20px; text-align: center;">
      <div style="font-size: 48px; margin-bottom: 10px;">♫</div>
      <div style="font-size: 14px; font-weight: 600;">${genreName}</div>
    </div>
  `;
}

// Playback control functions
function playPrevious() {
  state.userInteracted = true;
  showStatus('Pista anterior', 'info');
  playPreviousInContext();
}

function togglePlay() {
  if (state.isLoading) return;

  // Prevenir reproducción si no hay favoritos y no hay audio cargado
  if (elements.audio.paused && !elements.audio.src && state.favorites.length === 0) {
    showStatus('Agrega favoritos para comenzar a reproducir', 'info');
    return;
  }

  state.userInteracted = true;

  if (elements.audio.paused) {
    if (!elements.audio.src) {
      forcePlay();
      return;
    }

    elements.audio.play().then(() => {
      elements.playBtn.textContent = '| |';
      showStatus('Reproduciendo', 'info');

      // Actualizar Media Session
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
    }).catch(error => {
      showStatus(`Error: ${error.message}`, 'error');
    });
  } else {
    elements.audio.pause();
    elements.playBtn.textContent = '▶';
    showStatus('Pausado', 'info');

    // Actualizar Media Session
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
  }
}

function playNext() {
  state.userInteracted = true;
  showStatus('Siguiente pista', 'info');
  playNextInContext();
}

// Force playback by determining context and playing
function forcePlay() {
  if (!state.isInitialized) {
    state.isInitialized = true;
    showStatus('Iniciando Resonate...', 'info');
    elements.title.textContent = '';
    elements.creator.textContent = '';
  }

  state.userInteracted = true;

  // Clear previous playback state
  state.isLoading = false;
  state.playbackQueue = [];
  state.playbackHistory = [];

  if (state.favorites.length > 0) {
    showStatus('Playing favorites from FIFO queue', 'info');
    playFromFavoritesQueue();
  } else {
    showStatus('No hay favoritos. Selecciona un género para comenzar', 'info');
  }

}

// FUNCIÓN: Reproducir desde cola FIFO de favoritos
async function playFromFavoritesQueue() {
  if (state.isLoading || state.favorites.length === 0) return;

  state.isLoading = true;
  elements.playBtn.disabled = true;
  elements.playBtn.innerHTML = '<span class="loader"></span>';

  state.isPlayingFavorites = true;

  try {
    // Cargar cola FIFO con favoritos
    await loadPlaybackQueue('favorites', state.favorites, 0);

    if (state.playbackQueue.length === 0) {
      throw new Error('No se pudo cargar la cola de reproducción');
    }

    const track = state.playbackQueue[0];

    if (!track.url) {
      throw new Error('URL de audio no disponible en el favorito');
    }

    showStatus(`Loading from FIFO queue: ${track.title}`, 'info', 0);

    // Remove track from queue before playing
    state.playbackQueue.shift();

    await playAudioTrackOptimized(track, track.id, track.trackIndex, track.totalTracks);

    updateShuffleButton();

  } catch (error) {
    console.error('Error in playFromFavoritesQueue:', error);
    showStatus(`Error: ${error.message}`, 'error');
  } finally {
    state.isLoading = false;
    elements.playBtn.disabled = false;
    elements.playBtn.textContent = '| |';
  }
}

// Configure preloaded playback list
function setupPreloadedPlayback(tracks, startIndex = 0) {
  if (!tracks || tracks.length === 0) return;

  // Crear una lista de reproducción precargada
  const preloadedPlaylist = tracks.map(track => ({
    ...track,
    id: track.id || `preloaded-${Math.random().toString(36).substr(2, 9)}`
  }));

  // Configurar el contexto de reproducción precargado
  playbackManager.setContext('searchPlaylist', preloadedPlaylist, startIndex);
  state.autoPlaySearchResults = true;

  console.debug(`Preloaded list configured with ${preloadedPlaylist.length} tracks`);
}

// Enhanced continuous playback
async function playNextInContext() {
  // PREVENT MULTIPLE EXECUTION
  if (state.isLoading) return;
  state.isLoading = true;

  // Only replace in FIFO queue if song played completely, not on manual next button
  const currentTrackUrl = state.currentTrack?.url;

  try {
    const context = playbackManager.getCurrentContext();

    // ALBUMS: Play next track based on shuffle state (sequential if shuffle off, random if shuffle on)
    if (context === 'album') {
      const albumContext = playbackManager.contextData.album;
      const nextItem = playbackManager.getNextTrack();

      if (nextItem && albumContext.currentIndex < albumContext.items.length) {
        await playAudioTrackOptimized(nextItem, playbackManager.getCurrentAlbumId(), albumContext.currentIndex, albumContext.items.length);
        return;
      } else if (albumContext.currentIndex >= albumContext.items.length - 1) {
        // Album finished, check if we should continue with next search result
        if (state.albumOrigin === 'search') {
          const currentAlbumId = playbackManager.getCurrentAlbumId();
          const currentIndex = state.searchResults.findIndex(item => item.identifier === currentAlbumId);

          if (currentIndex !== -1 && currentIndex < state.searchResults.length - 1) {
            const nextResult = state.searchResults[currentIndex + 1];
            showStatus('Continuando con siguiente resultado de búsqueda...', 'info', 2000);

            playbackManager.setContext('search', state.searchResults, currentIndex + 1);
            await playOptimizedSearchResult(nextResult, currentIndex + 1, state.searchResults);
            return;
          }
        }
        showStatus('Fin del álbum', 'info', 2000);
        return;
      }
    }

    // Always play from FIFO queue if tracks available
    if (state.playbackQueue.length > 0) {
      const nextTrack = state.playbackQueue[0];

      // Check it's not the same as current track
      if (currentTrackUrl && nextTrack.url === currentTrackUrl) {
        // Skipping same track, moving to next
        state.playbackQueue.shift(); // Remover la duplicada
        if (state.playbackQueue.length > 0) {
          await playNextInContext(); // Intentar con la siguiente
          return;
        }
      }

      const actualNextTrack = state.playbackQueue.shift();

      // Agregar la pista actual al historial solo si es diferente
      if (state.currentTrack && state.currentTrack.url !== actualNextTrack.url) {
        state.playbackHistory.push(state.currentTrack);
      }

      try {
        await playAudioTrackOptimized(actualNextTrack, actualNextTrack.id, actualNextTrack.trackIndex, actualNextTrack.totalTracks);
        return;
      } catch (error) {
        console.error('Error reproduciendo desde cola FIFO:', error);
        // Continuar con el flujo normal si hay error
      }
    }

    // Si estamos en un contexto de búsqueda con playlist precargada
    if (context === 'searchPlaylist' && state.autoPlaySearchResults) {
      if (!playbackManager.hasNextTrack()) {
        showStatus('Fin de la lista de reproducción', 'info', 2000);
        return;
      }

      const nextItem = playbackManager.getNextTrack();
      await playAudioTrackOptimized(nextItem, nextItem.id, 0, 1);
      return;
    }

    // Para otros contextos, usar el comportamiento de precarga existente
    if (!playbackManager.hasNextTrack()) {
      if (context === 'genre') {
        await playOptimizedRandom(state.currentGenre);
      } else if (context === 'album') {
        showStatus('Fin del álbum', 'info', 2000);
        return;
      } else if (context === 'favorites') {
        showStatus('Fin de los favoritos. Selecciona un género para continuar', 'info', 2000);
        return;
      }
      if (context === 'search') {
        showStatus('Fin de la búsqueda actual', 'info', 2000);
        return;
      }
      return;
    }

    const nextItem = playbackManager.getNextTrack();

    try {
      if (context === 'genre' || context === 'search') {
        const files = await fetchOptimizedPlayableFiles(nextItem.identifier, state.currentGenre);
        if (files && files.length > 0) {
          const track = files[0];
          await playAudioTrackOptimized(track, nextItem.identifier);
        } else {
          await playNextInContext();
        }
      } else if (context === 'favorites') {
        // Use cache for favorites
        if (!nextItem.url) {
          console.error('Favorite without valid URL:', nextItem);
          setTimeout(() => playNextInContext(), 1000);
          return;
        }

        const track = {
          url: nextItem.url,
          title: nextItem.title || 'Untitled',
          creator: nextItem.creator || 'Unknown',
          id: nextItem.id,
          isAlbumTrack: nextItem.isAlbumTrack || false,
          albumId: nextItem.albumId || nextItem.id,
          trackIndex: nextItem.trackIndex || 0,
          totalTracks: nextItem.totalTracks || 1
        };

        if (!track.url || track.url === '') {
          console.error('URL de audio vacía en favorito:', track);
          showStatus('Error: URL de audio no disponible', 'error', 2000);
          setTimeout(() => playNextInContext(), 1000);
          return;
        }

        // Verificar si está en caché antes de reproducir
        const cached = await audioCache.get(track.url);
        if (!cached && !state.networkOnline) {
          showStatus('Pista no disponible sin conexión, saltando...', 'error', 2000);
          setTimeout(() => playNextInContext(), 1000);
          return;
        }

        await playAudioTrackOptimized(track, nextItem.id, nextItem.trackIndex, nextItem.totalTracks);
      }

    } catch (error) {
      console.error('Error al reproducir siguiente pista:', error);

      if (error.message.includes('conexión') || error.message.includes('offline')) {
        showStatus('Sin conexión, intentando siguiente pista...', 'error', 2000);
        setTimeout(() => playNextInContext(), 1000);
      } else {
        setTimeout(() => playNextInContext(), 1000);
      }
    }
  } catch (error) {
    console.error('Error crítico en playNextInContext:', error);
  } finally {
    state.isLoading = false;
  }
}

async function playPreviousInContext() {
  // Usar historial para botón anterior
  if (state.playbackHistory.length > 0) {
    const previousTrack = state.playbackHistory.pop();

    // Poner la pista actual de vuelta en la cola FIFO
    if (state.currentTrack) {
      state.playbackQueue.unshift(state.currentTrack);
    }

    try {
      await playAudioTrackOptimized(previousTrack, previousTrack.id, previousTrack.trackIndex, previousTrack.totalTracks);
      return;
    } catch (error) {
      console.error('Error reproduciendo desde historial:', error);
    }
  }

  const context = playbackManager.getCurrentContext();
  if (!context || !playbackManager.contextData[context].items.length) return;

  let ctx = playbackManager.contextData[context];
  ctx.currentIndex = (ctx.currentIndex - 1 + ctx.items.length) % ctx.items.length;
  const prevItem = ctx.items[ctx.currentIndex];

  try {
    if (context === 'genre' || context === 'search') {
      const files = await fetchOptimizedPlayableFiles(prevItem.identifier, state.currentGenre);
      if (files && files.length > 0) {
        const track = files[0];
        await playAudioTrackOptimized(track, prevItem.identifier);
      } else {
        await playPreviousInContext();
      }
    } else if (context === 'favorites') {
      // Use cache for favorites
      if (!prevItem.url) {
        console.error('Favorite without valid URL:', prevItem);
        setTimeout(() => playPreviousInContext(), 1000);
        return;
      }

      const track = {
        url: prevItem.url,
        title: prevItem.title || 'Untitled',
        creator: prevItem.creator || 'Unknown',
        id: prevItem.id,
        isAlbumTrack: prevItem.isAlbumTrack || false,
        albumId: prevItem.albumId || prevItem.id,
        trackIndex: prevItem.trackIndex || 0,
        totalTracks: prevItem.totalTracks || 1
      };

      // Verificar si está en caché antes de reproducir
      const cached = await audioCache.get(track.url);
      if (!cached && !state.networkOnline) {
        showStatus('Pista no disponible sin conexión, saltando...', 'error', 2000);
        setTimeout(() => playPreviousInContext(), 1000);
        return;
      }

      await playAudioTrackOptimized(track, prevItem.id, prevItem.trackIndex, prevItem.totalTracks);
    } else if (context === 'album') {
      await playAudioTrackOptimized(prevItem, playbackManager.getCurrentAlbumId(), ctx.currentIndex, ctx.items.length);
    } else if (context === 'searchPlaylist') {
      // Reproducir desde la lista de búsqueda precargada
      await playAudioTrackOptimized(prevItem, prevItem.id, 0, 1);
    }
  } catch (error) {
    console.error('Error al reproducir pista anterior:', error);
    setTimeout(() => playPreviousInContext(), 1000);
  }
}

// Favorites management
function updatePlayButtonState() {
  if (state.favorites.length === 0) {
    elements.prevBtn.disabled = true;
    elements.playBtn.disabled = true;
    elements.nextBtn.disabled = true;
    elements.favoriteBtn.disabled = true;
    elements.shuffleFavoritesBtn.disabled = true;
    elements.playBtn.title = 'Realiza una búsqueda para comenzar';
    elements.prevBtn.title = 'Realiza una búsqueda para comenzar';
    elements.nextBtn.title = 'Realiza una búsqueda para comenzar';
    elements.favoriteBtn.title = 'Realiza una búsqueda para comenzar';
    elements.shuffleFavoritesBtn.title = 'Realiza una búsqueda para comenzar';
  } else {
    // Habilitar los controles relevantes cuando haya favoritos
    if (elements.prevBtn) elements.prevBtn.disabled = false;
    if (elements.playBtn) elements.playBtn.disabled = false;
    if (elements.nextBtn) elements.nextBtn.disabled = false;
    if (elements.favoriteBtn) elements.favoriteBtn.disabled = false;
    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.disabled = false;

    if (elements.playBtn) elements.playBtn.title = 'Reproducir favoritos';
    if (elements.prevBtn) elements.prevBtn.title = 'Pista anterior';
    if (elements.nextBtn) elements.nextBtn.title = 'Siguiente pista';
    if (elements.favoriteBtn) elements.favoriteBtn.title = 'Quitar favorito';
    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.title = 'Mezclar favoritos';
  }
}

function enableControlsForSearchResults() {
  // Si no hay favoritos pero hay resultados de búsqueda, habilitar los controles
  if (state.favorites.length === 0 && state.searchResults && state.searchResults.length > 0) {
    if (elements.playBtn) elements.playBtn.disabled = false;
    if (elements.playBtn) elements.playBtn.title = 'Reproducir resultado de búsqueda';

    if (elements.favoriteBtn) elements.favoriteBtn.disabled = false;
    if (elements.favoriteBtn) elements.favoriteBtn.title = 'Agregar a favoritos';

    // Los botones prev/next funcionan dentro del contexto de búsqueda
    if (elements.prevBtn) elements.prevBtn.disabled = false;
    if (elements.nextBtn) elements.nextBtn.disabled = false;
    if (elements.prevBtn) elements.prevBtn.title = 'Pista anterior (búsqueda)';
    if (elements.nextBtn) elements.nextBtn.title = 'Siguiente pista (búsqueda)';

    // El botón shuffle funciona con los resultados actuales
    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.disabled = false;
    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.title = 'Mezclar resultados';
  }
}

// CTA banner to initiate favorites playback (captures user interaction)
function createStartFavoritesCTA() {
  if (document.getElementById('start-favorites-cta')) return;
  const container = document.createElement('div');
  container.id = 'start-favorites-cta';
  // Banner pequeño fijo en la parte inferior
  container.style.position = 'absolute';
  container.style.bottom = '16px';
  container.style.left = '50%';
  container.style.transform = 'translateX(-50%)';
  container.style.display = 'none';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';
  container.style.pointerEvents = 'auto';
  container.style.zIndex = '9999';

  container.innerHTML = `
    <div>
      <button id="start-favorites-btn" style="background:#6ee7b7; color:#000; border:none; padding:8px 12px; font-size:14px; border-radius:12px; cursor:pointer;">Reproducir favoritos</button>
      <button id="start-favorites-close" aria-label="Cerrar" style="background:transparent; border:none; color:#666; font-size:16px; cursor:pointer;">✕</button>
    </div>
  `;

  // Solo el botón inicia la reproducción (evita clicks accidentales fuera)
  container.querySelector('#start-favorites-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    handleStartFavoritesCTA();
  });

  container.querySelector('#start-favorites-close').addEventListener('click', (e) => {
    e.stopPropagation();
    hideStartFavoritesCTA();
  });

  document.body.appendChild(container);
}

function showStartFavoritesCTA() {
  const c = document.getElementById('start-favorites-cta');
  if (!c) createStartFavoritesCTA();
  const el = document.getElementById('start-favorites-cta');
  if (el) el.style.display = 'flex';
}

function hideStartFavoritesCTA() {
  const c = document.getElementById('start-favorites-cta');
  if (c && c.parentNode) c.parentNode.removeChild(c);
}

async function handleStartFavoritesCTA() {
  try {
    hideStartFavoritesCTA();
    state.userInteracted = true;
    // Si hay favoritos, reproducir la cola de favoritos (el click permite autoplay)
    if (state.favorites && state.favorites.length > 0) {
      await playFromFavoritesQueue();
    } else {
      // Fallback: intentar reproducir cualquier pista cargada
      forcePlay();
    }
  } catch (err) {
    console.error('Error al iniciar reproducción desde CTA:', err);
    showStatus(typeof err === 'string' ? err : `Error: ${err && err.message ? err.message : err}`, 'error');
  }
}

function updateFavoritesList() {
  const favoritesList = elements.favoritesList;
  favoritesList.innerHTML = '';

  // Actualizar estado del botón de reproducción
  updatePlayButtonState();

  if (state.favorites.length === 0) {
    favoritesList.innerHTML = '<div class="no-results" style="padding: 12px; text-align: center;">No hay favoritos</div>';
    return;
  }

  const favoritesByAlbum = {};

  state.favorites.forEach(favorite => {
    const albumId = favorite.albumId || favorite.id;
    if (!favoritesByAlbum[albumId]) {
      favoritesByAlbum[albumId] = {
        albumTitle: favorite.albumTitle || favorite.title,
        albumCreator: favorite.creator,
        tracks: []
      };
    }
    favoritesByAlbum[albumId].tracks.push(favorite);
  });

  Object.keys(favoritesByAlbum).forEach(albumId => {
    const albumData = favoritesByAlbum[albumId];
    const isAlbum = albumData.tracks.length > 1;

    const albumItem = document.createElement('div');
    albumItem.className = 'favorite-item';

    const albumIndicator = isAlbum ?
      `<span class="album-indicator">Álbum: ${albumData.tracks.length} pistas</span>` :
      '';

    albumItem.innerHTML = `
      <div class="favorite-info">
        <div class="favorite-title">
          ${albumData.albumTitle || 'Sin título'}
        </div>
        <div class="favorite-creator">${albumData.albumCreator || 'Desconocido'}</div>
        ${albumIndicator}
      </div>
      <div class="favorite-actions">
        <button class="button" data-id="${albumId}" data-is-album="${isAlbum}">▶</button>
        <button class="button" data-id="${albumId}">❤️</button>
      </div>
 `

    const playBtn = albumItem.querySelector('.button');
    const removeBtn = albumItem.querySelector('.button:nth-child(2)');

    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isAlbum = playBtn.getAttribute('data-is-album') === 'true';
      const id = playBtn.getAttribute('data-id');

      if (isAlbum) {
        playAlbumFromFavorites(id);
      } else {
        const favoriteTrack = state.favorites.find(fav => fav.albumId === id);
        if (favoriteTrack) {
          playFromFavoritesQueue();
        }
      }
    });

    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const albumId = removeBtn.getAttribute('data-id');

      state.favorites = state.favorites.filter(fav => fav.albumId !== albumId);
      saveFavorites();
      updateFavoritesList();
      updateFavoriteButton();
      showStatus('Eliminado de favoritos', 'info');
    });

    favoritesList.appendChild(albumItem);
  });
}

function toggleFavoritesList() {
  state.favoritesVisible = !state.favoritesVisible;

  if (state.favoritesVisible) {
    elements.favoritesList.classList.add('active');
    elements.favoritesToggle.textContent = 'Ocultar favoritos ❤️';
    updateFavoritesList();
  } else {
    elements.favoritesList.classList.remove('active');
    elements.favoritesToggle.textContent = 'Ver favoritos ❤️';
  }
}

function hideFavoritesList() {
  state.favoritesVisible = false;
  elements.favoritesList.classList.remove('active');
  elements.favoritesToggle.textContent = 'Ver favoritos ❤️';
}

// Additional helper functions
async function playAlbumFromFavorites(albumId) {
  if (state.isLoading) return;

  state.isLoading = true;
  elements.playBtn.disabled = true;
  elements.playBtn.innerHTML = '<span class="loader"></span>';

  try {
    showStatus(`Cargando álbum completo...`, 'info', 0);

    const files = await fetchOptimizedPlayableFiles(albumId);

    if (files.length > 0) {
      playbackManager.setAlbumPlaylist(albumId, files, 0);

      // Cargar cola FIFO con las pistas del álbum
      loadPlaybackQueue('album', files, 0);

      await playAudioTrackOptimized(files[0], albumId, 0, files.length);

      showStatus(`Reproduciendo álbum completo: ${files[0].album || albumId}`, 'info');
    } else {
      throw new Error('No se encontraron pistas en el álbum');
    }

  } catch (error) {
    console.error('Error en playAlbumFromFavorites:', error);
    showStatus(`Error: ${error.message}`, 'error');
  } finally {
    state.isLoading = false;
    elements.playBtn.disabled = false;
    elements.playBtn.textContent = '| |';
  }
}

async function playOptimizedFavorite(favoriteIndex = 0) {
  if (state.isLoading || state.favorites.length === 0) return;

  state.isLoading = true;
  elements.playBtn.disabled = true;
  elements.playBtn.innerHTML = '<span class="loader"></span>';

  state.isPlayingFavorites = true;

  try {
    let actualIndex;

    if (state.shuffleFavorites) {
      actualIndex = Math.floor(Math.random() * state.favorites.length);
    } else {
      actualIndex = favoriteIndex >= 0 ? favoriteIndex : 0;
    }

    playbackManager.setContext('favorites', state.favorites, actualIndex);

    const favorite = state.favorites[actualIndex];

    // Validar que el favorito tenga URL
    if (!favorite.url) {
      console.error('Favorito sin URL válida:', favorite);
      showStatus('Error: Favorito no válido, saltando al siguiente', 'error', 2000);
      const nextIndex = (actualIndex + 1) % state.favorites.length;
      return playOptimizedFavorite(nextIndex);
    }

    showStatus(`Cargando favorito: ${favorite.title}`, 'info', 0);

    const track = {
      url: favorite.url,
      title: favorite.title || 'Sin título',
      creator: favorite.creator || 'Desconocido',
      id: favorite.id,
      isAlbumTrack: favorite.isAlbumTrack || false,
      albumId: favorite.albumId || favorite.id,
      trackIndex: favorite.trackIndex || 0,
      totalTracks: favorite.totalTracks || 1
    };

    if (!track.url || track.url === '') {
      throw new Error('URL de audio no disponible en el favorito');
    }

    // VERIFICAR SI ESTÁ EN CACHÉ DE FAVORITOS PRECARGADOS
    const favoritesQueue = audioCache.getFavoritesQueue();
    const isPreloaded = favoritesQueue.includes(track.url);

    if (isPreloaded) {
      console.debug('Playing from preloaded favorites:', track.title);
    } else {
      console.debug('Favorite not preloaded, loading from network:', track.title);
    }

    const cached = await audioCache.get(track.url);
    if (!cached && !state.networkOnline) {
      showStatus('Favorito no disponible sin conexión, saltando...', 'error', 2000);
      const nextIndex = (actualIndex + 1) % state.favorites.length;
      return playOptimizedFavorite(nextIndex);
    }

    await playAudioTrackOptimized(track, favorite.id, favorite.trackIndex, favorite.totalTracks);

    updateShuffleButton();

  } catch (error) {
    console.error('Error en playOptimizedFavorite:', error);
    showStatus(`Error: ${error.message}`, 'error');

    if (state.favorites.length > 1) {
      const nextIndex = (favoriteIndex + 1) % state.favorites.length;
      setTimeout(() => playOptimizedFavorite(nextIndex), 1000);
    }
  } finally {
    state.isLoading = false;
    elements.playBtn.disabled = false;
    elements.playBtn.textContent = '| |';
  }
}

async function playOptimizedRandom(genre) {
  if (state.isLoading) return;

  state.isLoading = true;
  elements.playBtn.disabled = true;
  elements.playBtn.innerHTML = '<span class="loader"></span>';

  state.currentGenre = genre;
  state.isPlayingFavorites = false;

  try {
    showStatus(`Buscando ${genre}...`, 'info', 0);

    const simpleQuery = `${genre}`;
    const items = await performOptimizedSearch(simpleQuery, 0);

    if (items.results.length === 0) {
      throw new Error(`No se encontraron pistas para ${genre}. Intenta con otro género`);
    }

    playbackManager.setContext('genre', items.results);

    // Cargar cola FIFO con los resultados
    loadPlaybackQueue('genre', items.results, 0);

    await playNextInContext();

  } catch (error) {
    console.error('Error en playOptimizedRandom:', error);
    showStatus(`Error: ${error.message}`, 'error');
  } finally {
    state.isLoading = false;
    elements.playBtn.disabled = false;
    elements.playBtn.textContent = '||';
  }
}

// Random search results playback
async function playRandomSearchResults() {
  if (state.isLoading || state.searchResults.length === 0) return;

  state.isLoading = true;
  elements.playBtn.disabled = true;
  elements.playBtn.innerHTML = '<span class="loader"></span>';

  try {
    showStatus('Preparando lista de reproducción precargada...', 'info', 0);

    // Crear una lista de reproducción con todas las pistas de los resultados
    const searchPlaylist = [];

    // Precargar todas las pistas de los resultados
    for (const result of state.searchResults) {
      try {
        const files = await fetchOptimizedPlayableFiles(result.identifier);
        if (files && files.length > 0) {
          // Para álbumes, agregar todas las pistas
          if (files.length > 1) {
            searchPlaylist.push(...files);
          } else {
            // Para pistas individuales, agregar la única pista
            searchPlaylist.push(files[0]);
          }
        }
      } catch (error) {
        console.error(`Error cargando pistas para ${result.identifier}:`, error);
      }
    }

    if (searchPlaylist.length === 0) {
      throw new Error('No se pudieron cargar pistas de los resultados');
    }

    // Configurar la lista precargada
    setupPreloadedPlayback(searchPlaylist, 0);

    // Cargar cola FIFO con los resultados de búsqueda
    loadPlaybackQueue('search', searchPlaylist, 0);

    // Reproducir la primera pista
    const firstTrack = searchPlaylist[0];
    await playAudioTrackOptimized(firstTrack, firstTrack.id, 0, 1);

    showStatus(`Reproduciendo ${searchPlaylist.length} pistas en orden precargado`, 'info', 3000);

  } catch (error) {
    console.error('Error en playRandomSearchResults:', error);
    showStatus(`Error: ${error.message}`, 'error');
  } finally {
    state.isLoading = false;
    elements.playBtn.disabled = false;
    elements.playBtn.textContent = '||';
  }
}

// Enhanced progress bar interaction
function setupProgressBarInteraction() {
  let isDragging = false;

  const startDrag = (e) => {
    if (!elements.audio.duration || !isFinite(elements.audio.duration)) return;

    isDragging = true;
    state.isSeeking = true;
    elements.progressBar.classList.add('dragging');

    // Actualizar inmediatamente al comenzar el arrastre
    updateProgressOnDrag(e);

    if (e.cancelable) {
      e.preventDefault();
    }
  };

  const drag = (e) => {
    if (!isDragging) return;
    updateProgressOnDrag(e);
  };

  const endDrag = () => {
    if (!isDragging) return;

    isDragging = false;
    state.isSeeking = false;
    elements.progressBar.classList.remove('dragging');
  };

  const updateProgressOnDrag = (e) => {
    const progressBarRect = elements.progressBar.getBoundingClientRect();
    let clientX;

    if (e.type.includes('touch')) {
      clientX = e.touches[0].clientX;
    } else {
      clientX = e.clientX;
    }

    const clickPosition = Math.max(0, Math.min(1, (clientX - progressBarRect.left) / progressBarRect.width));
    const seekTime = clickPosition * elements.audio.duration;

    // Update display
    elements.progress.style.width = `${clickPosition * 100}%`;
    elements.currentTime.textContent = formatTime(seekTime);

    // Update audio on both drag and click
    elements.audio.currentTime = seekTime;
  };

  // Configure events - remove duplicates
  elements.progressBar.addEventListener('mousedown', startDrag);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', endDrag);

  elements.progressBar.addEventListener('touchstart', startDrag, { passive: false });
  document.addEventListener('touchmove', drag, { passive: false });
  document.addEventListener('touchend', endDrag, { passive: false });

  // SOLO UN event listener para click
  elements.progressBar.addEventListener('click', (e) => {
    if (!isDragging) { // Solo procesar clicks que no sean parte de un arrastre
      updateProgressOnDrag(e);
    }
  });
}

function updateProgressBar() {
  if (!state.isSeeking && elements.audio.duration && isFinite(elements.audio.duration)) {
    const progressPercent = (elements.audio.currentTime / elements.audio.duration) * 100;
    elements.progress.style.width = `${progressPercent}%`;
    elements.currentTime.textContent = formatTime(elements.audio.currentTime);
    elements.totalTime.textContent = formatTime(elements.audio.duration);

    // Actualizar Media Session
    updateMediaPositionState();
  }
}

// Initialize application
function startApp() {
  state.appStarted = true;
  elements.startView.classList.add('hidden');
  elements.app.classList.add('active');
  forcePlay();
}

function isRunningAsPWA() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}

// FUNCIÓN ONPLAY CRÍTICA - DEBE ESTAR DISPONIBLE GLOBALMENTE
function onplay(callback) {
  state.onPlayCallback = callback;
}

// Register service worker and handle updates
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    // Solo registrar si estamos en un entorno seguro (HTTPS o localhost)
    if (window.location.protocol === 'https:' || window.location.hostname === 'localhost') {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          // Service worker registered (silent in console to reduce noise)

          // Intentar buscar actualización inmediatamente
          registration.update().catch(err => console.warn('Error al solicitar update del SW:', err));

          // Si ya hay un worker en estado 'waiting', solicitar activación inmediata
          if (registration.waiting) {
            // Waiting service worker found; request activation (no noisy log)
            try {
              // Pedir al worker que haga skipWaiting (el SW escucha el mensaje SKIP_WAITING)
              registration.waiting.postMessage({ type: 'SKIP_WAITING' });
              showStatus('Actualizando aplicación...', 'info', 3000);
            } catch (e) {
              // Fallback a skipWaiting() si está disponible
              if (typeof registration.waiting.skipWaiting === 'function') {
                registration.waiting.skipWaiting();
              }
            }
          }

          // Verificar nuevas versiones durante la sesión
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            // New Service Worker version found (handled silently)

            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // Auto-aplicar la actualización si se trata de la PWA (al abrir la PWA queremos actualizar automáticamente)
                if (isRunningAsPWA()) {
                  try {
                    newWorker.postMessage({ type: 'SKIP_WAITING' });
                    showStatus('Actualización disponible — aplicando ahora...', 'info', 3000);
                  } catch (err) {
                    console.warn('No se pudo pedir SKIP_WAITING al worker:', err);
                  }
                } else {
                  showStatus('Nueva versión disponible. Recarga la aplicación.', 'info', 5000);
                }
              }
            });
          });
        })
        .catch((error) => {
          console.error('Error registering Service Worker:', error);
        });

      // Escuchar cambios de estado del service worker y recargar una vez
      let swRefreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Controller changed; reload once to apply the new service worker
        if (swRefreshing) return;
        swRefreshing = true;
        window.location.reload();
      });
    } else {
      // Service Worker not registered (requires HTTPS or localhost)
    }
  }
}

// PWA installation prompt setup
function setupPWAInstall() {
  let deferredPrompt;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    // Mostrar botón de instalación si es apropiado
    showInstallButton();
  });

  function showInstallButton() {
    // You can add an install button in the UI here
    // App can be installed (beforeinstallprompt) - silent

    // Ejemplo: mostrar notificación después de 30 segundos de uso
    setTimeout(() => {
      if (deferredPrompt) {
        showStatus('¿Quieres instalar Resonate para una mejor experiencia?', 'info', 5000);
      }
    }, 30000);
  }

  window.installPWA = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === 'accepted') {
        // User accepted install prompt
        showStatus('Resonate se está instalando...', 'info', 3000);
      } else {
        // User dismissed install prompt
      }

      deferredPrompt = null;
    }
  };
}

// Push notifications setup
function setupPushNotifications() {
  // Solicitar permiso para notificaciones
  if ('Notification' in window && 'serviceWorker' in navigator) {
    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        // Notification permission granted (silent)
        // Here you could subscribe to push notifications
      }
    });
  }
}

// Offline functionality setup
function setupOfflineFunctionality() {
  // Detectar cambios de conectividad
  window.addEventListener('online', () => {
    showStatus('Conexión restaurada', 'info', 2000);
    state.networkOnline = true;
  });

  window.addEventListener('offline', () => {
    showStatus('Modo offline activado', 'error', 3000);
    state.networkOnline = false;

    // Intentar reproducir desde caché si hay una pista actual
    if (state.currentTrack && elements.audio.src) {
      showStatus('Reproduciendo desde caché', 'info', 2000);
    }
  });
}

async function initializeApp() {
  // Inicializar caché de audio primero
  try {
    await audioCache.init();
    // Audio cache initialized (silent)

    // Mostrar estadísticas iniciales
    const stats = await audioCache.getUsageStats();
    if (stats) {
      // Cache stats available (logged only on error if needed)
    }
  } catch (error) {
    console.error('Error inicializando caché:', error);
  }

  loadFavorites();
  // Preparar el CTA (se mostrará si hay favoritos precargados)
  createStartFavoritesCTA();
  audioCache.setupLoadingSafety();

  setupConnectivityMonitoring();
  setupListenTracking();

  // Preparar reproducción de favoritos (sin autoplay por restricciones del navegador)
  // Cargar primer favorito pero esperar a que el usuario haga clic para reproducir
  if (state.favorites.length > 0) {
    // Preparing first favorite for playback (preload only, no autoplay)
    setTimeout(async () => {
      try {
        // Cargar cola FIFO de favoritos
        await loadPlaybackQueue('favorites', state.favorites, 0);
        if (state.playbackQueue.length > 0) {
          const firstTrack = state.playbackQueue[0];
          // Cargar metadata del primer favorito pero no reproducir
          const audioBlob = await audioCache.get(firstTrack.url);
          if (!audioBlob) {
            // Si no está en caché, intentar precargarlo
            await audioCache.prefetchAudio(firstTrack.url, true);
          }
          showStatus(`Listo para reproducir: ${firstTrack.title}. Haz clic en el botón de reproducción.`, 'info', 3000);
          // Mostrar CTA que captura la interacción del usuario para permitir autoplay
          //showStartFavoritesCTA();
        }
      } catch (error) {
        console.error('Error preparing favorites:', error);
      }
    }, 500);
  }

  // Configurar Media Session API
  setupMediaSession();

  setupSearchOnEnter();
  setupSearchFocusBehavior();
  setupProgressBarInteraction();

  // Configurar botón de transmisión - SOLO SI EL ELEMENTO EXISTE
  if (elements.castBtn) {
    elements.castBtn.style.display = 'flex';
  }

  // Configurar elementos opcionales - SOLO SI EXISTEN
  if (elements.favoritesToggle) {
    elements.favoritesToggle.addEventListener('click', toggleFavoritesList);
  }

  if (elements.audio) {
    elements.audio.addEventListener('timeupdate', updateProgressBar);
    elements.audio.addEventListener('loadedmetadata', updateProgressBar);
    elements.audio.addEventListener('play', () => {
      elements.playBtn.textContent = '| |';
      // Actualizar Media Session
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
    });

    elements.audio.addEventListener('pause', () => {
      elements.playBtn.textContent = '▶';
      // Actualizar Media Session
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
    });

    elements.audio.addEventListener('ended', () => {
      // Asegurar que el botón esté en estado correcto
      elements.playBtn.textContent = '▶';
      playNextInContext();
    });
    elements.audio.addEventListener('error', (e) => {
      console.error('Audio error:', e.target.error);
      showStatus('Playback error', 'error');

      // Restore state on error
      state.isLoading = false;
      elements.playBtn.disabled = false;
      elements.playBtn.textContent = '▶';
    });
  }

  if (elements.shuffleFavoritesBtn) {
    elements.shuffleFavoritesBtn.addEventListener('click', toggleShuffleFavorites);
  }

  if (elements.prevBtn) {
    elements.prevBtn.addEventListener('click', playPrevious);
  }

  if (elements.playBtn) {
    elements.playBtn.addEventListener('click', togglePlay);
    // Ocultar CTA si el usuario hace clic en el botón de reproducir
    elements.playBtn.addEventListener('click', hideStartFavoritesCTA);
  }

  if (elements.nextBtn) {
    elements.nextBtn.addEventListener('click', playNext);
  }

  if (elements.favoriteBtn) {
    elements.favoriteBtn.addEventListener('click', async () => {
      if (state.currentTrack && !state.currentTrack.url && state.currentTrack.id) {
        try {
          const files = await fetchOptimizedPlayableFiles(state.currentTrack.id);
          if (files.length > 0) {
            state.currentTrack.url = files[0].url;
            toggleFavorite(state.currentTrack);
          }
        } catch (error) {
          console.error('Error al obtener URL para favorito:', error);
          showStatus('Error al agregar favorito', 'error');
        }
      } else {
        toggleFavorite(state.currentTrack);
      }
    });
  }

  if (elements.genreSelect) {
    elements.genreSelect.addEventListener('change', (e) => {
      state.currentGenre = e.target.value;
      state.userInteracted = true;
      state.retryCount = 0;
      state.isPlayingFavorites = false;
      if (state.isInitialized) {
        playOptimizedRandom(state.currentGenre);
      }
    });
  }

  if (elements.favoritesToggle) {
    elements.favoritesToggle.addEventListener('click', toggleFavoritesList);
  }

  document.addEventListener('click', (e) => {
    if (!elements.searchInput.contains(e.target) &&
      !elements.searchResults.contains(e.target)) {
      hideSearchResults();
    }
  });

  document.addEventListener('click', () => {
    state.userInteracted = true;
  });

  // Configurar botón de inicio
  if (elements.startButton) {
    elements.startButton.addEventListener('click', startApp);
  }

  updateShuffleButton();

  // Inicializar PWA
  registerServiceWorker();
  setupPWAInstall();
  setupOfflineFunctionality();

  // Si la app está ejecutándose como PWA, eliminar el splash y mostrar la app inmediatamente
  if (isRunningAsPWA()) {
    try {
      if (elements.startView) elements.startView.classList.add('hidden');
      if (elements.app) elements.app.classList.add('active');
      // Remover cualquier elemento splash personalizado si existe
      const splashEl = document.querySelector('.start-view');
      if (splashEl && splashEl.parentNode) splashEl.parentNode.removeChild(splashEl);
      console.debug('PWA detected: splash removed and app activated');
    } catch (err) {
      console.warn('Error while hiding splash for PWA:', err);
    }
  }

  // EXPONER FUNCIONES GLOBALES CRÍTICAS
  window.onplay = onplay;
  window.state = state;
  window.elements = elements;
  window.playPrevious = playPrevious;
  window.playNext = playNext;
  window.playPreviousInContext = playPreviousInContext;
  window.playNextInContext = playNextInContext;
  window.forcePlay = forcePlay;
  window.playOptimizedFavorite = playOptimizedFavorite;
  window.playAlbumFromFavorites = playAlbumFromFavorites;
  window.playSpecificTrack = playSpecificTrack;
  window.toggleShuffleFavorites = toggleShuffleFavorites;
  window.addAlbumToFavorites = addAlbumToFavorites;
  window.removeAlbumFromFavorites = removeAlbumFromFavorites;
  window.isAlbumInFavorites = isAlbumInFavorites;
  window.playRandomSearchResults = playRandomSearchResults;
  window.audioCache = audioCache;
  window.installPWA = installPWA;
  window.preloadNextTrack = preloadNextTrack;
  window.loadPlaybackQueue = loadPlaybackQueue;
  window.playFromFavoritesQueue = playFromFavoritesQueue;
  window.dispatchEvent(new Event('resonate:results-rendered'));


  // Resonate initialized with enhancements (silent)
}

// INICIALIZACIÓN SEGURA
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
/*2025 Resonate Player. Todos los derechos reservados. Prohibida la reproducción total o parcial sin autorización*/