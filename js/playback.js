// Enhanced Playback Management System

// Note: elements object is defined in ui.js
// We access it via window.elements to avoid scope conflicts
// This file will use window.elements which gets populated when ui.js loads

// Loader Manager reference - will be populated when ui.js loads
const getLoaderManager = () => window.loaderManager;

// Constants for repeat modes
const RepeatMode = {
  ALL: 'all',           // Repeat current context
  ONE: 'one',           // Repeat current track
  CONTEXT: 'context',   // Repeat context infinitely
  INFINITE: 'infinite', // Mix contexts infinitely
  OFF: 'off'            // No repeat
};

// Retry strategies
const RetryStrategy = {
  NETWORK: { maxRetries: 5, backoff: 'exponential', baseDelay: 1000 },
  CACHE: { maxRetries: 2, backoff: 'linear', baseDelay: 500 },
  DECODE: { maxRetries: 1, backoff: 'none', baseDelay: 0 }
};

// Playback state manager
class PlaybackStateManager {
  constructor() {
    this.state = {
      current: { track: null, context: null, contextId: null },
      queue: { items: [], position: 0 },
      modes: { repeat: RepeatMode.ALL, shuffle: false },
      history: { played: [], skipped: [] },
      stats: { consecutiveFailures: 0, totalFailures: 0 }
    };
    this.contexts = new Map();
  }

  setCurrentTrack(track, context, contextId = null) {
    this.state.current = { track, context, contextId };
  }

  setRepeatMode(mode) {
    if (Object.values(RepeatMode).includes(mode)) {
      this.state.modes.repeat = mode;
    }
  }

  setShuffleMode(enabled) {
    this.state.modes.shuffle = enabled;
  }

  addToHistory(track, action = 'played') {
    if (action === 'played') {
      this.state.history.played.unshift(track);
      // Keep only last 50 tracks
      this.state.history.played = this.state.history.played.slice(0, 50);
    } else if (action === 'skipped') {
      this.state.history.skipped.unshift(track);
      this.state.history.skipped = this.state.history.skipped.slice(0, 20);
    }
  }

  recordFailure() {
    this.state.stats.consecutiveFailures++;
    this.state.stats.totalFailures++;
  }

  recordSuccess() {
    this.state.stats.consecutiveFailures = 0;
  }

  shouldEnterSafeMode() {
    return this.state.stats.consecutiveFailures >= 10;
  }

  getCurrentContext() {
    return this.state.current.context;
  }

  getCurrentContextId() {
    return this.state.current.contextId;
  }

  getRepeatMode() {
    return this.state.modes.repeat;
  }

  getShuffleMode() {
    return this.state.modes.shuffle;
  }
}

// Base context handler
class BaseContextHandler {
  constructor(playbackStateManager) {
    this.stateManager = playbackStateManager;
    this.retryManager = new RetryManager();
  }

  async handleTrackEnd() {
    throw new Error('handleTrackEnd must be implemented by subclass');
  }

  async getNextTrack() {
    throw new Error('getNextTrack must be implemented by subclass');
  }

  getContextType() {
    throw new Error('getContextType must be implemented by subclass');
  }

  shouldContinuePlayback() {
    const repeatMode = this.stateManager.getRepeatMode();
    return repeatMode !== RepeatMode.OFF;
  }
}

// Retry manager for handling failures
class RetryManager {
  constructor() {
    this.attempts = new Map();
  }

  async executeWithRetry(operation, strategy = RetryStrategy.NETWORK) {
    const key = operation.name || 'anonymous';
    const currentAttempts = this.attempts.get(key) || 0;

    if (currentAttempts >= strategy.maxRetries) {
      throw new Error(`Max retries exceeded for ${key}`);
    }

    try {
      this.attempts.set(key, currentAttempts + 1);
      const result = await operation();
      this.attempts.delete(key); // Success, reset counter
      return result;
    } catch (error) {
      if (currentAttempts + 1 >= strategy.maxRetries) {
        this.attempts.delete(key);
        throw error;
      }

      // Calculate delay based on strategy
      const delay = this.calculateDelay(strategy, currentAttempts + 1);
      await new Promise(resolve => setTimeout(resolve, delay));

      // Retry
      return this.executeWithRetry(operation, strategy);
    }
  }

  calculateDelay(strategy, attempt) {
    const { backoff, baseDelay } = strategy;

    switch (backoff) {
      case 'exponential':
        return baseDelay * Math.pow(2, attempt - 1);
      case 'linear':
        return baseDelay * attempt;
      case 'none':
      default:
        return 0;
    }
  }
}

// Legacy ContinuousPlaybackManager for backward compatibility
class ContinuousPlaybackManager {
  constructor() {
    this.currentContext = null;
    this.contextData = {
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

    // Apply shuffle based on shuffleFavorites state for all contexts (album, favorites, search, searchPlaylist)
    if ((this.currentContext === 'album' || this.currentContext === 'favorites' || this.currentContext === 'search' || this.currentContext === 'searchPlaylist') && state.shuffleFavorites) {
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

// Initialize new playback system
const playbackStateManager = new PlaybackStateManager();

// Context-specific handlers
class AlbumContextHandler extends BaseContextHandler {
  constructor(playbackStateManager) {
    super(playbackStateManager);
  }

  getContextType() {
    return 'album';
  }

  async handleTrackEnd() {
    const repeatMode = this.stateManager.getRepeatMode();
    const currentAlbumId = this.stateManager.getCurrentContextId();

    if (repeatMode === RepeatMode.ONE) {
      // Replay current track
      window.elements.audio.currentTime = 0;
      window.elements.audio.play();
      return;
    }

    if (repeatMode === RepeatMode.OFF) {
      showStatus('Album finished, ready for next', 'info', 2000);
      return;
    }

    // Try to get next track in album
    const nextTrack = await this.getNextTrack();
    if (nextTrack) {
      await this.retryManager.executeWithRetry(async () => {
        await playAudioTrackOptimized(nextTrack, currentAlbumId, nextTrack.trackIndex, nextTrack.totalTracks);
        this.stateManager.recordSuccess();
      }, RetryStrategy.NETWORK);
    } else {
      // Album finished
      if (repeatMode === RepeatMode.CONTEXT) {
        // Replay album from beginning
        const firstTrack = await this.getFirstTrack();
        if (firstTrack) {
          await this.retryManager.executeWithRetry(async () => {
            await playAudioTrackOptimized(firstTrack, currentAlbumId, 0, firstTrack.totalTracks);
          }, RetryStrategy.NETWORK);
        }
      } else if (repeatMode === RepeatMode.ALL) {
        // Continue with next context (e.g., next search result)
        this.continueToNextContext();
      } else {
        showStatus('Your album playback is complete', 'info', 2000);
      }
    }
  }

  async getNextTrack() {
    const context = playbackManager.contextData.album;
    if (!context || !context.items || context.items.length === 0) return null;

    const isShuffle = this.stateManager.getShuffleMode();
    if (isShuffle) {
      context.currentIndex = Math.floor(Math.random() * context.items.length);
    } else {
      context.currentIndex = (context.currentIndex + 1) % context.items.length;
    }

    return context.items[context.currentIndex];
  }

  async getFirstTrack() {
    const context = playbackManager.contextData.album;
    if (!context || !context.items || context.items.length === 0) return null;
    return context.items[0];
  }

  continueToNextContext() {
    // If album came from search, continue with next search result
    if (state.albumOrigin === 'search') {
      const currentAlbumId = playbackManager.getCurrentAlbumId();
      const currentIndex = state.searchResults.findIndex(item => item.identifier === currentAlbumId);

      if (currentIndex !== -1 && currentIndex < state.searchResults.length - 1) {
        const nextResult = state.searchResults[currentIndex + 1];
        showStatus('Moving to next search result soon', 'info', 2000);

        playbackManager.setContext('search', state.searchResults, currentIndex + 1);
        playOptimizedSearchResult(nextResult, currentIndex + 1, state.searchResults);
      }
    }
  }
}

class FavoritesContextHandler extends BaseContextHandler {
  constructor(playbackStateManager) {
    super(playbackStateManager);
  }

  getContextType() {
    return 'favorites';
  }

  async handleTrackEnd() {
    const repeatMode = this.stateManager.getRepeatMode();

    if (repeatMode === RepeatMode.ONE) {
      window.elements.audio.currentTime = 0;
      window.elements.audio.play();
      return;
    }

    if (repeatMode === RepeatMode.OFF) {
      showStatus('Favorites done. Search for more music', 'info', 2000);
      return;
    }

    // Try to get next track from queue or context
    const nextTrack = await this.getNextTrack();
    if (nextTrack) {
      await this.retryManager.executeWithRetry(async () => {
        await playAudioTrackOptimized(nextTrack, nextTrack.id, nextTrack.trackIndex, nextTrack.totalTracks);
        this.stateManager.recordSuccess();
      }, RetryStrategy.CACHE);
    } else {
      // No more tracks
      if (repeatMode === RepeatMode.CONTEXT || repeatMode === RepeatMode.INFINITE) {
        // Restart favorites
        loadPlaybackQueue('favorites', state.favorites, 0);
        const firstTrack = state.playbackQueue.shift();
        if (firstTrack) {
          await this.retryManager.executeWithRetry(async () => {
            await playAudioTrackOptimized(firstTrack, firstTrack.id, firstTrack.trackIndex, firstTrack.totalTracks);
          }, RetryStrategy.CACHE);
        }
      } else {
        showStatus('Favorites finished. Find more tracks', 'info', 2000);
      }
    }
  }

  async getNextTrack() {
    // First try from queue
    if (state.playbackQueue.length > 0) {
      const nextTrack = state.playbackQueue.shift();
      if (nextTrack && nextTrack.url) {
        // Check if available offline
        const cached = typeof audioCache !== 'undefined' && audioCache && typeof audioCache.get === 'function'
          ? await audioCache.get(nextTrack.url) : null;
        if (cached || state.networkOnline) {
          return nextTrack;
        }
      }
    }

    // Fallback to context navigation
    const context = playbackManager.contextData.favorites;
    if (!context || !context.items || context.items.length === 0) return null;

    const isShuffle = this.stateManager.getShuffleMode();
    if (isShuffle) {
      context.currentIndex = Math.floor(Math.random() * context.items.length);
    } else {
      context.currentIndex = (context.currentIndex + 1) % context.items.length;
    }

    const track = context.items[context.currentIndex];
    if (track && track.url) {
      const cached = typeof audioCache !== 'undefined' && audioCache && typeof audioCache.get === 'function'
        ? await audioCache.get(track.url) : null;
      if (cached || state.networkOnline) {
        return track;
      }
    }

    return null;
  }
}

class SearchContextHandler extends BaseContextHandler {
  constructor(playbackStateManager) {
    super(playbackStateManager);
  }

  getContextType() {
    return 'search';
  }

  async handleTrackEnd() {
    const repeatMode = this.stateManager.getRepeatMode();

    if (repeatMode === RepeatMode.ONE) {
      window.elements.audio.currentTime = 0;
      window.elements.audio.play();
      return;
    }

    if (repeatMode === RepeatMode.OFF) {
      showStatus('Current search results finished', 'info', 2000);
      return;
    }

    const nextTrack = await this.getNextTrack();
    if (nextTrack) {
      await this.retryManager.executeWithRetry(async () => {
        const files = await fetchOptimizedPlayableFiles(nextTrack.identifier);
        if (files && files.length > 0) {
          await playAudioTrackOptimized(files[0], nextTrack.identifier);
          this.stateManager.recordSuccess();
        }
      }, RetryStrategy.NETWORK);
    } else {
      if (repeatMode === RepeatMode.CONTEXT) {
        // Restart search results
        const context = playbackManager.contextData.search;
        if (context && context.items && context.items.length > 0) {
          context.currentIndex = 0;
          const firstItem = context.items[0];
          const files = await fetchOptimizedPlayableFiles(firstItem.identifier);
          if (files && files.length > 0) {
            await playAudioTrackOptimized(files[0], firstItem.identifier);
          }
        }
      } else {
        showStatus('Search complete. Ready for new search', 'info', 2000);
      }
    }
  }

  async getNextTrack() {
    const context = playbackManager.contextData.search;
    if (!context || !context.items || context.items.length === 0) return null;

    const isShuffle = this.stateManager.getShuffleMode();
    if (isShuffle) {
      context.currentIndex = Math.floor(Math.random() * context.items.length);
    } else {
      context.currentIndex = (context.currentIndex + 1) % context.items.length;
    }

    return context.items[context.currentIndex];
  }
}

class SearchPlaylistContextHandler extends BaseContextHandler {
  constructor(playbackStateManager) {
    super(playbackStateManager);
  }

  getContextType() {
    return 'searchPlaylist';
  }

  async handleTrackEnd() {
    const repeatMode = this.stateManager.getRepeatMode();

    if (repeatMode === RepeatMode.ONE) {
      window.elements.audio.currentTime = 0;
      window.elements.audio.play();
      return;
    }

    if (repeatMode === RepeatMode.OFF) {
      showStatus('Your playlist has finished playing', 'info', 2000);
      return;
    }

    const nextTrack = await this.getNextTrack();
    if (nextTrack) {
      await this.retryManager.executeWithRetry(async () => {
        await playAudioTrackOptimized(nextTrack, nextTrack.id, 0, 1);
        this.stateManager.recordSuccess();
      }, RetryStrategy.NETWORK);
    } else {
      if (repeatMode === RepeatMode.CONTEXT) {
        // Restart playlist
        const context = playbackManager.contextData.searchPlaylist;
        if (context && context.items && context.items.length > 0) {
          context.currentIndex = 0;
          const firstTrack = context.items[0];
          await playAudioTrackOptimized(firstTrack, firstTrack.id, 0, 1);
        }
      } else {
        showStatus('Playlist playback is now complete', 'info', 2000);
      }
    }
  }

  async getNextTrack() {
    const context = playbackManager.contextData.searchPlaylist;
    if (!context || !context.items || context.items.length === 0) return null;

    if (!playbackManager.hasNextTrack()) {
      return null;
    }

    const isShuffle = this.stateManager.getShuffleMode();
    if (isShuffle) {
      context.currentIndex = Math.floor(Math.random() * context.items.length);
    } else {
      context.currentIndex = (context.currentIndex + 1) % context.items.length;
    }

    return context.items[context.currentIndex];
  }
}

// Context handler factory
class ContextHandlerFactory {
  static createHandler(contextType, playbackStateManager) {
    switch (contextType) {
      case 'album':
        return new AlbumContextHandler(playbackStateManager);
      case 'favorites':
        return new FavoritesContextHandler(playbackStateManager);
      case 'search':
        return new SearchContextHandler(playbackStateManager);
      case 'searchPlaylist':
        return new SearchPlaylistContextHandler(playbackStateManager);
      default:
        return new FavoritesContextHandler(playbackStateManager); // fallback
    }
  }
}

// Enhanced playback controller
class EnhancedPlaybackController {
  constructor() {
    this.stateManager = playbackStateManager;
    this.currentHandler = null;
  }

  setContext(contextType, contextId = null) {
    this.stateManager.setCurrentTrack(null, contextType, contextId);
    this.currentHandler = ContextHandlerFactory.createHandler(contextType, this.stateManager);
  }

  async handleTrackEnd() {
    if (!this.currentHandler) return;

    try {
      await this.currentHandler.handleTrackEnd();
    } catch (error) {
      console.error('Error in track end handling:', error);
      this.stateManager.recordFailure();

      if (this.stateManager.shouldEnterSafeMode()) {
        showStatus('Too many errors. Enabling safety mode', 'error', 3000);
        showStatus('Playback paused for system safety', 'warning', 5000);
        return;
      }

      // Try fallback: skip to next track
      setTimeout(() => {
        if (this.currentHandler) {
          this.currentHandler.handleTrackEnd();
        }
      }, 2000);
    }
  }

  getCurrentHandler() {
    return this.currentHandler;
  }
}

// Global enhanced controller instance
const enhancedPlaybackController = new EnhancedPlaybackController();

// Fetch with timeout for network operations
async function fetchWithTimeout(resource, options = {}) {
  const isLocal = window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const defaultTimeout = isLocal ? 30000 : 8000; // Higher timeout for local development
  const { timeout = defaultTimeout, ...fetchOptions } = options;

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
      const isLocal = window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const timeoutMsg = `Timeout: The request took more than ${timeout}ms`;
      if (isLocal) {
        throw new Error(`${timeoutMsg}. If running from a local file, use an HTTP server (e.g: python -m http.server) for full functionality.`);
      }
      throw new Error(`${timeoutMsg}. Check your internet connection.`);
    }
    // Provide better error messages for common network issues in development
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      const isLocal = window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (isLocal) {
        throw new Error('Network error: If you opened index.html directly, run a local server (python -m http.server) for full API access.');
      }
    }
    throw error;
  }
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

// Load audio from cache or network
async function loadAudioWithCache(track) {
  if (!track || !track.url) {
    throw new Error('Audio URL not available');
  }

  // Only allow .ogg and .mp3 files
  const urlLower = track.url.toLowerCase();
  if (!urlLower.endsWith('.ogg') && !urlLower.endsWith('.mp3')) {
    throw new Error('Only .ogg and .mp3 files are allowed');
  }

  try {
    // Intentar obtener de la caché primero
    const cacheResult = typeof audioCache !== 'undefined' && audioCache && typeof audioCache.get === 'function' ? await audioCache.get(track.url) : null;

    if (cacheResult && cacheResult.blob) {
      console.log('Playing from cache:', track.title);
      const blobUrl = URL.createObjectURL(cacheResult.blob);
      return blobUrl;
    }

    // Si no está en caché y no hay conexión, no podemos cargarlo
    if (!state.networkOnline) {
      throw new Error('Offline and audio not available in cache');
    }

    // Load from network
    if (window.loaderManager) window.loaderManager.showPlayButtonLoader('network');

    const response = await fetchWithTimeout(track.url, { timeout: 15000 });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const blob = await response.blob();

    // Save to cache for future use (background)
    const isFavorite = isTrackFavorite(track);
    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.put === 'function') {
      audioCache.put(track.url, response.clone(), isFavorite, {
        title: track.title || 'Untitled',
        creator: track.creator || 'Unknown',
        url: track.url
      }).catch(error => {
        console.error('Error saving to cache:', error);
      });
    }

    const blobUrl = URL.createObjectURL(blob);

    showStatus('Audio file loaded successfully', 'info', 1000);
    return blobUrl;

  } catch (error) {
    console.error('Error loading audio:', error);

    // Intentar estrategias de fallback
    if (!state.networkOnline) {
      // Precargar pistas siguientes si estamos en un contexto
      preloadNextTrack();
    }

    throw error;
  }
}

// Intelligent prefetch of next 5 tracks in parallel (non-blocking)
async function intelligentPrefetchNextTracks(allItems, currentIndex) {
  if (!allItems || !state.networkOnline) return;

  // Precarga las próximas 5 pistas en paralelo (sin bloquear)
  const nextIndices = [1, 2, 3, 4, 5];
  const prefetchPromises = [];

  for (const offset of nextIndices) {
    const nextIdx = (currentIndex + offset) % allItems.length;
    const track = allItems[nextIdx];

    if (track && track.url && typeof audioCache !== 'undefined' && audioCache) {
      // Non-blocking prefetch - don't await
      prefetchPromises.push(
        audioCache.prefetchAudio(track.url, false)
          .catch(error => {
            console.debug(`Failed to prefetch track ${offset}:`, error.message);
          })
      );
    }
  }

  // Execute all prefetches in parallel with timeout
  if (prefetchPromises.length > 0) {
    Promise.race([
      Promise.allSettled(prefetchPromises),
      new Promise(resolve => setTimeout(resolve, 8000)) // 8s timeout
    ]).catch(console.error);
  }
}

function preloadNextTrack() {
  if (state.playbackQueue.length > 0) {
    const nextTrack = state.playbackQueue[0];
    if (nextTrack && nextTrack.url) {
      if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.prefetchAudio === 'function') {
        audioCache.prefetchAudio(nextTrack.url).catch(console.error);
      }
    }
  }
}



// Play audio track with UI updates and state management
async function playAudioTrackOptimized(track, identifier, trackIndex = 0, totalTracks = 1) {
  if (!track || !track.url) {
    throw new Error('Track not available');
  }
  hideSearchResults();
  window.elements.audio.pause();
  window.elements.audio.currentTime = 0;

  if (totalTracks > 1) {
    window.elements.title.textContent = `${track.title || 'Untitled'}`;
    window.elements.creator.textContent = `${track.creator || 'Unknown'} (${trackIndex + 1}/${totalTracks})`;
  } else {
    window.elements.title.textContent = track.title;
    window.elements.creator.textContent = track.creator;
  }

  // ACTUALIZACIÓN: Mostrar descripción si está disponible de forma segura
  if (window.elements.description) {
    if (track.description && track.description.trim() !== '') {
      window.elements.description.textContent = track.description;
      // Asegurar que el contenedor padre esté visible
      if (window.elements.description.parentElement) {
        window.elements.description.parentElement.style.display = 'block';
      }
    } else {
      window.elements.description.textContent = '';
      // Ocultar el contenedor si no hay descripción
      if (window.elements.description.parentElement) {
        window.elements.description.parentElement.style.display = 'none';
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

  // Update meta tags for rich previews
  if (typeof updateMetaTags === 'function') {
    updateMetaTags(track, identifier);
  }

  showStatus(`Getting your track ready to play`, 'info');
  const lm = getLoaderManager();
  if (lm) lm.showPlayButtonLoader('track');

  return new Promise((resolve, reject) => {
    const audio = window.elements.audio;
    let timeoutId;

    const onCanPlay = () => {
      cleanup();
      audio.play().then(async () => {
        // Hide loader when playback actually starts
        const lm2 = getLoaderManager();
        if (lm2) {
          lm2.hidePlayButtonLoader('track');
          lm2.hidePlayButtonLoader('network');
        }
        
        // Update button state
        state.isLoading = false;
        window.elements.playBtn.disabled = false;
        window.elements.playBtn.textContent = '| |';
        window.elements.playBtn.classList.add('playing');



        if (totalTracks > 1) {
          showStatus(`Now playing album track with numbers`, 'info');
        } else {
          showStatus(`Now playing your selected track`, 'info');
        }

        // EJECUTAR CALLBACK ONPLAY
        if (state.onPlayCallback && typeof state.onPlayCallback === 'function') {
          try {
            state.onPlayCallback({
              title: track.title,
              creator: track.creator,
              duration: audio.duration,
              currentTime: audio.currentTime,
              id: state.currentTrack.id
            });
          } catch (error) {
            console.error('Error executing onplay callback:', error);
          }
        }

        // Preload next track and intelligent prefetch
        preloadNextTrack();
        
        // Trigger intelligent prefetch if we have album context
        if (state.currentTrack && state.currentTrack.isAlbumTrack) {
          const albumContext = (playbackManager && playbackManager.contextData) ? playbackManager.contextData.album : undefined;
          if (albumContext && albumContext.items) {
            intelligentPrefetchNextTracks(albumContext.items, state.currentTrack.trackIndex);
          }
        }

        // Hide loaders
        cleanup();
        resolve(true);
      }).catch(error => {
        // Handle playback error
        cleanup();
        if (window.loaderManager) {
          window.loaderManager.hidePlayButtonLoader('track');
          window.loaderManager.hidePlayButtonLoader('network');
        }
        state.isLoading = false;
        window.elements.playBtn.disabled = false;
        window.elements.playBtn.textContent = '▶';
        reject(error);
      });
    };

    const onError = (e) => {
      cleanup();
      state.isLoading = false;
      window.elements.playBtn.disabled = false;
      window.elements.playBtn.textContent = '▶';
      const errMsg = (e && e.target && e.target.error && e.target.error.message) ? e.target.error.message : 'Source not supported';
      reject(new Error(`Audio error: ${errMsg}`));
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
            window.elements.playBtn.disabled = false;
            window.elements.playBtn.textContent = '▶';
            reject(new Error('Timeout while loading audio'));
          }
        }, 20000);

        audio.addEventListener('canplay', onCanPlay, { once: true });
        audio.addEventListener('error', onError, { once: true });
      })
      .catch(error => {
        cleanup();
        state.isLoading = false;
        window.elements.playBtn.disabled = false;
        window.elements.playBtn.textContent = '▶';
        reject(error);
      });
  });
}

// Playback control functions
function playPrevious() {
  state.userInteracted = true;
  showStatus('Going back to previous track', 'info');
  playPreviousInContext();
}

async function playNext() {
  state.userInteracted = true;
  showStatus('Skipping to next track now', 'info');
  await playNextInContext();
}

async function resumeSavedPlayback() {
  const savedState = state.savedPlaybackState;
  if (!savedState) return;

  const lm = getLoaderManager();
  if (lm) lm.showPlayButtonLoader('resume');

  state.userInteracted = true;

  try {
    // Restore volume and mute settings
    if (savedState.volume !== undefined && window.elements.audio) {
      window.elements.audio.volume = savedState.volume;
      if (window.elements.volumeSlider) {
        window.elements.volumeSlider.value = savedState.volume;
      }
      state.currentVolume = savedState.volume;
    }
    if (savedState.muted !== undefined && window.elements.audio) {
      window.elements.audio.muted = savedState.muted;
      updateVolumeIcon();
    }

    showStatus(`Resuming from where you left off`, 'info');

    // Play the track
    await playAudioTrackOptimized(savedState.track, savedState.track.id, savedState.track.trackIndex, savedState.track.totalTracks);

    // Set the saved position
    if (savedState.currentTime && window.elements.audio && window.elements.audio.duration) {
      window.elements.audio.currentTime = savedState.currentTime;
      updateProgressBar();
    }

    // Clear the saved state since we resumed it
    state.savedPlaybackState = null;
    localStorage.removeItem('resonate_playback_state');

  } catch (error) {
    console.error('Error resuming saved playback:', error);
    showStatus(`Couldn't resume your last track`, 'error');
    const lm2 = getLoaderManager();
    if (lm2) lm2.hidePlayButtonLoader('resume');
    // Try force play as fallback
    forcePlay();
  }
}

function togglePlay() {
  if (state.isLoading) return;

  // Check if there's a saved playback state to resume
  if (window.elements.audio.paused && !window.elements.audio.src && state.savedPlaybackState) {
    resumeSavedPlayback();
    return;
  }

  // Check if there's a saved track to resume (legacy)
  if (window.elements.audio.paused && !window.elements.audio.src && state.currentTrack && state.currentTrack.url) {
    // Resume last track
    playAudioTrackOptimized(state.currentTrack, state.currentTrack.id, state.currentTrack.trackIndex, state.currentTrack.totalTracks).catch(error => {
      console.error('Error resuming track:', error);
      forcePlay();
    });
    return;
  }

  // Prevenir reproducción si no hay favoritos y no hay audio cargado
  if (window.elements.audio.paused && !window.elements.audio.src && state.favorites.length === 0) {
    showStatus('Add tracks to favorites to begin', 'info');
    return;
  }

  state.userInteracted = true;

  if (window.elements.audio.paused) {
    if (!window.elements.audio.src) {
      forcePlay();
      return;
    }

    window.elements.audio.play().then(() => {
      window.elements.playBtn.textContent = '| |';
      showStatus('Music is playing now', 'info');

      // Actualizar Media Session
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
    }).catch(error => {
      showStatus(`Playback encountered an error`, 'error');
    });
  } else {
    window.elements.audio.pause();
    window.elements.playBtn.textContent = '▶';
    showStatus('Music is now paused', 'info');

    // Actualizar Media Session
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
  }
}

function loadPlaybackQueue(context, items, startIndex = 0) {
  state.playbackQueue = [];

  if (!items || items.length === 0) {
    // No items to load into FIFO
    return;
  }

  const queueSize = 20; // Increased from 10 to 20 for better buffering
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
    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.preloadTracks === 'function') {
      audioCache.preloadTracks(state.playbackQueue, true);
    }
  }

  // Trigger intelligent prefetch of future tracks in parallel
  intelligentPrefetchNextTracks(items, startIndex);
}

// Force playback by determining context and playing
function forcePlay() {
  if (!state.isInitialized) {
    state.isInitialized = true;
    showStatus('Resonate is waking up', 'info');
    window.elements.title.textContent = '';
    window.elements.creator.textContent = '';
  }

  state.userInteracted = true;

  // Clear previous playback state
  state.isLoading = false;
  state.playbackQueue = [];
  state.playbackHistory = [];

  if (state.favorites.length > 0) {
    showStatus('Playing your favorites in order', 'info');
    playFromFavoritesQueue();
  } else {
    showStatus('Search to add your first favorite', 'info');
  }
}

// FUNCIÓN: Reproducir desde cola FIFO de favoritos
async function playFromFavoritesQueue() {
  if (state.isLoading || state.favorites.length === 0) return;

  const lm = getLoaderManager();
  if (lm) lm.showPlayButtonLoader('favorites');

  state.isPlayingFavorites = true;

  try {
    // Cargar cola FIFO con favoritos
    loadPlaybackQueue('favorites', state.favorites, 0);

    if (state.playbackQueue.length === 0) {
      throw new Error('Could not load playback queue');
    }

    const track = state.playbackQueue[0];

    if (!track.url) {
      throw new Error('Audio URL not available in favorite');
    }

    showStatus(`Getting next track from queue`, 'info');

    // Remove track from queue before playing
    state.playbackQueue.shift();

    await playAudioTrackOptimized(track, track.id, track.trackIndex, track.totalTracks);

    updateShuffleButton();

  } catch (error) {
    console.error('Error in playFromFavoritesQueue:', error);
    const lm = getLoaderManager();
    if (lm) lm.hidePlayButtonLoader('favorites');

    // Handle offline/cache errors by trying next track
    if (error.message.includes('Offline and audio not available in cache')) {
      showStatus('This track isn\'t cached offline', 'error', 2000);
      // Try next track in queue if available
      if (state.playbackQueue.length > 0) {
        setTimeout(() => playFromFavoritesQueue(), 2000);
        return;
      } else {
        showStatus('All offline tracks have finished', 'error', 3000);
      }
    } else {
      showStatus(`Something went wrong with playback`, 'error');
    }
  } finally {
    const lm2 = getLoaderManager();
    if (lm2) lm2.hidePlayButtonLoader('favorites');
    state.isLoading = false;
    window.elements.playBtn.disabled = false;
    window.elements.playBtn.textContent = '| |';
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

  console.log(`Preloaded list configured with ${preloadedPlaylist.length} tracks`);
}

async function playNextInContext(maxRetries = 3) {
  // PREVENT MULTIPLE EXECUTION
  if (state.isLoading) return;
  state.isLoading = true;

  // Only replace in FIFO queue if song played completely, not on manual next button
  const currentTrackUrl = (state.currentTrack && state.currentTrack.url) ? state.currentTrack.url : undefined;

  try {
    const context = playbackManager.getCurrentContext();

    // ALBUMS: Play next track based on shuffle state (sequential if shuffle off, random if shuffle on)
    if (context === 'album') {
      const albumContext = playbackManager.contextData.album;
      const nextItem = playbackManager.getNextTrack();

      if (nextItem && albumContext.currentIndex < albumContext.items.length) {
        try {
          await playAudioTrackOptimized(nextItem, playbackManager.getCurrentAlbumId(), albumContext.currentIndex, albumContext.items.length);
          return;
        } catch (error) {
          console.error('Error playing album track:', error);

          // Automatically try next track for albums
          if (maxRetries > 0) {
            showStatus(`Skipping this problematic track`, 'error', 1500);
            return playNextInContext(maxRetries - 1);
          } else {
            showStatus('Too many errors. Stopping playback', 'error', 3000);
            return;
          }
        }
      } else if (albumContext.currentIndex >= albumContext.items.length - 1) {
        // Album finished, check if we should continue with next search result
        showStatus('Album playback finished', 'info', 2000);
        if (state.albumOrigin === 'search') {
          const currentAlbumId = playbackManager.getCurrentAlbumId();
          const currentIndex = state.searchResults.findIndex(item => item.identifier === currentAlbumId);

          if (currentIndex !== -1 && currentIndex < state.searchResults.length - 1) {
            const nextResult = state.searchResults[currentIndex + 1];
            showStatus('Moving ahead in search results', 'info', 2000);

            playbackManager.setContext('search', state.searchResults, currentIndex + 1);
            await playOptimizedSearchResult(nextResult, currentIndex + 1, state.searchResults);
            return;
          }
        }
        showStatus('Album playback finished', 'info', 2000);
        return;
      }
    }

    // Always play from FIFO queue if tracks available
    if (state.playbackQueue.length > 0) {
      const nextTrack = state.playbackQueue[0];

      // Check it's not the same as current track
      if (nextTrack && currentTrackUrl && nextTrack.url === currentTrackUrl) {
        // Skipping same track, moving to next
        state.playbackQueue.shift(); // Remover la duplicada
        if (state.playbackQueue.length > 0) {
          await playNextInContext(maxRetries); // Intentar con la siguiente
          return;
        }
      }

      const actualNextTrack = state.playbackQueue.shift();

      if (!actualNextTrack) {
        // No track available
        return;
      }

      // Agregar la pista actual al historial solo si es diferente
      if (state.currentTrack && state.currentTrack.url !== actualNextTrack.url) {
        state.playbackHistory.push(state.currentTrack);
      }

      try {
        await playAudioTrackOptimized(actualNextTrack, actualNextTrack.id, actualNextTrack.trackIndex, actualNextTrack.totalTracks);
        return;
      } catch (error) {
        console.error('Error reproduciendo desde cola FIFO:', error);

        // Automatically try next track instead of stopping
        if (maxRetries > 0) {
          showStatus(`Track issue detected, trying next`, 'error', 2000);
          return playNextInContext(maxRetries - 1);
        } else {
          showStatus('Too many issues. Pausing auto-play', 'error', 3000);
          return;
        }
      }
    }

    // Si estamos en un contexto de búsqueda con playlist precargada
    if (context === 'searchPlaylist' && state.autoPlaySearchResults) {
      if (!playbackManager.hasNextTrack()) {
        showStatus('Your playlist has finished playing', 'info', 2000);
        return;
      }

      const nextItem = playbackManager.getNextTrack();
      await playAudioTrackOptimized(nextItem, nextItem.id, 0, 1);
      return;
    }

    // Para otros contextos, usar el comportamiento de precarga existente
    if (!playbackManager.hasNextTrack()) {
      if (context === 'album') {
        showStatus('Album finished playing', 'info', 2000);
        return;
      } else if (context === 'favorites') {
        showStatus('Favorites complete. Search more', 'info', 2000);
        return;
      }
      if (context === 'search') {
        showStatus('Search results all played', 'info', 2000);
        return;
      }
      return;
    }

    const nextItem = playbackManager.getNextTrack();

    try {
      if (context === 'genre' || context === 'search') {
        const files = await fetchOptimizedPlayableFiles(nextItem.identifier);
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
          showStatus('Audio link isn\'t available', 'error', 2000);
          setTimeout(() => playNextInContext(), 1000);
          return;
        }

        // Verificar si está en caché antes de reproducir
        const cached = typeof audioCache !== 'undefined' && audioCache && typeof audioCache.get === 'function' ? await audioCache.get(track.url) : null;
        if (!cached && !state.networkOnline) {
          showStatus('Track not in offline cache', 'error', 2000);
          setTimeout(() => playNextInContext(), 1000);
          return;
        }

        await playAudioTrackOptimized(track, nextItem.id, nextItem.trackIndex, nextItem.totalTracks);
      }

    } catch (error) {
      console.error('Error playing next track:', error);

      if (error.message.includes('conexión') || error.message.includes('offline')) {
        showStatus('No internet. Trying next track', 'error', 2000);
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
      const files = await fetchOptimizedPlayableFiles(prevItem.identifier);
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
      const cached = typeof audioCache !== 'undefined' && audioCache && typeof audioCache.get === 'function' ? await audioCache.get(track.url) : null;
      if (!cached && !state.networkOnline) {
        showStatus('Can\'t play offline right now', 'error', 2000);
        setTimeout(() => playPreviousInContext(), 1000);
        return;
      }

      await playAudioTrackOptimized(track, prevItem.id, prevItem.trackIndex, prevItem.totalTracks);
    } else if (context === 'album') {
      try {
        await playAudioTrackOptimized(prevItem, playbackManager.getCurrentAlbumId(), ctx.currentIndex, ctx.items.length);
        return;
      } catch (error) {
        console.error('Error reproduciendo pista anterior de álbum:', error);
        // Try the fallback of going back further in the context
        setTimeout(() => playPreviousInContext(), 1000);
      }
    } else if (context === 'album') {
      try {
        await playAudioTrackOptimized(prevItem, playbackManager.getCurrentAlbumId(), ctx.currentIndex, ctx.items.length);
        return;
      } catch (error) {
        console.error('Error reproduciendo pista anterior de álbum:', error);
        setTimeout(() => playPreviousInContext(), 1000);
      }
    } else if (context === 'searchPlaylist') {
      // Reproducir desde la lista de búsqueda precargada
      await playAudioTrackOptimized(prevItem, prevItem.id, 0, 1);
    }
    
    // Try/catch global para la función completa
  } catch (error) {
    console.error('Error al reproducir pista anterior:', error);
    setTimeout(() => playPreviousInContext(), 1000);
  }
}

// Enhanced repeat mode functions
function toggleRepeatMode() {
  const modes = ['all', 'context', 'one', 'infinite', 'off'];
  const currentIndex = modes.indexOf(state.repeatMode);
  state.repeatMode = modes[(currentIndex + 1) % modes.length];
  saveRepeatMode(state.repeatMode);

  // Update playback state manager
  if (playbackStateManager) {
    playbackStateManager.setRepeatMode(state.repeatMode);
  }

  updateRepeatBtn();
  showStatus(`Repeat mode changed successfully`, 'info', 2000);
}

function getRepeatModeDisplayName(mode) {
  const names = {
    all: 'Repeat context',
    context: 'Repeat context infinitely',
    one: 'Repeat track',
    infinite: 'Infinite mix',
    off: 'No repeat'
  };
  return names[mode] || 'Repeat context';
}

function updateRepeatBtn() {
  if (!window.elements.repeatBtn) return;

  const icons = {
    all: '🔁',      // Repeat context
    context: '🔄',  // Repeat context infinitely
    one: '🔂',      // Repeat one
    infinite: '🔀', // Mix infinitely
    off: '➡️'       // No repeat
  };

  window.elements.repeatBtn.textContent = icons[state.repeatMode] || '🔁';
  window.elements.repeatBtn.title = `Repeat mode: ${getRepeatModeDisplayName(state.repeatMode)}`;
}

function loadRepeatMode() {
  try {
    const saved = localStorage.getItem('resonate_repeat_mode');
    if (saved && ['all', 'context', 'one', 'infinite', 'off'].includes(saved)) {
      state.repeatMode = saved;
    }
  } catch (e) {
    state.repeatMode = 'all'; // Default
  }
}

function saveRepeatMode(mode) {
  try {
    localStorage.setItem('resonate_repeat_mode', mode);
  } catch (e) {
    console.warn('Error saving repeat mode:', e);
  }
}

function updateProgressBar() {
  if (!state.isSeeking && window.elements.audio && window.elements.audio.duration && isFinite(window.elements.audio.duration)) {
    const progressPercent = (window.elements.audio.currentTime / window.elements.audio.duration) * 100;
    if (window.elements.progress) window.elements.progress.style.width = `${progressPercent}%`;
    if (window.elements.currentTime) window.elements.currentTime.textContent = formatTime(window.elements.audio.currentTime);
    if (window.elements.totalTime) window.elements.totalTime.textContent = formatTime(window.elements.audio.duration);

    // Actualizar Media Session
    updateMediaPositionState();
  }
}

// Enhanced track listening statistics and playback control
function setupListenTracking() {
  if (!window.elements.audio) return;
  
  let endedHandlerExecuted = false;

  window.elements.audio.addEventListener('play', () => {
    endedHandlerExecuted = false;
    if (state.currentTrack) {
      state.currentTrackListenStart = Date.now();
    }
  });

  window.elements.audio.addEventListener('ended', async () => {
    // PREVENIR EJECUCIÓN MÚLTIPLE
    if (endedHandlerExecuted) {
      return;
    }
    endedHandlerExecuted = true;

    // Track listening statistics
    if (state.currentTrack) {
      const listenDuration = Date.now() - state.currentTrackListenStart;
      const trackDuration = window.elements.audio.duration * 1000; // Convertir a ms

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
          showStatus(`Cache storage almost full`, 'info', 3000);
        }
      } else {
        // Registrar que se saltó temprano
        const skipCount = state.tracksSkippedEarly.get(state.currentTrack.url) || 0;
        state.tracksSkippedEarly.set(state.currentTrack.url, skipCount + 1);
        // Track skipped early: increment skip counter silently
      }

      state.currentTrackListenStart = 0;
    }

    // Use enhanced playback controller for track end handling
    const currentContext = playbackManager.getCurrentContext();
    if (currentContext) {
      enhancedPlaybackController.setContext(currentContext);
      await enhancedPlaybackController.handleTrackEnd();
    } else {
      // Fallback to legacy behavior
      const repeatMode = state.repeatMode;
      if (repeatMode === 'one') {
        window.elements.audio.currentTime = 0;
        window.elements.audio.play();
        endedHandlerExecuted = false; // Allow loop
        return;
      } else if (repeatMode === 'all') {
        playNextInContext();
      } else {
        showStatus('Your playback is complete', 'info', 2000);
      }
    }
  });

  window.elements.audio.addEventListener('seeked', () => {
    // Si el usuario busca hacia atrás, reiniciar el contador de escucha
    if (state.currentTrackListenStart > 0) {
      state.currentTrackListenStart = Date.now();
    }
  });
}

// Enhanced progress bar interaction
function setupProgressBarInteraction() {
  if (!window.elements.progressBar || !window.elements.progress || !window.elements.currentTime) {
    if (window.logger && typeof window.logger.warn === 'function') window.logger.warn('Progress bar elements not fully initialized', 'PLAYBACK');
    return;
  }

  let isDragging = false;

  const startDrag = (e) => {
    if (!window.elements.audio || !window.elements.audio.duration || !isFinite(window.elements.audio.duration)) return;
    if (!window.elements.progressBar || !window.elements.progressSection) {
      if (window.logger && typeof window.logger.warn === 'function') window.logger.warn('Missing progress elements in startDrag', 'PLAYBACK');
      return;
    }

    isDragging = true;
    state.isSeeking = true;
    
    try {
      window.elements.progressBar.classList.add('dragging');
      window.elements.progressSection.classList.add('dragging');
    } catch (err) {
      if (window.logger && typeof window.logger.error === 'function') window.logger.error(`Error adding dragging class: ${err.message}`, 'PLAYBACK');
    }

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
    if (window.elements.progressBar) {
      window.elements.progressBar.classList.remove('dragging');
    }
    if (window.elements.progressSection) {
      window.elements.progressSection.classList.remove('dragging');
    }
  };

  const updateProgressOnDrag = (e) => {
    if (!window.elements.progressBar || !window.elements.progress || !window.elements.currentTime || !window.elements.audio) return;
    
    const progressBarRect = window.elements.progressBar.getBoundingClientRect();
    let clientX;

    if (e.type.includes('touch')) {
      clientX = e.touches[0].clientX;
    } else {
      clientX = e.clientX;
    }

    // Adjust for the 42px offset occupied by current-time text
    // The clickable area is progressBarRect.width - 42px (current-time width) - 5px (total-time margin)
    const offsetLeft = 42; // Width of current-time element
    const offsetRight = 5; // Right margin for total-time
    const effectiveWidth = progressBarRect.width - offsetLeft - offsetRight;

    const clickPosition = Math.max(0, Math.min(1, (clientX - (progressBarRect.left + offsetLeft)) / effectiveWidth));
    const seekTime = clickPosition * window.elements.audio.duration;

    // Update display
    window.elements.progress.style.width = `${clickPosition * 100}%`;
    window.elements.currentTime.textContent = formatTime(seekTime);

    // Update audio on both drag and click
    window.elements.audio.currentTime = seekTime;
  };

  // Configure events - remove duplicates
  if (window.elements.progressBar) {
    window.elements.progressBar.addEventListener('mousedown', startDrag);
    window.elements.progressBar.addEventListener('touchstart', startDrag, { passive: false });
  }
  
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', endDrag);
  document.addEventListener('touchmove', drag, { passive: false });
  document.addEventListener('touchend', endDrag, { passive: false });
  // SOLO UN event listener para click
  if (window.elements.progressBar) {
    window.elements.progressBar.addEventListener('click', (e) => {
      if (!isDragging) { // Solo procesar clicks que no sean parte de un arrastre
        updateProgressOnDrag(e);
      }
    });
  }
}

function updateShuffleButton() {
  const ctx = playbackManager.getCurrentContext();
  let noun = ctx === 'search' ? 'search results' : ctx === 'album' ? 'album' : 'favorites';

  // Shuffle button is always enabled for all contexts
  window.elements.shuffleFavoritesBtn.enable = false;

  if (state.shuffleFavorites) {
    window.elements.shuffleFavoritesBtn.classList.add('active');
    window.elements.shuffleFavoritesBtn.setAttribute('aria-label', `Disable shuffle playback of ${noun}`);
  } else {
    window.elements.shuffleFavoritesBtn.classList.remove('active');
    window.elements.shuffleFavoritesBtn.setAttribute('aria-label', `Enable shuffle playback of ${noun}`);
  }
}

function toggleShuffleFavorites() {
  state.shuffleFavorites = !state.shuffleFavorites;

  const context = playbackManager.getCurrentContext() || (state.favorites && state.favorites.length > 0 ? 'favorites' : 'search');

  if (state.shuffleFavorites) {
    // Activar modo aleatorio
    if (context === 'favorites' && state.favorites.length > 0) {
      showStatus('Shuffling your favorites now', 'info', 2000);
      loadPlaybackQueue('favorites', state.favorites, 0);
      if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.loadFavoritesQueue === 'function') {
        audioCache.loadFavoritesQueue(state.favorites, true);
      }
    } else if (context === 'search' && state.searchResults && state.searchResults.length > 0) {
      showStatus('Shuffling search results', 'info', 2000);
      loadPlaybackQueue('search', state.searchResults, 0);
      if (state.networkOnline) {
        if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.preloadTracks === 'function') {
          audioCache.preloadTracks(state.playbackQueue, true);
        }
      }
    } else {
      showStatus('Shuffle mode is now on', 'info', 2000);
    }
  } else {
    // Desactivar modo aleatorio: volver a modo secuencial
    if (context === 'favorites' && state.favorites.length > 0) {
      showStatus('Shuffle is off. Sequential playback', 'info', 2000);
      const ctx = playbackManager.contextData['favorites'] || { currentIndex: 0, items: state.favorites };
      const currentIndex = typeof ctx.currentIndex === 'number' ? ctx.currentIndex : 0;
      loadPlaybackQueue('favorites', ctx.items.length ? ctx.items : state.favorites, currentIndex + 1);
    } else if (context === 'search' && state.searchResults && state.searchResults.length > 0) {
      showStatus('Playing search results in order', 'info', 2000);
      const ctx = playbackManager.contextData['search'] || { currentIndex: 0, items: state.searchResults };
      const currentIndex = typeof ctx.currentIndex === 'number' ? ctx.currentIndex : 0;
      loadPlaybackQueue('search', ctx.items.length ? ctx.items : state.searchResults, currentIndex + 1);
    } else {
      showStatus('Sequential mode. Shuffle is off', 'info', 2000);
    }
  }

  updateShuffleButton();
}

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
      window.elements.audio.currentTime = Math.max(0, window.elements.audio.currentTime - skipTime);
    });

    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const skipTime = details.seekOffset || 10;
      window.elements.audio.currentTime = Math.min(window.elements.audio.duration, window.elements.audio.currentTime + skipTime);
    });

    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.fastSeek && 'fastSeek' in window.elements.audio) {
        window.elements.audio.fastSeek(details.seekTime);
      } else {
        window.elements.audio.currentTime = details.seekTime;
      }
    });
  } catch (error) {
    console.warn('Some Media Session actions unavailable:', error);
  }
}

async function playOptimizedFavorite(favoriteIndex = 0) {
  if (state.isLoading || state.favorites.length === 0) return;

  const lm = getLoaderManager();
  if (lm) lm.showPlayButtonLoader('favorite');

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

    // Validate favorite has URL
    if (!favorite.url) {
      console.error('Favorite without valid URL:', favorite);
      showStatus('Favorite is invalid, skipping it', 'error', 2000);
      const nextIndex = (actualIndex + 1) % state.favorites.length;
      return playOptimizedFavorite(nextIndex);
    }

    showStatus(`Getting your favorite ready`, 'info');

    const track = {
      url: favorite.url,
      title: favorite.title || 'Untitled',
      creator: favorite.creator || 'Unknown',
      id: favorite.id,
      isAlbumTrack: favorite.isAlbumTrack || false,
      albumId: favorite.albumId || favorite.id,
      trackIndex: favorite.trackIndex || 0,
      totalTracks: favorite.totalTracks || 1
    };

    if (!track.url || track.url === '') {
      throw new Error('Audio URL not available in favorite');
    }

    // CHECK IF PRELOADED FAVORITES CACHE
    const favoritesQueue = typeof audioCache !== 'undefined' && audioCache && typeof audioCache.getFavoritesQueue === 'function' ? audioCache.getFavoritesQueue() : [];
    const isPreloaded = favoritesQueue.includes(track.url);

    if (isPreloaded) {
      console.log('Playing from preloaded favorites:', track.title);
    } else {
      console.log('Favorite not preloaded, loading from network:', track.title);
    }

    const cached = typeof audioCache !== 'undefined' && audioCache && typeof audioCache.get === 'function' ? await audioCache.get(track.url) : null;
    if (!cached && !state.networkOnline) {
      showStatus('Favorite isn\'t cached offline', 'error', 2000);
      const nextIndex = (actualIndex + 1) % state.favorites.length;
      return playOptimizedFavorite(nextIndex);
    }

    await playAudioTrackOptimized(track, favorite.id, favorite.trackIndex, favorite.totalTracks);

    updateShuffleButton();

  } catch (error) {
    console.error('Error in playOptimizedFavorite:', error);
    const lm = getLoaderManager();
    if (lm) lm.hidePlayButtonLoader('favorite');
    showStatus(`Something went wrong with favorite`, 'error');

    if (state.favorites.length > 1) {
      const nextIndex = (favoriteIndex + 1) % state.favorites.length;
      setTimeout(() => playOptimizedFavorite(nextIndex), 1000);
    }
  } finally {
    const lm2 = getLoaderManager();
    if (lm2) lm2.hidePlayButtonLoader('favorite');
    state.isLoading = false;
    window.elements.playBtn.disabled = false;
    window.elements.playBtn.textContent = '| |';
  }
}

async function playSpecificTrack(track, albumId, trackIndex, totalTracks) {
  if (state.isLoading) return;

  const lm = getLoaderManager();
  if (lm) lm.showPlayButtonLoader('specific');

  try {
    hideSearchResults();
    showStatus(`Loading your selected track`, 'info');

    if (totalTracks > 1) {
      const files = await fetchOptimizedPlayableFiles(albumId);
      playbackManager.setAlbumPlaylist(albumId, files, trackIndex);
      state.albumOrigin = 'search';

      // Load FIFO queue with album tracks
      loadPlaybackQueue('album', files, trackIndex);
    }

    await playAudioTrackOptimized(track, albumId, trackIndex, totalTracks);

    // Hide search results after selecting a track
    hideSearchResults();

  } catch (error) {
    console.error('Error in playSpecificTrack:', error);
    const lm = getLoaderManager();
    if (lm) lm.hidePlayButtonLoader('specific');
    showStatus(`Error: ${error.message}`, 'error');
  } finally {
    const lm2 = getLoaderManager();
    if (lm2) lm2.hidePlayButtonLoader('specific');
    state.isLoading = false;
    window.elements.playBtn.disabled = false;
    window.elements.playBtn.textContent = '| |';
  }
}

async function playRandomSearchResults() {
  if (state.isLoading || !state.searchResults || state.searchResults.length === 0) return;

  const lm = getLoaderManager();
  if (lm) lm.showPlayButtonLoader('random');

  try {
    // Shuffle the search results
    const shuffledResults = [...state.searchResults].sort(() => Math.random() - 0.5);

    // Set up playback context for random search results
    playbackManager.setContext('search', shuffledResults, 0);
    state.albumOrigin = 'search';

    // Load shuffled results into playback queue
    loadPlaybackQueue('search', shuffledResults, 0);

    if (state.playbackQueue.length === 0) {
      throw new Error('No playable tracks found in search results');
    }

    const firstTrack = state.playbackQueue[0];

    if (!firstTrack.url) {
      throw new Error('First track has no URL');
    }

    showStatus(`Playing shuffled search results`, 'info');

    // Remove from queue before playing
    state.playbackQueue.shift();

    await playAudioTrackOptimized(firstTrack, firstTrack.id, 0, 1);

    updateShuffleButton();

  } catch (error) {
    console.error('Error in playRandomSearchResults:', error);
    const lm = getLoaderManager();
    if (lm) lm.hidePlayButtonLoader('random');
    showStatus(`Error with random playback`, 'error');
  } finally {
    const lm2 = getLoaderManager();
    if (lm2) lm2.hidePlayButtonLoader('random');
    state.isLoading = false;
    window.elements.playBtn.disabled = false;
    window.elements.playBtn.textContent = '| |';
  }
}

window.playPrevious = playPrevious;
window.playNext = playNext;
window.resumeSavedPlayback = resumeSavedPlayback;
window.setupPreloadedPlayback = setupPreloadedPlayback;
window.playOptimizedFavorite = playOptimizedFavorite;
window.playSpecificTrack = playSpecificTrack;
window.playRandomSearchResults = playRandomSearchResults;
window.setupListenTracking = setupListenTracking;
window.updateProgressBar = updateProgressBar;
window.loadPlaybackQueue = loadPlaybackQueue;
window.playbackManager = playbackManager;
window.fetchWithTimeout = fetchWithTimeout;
window.playAudioTrackOptimized = playAudioTrackOptimized;
window.updateShuffleButton = updateShuffleButton;
