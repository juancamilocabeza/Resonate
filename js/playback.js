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

function normalizeRepeatMode(mode) {
  // Keep backward compatibility with historical values.
  if (mode === RepeatMode.CONTEXT) return RepeatMode.ALL;
  // The Mode button only supports Off/Loop/One; treat legacy INFINITE as Loop.
  if (mode === RepeatMode.INFINITE) return RepeatMode.ALL;
  if (mode === RepeatMode.ALL || mode === RepeatMode.ONE || mode === RepeatMode.OFF) return mode;
  return RepeatMode.OFF;
}

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

function isAutoplayBlockedError(error) {
  try {
    const name = (error && error.name) ? String(error.name) : '';
    if (name === 'NotAllowedError' || name === 'AbortError') return true;

    const msg = (error && error.message) ? String(error.message) : String(error || '');
    // Best-effort: browsers vary in messaging when autoplay is blocked.
    return /notallowederror|play\(\) failed|user gesture|autoplay/i.test(msg);
  } catch {
    return false;
  }
}

function isSharedLinkAutoplayAttempt() {
  try {
    return !!(window.state && window.state.sharedLinkAutoplay === true);
  } catch {
    return false;
  }
}

function showAutoplayCta(message = 'Tap Play to start') {
  try {
    const text = (message && String(message).trim()) ? String(message).trim() : 'Tap Play to start';

    // Ensure the user can actually press Play.
    try {
      const elements = getElementsSafe();
      if (elements.playBtn) elements.playBtn.disabled = false;
    } catch {}

    let container = document.getElementById('status-messages');
    if (!container) {
      container = document.createElement('div');
      container.id = 'status-messages';
      document.body.appendChild(container);
    }

    const el = document.createElement('div');
    el.className = 'status-message status-info';
    el.textContent = text;
    container.appendChild(el);

    // Auto-dismiss (best effort). Keep it visible long enough to be noticed.
    window.setTimeout(() => {
      try {
        el.classList.add('fade-out');
        window.setTimeout(() => {
          try { el.remove(); } catch {}
        }, 350);
      } catch {
        try { el.remove(); } catch {}
      }
    }, 6000);
  } catch {
    // ignore
  }
}

/**
 * Preload covers for upcoming tracks in the current context
 * @param {Object} currentContext - Current playback context
 * @param {number} currentIndex - Current track index
 */
async function preloadUpcomingCovers(currentContext, currentIndex = 0) {
  try {
    if (!currentContext || !currentContext.items || currentContext.items.length === 0) {
      return;
    }

    // Get identifiers for next 2-3 tracks
    const identifiersToPreload = [];
    const maxPreload = 3;
    
    for (let i = 1; i <= maxPreload && (currentIndex + i) < currentContext.items.length; i++) {
      const track = currentContext.items[currentIndex + i];
      const identifier = track?.id || track?.identifier;
      if (identifier && identifier !== 'default') {
        identifiersToPreload.push(identifier);
      }
    }

    if (identifiersToPreload.length > 0) {
      // Preload in background without blocking
      window.CoverManager.preloadCovers(identifiersToPreload).catch(err => {
        logPlayback('warn', 'Cover preload failed', err);
      });
    }
  } catch (error) {
    logPlayback('warn', 'Error during cover preloading', error);
  }
}

function logPlayback(level, message, error) {
  try {
    if (window.logger && typeof window.logger._call === 'function') {
      const combined = error
        ? (error instanceof Error ? { message, error } : { message, data: error })
        : message;
      window.logger._call(level, combined, 'PLAYBACK');
      return;
    }
  } catch {}

  try {
    if (window.logger && typeof window.logger._call === 'function') {
      const combined = error ? { message, error } : message;
      window.logger._call(level, combined, 'PLAYBACK');
    }
  } catch {}
}

function signalServiceWorkerSafeActivation() {
  if (!navigator.serviceWorker || !navigator.serviceWorker.getRegistration) return;
  navigator.serviceWorker.getRegistration().then((reg) => {
    if (reg && reg.waiting) {
      try {
        reg.waiting.postMessage({ type: 'SKIP_WAITING_WHEN_IDLE' });
      } catch (err) {
        logPlayback('debug', `Failed to postMessage skipWaiting: ${err.message}`);
      }
    }
  });
}

// Retry strategies
const RetryStrategy = {
  NETWORK: { maxRetries: 5, backoff: 'exponential', baseDelay: 1000 },
  CACHE: { maxRetries: 2, backoff: 'linear', baseDelay: 500 },
  DECODE: { maxRetries: 1, backoff: 'none', baseDelay: 0 }
};

// Persistent shuffle deck ("baraja")
// Goal: one coherent shuffle order per context, persisted across reloads.
const SHUFFLE_DECK_STORAGE_KEY = 'resonate_shuffle_decks_v1';
const SHUFFLE_DECK_VERSION = 1;
const SHUFFLE_DECK_MAX_CONTEXTS = 12;

// Auto-skip limiter (in-memory) to prevent skip storms when offline or when a context is broken.
// Budget is per context key (album id, favorites, search result-set signature, etc.)
const AUTO_SKIP_MAX_PER_CONTEXT = 4;
const autoSkipStateByContextKey = new Map();

function computeAutoSkipContextKey() {
  try {
    const context = playbackManager && typeof playbackManager.getCurrentContext === 'function'
      ? playbackManager.getCurrentContext()
      : null;
    if (!context) return 'unknown';

    if (context === 'resontes') return 'resontes';

    if (context === 'album') {
      const albumId = playbackManager && typeof playbackManager.getCurrentAlbumId === 'function'
        ? playbackManager.getCurrentAlbumId()
        : null;
      return `album:${String(albumId || 'unknown')}`;
    }

    if (context === 'search') {
      const items = (playbackManager && playbackManager.contextData && playbackManager.contextData.search && Array.isArray(playbackManager.contextData.search.items))
        ? playbackManager.contextData.search.items
        : (Array.isArray(state.searchResults) ? state.searchResults : []);
      const ids = uniqStrings((items || []).map(it => it && it.identifier ? String(it.identifier) : '').filter(Boolean));
      const sig = fnv1aHash(ids.slice().sort().join('|') + `|${ids.length}`);
      return `search:${sig}`;
    }

    if (context === 'searchPlaylist') {
      const items = (playbackManager && playbackManager.contextData && playbackManager.contextData.searchPlaylist && Array.isArray(playbackManager.contextData.searchPlaylist.items))
        ? playbackManager.contextData.searchPlaylist.items
        : [];
      const keys = uniqStrings((items || []).map(it => getItemKeyForDeck('searchPlaylist', it)).filter(Boolean));
      const sig = fnv1aHash(keys.slice().sort().join('|') + `|${keys.length}`);
      return `searchPlaylist:${sig}`;
    }

    return String(context);
  } catch {
    return 'unknown';
  }
}

function resetAutoSkipBudgetForCurrentContext() {
  const key = computeAutoSkipContextKey();
  if (!key) return;
  autoSkipStateByContextKey.set(key, { remaining: AUTO_SKIP_MAX_PER_CONTEXT, updatedAt: Date.now() });
}

function tryConsumeAutoSkipBudget(reason = 'auto-skip') {
  const key = computeAutoSkipContextKey();
  if (!key) return { allowed: true, remaining: AUTO_SKIP_MAX_PER_CONTEXT, contextKey: key };

  const existing = autoSkipStateByContextKey.get(key) || { remaining: AUTO_SKIP_MAX_PER_CONTEXT, updatedAt: Date.now() };
  const remaining = Number.isFinite(existing.remaining) ? existing.remaining : AUTO_SKIP_MAX_PER_CONTEXT;

  if (remaining <= 0) {
    return { allowed: false, remaining: 0, contextKey: key };
  }

  const next = { remaining: remaining - 1, updatedAt: Date.now() };
  autoSkipStateByContextKey.set(key, next);
  logPlayback('debug', `Auto-skip budget consumed (${reason}): ${key} remaining=${next.remaining}`);
  return { allowed: true, remaining: next.remaining, contextKey: key };
}

function handleAutoSkipBudgetExhausted(contextKey) {
  try {
    const elements = getElementsSafe();
    const audio = elements.audio;
    if (audio) audio.pause();
    if (elements.playBtn) elements.playBtn.textContent = '▶';
  } catch {}

  safeShowStatus('Paused: too many skipped tracks in this context', 'error', 4500);
  safeShowStatus('Reconnect or download tracks for offline playback', 'info', 4500);
  logPlayback('warn', `Auto-skip budget exhausted for ${contextKey || 'unknown'}`);
}

function scheduleAutoAdvance(reason, delayMs, advanceFn) {
  const budget = tryConsumeAutoSkipBudget(reason);
  if (!budget.allowed) {
    handleAutoSkipBudgetExhausted(budget.contextKey);
    return false;
  }

  const delay = Number.isFinite(Number(delayMs)) ? Math.max(0, Number(delayMs)) : 0;
  setTimeout(() => {
    try {
      (advanceFn || (() => playNextInContext())).call(null);
    } catch {}
  }, delay);
  return true;
}

function safeLocalStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeLocalStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch {}
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

function canonicalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return String(url).trim();
  }
}

function mulberry32(seed) {
  let t = (seed >>> 0) || 0;
  return function() {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicShuffle(array, seed) {
  const rng = mulberry32(seed);
  const a = Array.isArray(array) ? array.slice() : [];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

function generateSeed32() {
  try {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] >>> 0;
  } catch {
    return (Date.now() >>> 0) ^ ((Math.floor(performance.now()) >>> 0) || 0);
  }
}

function uniqStrings(items) {
  const out = [];
  const seen = new Set();
  for (const it of items || []) {
    const s = String(it || '');
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function getContextKeyForDeck(contextType, itemKeys, contextId = null) {
  const keys = Array.isArray(itemKeys) ? itemKeys : [];
  const sig = fnv1aHash(keys.slice().sort().join('|') + `|${keys.length}`);

  if (contextType === 'album') {
    const albumId = (contextId != null ? contextId : (playbackManager && typeof playbackManager.getCurrentAlbumId === 'function' ? playbackManager.getCurrentAlbumId() : null))
      || (state && state.currentTrack ? (state.currentTrack.albumId || state.currentTrack.id) : null)
      || 'unknown';
    return `album:${String(albumId)}`;
  }

  if (contextType === 'search') {
    // Search results are ephemeral; key by result-set signature.
    return `search:${sig}`;
  }

  if (contextType === 'searchPlaylist') {
    return `searchPlaylist:${sig}`;
  }

  // favorites or others: stable key.
  return String(contextType || 'unknown');
}

function getItemKeyForDeck(contextType, item) {
  if (!item) return '';
  if (contextType === 'search') {
    return item && item.identifier ? String(item.identifier) : '';
  }

  // album/favorites/searchPlaylist use actual audio URLs
  if (item && item.url) return canonicalizeUrl(item.url);
  if (item && item.id) return String(item.id);
  return '';
}

function loadShuffleDeckMap() {
  const raw = safeLocalStorageGet(SHUFFLE_DECK_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

function saveShuffleDeckMap(map) {
  const obj = (map && typeof map === 'object') ? map : {};
  safeLocalStorageSet(SHUFFLE_DECK_STORAGE_KEY, JSON.stringify(obj));
}

function pruneShuffleDeckMap(map) {
  const entries = Object.entries(map || {});
  if (entries.length <= SHUFFLE_DECK_MAX_CONTEXTS) return map;

  entries.sort((a, b) => {
    const ta = (a[1] && typeof a[1].updatedAt === 'number') ? a[1].updatedAt : 0;
    const tb = (b[1] && typeof b[1].updatedAt === 'number') ? b[1].updatedAt : 0;
    return tb - ta;
  });

  const trimmed = entries.slice(0, SHUFFLE_DECK_MAX_CONTEXTS);
  return Object.fromEntries(trimmed);
}

function ensureShuffleDeck(contextType, items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const itemKeys = uniqStrings(list.map((it) => getItemKeyForDeck(contextType, it)).filter(Boolean));
  const listSig = fnv1aHash(itemKeys.slice().sort().join('|') + `|${itemKeys.length}`);
  const contextId = options.contextId != null ? options.contextId : null;
  const contextKey = getContextKeyForDeck(contextType, itemKeys, contextId);

  const map = loadShuffleDeckMap();
  let deck = map[contextKey];
  const now = Date.now();

  const needsRebuild = !deck || deck.version !== SHUFFLE_DECK_VERSION || !Array.isArray(deck.order) || deck.listSig !== listSig;
  const seed = (deck && typeof deck.seed === 'number') ? (deck.seed >>> 0) : generateSeed32();

  if (needsRebuild) {
    const order = deterministicShuffle(itemKeys, seed);
    deck = {
      version: SHUFFLE_DECK_VERSION,
      seed,
      order,
      index: 0,
      listSig,
      updatedAt: now
    };
  } else {
    // Sync to current set, preserving order as much as possible.
    const set = new Set(itemKeys);
    const existing = Array.isArray(deck.order) ? deck.order : [];
    const kept = existing.filter(k => set.has(k));
    const keptSet = new Set(kept);
    const additions = itemKeys.filter(k => !keptSet.has(k));
    const shuffledAdditions = additions.length ? deterministicShuffle(additions, seed ^ 0x9e3779b9) : [];

    deck.order = kept.concat(shuffledAdditions);
    deck.listSig = listSig;
    deck.seed = seed;
    deck.index = Math.max(0, Math.min(Number(deck.index) || 0, deck.order.length));
    deck.updatedAt = now;
  }

  // Optional anchoring
  const currentKey = options.currentKey ? String(options.currentKey) : '';
  const preferredNextKey = options.preferredNextKey ? String(options.preferredNextKey) : '';

  if (options.anchorCurrent === true && currentKey) {
    const pos = deck.order.indexOf(currentKey);
    if (pos >= 0) {
      deck.index = pos + 1;
    }
  } else if (!currentKey && preferredNextKey) {
    const pos = deck.order.indexOf(preferredNextKey);
    if (pos >= 0) {
      deck.index = pos;
    }
  }

  // End-of-deck: start a new cycle.
  if (deck.index >= deck.order.length) {
    deck.index = 0;
  }

  map[contextKey] = deck;
  saveShuffleDeckMap(pruneShuffleDeckMap(map));

  return { contextKey, itemKeys, deck };
}

function shuffleDeckConsumeKey(contextKey, playedKey) {
  if (!contextKey || !playedKey) return { wrapped: false };
  const map = loadShuffleDeckMap();
  const deck = map[contextKey];
  if (!deck || !Array.isArray(deck.order)) return { wrapped: false };

  const key = String(playedKey);
  const idx = Number(deck.index) || 0;
  const now = Date.now();

  let nextIndex = idx;
  if (deck.order[idx] === key) {
    nextIndex = idx + 1;
  } else {
    const pos = deck.order.indexOf(key);
    if (pos >= 0 && pos >= idx) {
      nextIndex = pos + 1;
    }
  }

  const wrapped = nextIndex >= deck.order.length;
  deck.index = wrapped ? 0 : nextIndex;

  // Reshuffle per cycle: when we consume the last item and wrap back to 0,
  // generate a new seed + new order (persisted), and avoid repeating the last played track.
  if (wrapped) {
    try {
      const keys = uniqStrings((deck.order || []).map(k => String(k || '')).filter(Boolean)).slice().sort();
      if (keys.length > 1) {
        const newSeed = generateSeed32();
        let newOrder = deterministicShuffle(keys, newSeed);

        if (newOrder[0] === key) {
          const swapIndex = newOrder.findIndex(k => k !== key);
          if (swapIndex > 0) {
            const tmp = newOrder[0];
            newOrder[0] = newOrder[swapIndex];
            newOrder[swapIndex] = tmp;
          }
        }

        deck.seed = newSeed;
        deck.order = newOrder;
        deck.index = 0;
        deck.cycle = (Number(deck.cycle) || 0) + 1;
      } else {
        // Single-item decks can't reshuffle into a different order.
        deck.index = 0;
      }
    } catch {}
  }

  deck.updatedAt = now;
  map[contextKey] = deck;
  saveShuffleDeckMap(pruneShuffleDeckMap(map));

  return { wrapped: Boolean(wrapped), cycle: Number(deck.cycle) || 0 };
}

function shuffleDeckGetRemainingItems(contextType, items, options = {}) {
  const { contextKey, deck } = ensureShuffleDeck(contextType, items, options);
  const byKey = new Map();
  for (const it of (items || [])) {
    const k = getItemKeyForDeck(contextType, it);
    if (k) byKey.set(k, it);
  }

  const idx = Number(deck.index) || 0;
  const keys = (Array.isArray(deck.order) ? deck.order : []).slice(idx);
  return {
    contextKey,
    remainingItems: keys.map(k => byKey.get(k)).filter(Boolean)
  };
}

function getActiveDeckContextInfo() {
  const contextType = playbackManager && typeof playbackManager.getCurrentContext === 'function'
    ? playbackManager.getCurrentContext()
    : null;
  if (!contextType) return null;

  if (contextType === 'resontes') {
    return { contextType, items: Array.isArray(state.resontes) ? state.resontes : [], contextId: null };
  }

  if (contextType === 'album') {
    const albumId = playbackManager && typeof playbackManager.getCurrentAlbumId === 'function' ? playbackManager.getCurrentAlbumId() : null;
    const albumCtx = playbackManager && playbackManager.contextData ? playbackManager.contextData.album : null;
    const items = albumCtx && Array.isArray(albumCtx.items) ? albumCtx.items : [];
    return { contextType, items, contextId: albumId };
  }

  if (contextType === 'search') {
    const ctx = playbackManager && playbackManager.contextData ? playbackManager.contextData.search : null;
    const items = ctx && Array.isArray(ctx.items) ? ctx.items : [];
    return { contextType, items, contextId: null };
  }

  if (contextType === 'searchPlaylist') {
    const ctx = playbackManager && playbackManager.contextData ? playbackManager.contextData.searchPlaylist : null;
    const items = ctx && Array.isArray(ctx.items) ? ctx.items : [];
    return { contextType, items, contextId: null };
  }

  return null;
}

// Playback state manager
class PlaybackStateManager {
  constructor() {
    // Repeat/mode toggle removed from UX; keep continuous playback by default.
    const repeat = RepeatMode.ALL;
    let shuffle = false;
    try {
      const config = JSON.parse(localStorage.getItem('playbackConfig'));
      if (config) {
        if (typeof config.shuffle === 'boolean') shuffle = config.shuffle;
      }
      if (localStorage.getItem('resonate_shuffle_enabled') !== null) {
        shuffle = localStorage.getItem('resonate_shuffle_enabled') === 'true';
      }
    } catch {}
    this.state = {
      current: { track: null, context: null, contextId: null },
      queue: { items: [], position: 0 },
      // Resonate UX: playback should be continuous por defecto
      modes: { repeat, shuffle },
      history: { played: [], skipped: [] },
      stats: { consecutiveFailures: 0, totalFailures: 0 }
    };
    this.contexts = new Map();
  }

  setCurrentTrack(track, context, contextId = null) {
    this.state.current = { track, context, contextId };
  }

  setRepeatMode() {
    // Repeat/mode toggle removed from UX; keep continuous playback.
    this.state.modes.repeat = RepeatMode.ALL;
    this.saveConfig();
  }

  setShuffleMode(enabled) {
    this.state.modes.shuffle = enabled;
    this.saveConfig();
    try { localStorage.setItem('resonate_shuffle_enabled', String(enabled)); } catch {}
  }

  saveConfig() {
    try {
      localStorage.setItem('playbackConfig', JSON.stringify({
        shuffle: this.state.modes.shuffle
      }));
    } catch {}
  }

  getPlaybackConfigStatus() {
    return {
      repeat: RepeatMode.ALL,
      shuffle: this.state.modes.shuffle
    };
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
    return RepeatMode.ALL;
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
      resontes: { currentIndex: -1, items: [] },
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

    const isDeckShuffle = (this.currentContext === 'album' || this.currentContext === 'resontes' || this.currentContext === 'search' || this.currentContext === 'searchPlaylist')
      && state.shuffleResontes;

    if (isDeckShuffle) {
      const currentKey = (() => {
        if (this.currentContext === 'search') {
          const id = state && state.currentTrack ? (state.currentTrack.albumId || state.currentTrack.id) : null;
          return id ? String(id) : '';
        }
        const url = state && state.currentTrack ? state.currentTrack.url : '';
        return url ? canonicalizeUrl(url) : '';
      })();

      const { contextKey, deck } = ensureShuffleDeck(this.currentContext, context.items, {
        currentKey,
        contextId: this.currentContext === 'album' ? this.getCurrentAlbumId() : null
      });

      const nextKey = Array.isArray(deck.order) ? deck.order[Number(deck.index) || 0] : '';
      const nextIdx = nextKey
        ? context.items.findIndex(it => getItemKeyForDeck(this.currentContext, it) === nextKey)
        : -1;

      if (nextIdx >= 0) context.currentIndex = nextIdx;
      return nextIdx >= 0 ? context.items[nextIdx] : null;
    }

    context.currentIndex = (context.currentIndex + 1) % context.items.length;
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

    const isDeckShuffle = (this.currentContext === 'album' || this.currentContext === 'favorites' || this.currentContext === 'search' || this.currentContext === 'searchPlaylist')
      && state.shuffleFavorites;

    if (isDeckShuffle) {
      const currentKey = (() => {
        if (this.currentContext === 'search') {
          const id = state && state.currentTrack ? (state.currentTrack.albumId || state.currentTrack.id) : null;
          return id ? String(id) : '';
        }
        const url = state && state.currentTrack ? state.currentTrack.url : '';
        return url ? canonicalizeUrl(url) : '';
      })();

      const { deck } = ensureShuffleDeck(this.currentContext, context.items, {
        currentKey,
        contextId: this.currentContext === 'album' ? this.getCurrentAlbumId() : null
      });

      const order = Array.isArray(deck.order) ? deck.order : [];
      const pos = currentKey ? order.indexOf(currentKey) : -1;
      if (order.length > 0 && pos >= 0) {
        const prevKey = order[(pos - 1 + order.length) % order.length];
        const prevIdx = context.items.findIndex(it => getItemKeyForDeck(this.currentContext, it) === prevKey);
        if (prevIdx >= 0) context.currentIndex = prevIdx;
        return prevIdx >= 0 ? context.items[prevIdx] : null;
      }
    }

    context.currentIndex = (context.currentIndex - 1 + context.items.length) % context.items.length;
    return context.items[context.currentIndex];
  }
}

const playbackManager = new ContinuousPlaybackManager();

async function restorePlaybackQueueFromSnapshot(snapshot) {
  try {
    const snap = snapshot && typeof snapshot === 'object' ? snapshot : null;
    const context = snap && snap.context ? String(snap.context) : '';
    if (!context) return false;

    const clampIndex = (idx, length) => {
      const i = Number(idx);
      if (!Number.isFinite(i)) return 0;
      const max = Math.max(0, Number(length || 0) - 1);
      return Math.max(0, Math.min(max, Math.floor(i)));
    };

    if (context === 'resontes') {
      const items = (state && Array.isArray(state.resontes)) ? state.resontes : [];
      if (!items.length) return false;
      playbackManager.setContext('resontes', items, clampIndex(snap.currentIndex, items.length));
      return true;
    }

    if (context === 'album') {
      const albumId = snap.albumId != null ? String(snap.albumId) : (state && state.currentTrack ? String(state.currentTrack.albumId || state.currentTrack.id || '') : '');
      if (!albumId) return false;

      if (typeof fetchOptimizedPlayableFiles !== 'function') return false;
      const tracks = await fetchOptimizedPlayableFiles(albumId);
      if (!Array.isArray(tracks) || tracks.length === 0) return false;
      playbackManager.setAlbumPlaylist(albumId, tracks, clampIndex(snap.currentIndex, tracks.length));
      return true;
    }

    // Best-effort only: search/searchPlaylist contexts are often ephemeral.
    return false;
  } catch {
    return false;
  }
}

try {
  window.restorePlaybackQueueFromSnapshot = restorePlaybackQueueFromSnapshot;
} catch {
  // ignore
}

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

    const shouldLoop = repeatMode === RepeatMode.ALL;
    const nextTrack = await this.getNextTrack(shouldLoop);
    if (nextTrack) {
      await this.retryManager.executeWithRetry(async () => {
        await playAudioTrackOptimized(nextTrack, currentAlbumId, nextTrack.trackIndex, nextTrack.totalTracks);
        this.stateManager.recordSuccess();
      }, RetryStrategy.NETWORK);
      return;
    }

    // Album finished
    if (repeatMode === RepeatMode.OFF) {
      showStatus('Your album playback is complete', 'info', 2000);
      return;
    }

    if (shouldLoop) {
      const firstTrack = await this.getFirstTrack();
      if (firstTrack) {
        await this.retryManager.executeWithRetry(async () => {
          await playAudioTrackOptimized(firstTrack, currentAlbumId, 0, firstTrack.totalTracks);
        }, RetryStrategy.NETWORK);
      }
    } else {
      showStatus('Your album playback is complete', 'info', 2000);
    }
  }

  async getNextTrack(allowLoop = false) {
    const context = playbackManager.contextData.album;
    if (!context || !context.items || context.items.length === 0) return null;

    const isShuffle = this.stateManager.getShuffleMode();
    if (isShuffle) {
      const albumId = this.stateManager.getCurrentContextId();
      const currentKey = state && state.currentTrack && state.currentTrack.url ? canonicalizeUrl(state.currentTrack.url) : '';
      const { deck } = ensureShuffleDeck('album', context.items, { currentKey, contextId: albumId });
      const nextKey = Array.isArray(deck.order) ? deck.order[Number(deck.index) || 0] : '';
      const idx = nextKey
        ? context.items.findIndex(it => getItemKeyForDeck('album', it) === nextKey)
        : -1;
      context.currentIndex = idx >= 0 ? idx : (context.currentIndex || 0);
    } else {
      if (typeof context.currentIndex !== 'number') context.currentIndex = 0;
      const nextIndex = context.currentIndex + 1;
      if (nextIndex >= context.items.length) {
        if (!allowLoop) return null;
        context.currentIndex = 0;
      } else {
        context.currentIndex = nextIndex;
      }
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

class ResontesContextHandler extends BaseContextHandler {
  constructor(playbackStateManager) {
    super(playbackStateManager);
  }

  getContextType() {
    return 'resontes';
  }

  async handleTrackEnd() {
    const repeatMode = this.stateManager.getRepeatMode();

    if (repeatMode === RepeatMode.ONE) {
      window.elements.audio.currentTime = 0;
      window.elements.audio.play();
      return;
    }

    const shouldLoop = repeatMode === RepeatMode.ALL;

    // Precarga favoritas (mínimo 10) antes de continuar
    if (typeof window.audioCache === 'object' && window.audioCache && Array.isArray(state.favorites)) {
      window.audioCache.preloadFavorites(state.favorites);
    }

    // Try to get next track from queue or context
    const nextTrack = await this.getNextTrack(shouldLoop);
    if (nextTrack) {
      await this.retryManager.executeWithRetry(async () => {
        await playAudioTrackOptimized(nextTrack, nextTrack.id, nextTrack.trackIndex, nextTrack.totalTracks);
        this.stateManager.recordSuccess();
      }, RetryStrategy.CACHE);
    } else {
      // No more tracks
      if (repeatMode === RepeatMode.OFF) {
        showStatus('Favorites finished. Find more tracks', 'info', 2000);
        return;
      }

      if (shouldLoop) {
        // Restart favorites (loop current context)
        loadPlaybackQueue('favorites', state.favorites, 0);
        const firstTrack = state.playbackQueue.shift();
        if (firstTrack) {
          await this.retryManager.executeWithRetry(async () => {
            await playAudioTrackOptimized(firstTrack, firstTrack.id, firstTrack.trackIndex, firstTrack.totalTracks);
          }, RetryStrategy.CACHE);
        }
        return;
      }

      showStatus('Favorites finished. Find more tracks', 'info', 2000);
    }
  }

  async getNextTrack(allowLoop = false) {
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

    // Fallback to context navigation (back-compat: favorites -> resontes)
    const context = (playbackManager.contextData && (playbackManager.contextData.resontes || playbackManager.contextData.favorites))
      ? (playbackManager.contextData.resontes || playbackManager.contextData.favorites)
      : null;
    if (!context || !context.items || context.items.length === 0) return null;

    const isShuffle = this.stateManager.getShuffleMode();
    if (isShuffle) {
      const currentKey = state && state.currentTrack && state.currentTrack.url ? canonicalizeUrl(state.currentTrack.url) : '';
      const { deck } = ensureShuffleDeck('resontes', context.items, { currentKey });
      const nextKey = Array.isArray(deck.order) ? deck.order[Number(deck.index) || 0] : '';
      const idx = nextKey
        ? context.items.findIndex(it => getItemKeyForDeck('resontes', it) === nextKey)
        : -1;
      context.currentIndex = idx >= 0 ? idx : (context.currentIndex || 0);
    } else {
      if (typeof context.currentIndex !== 'number') context.currentIndex = 0;
      const nextIndex = context.currentIndex + 1;
      if (nextIndex >= context.items.length) {
        if (!allowLoop) return null;
        context.currentIndex = 0;
      } else {
        context.currentIndex = nextIndex;
      }
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

// Back-compat alias: older code paths still refer to "favorites".
class FavoritesContextHandler extends ResontesContextHandler {
  getContextType() {
    return 'favorites';
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

    const shouldLoop = repeatMode === RepeatMode.ALL;

    // Precarga resultados de búsqueda (mínimo 10) antes de continuar
    if (typeof window.audioCache === 'object' && window.audioCache && Array.isArray(playbackManager.contextData.search.items)) {
      window.audioCache.preloadSearchResults(playbackManager.contextData.search.items);
    }

    const nextTrack = await this.getNextTrack(shouldLoop);
    if (nextTrack) {
      await this.retryManager.executeWithRetry(async () => {
        const files = await fetchOptimizedPlayableFiles(nextTrack.identifier);
        if (files && files.length > 0) {
          // If next search item is an album, switch into album context so the album itself loops.
          if (files.length > 1) {
            state.albumOrigin = 'search';
            playbackManager.setAlbumPlaylist(nextTrack.identifier, files, 0);
            await playAudioTrackOptimized(files[0], nextTrack.identifier, 0, files.length);
            loadPlaybackQueue('album', files, 1);
          } else {
            await playAudioTrackOptimized(files[0], nextTrack.identifier);
          }
          this.stateManager.recordSuccess();
        }
      }, RetryStrategy.NETWORK);
    } else {
      if (repeatMode === RepeatMode.OFF) {
        showStatus('Search complete. Ready for new search', 'info', 2000);
        return;
      }

      if (shouldLoop) {
        const context = playbackManager.contextData.search;
        if (context && context.items && context.items.length > 0) {
          context.currentIndex = 0;
          const firstItem = context.items[0];
          const files = await fetchOptimizedPlayableFiles(firstItem.identifier);
          if (files && files.length > 0) {
            await playAudioTrackOptimized(files[0], firstItem.identifier);
          }
        }
        return;
      }

      showStatus('Search complete. Ready for new search', 'info', 2000);
    }
  }

  async getNextTrack(allowLoop = false) {
    const context = playbackManager.contextData.search;
    if (!context || !context.items || context.items.length === 0) return null;

    const isShuffle = this.stateManager.getShuffleMode();
    if (isShuffle) {
      const currentKey = state && state.currentTrack ? String(state.currentTrack.albumId || state.currentTrack.id || '') : '';
      const { deck } = ensureShuffleDeck('search', context.items, { currentKey });
      const nextKey = Array.isArray(deck.order) ? deck.order[Number(deck.index) || 0] : '';
      const idx = nextKey
        ? context.items.findIndex(it => getItemKeyForDeck('search', it) === nextKey)
        : -1;
      context.currentIndex = idx >= 0 ? idx : (context.currentIndex || 0);
    } else {
      if (typeof context.currentIndex !== 'number') context.currentIndex = 0;
      const nextIndex = context.currentIndex + 1;
      if (nextIndex >= context.items.length) {
        if (!allowLoop) return null;
        context.currentIndex = 0;
      } else {
        context.currentIndex = nextIndex;
      }
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

    const shouldLoop = repeatMode === RepeatMode.ALL;

    const nextTrack = await this.getNextTrack(shouldLoop);
    if (nextTrack) {
      await this.retryManager.executeWithRetry(async () => {
        await playAudioTrackOptimized(nextTrack, nextTrack.id, 0, 1);
        this.stateManager.recordSuccess();
      }, RetryStrategy.NETWORK);
    } else {
      if (repeatMode === RepeatMode.OFF) {
        showStatus('Your playlist has finished playing', 'info', 2000);
        return;
      }

      if (shouldLoop) {
        const context = playbackManager.contextData.searchPlaylist;
        if (context && context.items && context.items.length > 0) {
          context.currentIndex = 0;
          const firstTrack = context.items[0];
          await playAudioTrackOptimized(firstTrack, firstTrack.id, 0, 1);
        }
        return;
      }

      showStatus('Your playlist has finished playing', 'info', 2000);
    }
  }

  async getNextTrack(allowLoop = false) {
    const context = playbackManager.contextData.searchPlaylist;
    if (!context || !context.items || context.items.length === 0) return null;

    const isShuffle = this.stateManager.getShuffleMode();
    if (isShuffle) {
      const currentKey = state && state.currentTrack && state.currentTrack.url ? canonicalizeUrl(state.currentTrack.url) : '';
      const { deck } = ensureShuffleDeck('searchPlaylist', context.items, { currentKey });
      const nextKey = Array.isArray(deck.order) ? deck.order[Number(deck.index) || 0] : '';
      const idx = nextKey
        ? context.items.findIndex(it => getItemKeyForDeck('searchPlaylist', it) === nextKey)
        : -1;
      context.currentIndex = idx >= 0 ? idx : (context.currentIndex || 0);
    } else {
      if (typeof context.currentIndex !== 'number') context.currentIndex = 0;
      const nextIndex = context.currentIndex + 1;
      if (nextIndex >= context.items.length) {
        if (!allowLoop) return null;
        context.currentIndex = 0;
      } else {
        context.currentIndex = nextIndex;
      }
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
      case 'resontes':
        return new ResontesContextHandler(playbackStateManager);
      case 'favorites':
        return new FavoritesContextHandler(playbackStateManager);
      case 'search':
        return new SearchContextHandler(playbackStateManager);
      case 'searchPlaylist':
        return new SearchPlaylistContextHandler(playbackStateManager);
      default:
        return new ResontesContextHandler(playbackStateManager); // fallback
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
      logPlayback('error', 'Error in track end handling', error);
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
            logPlayback('error', 'Fallback track end handling failed', err);
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
// Utilidad para mostrar el estado actual en la UI
window.getPlaybackConfigStatus = function() {
  if (window.playbackStateManager && typeof window.playbackStateManager.getPlaybackConfigStatus === 'function') {
    return window.playbackStateManager.getPlaybackConfigStatus();
  }
  return { repeat: RepeatMode.CONTEXT, shuffle: false };
};
window.playbackStateManager = playbackStateManager;
window.enhancedPlaybackController = enhancedPlaybackController;

// Fetch with timeout for network operations
async function fetchWithTimeout(resource, options = {}, timeout = 8000) {
  const resourceStr = String(resource || '');
  const externalSignal = options && options.signal;

  const baseTimeout = (options && typeof options.timeout === 'number')
    ? options.timeout
    : (typeof timeout === 'number' ? timeout : 20000);

  // Archive.org search can legitimately take longer than 20s.
  const isArchiveAdvancedSearch = /archive\.org\/advancedsearch\.php/i.test(resourceStr);
  const requestedTimeout = isArchiveAdvancedSearch ? Math.max(baseTimeout, 45000) : baseTimeout;

  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => {
    try {
      // Preserve the original abort reason when possible.
      controller.abort(externalSignal && 'reason' in externalSignal ? externalSignal.reason : 'Aborted');
    } catch {
      try { controller.abort(); } catch {}
    }
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      onExternalAbort();
    } else {
      try { externalSignal.addEventListener('abort', onExternalAbort, { once: true }); } catch {}
    }
  }

  const id = setTimeout(() => {
    timedOut = true;
    try { controller.abort('Timeout exceeded'); } catch { try { controller.abort(); } catch {} }
  }, requestedTimeout);

  // Clone options to avoid leaking non-standard props to fetch
  const fetchOpts = { ...(options || {}) };
  delete fetchOpts.timeout;
  delete fetchOpts.signal;
  fetchOpts.signal = controller.signal;

  try {
    const response = await fetch(resource, fetchOpts);
    return response;
  } catch (error) {
    // If the caller aborted (e.g., user typed a new query), surface an AbortError.
    if (!timedOut && externalSignal && externalSignal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    if (timedOut || (error && String(error).includes('Timeout'))) {
      throw new Error(`Timeout exceeded: ${resourceStr}`);
    }

    // Normalize network failures into a predictable error to avoid noisy logs upstream
    if (error && error instanceof TypeError && String(error.message).includes('Failed to fetch')) {
      throw new Error('Network request failed');
    }
    throw error;
  } finally {
    clearTimeout(id);
    if (externalSignal && externalSignal.removeEventListener) {
      try { externalSignal.removeEventListener('abort', onExternalAbort); } catch {}
    }
  }
}

// Expose for other scripts (search.js) when loaded as a global script.
try { window.fetchWithTimeout = fetchWithTimeout; } catch {}

// Reliable download with progress events (XMLHttpRequest gives lengthComputable)
function downloadBlobWithProgress(url, timeoutMs, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    xhr.timeout = timeoutMs || 20000;

    xhr.onprogress = (event) => {
      if (typeof onProgress === 'function') {
        onProgress(event.loaded, event.lengthComputable ? event.total : 0);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // Final progress push before completion
        if (typeof onProgress === 'function') {
          onProgress(xhr.response.size, xhr.response.size);
        }
        logPlayback('debug', `[XHR] Download complete: ${xhr.response.size} bytes`);
        resolve(xhr.response);
      } else {
        reject(new Error(`HTTP Error: ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error'));
    xhr.ontimeout = () => reject(new Error('Timeout while downloading audio'));

    try {
      xhr.send();
    } catch (err) {
      reject(err);
    }
  });
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

let activeLoaderProgress = 0;

// In-memory preloaded blob URLs for near-instant next-track playback
const PRELOADED_BLOB_URL_LIMIT = 3;
const preloadedBlobUrlMap = new Map();
let preloadAudioElement = null;

function ensurePreloadAudioElement() {
  if (preloadAudioElement) return preloadAudioElement;
  try {
    preloadAudioElement = new Audio();
    preloadAudioElement.preload = 'auto';
    preloadAudioElement.muted = true;
  } catch {
    preloadAudioElement = null;
  }
  return preloadAudioElement;
}

function setPreloadedBlobUrl(url, blobUrl) {
  if (!url || !blobUrl) return;
  try {
    // If already cached, replace and revoke old
    if (preloadedBlobUrlMap.has(url)) {
      const existing = preloadedBlobUrlMap.get(url);
      if (existing && existing.startsWith('blob:')) {
        try { URL.revokeObjectURL(existing); } catch {}
      }
      preloadedBlobUrlMap.delete(url);
    }

    preloadedBlobUrlMap.set(url, blobUrl);

    // Enforce limit (evict oldest)
    while (preloadedBlobUrlMap.size > PRELOADED_BLOB_URL_LIMIT) {
      const oldestKey = preloadedBlobUrlMap.keys().next().value;
      const oldestUrl = preloadedBlobUrlMap.get(oldestKey);
      preloadedBlobUrlMap.delete(oldestKey);
      if (oldestUrl && oldestUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(oldestUrl); } catch {}
      }
    }
  } catch {
    // best-effort
  }
}

function consumePreloadedBlobUrl(url) {
  if (!url) return null;
  if (!preloadedBlobUrlMap.has(url)) return null;
  const blobUrl = preloadedBlobUrlMap.get(url);
  preloadedBlobUrlMap.delete(url);
  try {
    // Clear the preload element if it's using the consumed URL
    // We always clear to avoid keeping stale references
    if (preloadAudioElement && preloadAudioElement.src === blobUrl) {
      preloadAudioElement.removeAttribute('src');
      preloadAudioElement.load();
    }
  } catch {}
  return blobUrl || null;
}

async function prewarmAudioFromCache(url) {
  try {
    if (!url) return;
    if (!audioCache || typeof audioCache.isCached !== 'function' || typeof audioCache.get !== 'function') return;
    if (preloadedBlobUrlMap.has(url)) return;
    const cached = await audioCache.isCached(url);
    if (!cached) return;
    const result = await audioCache.get(url, false);
    if (!result || !result.blob || !result.blob.size) return;
    const blobUrl = URL.createObjectURL(result.blob);
    setPreloadedBlobUrl(url, blobUrl);

    const preloader = ensurePreloadAudioElement();
    if (preloader) {
      // Only update preload element if it's truly idle or empty
      // readyState 0 = HAVE_NOTHING (idle, safe to update)
      // readyState 1+ = has started loading (avoid interrupting)
      // Also update if src is empty/unset
      const isIdle = !preloader.src || preloader.src === '' || preloader.readyState === 0;
      if (isIdle) {
        preloader.src = blobUrl;
        preloader.load();
      }
    }
  } catch (err) {
    logPlayback('debug', 'Prewarm cache failed', err);
  }
}

// Update loader percentage when available; monotonic to avoid regressions
function updateLoaderProgress(value) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  const clamped = Math.max(0, Math.min(100, Math.round(numeric)));
  activeLoaderProgress = Math.max(activeLoaderProgress, clamped);
  if (window.Loaders && typeof window.Loaders.setProgress === 'function') {
    window.Loaders.setProgress(activeLoaderProgress);
  }
}

function resetLoaderProgress() {
  activeLoaderProgress = 0;
}

function isAllowedAudioUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(String(url), window.location.href);
    const p = (u.pathname || '').toLowerCase();
    return p.endsWith('.flac') || p.endsWith('.ogg') || p.endsWith('.mp3');
  } catch {
    return /\.(flac|ogg|mp3)(\?|#|$)/i.test(String(url || '').trim());
  }
}

// Load audio from cache or network
async function loadAudioWithCache(track) {
  if (!track || !track.url) {
    throw new Error('Audio URL not available');
  }

  // Only allow .flac, .ogg and .mp3 files.
  // NOTE: allow query strings/fragments (e.g. .mp3?download=1)
  if (!isAllowedAudioUrl(track.url)) {
    throw new Error('Only .flac, .ogg and .mp3 files are allowed');
  }

  try {
    updateLoaderProgress(10);

    // Fast path: consume any prewarmed blob URL
    const preloadedBlobUrl = consumePreloadedBlobUrl(track.url);
    if (preloadedBlobUrl) {
      logPlayback('info', `Playing from prewarmed cache: ${track.title || track.url}`);
      updateLoaderProgress(85);
      return preloadedBlobUrl;
    }

    // Intentar obtener de la caché primero
    const cacheResult = typeof audioCache !== 'undefined' && audioCache && typeof audioCache.get === 'function' ? await audioCache.get(track.url, true) : null;

    if (cacheResult && cacheResult.blob) {
      logPlayback('info', `Playing from cache: ${track.title || track.url}`);
      
      // Simulate smooth progress from cache hit (20→85%) with very short steps
      const cacheProgressStart = 20;
      const cacheProgressEnd = 85;
      const cacheSteps = 14;
      const cacheStepDuration = 25; // faster cadence for cache
      
      for (let i = 1; i <= cacheSteps; i++) {
        await new Promise(resolve => setTimeout(resolve, cacheStepDuration));
        const pct = cacheProgressStart + Math.round(((i / cacheSteps) * (cacheProgressEnd - cacheProgressStart)));
        updateLoaderProgress(pct);
      }
      
      if (cacheResult.blob.size > 0) {
        const blobUrl = URL.createObjectURL(cacheResult.blob);
        return blobUrl;
      }
      logPlayback('warn', 'Cached blob is empty, falling back to network');
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
          updateLoaderProgress(25);
        }
      } else if (headResponse.status === 405) {
        // Some hosts block HEAD; ignore
        logPlayback('debug', 'HEAD not allowed, falling back to GET for download');
      }
    } catch (headError) {
      logPlayback('warn', 'Could not determine file size, using blob download', headError);
    }

    // For large files, use direct streaming without downloading blob
    if (useDirectStreaming) {
      logPlayback('info', `Streaming large file directly: ${track.title || track.url}`);
      safeShowStatus('Streaming audio...', 'info');
      updateLoaderProgress(65);
      // Return direct URL for streaming
      return track.url;
    }

    // Load from network with progress proportional to bytes downloaded
    const startProgress = 25; // after artwork/state is ready
    const endProgress = 85;   // just before canplay (leave 85 to 100 for canplay)
    let lastProgress = 40; // start a bit higher to reduce initial stall
    updateLoaderProgress(lastProgress);

    let totalBytes = fileSize > 0 ? fileSize : 0;
    let fallbackTimer = null;
    let guardTimer = null;
    let hasReceivedProgress = false;

    const stopFallback = () => {
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
    };

    const nudgeProgress = (step = 2) => {
      lastProgress = Math.min(endProgress - 1, lastProgress + step);
      updateLoaderProgress(lastProgress);
      logPlayback('debug', `[Loader] nudge -> ${lastProgress}%`);
    };

    // Start fallback timer immediately if we don't know the total size
    if (!totalBytes) {
      logPlayback('debug', '[Loader] No total size from HEAD, starting fallback progress timer');
      fallbackTimer = setInterval(() => nudgeProgress(5), 180); // More aggressive
    }

    // Guard timer: if no onprogress yet, keep moving forward smoothly
    guardTimer = setInterval(() => {
      if (hasReceivedProgress || lastProgress >= endProgress - 2) {
        clearInterval(guardTimer);
        guardTimer = null;
        return;
      }
      nudgeProgress(3);
    }, 140);

    let blob;
    try {
      blob = await downloadBlobWithProgress(
        track.url,
        PLAYBACK_CONSTANTS.PREFETCH_TIMEOUT_MS,
        (loaded, total) => {
          hasReceivedProgress = true;
          logPlayback('debug', `[Loader] onprogress: loaded=${loaded}, total=${total}`);
          const hasTotal = (total || totalBytes);
          // Stop timers when real progress with total arrives
          if (hasTotal) {
            stopFallback();
            if (guardTimer) {
              clearInterval(guardTimer);
              guardTimer = null;
            }
          }

          const denom = total || totalBytes;
          if (denom) {
            const ratio = Math.min(1, loaded / denom);
            const pct = startProgress + Math.round(ratio * (endProgress - startProgress));
            lastProgress = pct;
            updateLoaderProgress(pct);
            logPlayback('debug', `[Loader] progress -> ${pct}% (${loaded}/${denom})`);
          }
        }
      );

      stopFallback();
      if (guardTimer) {
        clearInterval(guardTimer);
        guardTimer = null;
      }
      logPlayback('debug', `[Loader] Download complete. hasReceivedProgress=${hasReceivedProgress}, blob.size=${blob?.size}`);

      // If progress events lacked total but HEAD had it, push based on final size
      if (totalBytes && blob && blob.size) {
        const ratio = Math.min(1, blob.size / totalBytes);
        const pct = startProgress + Math.round(ratio * (endProgress - startProgress));
        lastProgress = pct;
        updateLoaderProgress(pct);
        logPlayback('debug', `[Loader] final progress -> ${pct}% based on blob.size`);
      } else {
        // Ensure we're at least at 85% before handing off to canplay
        lastProgress = Math.max(lastProgress, endProgress);
        updateLoaderProgress(lastProgress);
        logPlayback('debug', `[Loader] forced to endProgress (${endProgress}%)`);
      }
    } catch (xhrError) {
      stopFallback();
      logPlayback('debug', '[Loader] XHR failed, falling back to fetch', xhrError);
      // Fallback to fetch if XHR fails
      const response = await fetchWithTimeout(track.url, { timeout: PLAYBACK_CONSTANTS.PREFETCH_TIMEOUT_MS });
      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status}`);
      }
      updateLoaderProgress(60);
      blob = await response.blob();
      updateLoaderProgress(85);
    }

    stopFallback();
    if (guardTimer) {
      clearInterval(guardTimer);
      guardTimer = null;
    }

    // Save to cache for future use (background)
    const isResonte = isTrackResonteSafe(track);
    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.put === 'function') {
      const cacheResponse = new Response(blob);
      audioCache.put(track.url, cacheResponse, isResonte, {
        title: track.title || 'Untitled',
        creator: track.creator || 'Unknown',
        url: track.url
      }).catch(error => {
        logPlayback('warn', 'Error saving to cache', error);
      });
    }

    if (!blob || !blob.size) {
      if (state.networkOnline) {
        logPlayback('warn', 'Downloaded blob is empty, falling back to streaming URL');
        return track.url;
      }
      throw new Error('Downloaded blob is empty');
    }

    const blobUrl = URL.createObjectURL(blob);

    updateLoaderProgress(85);

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

function preloadNextTrack() {
  try {
    if (!state) return;
    if (typeof audioCache === 'undefined' || !audioCache || typeof audioCache.prefetchAudio !== 'function') return;

    // Ensure queue exists; when it's low/empty try to regenerate from the current context.
    try {
      if ((!state.playbackQueue || state.playbackQueue.length < 2) && state.currentTrack && state.currentTrack.url) {
        regenerateQueueFromCurrentContext(state.currentTrack.url);
      }
    } catch {
      // ignore
    }

    // Preload the next 2 tracks from the FIFO queue (works for shuffle too, because the FIFO is already shuffled).
    const queue = Array.isArray(state.playbackQueue) ? state.playbackQueue : [];
    const upcoming = queue.slice(0, 2).filter(t => t && t.url);
    for (const track of upcoming) {
      audioCache.prefetchAudio(track.url, false)
        .then(() => prewarmAudioFromCache(track.url))
        .catch((err) => logPlayback('debug', 'Failed to prefetch upcoming track', err));
    }

    // Also prefetch the immediate previous candidate (top of history) to make Prev feel instant.
    try {
      const history = Array.isArray(state.playbackHistory) ? state.playbackHistory : [];
      const prevCandidate = history.length > 0 ? history[history.length - 1] : null;
      if (prevCandidate && prevCandidate.url) {
        audioCache.prefetchAudio(prevCandidate.url, false)
          .then(() => prewarmAudioFromCache(prevCandidate.url))
          .catch((err) => logPlayback('debug', 'Failed to prefetch previous candidate', err));
      }
    } catch {
      // ignore
    }
  } catch (e) {
    // Never let prefetch break playback
  }
}

// ---- Resontes naming (backward compatible) ----
function getResontesList() {
  try {
    if (state && Array.isArray(state.resontes)) return state.resontes;
  } catch {}
  return Array.isArray(state && state.favorites) ? state.favorites : [];
}

function isTrackResonteSafe(track) {
  try {
    if (typeof window !== 'undefined' && typeof window.isTrackResonte === 'function') {
      return window.isTrackResonte(track);
    }
  } catch {}
  try {
    if (typeof isTrackFavorite === 'function') return isTrackFavorite(track);
  } catch {}
  return false;
}



// Play audio track with UI updates and state management
async function playAudioTrackOptimized(track, identifier, trackIndex = 0, totalTracks = 1, showProgress = true) {
  // Global loading lock: used by togglePlay/Next/Prev to avoid races.
  state.isLoading = true;

  // Show loader based on context - ONLY playback shows progress
  if (window.Loaders && typeof window.Loaders.showLoader === 'function') {
    window.Loaders.showLoader({ type: 'spinner', showProgress: showProgress, context: 'playback' });
    resetLoaderProgress();
    updateLoaderProgress(10);
  }

  // Kick off a short ramp so the UI doesn't sit at 10%
  let rampTimer = null;
  const startInitialRamp = () => {
    let rampValue = 10;
    rampTimer = setInterval(() => {
      // push up to 55% quickly to avoid visible freeze at 30%
      rampValue = Math.min(55, rampValue + 6);
      // stop ramping if actual progress already ahead
      if (activeLoaderProgress >= rampValue) {
        stopInitialRamp();
        return;
      }
      updateLoaderProgress(rampValue);
      if (rampValue >= 55) stopInitialRamp();
    }, 120);
  };
  const stopInitialRamp = () => {
    if (rampTimer) {
      clearInterval(rampTimer);
      rampTimer = null;
    }
  };
  if (showProgress) startInitialRamp();

  if (!track || !track.url) {
    if (window.Loaders && typeof window.Loaders.hideLoader === 'function') window.Loaders.hideLoader();
    state.isLoading = false;
    throw new Error('Track not available');
  }

  const elements = getElementsSafe();
  const audioEl = elements.audio;
  if (!audioEl) {
    if (window.Loaders && typeof window.Loaders.hideLoader === 'function') window.Loaders.hideLoader();
    state.isLoading = false;
    throw new Error('Audio element not available');
  }

  // If we have a track ready (even if autoplay might be blocked), allow the user to press Play.
  try {
    if (elements.playBtn) elements.playBtn.disabled = false;
  } catch {}

  audioEl.pause();
  audioEl.currentTime = 0;

  {
    const trackTitle = track.title || 'Untitled';
    const isAlbumTrack = totalTracks > 1;
    const albumTitle = (track.albumTitle || track.album || '').toString().trim();
    const titleText = (isAlbumTrack && albumTitle && albumTitle.toLowerCase() !== trackTitle.toLowerCase())
      ? `${albumTitle} — ${trackTitle}`
      : trackTitle;

    // Delegate rendering to the ticker helper (it manages the inner span wrapper).
    if (typeof window.updateTitleTicker === 'function') {
      window.updateTitleTicker(titleText);
    } else {
      window.elements.title.textContent = titleText;
    }
    window.elements.creator.textContent = isAlbumTrack
      ? `${track.creator || 'Unknown'} (${trackIndex + 1}/${totalTracks})`
      : (track.creator || 'Unknown');
  }

  // Mostrar/ocultar descripción usando UI avanzada
  // Mantener solo la descripción propia de la pista
  track.description = (typeof track.description === 'string' && track.description.trim() !== '')
    ? track.description
    : '';
  if (window.updateDescriptionUI) {
    window.updateDescriptionUI(track);
  }
  // Forzar actualización del botón Tracks si existe
  if (window.elements && window.elements.toggleTracksBtn && window.elements.tracksListContainer) {
    const albumId = track && (track.albumId || track.album_id || track.album_id_str || track.album_id_num || track.album_id_str_v2 || track.album_id_v2 || track.album_id_strict || track.album_id_fallback || track.album || track._albumId);
    window.elements.toggleTracksBtn.style.display = albumId ? 'inline-flex' : 'none';
    window.elements.toggleTracksBtn.disabled = !albumId;
    window.elements.tracksListContainer.style.display = 'none';
  }

  // Load artwork asynchronously (don't block playback)
  setArtwork(track, identifier).catch(err => {
    logPlayback('warn', 'Failed to set artwork', err);
  });
  updateLoaderProgress(20);

  state.currentTrack = {
    ...track,
    url: track.url,
    id: track.id || identifier,
    trackIndex: trackIndex,
    totalTracks: totalTracks,
    isAlbumTrack: totalTracks > 1,
    albumId: identifier
  };
  updateLoaderProgress(30);

  updateFavoriteButton();
  updateMediaSessionMetadata(track, identifier);

  try {
    if (window.CastManager && typeof window.CastManager.isSessionActive === 'function' && window.CastManager.isSessionActive()) {
      var castDuration = null;
      if (track && typeof track.duration === 'number' && isFinite(track.duration) && track.duration > 0) {
        castDuration = track.duration;
      } else if (audioEl && typeof audioEl.duration === 'number' && isFinite(audioEl.duration) && audioEl.duration > 0) {
        castDuration = audioEl.duration;
      }
      var castUrl = track.url || '';
      window.CastManager.loadMediaFromTrack(track, castUrl, 0, castDuration);
    }
  } catch {}

  // Update meta tags for rich previews
  if (typeof updateMetaTags === 'function') {
    updateMetaTags(track, identifier);
  }

  // Preload covers for upcoming tracks in background
  try {
    const context = playbackManager?.contextData?.album || playbackManager?.contextData?.favorites || playbackManager?.contextData?.search;
    if (context && context.items && context.items.length > 0) {
      const currentIdx = typeof context.currentIndex === 'number' ? context.currentIndex : trackIndex;
      preloadUpcomingCovers(context, currentIdx);
    }
  } catch (error) {
    logPlayback('warn', 'Failed to preload upcoming covers', error);
  }

  safeShowStatus('Getting your track ready to play', 'info');

  return new Promise((resolve, reject) => {
    const audio = audioEl;
    let timeoutId;

    const onCanPlay = () => {
      cleanup();
      // Hide loader when track is ready to play
      updateLoaderProgress(100);
      if (window.Loaders && typeof window.Loaders.hideLoader === 'function') window.Loaders.hideLoader();
      const castActive = (window.CastManager && typeof window.CastManager.isSessionActive === 'function')
        ? window.CastManager.isSessionActive()
        : false;
      if (castActive) {
        try { audio.pause(); } catch {}
        resolve(true);
        return;
      }

      audio.play().then(async () => {
        // Mark this track as consumed in the persistent shuffle deck (only once playback actually starts).
        try {
          if (state && state.shuffleFavorites) {
            const info = getActiveDeckContextInfo();
            if (info && Array.isArray(info.items) && info.items.length > 0 && state.currentTrack) {
              const playedKey = getItemKeyForDeck(info.contextType, info.contextType === 'search'
                ? { identifier: state.currentTrack.albumId || state.currentTrack.id }
                : { url: state.currentTrack.url });

              const { contextKey } = ensureShuffleDeck(info.contextType, info.items, {
                currentKey: playedKey,
                contextId: info.contextId
              });
              const consumed = shuffleDeckConsumeKey(contextKey, playedKey);

              // If we completed a full shuffle cycle and reshuffled, rebuild FIFO to avoid playing
              // stale queue entries from the previous cycle.
              if (consumed && consumed.wrapped) {
                try {
                  state.playbackQueue = [];
                  if (info.contextType === 'favorites' || info.contextType === 'album' || info.contextType === 'searchPlaylist') {
                    regenerateQueueFromCurrentContext(state && state.currentTrack ? state.currentTrack.url : undefined);
                  }
                } catch {}
              }
            }
          }
        } catch {}

        // Successful playback start: reset auto-skip budget for this context.
        try { resetAutoSkipBudgetForCurrentContext(); } catch {}

        // Acquire wake lock to prevent screen from turning off during playback
        if (window.wakeLockManager && window.wakeLockManager.isSupported) {
          window.wakeLockManager.acquire().catch(error => {
            logPlayback('debug', 'Failed to acquire wake lock', error);
          });
        }

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
            logPlayback('error', 'Error executing onplay callback', error);
          }
        }

        // Preload next 2 tracks (FIFO) + previous candidate (history)
        preloadNextTrack();

        state.isLoading = false;

        resolve(true);
      }).catch(error => {
        // Shared links: if autoplay is blocked, keep the track ready and show a CTA.
        if (isSharedLinkAutoplayAttempt() && isAutoplayBlockedError(error)) {
          try {
            if (elements.playBtn) elements.playBtn.textContent = '▶';
            if (elements.playBtn) elements.playBtn.disabled = false;
          } catch {}
          showAutoplayCta('Tap Play to start');
          state.isLoading = false;
          resolve(false);
          return;
        }

        // Handle playback error
        cleanup();
        state.isLoading = false;
        reject(error);
      });
    };

    const onError = (e) => {
      cleanup();
      if (window.Loaders && typeof window.Loaders.hideLoader === 'function') window.Loaders.hideLoader();
      const errMsg = (e && e.target && e.target.error && e.target.error.message) ? e.target.error.message : 'Source not supported';
      state.isLoading = false;
      reject(new Error(`Audio error: ${errMsg}`));
    };

    const cleanup = () => {
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('error', onError);
      clearTimeout(timeoutId);
      stopInitialRamp();
    };

    // Cargar audio con caché
    loadAudioWithCache(track)
      .then(audioUrl => {
        // Progress already advanced in loadAudioWithCache (20→85%)
        // Skip updating here to preserve cache progress
        updateLoaderProgress(85);
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
        audio.preload = 'auto';
        audio.load();
        updateLoaderProgress(88);

        timeoutId = setTimeout(() => {
          if (audio.readyState < 1) {
            cleanup();
            reject(new Error('Timeout while loading audio'));
          }
        }, PLAYBACK_CONSTANTS.AUDIO_LOAD_TIMEOUT_MS);

        audio.addEventListener('loadeddata', () => updateLoaderProgress(92), { once: true });
        audio.addEventListener('canplay', onCanPlay, { once: true });
        audio.addEventListener('error', onError, { once: true });
      })
      .catch(error => {
        if (window.Loaders && typeof window.Loaders.hideLoader === 'function') window.Loaders.hideLoader();
        cleanup();
        state.isLoading = false;
        reject(error);
      });
  });
}

// Playback control functions
function showManualSkipLoader() {
  try {
    if (!window.Loaders || typeof window.Loaders.showLoader !== 'function') return;
    // Manual Prev/Next should feel instant; show percent to indicate real work.
    window.Loaders.showLoader({ type: 'spinner', showProgress: true, progress: 0, context: 'playback' });

    // Best-effort: initialize progress if playback helpers are available.
    try {
      if (typeof resetLoaderProgress === 'function') resetLoaderProgress();
      if (typeof updateLoaderProgress === 'function') updateLoaderProgress(5);
    } catch {}
  } catch {
    // best-effort
  }
}

function scheduleHideManualSkipLoaderFallback(delayMs = 3000) {
  try {
    if (!window.Loaders || typeof window.Loaders.hideLoader !== 'function') return;

    window.setTimeout(() => {
      // If no load actually started, ensure the loader doesn't get stuck.
      try {
        if (!state || state.isLoading) return;
        window.Loaders.hideLoader();
      } catch {
        // best-effort
      }
    }, delayMs);
  } catch {
    // best-effort
  }
}

function playPrevious() {
  state.userInteracted = true;
  showStatus('Going back to previous track', 'info');
  if (state.isLoading) return;

  showManualSkipLoader();
  scheduleHideManualSkipLoaderFallback();

  playPreviousInContext().catch((err) => {
    logPlayback('warn', 'Manual Prev failed', err);
    try {
      if (window.Loaders && typeof window.Loaders.hideLoader === 'function') window.Loaders.hideLoader();
    } catch {}
  });
}

async function playNext() {
  state.userInteracted = true;
  showStatus('Skipping to next track now', 'info');

  if (state.isLoading) return;

  showManualSkipLoader();
  scheduleHideManualSkipLoaderFallback();

  // Keep manual Next consistent with auto-advance by using the enhanced handlers.
  try {
    const currentContext = playbackManager.getCurrentContext();
    const contextId = currentContext === 'album' ? playbackManager.getCurrentAlbumId() : null;
    if (currentContext) {
      enhancedPlaybackController.setContext(currentContext, contextId);
      await enhancedPlaybackController.handleTrackEnd();
      return;
    }
  } catch (err) {
    logPlayback('debug', 'Enhanced manual Next failed; falling back', err);
  }

  await playNextInContext();
}

async function resumeSavedPlayback() {
  const savedState = state.savedPlaybackState;
  if (!savedState) return;

  showStatus('Resuming playback...', 'info', null, 'normal', true);
  state.userInteracted = true;

  try {
    // Volume/mute should always come from persisted preferences (resonate_volume/resonate_muted).
    // Best-effort: apply preferences before resuming.
    try {
      if (typeof window.loadVolume === 'function') {
        window.loadVolume();
      }
    } catch {}

    showStatus(`Resuming from where you left off`, 'info');

    const trackForResume = {
      ...(savedState.track || {}),
      // Rehydrate descriptions for the Info modal.
      description: savedState.trackDescription || (savedState.track && savedState.track.description) || '',
      _albumDescription: savedState.itemDescription || (savedState.track && savedState.track._albumDescription) || '',
      // Ensure title is present even if the minimal snapshot lacked it.
      title: (savedState.trackTitle || (savedState.track && savedState.track.title) || 'Untitled')
    };

    // STRICT resume coherence: if snapshot doesn't match the track we are about to load, abort and clear.
    try {
      const savedTrackId = savedState && savedState.track ? savedState.track.id : null;
      const savedTrackUrl = savedState && savedState.trackUrlCanonical ? String(savedState.trackUrlCanonical) : '';
      const candidateUrl = trackForResume && trackForResume.url ? new URL(String(trackForResume.url), window.location.href).href : '';

      const idMismatch = savedTrackId && trackForResume && trackForResume.id && String(savedTrackId) !== String(trackForResume.id);
      const urlMismatch = savedTrackUrl && candidateUrl && savedTrackUrl !== candidateUrl;

      if (idMismatch || urlMismatch) {
        state.savedPlaybackState = null;
        try { localStorage.removeItem('resonate_playback_state'); } catch {}
        showStatus("Couldn't resume last track (stale state)", 'info', 3500);
        return;
      }
    } catch {
      // If strict validation fails unexpectedly, prefer safety: clear and abort.
      state.savedPlaybackState = null;
      try { localStorage.removeItem('resonate_playback_state'); } catch {}
      showStatus("Couldn't resume last track (stale state)", 'info', 3500);
      return;
    }

    // Play the track
    if (!isAllowedAudioUrl(trackForResume && trackForResume.url)) {
      try {
        const tryRecoverUrlFromList = (items) => {
          if (!Array.isArray(items) || !items.length) return '';
          const trackId = trackForResume && (trackForResume.id || trackForResume.trackId || trackForResume.albumId) ? String(trackForResume.id || trackForResume.trackId || trackForResume.albumId) : '';
          const trackIndex = (trackForResume && Number.isFinite(trackForResume.trackIndex)) ? Number(trackForResume.trackIndex) : -1;
          const trackTitle = trackForResume && trackForResume.title ? String(trackForResume.title) : '';
          const trackCreator = trackForResume && trackForResume.creator ? String(trackForResume.creator) : '';

          let match = null;
          if (trackId) {
            match = items.find(it => it && (String(it.id || it.trackId || '') === trackId));
          }
          if (!match && trackIndex >= 0) {
            match = items.find(it => it && Number(it.trackIndex) === trackIndex);
          }
          if (!match && trackIndex >= 0 && trackIndex < items.length) {
            match = items[trackIndex];
          }
          if (!match && trackTitle) {
            match = items.find(it => it && it.title && String(it.title) === trackTitle && (!trackCreator || String(it.creator || '') === trackCreator));
          }

          const candidateUrl = match && match.url ? String(match.url) : '';
          return isAllowedAudioUrl(candidateUrl) ? candidateUrl : '';
        };

        const savedItems = state && state.savedPlaybackTracklist && Array.isArray(state.savedPlaybackTracklist.items)
          ? state.savedPlaybackTracklist.items
          : [];
        const currentItems = state && Array.isArray(state.currentTracklist) ? state.currentTracklist : [];

        let recoveredUrl = tryRecoverUrlFromList(savedItems) || tryRecoverUrlFromList(currentItems);

        if (!recoveredUrl) {
          const albumId = trackForResume && (trackForResume.albumId || trackForResume.id) ? String(trackForResume.albumId || trackForResume.id) : '';
          if (albumId && typeof fetchOptimizedPlayableFiles === 'function') {
            const files = await fetchOptimizedPlayableFiles(albumId);
            if (Array.isArray(files) && files.length > 0) {
              const idx = (trackForResume && Number.isFinite(trackForResume.trackIndex))
                ? Math.min(Math.max(Number(trackForResume.trackIndex), 0), files.length - 1)
                : 0;
              const candidate = files[idx] || files[0];
              if (candidate && candidate.url && isAllowedAudioUrl(candidate.url)) {
                recoveredUrl = String(candidate.url);
                trackForResume.trackIndex = Number.isFinite(trackForResume.trackIndex) ? trackForResume.trackIndex : idx;
                trackForResume.totalTracks = Number.isFinite(trackForResume.totalTracks) ? trackForResume.totalTracks : files.length;
              }
            }
          }
        }

        if (recoveredUrl) {
          trackForResume.url = recoveredUrl;
        }
      } catch {}
    }

    if (!isAllowedAudioUrl(trackForResume && trackForResume.url)) {
      state.savedPlaybackState = null;
      try { localStorage.removeItem('resonate_playback_state'); } catch {}
      showStatus("Couldn't resume last track (unsupported file)", 'info', 3500);
      return;
    }
    await playAudioTrackOptimized(
      trackForResume,
      (trackForResume && trackForResume.id) ? trackForResume.id : (savedState.track && savedState.track.id),
      (trackForResume && typeof trackForResume.trackIndex === 'number') ? trackForResume.trackIndex : 0,
      (trackForResume && typeof trackForResume.totalTracks === 'number') ? trackForResume.totalTracks : 1
    );

    // Set the saved position (allow 0).
    try {
      const audio = window.elements && window.elements.audio ? window.elements.audio : null;
      const t = Number(savedState.currentTime);
      if (audio && Number.isFinite(t) && t >= 0) {
        const duration = Number(audio.duration);
        const target = Number.isFinite(duration) && duration > 0
          ? Math.min(Math.max(0, t), Math.max(0, duration - 0.25))
          : Math.max(0, t);
        audio.currentTime = target;
        updateProgressBar();
      }
    } catch {}

    // Clear the saved state since we resumed it
    state.savedPlaybackState = null;
    localStorage.removeItem('resonate_playback_state');

  } catch (error) {
    logPlayback('error', 'Error resuming saved playback', error);
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
      logPlayback('error', 'Error resuming track', error);
      forcePlay();
    });
    return;
  }

  // Prevenir reproducción si no hay favoritos y no hay audio cargado
  if (audio.paused && !audio.src && state.favorites.length === 0) {
    safeShowStatus('Add tracks to resonates to begin', 'info');
    return;
  }

  state.userInteracted = true;

  if (audio.paused) {
    if (!audio.src) {
      forcePlay();
      return;
    }

    audio.play().then(() => {
      if (elements.playBtn) elements.playBtn.textContent = '⏸';
      safeShowStatus('Music is playing now', 'info');

      // Update MediaSession playback state and position
      if (window.mediaSessionManager && window.mediaSessionManager.isSupported) {
        window.mediaSessionManager.updatePlaybackState('playing');
        // Battery-efficient: update position state only on state change
        if (typeof updateMediaPositionState === 'function') {
          updateMediaPositionState();
        }
      }

      // Acquire wake lock to prevent screen from turning off during playback
      if (window.wakeLockManager && window.wakeLockManager.isSupported) {
        window.wakeLockManager.acquire().catch(error => {
          logPlayback('debug', 'Failed to acquire wake lock', error);
        });
      }
    }).catch(error => {
      if (isAutoplayBlockedError(error)) {
        showAutoplayCta('Tap Play to start');
      } else {
        safeShowStatus('Playback encountered an error', 'error');
      }
      logPlayback('warn', 'Playback play() failed', error);
    });
  } else {
    audio.pause();
    if (elements.playBtn) elements.playBtn.textContent = '▶';
    safeShowStatus('Music is now paused', 'info');

    // Update MediaSession playback state and position
    if (window.mediaSessionManager && window.mediaSessionManager.isSupported) {
      window.mediaSessionManager.updatePlaybackState('paused');
      // Battery-efficient: update position state only on state change
      if (typeof updateMediaPositionState === 'function') {
        updateMediaPositionState();
      }
    }

    // Release wake lock when paused
    if (window.wakeLockManager && window.wakeLockManager.isSupported) {
      window.wakeLockManager.release().catch(error => {
        logPlayback('debug', 'Failed to release wake lock', error);
      });
    }
  }
}

function loadPlaybackQueue(context, items, startIndex = 0) {
  state.playbackQueue = [];

  if (!items || items.length === 0) {
    // No items to load into FIFO
    return;
  }

  let normalizedItems = items;
  try {
    if (window.TrackNormalizer && typeof window.TrackNormalizer.normalizeTrackList === 'function') {
      normalizedItems = window.TrackNormalizer.normalizeTrackList(items, {
        totalTracks: Array.isArray(items) ? items.length : 0
      });
    }
  } catch {}

  // Filter out items with invalid or undefined URLs.
  // NOTE: Do not require specific extensions here; archive.org URLs can include query strings
  // (e.g. .mp3?download=1) which would incorrectly fail an endsWith('.mp3') check.
  const validItems = normalizedItems.filter(item => item && item.url && typeof item.url === 'string' && !item.url.includes('/undefined') && item.url.trim() !== '');

  if (validItems.length === 0) {
    // No valid items to load into FIFO
    return;
  }

  // Unificar: para álbumes, favoritos, playlist y búsqueda, cargar toda la lista para reproducción continua
  const useFullList = context === 'favorites' || context === 'search' || context === 'album' || context === 'searchPlaylist';

  if (useFullList) {
    if (state.shuffleFavorites) {
      // Modo aleatorio: reproducir la lista en orden de "deck" persistente (sin repetición hasta agotar).
      const currentKey = (() => {
        if (context === 'search') {
          const id = state && state.currentTrack ? (state.currentTrack.albumId || state.currentTrack.id) : null;
          return id ? String(id) : '';
        }
        const url = state && state.currentTrack ? state.currentTrack.url : '';
        return url ? canonicalizeUrl(url) : '';
      })();

      const preferredNextKey = (!currentKey && Number.isFinite(startIndex) && startIndex > 0 && validItems[startIndex])
        ? getItemKeyForDeck(context, validItems[startIndex])
        : '';
      const contextId = context === 'album' && playbackManager && typeof playbackManager.getCurrentAlbumId === 'function'
        ? playbackManager.getCurrentAlbumId()
        : null;

      const { remainingItems } = shuffleDeckGetRemainingItems(context, validItems, {
        currentKey,
        preferredNextKey,
        contextId
      });
      state.playbackQueue = remainingItems.slice();
    } else {
      // Modo secuencial: reproducir toda la lista desde startIndex
      for (let i = 0; i < validItems.length; i++) {
        const index = (startIndex + i) % validItems.length;
        if (validItems[index]) state.playbackQueue.push(validItems[index]);
      }
    }
  } else {
    // Otros contextos: mantener comportamiento anterior (cola limitada)
    const queueSize = PLAYBACK_CONSTANTS.DEFAULT_QUEUE_SIZE;
    for (let i = 0; i < queueSize; i++) {
      const index = (startIndex + i) % validItems.length;
      if (validItems[index]) state.playbackQueue.push(validItems[index]);
    }
  }

  // Prefetch first (high priority) and second (low priority) items in the FIFO queue
  if (state.networkOnline && state.playbackQueue.length > 0) {
    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.prefetchAudio === 'function') {
      const first = state.playbackQueue[0];
      const second = state.playbackQueue.length > 1 ? state.playbackQueue[1] : null;
      if (first && first.url) {
        audioCache.prefetchAudio(first.url, true).catch((err) => logPlayback('debug', 'Failed to prefetch first queue item', err));
      }
      if (second && second.url) {
        audioCache.prefetchAudio(second.url, false).catch((err) => logPlayback('debug', 'Failed to prefetch second queue item', err));
      }
    }
  }
}

function regenerateQueueFromCurrentContext(currentTrackUrl) {
  const context = playbackManager.getCurrentContext();
  if (!context) return;

  let items = null;
  let queueContext = context;

  if (context === 'favorites') {
    items = Array.isArray(state.favorites) ? state.favorites : [];
  } else if (context === 'album') {
    const albumCtx = playbackManager.contextData.album;
    items = albumCtx && Array.isArray(albumCtx.items) ? albumCtx.items : [];
  } else if (context === 'searchPlaylist') {
    const playlistCtx = playbackManager.contextData.searchPlaylist;
    items = playlistCtx && Array.isArray(playlistCtx.items) ? playlistCtx.items : [];
  } else {
    // Search contexts don't have direct audio URLs for FIFO.
    return;
  }

  if (!items || items.length === 0) return;

  let startIndex = 0;
  if (currentTrackUrl) {
    const idx = items.findIndex(t => t && t.url && t.url === currentTrackUrl);
    if (idx >= 0) startIndex = (idx + 1) % items.length;
  }

  loadPlaybackQueue(queueContext, items, startIndex);
}

// Force playback by determining context and playing
function forcePlay() {
  if (!state.isInitialized) {
    state.isInitialized = true;
    showStatus('Resonate is waking up', 'info');
    window.elements.title.textContent = '';
    window.updateTitleTicker('');
    window.elements.creator.textContent = '';
  }

  state.userInteracted = true;

  // Clear previous playback state
  state.isLoading = false;
  state.playbackQueue = [];
  state.playbackHistory = [];

  const resontes = getResontesList();
  if (resontes.length > 0) {
    showStatus('Playing your resonates in order', 'info');
    playFromResontesQueue();
  } else {
    showStatus('Search to add your first resonate', 'info');
  }
}

// Preferred alias
async function playFromResontesQueue(specificTrack = null) {
  return playFromFavoritesQueue(specificTrack);
}

// FUNCIÓN: Reproducir desde cola FIFO de favoritos
async function playFromFavoritesQueue(specificTrack = null) {
  const resontes = getResontesList();
  const trackKeyFor = (track) => {
    try {
      if (window.TrackNormalizer && typeof window.TrackNormalizer.getTrackKey === 'function') {
        return window.TrackNormalizer.getTrackKey(track);
      }
    } catch {}
    return track && (track.trackId || track.url || track.id) ? String(track.trackId || track.url || track.id) : '';
  };

  let favoritesItems = Array.isArray(resontes) ? resontes : [];
  try {
    if (window.TrackNormalizer && typeof window.TrackNormalizer.normalizeTrackList === 'function') {
      favoritesItems = window.TrackNormalizer.normalizeTrackList(favoritesItems, {
        totalTracks: favoritesItems.length
      });
    }
  } catch {}

  // Si la lista de favoritos está vacía, sugerir acción al usuario
  if (state.isLoading || !Array.isArray(resontes) || resontes.length === 0) {
    logPlayback('debug', `playFromFavoritesQueue: Blocked (isLoading=${state.isLoading}, resontes=${resontes ? resontes.length : 0})`);
    safeShowStatus("No resonates to play. Add tracks to resonates to get started.", 'info', 4000);
    return;
  }

  // Detección de ciclo infinito con un solo favorito
  if (resontes.length === 1) {
    safeShowStatus('There is only 1 resonate in your list. Add more for continuous playback.', 'warning', 4000);
  }

  // Actualización automática de la cola si la lista de favoritos cambia
  if (!window._resontesListenerAttached && !window._favoritesListenerAttached) {
    window._resontesListenerAttached = true;
    window._favoritesListenerAttached = true;
    // Observa cambios en la lista de favoritos y actualiza la cola si es necesario
    const updateFavoritesQueue = () => {
      const list = getResontesList();
      if (Array.isArray(list) && list.length > 0) {
        // Si se está reproduciendo favoritos, recargar la cola
        if (state.isPlayingResontes || state.isPlayingFavorites) {
          logPlayback('info', 'Resontes list changed, updating playback queue');
          // Mantener el track actual si es posible
          const currentTrack = state.currentTrack;
          playFromFavoritesQueue(currentTrack || null);
        }
      }
    };
    if (window.addEventListener) {
      window.addEventListener('favoritesChanged', updateFavoritesQueue);
      window.addEventListener('resontesChanged', updateFavoritesQueue);
    }
    // Fallback: monkey patch push/splice para detectar cambios (si no hay eventos)
    if (Array.isArray(resontes)) {
      const origPush = resontes.push;
      resontes.push = function() { const r = origPush.apply(this, arguments); updateFavoritesQueue(); return r; };
      const origSplice = resontes.splice;
      resontes.splice = function() { const r = origSplice.apply(this, arguments); updateFavoritesQueue(); return r; };
    }
  }
  // Prefetch configurable: precargar varios favoritos si es posible
  const PREFETCH_COUNT = 3; // configurable
  if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.prefetchAudio === 'function') {
    const toPrefetch = favoritesItems.slice(0, PREFETCH_COUNT).filter(f => f && f.url);
    toPrefetch.forEach(fav => {
      audioCache.prefetchAudio(fav.url, true).catch((err) => logPlayback('debug', 'Failed to prefetch favorite', err));
    });
  }

  logPlayback('debug', `playFromFavoritesQueue: Starting (${specificTrack ? 'specific track' : 'queue'})`);
  
  // Ocultar listas al reproducir desde favoritos
  logPlayback('debug', 'Hiding search results and resontes list');
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

  state.isPlayingResontes = true;
  
  // Resetear contador de recarga al iniciar manualmente
  if (!state.contextReloadCount) state.contextReloadCount = {};
  state.contextReloadCount['favorites'] = 0;

  try {
    // Ensure favorites context is set for reliable auto-advance/looping
    if (!favoritesItems.length) {
      throw new Error('No resonates available');
    }

    // Si se proporcionó un track específico, usarlo directamente
    let track;
    if (specificTrack) {
      logPlayback('debug', `Using specific track: ${specificTrack.title || specificTrack.url || '[unknown]'}`);
      track = specificTrack;
      try {
        if (window.TrackNormalizer && typeof window.TrackNormalizer.normalizeTrack === 'function') {
          track = window.TrackNormalizer.normalizeTrack(track, {
            albumId: track.albumId || track.id,
            trackIndex: track.trackIndex,
            totalTracks: track.totalTracks
          });
        }
      } catch {}
      const trackKey = trackKeyFor(track);
      const idx = favoritesItems.findIndex(f => {
        const favKey = trackKeyFor(f);
        if (trackKey && favKey) return favKey === trackKey;
        return !!(f && track && f.url && track.url && f.url === track.url) || !!(f && track && f.id && track.id && f.id === track.id);
      });
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
        safeShowStatus('No playable resonates. Add more tracks to resonates.', 'info', 4000);
        throw new Error('Could not load playback queue');
      }

      // Remove track from queue before playing
      track = state.playbackQueue.shift();
    }

    if (!track.url) {
      safeShowStatus("Audio URL isn't available for this resonate. Try another track or re-add it.", 'error', 4000);
      throw new Error('Audio URL not available in resonate');
    }

    safeShowStatus('Getting next track from queue', 'info');
    // Sincronización visual: actualizar UI de favoritos si existe función
    if (typeof window.updateFavoritesListUI === 'function') {
      window.updateFavoritesListUI();
    }

    // Loader se ocultará cuando audio.play() inicie
    await playAudioTrackOptimized(track, track.id, track.trackIndex, track.totalTracks);

    updateShuffleButton();

  } catch (error) {
    logPlayback('error', 'Error in playFromFavoritesQueue', error);

    // Manejo de errores mejorado y sugerencias
    if (error.message.includes('Offline and audio not available in cache')) {
      safeShowStatus("This track isn't cached offline. Try reconnecting or add more resonates.", 'error', 3000);
      // Try next track in queue if available
      if (state.playbackQueue.length > 0) {
        scheduleAutoAdvance('favoritesqueue-offline-uncached', 2000, () => {
          playFromFavoritesQueue().catch((err) => logPlayback('warn', 'Retry playFromFavoritesQueue failed', err));
        });
        return;
      } else {
        safeShowStatus('All offline tracks have finished. Add more resonates or check your connection.', 'error', 4000);
      }
    } else {
      safeShowStatus('Something went wrong with playback. Try adding new resonates or refreshing the page.', 'error', 4000);
    }
    // Sincronización visual: actualizar UI de favoritos si existe función
    if (typeof window.updateFavoritesListUI === 'function') {
      window.updateFavoritesListUI();
    }
  }
}

// Configure preloaded playback list
function setupPreloadedPlayback(tracks, startIndex = 0) {
  if (!tracks || tracks.length === 0) return;

  // Crear una lista de reproducción precargada
  const preloadedPlaylist = tracks.map(track => ({
    ...track,
    id: track.id || `preloaded-${fnv1aHash(track && track.url ? canonicalizeUrl(track.url) : JSON.stringify(track || {})).slice(0, 12)}`
  }));

  // Configurar el contexto de reproducción precargado
  playbackManager.setContext('searchPlaylist', preloadedPlaylist, startIndex);
  state.autoPlaySearchResults = true;

  logPlayback('debug', `Preloaded list configured with ${preloadedPlaylist.length} tracks`);
}

async function playNextInContext(maxRetries = 3) {
  // PREVENT MULTIPLE EXECUTION
  if (state.isLoading) return;
  state.isLoading = true;

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
          logPlayback('error', 'Error playing album track', error);
          if (maxRetries > 0) {
            showStatus('Skipping this problematic track', 'error', 1500);
            const budget = tryConsumeAutoSkipBudget('album-track-error');
            if (!budget.allowed) {
              handleAutoSkipBudgetExhausted(budget.contextKey);
              return;
            }
            return playNextInContext(maxRetries - 1);
          }
          // Never stop; try again from next.
          scheduleAutoAdvance('album-track-error', 1000, () => {
            playNextInContext(3).catch((e) => logPlayback('warn', 'Auto-advance retry failed', e));
          });
          return;
        }
      }
      // If album context is empty/missing, fall through to other strategies.
    }

    // If user previously went backwards (Prev), honor the forward stack before drawing from FIFO/deck.
    if (Array.isArray(state.playbackForward) && state.playbackForward.length > 0) {
      const forwardTrack = state.playbackForward.pop();
      if (forwardTrack && forwardTrack.url) {
        if (state.currentTrack && state.currentTrack.url && state.currentTrack.url !== forwardTrack.url) {
          state.playbackHistory.push(state.currentTrack);
        }
        try {
          await playAudioTrackOptimized(forwardTrack, forwardTrack.id, forwardTrack.trackIndex, forwardTrack.totalTracks);
          return;
        } catch {
          // If forward item fails, keep going with normal selection.
        }
      }
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
          logPlayback('error', 'Error playing from FIFO queue', error);
          guard++;
          if (maxRetries > 0) {
            showStatus('Track issue detected, trying next', 'error', 1500);
            maxRetries--;
            const budget = tryConsumeAutoSkipBudget('fifo-track-error');
            if (!budget.allowed) {
              handleAutoSkipBudgetExhausted(budget.contextKey);
              return;
            }
            continue;
          }
          // Never stop; keep trying.
          continue;
        }
      }
    }

    // If FIFO is exhausted, regenerate it from the current context (loop).
    if (state.playbackQueue.length === 0) {
      regenerateQueueFromCurrentContext(currentTrackUrl);
    }

    // Retry FIFO playback after regeneration.
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
          logPlayback('error', 'Error playing from regenerated queue', error);
          guard++;
          if (maxRetries > 0) {
            showStatus('Track issue detected, trying next', 'error', 1500);
            maxRetries--;
            const budget = tryConsumeAutoSkipBudget('fifo-regenerated-track-error');
            if (!budget.allowed) {
              handleAutoSkipBudgetExhausted(budget.contextKey);
              return;
            }
            continue;
          }
          continue;
        }
      }
    }

    // No stop conditions: always continue by looping through context.

    const nextItem = playbackManager.getNextTrack();

    try {
      if (context === 'search') {
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
          logPlayback('error', 'Favorite without valid URL', nextItem);
          scheduleAutoAdvance('favorite-missing-url', 1000, () => {
            playNextInContext().catch((e) => logPlayback('warn', 'Retry after missing URL failed', e));
          });
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
          logPlayback('error', 'Empty audio URL in resonte', track);
          showStatus('Audio link isn\'t available', 'error', 2000);
          scheduleAutoAdvance('favorite-empty-url', 1000, () => {
            playNextInContext().catch((e) => logPlayback('warn', 'Retry after empty URL failed', e));
          });
          return;
        }

        // Verificar si está en caché antes de reproducir
        const cached = typeof audioCache !== 'undefined' && audioCache && typeof audioCache.get === 'function' ? await audioCache.get(track.url, true) : null;
        if (!cached && !state.networkOnline) {
          // Transparente: saltar sin mostrar error
          scheduleAutoAdvance('offline-uncached-favorite', 100, () => {
            playNextInContext().catch((e) => logPlayback('warn', 'Offline skip failed', e));
          });
          return;
        }

        await playAudioTrackOptimized(track, nextItem.id, nextItem.trackIndex, nextItem.totalTracks, true);
      } else if (context === 'searchPlaylist') {
        // Loop through the preloaded playlist context.
        await playAudioTrackOptimized(nextItem, nextItem.id, 0, 1, true);
      }

    } catch (error) {
      logPlayback('error', 'Error playing next track', error);

      // Transparente: siempre intentar la siguiente pista sin mostrar error
      scheduleAutoAdvance('play-next-error', 100, () => {
        playNextInContext().catch((e) => logPlayback('warn', 'Retry playNextInContext failed', e));
      });
    }
  } catch (error) {
    logPlayback('error', 'Critical error in playNextInContext', error);
  } finally {
    state.isLoading = false;
  }
}

async function playPreviousInContext() {
  // Usar historial para botón anterior
  if (state.playbackHistory.length > 0) {
    const previousTrack = state.playbackHistory.pop();

    // Support "Next after Prev" without corrupting the FIFO (especially in shuffle mode).
    if (!Array.isArray(state.playbackForward)) state.playbackForward = [];
    if (state.currentTrack) state.playbackForward.push(state.currentTrack);

    try {
      await playAudioTrackOptimized(previousTrack, previousTrack.id, previousTrack.trackIndex, previousTrack.totalTracks);
      return;
    } catch (error) {
      logPlayback('error', 'Error playing from history', error);
    }
  }

  const context = playbackManager.getCurrentContext();
  if (!context || !playbackManager.contextData[context].items.length) return;

  let ctx = playbackManager.contextData[context];

  // If shuffle is enabled, try to go back following the deck order.
  if (state.shuffleFavorites) {
    try {
      const currentKey = context === 'search'
        ? (state && state.currentTrack ? String(state.currentTrack.albumId || state.currentTrack.id || '') : '')
        : (state && state.currentTrack && state.currentTrack.url ? canonicalizeUrl(state.currentTrack.url) : '');
      const contextId = context === 'album' && typeof playbackManager.getCurrentAlbumId === 'function' ? playbackManager.getCurrentAlbumId() : null;

      const { deck } = ensureShuffleDeck(context, ctx.items, { currentKey, contextId });
      const order = Array.isArray(deck.order) ? deck.order : [];
      const pos = currentKey ? order.indexOf(currentKey) : -1;
      if (order.length > 0 && pos >= 0) {
        const prevKey = order[(pos - 1 + order.length) % order.length];
        const prevIdx = ctx.items.findIndex(it => getItemKeyForDeck(context, it) === prevKey);
        if (prevIdx >= 0) ctx.currentIndex = prevIdx;
      }
    } catch {
      // fallback to sequential index
    }
  } else {
    ctx.currentIndex = (ctx.currentIndex - 1 + ctx.items.length) % ctx.items.length;
  }

  const prevItem = ctx.items[ctx.currentIndex];

  if (!Array.isArray(state.playbackForward)) state.playbackForward = [];
  if (state.currentTrack) state.playbackForward.push(state.currentTrack);

  try {
    if (context === 'search') {
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
        logPlayback('error', 'Favorite without valid URL', prevItem);
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
        logPlayback('error', 'Error playing previous album track', error);
        // Try the fallback of going back further in the context
        setTimeout(() => playPreviousInContext(), 1000);
      }
    } else if (context === 'album') {
      try {
        await playAudioTrackOptimized(prevItem, playbackManager.getCurrentAlbumId(), ctx.currentIndex, ctx.items.length);
        return;
      } catch (error) {
        logPlayback('error', 'Error playing previous album track', error);
        setTimeout(() => playPreviousInContext(), 1000);
      }
    } else if (context === 'searchPlaylist') {
      // Reproducir desde la lista de búsqueda precargada
      await playAudioTrackOptimized(prevItem, prevItem.id, 0, 1);
    }
    
    // Try/catch global para la función completa
  } catch (error) {
    logPlayback('error', 'Error playing previous track', error);
    setTimeout(() => playPreviousInContext(), 1000);
  }
}

function updateProgressBar() {
  if (!state.isSeeking && window.elements.audio && window.elements.audio.duration && isFinite(window.elements.audio.duration)) {
    const progressPercent = (window.elements.audio.currentTime / window.elements.audio.duration) * 100;
    if (window.elements.progress) window.elements.progress.style.width = `${progressPercent}%`;
    if (window.elements.currentTime) window.elements.currentTime.textContent = formatTime(window.elements.audio.currentTime);
    if (window.elements.totalTime) window.elements.totalTime.textContent = formatTime(window.elements.audio.duration);
    
    // Update buffered visual
    updateBufferedProgress();
    
    // Update ARIA attributes
    if (window.elements.progressBar) {
      window.elements.progressBar.setAttribute('aria-valuenow', Math.round(progressPercent));
      window.elements.progressBar.setAttribute('aria-valuetext', 
        `${formatTime(window.elements.audio.currentTime)} de ${formatTime(window.elements.audio.duration)}`);
    }

    // Actualizar Media Session
    updateMediaPositionState();
  }
}

function updateBufferedProgress() {
  if (!window.elements.audio || !window.elements.progressBuffered) return;
  
  const buffered = window.elements.audio.buffered;
  const duration = window.elements.audio.duration;
  if (!duration || !isFinite(duration)) {
    window.elements.progressBuffered.style.width = '0%';
    return;
  }

  if (buffered.length > 0) {
    const bufferedEnd = buffered.end(buffered.length - 1);
    const bufferedPercent = (bufferedEnd / duration) * 100;
    window.elements.progressBuffered.style.width = `${bufferedPercent}%`;
    return;
  }

  // Reset when nothing is buffered yet (avoid stale UI from previous track)
  window.elements.progressBuffered.style.width = '0%';
}

// Buffering monitoring: show subtle loader during stalls and attempt soft recovery
function setupBufferingMonitoring() {
  if (!window.elements || !window.elements.audio) return;
  if (window._resonateBufferingHandlersInstalled) return;
  window._resonateBufferingHandlersInstalled = true;

  const audio = window.elements.audio;
  const BUFFERING_SHOW_DELAY_MS = 350;
  const BUFFERING_STALL_TIMEOUT_MS = 20000;
  const BUFFERING_RECOVERY_COOLDOWN_MS = 12000;

  let isBuffering = false;
  let showTimer = null;
  let stallTimer = null;
  let lastTimeUpdateAt = Date.now();
  let lastPosition = 0;
  let lastRecoveryAt = 0;

  const isLoadingNow = () => !!(window.state && window.state.isLoading);

  const clearTimers = () => {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  };

  const showBuffering = () => {
    if (isBuffering || isLoadingNow()) return;
    isBuffering = true;
    try {
      if (window.Loaders && typeof window.Loaders.showLoader === 'function') {
        window.Loaders.showLoader({ type: 'spinner', showProgress: false, context: 'buffering' });
      }
    } catch {}
  };

  const hideBuffering = () => {
    if (!isBuffering) return;
    isBuffering = false;
    if (isLoadingNow()) return;
    try {
      if (window.Loaders && typeof window.Loaders.hideLoader === 'function') {
        window.Loaders.hideLoader();
      }
    } catch {}
  };

  const attemptRecovery = () => {
    if (isLoadingNow()) return;
    if (audio.paused || audio.ended) return;
    const now = Date.now();
    if (now - lastRecoveryAt < BUFFERING_RECOVERY_COOLDOWN_MS) return;
    lastRecoveryAt = now;
    logPlayback('warn', 'Buffering stall detected; attempting recovery');
    try {
      const maybePromise = audio.play();
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {});
      }
    } catch {}
  };

  const scheduleShow = () => {
    if (showTimer) clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      if (isLoadingNow()) return;
      if (audio.paused || audio.ended) return;
      if (audio.readyState < 3) showBuffering();
    }, BUFFERING_SHOW_DELAY_MS);
  };

  const scheduleStallCheck = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      if (isLoadingNow()) return;
      if (audio.paused || audio.ended) return;
      const noProgress = (Date.now() - lastTimeUpdateAt) >= BUFFERING_STALL_TIMEOUT_MS;
      if (noProgress && audio.readyState < 3) {
        attemptRecovery();
      }
    }, BUFFERING_STALL_TIMEOUT_MS);
  };

  const onWaiting = () => {
    if (isLoadingNow()) return;
    scheduleShow();
    scheduleStallCheck();
  };

  const onStalled = () => {
    if (isLoadingNow()) return;
    scheduleShow();
    scheduleStallCheck();
  };

  const onTimeUpdate = () => {
    lastTimeUpdateAt = Date.now();
    if (audio.currentTime !== lastPosition) {
      lastPosition = audio.currentTime;
      hideBuffering();
    }
  };

  const onPlayable = () => {
    hideBuffering();
    clearTimers();
  };

  const onPause = () => {
    hideBuffering();
    clearTimers();
  };

  audio.addEventListener('waiting', onWaiting);
  audio.addEventListener('stalled', onStalled);
  audio.addEventListener('timeupdate', onTimeUpdate);
  audio.addEventListener('playing', onPlayable);
  audio.addEventListener('canplay', onPlayable);
  audio.addEventListener('canplaythrough', onPlayable);
  audio.addEventListener('seeked', onPlayable);
  audio.addEventListener('pause', onPause);
  audio.addEventListener('ended', onPause);
}

// Enhanced track listening statistics and playback control
function setupListenTracking() {
  if (!window.elements.audio) return;

  // Idempotent setup: initialization may call setupListenTracking once, but guards help avoid duplicates.
  if (window._resonateListenTrackingAttached) return;
  window._resonateListenTrackingAttached = true;
  window._resonatePlaybackAutoSkipEnabled = true;
  
  let endedHandlerExecuted = false;
  let errorHandlerExecuted = false;
  let isTransitioning = false;
  let transitionUnlockId = null;

  const scheduleTransitionUnlock = () => {
    if (transitionUnlockId) clearTimeout(transitionUnlockId);
    // If the next track never reaches 'play' (e.g. load/play failure),
    // release the transition lock so auto-advance can retry.
    transitionUnlockId = setTimeout(() => {
      isTransitioning = false;
      endedHandlerExecuted = false;
      errorHandlerExecuted = false;
    }, 8000);
  };

  window.elements.audio.addEventListener('play', () => {
    endedHandlerExecuted = false;
    errorHandlerExecuted = false;
    isTransitioning = false;
    if (transitionUnlockId) {
      clearTimeout(transitionUnlockId);
      transitionUnlockId = null;
    }
    if (state.currentTrack) {
      state.currentTrackListenStart = Date.now();
    }

    // New user/system playback started; restore auto-skip budget for this context.
    try { resetAutoSkipBudgetForCurrentContext(); } catch {}
  });

  window.elements.audio.addEventListener('ended', async () => {
    // PREVENIR EJECUCIÓN MÚLTIPLE
    if (endedHandlerExecuted || isTransitioning) {
      return;
    }
    endedHandlerExecuted = true;
    isTransitioning = true;

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
          if (isTrackResonteSafe(state.currentTrack) && typeof audioCache !== 'undefined' && audioCache && typeof audioCache.replaceFavoritesQueueItem === 'function') {
            await audioCache.replaceFavoritesQueueItem(state.currentTrack.url, null, getResontesList());
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
        // Only schedule unlock after successful handling
        scheduleTransitionUnlock();
      } catch (err) {
        logPlayback('warn', 'Enhanced track end handling failed', err);
        // Schedule unlock before fallback to prevent lock starvation
        scheduleTransitionUnlock();
        scheduleAutoAdvance('enhanced-ended-fallback', 500, () => {
          playNextInContext().catch((e) => logPlayback('warn', 'Fallback playNextInContext failed', e));
        });
      }
    } else {
      // Resonate UX: never stop when context is missing.
      playNextInContext().catch((e) => logPlayback('warn', 'No-context playNextInContext failed', e));
      // Schedule unlock for no-context case
      scheduleTransitionUnlock();
    }

    signalServiceWorkerSafeActivation();
  });

  // If a track errors and never reaches 'ended', skip forward to keep continuous playback.
  window.elements.audio.addEventListener('error', () => {
    if (errorHandlerExecuted || isTransitioning) return;
    errorHandlerExecuted = true;
    isTransitioning = true;

    try {
      showStatus('Track error. Skipping...', 'error', 2000);
    } catch {}

    scheduleAutoAdvance('audio-error', 800, () => {
      const currentContext = playbackManager.getCurrentContext();
      if (currentContext) {
        const contextId = currentContext === 'album' ? playbackManager.getCurrentAlbumId() : null;
        enhancedPlaybackController.setContext(currentContext, contextId);
        enhancedPlaybackController.handleTrackEnd().then(() => {
          // Schedule unlock after successful handling
          scheduleTransitionUnlock();
        }).catch((err) => {
          logPlayback('warn', 'Error-skip handler failed', err);
          // Schedule unlock before fallback
          scheduleTransitionUnlock();
          playNextInContext().catch((e) => logPlayback('warn', 'Fallback skip failed', e));
        });
      } else {
        playNextInContext().catch((e) => logPlayback('warn', 'Skip failed', e));
        // Schedule unlock for no-context case
        scheduleTransitionUnlock();
      }
    });
  });

  window.elements.audio.addEventListener('pause', () => {
    // When playback is idle, allow waiting SW to activate safely
    signalServiceWorkerSafeActivation();

    // Release wake lock when paused
    if (window.wakeLockManager && window.wakeLockManager.isSupported) {
      window.wakeLockManager.release().catch(error => {
        logPlayback('debug', 'Failed to release wake lock on pause', error);
      });
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

  const resolveProgressSection = () => {
    try {
      const els = window.elements || {};
      if (els.progressSection) return els.progressSection;
      const section = (els.progressBar && typeof els.progressBar.closest === 'function')
        ? els.progressBar.closest('.progress-section')
        : null;
      if (section) {
        els.progressSection = section;
        window.elements = els;
      }
      return section;
    } catch {
      return null;
    }
  };

  const tooltip = document.getElementById('progress-tooltip');
  let isDragging = false;

  // Dynamic offset calculation
  const getOffsets = () => {
    const currentTimeEl = window.elements.currentTime;
    const totalTimeEl = window.elements.totalTime;
    
    // Check if elements are visible (not display:none)
    const isCurrentTimeVisible = currentTimeEl && 
      window.getComputedStyle(currentTimeEl).display !== 'none' &&
      currentTimeEl.offsetWidth > 0;
    const isTotalTimeVisible = totalTimeEl && 
      window.getComputedStyle(totalTimeEl).display !== 'none' &&
      totalTimeEl.offsetWidth > 0;
    
    const offsetLeft = isCurrentTimeVisible ? currentTimeEl.offsetWidth + 8 : 0;
    const offsetRight = isTotalTimeVisible ? totalTimeEl.offsetWidth + 8 : 0;
    return { offsetLeft, offsetRight };
  };

  // Haptic feedback (mobile)
  const triggerHaptic = () => {
    if ('vibrate' in navigator) {
      navigator.vibrate(10); // Subtle 10ms vibration
    }
  };

  const startDrag = (e) => {
    if (!window.elements.audio || !window.elements.audio.duration || !isFinite(window.elements.audio.duration)) return;
    if (!window.elements.progressBar) return;

    isDragging = true;
    state.isSeeking = true;
    
    try {
      window.elements.progressBar.classList.add('dragging');
      const progressSection = resolveProgressSection();
      if (progressSection) progressSection.classList.add('dragging');
    } catch (err) {
      if (window.logger && typeof window.logger.error === 'function') window.logger.error(`Error adding dragging class: ${err.message}`, 'PLAYBACK');
    }

    triggerHaptic();
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
    const progressSection = resolveProgressSection();
    if (progressSection) progressSection.classList.remove('dragging');
    if (tooltip) {
      tooltip.style.opacity = '0';
      tooltip.style.visibility = 'hidden';
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

    // Calculate click position with dynamic offset compensation
    const { offsetLeft, offsetRight } = getOffsets();
    const effectiveWidth = progressBarRect.width - offsetLeft - offsetRight;

    const clickPosition = Math.max(0, Math.min(1, (clientX - (progressBarRect.left + offsetLeft)) / effectiveWidth));
    const seekTime = clickPosition * window.elements.audio.duration;

    // Update display
    window.elements.progress.style.width = `${clickPosition * 100}%`;
    window.elements.currentTime.textContent = formatTime(seekTime);

    // Update audio on both drag and click
    window.elements.audio.currentTime = seekTime;
    
    // Update ARIA
    window.elements.progressBar.setAttribute('aria-valuenow', Math.round(clickPosition * 100));
    window.elements.progressBar.setAttribute('aria-valuetext', 
      `${formatTime(seekTime)} de ${formatTime(window.elements.audio.duration)}`);
  };

  // Tooltip on hover/drag
  const showTooltip = (e) => {
    if (!tooltip || !window.elements.audio.duration || !isFinite(window.elements.audio.duration)) return;
    
    const progressBarRect = window.elements.progressBar.getBoundingClientRect();
    
    let clientX;
    if (e.type.includes('touch')) {
      if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
      } else {
        return;
      }
    } else {
      clientX = e.clientX;
    }
    
    const { offsetLeft, offsetRight } = getOffsets();
    const effectiveWidth = progressBarRect.width - offsetLeft - offsetRight;
    const hoverPosition = Math.max(0, Math.min(1, (clientX - (progressBarRect.left + offsetLeft)) / effectiveWidth));
    const hoverTime = hoverPosition * window.elements.audio.duration;
    
    tooltip.textContent = formatTime(hoverTime);
    tooltip.style.left = `${offsetLeft + (hoverPosition * effectiveWidth)}px`;
    tooltip.style.opacity = '1';
    tooltip.style.visibility = 'visible';
  };

  const hideTooltip = () => {
    if (tooltip && !isDragging) {
      tooltip.style.opacity = '0';
      tooltip.style.visibility = 'hidden';
    }
  };

  // Keyboard navigation
  window.elements.progressBar.addEventListener('keydown', (e) => {
    if (!window.elements.audio.duration || !isFinite(window.elements.audio.duration)) return;
    
    let seekDelta = 0;
    
    switch(e.key) {
      case 'ArrowLeft':
        seekDelta = -5; // 5 seconds back
        break;
      case 'ArrowRight':
        seekDelta = 5; // 5 seconds forward
        break;
      case 'Home':
        window.elements.audio.currentTime = 0;
        updateProgressBar();
        e.preventDefault();
        return;
      case 'End':
        window.elements.audio.currentTime = window.elements.audio.duration - 1;
        updateProgressBar();
        e.preventDefault();
        return;
      case 'PageUp':
        seekDelta = 10; // 10 seconds forward
        break;
      case 'PageDown':
        seekDelta = -10; // 10 seconds back
        break;
      default:
        return;
    }
    
    if (seekDelta !== 0) {
      const newTime = Math.max(0, Math.min(window.elements.audio.duration, 
        window.elements.audio.currentTime + seekDelta));
      window.elements.audio.currentTime = newTime;
      updateProgressBar();
      triggerHaptic();
      e.preventDefault();
    }
  });

  // Mouse events
  window.elements.progressBar.addEventListener('mousemove', showTooltip);
  window.elements.progressBar.addEventListener('mouseleave', hideTooltip);
  
  // Focus/blur for visual feedback
  window.elements.progressBar.addEventListener('focus', () => {
    window.elements.progressBar.classList.add('focused');
  });
  
  window.elements.progressBar.addEventListener('blur', () => {
    window.elements.progressBar.classList.remove('focused');
  });

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
        triggerHaptic();
        updateProgressOnDrag(e);
      }
    });
  }
}

function updateShuffleButton() {
  const ctx = playbackManager.getCurrentContext();
  let noun = ctx === 'search' ? 'search results' : ctx === 'searchPlaylist' ? 'playlist' : ctx === 'album' ? 'album' : 'favorites';

  if (!window.elements || !window.elements.shuffleFavoritesBtn) return;

  const resolveContextItems = () => {
    if (ctx === 'favorites') return Array.isArray(state.favorites) ? state.favorites : [];
    if (ctx === 'album') {
      const albumCtx = playbackManager && playbackManager.contextData ? playbackManager.contextData.album : null;
      return albumCtx && Array.isArray(albumCtx.items) ? albumCtx.items : [];
    }
    if (ctx === 'search') {
      const searchCtx = playbackManager && playbackManager.contextData ? playbackManager.contextData.search : null;
      return (searchCtx && Array.isArray(searchCtx.items) ? searchCtx.items : (Array.isArray(state.searchResults) ? state.searchResults : []));
    }
    if (ctx === 'searchPlaylist') {
      const playlistCtx = playbackManager && playbackManager.contextData ? playbackManager.contextData.searchPlaylist : null;
      return playlistCtx && Array.isArray(playlistCtx.items) ? playlistCtx.items : [];
    }
    return [];
  };

  const items = resolveContextItems();
  const canShuffle = Array.isArray(items) && items.length > 1;
  window.elements.shuffleFavoritesBtn.disabled = !canShuffle;

  if (state.shuffleFavorites) {
    window.elements.shuffleFavoritesBtn.classList.add('active');
    window.elements.shuffleFavoritesBtn.setAttribute('aria-label', `Disable shuffle playback of ${noun}`);
  } else {
    window.elements.shuffleFavoritesBtn.classList.remove('active');
    window.elements.shuffleFavoritesBtn.setAttribute('aria-label', canShuffle ? `Enable shuffle playback of ${noun}` : `Shuffle unavailable for ${noun}`);
  }
}

function toggleShuffleFavorites() {
  state.shuffleFavorites = !state.shuffleFavorites;

  if (playbackStateManager) {
    playbackStateManager.setShuffleMode(state.shuffleFavorites);
  }

  const context = playbackManager.getCurrentContext() || (state.favorites && state.favorites.length > 0 ? 'favorites' : 'search');

  // Any time we flip shuffle, clear the forward stack to avoid surprising jumps.
  state.playbackForward = [];

  const resolveContextItems = () => {
    if (context === 'favorites') return Array.isArray(state.favorites) ? state.favorites : [];
    if (context === 'album') {
      const albumCtx = playbackManager && playbackManager.contextData ? playbackManager.contextData.album : null;
      return albumCtx && Array.isArray(albumCtx.items) ? albumCtx.items : [];
    }
    if (context === 'search') {
      const searchCtx = playbackManager && playbackManager.contextData ? playbackManager.contextData.search : null;
      return (searchCtx && Array.isArray(searchCtx.items) ? searchCtx.items : (Array.isArray(state.searchResults) ? state.searchResults : []));
    }
    if (context === 'searchPlaylist') {
      const playlistCtx = playbackManager && playbackManager.contextData ? playbackManager.contextData.searchPlaylist : null;
      return playlistCtx && Array.isArray(playlistCtx.items) ? playlistCtx.items : [];
    }
    return [];
  };

  const items = resolveContextItems();
  const contextId = context === 'album' && typeof playbackManager.getCurrentAlbumId === 'function' ? playbackManager.getCurrentAlbumId() : null;
  const currentKey = (() => {
    if (!state || !state.currentTrack) return '';
    if (context === 'search') return String(state.currentTrack.albumId || state.currentTrack.id || '');
    return state.currentTrack.url ? canonicalizeUrl(state.currentTrack.url) : '';
  })();

  if (state.shuffleFavorites) {
    // Activar modo aleatorio
    showStatus('Shuffle mode is now on', 'info', 2000);

    // Anchor the persisted deck to the currently playing item (so Next is stable and has no repeats).
    try {
      if (items && items.length > 0) {
        ensureShuffleDeck(context, items, { currentKey, contextId, anchorCurrent: true });
      }
    } catch {}

    // Rebuild FIFO only for URL-based contexts.
    if ((context === 'favorites' || context === 'album' || context === 'searchPlaylist') && items.length > 0) {
      loadPlaybackQueue(context, items, 0);
      if (context === 'favorites' && typeof audioCache !== 'undefined' && audioCache && typeof audioCache.loadFavoritesQueue === 'function') {
        audioCache.loadFavoritesQueue(items, true);
      }
    }
  } else {
    // Desactivar modo aleatorio: volver a modo secuencial
    showStatus('Sequential mode. Shuffle is off', 'info', 2000);

    if ((context === 'favorites' || context === 'album' || context === 'searchPlaylist') && items.length > 0) {
      // Rebuild FIFO starting after the current track (avoid immediate duplicate).
      let startIndex = 0;
      if (currentKey) {
        const idx = items.findIndex(it => getItemKeyForDeck(context, it) === currentKey);
        if (idx >= 0) startIndex = (idx + 1) % items.length;
      }
      loadPlaybackQueue(context, items, startIndex);
    }
  }

  updateShuffleButton();
}

function setupMediaSession() {
  // Use the new MediaSessionManager
  if (!window.mediaSessionManager || !window.mediaSessionManager.isSupported) {
    logPlayback('info', 'MediaSession API not available in this environment');
    return;
  }

  try {
    // Setup action handlers using the new manager
    window.mediaSessionManager.setupActionHandlers({
      onPlay: () => {
        if (window.CastManager && typeof window.CastManager.isSessionActive === 'function' && window.CastManager.isSessionActive()) {
          if (typeof window.CastManager.togglePlayback === 'function') {
            window.CastManager.togglePlayback();
            return;
          }
        }
        togglePlay();
      },
      onPause: () => {
        if (window.CastManager && typeof window.CastManager.isSessionActive === 'function' && window.CastManager.isSessionActive()) {
          if (typeof window.CastManager.togglePlayback === 'function') {
            window.CastManager.togglePlayback();
            return;
          }
        }
        togglePlay();
      },
      onPreviousTrack: () => {
        if (window.CastManager && typeof window.CastManager.isSessionActive === 'function' && window.CastManager.isSessionActive()) {
          playPrevious();
          return;
        }
        playPrevious();
      },
      onNextTrack: () => {
        if (window.CastManager && typeof window.CastManager.isSessionActive === 'function' && window.CastManager.isSessionActive()) {
          playNext();
          return;
        }
        playNext();
      },
      onSeekBackward: (details) => {
        const skipTime = details.seekOffset || 10;
        if (window.CastManager && typeof window.CastManager.isSessionActive === 'function' && window.CastManager.isSessionActive()) {
          if (typeof window.CastManager.skipBy === 'function') {
            window.CastManager.skipBy(-skipTime);
            return;
          }
        }
        window.elements.audio.currentTime = Math.max(0, window.elements.audio.currentTime - skipTime);
      },
      onSeekForward: (details) => {
        const skipTime = details.seekOffset || 10;
        if (window.CastManager && typeof window.CastManager.isSessionActive === 'function' && window.CastManager.isSessionActive()) {
          if (typeof window.CastManager.skipBy === 'function') {
            window.CastManager.skipBy(skipTime);
            return;
          }
        }
        window.elements.audio.currentTime = Math.min(window.elements.audio.duration, window.elements.audio.currentTime + skipTime);
      },
      onSeekTo: (details) => {
        if (window.CastManager && typeof window.CastManager.isSessionActive === 'function' && window.CastManager.isSessionActive()) {
          if (typeof window.CastManager.seekTo === 'function') {
            window.CastManager.seekTo(details.seekTime);
            return;
          }
        }
        if (details.fastSeek && 'fastSeek' in window.elements.audio) {
          window.elements.audio.fastSeek(details.seekTime);
        } else {
          window.elements.audio.currentTime = details.seekTime;
        }
      },
      onStop: () => {
        // Stop handler - pause and reset position
        if (window.CastManager && typeof window.CastManager.isSessionActive === 'function' && window.CastManager.isSessionActive()) {
          if (typeof window.CastManager.togglePlayback === 'function') {
            window.CastManager.togglePlayback();
          }
        } else {
          const audio = getAudioEl();
          if (audio && !audio.paused) {
            audio.pause();
          }
        }
      }
    });

    logPlayback('info', 'MediaSession handlers setup successfully');
  } catch (error) {
    logPlayback('warn', 'Error setting up MediaSession handlers', error);
  }
}

async function playTrack(trackId) {
  if (window.Loaders && typeof window.Loaders.showLoader === 'function') {
    window.Loaders.showLoader({ type: 'spinner', showProgress: false, context: 'playback' });
  }
  try {
    const audioElement = getAudioEl();
    if (!audioElement) throw new Error('Audio element not found');

    const trackUrl = await fetchTrackUrl(trackId);
    audioElement.src = trackUrl;
    await audioElement.play();
  } catch (error) {
    logPlayback('error', 'Error during playback', error);
  } finally {
    if (window.Loaders && typeof window.Loaders.hideLoader === 'function') {
      window.Loaders.hideLoader();
    }
  }
}

// Expose for UI hints when status messages are disabled.
window.showAutoplayCta = showAutoplayCta;
