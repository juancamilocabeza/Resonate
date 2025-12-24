// Enhanced Playback Management System

// Note: elements object is defined in ui.js
// We access it via window.elements to avoid scope conflicts
// This file will use window.elements which gets populated when ui.js loads

// Loader Manager reference - use window.getLoaderManager() from ui.js

// Constants for repeat modes
const RepeatMode = {
  ALL: 'all',           // Repeat current context
  ONE: 'one',           // Repeat current track
  CONTEXT: 'context',   // Repeat context infinitely
  INFINITE: 'infinite', // Mix contexts infinitely
  OFF: 'off'            // No repeat
};

const PLAYBACK_CONSTANTS = {
  DEFAULT_QUEUE_SIZE: 6,
  PREFETCH_TIMEOUT_MS: 45000,
  AUDIO_LOAD_TIMEOUT_MS: 45000,
  LOCAL_DEFAULT_FETCH_TIMEOUT_MS: 30000,
  PROD_DEFAULT_FETCH_TIMEOUT_MS: 8000,
  MAX_BLOB_SIZE_MB: 50 // Use direct streaming for files larger than this
};

function isLocalDevEnv() {
  return window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

function getElementsSafe() {
  return (window.elements && typeof window.elements === 'object') ? window.elements : {};
}

function getAudioEl() {
  const elements = getElementsSafe();
  return elements.audio || null;
}

function safeShowStatus(message, type, duration, variant, showLoader) {
  if (typeof showStatus === 'function') {
    showStatus(message, type, duration, variant, showLoader);
  }
}

function logPlayback(level, message, error) {
  try {
    if (window.logger && typeof window.logger.playback === 'function') {
      const combined = error ? `${message} ${error && error.message ? `(${error.message})` : ''}` : message;
      window.logger.playback(combined, level);
      return;
    }
  } catch {}

  const method = String(level || 'info').toLowerCase();
  const fn = console[method] || console.log;
  if (error) fn(message, error);
  else fn(message);
}

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
      // Resonate UX: playback should be continuous by default
      modes: { repeat: RepeatMode.CONTEXT, shuffle: false },
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
      if (repeatMode === RepeatMode.ALL || repeatMode === RepeatMode.CONTEXT || repeatMode === RepeatMode.INFINITE) {
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
        ? await audioCache.get(track.url, true) : null;
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
      // Resonate UX: loop playlist (never stop).
      const context = playbackManager.contextData.searchPlaylist;
      if (context && context.items && context.items.length > 0) {
        context.currentIndex = 0;
        const firstTrack = context.items[0];
        await playAudioTrackOptimized(firstTrack, firstTrack.id, 0, 1);
      }
    }
  }

  async getNextTrack() {
    const context = playbackManager.contextData.searchPlaylist;
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
          this.currentHandler.handleTrackEnd().catch((err) => {
            console.error('Fallback track end handling failed:', err);
          });
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

// Expose core playback primitives for other scripts (search.js loads after playback.js).
window.playbackManager = playbackManager;
window.playbackStateManager = playbackStateManager;
window.enhancedPlaybackController = enhancedPlaybackController;
window.RepeatMode = RepeatMode;

// Fetch with timeout for network operations
async function fetchWithTimeout(resource, options = {}, timeout = 8000) {
  const requestedTimeout = (options && typeof options.timeout === 'number') ? options.timeout : timeout;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort('Timeout exceeded'), requestedTimeout);

  // Clone options to avoid leaking non-standard props to fetch
  const fetchOpts = { ...(options || {}) };
  delete fetchOpts.timeout;
  fetchOpts.signal = controller.signal;

  try {
    const response = await fetch(resource, fetchOpts);
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    if (error && (error.name === 'AbortError' || String(error).includes('Timeout'))) {
      console.error(`Timeout: The request took more than ${requestedTimeout}ms.`, error);
      throw new Error(`Timeout exceeded: ${resource}`);
    }
    // Normalize network failures into a predictable error to avoid noisy logs upstream
    if (error && error instanceof TypeError && String(error.message).includes('Failed to fetch')) {
      throw new Error('Network request failed');
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
    const cacheResult = typeof audioCache !== 'undefined' && audioCache && typeof audioCache.get === 'function' ? await audioCache.get(track.url, true) : null;

    if (cacheResult && cacheResult.blob) {
      logPlayback('info', `Playing from cache: ${track.title || track.url}`);
      const blobUrl = URL.createObjectURL(cacheResult.blob);
      return blobUrl;
    }

    // Si no está en caché y no hay conexión, no podemos cargarlo
    if (!state.networkOnline) {
      throw new Error('Offline and audio not available in cache');
    }

    // Check file size with HEAD request to decide streaming strategy
    let fileSize = 0;
    let useDirectStreaming = false;
    
    try {
      const headTimeout = isLocalDevEnv()
        ? PLAYBACK_CONSTANTS.LOCAL_DEFAULT_FETCH_TIMEOUT_MS
        : PLAYBACK_CONSTANTS.PROD_DEFAULT_FETCH_TIMEOUT_MS;
      const headResponse = await fetchWithTimeout(track.url, { method: 'HEAD', timeout: headTimeout });
      if (headResponse.ok) {
        const contentLength = headResponse.headers.get('Content-Length');
        if (contentLength) {
          fileSize = parseInt(contentLength, 10);
          const fileSizeMB = fileSize / (1024 * 1024);
          useDirectStreaming = fileSizeMB > PLAYBACK_CONSTANTS.MAX_BLOB_SIZE_MB;
          logPlayback('info', `File size: ${fileSizeMB.toFixed(2)}MB, using ${useDirectStreaming ? 'direct streaming' : 'blob download'}`);
        }
      }
    } catch (headError) {
      logPlayback('warn', 'Could not determine file size, using blob download', headError);
    }

    // For large files, use direct streaming without downloading blob
    if (useDirectStreaming) {
      logPlayback('info', `Streaming large file directly: ${track.title || track.url}`);
      safeShowStatus('Streaming audio...', 'info');
      // Return direct URL for streaming
      return track.url;
    }

    // Load from network with playback priority
    const response = await fetchWithTimeout(track.url, { timeout: PLAYBACK_CONSTANTS.PREFETCH_TIMEOUT_MS });

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
        logPlayback('warn', 'Error saving to cache', error);
      });
    }

    const blobUrl = URL.createObjectURL(blob);

    safeShowStatus('Audio file loaded successfully', 'info');
    return blobUrl;

  } catch (error) {
    logPlayback('error', 'Error loading audio', error);

    // Intentar estrategias de fallback
    if (!state.networkOnline) {
      // Precargar pistas siguientes si estamos en un contexto
      preloadNextTrack();
    }

    throw error;
  }
}

// Prefetch only the immediate next track (no fan-out of 5)
async function intelligentPrefetchNextTracks(allItems, currentIndex) {
  if (!allItems || !state.networkOnline) return;

  const nextIdx = (currentIndex + 1) % allItems.length;
  const track = allItems[nextIdx];

  if (track && track.url && typeof audioCache !== 'undefined' && audioCache) {
    audioCache.prefetchAudio(track.url, false).catch(error => {
      console.debug(`Failed to prefetch next track:`, error.message);
    });
  }
}

function preloadNextTrack() {
  try {
    if (!state || !state.playbackQueue || state.playbackQueue.length === 0) return;
    const nextTrack = state.playbackQueue[0];
    if (!nextTrack || !nextTrack.url) return;
    if (typeof audioCache === 'undefined' || !audioCache || typeof audioCache.prefetchAudio !== 'function') return;
    // Precargar solo la siguiente pista con prioridad baja
    audioCache.prefetchAudio(nextTrack.url, false).catch((err) => logPlayback('debug', 'Failed to prefetch next track', err));
  } catch (e) {
    // Never let prefetch break playback
  }
}



// Play audio track with UI updates and state management
async function playAudioTrackOptimized(track, identifier, trackIndex = 0, totalTracks = 1) {
  // Show loader based on context
  if (window.Loaders) {
    window.Loaders.showLoader({ type: 'spinner' });
  }

  if (!track || !track.url) {
    if (window.Loaders) window.Loaders.hideLoader();
    throw new Error('Track not available');
  }

  const elements = getElementsSafe();
  const audioEl = elements.audio;
  if (!audioEl) {
    if (window.Loaders) window.Loaders.hideLoader();
    throw new Error('Audio element not available');
  }

  audioEl.pause();
  audioEl.currentTime = 0;

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

  safeShowStatus('Getting your track ready to play', 'info');

  return new Promise((resolve, reject) => {
    const audio = audioEl;
    let timeoutId;

    const onCanPlay = () => {
      cleanup();
      // Hide loader when track is ready to play
      if (window.Loaders) window.Loaders.hideLoader();
      
      audio.play().then(async () => {
        if (totalTracks > 1) {
          safeShowStatus('Now playing album track with numbers', 'info');
        } else {
          safeShowStatus('Now playing your selected track', 'info');
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

        // Preload only the next track to avoid excessive downloads
        preloadNextTrack();

        resolve(true);
      }).catch(error => {
        // Handle playback error
        cleanup();
        reject(error);
      });
    };

    const onError = (e) => {
      cleanup();
      if (window.Loaders) window.Loaders.hideLoader();
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
      .then(audioUrl => {
        // Revoke only blob: URLs that we created
        if (state.currentBlobUrl && typeof state.currentBlobUrl === 'string' && state.currentBlobUrl.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(state.currentBlobUrl);
          } catch (e) {
            logPlayback('debug', 'Failed to revoke previous blob URL', e);
          }
        }

        state.currentAudioUrl = audioUrl;
        state.currentBlobUrl = (typeof audioUrl === 'string' && audioUrl.startsWith('blob:')) ? audioUrl : null;
        audio.src = audioUrl;
        audio.preload = 'metadata';
        audio.load();

        timeoutId = setTimeout(() => {
          if (audio.readyState < 1) {
            cleanup();
            reject(new Error('Timeout while loading audio'));
          }
        }, PLAYBACK_CONSTANTS.AUDIO_LOAD_TIMEOUT_MS);

        audio.addEventListener('canplay', onCanPlay, { once: true });
        audio.addEventListener('error', onError, { once: true });
      })
      .catch(error => {
        if (window.Loaders) window.Loaders.hideLoader();
        cleanup();
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

  showStatus('Resuming playback...', 'info', null, 'normal', true);
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
    // Try force play as fallback
    forcePlay();
  }
}

function togglePlay() {
  if (state.isLoading) return;

  const elements = getElementsSafe();
  const audio = elements.audio;
  if (!audio) return;

  // Check if there's a saved playback state to resume
  if (audio.paused && !audio.src && state.savedPlaybackState) {
    resumeSavedPlayback();
    return;
  }

  // Check if there's a saved track to resume (legacy)
  if (audio.paused && !audio.src && state.currentTrack && state.currentTrack.url) {
    // Resume last track
    playAudioTrackOptimized(state.currentTrack, state.currentTrack.id, state.currentTrack.trackIndex, state.currentTrack.totalTracks).catch(error => {
      console.error('Error resuming track:', error);
      forcePlay();
    });
    return;
  }

  // Prevenir reproducción si no hay favoritos y no hay audio cargado
  if (audio.paused && !audio.src && state.favorites.length === 0) {
    safeShowStatus('Add tracks to favorites to begin', 'info');
    return;
  }

  state.userInteracted = true;

  if (audio.paused) {
    if (!audio.src) {
      forcePlay();
      return;
    }

    audio.play().then(() => {
      if (elements.playBtn) elements.playBtn.textContent = '| |';
      safeShowStatus('Music is playing now', 'info');

      // Actualizar Media Session
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
    }).catch(error => {
      safeShowStatus('Playback encountered an error', 'error');
      logPlayback('warn', 'Playback play() failed', error);
    });
  } else {
    audio.pause();
    if (elements.playBtn) elements.playBtn.textContent = '▶';
    safeShowStatus('Music is now paused', 'info');

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

  const queueSize = PLAYBACK_CONSTANTS.DEFAULT_QUEUE_SIZE; // Keep small to reduce parallel downloads
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
  } else if (context === 'album') {
    // Albums should remain continuous; keep only one prefetch, but store full remaining list.
    if (state.shuffleFavorites) {
      const shuffledAll = [...items].sort(() => Math.random() - 0.5);
      state.playbackQueue = shuffledAll.slice();
    } else {
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

  // Preload only the first item in queue to minimize parallel fetches
  if (state.networkOnline && state.playbackQueue.length > 0) {
    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.prefetchAudio === 'function') {
      audioCache.prefetchAudio(state.playbackQueue[0].url, true).catch((err) => logPlayback('debug', 'Failed to prefetch first queue item', err));
    }
  }

  // Prefetch just the immediate next track in context
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
async function playFromFavoritesQueue(specificTrack = null) {
  if (state.isLoading || state.favorites.length === 0) {
    logPlayback('debug', `playFromFavoritesQueue: Blocked (isLoading=${state.isLoading}, favorites=${state.favorites.length})`);
    return;
  }

  logPlayback('debug', `playFromFavoritesQueue: Starting (${specificTrack ? 'specific track' : 'queue'})`);
  
  // Ocultar listas al reproducir desde favoritos
  logPlayback('debug', 'Hiding search results and favorites list');
  if (typeof hideSearchResults === 'function') {
    hideSearchResults();
    logPlayback('debug', 'hideSearchResults called');
  } else {
    logPlayback('warn', 'hideSearchResults is not a function');
  }
  
  if (typeof hideFavoritesList === 'function') {
    hideFavoritesList();
    logPlayback('debug', 'hideFavoritesList called');
  } else {
    logPlayback('warn', 'hideFavoritesList is not a function');
  }

  safeShowStatus('Loading...', 'info', null, 'normal', true);

  state.isPlayingFavorites = true;
  
  // Resetear contador de recarga al iniciar manualmente
  if (!state.contextReloadCount) state.contextReloadCount = {};
  state.contextReloadCount['favorites'] = 0;

  try {
    // Ensure favorites context is set for reliable auto-advance/looping
    const favoritesItems = Array.isArray(state.favorites) ? state.favorites : [];
    if (!favoritesItems.length) {
      throw new Error('No favorites available');
    }

    // Si se proporcionó un track específico, usarlo directamente
    let track;
    if (specificTrack) {
      logPlayback('debug', `Using specific track: ${specificTrack.title || specificTrack.url || '[unknown]'}`);
      track = specificTrack;

      const idx = favoritesItems.findIndex(f => (f && track && f.url && track.url && f.url === track.url) || (f && track && f.id && track.id && f.id === track.id));
      const contextIndex = idx >= 0 ? idx : 0;

      playbackManager.setContext('favorites', favoritesItems, contextIndex);

      // Build FIFO starting *after* the selected track to avoid immediate duplicates
      const queueStartIndex = favoritesItems.length > 1 ? (contextIndex + 1) % favoritesItems.length : 0;
      loadPlaybackQueue('favorites', favoritesItems, queueStartIndex);
    } else {
      // Cargar cola FIFO con favoritos
      playbackManager.setContext('favorites', favoritesItems, 0);
      loadPlaybackQueue('favorites', favoritesItems, 0);

      if (state.playbackQueue.length === 0) {
        throw new Error('Could not load playback queue');
      }

      // Remove track from queue before playing
      track = state.playbackQueue.shift();
    }

    if (!track.url) {
      throw new Error('Audio URL not available in favorite');
    }

    safeShowStatus('Getting next track from queue', 'info');

    // Loader se ocultará cuando audio.play() inicie
    await playAudioTrackOptimized(track, track.id, track.trackIndex, track.totalTracks);

    updateShuffleButton();

  } catch (error) {
    logPlayback('error', 'Error in playFromFavoritesQueue', error);

    // Handle offline/cache errors by trying next track
    if (error.message.includes('Offline and audio not available in cache')) {
      safeShowStatus('This track isn\'t cached offline', 'error', 2000);
      // Try next track in queue if available
      if (state.playbackQueue.length > 0) {
        setTimeout(() => {
          playFromFavoritesQueue().catch((err) => logPlayback('warn', 'Retry playFromFavoritesQueue failed', err));
        }, 2000);
        return;
      } else {
        safeShowStatus('All offline tracks have finished', 'error', 3000);
      }
    } else {
      safeShowStatus('Something went wrong with playback', 'error');
    }
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

  logPlayback('debug', `Preloaded list configured with ${preloadedPlaylist.length} tracks`);
}

async function playNextInContext(maxRetries = 3) {
  // PREVENT MULTIPLE EXECUTION
  if (state.isLoading) return;

  // Only replace in FIFO queue if song played completely, not on manual next button
  const currentTrackUrl = (state.currentTrack && state.currentTrack.url) ? state.currentTrack.url : undefined;

  try {
    let context = playbackManager.getCurrentContext();

    // If context is missing, reconstruct something that can loop.
    if (!context) {
      if (state.isPlayingFavorites && Array.isArray(state.favorites) && state.favorites.length > 0) {
        playbackManager.setContext('favorites', state.favorites, 0);
        context = 'favorites';
      } else if (Array.isArray(state.searchResults) && state.searchResults.length > 0) {
        playbackManager.setContext('search', state.searchResults, 0);
        context = 'search';
      } else if (state.currentTrack && state.currentTrack.url) {
        // Last resort: loop current track.
        await playAudioTrackOptimized(state.currentTrack, state.currentTrack.id, state.currentTrack.trackIndex, state.currentTrack.totalTracks);
        return;
      }
    }

    // ALBUMS: always loop through album tracks
    if (context === 'album') {
      const albumContext = playbackManager.contextData.album;
      const nextItem = playbackManager.getNextTrack();
      if (nextItem && albumContext && Array.isArray(albumContext.items) && albumContext.items.length > 0) {
        try {
          await playAudioTrackOptimized(nextItem, playbackManager.getCurrentAlbumId(), albumContext.currentIndex, albumContext.items.length);
          return;
        } catch (error) {
          console.error('Error playing album track:', error);
          if (maxRetries > 0) {
            showStatus('Skipping this problematic track', 'error', 1500);
            return playNextInContext(maxRetries - 1);
          }
          // Never stop; try again from next.
          setTimeout(() => playNextInContext(3), 1000);
          return;
        }
      }
      // If album context is empty/missing, fall through to other strategies.
    }

    // Always play from FIFO queue if tracks available (with bounded duplicate-skip)
    if (state.playbackQueue.length > 0) {
      let guard = 0;
      while (state.playbackQueue.length > 0 && guard < 12) {
        const peek = state.playbackQueue[0];
        if (peek && currentTrackUrl && peek.url && peek.url === currentTrackUrl) {
          state.playbackQueue.shift();
          guard++;
          continue;
        }

        const actualNextTrack = state.playbackQueue.shift();
        if (!actualNextTrack) break;

        if (state.currentTrack && state.currentTrack.url && state.currentTrack.url !== actualNextTrack.url) {
          state.playbackHistory.push(state.currentTrack);
        }

        try {
          await playAudioTrackOptimized(actualNextTrack, actualNextTrack.id, actualNextTrack.trackIndex, actualNextTrack.totalTracks);
          return;
        } catch (error) {
          console.error('Error reproduciendo desde cola FIFO:', error);
          guard++;
          if (maxRetries > 0) {
            showStatus('Track issue detected, trying next', 'error', 1500);
            maxRetries--;
            continue;
          }
          // Never stop; keep trying.
          continue;
        }
      }
    }

    // No stop conditions: always continue by looping through context.

    const nextItem = playbackManager.getNextTrack();

    try {
      if (context === 'genre' || context === 'search') {
        const files = await fetchOptimizedPlayableFiles(nextItem.identifier);
        if (files && files.length > 0) {
          // If next search item is an album, switch into album context so the album itself loops.
          if (files.length > 1) {
            state.albumOrigin = 'search';
            playbackManager.setAlbumPlaylist(nextItem.identifier, files, 0);
            await playAudioTrackOptimized(files[0], nextItem.identifier, 0, files.length);
            loadPlaybackQueue('album', files, 1);
          } else {
            const track = files[0];
            await playAudioTrackOptimized(track, nextItem.identifier);
          }
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
        const cached = typeof audioCache !== 'undefined' && audioCache && typeof audioCache.get === 'function' ? await audioCache.get(track.url, true) : null;
        if (!cached && !state.networkOnline) {
          showStatus('Track not in offline cache', 'error', 2000);
          setTimeout(() => playNextInContext(), 1000);
          return;
        }

        await playAudioTrackOptimized(track, nextItem.id, nextItem.trackIndex, nextItem.totalTracks);
      } else if (context === 'searchPlaylist') {
        // Loop through the preloaded playlist context.
        await playAudioTrackOptimized(nextItem, nextItem.id, 0, 1);
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
      const cached = typeof audioCache !== 'undefined' && audioCache && typeof audioCache.get === 'function' ? await audioCache.get(track.url, true) : null;
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
  // Resonate UX: never stop at end; keep loop-based repeat modes only.
  const modes = ['context', 'one', 'infinite', 'all'];
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
      // Treat 'off' as 'context' so playback stays continuous.
      state.repeatMode = saved === 'off' ? 'context' : saved;
    }
  } catch (e) {
    state.repeatMode = 'all'; // Default
  }

  if (playbackStateManager) {
    playbackStateManager.setRepeatMode(state.repeatMode);
  }
}

function saveRepeatMode(mode) {
  try {
    localStorage.setItem('resonate_repeat_mode', mode);
  } catch (e) {
    logPlayback('warn', 'Error saving repeat mode', e);
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
  let errorHandlerExecuted = false;

  window.elements.audio.addEventListener('play', () => {
    endedHandlerExecuted = false;
    errorHandlerExecuted = false;
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

    // Track listening statistics (must never block auto-advance)
    if (state.currentTrack) {
      try {
        const listenDuration = Date.now() - state.currentTrackListenStart;
        const trackDuration = window.elements.audio.duration * 1000; // Convertir a ms

        // Si se escuchó al menos el 90% de la pista, marcarla como escuchada completamente
        if (isFinite(trackDuration) && trackDuration > 0 && listenDuration >= trackDuration * 0.9) {
          if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.markAsFullyListened === 'function') {
            await audioCache.markAsFullyListened(state.currentTrack.url);
          }
          if (isTrackFavorite(state.currentTrack) && typeof audioCache !== 'undefined' && audioCache && typeof audioCache.replaceFavoritesQueueItem === 'function') {
            await audioCache.replaceFavoritesQueueItem(state.currentTrack.url, null, state.favorites);
          }
          if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.getUsageStats === 'function') {
            const stats = await audioCache.getUsageStats();
            if (stats && stats.usagePercentage > 90) {
              showStatus(`Cache storage almost full`, 'info', 3000);
            }
          }
        } else {
          if (state.tracksSkippedEarly && state.currentTrack.url) {
            const skipCount = state.tracksSkippedEarly.get(state.currentTrack.url) || 0;
            state.tracksSkippedEarly.set(state.currentTrack.url, skipCount + 1);
          }
        }
      } catch (err) {
        logPlayback('debug', 'Listen tracking failed', err);
      } finally {
        state.currentTrackListenStart = 0;
      }
    }

    // Use enhanced playback controller for track end handling
    const currentContext = playbackManager.getCurrentContext();
    if (currentContext) {
      try {
        const contextId = currentContext === 'album' ? playbackManager.getCurrentAlbumId() : null;
        enhancedPlaybackController.setContext(currentContext, contextId);
        await enhancedPlaybackController.handleTrackEnd();
      } catch (err) {
        logPlayback('warn', 'Enhanced track end handling failed', err);
        setTimeout(() => {
          playNextInContext().catch((e) => logPlayback('warn', 'Fallback playNextInContext failed', e));
        }, 500);
      }
    } else {
      // Resonate UX: never stop when context is missing.
      playNextInContext().catch((e) => logPlayback('warn', 'No-context playNextInContext failed', e));
    }
  });

  // If a track errors and never reaches 'ended', skip forward to keep continuous playback.
  window.elements.audio.addEventListener('error', () => {
    if (errorHandlerExecuted) return;
    errorHandlerExecuted = true;

    try {
      showStatus('Track error. Skipping...', 'error', 2000);
    } catch {}

    setTimeout(() => {
      const currentContext = playbackManager.getCurrentContext();
      if (currentContext) {
        enhancedPlaybackController.setContext(currentContext);
        enhancedPlaybackController.handleTrackEnd().catch((err) => {
          logPlayback('warn', 'Error-skip handler failed', err);
          playNextInContext().catch((e) => logPlayback('warn', 'Fallback skip failed', e));
        });
      } else {
        playNextInContext().catch((e) => logPlayback('warn', 'Skip failed', e));
      }
    }, 800);
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
  let noun = ctx === 'search' ? 'search results' : ctx === 'searchPlaylist' ? 'playlist' : ctx === 'album' ? 'album' : 'favorites';

  if (!window.elements || !window.elements.shuffleFavoritesBtn) return;

  // Shuffle button is always enabled for all contexts
  window.elements.shuffleFavoritesBtn.disabled = false;

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

  if (playbackStateManager) {
    playbackStateManager.setShuffleMode(state.shuffleFavorites);
  }

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
    logPlayback('warn', 'Some Media Session actions unavailable', error);
  }
}

async function playTrack(trackId) {
  if (window.Loaders) {
    window.Loaders.showLoader({ type: 'spinner' });
  }
  try {
    const audioElement = getAudioEl();
    if (!audioElement) throw new Error('Audio element not found');

    const trackUrl = await fetchTrackUrl(trackId);
    audioElement.src = trackUrl;
    await audioElement.play();
  } catch (error) {
    console.error('Error during playback:', error);
  } finally {
    if (window.Loaders) {
      window.Loaders.hideLoader();
    }
  }
}
