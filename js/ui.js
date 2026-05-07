// Hook global refresh after any album resonte change
try {
  if (typeof window.toggleAlbumResonte === 'function') {
    const originalToggleAlbumResonte = window.toggleAlbumResonte;
    window.toggleAlbumResonte = function(albumId) {
      const result = originalToggleAlbumResonte(albumId);
      try {
        if (typeof window.refreshAllResonteButtons === 'function') {
          window.refreshAllResonteButtons();
        }
      } catch {}
      return result;
    };
  }
} catch {}


window.RES_SPRITE_URL = window.RES_SPRITE_URL || '/icons/sprite.svg?v=2';

// --- Wake Lock y visibilidad para playback ---
let __resonateWakeLock = null;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      __resonateWakeLock = await navigator.wakeLock.request('screen');
      __resonateWakeLock.addEventListener('release', () => {
        __resonateWakeLock = null;
      });
    }
  } catch {}
}

function releaseWakeLock() {
  try {
    if (__resonateWakeLock) {
      __resonateWakeLock.release();
      __resonateWakeLock = null;
    }
  } catch {}
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    // Si el audio está pausado pero no por el usuario, y no ha terminado de cargar, reintentar carga
    try {
      const audio = window.elements && window.elements.audio;
      if (audio && audio.readyState < 3 && audio.src && !audio.ended && !audio.paused) {
        // Forzar recarga de la pista
        const src = audio.src;
        audio.load();
        audio.src = src;
        audio.play().catch(() => {});
      }
    } catch {}
  }
}

document.addEventListener('visibilitychange', handleVisibilityChange, false);

// Wake Lock: solicitar al iniciar playback, liberar al pausar

function setupWakeLockAndLoaderHandlers() {
  const audio = window.elements && window.elements.audio;
  if (!audio) return;
  audio.addEventListener('play', requestWakeLock);
  audio.addEventListener('pause', releaseWakeLock);
  audio.addEventListener('ended', releaseWakeLock);

  // --- Loader UX for playback ---
  // Show loader on loadstart/waiting, hide on play/canplay/playing/error/ended
  const showPlaybackLoader = () => {
    if (window.Loaders && typeof window.Loaders.showLoader === 'function') {
      window.Loaders.showLoader({ type: 'spinner', showProgress: true, context: 'playback' });
    }
  };
  const showBufferingLoader = () => {
    if (window.Loaders && typeof window.Loaders.showLoader === 'function') {
      window.Loaders.showLoader({ type: 'spinner', showProgress: true, context: 'buffering' });
    }
  };
  const hideLoader = () => {
    if (window.Loaders && typeof window.Loaders.hideLoader === 'function') {
      window.Loaders.hideLoader();
    }
  };
  audio.addEventListener('loadstart', showPlaybackLoader);
  audio.addEventListener('waiting', showBufferingLoader);
  audio.addEventListener('canplay', hideLoader);
  audio.addEventListener('play', hideLoader);
  audio.addEventListener('playing', hideLoader);
  audio.addEventListener('error', hideLoader);
  audio.addEventListener('ended', hideLoader);
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setupWakeLockAndLoaderHandlers();
} else {
  window.addEventListener('DOMContentLoaded', setupWakeLockAndLoaderHandlers);
}

// Refresca todos los iconos de resonte en todos los listados
window.resonateLogoSVG = `<svg class="resonate-icon" width="24" height="24" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><circle cx="256" cy="256" r="200" stroke="currentColor" stroke-width="32" fill="none"></circle><path d="M96 256 C140 256, 180 180, 220 180 C260 180, 300 332, 340 332 C380 332, 416 256, 416 256" stroke="currentColor" stroke-width="32" fill="none" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;

/**
 * Shared helper: update a resonate button's visual state.
 * @param {HTMLElement} btn   - the button element to update
 * @param {boolean}     active - whether the track is now in the resonates list
 * @param {object}      [opts]
 * @param {boolean}     [opts.animate=false] - trigger the pop animation on the icon
 */
function applyResonteButtonState(btn, active, { animate = false } = {}) {
  if (!btn) return;
  btn.classList.toggle('active', !!active);
  btn.innerHTML = window.resonateLogoSVG || '';
  const label = active ? 'Remove from resonates' : 'Add to resonates';
  btn.title = label;
  try { btn.setAttribute('aria-label', label); } catch {}
  if (animate) {
    btn.classList.remove('resonate-btn-pop');
    // Force reflow so the animation restarts if triggered twice quickly
    void btn.offsetWidth;
    btn.classList.add('resonate-btn-pop');
    btn.addEventListener('animationend', () => btn.classList.remove('resonate-btn-pop'), { once: true });
  }
}
window.applyResonteButtonState = applyResonteButtonState;

// Auto-collapse all expanded albums
window.collapseAllExpandedAlbums = function collapseAllExpandedAlbums() {
  try {
    if (!window.__resonateExpandedAlbums || window.__resonateExpandedAlbums.size === 0) return;
    
    window.__resonateExpandedAlbums.forEach(albumId => {
      const cards = document.querySelectorAll(`[data-album-id="${CSS.escape(albumId)}"]`);
      cards.forEach(card => {
        const tracksContainer = card.nextElementSibling;
        const expandBtn = card.querySelector('.card-btn.expand, .result-expand, button[aria-label*="Hide"]');
        
        if (tracksContainer && tracksContainer.classList.contains('tracks-container') && !tracksContainer.classList.contains('collapsing')) {
          // Collapse it
          if (expandBtn) {
            const icon = expandBtn.querySelector('.expand-icon');
            if (icon) icon.textContent = '▼';
            expandBtn.title = 'Show album tracks';
            expandBtn.setAttribute('aria-label', 'Show album tracks');
            expandBtn.setAttribute('aria-expanded', 'false');
            expandBtn.classList.remove('expanded');
          }
          tracksContainer.classList.add('collapsing');
          
          // Cancel any in-flight fetch
          if (typeof window.cancelTracklistFetch === 'function') {
            window.cancelTracklistFetch(albumId);
          }
        }
      });
    });
    
    // Clear the set
    window.__resonateExpandedAlbums.clear();
  } catch (e) {
    // Best effort
  }
};

window.refreshAllResonteButtons = function refreshAllResonteButtons() {
  // Tracklist V2
  document.querySelectorAll('.track-resonte, .tlv2-resonte').forEach(btn => {
    const row = btn.closest('.tlv2-row');
    if (!row) return;
    // Prefer stable identity via albumId + trackIndex when available.
    const ds = (btn && btn.dataset) ? btn.dataset : {};
    const dsAlbumId = ds.albumId ? String(ds.albumId) : '';
    const dsTrackIndex = ds.trackIndex ? String(ds.trackIndex) : '';

    // Otherwise fall back to URL.
    const url = ds.url ? String(ds.url) : '';
    const trackLike = url ? { url } : null;

    let isResonte = false;
    try {
      // 1) Best case: stable identity albumId + trackIndex
      if (dsAlbumId && dsTrackIndex && window.state && Array.isArray(window.state.favorites)) {
        const idx = parseInt(dsTrackIndex, 10);
        isResonte = window.state.favorites.some(f => String(f.albumId) === dsAlbumId && Number(f.trackIndex) === idx);

        // If ordering differs between render list and saved list, fall back to URL match.
        if (!isResonte && url) {
          isResonte = window.state.favorites.some(f => String(f.url) === url);
        }
      }

      // 2) URL-based match
      if (!isResonte && trackLike && typeof window.isTrackResonte === 'function') {
        isResonte = !!window.isTrackResonte(trackLike);
      } else if (!isResonte && trackLike && typeof window.isTrackFavorite === 'function') {
        isResonte = !!window.isTrackFavorite(trackLike);
      }

      // 3) Last resort: best-effort heuristic by title + track number
      if (!isResonte) {
        const trackTitle = row.querySelector('.tlv2-title')?.textContent;
        const trackNum = row.querySelector('.tlv2-number')?.textContent;
        let track = null;
        if (window.state && Array.isArray(window.state.currentTracklist)) {
          track = window.state.currentTracklist.find(t => t.title === trackTitle && String(t.trackNumber) === trackNum);
        }
        if (track) {
          isResonte = typeof window.isTrackResonte === 'function' ? !!window.isTrackResonte(track) : false;
        }
      }
    } catch {}
    applyResonteButtonState(btn, isResonte);
  });

  // Search results (cards)
  document.querySelectorAll('.card-btn.resonte, .card-btn.favorite').forEach(btn => {
    const card = btn.closest('.content-card');
    if (!card) return;
    const albumId = card.getAttribute('data-album-id');
    const isResonte = typeof window.isAlbumResonte === 'function'
      ? window.isAlbumResonte(albumId)
      : (typeof isAlbumInFavorites === 'function' ? isAlbumInFavorites(albumId) : false);
    applyResonteButtonState(btn, isResonte);
  });

  // Legacy search results
  document.querySelectorAll('.result-resonte, .result-favorite').forEach(btn => {
    const resultEl = btn.closest('.search-result');
    if (!resultEl) return;
    const albumId = resultEl.__resultData?.identifier || resultEl.getAttribute('data-album-id') || resultEl.querySelector('.result-info')?.textContent;
    const isResonte = typeof window.isAlbumResonte === 'function'
      ? window.isAlbumResonte(albumId)
      : (typeof isAlbumInFavorites === 'function' ? isAlbumInFavorites(albumId) : false);
    applyResonteButtonState(btn, isResonte);
  });
};

const elements = {
  // Core
  app: document.getElementById('app'),
  audio: document.getElementById('audio'),

  // Header / global controls
  themeToggle: document.getElementById('theme-toggle'),
  currentTrackCast: document.getElementById('current-track-cast'),
  currentTrackShare: document.getElementById('current-track-share'),

  // Search
  searchInput: document.getElementById('search-input'),
  searchClear: document.getElementById('search-clear'),
  searchResults: document.getElementById('search-results'),
  searchResultsHeader: document.getElementById('search-results-header'),
  searchResultsCount: document.getElementById('search-results-count'),
  searchResultsList: document.getElementById('search-results-list'),
  searchResultsClose: document.getElementById('search-results-close'),

  // Resontes panel
  headerResontesBtn: document.getElementById('header-resontes-btn'),
  headerResontesCount: document.getElementById('header-resontes-count'),
  resontesToggle: document.getElementById('resontes-toggle'),
  resontesCount: document.getElementById('resontes-count'),
  resontesList: document.getElementById('resontes-list'),
  resontesHeader: document.getElementById('resontes-header'),
  resontesCountLabel: document.getElementById('resontes-count-label'),
  resontesListContent: document.getElementById('resontes-list-content'),
  resontesFilter: document.getElementById('resontes-filter'),
  resontesClear: document.getElementById('resontes-clear'),
  resontesOfflineOnly: document.getElementById('resontes-offline-only'),
  resontesClose: document.getElementById('resontes-close'),
  preloadResontesToggle: document.getElementById('preload-resontes-toggle'),
  resontesTab: document.getElementById('resontes-tab'),

  // Player
  playerContent: document.getElementById('player-content'),
  art: document.getElementById('art'),
  title: document.getElementById('title'),
  creator: document.getElementById('creator'),
  progressBar: document.getElementById('progress-bar'),
  progress: document.getElementById('progress'),
  progressBuffered: document.getElementById('progress-buffered'),
  progressTooltip: document.getElementById('progress-tooltip'),
  currentTime: document.getElementById('current-time'),
  totalTime: document.getElementById('total-time'),
  playBtn: document.getElementById('play-btn'),
  prevBtn: document.getElementById('prev-btn'),
  nextBtn: document.getElementById('next-btn'),
  shuffleFavoritesBtn: document.getElementById('shuffle-favorites-btn'),
  favoriteBtn: document.getElementById('favorite-btn'),

  // Description / tracks UI
  descriptionContainer: document.getElementById('description-container'),
  toggleDescriptionBtn: document.getElementById('toggle-description-btn'),
  toggleTracksBtn: document.getElementById('toggle-tracks-btn'),
  tracksListContainer: document.getElementById('tracks-list-container'),
  descriptionModal: document.getElementById('description-modal'),
  closeDescriptionModal: document.getElementById('close-description-modal'),
  modalDescription: document.getElementById('modal-description'),

  // Misc
  startButton: document.getElementById('start-button'),

  // Playlists panel
  playlistsToggle: document.getElementById('playlists-toggle'),
  playlistsList: document.getElementById('playlists-list'),
  playlistsCloseBtn: document.getElementById('playlists-close-btn'),
  playlistsNewBtn: document.getElementById('playlists-new-btn'),
  playlistsImportBtn: document.getElementById('playlists-import-btn'),
  playlistsPanelBody: document.getElementById('playlists-panel-body'),
  playlistImportInput: document.getElementById('playlist-import-input')
};
window.elements = elements;

try {
  if (elements.currentTrackShare) {
    applyShareButtonState(elements.currentTrackShare);
  }
} catch {}

try {
  if (elements.currentTrackCast) {
    applyCastButtonState(elements.currentTrackCast);
  }
} catch {}

// Ensure shuffle button is wired (idempotent).
try {
  if (elements.shuffleFavoritesBtn && !elements.shuffleFavoritesBtn.dataset.resonateShuffleBound) {
    elements.shuffleFavoritesBtn.dataset.resonateShuffleBound = 'true';
    elements.shuffleFavoritesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Prefer the resontes alias, then fall back to favorites naming.
      const toggleFn =
        (typeof window.toggleShuffleResontes === 'function' && window.toggleShuffleResontes) ||
        (typeof window.toggleShuffleFavorites === 'function' && window.toggleShuffleFavorites) ||
        (typeof toggleShuffleFavorites === 'function' && toggleShuffleFavorites);

      if (typeof toggleFn === 'function') {
        toggleFn();
      }
    });
  }
} catch {}

// Back-compat DOM wiring: many older functions still reference "favorites*" elements.
// The UI is now rendered under "resontes-*" ids, so alias them here.
try {
  if (!elements.favoritesToggle) elements.favoritesToggle = elements.resontesToggle;
  if (!elements.favoritesCount) elements.favoritesCount = elements.resontesCount;
  if (!elements.favoritesList) elements.favoritesList = elements.resontesList;
  if (!elements.favoritesHeader) elements.favoritesHeader = elements.resontesHeader;
  if (!elements.favoritesCountLabel) elements.favoritesCountLabel = elements.resontesCountLabel;
  if (!elements.favoritesListContent) elements.favoritesListContent = elements.resontesListContent;
  if (!elements.favoritesFilter) elements.favoritesFilter = elements.resontesFilter;
  if (!elements.favoritesClear) elements.favoritesClear = elements.resontesClear;
  if (!elements.favoritesOfflineOnly) elements.favoritesOfflineOnly = elements.resontesOfflineOnly;
  if (!elements.favoritesClose) elements.favoritesClose = elements.resontesClose;
} catch {}

// Cleanup: remove legacy density preference (desktop is now always compact by default).
try { localStorage.removeItem('resonate_ui_density'); } catch {}

// ===== Offline index (real cache) =====
// Build an in-memory index so "offline only" filters are synchronous during render.
let offlineIndex = {
  builtAt: 0,
  building: null,
  urlSet: new Set(),
  albumIdSet: new Set(),
  trackIdSet: new Set()
};

function tryExtractArchiveIdentifierFromUrl(url) {
  try {
    if (!url) return '';
    const s = String(url);
    try {
      const u = new URL(s);
      const m = (u.pathname || '').match(/^\/download\/([^/]+)\//);
      if (m && m[1]) return decodeURIComponent(m[1]);
    } catch {
      const m = s.match(/\/download\/([^/]+)\//);
      if (m && m[1]) return decodeURIComponent(m[1]);

    }
  } catch (e) {}
  return '';
}

async function buildOfflineUrlSetFromCacheApi() {
  const cacheName = 'audio-cache-v1';
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const urls = new Set();
  for (const req of keys) {
    try {
      if (req && req.url) urls.add(String(req.url));
    } catch {}
  }
  return urls;
}

async function ensureOfflineIndexFresh({ force = false } = {}) {
  const TTL_MS = 30 * 1000; // fast refresh window; index is updated incrementally elsewhere when possible
  const now = Date.now();
  if (!force && offlineIndex.builtAt && (now - offlineIndex.builtAt) < TTL_MS) return offlineIndex;
  if (offlineIndex.building) return offlineIndex.building;

  offlineIndex.building = (async () => {
    let urlSet = new Set();
    try {
      urlSet = await buildOfflineUrlSetFromCacheApi();
    } catch {
      // Fallback: best-effort use IndexedDB metadata only
      try {
        const meta = await window.audioCache?.getAllMetadata?.();
        if (Array.isArray(meta)) {
          for (const m of meta) {
            if (m && m.url) urlSet.add(String(m.url));
          }
        }
      } catch {}
    }

    const albumIdSet = new Set();
    const trackIdSet = new Set();

    // Derive identifiers directly from cached URLs so search results can show Offline chips
    // even when metadata doesn't include albumId (e.g., cached singles).
    try {
      for (const url of urlSet) {
        const identifier = tryExtractArchiveIdentifierFromUrl(url);
        if (identifier) albumIdSet.add(String(identifier));
      }
    } catch {}

    try {
      const meta = await window.audioCache?.getAllMetadata?.();
      if (Array.isArray(meta)) {
        for (const m of meta) {
          if (!m || !m.url) continue;
          const url = String(m.url);
          if (!urlSet.has(url)) continue; // ensure "real cache" truth
          if (m.albumId) albumIdSet.add(String(m.albumId));
          if (m.trackId) trackIdSet.add(String(m.trackId));
        }
      }
    } catch {}

    offlineIndex = {
      builtAt: Date.now(),
      building: null,
      urlSet,
      albumIdSet,
      trackIdSet
    };

    return offlineIndex;
  })();

  return offlineIndex.building;
}

function isUrlOfflineAvailableSync(url) {
  try {
    if (!url) return false;
    return offlineIndex.urlSet.has(String(url));
  } catch {
    return false;
  }
}

function isAlbumOfflineAvailableSync(albumId) {
  try {
    if (!albumId) return false;
    return offlineIndex.albumIdSet.has(String(albumId));
  } catch {
    return false;
  }
}

function normalizeFilterText(value) {
  return (typeof value === 'string' ? value : '').trim().toLowerCase();
}

function getTextForSearchItem(item) {
  const title = (item && (item.title || item.albumTitle)) ? String(item.title || item.albumTitle) : '';
  const creator = (item && item.creator) ? String(item.creator) : '';
  return `${title} ${creator}`.toLowerCase();
}

function initializePanelToolbarsOnce() {
  if (window.__resonatePanelToolbarsBound) return;
  window.__resonatePanelToolbarsBound = true;

  // Search toolbar
  try {
    if (elements.searchResultsClose) {
      elements.searchResultsClose.addEventListener('click', () => {
        try { hideSearchResults(); } catch {}
      });
    }
  } catch {}
  
  // Search filters toolbar (chips)
  try {
    ensureSearchFilterDefaults();
    ensureSearchFiltersHeader();
  } catch {}
  // Favorites toolbar
  try {
    if (elements.resontesClose) {
      elements.resontesClose.addEventListener('click', () => {
        try { hideResontesList(); } catch {}
      });
    }

    if (elements.resontesFilter) {
      const input = elements.resontesFilter;
      const clearBtn = elements.resontesClear;
      const updateClearBtn = () => {
        if (!clearBtn) return;
        const hasValue = Boolean((input.value || '').trim());
        clearBtn.hidden = !hasValue;
        clearBtn.disabled = !hasValue;
      };
      input.addEventListener('input', (e) => {
        state.resontesUi = state.resontesUi || {};
        state.resontesUi.filterText = (e.target.value || '').trim();
        updateResontesList();
        updateClearBtn();
      });
      if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          input.value = '';
          state.resontesUi = state.resontesUi || {};
          state.resontesUi.filterText = '';
          updateResontesList();
          updateClearBtn();
          try { input.focus({ preventScroll: true }); } catch { try { input.focus(); } catch {} }
        });
      }
      updateClearBtn();
    }
  } catch {}
}

function ensureSearchFilterDefaults() {
  try {
    state.searchUi = state.searchUi || {};
    const cfg = window.SEARCH_FILTERS_CONFIG || {};
    if (!state.searchUi.mediatype) state.searchUi.mediatype = cfg.mediatypeDefault || 'audio';
    if (typeof state.searchUi.isSearching !== 'boolean') state.searchUi.isSearching = false;
    if (typeof state.searchUi.offlineOnly !== 'boolean') state.searchUi.offlineOnly = false;
    if (typeof state.searchUi.typeFilter !== 'string') state.searchUi.typeFilter = '';
    if (typeof state.searchUi.showingHistory !== 'boolean') state.searchUi.showingHistory = false;
  } catch {
    // ignore
  }
}

function runSearchWithCurrentFilters({ keepKeyboard = true } = {}) {
  try {
    // Prefer the current input value (what the user is actually typing) over
    // the last completed search query (which can be stale if the user typed
    // something new but hasn't pressed Enter yet).
    const inputValue = (elements.searchInput ? elements.searchInput.value : '') || '';
    const q = (String(inputValue).trim() || String(state.currentSearchQuery || '').trim());
    if (!q) return;

    // Keep state consistent with what we're about to fetch.
    state.currentSearchQuery = q;

    dispatchSearchWithFastPath(q, { keepKeyboard, addToHistory: false });
  } catch {
    // ignore
  }
}

function abortUiSearchControllers() {
  try {
    if (!state) return;
    const ctrls = state._uiSearchControllers;
    if (!ctrls) return;
    if (ctrls.fast) {
      try { ctrls.fast.abort(); } catch {}
    }
    if (ctrls.optimized) {
      try { ctrls.optimized.abort(); } catch {}
    }
  } catch {
    // ignore
  }
}

function dispatchSearchWithFastPath(queryAtDispatch, { keepKeyboard = true, addToHistory = true, showLoader = false } = {}) {
  try {
    const q = String(queryAtDispatch || '').trim();
    if (!q) return;

    state.currentSearchPage = 0;
    state.currentSearchQuery = q;
    state.currentSearchHasMore = false;
    state.currentSearchTotal = null;
    state.isLoadingMore = false;

    abortUiSearchControllers();
    state._uiSearchControllers = {
      fast: new AbortController(),
      optimized: new AbortController()
    };

    try { if (typeof window.abortAllSearchOperations === 'function') window.abortAllSearchOperations(); } catch {}

    // Analytics: track search event
    try {
      if (window.ResonateAnalytics && typeof window.ResonateAnalytics.trackSearch === 'function') {
        window.ResonateAnalytics.trackSearch(q);
      }
    } catch (_) {}

    state.searchRequestId = (state.searchRequestId || 0) + 1;
    const requestId = state.searchRequestId;
    try { markSearchPerfStart(q, requestId); } catch {}

    try {
      ensureSearchFilterDefaults();
      state.searchUi.isSearching = true;
      state.searchUi.isUpgrading = false;
      state.searchUi.showingHistory = false;
      ensureSearchFiltersHeader();
    } catch {}

    try { elements.searchResults?.classList?.add('active'); } catch {}
    state.searchActive = true;
    setSearchOpenState(true);
    scheduleSearchInsetsBurst();

    // Show skeleton loaders immediately for better UX
    showSearchSkeletons(8);

    if (!keepKeyboard) {
      try { elements.searchInput?.blur?.(); } catch {}
    }

    let displayedKind = null; // 'fast' | 'optimized'
    let historyAdded = false;

    const stillCurrent = () => {
      if ((state.searchRequestId || 0) !== requestId) return false;
      try {
        const inputNow = (elements.searchInput && elements.searchInput.value) ? elements.searchInput.value.trim() : '';
        if (inputNow && inputNow !== q) return false;
      } catch {}
      return true;
    };

    const maybeAddHistory = () => {
      if (!addToHistory) return;
      if (historyAdded) return;
      historyAdded = true;
      try { addToSearchHistory(q); } catch {}
    };

    const showResult = (result, kind) => {
      if (!stillCurrent()) return;
      if (!result) return;
      if (kind === 'fast' && displayedKind === 'optimized') return;
      if (kind === displayedKind) return;

      // Once something is visible, don't keep the UI locked as "searching".
      try {
        ensureSearchFilterDefaults();
        state.searchUi.isSearching = false;
        state.searchUi.isUpgrading = (kind === 'fast');
        ensureSearchFiltersHeader();
      } catch {}

      displaySearchResults(result, true);
      displayedKind = kind;

      if (kind === 'optimized') {
        try {
          state.searchUi.isUpgrading = false;
          ensureSearchFiltersHeader();
        } catch {}
      }
      maybeAddHistory();
    };

    const fastFn = (window.performFastSearch || null);
    const fastPromise = (typeof fastFn === 'function')
      ? fastFn(q, {
        signal: state._uiSearchControllers.fast.signal,
        rows: 6,
        timeout: 3500
      })
      : Promise.resolve(null);

    const optimizedFn = (window.performOptimizedSearch || performOptimizedSearch);
    const optimizedPromise = optimizedFn(q, 0, {
      signal: state._uiSearchControllers.optimized.signal,
      abortPrevious: false,
      showLoader: showLoader,
      activateUI: false,
      deferMetadata: true,
      enrichmentPriority: 'idle'
    });

    fastPromise.then((fastResult) => {
      if (!fastResult) return;
      showResult(fastResult, 'fast');
    }).catch(() => {
      // Best-effort; ignore fast failures.
    });

    optimizedPromise.then((optResult) => {
      if (!optResult) return;
      showResult(optResult, 'optimized');
    }).catch((error) => {
      window.logger?.error({ message: 'Search error', error }, 'NETWORK');
      if (stillCurrent() && displayedKind == null) {
        try { showStatus('Search encountered an error', 'error'); } catch {}
      }
    }).finally(() => {
      try {
        if ((state.searchRequestId || 0) === requestId) {
          ensureSearchFilterDefaults();
          state.searchUi.isSearching = false;
          state.searchUi.isUpgrading = false;
          ensureSearchFiltersHeader();
        }
      } catch {}
    });
  } catch {
    // ignore
  }
}

function ensureSearchFiltersHeader() {
  try {
    if (!elements.searchResultsHeader) return;
    ensureSearchFilterDefaults();

    const ui = state.searchUi || {};
    const isSearching = !!ui.isSearching;

    try {
      elements.searchResultsHeader.dataset.filtersBusy = isSearching ? 'true' : 'false';
      elements.searchResultsHeader.setAttribute('aria-busy', isSearching ? 'true' : 'false');
    } catch {}

    // Render local (client-side) type filters for the current loaded results.
    // Use the dedicated filter-pills container for unified styling.
    try {
      // Try to use the new dedicated filter pills container
      let host = document.getElementById('search-type-filters');
      
      // Fallback to original location for backward compatibility
      if (!host) {
        const summary = elements.searchResultsHeader.querySelector('.search-results-summary');
        if (summary) {
          host = summary.querySelector('.search-filter-summary');
          if (!host) {
            host = document.createElement('div');
            host.className = 'filter-pills';
            host.setAttribute('role', 'group');
            host.setAttribute('aria-label', 'Search filters');
            summary.appendChild(host);
          }
        }
      }
      
      if (host) {
        const showingHistory = !!(state.searchUi && state.searchUi.showingHistory);
        if (showingHistory) {
          host.hidden = true;
        } else {
          host.hidden = false;

          const active = (state.searchUi && typeof state.searchUi.typeFilter === 'string') ? state.searchUi.typeFilter : '';
          const defs = [
            { id: '', label: 'All' },
            { id: 'single', label: 'Single' },
            { id: 'album', label: 'Album' }
          ];

          host.innerHTML = defs.map(d => {
            const isActive = d.id === active || (!d.id && !active);
            const pressed = isActive ? 'true' : 'false';
            const cls = `filter-pill${isActive ? ' active' : ''}`;
            return `<button type="button" class="${cls}" data-type-filter="${escapeHtml(d.id)}" aria-pressed="${pressed}">${escapeHtml(d.label)}</button>`;
          }).join('');

          if (!host.dataset.bound) {
            host.dataset.bound = 'true';
            host.addEventListener('click', (e) => {
              const btn = e && e.target ? e.target.closest('button[data-type-filter]') : null;
              if (!btn) return;
              try { e.preventDefault(); e.stopPropagation(); } catch {}
              const next = String(btn.getAttribute('data-type-filter') || '').trim();
              ensureSearchFilterDefaults();
              state.searchUi.typeFilter = next;
              try { ensureSearchFiltersHeader(); } catch {}
              rerenderSearchResultsFromState(true);
            });
          }
        }
      }
    } catch {}

    // Clean up any older expanded filters container if present.
    try {
      const old = elements.searchResultsHeader.querySelector('.search-filters');
      if (old && old.parentNode) old.parentNode.removeChild(old);
    } catch {}
  } catch {
    // ignore
  }
}

function isTypingContext() {
  try {
    const el = document.activeElement;
    if (!el) return false;
    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    return false;
  } catch {
    return false;
  }
}

function initializeDesktopShortcutsOnce() {
  if (window.__resonateDesktopShortcutsBound) return;
  window.__resonateDesktopShortcutsBound = true;

  document.addEventListener('keydown', (e) => {
    try {
      if (!e || e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // ESC closes the active overlay panel
      if (e.key === 'Escape') {
        if (state.searchActive) {
          e.preventDefault();
          hideSearchResults();
          return;
        }
        if (elements.resontesList && elements.resontesList.classList.contains('active')) {
          e.preventDefault();
          hideResontesList();
          return;
        }
        return;
      }

      // Don't steal shortcuts while typing
      if (isTypingContext()) return;

      // '/' focuses search
      if (e.key === '/') {
        e.preventDefault();
        elements.searchInput?.focus?.();
        try { scheduleSearchInsetsBurst(); } catch {}
        return;
      }

      // 'f' toggles favorites drawer
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        try {
          const inst = (typeof window.ensureFavoritesToggleInitialized === 'function')
            ? window.ensureFavoritesToggleInitialized()
            : null;
          if (inst && typeof inst.toggle === 'function') {
            inst.toggle();
          } else {
            // Fallback legacy toggle
            if (typeof window.toggleFavoritesList === 'function') window.toggleFavoritesList();
          }
        } catch {}
      }
    } catch {
      // ignore
    }
  });
}

function setBodyUiState(className, enabled) {
  try {
    document.body.classList.toggle(className, Boolean(enabled));
  } catch {
    // ignore
  }
}

function setSearchOpenState(isOpen) {
  setBodyUiState('search-open', isOpen);
}

function setKeyboardOpenState(isOpen) {
  setBodyUiState('keyboard-open', isOpen);
}

function scheduleSearchInsetsBurst() {
  // Some mobile browsers report the final keyboard/viewport size slightly after focus.
  // Burst a few updates to keep the panel visible above the keyboard.
  try {
    // Keep CSS viewport vars and panel insets in sync.
    if (typeof window.requestViewportUpdate === 'function') {
      window.requestViewportUpdate();
    }
  } catch {}

  try {
    requestAnimationFrame(setSearchPanelInsets);
  } catch {}

  try {
    setTimeout(() => {
      try { setSearchPanelInsets(); } catch {}
    }, 120);
    setTimeout(() => {
      try { setSearchPanelInsets(); } catch {}
    }, 420);
  } catch {
    // ignore
  }
}

function getViewportMetrics() {
  try {
    const vv = window.visualViewport;
    const vpTop = (vv && Number.isFinite(vv.offsetTop)) ? vv.offsetTop : 0;
    const vpHeight = Math.max(0, Math.round((vv && vv.height) || window.innerHeight || 0));
    const layoutHeight = Math.max(0, Math.round(window.innerHeight || 0));
    const bottomInset = vv
      ? Math.max(0, Math.round(layoutHeight - (((Number.isFinite(vv.height) ? vv.height : 0) + (Number.isFinite(vv.offsetTop) ? vv.offsetTop : 0)))))
      : 0;
    return { vv, vpTop, vpHeight, layoutHeight, bottomInset };
  } catch {
    return { vv: null, vpTop: 0, vpHeight: Math.max(0, Math.round(window.innerHeight || 0)), layoutHeight: Math.max(0, Math.round(window.innerHeight || 0)), bottomInset: 0 };
  }
}

function computeOverlayInsets({
  inputEl,
  anchorEl,
  metrics,
  gapPx = 10,
  minPanelHeight = null
}) {
  const m = metrics || getViewportMetrics();
  const { vpTop, vpHeight } = m;
  if (!vpHeight || !inputEl || !anchorEl) return null;

  const inputRect = inputEl.getBoundingClientRect();
  // Prefer visual-viewport coordinates, but fall back if a browser reports a
  // weird visualViewport offsetTop (which can cause the overlay to jump over the input).
  let inputBottomVp = inputRect.bottom - vpTop;
  if (!Number.isFinite(inputBottomVp) || inputBottomVp < 20) {
    inputBottomVp = inputRect.bottom;
  }
  inputBottomVp = Math.max(0, inputBottomVp);

  const footerRect = (anchorEl && anchorEl.classList && anchorEl.classList.contains('footer'))
    ? anchorEl.getBoundingClientRect()
    : null;
  const footerHeight = footerRect
    ? Math.max(0, footerRect.height)
    : Math.max(0, (anchorEl && anchorEl.offsetHeight) || 0);

  const anchorRect = anchorEl.getBoundingClientRect();
  let anchorTopVp = anchorRect.top - vpTop;

  // When using a sticky footer, its rect can be reported in odd coordinates in some mobile/PWA layouts.
  if (footerRect) {
    const footerStartFallback = vpHeight - footerHeight;
    const plausibleMin = Math.max(0, footerStartFallback - 120);
    const plausibleMax = vpHeight + 50;

    if (!Number.isFinite(anchorTopVp) || anchorTopVp < plausibleMin || anchorTopVp > plausibleMax) {
      anchorTopVp = footerStartFallback;
    }

    if (Number.isFinite(anchorTopVp) && anchorTopVp < vpHeight * 0.5) {
      anchorTopVp = footerStartFallback;
    }
  }

  // Keep measurements inside the visible viewport.
  if (!Number.isFinite(anchorTopVp)) anchorTopVp = vpHeight;
  anchorTopVp = Math.max(0, Math.min(anchorTopVp, vpHeight));

  const requiredBottomPx = Math.max(0, Math.round(vpHeight - anchorTopVp + gapPx));
  let bottomPx = Math.min(requiredBottomPx, vpHeight);

  const minHeight = minPanelHeight == null
    ? Math.max(220, Math.round(vpHeight * 0.45))
    : Math.max(0, Math.round(minPanelHeight));

  const maxTopPx = Math.max(0, vpHeight - bottomPx);
  const minTopFromInput = Math.max(0, Math.round(inputBottomVp + gapPx));
  let topPx = Math.max(0, Math.min(minTopFromInput, maxTopPx));

  const available = vpHeight - topPx - bottomPx;
  if (available < minHeight) {
    const maxTopForMin = Math.max(0, vpHeight - bottomPx - minHeight);
    topPx = Math.min(topPx, maxTopForMin);
  }

  // Never let the panel cover the search input when there is room.
  topPx = Math.max(topPx, Math.min(minTopFromInput, maxTopPx));

  return { topPx, bottomPx };
}

function applyOverlayInsetVars({ cssTopVar, cssBottomVar, insets }) {
  try {
    if (!insets) return;
    document.documentElement.style.setProperty(cssTopVar, `${insets.topPx}px`);
    document.documentElement.style.setProperty(cssBottomVar, `${insets.bottomPx}px`);
  } catch {
    // ignore
  }
}

function setFavoritesPanelInsets(metricsOverride = null) {
  try {
    // Favorites is now embedded (in-flow), not a fixed overlay.
    // Keep this function for backwards compatibility, but don't compute overlay insets.
    if (document.body && document.body.classList && document.body.classList.contains('favorites-embedded-open')) {
      return;
    }

    const favoritesList = elements.favoritesList;
    if (!favoritesList || !favoritesList.classList.contains('active')) return;

    const searchInput = elements.searchInput;
    const footer = document.querySelector('.footer');
    const playerSection = document.querySelector('.main-player-section');
    if (!searchInput || !(footer || playerSection)) return;

    const metrics = metricsOverride || getViewportMetrics();
    const anchorEl = footer || playerSection;
    // Favorites should not overlap the search input; keep a smaller minimum height
    // so the algorithm doesn't pull the top upward over the input.
    const insets = computeOverlayInsets({ inputEl: searchInput, anchorEl, metrics, gapPx: 10, minPanelHeight: 160 });
    applyOverlayInsetVars({
      cssTopVar: '--favorites-panel-top',
      cssBottomVar: '--favorites-panel-bottom',
      insets
    });
  } catch {
    // ignore
  }
}

function setSearchPanelInsets(metricsOverride = null) {
  try {
    const searchResults = elements.searchResults;
    if (!searchResults || !searchResults.classList.contains('active')) return;

    const searchInput = elements.searchInput;
    const footer = document.querySelector('.footer');
    const playerSection = document.querySelector('.main-player-section');
    if (!searchInput || !(footer || playerSection)) return;

    const metrics = metricsOverride || getViewportMetrics();
    const anchorEl = footer || playerSection;
    const insets = computeOverlayInsets({ inputEl: searchInput, anchorEl, metrics, gapPx: 10 });
    applyOverlayInsetVars({
      cssTopVar: '--search-panel-top',
      cssBottomVar: '--search-panel-bottom',
      insets
    });
  } catch {
    // ignore
  }
}

function setResontesPanelInsets(metricsOverride = null) {
  try {
    const resontesList = elements.resontesList;
    if (!resontesList || !resontesList.classList.contains('active')) return;

    const header = document.querySelector('header');
    const footer = document.querySelector('.footer');
    const playerSection = document.querySelector('.main-player-section');
    if (!header || !(footer || playerSection)) return;

    const metrics = metricsOverride || getViewportMetrics();
    const anchorEl = footer || playerSection;
    const insets = computeOverlayInsets({ inputEl: header, anchorEl, metrics, gapPx: 10 });
    applyOverlayInsetVars({
      cssTopVar: '--resontes-panel-top',
      cssBottomVar: '--resontes-panel-bottom',
      insets
    });
  } catch {
    // ignore
  }
}

function setTracksPanelInsets(metricsOverride = null) {
  try {
    const tracksEl = elements.tracksListContainer;
    if (!tracksEl) return;
    if (!(document.body && document.body.classList && document.body.classList.contains('tracks-open'))) return;

    const header = document.querySelector('header');
    const footer = document.querySelector('.footer');
    const playerSection = document.querySelector('.main-player-section');
    if (!header || !(footer || playerSection)) return;

    const metrics = metricsOverride || getViewportMetrics();
    const safeTop = Number.isFinite(metrics?.vpTop) ? metrics.vpTop : 0;
    const safeBottom = Number.isFinite(metrics?.bottomInset) ? metrics.bottomInset : 0;

    const headerRect = header.getBoundingClientRect();
    const footerRect = footer ? footer.getBoundingClientRect() : null;
    const headerHeight = Math.max(0, Math.round((headerRect && headerRect.height) || header.offsetHeight || 0));
    const footerHeight = Math.max(0, Math.round((footerRect && footerRect.height) || (footer && footer.offsetHeight) || 0));

    const topPx = Math.max(0, Math.round(headerHeight + safeTop + 8));
    const bottomPx = Math.max(0, Math.round(footerHeight + safeBottom + 8));

    try {
      document.documentElement.style.setProperty('--tracks-panel-top', `${topPx}px`);
      document.documentElement.style.setProperty('--tracks-panel-bottom', `${bottomPx}px`);
    } catch {}
  } catch {
    // ignore
  }
}

// Expose for other scripts (search.js) to call when toggling UI
window.setSearchPanelInsets = setSearchPanelInsets;
window.setFavoritesPanelInsets = setFavoritesPanelInsets;
window.setResontesPanelInsets = setResontesPanelInsets;
window.setTracksPanelInsets = setTracksPanelInsets;

try {
  if (!window._resonateOverlayInsetsSubscriptionInit) {
    window._resonateOverlayInsetsSubscriptionInit = true;

    let insetsScheduled = false;
    const scheduleInsetsUpdate = (metrics = null) => {
      if (insetsScheduled) return;
      insetsScheduled = true;
      requestAnimationFrame(() => {
        insetsScheduled = false;
        setSearchPanelInsets(metrics);
        setResontesPanelInsets(metrics);
        setTracksPanelInsets(metrics);

        // Keep the keyboard-open class accurate even if browsers skip blur/focus events.
        try {
          const activeIsSearch = document.activeElement === elements.searchInput;
          const m = metrics || getViewportMetrics();
          const thresholdPx = (window.SEARCH_UI_CONFIG && Number.isFinite(window.SEARCH_UI_CONFIG.keyboardOpenThresholdPx))
            ? window.SEARCH_UI_CONFIG.keyboardOpenThresholdPx
            : 80;
          if (activeIsSearch) {
            setKeyboardOpenState(m.bottomInset > thresholdPx);
          }
        } catch {}
      });
    };

    if (typeof window.subscribeViewportUpdates === 'function') {
      window.subscribeViewportUpdates((metrics) => scheduleInsetsUpdate(metrics));
    } else {
      // Fallback for older builds: best-effort listeners.
      window.addEventListener('resize', () => scheduleInsetsUpdate(null), { passive: true });
      window.addEventListener('orientationchange', () => scheduleInsetsUpdate(null), { passive: true });
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => scheduleInsetsUpdate(null), { passive: true });
        window.visualViewport.addEventListener('scroll', () => scheduleInsetsUpdate(null), { passive: true });
      }
    }
  }
} catch {
  // ignore
}

// UI behavior tuning (overridable by other scripts before ui.js runs)
window.SEARCH_UI_CONFIG = window.SEARCH_UI_CONFIG || {
  // Mobile UX: close the keyboard when a search is executed.
  closeKeyboardOnSubmit: true,
  keyboardOpenThresholdPx: 80,
  // Mobile UX: if there is search history, first tap shows it without opening the keyboard.
  suppressKeyboardWhenHistory: true
};

function ensureSearchInputControllerBound() {
  const input = elements.searchInput;
  if (!input || input.dataset.searchControllerBound === 'true') return;
  input.dataset.searchControllerBound = 'true';

  const config = window.SEARCH_UI_CONFIG || { closeKeyboardOnSubmit: false, keyboardOpenThresholdPx: 80, suppressKeyboardWhenHistory: true };
  let isCleaning = false;
  let suppressNextFocus = false;
  let lastSubmit = { query: '', at: 0 };

  const isCoarsePointer = (() => {
    try {
      return Boolean(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
    } catch {
      return false;
    }
  })();

  const hasSearchHistory = () => {
    try {
      const history = loadSearchHistory();
      return Array.isArray(history) && history.length > 0;
    } catch {
      return false;
    }
  };

  const closeSearchKeyboard = () => {
    try { setKeyboardOpenState(false); } catch {}
    try { input.blur(); } catch {}
    // Some mobile browsers ignore blur inside key events; retry next ticks.
    try { setTimeout(() => { try { input.blur(); } catch {} }, 0); } catch {}
    try { requestAnimationFrame(() => { try { input.blur(); } catch {} }); } catch {}
  };

  const updateSearchClearButton = () => {
    const btn = elements.searchClear;
    if (!btn) return;
    const hasValue = Boolean((input.value || '').trim());
    btn.hidden = !hasValue;
    btn.disabled = !hasValue;
  };

  const showHistoryPanel = () => {
    performCompleteCleanup();
    displaySearchHistory();
    state.searchActive = true;
    hideFavoritesList();
    setSearchOpenState(true);
    scheduleSearchInsetsBurst();
  };

  const openResultsPanelIfAny = () => {
    hideFavoritesList();
    setSearchOpenState(Boolean(elements.searchResults && elements.searchResults.classList.contains('active')));
    scheduleSearchInsetsBurst();
  };

  if (elements.searchClear && !elements.searchClear.dataset.bound) {
    elements.searchClear.dataset.bound = 'true';
    elements.searchClear.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Mark any in-flight search as stale.
      state.searchRequestId = (state.searchRequestId || 0) + 1;

      input.value = '';
      updateSearchClearButton();

      showHistoryPanel();
      setKeyboardOpenState(true);

      try {
        input.focus({ preventScroll: true });
      } catch {
        try { input.focus(); } catch {}
      }
    });
  }

  // Tap on the input should bring back the panel.
  // On coarse-pointer devices, if search history exists and the panel is closed, open history without focusing the input
  // to avoid auto-opening the on-screen keyboard.
  input.addEventListener('pointerdown', (e) => {
    if (isCleaning) return;

    const currentQuery = (input.value || '').trim();
    const panelOpen = Boolean(elements.searchResults && elements.searchResults.classList.contains('active'));

    if (isCoarsePointer && config.suppressKeyboardWhenHistory && currentQuery === '' && !panelOpen && hasSearchHistory()) {
      suppressNextFocus = true;
      // Do NOT call e.preventDefault() here: in iOS Safari, preventing the default
      // on pointerdown disrupts the browser's touch-sequence tracking and can prevent
      // subsequent taps from opening the keyboard. Instead, the suppressNextFocus flag
      // handles keyboard suppression via a synchronous blur() inside the focus handler,
      // which is the Safari-compatible approach.
      try { e.stopPropagation(); } catch {}

      displaySearchHistory();
      state.searchActive = true;
      hideFavoritesList();
      setSearchOpenState(true);
      scheduleSearchInsetsBurst();
      return;
    }

    if (currentQuery === '') {
      displaySearchHistory();
      state.searchActive = true;
      hideFavoritesList();
      setSearchOpenState(true);
    }
    scheduleSearchInsetsBurst();
  });

  input.addEventListener('focus', () => {
    if (isCleaning) return;

    // If we intentionally opened history without focus (mobile UX), immediately blur.
    if (suppressNextFocus) {
      suppressNextFocus = false;
      try { input.blur(); } catch {}
      setKeyboardOpenState(false);
      return;
    }

    setKeyboardOpenState(true);

    const currentQuery = (input.value || '').trim();
    if (currentQuery === '') {
      displaySearchHistory();
      state.searchActive = true;
      hideFavoritesList();
      setSearchOpenState(true);
      scheduleSearchInsetsBurst();
      updateSearchClearButton();
      return;
    }

    openResultsPanelIfAny();
    updateSearchClearButton();

    if (state.searchResults.length > 0 && currentQuery === state.currentSearchQuery) {
      elements.searchResults.classList.add('active');
      scheduleSearchInsetsBurst();
      state.searchActive = true;
      setSearchOpenState(true);
    }
  });

  input.addEventListener('blur', () => {
    // Keyboard is likely closing; keep the panel state as-is.
    setKeyboardOpenState(false);
    updateSearchClearButton();
    scheduleSearchInsetsBurst();
  });

  input.addEventListener('input', (e) => {
    const currentQuery = (e.target.value || '').trim();
    updateSearchClearButton();

    if (currentQuery === '') {
      isCleaning = true;
      showHistoryPanel();
      return;
    }

    isCleaning = false;
    hideFavoritesList();

    if (state.searchResults.length > 0 && currentQuery === state.currentSearchQuery) {
      elements.searchResults.classList.add('active');
      scheduleSearchInsetsBurst();
      state.searchActive = true;
      setSearchOpenState(true);
    } else {
      // Avoid showing stale results while the user is editing.
      hideSearchResults();
    }
  });

  input.addEventListener('paste', () => {
    setTimeout(() => {
      const currentQuery = (input.value || '').trim();
      updateSearchClearButton();
      if (currentQuery === '') {
        showHistoryPanel();
      }
    }, 50);
  });

  input.addEventListener('search', () => {
    const q = (input.value || '').trim();
    if (q === '') {
      showHistoryPanel();
      updateSearchClearButton();
      return;
    }

    // Native search action (mobile keyboards). Ensure keyboard closes.
    if (isCoarsePointer || config.closeKeyboardOnSubmit) closeSearchKeyboard();

    // De-dupe if Enter handler already submitted.
    const now = Date.now();
    if (lastSubmit.query === q && (now - lastSubmit.at) < 500) {
      updateSearchClearButton();
      return;
    }
    lastSubmit = { query: q, at: now };

    const keepKeyboard = !(isCoarsePointer || config.closeKeyboardOnSubmit);
    dispatchSearchWithFastPath(q, { keepKeyboard, addToHistory: true });

    updateSearchClearButton();
  });

  input.addEventListener('keydown', (e) => {
    // Handle Escape key to close results
    if (e.key === 'Escape') {
      hideSearchResults();
      try { input.blur(); } catch {}
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateSearchResults('down');
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateSearchResults('up');
      return;
    }

    if (e.key === 'Enter') {
      // If a search result is focused, play it.
      const focusedCard = elements.searchResultsList
        ? (elements.searchResultsList.querySelector('.content-card.focused') || null)
        : null;
      if (focusedCard) {
        e.preventDefault();
        try { focusedCard.click(); } catch {}
        closeSearchKeyboard();
        return;
      }

      state.currentSearchPage = 0;
      state.currentSearchQuery = (input.value || '').trim();

      if (state.currentSearchQuery) {
        const queryAtDispatch = state.currentSearchQuery;
        lastSubmit = { query: queryAtDispatch, at: Date.now() };

        if (isCoarsePointer || config.closeKeyboardOnSubmit) closeSearchKeyboard();
        const keepKeyboard = !(isCoarsePointer || config.closeKeyboardOnSubmit);
        dispatchSearchWithFastPath(queryAtDispatch, { keepKeyboard, addToHistory: true });
      } else {
        showHistoryPanel();
      }
    }
  });

  // Tap outside closes the panel (mobile-friendly)
  if (!window._resonateSearchOutsideCloseInit) {
    window._resonateSearchOutsideCloseInit = true;
    document.addEventListener('pointerdown', (e) => {
      try {
        // Desktop inline: don't auto-close on outside clicks.
        const isDesktopInline = (() => {
          try {
            return window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)').matches;
          } catch {
            return false;
          }
        })();
        if (isDesktopInline) return;

        if (!elements.searchResults || !elements.searchResults.classList.contains('active')) return;

        const target = e.target;

        // Theme toggle should not close overlays (search/favorites).
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle && target && themeToggle.contains(target)) return;

        const container = document.querySelector('.search-container');
        if (container && container.contains(target)) return;
        if (elements.searchResults.contains(target)) return;
        if (elements.favoritesList && elements.favoritesList.contains(target)) return;

        hideSearchResults();
        try {
          if (document.activeElement === input) {
            input.blur();
          }
        } catch {}
      } catch {
        // ignore
      }
    }, { capture: true });
  }

  updateSearchClearButton();
}

// Search configuration
// Llamar a updateDescriptionUI cada vez que se actualiza la pista
if (!window._resonateDescriptionInit) {
  window._resonateDescriptionInit = true;
  document.addEventListener('DOMContentLoaded', function() {
    if (window.state && window.state.currentTrack) {
      updateDescriptionUI(window.state.currentTrack);
    }
  });
}
// Sanitiza HTML básico para evitar XSS
function sanitizeHTML(html) {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  // Elimina scripts y eventos
  Array.from(tempDiv.querySelectorAll('script, iframe, object, embed')).forEach(e => e.remove());
  Array.from(tempDiv.querySelectorAll('*')).forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    });
  });
  return tempDiv.innerHTML;
}

const INFO_UX_CONFIG = {
  previewCharLimit: 800,
  minPreviewCharLimit: 240
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractTextFromHtml(html) {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html || '';
  return (tempDiv.textContent || '').trim();
}

function normalizeDescriptionText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function truncateText(text, limit) {
  const safeLimit = Math.max(INFO_UX_CONFIG.minPreviewCharLimit, limit || INFO_UX_CONFIG.previewCharLimit);
  if (!text || text.length <= safeLimit) return { text: text || '', truncated: false };
  let cut = text.slice(0, safeLimit);
  cut = cut.replace(/\s+\S*$/, '');
  if (cut.length < safeLimit * 0.6) cut = text.slice(0, safeLimit);
  return { text: `${cut.trim()}…`, truncated: true };
}

function formatPlainTextAsHtml(text) {
  const normalized = normalizeDescriptionText(text);
  if (!normalized) return '';
  const paragraphs = normalized.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  return paragraphs.map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
}

function buildSearchSuggestionsHtml({ title, creator, album }) {
  const baseQuery = [title, creator].filter(Boolean).join(' ').trim();
  const creatorQuery = creator ? String(creator).trim() : '';
  const albumQuery = album ? String(album).trim() : '';
  const queryForWeb = baseQuery || albumQuery || creatorQuery || '';

  const internalChips = [];
  if (baseQuery) {
    internalChips.push(
      `<span class="info-chip info-chip--action" role="button" tabindex="0" data-action="search-internal" data-query="${escapeHtml(baseQuery)}">Resonate: ${escapeHtml(baseQuery)}</span>`
    );
  }
  if (creatorQuery && creatorQuery !== baseQuery) {
    internalChips.push(
      `<span class="info-chip info-chip--action" role="button" tabindex="0" data-action="search-internal" data-query="${escapeHtml(creatorQuery)}">Resonate: ${escapeHtml(creatorQuery)}</span>`
    );
  }
  if (albumQuery && albumQuery !== baseQuery && albumQuery !== creatorQuery) {
    internalChips.push(
      `<span class="info-chip info-chip--action" role="button" tabindex="0" data-action="search-internal" data-query="${escapeHtml(albumQuery)}">Resonate: ${escapeHtml(albumQuery)}</span>`
    );
  }

  const externalChips = [];
  if (queryForWeb) {
    const encoded = encodeURIComponent(queryForWeb);
    externalChips.push(`<a class="info-chip" href="https://www.google.com/search?q=${encoded}" target="_blank" rel="noopener noreferrer">Google</a>`);
    externalChips.push(`<a class="info-chip" href="https://es.wikipedia.org/wiki/Special:Search?search=${encoded}" target="_blank" rel="noopener noreferrer">Wikipedia</a>`);
  }

  if (!internalChips.length && !externalChips.length) return '';

  return `
    <div class="info-searches">
      <div class="info-searches-title">Suggested searches</div>
      <div class="info-searches-chips">
        ${internalChips.join('')}
        ${externalChips.join('')}
      </div>
    </div>
  `;
}

function buildInfoModalHtml({ title, creator, album, descriptionHtml, descriptionText }) {
  const normalizedText = normalizeDescriptionText(descriptionText);
  const preview = truncateText(normalizedText, INFO_UX_CONFIG.previewCharLimit);
  const previewHtml = formatPlainTextAsHtml(preview.text);
  const safeFullHtml = descriptionHtml || previewHtml || '<p>No information available.</p>';

  const metaParts = [];
  if (creator) metaParts.push(`<span class="info-meta-item">${escapeHtml(creator)}</span>`);

  return `
    <div class="info-header">
      <div class="info-title" id="info-modal-title">${escapeHtml(title || 'Information')}</div>
      <div class="info-meta">${metaParts.join('')}</div>
    </div>
    <div class="info-content">
      <div class="info-body info-body--preview">${previewHtml || '<p>No information available.</p>'}</div>
      <div class="info-body info-body--full" hidden>${safeFullHtml}</div>
      ${preview.truncated ? '<span class="info-toggle" role="button" tabindex="0" data-action="toggle-info" aria-expanded="false">Show more</span>' : ''}
    </div>
    ${buildSearchSuggestionsHtml({ title, creator, album })}
  `;
}

function closeDescriptionModal() {
  try {
    if (elements.descriptionModal) elements.descriptionModal.style.display = 'none';
  } catch {}
}

function bindInfoModalInteractions() {
  if (!elements.modalDescription) return;
  if (elements.modalDescription.dataset.infoUxBound === 'true') return;
  elements.modalDescription.dataset.infoUxBound = 'true';

  elements.modalDescription.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.getAttribute('data-action');
    if (action === 'toggle-info') {
      const preview = elements.modalDescription.querySelector('.info-body--preview');
      const full = elements.modalDescription.querySelector('.info-body--full');
      if (!preview || !full) return;
      const isExpanded = elements.modalDescription.dataset.infoExpanded === 'true';
      if (isExpanded) {
        full.hidden = true;
        preview.hidden = false;
        actionEl.textContent = 'Show more';
        actionEl.setAttribute('aria-expanded', 'false');
        elements.modalDescription.dataset.infoExpanded = 'false';
      } else {
        full.hidden = false;
        preview.hidden = true;
        actionEl.textContent = 'Show less';
        actionEl.setAttribute('aria-expanded', 'true');
        elements.modalDescription.dataset.infoExpanded = 'true';
        try {
          const modalContent = document.querySelector('.description-modal-content');
          if (modalContent && typeof modalContent.scrollTo === 'function') {
            modalContent.scrollTo({ top: 0, behavior: 'smooth' });
          } else if (modalContent) {
            modalContent.scrollTop = 0;
          }
        } catch {}
      }
    }
    if (action === 'search-internal') {
      const q = String(actionEl.getAttribute('data-query') || '').trim();
      if (!q) return;
      try {
        if (elements.searchInput) elements.searchInput.value = q;
        runSearchWithCurrentFilters({ keepKeyboard: false });
      } catch {}
      closeDescriptionModal();
    }
  });

  elements.modalDescription.addEventListener('keydown', (event) => {
    const isActivation = event.key === 'Enter' || event.key === ' ';
    if (!isActivation) return;
    const target = event.target;
    if (!target || !target.getAttribute) return;
    if (!target.getAttribute('data-action')) return;
    event.preventDefault();
    target.click();
  });
}

function bindDescriptionModalShell() {
  if (!elements.descriptionModal) return;
  if (elements.descriptionModal.dataset.shellBound === 'true') return;
  elements.descriptionModal.dataset.shellBound = 'true';

  elements.descriptionModal.addEventListener('click', (event) => {
    if (event.target === elements.descriptionModal) {
      closeDescriptionModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && elements.descriptionModal && elements.descriptionModal.style.display === 'flex') {
      closeDescriptionModal();
    }
  });

  if (elements.closeDescriptionModal) {
    elements.closeDescriptionModal.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        closeDescriptionModal();
      }
    });
  }
}

function bindIconControlActivation(element) {
  if (!element || element._resonateKeyHandlerSet) return;
  element._resonateKeyHandlerSet = true;
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      element.click();
    }
  });
}

function setIconControlDisabled(element, isDisabled) {
  if (!element) return;
  element.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
  element.classList.toggle('is-disabled', isDisabled);
  element.tabIndex = isDisabled ? -1 : 0;
}

// Builds (or rebuilds) the inner content of the tracks panel, wires up the close button,
// seeds the track list from state and triggers displayAlbumTracksV2.
function mountTracksPanelContent(albumId) {
  const container = elements.tracksListContainer;
  const toggleBtn = elements.toggleTracksBtn;

  container.innerHTML = `
    <div class="search-results-header panel-header" role="banner">
      <div class="search-results-summary" aria-live="polite">
        <span class="tracks-overlay-count">Tracks</span>
      </div>
      <div class="search-results-controls" aria-label="Tracks controls">
        <button class="search-clear-btn tracks-overlay-close" type="button" aria-label="Close tracks" title="Close">✕</button>
      </div>
    </div>
    <div class="tracklist__list tracks-overlay-list" role="list" aria-label="Album tracks"></div>
  `;

  const closeBtn = container.querySelector('.tracks-overlay-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      try { e.preventDefault(); e.stopPropagation(); } catch {}
      try { container.style.display = 'none'; } catch {}
      try { toggleBtn.classList.remove('active'); } catch {}
      try { container.classList.remove('tracks-inline'); } catch {}
      try { document.body.classList.remove('tracks-open'); } catch {}
    });
  }

  const listEl = container.querySelector('.tracks-overlay-list');
  try {
    if (listEl && window.state) {
      if (Array.isArray(window.state.currentTracklist) && window.state.currentTracklist.length) {
        listEl.__albumTracks = window.state.currentTracklist;
      } else if (window.state.savedPlaybackTracklist && Array.isArray(window.state.savedPlaybackTracklist.items)) {
        listEl.__albumTracks = window.state.savedPlaybackTracklist.items;
      }
    }
  } catch {}

  if (window.displayAlbumTracksV2 && listEl) {
    window.displayAlbumTracksV2(albumId, listEl);
  } else if (listEl) {
    listEl.innerHTML = '<div class="no-results">Can\'t show the track list</div>';
  }
}

// Control de descripción de pista
function updateDescriptionUI(track) {
  if (!elements.descriptionContainer || !elements.toggleDescriptionBtn) return;
  const activeTrack = track || (window.state && window.state.currentTrack) || null;
  // ...existing code...

  bindIconControlActivation(elements.toggleDescriptionBtn);
  bindIconControlActivation(elements.toggleTracksBtn);

  // --- TRACKS BUTTON LOGIC ---
  if (elements.toggleTracksBtn && elements.tracksListContainer) {
    const savedTracklist = (window.state && window.state.savedPlaybackTracklist && Array.isArray(window.state.savedPlaybackTracklist.items))
      ? window.state.savedPlaybackTracklist.items
      : [];
    const currentTracklist = (window.state && Array.isArray(window.state.currentTracklist))
      ? window.state.currentTracklist
      : [];
    const fallbackTracklist = currentTracklist.length ? currentTracklist : savedTracklist;
    const fallbackAlbumId = (window.state && window.state.savedPlaybackTracklist && window.state.savedPlaybackTracklist.albumId)
      ? window.state.savedPlaybackTracklist.albumId
      : null;
    const listFirst = fallbackTracklist && fallbackTracklist.length ? fallbackTracklist[0] : null;

    const albumId = activeTrack && (
      activeTrack.albumId ||
      activeTrack.album_id ||
      activeTrack.album_id_str ||
      activeTrack.album_id_num ||
      activeTrack.album_id_str_v2 ||
      activeTrack.album_id_v2 ||
      activeTrack.album_id_strict ||
      activeTrack.album_id_fallback ||
      activeTrack.album ||
      activeTrack._albumId ||
      fallbackAlbumId ||
      (listFirst && (listFirst.albumId || listFirst.album || listFirst.id || listFirst.trackId)) ||
      (((activeTrack.totalTracks && activeTrack.totalTracks > 1) || activeTrack.isAlbumTrack || fallbackTracklist.length > 1) ? activeTrack.id : null)
    );

    const shouldShowTracks = !!albumId && (fallbackTracklist.length > 1 || (activeTrack && ((activeTrack.totalTracks && activeTrack.totalTracks > 1) || activeTrack.isAlbumTrack)) || !fallbackTracklist.length);
    elements.toggleTracksBtn.style.display = shouldShowTracks ? 'flex' : 'none';
    setIconControlDisabled(elements.toggleTracksBtn, !albumId || !shouldShowTracks);

    // Cerrar el panel si ya no hay un álbum válido para mostrar
    if (!shouldShowTracks && elements.tracksListContainer.style.display === 'block') {
      elements.tracksListContainer.style.display = 'none';
      try { elements.toggleTracksBtn.classList.remove('active'); } catch {}
      try { elements.tracksListContainer.classList.remove('tracks-inline'); } catch {}
      try { document.body.classList.remove('tracks-open'); } catch {}
    }

    // Detectar cambio de álbum y refrescar lista si el panel está abierto
    if (elements.tracksListContainer.style.display === 'block') {
      // Obtener el álbum actualmente mostrado (guardado en dataset)
      const shownAlbumId = elements.tracksListContainer.dataset.currentAlbumId;
      if (shownAlbumId !== String(albumId)) {
        // Actualizar el dataset y refrescar la lista
        elements.tracksListContainer.dataset.currentAlbumId = String(albumId);
        mountTracksPanelContent(albumId);
      }
    }

    // Solo asignar el handler una vez
    if (!elements.toggleTracksBtn._resonateHandlerSet) {
      elements.toggleTracksBtn._resonateHandlerSet = true;
      elements.toggleTracksBtn.addEventListener('click', function() {
        if (elements.toggleTracksBtn.getAttribute('aria-disabled') === 'true') return;
        if (!window.state || !window.state.currentTrack) return;
        const currentTrack = window.state.currentTrack;
        const savedAlbumId = window.state.savedPlaybackTracklist && window.state.savedPlaybackTracklist.albumId
          ? window.state.savedPlaybackTracklist.albumId
          : null;
        const listFallback = Array.isArray(window.state.currentTracklist) && window.state.currentTracklist.length
          ? window.state.currentTracklist
          : (window.state.savedPlaybackTracklist && Array.isArray(window.state.savedPlaybackTracklist.items)
            ? window.state.savedPlaybackTracklist.items
            : []);
        const listFallbackFirst = listFallback && listFallback.length ? listFallback[0] : null;
        const currentAlbumId = currentTrack.albumId || currentTrack.album_id || currentTrack.album_id_str || currentTrack.album_id_num || currentTrack.album_id_str_v2 || currentTrack.album_id_v2 || currentTrack.album_id_strict || currentTrack.album_id_fallback || currentTrack.album || currentTrack._albumId || savedAlbumId || (listFallbackFirst && (listFallbackFirst.albumId || listFallbackFirst.album || listFallbackFirst.id || listFallbackFirst.trackId));
        if (!currentAlbumId) return;
        const isVisible = elements.tracksListContainer.style.display === 'block';
        if (isVisible) {
          elements.tracksListContainer.style.display = 'none';
          elements.toggleTracksBtn.classList.remove('active');
          try { elements.tracksListContainer.classList.remove('tracks-inline'); } catch {}
          try { document.body.classList.remove('tracks-open'); } catch {}
        } else {
          elements.tracksListContainer.style.display = 'block';
          elements.toggleTracksBtn.classList.add('active');
          try { elements.tracksListContainer.classList.add('tracks-inline'); } catch {}
          try { document.body.classList.add('tracks-open'); } catch {}

          elements.tracksListContainer.dataset.currentAlbumId = String(currentAlbumId);
          mountTracksPanelContent(currentAlbumId);

          try {
            if (typeof window.scheduleOverflowTickerUpdate === 'function') {
              window.scheduleOverflowTickerUpdate();
            }
          } catch {}

          try {
            if (typeof window.requestViewportUpdate === 'function') window.requestViewportUpdate();
            if (typeof window.setTracksPanelInsets === 'function') window.setTracksPanelInsets();
          } catch {}
        }
      });
    }
  }
  // Modal elements
  const modal = document.getElementById('description-modal');
  const modalDesc = document.getElementById('modal-description');
  const closeModalBtn = document.getElementById('close-description-modal');

  // Usar la mejor descripción disponible (track > album > result)
  const bestDescription = (() => {
    try {
      if (typeof window.getBestDescription === 'function') {
        return window.getBestDescription(activeTrack, activeTrack?._albumDescription, activeTrack?._resultDescription || activeTrack?.resultDescription) || '';
      }
    } catch {}
    const trackDesc = (activeTrack && typeof activeTrack.description === 'string') ? activeTrack.description.trim() : '';
    if (trackDesc) return trackDesc;
    const albumDesc = (activeTrack && typeof activeTrack._albumDescription === 'string') ? activeTrack._albumDescription.trim() : '';
    if (albumDesc) return albumDesc;
    const resultDesc = (activeTrack && typeof (activeTrack._resultDescription || activeTrack.resultDescription) === 'string')
      ? String(activeTrack._resultDescription || activeTrack.resultDescription).trim()
      : '';
    return resultDesc;
  })();

  if (bestDescription && bestDescription.trim() !== '') {
    elements.toggleDescriptionBtn.style.display = 'flex';
    setIconControlDisabled(elements.toggleDescriptionBtn, false);
    window.logger?.debug('[updateDescriptionUI] Showing description button', 'UI');
    elements.toggleDescriptionBtn.onclick = function() {
      if (elements.toggleDescriptionBtn.getAttribute('aria-disabled') === 'true') return;
      window.logger?.debug('[updateDescriptionUI] Description button clicked; opening modal', 'UI');
      if (modal && modalDesc) {
        const sanitizedHtml = sanitizeHTML(bestDescription);
        const textFromHtml = extractTextFromHtml(sanitizedHtml);
        modalDesc.innerHTML = buildInfoModalHtml({
          title: activeTrack?.title || activeTrack?.name || '',
          creator: activeTrack?.creator || activeTrack?.artist || activeTrack?.author || '',
          album: activeTrack?.album || activeTrack?.albumTitle || activeTrack?.collection || '',
          descriptionHtml: sanitizedHtml,
          descriptionText: textFromHtml
        });
        modalDesc.dataset.infoExpanded = 'false';
        bindInfoModalInteractions();
        bindDescriptionModalShell();
        modal.style.display = 'flex';
      }
    };
    if (closeModalBtn && modal) {
      closeModalBtn.onclick = function() {
        window.logger?.debug('[updateDescriptionUI] Closing description modal', 'UI');
        closeDescriptionModal();
      };
    }
  } else {
    window.logger?.debug('[updateDescriptionUI] Hiding description button; no description available', 'UI');
    if (elements.toggleDescriptionBtn) {
      elements.toggleDescriptionBtn.style.display = 'none';
      setIconControlDisabled(elements.toggleDescriptionBtn, true);
    }
    if (modal) modal.style.display = 'none';
    if (modalDesc) modalDesc.innerHTML = '';
  }
}

window.updateDescriptionUI = updateDescriptionUI;

// Inicializar botón Tracks y contenedor al cargar la página
document.addEventListener('DOMContentLoaded', function() {
  if (elements.toggleTracksBtn && elements.tracksListContainer) {
    if (window.state && window.state.currentTrack) {
      updateDescriptionUI(window.state.currentTrack);
    } else {
      elements.toggleTracksBtn.style.display = 'none';
      elements.tracksListContainer.style.display = 'none';
      elements.toggleTracksBtn.classList.remove('active');
    }
  }
  // Wire card context menu once DOM and BottomSheetAPI are ready.
  try { initCardContextSheetHandlers(); } catch {}
});

// Title Ticker Management is handled by js/player-title.js

// Overflow-based ticker for track titles (tracks overlay, search results, resontes)
let overflowTickerScheduled = false;
const OVERFLOW_TICKER_SELECTORS = [
  'body.tracks-open #tracks-list-container .track-title',
  'body.tracks-open #tracks-list-container .tlv2-title',
  'body.tracks-open #tracks-list-container .track-row-title',
  '.tracklist .track-title',
  '.tracklist .tlv2-title',
  '.tracklist .track-row-title',
  '.search-results .favorite-title',
  '.search-results .result-title',
  '.card-grid .card-title'
];

function updateOverflowTickers(root = document) {
  try {
    const selector = OVERFLOW_TICKER_SELECTORS.join(',');
    const nodes = (root && root.querySelectorAll) ? root.querySelectorAll(selector) : [];
    nodes.forEach((el) => {
      try {
        if (!el) return;
        const style = window.getComputedStyle(el);
        if (style.whiteSpace !== 'nowrap') {
          const existingSpan = el.querySelector(':scope > .ticker-text');
          if (existingSpan) existingSpan.classList.remove('ticker');
          return;
        }
        let span = el.querySelector(':scope > .ticker-text');
        if (!span) {
          span = document.createElement('span');
          span.className = 'ticker-text';
          while (el.firstChild) {
            span.appendChild(el.firstChild);
          }
          el.appendChild(span);
        }

        const overflow = (span.scrollWidth || 0) - (el.clientWidth || 0);
        if (overflow > 4) {
          span.classList.add('ticker');
        } else {
          span.classList.remove('ticker');
        }
      } catch {
        // ignore per-element errors
      }
    });
  } catch {
    // ignore
  }
}

function scheduleOverflowTickerUpdate() {
  if (overflowTickerScheduled) return;
  overflowTickerScheduled = true;
  requestAnimationFrame(() => {
    overflowTickerScheduled = false;
    updateOverflowTickers();
  });
}

try {
  if (!window.__resonateOverflowTickerObserver) {
    window.__resonateOverflowTickerObserver = new MutationObserver(() => {
      scheduleOverflowTickerUpdate();
    });
    window.__resonateOverflowTickerObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    window.addEventListener('resize', scheduleOverflowTickerUpdate, { passive: true });
    window.addEventListener('orientationchange', scheduleOverflowTickerUpdate, { passive: true });
    window.addEventListener('load', scheduleOverflowTickerUpdate, { passive: true });
    setTimeout(scheduleOverflowTickerUpdate, 300);
  }
} catch {
  // ignore
}

window.updateOverflowTickers = updateOverflowTickers;
window.scheduleOverflowTickerUpdate = scheduleOverflowTickerUpdate;

const SEARCH_CONFIG = {
  // Smaller page improves time-to-first-render; infinite scroll keeps it unbounded.
  resultsPerPage: 12,
  timeout: 20000,
  enableLazyLoading: true
};

function nowPerfMs() {
  try {
    return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
  } catch {
    return Date.now();
  }
}

function markSearchPerfStart(query, requestId) {
  try {
    state._searchPerf = {
      query: String(query || '').trim(),
      requestId: Number(requestId) || 0,
      startedAtMs: nowPerfMs(),
      viewStartedAtMs: null,
      viewMsTotal: 0,
      logged: false,
      firstRenderMs: null,
      badgeApplied: false
    };
  } catch {}

  // UX: avoid a blank panel while waiting for the first results.
  try {
    // Make sure the header is visible early (so users see the busy state).
    if (elements && elements.searchResultsHeader) elements.searchResultsHeader.hidden = false;

    const list = elements && elements.searchResultsList ? elements.searchResultsList : null;
    if (!list) return;

    // Don't overwrite existing results (keeps perceived latency low on subsequent searches).
    const hasCards = !!list.querySelector('.content-card');
    if (hasCards) return;

    // Only show a placeholder when we truly have nothing rendered.
    list.innerHTML = `<div class="search-loading"><div class="loader"></div><span class="loader-text">Searching…</span></div>`;
  } catch {}
}

function shouldShowSearchPerfBadge() {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get('searchPerf') === '1' || url.searchParams.get('searchDebug') === '1';
  } catch {
    return false;
  }
}

function formatSearchViewMs(ms) {
  const n = typeof ms === 'number' && isFinite(ms) ? ms : 0;
  const s = Math.max(0, n / 1000);
  // One decimal is enough for UX/perf debugging.
  return `${Math.round(s * 10) / 10}s`;
}

function updateSearchPerfBadge() {
  try {
    if (!shouldShowSearchPerfBadge()) return;
    if (!elements || !elements.searchResultsCount) return;
    const perf = state._searchPerf;
    if (!perf) return;

    const current = String(elements.searchResultsCount.textContent || '').trim();
    const base = (current.split('•')[0] || '').trim() || current;

    const parts = [base];
    if (typeof perf.firstRenderMs === 'number') parts.push(`${perf.firstRenderMs}ms`);
    if (typeof perf.viewMsTotal === 'number' && perf.viewMsTotal > 0) parts.push(`view ${formatSearchViewMs(perf.viewMsTotal)}`);

    if (parts.length > 1) {
      elements.searchResultsCount.textContent = parts.join(' • ');
      perf.badgeApplied = true;
    }
  } catch {}
}

function __resonateOnSearchPanelActiveChange(isActive) {
  try {
    const perf = state._searchPerf;
    if (!perf) return;

    if (isActive) {
      // Start (or restart) view timer.
      if (perf.viewStartedAtMs == null) perf.viewStartedAtMs = nowPerfMs();
      return;
    }

    // Stop timer and accumulate.
    if (typeof perf.viewStartedAtMs === 'number') {
      const elapsed = Math.max(0, nowPerfMs() - perf.viewStartedAtMs);
      perf.viewMsTotal = (typeof perf.viewMsTotal === 'number' ? perf.viewMsTotal : 0) + elapsed;
      perf.viewStartedAtMs = null;

      try {
        const msg = `Search view time: ${Math.round(perf.viewMsTotal)}ms (${perf.query})`;
        if (window.logger?.info) window.logger.info(msg, 'PERF');
      } catch {}

      updateSearchPerfBadge();
    }
  } catch {}
}

// Expose hook used by search.js when it activates/deactivates the search panel.
try {
  if (typeof window !== 'undefined') window.__resonateOnSearchPanelActiveChange = __resonateOnSearchPanelActiveChange;
} catch {}

function maybeLogSearchPerfFirstPaint({ requestId, query } = {}) {
  try {
    const perf = state._searchPerf;
    if (!perf || perf.logged) return;
    if (Number(perf.requestId) !== Number(requestId)) return;
    if (String(perf.query || '') !== String(query || '')) return;

    requestAnimationFrame(() => {
      try {
        if (!state._searchPerf || state._searchPerf.logged) return;
        const elapsed = Math.max(0, nowPerfMs() - perf.startedAtMs);
        state._searchPerf.logged = true;
        state._searchPerf.firstRenderMs = Math.round(elapsed);
        const msg = `Search first render: ${Math.round(elapsed)}ms (${perf.query})`;
        if (window.logger?.info) window.logger.info(msg, 'PERF');
        else {
          // Logger is loaded before ui.js; avoid console usage.
        }

        // Optional: surface timing in the UI count label (debug/perf only).
        try { updateSearchPerfBadge(); } catch {}
      } catch {}
    });
  } catch {}
}

// Loader Manager - Simplified single-state loader with auto-cleanup
// LoaderManager removed - no loaders in this version

// Application state
const state = {
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
  // ...add any other required default properties here...
  onPlayCallback: null,
  appStarted: false,
  pageVisible: true,
  backgroundPlaybackEnabled: true,
  albumOrigin: null,
  isSeeking: false,
  searchActive: false,
  searchTimeout: null,
  searchRequestId: 0,
  isAndroid: /Android/.test(navigator.userAgent),
  expandedAlbums: new Set(),
  shuffleFavorites: false,
  networkOnline: true,
  // URL currently assigned to the <audio> element (may be a normal URL or a blob: URL)
  currentAudioUrl: null,
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
  playbackForward: [],
  favoritesPreloadEnabled: true,
  resontesPreloadEnabled: true,
  contextReloadCount: {},
  contextRepeatCount: {},

  currentSearchPage: 0,
  currentSearchHasMore: false,
  currentSearchTotal: null,
  currentSearchQuery: '',
  isLoadingMore: false,
  savedPlaybackState: null,
  // View mode: 'grid' | 'list' (new card grid by default)
  viewMode: 'grid',

  // Desktop UI controls
  searchUi: {
    offlineOnly: false
  },
  favoritesUi: {
    filterText: '',
    offlineOnly: false
  },

  // Desktop density is now fixed to compact (CSS-driven).
};

// Expose state globally for other modules
window.state = state;

// ---- Resontes primary API surface (backward compatible) ----
// Keep storage/engine internals on `favorites` while exposing `resontes` aliases.
try {
  Object.defineProperty(state, 'resontes', {
    configurable: true,
    enumerable: true,
    get() { return state.favorites; },
    set(v) { state.favorites = Array.isArray(v) ? v : []; }
  });
} catch {}

try {
  Object.defineProperty(state, 'resontesUi', {
    configurable: true,
    enumerable: true,
    get() { return state.favoritesUi; },
    set(v) { state.favoritesUi = v || { filterText: '', offlineOnly: false }; }
  });
} catch {}

try {
  Object.defineProperty(state, 'resontesVisible', {
    configurable: true,
    enumerable: true,
    get() { return state.favoritesVisible; },
    set(v) { state.favoritesVisible = !!v; }
  });
} catch {}

try {
  Object.defineProperty(state, 'isPlayingResontes', {
    configurable: true,
    enumerable: true,
    get() { return state.isPlayingFavorites; },
    set(v) { state.isPlayingFavorites = !!v; }
  });
} catch {}

function loadResontes() { return loadFavorites(); }
function saveResontes() { return saveFavorites(); }
function isTrackResonte(track) { return isTrackFavorite(track); }
function toggleResonteTrack(track) { return toggleFavorite(track); }
function addAlbumToResontes(albumId, files) { return addAlbumToFavorites(albumId, files); }
function removeAlbumFromResontes(albumId) { return removeAlbumFromFavorites(albumId); }
function updateResontesList() { return updateFavoritesList(); }
function updateResontesCount() { return updateFavoritesCount(); }

// Load persisted preference for favorites preload
function loadFavoritesPreloadPreference() {
  try {
    const saved = localStorage.getItem('resonate_preload_favorites_enabled');
    if (saved === null) {
      state.favoritesPreloadEnabled = true;
    } else {
      state.favoritesPreloadEnabled = saved === 'true';
    }
  } catch (e) {
    state.favoritesPreloadEnabled = true;
    window.logger?.warn(`Could not load favorites preload preference: ${e.message}`, 'UI');
  }

  if (elements.preloadFavoritesToggle) {
    elements.preloadFavoritesToggle.checked = state.favoritesPreloadEnabled;
  }
}

// Load persisted preference for resontes preload
function loadResontesPreloadPreference() {
  try {
    const saved = localStorage.getItem('resonate_preload_resontes_enabled');
    if (saved === null) {
      state.resontesPreloadEnabled = true;
    } else {
      state.resontesPreloadEnabled = saved === 'true';
    }
  } catch (e) {
    state.resontesPreloadEnabled = true;
    window.logger?.warn(`Could not load resontes preload preference: ${e.message}`, 'UI');
  }

  if (elements.preloadResontesToggle) {
    elements.preloadResontesToggle.checked = state.resontesPreloadEnabled;
  }
}

function setResontesPreloadEnabled(enabled) {
  state.resontesPreloadEnabled = !!enabled;
  try {
    localStorage.setItem('resonate_preload_resontes_enabled', String(enabled));
  } catch (e) {
    window.logger?.warn(`Could not save resontes preload preference: ${e.message}`, 'UI');
  }

  if (elements.preloadResontesToggle) {
    elements.preloadResontesToggle.checked = state.resontesPreloadEnabled;
  }

  const statusMsg = enabled ? 'Resonates preload enabled' : 'Resonates preload disabled';
  showStatus(statusMsg, 'info', 2000);
}

function initializePreloadResontesToggle() {
  loadResontesPreloadPreference();

  if (!elements.preloadResontesToggle) return;

  elements.preloadResontesToggle.checked = state.resontesPreloadEnabled;
  elements.preloadResontesToggle.addEventListener('change', (e) => {
    setResontesPreloadEnabled(e.target.checked);
  });
}

// Initialize preload preference on load
loadResontesPreloadPreference();

// Favorites management
function isSupportedAudioUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  // Accept URLs with query strings/fragments (e.g. .mp3?download=1)
  try {
    const u = new URL(trimmed, window.location.href);
    const p = (u.pathname || '').toLowerCase();
    return p.endsWith('.flac') || p.endsWith('.ogg') || p.endsWith('.mp3');
  } catch {
    return /\.(flac|ogg|mp3)(\?|#|$)/i.test(trimmed);
  }
}

function normalizeTrackForUi(track, opts = {}) {
  try {
    if (window.TrackNormalizer && typeof window.TrackNormalizer.normalizeTrack === 'function') {
      return window.TrackNormalizer.normalizeTrack(track, opts);
    }
  } catch {}
  return track;
}

function getTrackIdentityKey(track) {
  try {
    if (window.TrackNormalizer && typeof window.TrackNormalizer.getTrackKey === 'function') {
      return window.TrackNormalizer.getTrackKey(track);
    }
  } catch {}
  if (!track || typeof track !== 'object') return '';
  return String(track.trackId || track.url || track.id || '');
}

function loadFavorites() {
  try {
    window.logger.info('Loading favorites from localStorage...', 'UI');
    const favorites = localStorage.getItem('resonate_favorites');
    window.logger.debug('Raw favorites from localStorage retrieved', 'UI');

    let parsedFavorites = [];
    if (favorites) {
      parsedFavorites = JSON.parse(favorites);
      window.logger.debug(`Parsed ${parsedFavorites.length} favorites`, 'UI');
      // Filter out unsupported format favorites (keep .flac, .ogg and .mp3)
      const originalCount = parsedFavorites.length;
      parsedFavorites = parsedFavorites.filter(fav => {
        if (!fav.url) return false;
        return isSupportedAudioUrl(fav.url);
      });
      if (parsedFavorites.length < originalCount) {
        // Save filtered favorites back to localStorage
        localStorage.setItem('resonate_favorites', JSON.stringify(parsedFavorites));
        window.logger.info(`Filtered ${originalCount - parsedFavorites.length} unsupported format favorites`, 'UI');
      }
      // Limpieza automática de favoritos huérfanos: eliminar favoritos cuyo archivo no existe en cache
      if (
        typeof audioCache !== 'undefined' &&
        audioCache &&
        audioCache.cache &&
        typeof audioCache.cache.has === 'function' &&
        typeof audioCache.cache.get === 'function'
      ) {
        const orphaned = [];
        parsedFavorites = parsedFavorites.filter(fav => {
          // Solo elimina si no existe en cache ni en IndexedDB
          const exists = audioCache.cache.has('audio') && audioCache.cache.get('audio').has(fav.url);
          if (!exists) {
            orphaned.push(fav.url);
          }
          return exists;
        });
        if (orphaned.length > 0) {
          localStorage.setItem('resonate_favorites', JSON.stringify(parsedFavorites));
          window.logger.info(`Removed ${orphaned.length} orphaned favorites (not found in cache)`, 'UI');
        }
      }
      // Resolución automática de conflictos: fusionar favoritos en memoria y persistidos, priorizando los más recientes
      if (Array.isArray(state.favorites) && state.favorites.length > 0) {
        // Combina favoritos persistidos y en memoria, priorizando los más recientes (al final)
        const all = [...parsedFavorites, ...state.favorites];
        const unique = [];
        const seen = new Set();
        for (let i = all.length - 1; i >= 0; i--) {
          const fav = all[i];
          const key = getTrackIdentityKey(fav) || (fav && fav.url ? String(fav.url) : '');
          if (key && !seen.has(key)) {
            unique.unshift(fav); // Mantiene el orden de los más recientes
            seen.add(key);
          }
        }
        parsedFavorites = unique;
        localStorage.setItem('resonate_favorites', JSON.stringify(parsedFavorites));
        window.logger.info('Favorites merged and deduplicated (conflict resolution)', 'UI');
      }
    }
    // Normalizar y eliminar duplicados por identidad de pista
    let normalizedFavorites = parsedFavorites;
    try {
      if (window.TrackNormalizer && typeof window.TrackNormalizer.normalizeTrackList === 'function') {
        normalizedFavorites = window.TrackNormalizer.normalizeTrackList(parsedFavorites);
      }
    } catch {}

    const uniqueFavorites = [];
    const seenKeys = new Set();
    for (const fav of normalizedFavorites) {
      const key = getTrackIdentityKey(fav) || (fav && fav.url ? String(fav.url) : '');
      if (!key || seenKeys.has(key)) continue;
      uniqueFavorites.push(fav);
      seenKeys.add(key);
    }
    state.favorites = uniqueFavorites;
    window.logger.info(`Final favorites loaded: ${state.favorites.length} items`, 'UI');

    // Repair corrupted albumTitle data (migration)
    repairCorruptedAlbumTitles();
    repairMissingFavoriteDurations();

    // Notify other modules (e.g., initialization/restore) that resontes/favorites are ready.
    try {
      window.dispatchEvent(new CustomEvent('resonate:favorites-loaded', {
        detail: { count: state.favorites.length }
      }));
    } catch {
      try { window.dispatchEvent(new Event('resonate:favorites-loaded')); } catch {}
    }
    try {
      window.dispatchEvent(new CustomEvent('resonate:resontes-loaded', {
        detail: { count: state.favorites.length }
      }));
    } catch {
      try { window.dispatchEvent(new Event('resonate:resontes-loaded')); } catch {}
    }

    // Precargar favoritos en cola FIFO
    if (state.favoritesPreloadEnabled && typeof audioCache !== 'undefined' && audioCache && typeof audioCache.preloadFavorites === 'function') {
      audioCache.preloadFavorites(state.favorites).catch(err => {
        showStatus('Error preloading resonates for offline: ' + (err && err.message ? err.message : err), 'error', 6000, 'error');
        window.logger.error('Error preloading resonates for offline: ' + (err && err.message ? err.message : err), 'UI');
      });
      window.logger.debug('Favorites preload initiated', 'CACHE');
    }
    // Actualizar estado del botón de reproducción
    updatePlayButtonState();
    // Actualizar la lista visual de favoritos
    updateFavoritesCount();
  } catch (e) {
    window.logger.error(`Error loading favorites: ${e.message}`, 'UI');
    updatePlayButtonState();
  }
}

/**
 * Repairs corrupted albumTitle data where track title was saved as album title.
 * This migration runs once when favorites are loaded and attempts to fetch correct
 * album titles from Archive.org metadata.
 */
async function repairCorruptedAlbumTitles() {
  try {
    // Check if migration was already done
    const migrationDone = localStorage.getItem('resonate_album_title_migration_v1');
    if (migrationDone === 'true') {
      window.logger.debug('Album title migration already completed, skipping', 'UI');
      return;
    }

    let needsSave = false;
    const albumCache = new Map();
    let repairedCount = 0;

    for (const favorite of state.favorites) {
      // Skip if no albumTitle or if albumTitle doesn't match title (likely correct)
      if (!favorite.albumTitle || favorite.albumTitle !== favorite.title) {
        continue;
      }

      // This favorite has albumTitle === title, which indicates corruption
      const albumId = favorite.albumId || favorite.id;
      if (!albumId) continue;

      // Check cache first
      let correctAlbumTitle = albumCache.get(albumId);
      
      if (!correctAlbumTitle) {
        try {
          // Fetch metadata from Archive.org to get correct album title
          if (window.AlbumTracks && typeof window.AlbumTracks.getTracks === 'function') {
            const files = await window.AlbumTracks.getTracks(albumId, { preferCache: true, allowFetch: true });
            if (files && files.length > 0) {
              correctAlbumTitle = files[0].album;
              albumCache.set(albumId, correctAlbumTitle);
            }
          } else if (typeof window.fetchOptimizedPlayableFiles === 'function') {
            const files = await window.fetchOptimizedPlayableFiles(albumId);
            if (files && files.length > 0) {
              correctAlbumTitle = files[0].album;
              albumCache.set(albumId, correctAlbumTitle);
            }
          }
        } catch (err) {
          window.logger.debug(`Could not fetch metadata for album ${albumId}: ${err.message}`, 'UI');
          continue;
        }
      }

      // Update if we found a valid album title that's different from track title
      if (correctAlbumTitle && correctAlbumTitle !== favorite.title) {
        favorite.albumTitle = correctAlbumTitle;
        needsSave = true;
        repairedCount++;
        window.logger.debug(`Repaired albumTitle for track "${favorite.title}" in album ${albumId}`, 'UI');
      }
    }

    if (needsSave) {
      saveFavorites();
      window.logger.info(`Album titles migration completed: ${repairedCount} tracks repaired`, 'UI');
    }

    // Mark migration as done
    localStorage.setItem('resonate_album_title_migration_v1', 'true');
  } catch (err) {
    window.logger.warn(`Error during album title repair: ${err.message}`, 'UI');
  }
}

let repairMissingFavoriteDurationsPromise = null;

async function repairMissingFavoriteDurations() {
  if (repairMissingFavoriteDurationsPromise) return repairMissingFavoriteDurationsPromise;

  repairMissingFavoriteDurationsPromise = (async () => {
    try {
      const favorites = Array.isArray(state.favorites) ? state.favorites : [];
      const missingDurationFavorites = favorites.filter(favorite => {
        if (!favorite || typeof favorite !== 'object') return false;
        return resolveTrackDurationSeconds(favorite) === null && !!(favorite.albumId || favorite.id || favorite.url);
      });

      if (!missingDurationFavorites.length) return;

      const albumIds = Array.from(new Set(
        missingDurationFavorites
          .map(favorite => String(favorite.albumId || favorite.id || '').trim())
          .filter(Boolean)
      ));

      let repairedCount = 0;

      for (const albumId of albumIds) {
        let fetchedTracks = [];

        try {
          if (window.AlbumTracks && typeof window.AlbumTracks.getTracks === 'function') {
            fetchedTracks = await window.AlbumTracks.getTracks(albumId, {
              preferCache: true,
              allowFetch: true,
              preferFullAlbum: true
            });
          } else if (typeof window.fetchOptimizedPlayableFiles === 'function') {
            fetchedTracks = await window.fetchOptimizedPlayableFiles(albumId);
          }
        } catch (err) {
          window.logger?.debug(`Could not repair durations for album ${albumId}: ${err.message}`, 'UI');
          continue;
        }

        if (!Array.isArray(fetchedTracks) || fetchedTracks.length === 0) continue;

        const tracksByKey = new Map();
        fetchedTracks.forEach(track => {
          const key = getTrackIdentityKey(track);
          if (key) tracksByKey.set(key, track);
        });

        const albumFavorites = favorites
          .filter(favorite => String(favorite.albumId || favorite.id || '') === albumId);

        albumFavorites.forEach(favorite => {
            if (resolveTrackDurationSeconds(favorite) !== null) return;

            const favoriteKey = getTrackIdentityKey(favorite);
            let match = favoriteKey ? tracksByKey.get(favoriteKey) : null;

            if (!match && favorite.url) {
              match = fetchedTracks.find(track => track && track.url === favorite.url) || null;
            }

            if (!match && Number.isFinite(Number(favorite.trackIndex))) {
              const favoriteTrackIndex = Number(favorite.trackIndex);
              match = fetchedTracks.find(track => Number(track && track.trackIndex) === favoriteTrackIndex) || null;
            }

            if (!match && albumFavorites.length === 1 && fetchedTracks.length === 1) {
              match = fetchedTracks[0];
            }

            const durationSeconds = resolveTrackDurationSeconds(match);
            if (durationSeconds !== null) {
              favorite.duration = durationSeconds;
              repairedCount += 1;
            }
          });
      }

      if (repairedCount > 0) {
        saveFavorites();
        updateFavoritesList();
        window.logger?.info(`Favorite duration repair completed: ${repairedCount} tracks updated`, 'UI');
      }
    } catch (err) {
      window.logger?.warn(`Error repairing favorite durations: ${err.message}`, 'UI');
    }
  })();

  try {
    await repairMissingFavoriteDurationsPromise;
  } finally {
    repairMissingFavoriteDurationsPromise = null;
  }
}

function saveFavorites() {
  try {
    // Eliminar duplicados antes de guardar
    const uniqueFavorites = [];
    const seenKeys = new Set();
    for (const fav of (state.favorites || [])) {
      const key = getTrackIdentityKey(fav) || (fav && fav.url ? String(fav.url) : '');
      if (key && !seenKeys.has(key)) {
        uniqueFavorites.push(fav);
        seenKeys.add(key);
      }
    }
    state.favorites = uniqueFavorites;
    const payload = JSON.stringify(state.favorites);
    localStorage.setItem('resonate_favorites', payload);
    window.logger.debug('Favorites saved to localStorage', 'UI');
    // Request preload/update of favorites in cache if available
    if (state.favoritesPreloadEnabled && typeof audioCache !== 'undefined' && audioCache && typeof audioCache.preloadFavorites === 'function') {
      audioCache.preloadFavorites(state.favorites).catch(err => {
        showStatus('Error preloading resonates for offline: ' + (err && err.message ? err.message : err), 'error', 6000, 'error');
        window.logger.error('Error preloading resonates for offline: ' + (err && err.message ? err.message : err), 'UI');
      });
      window.logger.debug('Favorites preload requested', 'CACHE');
    }
  } catch (err) {
    window.logger.error(`Error saving favorites: ${err.message}`, 'UI');
  }
}

// Volume control functions
function loadVolume() {
  try {
    const savedVolume = localStorage.getItem('resonate_volume');
    const savedMuted = localStorage.getItem('resonate_muted');

    if (savedVolume !== null) {
      const volume = parseFloat(savedVolume);
      if (!isNaN(volume) && volume >= 0 && volume <= 1) {
        state.currentVolume = volume;
        if (elements.audio) elements.audio.volume = volume;
        if (elements.volumeSlider) {
          elements.volumeSlider.value = volume;
        }
      }
    }

    if (elements.audio) {
      if (savedMuted === 'true') {
        elements.audio.muted = true;
      } else {
        elements.audio.muted = false;
      }
    }

    updateVolumeIcon();
  } catch (e) {
    window.logger?.warn(`Error loading volume settings: ${e.message}`, 'UI');
    // Set default volume
    if (elements.audio) elements.audio.volume = 0.7;
    if (elements.volumeSlider) {
      elements.volumeSlider.value = 0.7;
    }
    state.currentVolume = 0.7;
  }
}

function saveVolume(volume) {
  try {
    localStorage.setItem('resonate_volume', volume.toString());
    state.currentVolume = volume;
  } catch (e) {
    window.logger?.warn(`Error saving volume: ${e.message}`, 'UI');
  }
}

function saveMutedState(muted) {
  try {
    localStorage.setItem('resonate_muted', muted.toString());
  } catch (e) {
    window.logger?.warn(`Error saving mute state: ${e.message}`, 'UI');
  }
}

function updateVolumeIcon() {
  if (!elements.volumeIcon || !elements.volumeSlider) return;

  const volume = elements.audio.muted ? 0 : elements.volumeSlider.value;
  const volumeLevel = parseFloat(volume);

  if (elements.audio.muted || volumeLevel === 0) {
    elements.volumeIcon.textContent = '🔇'; // Muted
  } else if (volumeLevel < 0.3) {
    elements.volumeIcon.textContent = '🔈'; // Low volume
  } else if (volumeLevel < 0.7) {
    elements.volumeIcon.textContent = '🔉'; // Medium volume
  } else {
    elements.volumeIcon.textContent = '🔊'; // High volume
  }
}

function toggleMute() {
  const isMuted = !elements.audio.muted;
  elements.audio.muted = isMuted;

  if (isMuted) {
    // When muting, remember the current volume for unmuting
    state.currentVolume = elements.volumeSlider.value;
    saveMutedState(true);
  } else {
    // When unmuting, restore the previous volume
    elements.audio.volume = state.currentVolume;
    elements.volumeSlider.value = state.currentVolume;
    saveMutedState(false);
  }

  updateVolumeIcon();
  showStatus(isMuted ? 'Volume control toggled' : 'Volume control toggled', 'info', 1000);
}

function isTrackFavorite(track) {
  if (!track) return false;
  const key = getTrackIdentityKey(track);
  return state.favorites.some(fav => {
    const favKey = getTrackIdentityKey(fav);
    if (key && favKey && key === favKey) return true;
    return !!(track.url && fav && fav.url && fav.url === track.url);
  });
}

/**
 * Carga los favoritos desde localStorage, eliminando duplicados, resolviendo conflictos locales
 * y limpiando favoritos huérfanos (sin archivo en caché).
 * Prioriza los favoritos más recientes en caso de conflicto.
 */
function toggleFavorite(track) {
  if (!track || !track.url) return;
  track = normalizeTrackForUi(track, {
    albumId: track.albumId || track.id,
    trackIndex: track.trackIndex,
    totalTracks: track.totalTracks
  });
  const trackKey = getTrackIdentityKey(track);
      // Limpieza automática de favoritos huérfanos:
      // Elimina favoritos cuyo archivo no existe en la caché local (ni en Cache API ni IndexedDB).
  // Only allow .ogg and .mp3 files to be favorited (including URLs with query strings)
  if (!isSupportedAudioUrl(track.url)) {
    showStatus('Only .ogg and .mp3 are supported', 'error');
    return;
  }

  // Sincronizar favoritos antes de modificar
  loadFavorites();

  const isFavorite = isTrackFavorite(track);

  if (isFavorite) {
    state.favorites = state.favorites.filter(fav => {
      const favKey = getTrackIdentityKey(fav);
      if (trackKey && favKey) return favKey !== trackKey;
      return !(fav && fav.url && fav.url === track.url);
    });

      // Resolución automática de conflictos:
      // Fusiona favoritos persistidos y en memoria, priorizando los más recientes (al final de la lista).
    if (state.playbackQueue.some(item => {
      const itemKey = getTrackIdentityKey(item);
      if (trackKey && itemKey) return itemKey === trackKey;
      return !!(item && item.url && track.url && item.url === track.url);
    })) {
      const availableFavorites = state.favorites.filter(fav =>
        !state.playbackQueue.some(item => {
          const itemKey = getTrackIdentityKey(item);
          const favKey = getTrackIdentityKey(fav);
          if (itemKey && favKey) return itemKey === favKey;
          return !!(item && fav && item.url && fav.url && item.url === fav.url);
        })
      );

      if (availableFavorites.length > 0) {
        const randomIndex = Math.floor(Math.random() * availableFavorites.length);
        const newFavorite = availableFavorites[randomIndex];

        // Replace in queue
        const queueIndex = state.playbackQueue.findIndex(item => {
          const itemKey = getTrackIdentityKey(item);
          if (trackKey && itemKey) return itemKey === trackKey;
          return !!(item && item.url && track.url && item.url === track.url);
        });
        if (queueIndex !== -1) {
          state.playbackQueue[queueIndex] = newFavorite;
        }

        // Preload new favorite
        if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.prefetchAudio === 'function') {
          audioCache.prefetchAudio(newFavorite.url, true);
        }
      }
    }

    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.remove === 'function') {
      audioCache.remove(track.url);
    }
    showStatus('Track removed from your resonates', 'info');
  } else {
    // Evitar duplicados
    if (state.favorites.some(fav => {
      const favKey = getTrackIdentityKey(fav);
      if (trackKey && favKey) return favKey === trackKey;
      return !!(fav && fav.url && track.url && fav.url === track.url);
    })) {
      showStatus('Track is already in your resonates', 'info');
      return;
    }
    const favoriteDuration = resolveTrackDurationSeconds(track);
    const favoriteTrack = {
      id: track.id,
      trackId: track.trackId || track.id,
      title: track.title || 'Untitled',
      creator: track.creator || 'Unknown',
      url: track.url,
      duration: favoriteDuration,
      isAlbumTrack: track.isAlbumTrack || false,
      albumId: track.albumId || track.id,
      trackIndex: track.trackIndex || 0,
      totalTracks: track.totalTracks || 1,
      albumTitle: track.album || '',
      downloadOffline: !!track.downloadOffline,
      fileName: track.fileName || track.filename || ''
    };
    state.favorites.push(favoriteTrack);

    // Precargar el favorito en caché
    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.prefetchAudio === 'function') {
      audioCache.prefetchAudio(track.url, true).catch(err => {
        showStatus('Error preloading resonate for offline: ' + (err && err.message ? err.message : err), 'error', 6000, 'error');
        window.logger.error('Error preloading resonate for offline: ' + (err && err.message ? err.message : err), 'UI');
      });
    }

    showStatus('Track added to your resonates', 'info');

    // Animate the header shortcut button to help users discover it
    try {
      const hb = elements.headerResontesBtn || document.getElementById('header-resontes-btn');
      if (hb) {
        hb.classList.remove('pop');
        void hb.offsetWidth; // force reflow
        hb.classList.add('pop');
        hb.addEventListener('animationend', () => hb.classList.remove('pop'), { once: true });
      }
    } catch {}
  }

  saveFavorites();
  updateFavoriteButton();
  updateFavoritesList();
  updateFavoritesCount();

  // Si la pista pertenece a un álbum, verificar si necesitamos actualizar el botón del álbum
  if (track.albumId && track.albumId !== track.id) {
    updateAlbumButtonForTrack(track.albumId);
  }
}

// Toggle per-track offline download preference
async function toggleDownloadOffline(track) {
  if (!track || !track.url || typeof window.audioCache === 'undefined' || !window.audioCache) return;
  try {
    const normalizedTrack = normalizeTrackForUi(track, {
      albumId: track.albumId || track.id,
      trackIndex: track.trackIndex,
      totalTracks: track.totalTracks
    });
    const desired = !!normalizedTrack.downloadOffline;
    const meta = {
      trackId: normalizedTrack.trackId || normalizedTrack.id,
      albumId: normalizedTrack.albumId,
      title: normalizedTrack.title,
      creator: normalizedTrack.creator,
      downloadOffline: desired
    };

    if (desired) {
      await window.audioCache.prefetchAudio(normalizedTrack.url, true);
    }

    if (typeof window.audioCache.updateMetadata === 'function') {
      await window.audioCache.updateMetadata(normalizedTrack.url, meta);
    }

    // Sync favorite entry if present
    const fav = state.favorites.find(f => f.url === normalizedTrack.url);
    if (fav) {
      fav.downloadOffline = desired;
    }

    saveFavorites();
    updateFavoritesList();
  } catch (err) {
    showStatus('Error updating offline download', 'error', 3000, 'error');
    window.logger?.warn(`toggleDownloadOffline failed: ${err.message}`, 'UI');
  }
}
window.toggleDownloadOffline = toggleDownloadOffline;

// FUNCIÓN: Agregar todas las pistas de un álbum a favoritos
function addAlbumToFavorites(albumId, files) {
  if (!files || files.length === 0) return;

  let addedCount = 0;

  try {
    if (window.TrackNormalizer && typeof window.TrackNormalizer.normalizeTrackList === 'function') {
      files = window.TrackNormalizer.normalizeTrackList(files, {
        albumId,
        totalTracks: Array.isArray(files) ? files.length : 0
      });
    }
  } catch {}

  files.forEach((track, index) => {
    const trackKey = getTrackIdentityKey(track);
    // Verificar si la pista ya está en favoritos
    if (!state.favorites.some(fav => {
      const favKey = getTrackIdentityKey(fav);
      if (trackKey && favKey) return favKey === trackKey;
      return !!(fav && fav.url && track.url && fav.url === track.url);
    })) {
      const favoriteTrack = {
        id: track.id,
        trackId: track.trackId || track.id,
        title: track.title || 'Untitled',
        creator: track.creator || 'Unknown',
        url: track.url,
        duration: resolveTrackDurationSeconds(track),
        isAlbumTrack: true,
        albumId: albumId,
        trackIndex: index,
        totalTracks: files.length,
        albumTitle: track.album || files[0]?.album || 'Album',
        downloadOffline: !!track.downloadOffline,
        fileName: track.fileName || track.filename || ''
      };
      state.favorites.push(favoriteTrack);
      addedCount++;

      // Precargar cada favorito en caché
      if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.prefetchAudio === 'function') {
        audioCache.prefetchAudio(track.url, true);
      }
    }
  });

  if (addedCount > 0) {
    saveFavorites();
    updateFavoriteButton();
    updateFavoritesList();
    updateFavoritesCount();
    updatePlayButtonState();
    updateTrackFavoriteStatesInContainer(albumId);
    try { if (typeof window.refreshAllResonteButtons === 'function') window.refreshAllResonteButtons(); } catch {}
    showStatus('Album saved to your resonates', 'info');
  } else {
    showStatus('All tracks are already in your resonates', 'info');
  }
}

// FUNCIÓN: Remover álbum completo de favoritos
function removeAlbumFromFavorites(albumId) {
  const initialCount = state.favorites.length;
  state.favorites = state.favorites.filter(fav => fav.albumId !== albumId);
  const removedCount = initialCount - state.favorites.length;

  // Remover de la cola FIFO de favoritos
  if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.getFavoritesQueue === 'function' && typeof audioCache.removeFromFavoritesQueue === 'function') {
    const favoritesQueue = audioCache.getFavoritesQueue();
    favoritesQueue.forEach(url => {
      const favTrack = state.favorites.find(f => f.url === url);
      if (!favTrack) {
        audioCache.removeFromFavoritesQueue(url);
      }
    });
  }

  saveFavorites();
  updateFavoriteButton();
  updateFavoritesList();
  updateFavoritesCount();
  updatePlayButtonState();
  updateTrackFavoriteStatesInContainer(albumId);
  try { if (typeof window.refreshAllResonteButtons === 'function') window.refreshAllResonteButtons(); } catch {}

  if (removedCount > 0) {
    showStatus(`Album removed completely`, 'info');
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

// FUNCIÓN: Obtener el estado correcto del botón de álbum (incluyendo estado mixto)
function getAlbumButtonState(albumId, trackCount) {
  const albumTracks = state.favorites.filter(fav => fav.albumId === albumId);
  const favoritedCount = albumTracks.length;

  if (favoritedCount === trackCount) {
    // Todas las pistas están en favoritos
    return { action: 'remove', label: 'Remove from resonates', isActive: true };
  } else if (favoritedCount === 0) {
    // Ninguna pista está en favoritos
    return { action: 'add', label: 'Add to resonates', isActive: false };
  } else {
    // Estado mixto: algunas pistas favoritas, otras no
    return { action: 'complete', label: 'Complete album', isActive: false };
  }
}

// FUNCIÓN: Actualizar el estado de favoritos de las pistas individuales en contenedores abiertos
function updateTrackFavoriteStatesInContainer(albumId) {
  // Buscar contenedores de pistas abiertos para este álbum
  const tracksContainers = document.querySelectorAll('.tracks-container');

  tracksContainers.forEach(container => {
    // Verificar si este contenedor pertenece al álbum especificado
    // (el contenedor anterior debería ser el elemento del álbum)
    const previousElement = container.previousElementSibling;
    if (previousElement && previousElement.classList.contains('search-result')) {
      // Para elementos de búsqueda, verificar si el identifier coincide
      const resultEl = previousElement;
      // No podemos acceder fácilmente al identifier desde aquí, así que verificamos todas las pistas

      const trackItems = container.querySelectorAll('.track-item');
      trackItems.forEach(trackItem => {
        const favoriteBtn = trackItem.querySelector('.track-favorite');
        if (favoriteBtn) {
          // Buscar el botón play que tiene data-url
          const playBtn = trackItem.querySelector('.track-play');
          if (playBtn && playBtn.dataset.url) {
            const trackUrl = playBtn.dataset.url;
            const isFavorite = isTrackFavorite({ url: trackUrl });
            applyResonteButtonState(favoriteBtn, isFavorite);
          }
        }
      });
    }
  });
}

// FUNCIÓN: Actualizar el estado de favorito en los resultados de búsqueda
function updateSearchResultFavoriteState(albumId, isFavorite) {
  const safeAlbumId = albumId ? String(albumId) : '';
  if (!safeAlbumId) return;

  // New card grid path
  try {
    const cards = document.querySelectorAll(`.content-card[data-album-id="${CSS.escape(safeAlbumId)}"]`);
    cards.forEach(card => {
      const favoriteBtn = card.querySelector('.card-btn.favorite');
      if (!favoriteBtn) return;
      applyResonteButtonState(favoriteBtn, !!isFavorite);
    });
  } catch {}

  // Legacy list path
  const resultElements = document.querySelectorAll('.search-result');
  resultElements.forEach(resultEl => {
    const resultInfo = resultEl.querySelector('.result-info');
    if (resultInfo && resultInfo.textContent.includes(safeAlbumId)) {
      const favoriteBtn = resultEl.querySelector('.result-favorite');
      if (favoriteBtn) {
        applyResonteButtonState(favoriteBtn, !!isFavorite);
      }
    }
  });
}

function updateContentCardPlayingState(albumId) {
  try {
    document.querySelectorAll('.content-card.is-playing').forEach(card => {
      card.classList.remove('is-playing');
      const prev = card.getAttribute('aria-label') || '';
      if (prev.startsWith('Now playing: ')) {
        card.setAttribute('aria-label', prev.slice('Now playing: '.length));
      }
    });
    const safeId = albumId ? String(albumId) : '';
    if (!safeId) return;
    document.querySelectorAll(`.content-card[data-album-id="${CSS.escape(safeId)}"]`).forEach(card => {
      card.classList.add('is-playing');
      const prev = card.getAttribute('aria-label') || '';
      if (!prev.startsWith('Now playing: ')) {
        card.setAttribute('aria-label', `Now playing: ${prev}`);
      }
    });
  } catch { /* DOM operation failures are non-critical and safe to ignore */ }
}

// FUNCIÓN: Actualizar el botón de álbum cuando cambia el estado de una pista individual
function updateAlbumButtonForTrack(albumId) {
  // Buscar todos los botones de álbum que correspondan a este albumId
  const albumButtons = document.querySelectorAll('.result-favorite');

  albumButtons.forEach(button => {
    // Encontrar el elemento padre que contiene la información del álbum
    const resultEl = button.closest('.search-result');
    if (resultEl) {
      // Obtener el número de pistas del álbum desde el metadata
      const metaElement = resultEl.querySelector('.result-meta');
      if (metaElement) {
        const metaText = metaElement.textContent;
        const trackMatch = metaText.match(/(\d+)\s+(tracks?|pistas?)/i);
        if (trackMatch) {
          const trackCount = parseInt(trackMatch[1]);
          const buttonState = getAlbumButtonState(albumId, trackCount);

          button.classList.toggle('active', buttonState.isActive);
          button.innerHTML = window.resonateLogoSVG || '';
          button.title = buttonState.label;
          button.setAttribute('aria-label', buttonState.label);
        }
      }
    }
  });
}

function updateFavoriteButton() {
  const btn = elements && elements.favoriteBtn ? elements.favoriteBtn : null;
  if (!btn) return;

  const hasTrack = !!(state.currentTrack && state.currentTrack.url);
  const isResonte = hasTrack ? isTrackFavorite(state.currentTrack) : false;

  applyResonteButtonState(btn, isResonte);
}

function showStatus(message, type = 'info', duration = null, priority = 'normal', showSpinner = false) {
  // Status messages disabled - no-op function
  return;
}

async function setArtwork(track, identifier) {
  if (!track || !elements.art) return;

  // Clear existing artwork
  elements.art.innerHTML = '';

  // Get safe identifier
  const safeIdentifier = identifier || (track && track.id) || (track && track.identifier) || 'default';

  try {
    // Load cover using centralized manager
    const coverUrl = window.CoverManager?.getCoverUrl
      ? window.CoverManager.getCoverUrl(safeIdentifier)
      : `https://archive.org/services/img/${encodeURIComponent(safeIdentifier)}`;

    if (window.CoverManager?.loadCover) {
      const img = await window.CoverManager.loadCover(safeIdentifier, {
        alt: 'Album cover',
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        borderRadius: '12px',
        showFallback: false
      });
      elements.art.appendChild(img);
    } else if (coverUrl) {
      const img = new Image();
      img.alt = 'Album cover';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '12px';
      img.src = coverUrl;
      elements.art.appendChild(img);
    }
  } catch (error) {
    window.logger?.warn({ message: 'Failed to load artwork', error }, 'UI');
    const fallbackUrl = `https://archive.org/services/img/${encodeURIComponent(safeIdentifier)}`;
    try {
      const img = new Image();
      img.alt = 'Album cover';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '12px';
      img.src = fallbackUrl;
      elements.art.appendChild(img);
    } catch {}
  }
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatAlbumDuration(seconds) {
  if (!seconds || !isFinite(seconds) || seconds <= 0) return '';
  const totalMins = Math.round(seconds / 60);
  if (totalMins < 60) return `${totalMins} min`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}min`;
}

function hideTracksListPanel() {
  if (!elements.tracksListContainer) return;

  try { elements.tracksListContainer.style.display = 'none'; } catch {}
  try { elements.tracksListContainer.classList.remove('tracks-inline'); } catch {}
  try { document.body.classList.remove('tracks-open'); } catch {}
  if (elements.toggleTracksBtn) {
    try { elements.toggleTracksBtn.classList.remove('active'); } catch {}
    try { elements.toggleTracksBtn.setAttribute('aria-expanded', 'false'); } catch {}
  }
}

function hideOfflineMusicSection() {
  const offlineSection = document.getElementById('offline-music-section');
  if (!offlineSection) return;
  try { offlineSection.style.display = 'none'; } catch {}
}

function preparePlaybackTransitionFromList({
  closeSearch = true,
  closeResontes = true,
  closeTracksPanel = true,
  closeOfflineList = false,
  collapseExpandedAlbums = true,
  showLoader = false,
  loaderContext = 'playback',
  showProgress = false
} = {}) {
  if (closeTracksPanel) hideTracksListPanel();
  if (closeOfflineList) hideOfflineMusicSection();

  if (closeSearch) {
    hideSearchResults();
  } else if (closeResontes) {
    hideResontesList();
  }

  if (collapseExpandedAlbums && typeof window.collapseAllExpandedAlbums === 'function') {
    try { window.collapseAllExpandedAlbums(); } catch {}
  }

  if (showLoader && window.Loaders && typeof window.Loaders.showLoader === 'function') {
    window.Loaders.showLoader({ type: 'spinner', showProgress, context: loaderContext });
  }
}

function hideSearchResults() {
  // Abort any ongoing search operations
  if (typeof window.abortAllSearchOperations === 'function') {
    window.abortAllSearchOperations();
  }
  
  elements.searchResults.classList.remove('active');
  try {
    if (elements.searchResultsHeader) elements.searchResultsHeader.hidden = true;
  } catch {}
  state.searchActive = false;
  setSearchOpenState(false);
  hideFavoritesList();
}

function updateMediaPositionState() {
  // Use the new MediaSessionManager - this should only be called on state changes
  // (play, pause, seek) to optimize battery usage
  if (!window.mediaSessionManager || !window.mediaSessionManager.isSupported) {
    return;
  }

  const castState = (window.CastManager && typeof window.CastManager.getRemotePositionState === 'function')
    ? window.CastManager.getRemotePositionState()
    : null;
  const useCast = !!(castState && typeof castState.duration === 'number');
  
  if (!useCast && !elements.audio.duration) {
    return;
  }

  try {
    if (useCast) {
      window.mediaSessionManager.updatePositionState({
        duration: castState.duration,
        playbackRate: castState.playbackRate || 1,
        position: castState.position || 0
      });
    } else {
      window.mediaSessionManager.updatePositionState({
        duration: elements.audio.duration,
        playbackRate: elements.audio.playbackRate,
        position: elements.audio.currentTime
      });
    }
  } catch (error) {
    window.logger?.warn({ message: 'Error updating Media Session position', error }, 'PLAYBACK');
  }
}

function updateMediaSessionMetadata(track, identifier) {
  // Use the new MediaSessionManager
  if (!window.mediaSessionManager || !window.mediaSessionManager.isSupported) {
    return;
  }

  try {
    window.mediaSessionManager.updateMetadata(track, identifier);
  } catch (error) {
    window.logger?.warn({ message: 'Error updating Media Session metadata', error }, 'PLAYBACK');
  }
}

function setupSearchOnEnter() {
  ensureSearchInputControllerBound();
}

function setupSearchFocusBehavior() {
  ensureSearchInputControllerBound();
}

function performCompleteCleanup() {
  // Ocultar resultados visualmente
  hideSearchResults();

  // Limpiar estado de búsqueda
  state.searchResults = [];
  state.currentSearchQuery = '';
  state.currentSearchPage = 0;
  state.currentSearchHasMore = false;
  state.currentSearchTotal = null;
  state.isLoadingMore = false;
  state.searchActive = false;

  // Limpiar timeouts
  if (state.searchTimeout) {
    clearTimeout(state.searchTimeout);
    state.searchTimeout = null;
  }

  // Limpiar cualquier observador de lazy loading
  try {
    if (state._searchLazyObserver) {
      try { state._searchLazyObserver.disconnect(); } catch {}
      state._searchLazyObserver = null;
    }
    if (state._searchLazyObserverEl) {
      try { state._searchLazyObserverEl.remove(); } catch {}
      state._searchLazyObserverEl = null;
    } else {
      const lazyObserver = elements.searchResultsList.querySelector('.lazy-load-observer');
      if (lazyObserver) lazyObserver.remove();
    }
  } catch {}

  // Limpiar el DOM
  elements.searchResultsList.innerHTML = '';

  window.logger?.debug('Cleanup complete: search results hidden and state reset', 'UI');
}

// Keyboard navigation for search results
function navigateSearchResults(direction) {
  try {
    if (!elements.searchResults || !elements.searchResults.classList.contains('active')) return;
    if (!elements.searchResultsList) return;

    const cards = Array.from(elements.searchResultsList.querySelectorAll('.content-card'));
    if (!cards.length) return;

    const currentFocused = elements.searchResultsList.querySelector('.content-card.focused');
    let nextCard;

    if (!currentFocused) {
      nextCard = direction === 'down' ? cards[0] : cards[cards.length - 1];
    } else {
      const currentIndex = cards.indexOf(currentFocused);
      let nextIndex = direction === 'down' ? currentIndex + 1 : currentIndex - 1;
      if (nextIndex < 0) nextIndex = cards.length - 1;
      if (nextIndex >= cards.length) nextIndex = 0;
      nextCard = cards[nextIndex];
    }

    for (const c of cards) c.classList.remove('focused');
    if (!nextCard) return;
    nextCard.classList.add('focused');

    try { nextCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch {}
    try { nextCard.focus({ preventScroll: true }); } catch { try { nextCard.focus(); } catch {} }
  } catch {
    // ignore
  }
}

// Show skeleton loaders while search is in progress
function showSearchSkeletons(count = 8) {
  if (!elements.searchResultsList) return;
  
  // Show search results panel if not already visible
  if (elements.searchResults && !elements.searchResults.classList.contains('active')) {
    elements.searchResults.classList.add('active');
    try {
      initializePanelToolbarsOnce();
      if (elements.searchResultsHeader) elements.searchResultsHeader.hidden = false;
      if (elements.searchResultsCount) {
        elements.searchResultsCount.innerHTML = '<div class="search-status-message"><div class="search-status-spinner"></div><span>Searching...</span></div>';
      }
    } catch {}
    state.searchActive = true;
    setSearchOpenState(true);
    scheduleSearchInsetsBurst();
  }
  
  // Create skeleton cards
  const skeletonHTML = Array.from({ length: count }, () => `
    <div class="search-skeleton-card">
      <div class="search-skeleton-cover"></div>
      <div class="search-skeleton-content">
        <div class="search-skeleton-title"></div>
        <div class="search-skeleton-subtitle"></div>
      </div>
    </div>
  `).join('');
  
  elements.searchResultsList.innerHTML = `<div class="search-skeleton-container">${skeletonHTML}</div>`;
}

function displaySearchResults(searchData, clearExisting = true) {
  // Hide search loader when results arrive
  try {
    if (window.Loaders && typeof window.Loaders.hideLoader === 'function') {
      window.Loaders.hideLoader();
    }
  } catch {}

  if (!searchData) return;
  const { hasMore, total } = searchData;
  const deferred = searchData.deferredMetadata === true;
  const resultsRaw = Array.isArray(searchData.results) ? searchData.results : [];
  const results = deferred
    ? resultsRaw.map(r => {
      try { return Object.assign({}, r, { __metaPending: true }); } catch { return r; }
    })
    : resultsRaw;
  const offlineOnly = !!(state.searchUi && state.searchUi.offlineOnly);

  if (clearExisting) {
    elements.searchResultsList.innerHTML = '';
    state.searchResults = results;
    state.currentSearchPage = 0;
    state.currentSearchHasMore = hasMore;
    state.currentSearchTotal = (typeof total === 'number' && isFinite(total) && total >= 0) ? total : null;
    // Keep the executed query stable (input may change while results are inflight)
    state.currentSearchQuery = (state.currentSearchQuery || (elements.searchInput ? elements.searchInput.value : '') || '').trim();
  } else {
    state.searchResults = [...state.searchResults, ...results];
    state.currentSearchHasMore = hasMore;
    if (typeof total === 'number' && isFinite(total) && total >= 0) state.currentSearchTotal = total;
  }

  // Perf: log submit → first paint for the initial page render.
  if (clearExisting) {
    try {
      maybeLogSearchPerfFirstPaint({ requestId: state.searchRequestId || 0, query: state.currentSearchQuery || '' });
    } catch {}
  }

  // Ensure toolbar bindings exist
  try { initializePanelToolbarsOnce(); } catch {}
  
  // Ensure filters are visible for result views
  try {
    ensureSearchFilterDefaults();
    ensureSearchFiltersHeader();
  } catch {}

  // Update toolbar visibility + count
  try {
    if (elements.searchResultsHeader) elements.searchResultsHeader.hidden = false;
    updateSearchResultsCount();
    if (elements.searchOfflineOnly) {
      elements.searchOfflineOnly.checked = !!(state.searchUi && state.searchUi.offlineOnly);
      try { setBodyUiState('search-show-offline-chips', !!(state.searchUi && state.searchUi.offlineOnly)); } catch {}
    }
  } catch {}

  if (results.length === 0 && clearExisting) {
    const currentQuery = (elements.searchInput && elements.searchInput.value) ? elements.searchInput.value.trim() : '';
    const suggestions = getNoResultsSuggestions(currentQuery);
    const suggestionsHtml = suggestions.length
      ? `<div class="no-results-hint" style="margin-top: 10px;">Try one of these:</div>
         <div class="search-history-list" role="list">${suggestions.map(q => (
           `<div class="search-history-item" role="listitem" data-query="${escapeHtml(q)}">
              <span class="history-query">${escapeHtml(q)}</span>
            </div>`
         )).join('')}</div>`
      : '';

    elements.searchResultsList.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">🔍</div>
        <div class="no-results-title">No Results Found</div>
        <div class="no-results-hint">Try different keywords or check your spelling</div>
        ${suggestionsHtml}
      </div>
    `;

    // Wire suggestion clicks to run a new search.
    try {
      const nodes = elements.searchResultsList.querySelectorAll('.search-history-item[data-query]');
      nodes.forEach(n => {
        n.addEventListener('click', () => {
          const q = String(n.getAttribute('data-query') || '').trim();
          if (!q) return;
          elements.searchInput.value = q;
          dispatchSearchWithFastPath(q, { keepKeyboard: true, addToHistory: true });
        });
      });
    } catch {}

    elements.searchResults.classList.add('active');
    state.searchActive = true;
    setSearchOpenState(true);
    scheduleSearchInsetsBurst();
    // Volver a deshabilitar los controles si no hay resultados
    if (state.favorites.length === 0) {
      updatePlayButtonState();
    }
    return;
  }

  // Grid always (favorites + search): improves consistency and theming
  state.viewMode = 'grid';

  // Render strategy:
  // - Full render when starting a new search
  // - Full render when offline-only filter is active (needs full filtering)
  // - Full render when a local type filter is active (needs full filtering)
  // - Incremental append for lazy-load pages (avoid O(n^2) rerender/duplication)
  const typeFilterActive = !!(state.searchUi && state.searchUi.typeFilter);
  if (clearExisting || offlineOnly || typeFilterActive) {
    rerenderSearchResultsFromState(true);
  } else {
    // Append only the new page.
    renderCardGrid(elements.searchResultsList, results, 'search', false);
    // If offline-only is toggled later, rerenderSearchResultsFromState will rebuild.
  }

  // Configurar lazy loading si hay más resultados
  if (hasMore && SEARCH_CONFIG.enableLazyLoading) {
    setupLazyLoadingObserver();
  }

  elements.searchResults.classList.add('active');

  state.searchActive = true;
  setSearchOpenState(true);
  scheduleSearchInsetsBurst();

  // Habilitar controles si hay resultados de búsqueda
  enableControlsForSearchResults();

  try {
    if (typeof window.scheduleOverflowTickerUpdate === 'function') {
      window.scheduleOverflowTickerUpdate();
    }
  } catch {}

  // Background prefetch: keep 2 pages ahead for infinite scroll
  try {
    if (typeof window.prefetchNextSearchPages === 'function') {
      const rid = state.searchRequestId || 0;
      const ahead = clearExisting ? 1 : 2;
      const delayMs = clearExisting ? 1200 : 400;
      setTimeout(() => {
        try {
          if ((state.searchRequestId || 0) !== rid) return;
          window.prefetchNextSearchPages(state.currentSearchQuery, state.currentSearchPage, state.currentSearchHasMore, ahead);
        } catch {}
      }, delayMs);
    }
  } catch {}
}

function getNoResultsSuggestions(query) {
  try {
    const q = String(query || '').trim();
    if (!q) return [];
    const qn = q.toLowerCase();
    const history = loadSearchHistory();
    if (!Array.isArray(history) || history.length === 0) return [];
    // Prefer recent history containing the query or sharing tokens.
    const tokens = qn.split(/\s+/g).filter(t => t.length >= 2).slice(0, 6);
    const scored = history.map(item => {
      const hq = item.query;
      const hn = hq.toLowerCase();
      let score = 0;
      if (hn.includes(qn)) score += 5;
      for (const t of tokens) {
        if (hn.includes(t)) score += 1;
      }
      return { hq, score };
    }).filter(x => x.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map(x => x.hq);
  } catch {
    return [];
  }
}

function getSearchResultsCountText(filteredCount = null) {
  try {
    const baseCount = Array.isArray(state.searchResults) ? state.searchResults.length : 0;
    const totalCount = (typeof state.currentSearchTotal === 'number' && isFinite(state.currentSearchTotal) && state.currentSearchTotal >= 0)
      ? state.currentSearchTotal
      : null;
    const hasFilters = !!((state.searchUi && state.searchUi.offlineOnly) || (state.searchUi && state.searchUi.typeFilter));
    const query = (state.currentSearchQuery || '').trim();
    const forLabel = query ? ` for "${query}"` : '';

    if (hasFilters && typeof filteredCount === 'number' && isFinite(filteredCount)) {
      const parts = [];
      if (totalCount !== null && totalCount > baseCount) {
        parts.push(`Showing ${filteredCount} of ${baseCount} loaded`);
        parts.push(`Total: ${totalCount}`);
      } else {
        parts.push(`${filteredCount} / ${baseCount} results${forLabel}`);
      }
      const typeLabel = (state.searchUi && state.searchUi.typeFilter) ? getSearchTypeFilterLabel(state.searchUi.typeFilter) : '';
      if (typeLabel) parts.push(typeLabel);
      if (state.searchUi && state.searchUi.offlineOnly) parts.push('Offline');
      return parts.join(' • ');
    }

    return totalCount !== null && totalCount > 0
      ? `${baseCount} of ${totalCount} results${forLabel}`
      : `${baseCount} result${baseCount !== 1 ? 's' : ''}${forLabel}`;
  } catch {
    return '0 results';
  }
}

function updateSearchResultsCount(filteredCount = null) {
  try {
    if (!elements.searchResultsCount) return;
    elements.searchResultsCount.textContent = getSearchResultsCountText(filteredCount);
  } catch {}
}

async function loadNextSearchResultsPage() {
  try {
    if (!state.currentSearchHasMore || state.isLoadingMore) return false;

    state.isLoadingMore = true;
    const nextPage = (Number.isFinite(state.currentSearchPage) ? state.currentSearchPage : 0) + 1;
    const result = await (window.performOptimizedSearch || performOptimizedSearch)(state.currentSearchQuery, nextPage, {
      showLoader: false,
      activateUI: false,
      abortPrevious: false,
      deferMetadata: true
    });
    state.currentSearchPage = nextPage;
    displaySearchResults(result, false);
    return true;
  } catch (error) {
    window.logger?.warn({ message: 'Error en lazy loading', error }, 'NETWORK');
    return false;
  } finally {
    state.isLoadingMore = false;
  }
}

function renderFilteredSearchEmptyState() {
  try {
    if (!elements.searchResultsList) return false;
    const hasOffline = !!(state.searchUi && state.searchUi.offlineOnly);
    const hasType = !!(state.searchUi && state.searchUi.typeFilter);
    if (!hasOffline && !hasType) return false;

    const activeParts = [];
    if (hasOffline) activeParts.push('Offline only');
    if (hasType) activeParts.push(getSearchTypeFilterLabel(state.searchUi.typeFilter));
    const activeLabel = activeParts.length ? activeParts.join(' • ') : 'Filters';
    const canLoadMore = !!state.currentSearchHasMore;
    const hint = canLoadMore
      ? `${activeLabel}. No match yet in the loaded results. Load more results or clear the filter.`
      : `${activeLabel}. No matches were found in the loaded results. Clear the filter or try another search.`;

    elements.searchResultsList.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">🔎</div>
        <div class="no-results-title">No matches in loaded results</div>
        <div class="no-results-hint">${hint}</div>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:12px;">
          ${canLoadMore ? '<button type="button" class="search-option-btn" data-action="load-more-results">Load more results</button>' : ''}
          ${hasOffline ? '<button type="button" class="search-option-btn" data-action="clear-offline">Show online too</button>' : ''}
          ${hasType ? '<button type="button" class="search-option-btn" data-action="clear-type">Show all types</button>' : ''}
        </div>
      </div>
    `;

    try {
      const loadMoreBtn = elements.searchResultsList.querySelector('button[data-action="load-more-results"]');
      if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', async (e) => {
          try { e.preventDefault(); e.stopPropagation(); } catch {}
          if (loadMoreBtn.disabled) return;
          loadMoreBtn.disabled = true;
          const prevLabel = loadMoreBtn.textContent;
          loadMoreBtn.textContent = 'Loading…';
          try {
            const loaded = await loadNextSearchResultsPage();
            if (!loaded && !state.currentSearchHasMore) rerenderSearchResultsFromState(true);
          } finally {
            if (loadMoreBtn && loadMoreBtn.isConnected) {
              loadMoreBtn.disabled = false;
              loadMoreBtn.textContent = prevLabel;
            }
          }
        });
      }
    } catch {}

    try {
      const clearOff = elements.searchResultsList.querySelector('button[data-action="clear-offline"]');
      if (clearOff) {
        clearOff.addEventListener('click', (e) => {
          try { e.preventDefault(); e.stopPropagation(); } catch {}
          state.searchUi = state.searchUi || {};
          state.searchUi.offlineOnly = false;
          try { ensureSearchFiltersHeader(); } catch {}
          rerenderSearchResultsFromState(true);
        });
      }
    } catch {}

    try {
      const clearType = elements.searchResultsList.querySelector('button[data-action="clear-type"]');
      if (clearType) {
        clearType.addEventListener('click', (e) => {
          try { e.preventDefault(); e.stopPropagation(); } catch {}
          state.searchUi = state.searchUi || {};
          state.searchUi.typeFilter = '';
          try { ensureSearchFiltersHeader(); } catch {}
          rerenderSearchResultsFromState(true);
        });
      }
    } catch {}

    return true;
  } catch {
    return false;
  }
}

function rerenderSearchResultsFromState(clearExisting = true) {
  const base = Array.isArray(state.searchResults) ? state.searchResults : [];

  // Decorate with stable indices so playback can reference the original result index.
  let viewItems = base.map((r, i) => {
    try {
      const copy = Object.assign({}, r);
      copy.__globalIndex = i;
      return copy;
    } catch {
      return r;
    }
  });

  // Offline filter (real cache)
  const offlineOnly = !!(state.searchUi && state.searchUi.offlineOnly);
  try { setBodyUiState('search-show-offline-chips', offlineOnly); } catch {}
  if (offlineOnly) {
    viewItems = viewItems.filter(item => {
      const id = item && item.identifier ? String(item.identifier) : '';
      return isAlbumOfflineAvailableSync(id);
    });
  }

  // Local type filter (Single/Album)
  const typeFilter = (state.searchUi && typeof state.searchUi.typeFilter === 'string') ? state.searchUi.typeFilter.trim().toLowerCase() : '';
  if (typeFilter) {
    viewItems = viewItems.filter(item => itemMatchesSearchTypeFilter(item, typeFilter));
  }

  // Filtered empty-state: avoid a blank panel when the base results exist.
  try {
    if (elements.searchResultsList && base.length > 0 && viewItems.length === 0 && renderFilteredSearchEmptyState()) {
      updateSearchResultsCount(0);
      return;
    }
  } catch {}

  // Progressive render for better time-to-first-visualization.
  // Paint first 6 cards immediately; append the rest in chunks.
  try {
    const host = elements.searchResultsList;
    const token = (state._searchProgressiveRenderToken = (state._searchProgressiveRenderToken || 0) + 1);
    const firstCount = 6;
    const chunkSize = 24;

    if (clearExisting && host && viewItems.length > firstCount) {
      const first = viewItems.slice(0, firstCount);
      const rest = viewItems.slice(firstCount);
      renderCardGrid(host, first, 'search', true);

      const appendChunks = (offset) => {
        if ((state._searchProgressiveRenderToken || 0) !== token) return;
        const slice = rest.slice(offset, offset + chunkSize);
        if (!slice.length) return;
        renderCardGrid(host, slice, 'search', false);
        const next = offset + chunkSize;
        if (next < rest.length) {
          requestAnimationFrame(() => appendChunks(next));
        }
      };

      requestAnimationFrame(() => appendChunks(0));
    } else {
      renderCardGrid(host, viewItems, 'search', clearExisting);
    }
  } catch {
    renderCardGrid(elements.searchResultsList, viewItems, 'search', clearExisting);
  }

  // Refresh count label for filtered views (offline/type).
  // Otherwise, keep the main label managed by displaySearchResults (supports X / total).
  try {
    updateSearchResultsCount(viewItems.length);
  } catch {}
}

function getSearchTypeFilterLabel(typeId) {
  const id = String(typeId || '').trim().toLowerCase();
  if (!id) return '';
  if (id === 'single') return 'Single';
  if (id === 'album') return 'Album';
  return id;
}

function itemMatchesSearchTypeFilter(item, typeId) {
  try {
    const id = String(typeId || '').trim().toLowerCase();
    if (!id) return true;

    // Deterministic classification when enrichment is available.
    // search.js sets:
    // - trackCount: number of playable audio files
    // - isAlbum: true when trackCount > 1
    const tc = (item && typeof item.trackCount === 'number' && isFinite(item.trackCount)) ? item.trackCount : null;
    const isAlbum = (item && item.isAlbum === true) || (tc != null && tc > 1);
    const isSingle = (tc != null && tc === 1) || (item && item.isAlbum === false);
    const isKnownUnplayable = (tc != null && tc <= 0) || (item && item.unplayable === true);

    if (id === 'album') {
      if (isKnownUnplayable) return false;
      if (tc != null || item.isAlbum === true || item.isAlbum === false) return isAlbum;
      // If not enriched yet, fall back to heuristics below.
    }

    if (id === 'single') {
      if (isKnownUnplayable) return false;
      if (tc != null || item.isAlbum === true || item.isAlbum === false) return isSingle;
      // If not enriched yet, fall back to heuristics below.
    }

    const title = String(item && item.title ? item.title : '').toLowerCase();
    const desc = String(item && item.description ? item.description : '').toLowerCase();
    const creator = String(item && item.creator ? item.creator : '').toLowerCase();
    const colRaw = item && item.collection != null ? item.collection : '';
    const col = Array.isArray(colRaw) ? colRaw.join(' ').toLowerCase() : String(colRaw || '').toLowerCase();
    const blob = `${title} ${desc} ${creator} ${col}`;

    const hasWord = (re) => {
      try { return re.test(blob); } catch { return false; }
    };

    if (id === 'album') {
      // Heuristic: if we don't have trackCount yet, infer from text.
      return hasWord(/\balbum\b/i) || hasWord(/\bfull\s+album\b/i) || hasWord(/\bdiscography\b/i) || hasWord(/\b(lp|ep)\b/i);
    }

    if (id === 'single') {
      // Heuristic: if we don't have trackCount yet, infer from text.
      return hasWord(/\bsingle\b/i) || hasWord(/\b7\s*\"\b/i) || hasWord(/\b45\s*rpm\b/i) || hasWord(/\b45rpm\b/i);
    }

    return true;
  } catch {
    return true;
  }
}

function setupLazyLoadingObserver() {
  try {
    if (!elements.searchResultsList) return;

    // Ensure a single sentinel element
    if (state._searchLazyObserverEl && state._searchLazyObserverEl.parentNode) {
      // keep existing
    } else {
      const existingEl = elements.searchResultsList.querySelector('.lazy-load-observer');
      if (existingEl) {
        state._searchLazyObserverEl = existingEl;
      } else {
        const observerElement = document.createElement('div');
        observerElement.className = 'lazy-load-observer';
        elements.searchResultsList.appendChild(observerElement);
        state._searchLazyObserverEl = observerElement;
      }
    }

    // Ensure a single observer instance
    if (!state._searchLazyObserver) {
      state._searchLazyObserver = new IntersectionObserver(async (entries) => {
        try {
          if (!entries || !entries[0] || !entries[0].isIntersecting) return;
          await loadNextSearchResultsPage();
        } catch {}
      }, {
        rootMargin: '100px',
        threshold: 0.1
      });
    }

    try { state._searchLazyObserver.disconnect(); } catch {}
    state._searchLazyObserver.observe(state._searchLazyObserverEl);
  } catch {
    // ignore
  }
}

// When background enrichment completes (search.js), update the already-rendered cards
// without forcing a full rerender.
try {
  if (typeof window.onSearchPageEnriched !== 'function') {
    window.onSearchPageEnriched = function onSearchPageEnriched({ query, page } = {}) {
      try {
        const q = String(query || '').trim();
        const p = Number(page);
        if (!q || !Number.isFinite(p)) return;
        if (!state) return;
        // Be tolerant: search.js may normalize the query differently than the UI input.
        // We prefer not to bail out here; instead we only update cards that still exist.
        const currentQ = String(state.currentSearchQuery || '').trim();
        const normalizeQ = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
        const mismatch = currentQ && q && normalizeQ(currentQ) !== normalizeQ(q);

        const keyFn = window.__resonateGetSearchCacheKey;
        const cacheKey = (typeof keyFn === 'function') ? keyFn(q, p) : `search:${q}:${p}`;
        const cached = window.enhancedCache && window.enhancedCache.get('search', cacheKey);
        if (!cached || cached.deferredMetadata !== false || !Array.isArray(cached.results)) return;

        // Update state by identifier so playback/type classification stays correct
        // even when pagination math or filters differ from cache layout.
        try {
          if (Array.isArray(state.searchResults)) {
            for (const enriched of cached.results) {
              if (!enriched || !enriched.identifier) continue;
              const idx = state.searchResults.findIndex(r => r && r.identifier === enriched.identifier);
              if (idx >= 0) {
                const merged = Object.assign({}, state.searchResults[idx], enriched);
                try { delete merged.__metaPending; } catch {}
                state.searchResults[idx] = merged;
              }
            }
          }
        } catch {}

        // If the user is filtering by Single/Album, enrichment can change membership
        // (trackCount becomes known). Rerender (debounced) to keep results accurate.
        try {
          const tf = (state.searchUi && typeof state.searchUi.typeFilter === 'string') ? state.searchUi.typeFilter.trim().toLowerCase() : '';
          const needsRerender = (tf === 'single' || tf === 'album');
          if (needsRerender && typeof rerenderSearchResultsFromState === 'function') {
            if (state._typeFilterRerenderTimer) {
              try { clearTimeout(state._typeFilterRerenderTimer); } catch {}
            }
            state._typeFilterRerenderTimer = setTimeout(() => {
              try {
                // Only rerender if search panel is still active.
                if (state.searchActive && elements && elements.searchResultsList) {
                  rerenderSearchResultsFromState(true);
                }
              } catch {}
            }, 120);
          }
        } catch {}

        // Update cards in DOM (type chip, track count, expand visibility).
        for (let i = 0; i < cached.results.length; i++) {
          const item = cached.results[i];
          if (!item || !item.identifier) continue;

          const safeId = String(item.identifier);
          const root = elements.searchResultsList || document;
          const cards = Array.from(root.querySelectorAll(
            `.content-card[data-album-id="${CSS.escape(safeId)}"]`
          ));
          if (!cards.length) continue;

          const isAlbum = ((item.trackCount || 0) > 1 || item.isAlbum === true);

          for (const card of cards) {
            const typeChip = card.querySelector('.chip-type');
            if (typeChip) typeChip.textContent = isAlbum ? 'Album' : 'Single';

            const trackCountChip = card.querySelector('.chip-track-count');
            const tc = (typeof item.trackCount === 'number' && isFinite(item.trackCount)) ? item.trackCount : null;
            if (tc && tc > 0) {
              if (trackCountChip) {
                trackCountChip.textContent = `${tc} tracks`;
              } else {
                const chips = card.querySelector('.card-chips');
                if (chips) {
                  const chip = document.createElement('span');
                  chip.className = 'chip chip-quiet chip-track-count';
                  chip.textContent = `${tc} tracks`;
                  chips.appendChild(chip);
                }
              }
            } else if (trackCountChip) {
              // If we previously showed a count and now know it's invalid, clear it.
              try { trackCountChip.remove(); } catch {}
            }

            const expandBtn = card.querySelector('.card-btn.expand');
            if (expandBtn) {
              expandBtn.style.display = (tc && tc > 1) ? 'flex' : 'none';
            }

            const metaElement = card.querySelector('.result-meta');
            if (metaElement) {
              renderResultMeta(metaElement, getResultMetaState(item));
            }
          }
        }

        // If the query mismatched but we still updated cards, keep going silently.
        // (This happens when the search layer normalizes the query differently.)
        void mismatch;
      } catch {
        // best-effort
      }
    };

    // Drain any enrichment notifications that happened before ui.js loaded.
    try {
      const pending = Array.isArray(window.__pendingSearchEnriched) ? window.__pendingSearchEnriched.slice(0) : [];
      window.__pendingSearchEnriched = [];
      for (const evt of pending) {
        try { window.onSearchPageEnriched(evt); } catch {}
      }
    } catch {}
  }
} catch {}

function parseDurationSeconds(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 0 ? value : null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : null;
  }

  const parts = raw.split(':').map(part => Number(part));
  if (!parts.length || parts.some(part => !Number.isFinite(part))) return null;
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  return null;
}

function resolveTrackDurationSeconds(track) {
  if (!track || typeof track !== 'object') return null;

  const rawDuration = (track.duration !== undefined && track.duration !== null)
    ? track.duration
    : (track.length !== undefined && track.length !== null)
      ? track.length
      : (track.trackDuration !== undefined && track.trackDuration !== null)
        ? track.trackDuration
        : track.track_duration;

  return parseDurationSeconds(rawDuration);
}

function sumTrackDurations(tracks) {
  if (!Array.isArray(tracks) || !tracks.length) return null;

  let totalSeconds = 0;
  let foundAny = false;

  tracks.forEach(track => {
    const seconds = resolveTrackDurationSeconds(track);
    if (seconds !== null && seconds > 0) {
      totalSeconds += seconds;
      foundAny = true;
    }
  });

  return foundAny ? totalSeconds : null;
}

function getResultMetaState(item, options = {}) {
  const sourceItem = (item && typeof item === 'object') ? item : {};
  const tracks = Array.isArray(options.tracks)
    ? options.tracks
    : (Array.isArray(sourceItem.tracks) ? sourceItem.tracks : null);
  const sourceTotalDuration = parseDurationSeconds(sourceItem.totalDuration);

  const explicitTrackCount = Number.isFinite(options.trackCount)
    ? options.trackCount
    : Number.isFinite(sourceItem.trackCount)
      ? sourceItem.trackCount
      : tracks
        ? tracks.length
        : null;

  const singleTrackDuration = options.durationSeconds !== undefined
    ? options.durationSeconds
    : (tracks && tracks.length === 1)
      ? resolveTrackDurationSeconds(tracks[0])
      : resolveTrackDurationSeconds(sourceItem);

  const inferredTrackCount = explicitTrackCount !== null
    ? explicitTrackCount
    : singleTrackDuration !== null
      ? 1
      : 0;

  const forceSingle = options.forceSingle === true;
  const isAlbum = options.isAlbum === true || (!forceSingle && inferredTrackCount > 1);
  const totalDurationSeconds = options.totalDurationSeconds !== undefined
    ? options.totalDurationSeconds
    : sourceTotalDuration !== null
      ? sourceTotalDuration
      : (tracks && tracks.length > 1 ? sumTrackDurations(tracks) : null);

  return {
    trackCount: inferredTrackCount,
    forceSingle,
    isAlbum,
    durationSeconds: isAlbum ? null : singleTrackDuration,
    totalDurationSeconds: isAlbum ? totalDurationSeconds : null,
    statusText: options.statusText || ''
  };
}

function renderResultMeta(metaElement, metaState) {
  if (!metaElement) return;

  const state = metaState || {};
  metaElement.replaceChildren();

  if (state.statusText) {
    const status = document.createElement('span');
    status.className = 'result-meta-status';
    status.textContent = state.statusText;
    metaElement.appendChild(status);
    return;
  }

  const trackCount = Number.isFinite(state.trackCount) ? state.trackCount : 0;
  const isAlbum = !!state.isAlbum && state.forceSingle !== true && trackCount > 1;
  const durationSeconds = isAlbum ? state.totalDurationSeconds : state.durationSeconds;

  // Move duration to the chips area at the top of the card (next to the track count chip)
  const chips = metaElement.closest('.content-card')?.querySelector('.card-chips');
  if (chips) {
    let chipTime = chips.querySelector('.chip-total-time');
    if (typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0) {
      if (!chipTime) {
        chipTime = document.createElement('span');
        chipTime.className = 'chip chip-quiet chip-total-time';
        chips.appendChild(chipTime);
      }
      chipTime.textContent = isAlbum ? formatAlbumDuration(durationSeconds) : formatTime(durationSeconds);
    } else if (chipTime) {
      chipTime.remove();
    }
  }
}

// Load album info and update result element metadata
async function loadAlbumInfoBackground(identifier, resultEl) {
  // Skip metadata loading only for file:// protocol to avoid CORS timeout errors
  const isFileProtocol = window.location.protocol === 'file:';
  if (isFileProtocol) {
    const metaElement = resultEl.querySelector('.result-meta');
    if (metaElement) {
      renderResultMeta(metaElement, { statusText: 'Info unavailable (file://)' });
    }
    return;
  }

  // Skip when offline to prevent noisy failures
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    const metaElement = resultEl.querySelector('.result-meta');
    if (metaElement) {
      renderResultMeta(metaElement, { statusText: 'Info not available offline' });
    }
    return;
  }

  try {
    const metadata = (window.AlbumTracks && typeof window.AlbumTracks.getTracks === 'function')
      ? await window.AlbumTracks.getTracks(identifier, { preferCache: true, allowFetch: true })
      : await fetchOptimizedPlayableFiles(identifier);
    const isAlbum = metadata.length > 1;
    const trackCount = metadata.length;

    window.logger?.debug(`Album check for ${identifier}: ${trackCount} tracks, isAlbum: ${isAlbum}`, 'NETWORK');

    const metaElement = resultEl.querySelector('.result-meta');
    if (metaElement) {
      const forceSingle = (resultEl.dataset.isTrackList === 'true') && trackCount <= 1;
      if (trackCount === 0) {
        renderResultMeta(metaElement, { statusText: 'No playable tracks' });
      } else {
        renderResultMeta(metaElement, getResultMetaState(resultEl.__resultData, {
          tracks: metadata,
          trackCount,
          isAlbum,
          forceSingle,
          durationSeconds: trackCount === 1 ? resolveTrackDurationSeconds(metadata[0]) : null,
          totalDurationSeconds: trackCount > 1 ? sumTrackDurations(metadata) : null
        }));
      }
    }

    // Actualizar el estado del botón de favorito
    const favoriteBtn = resultEl.querySelector('.result-favorite');
    if (favoriteBtn) {
      const buttonState = isAlbum ? getAlbumButtonState(identifier, trackCount) : getAlbumButtonState(identifier, 1);
      applyResonteButtonState(favoriteBtn, buttonState.isActive);
    }

    // Mostrar/ocultar el botón de expandir basado en si es un álbum
    const expandButton = resultEl.querySelector('.favorite-actions button:last-child');
    if (expandButton) {
      const forceSingle = (resultEl.dataset.isTrackList === 'true') && trackCount <= 1;
      // Never show expand for explicit track-list items
      expandButton.style.display = (!forceSingle && trackCount > 1) ? 'inline-block' : 'none';
    }
  } catch (error) {
    window.logger?.warn({ message: 'Error loading album info', identifier, error }, 'NETWORK');

    const metaElement = resultEl.querySelector('.result-meta');
    if (metaElement) {
      renderResultMeta(metaElement, {
        statusText: `Error: ${error.message.includes('Timeout') ? 'Timeout' : 'Unknown error'}`
      });
    }
  }
}

// Helper functions for creating search result elements
function createResultInfo(result) {
  const infoDiv = document.createElement('div');
  infoDiv.className = 'result-info';

  const titleDiv = document.createElement('div');
  titleDiv.className = 'result-title';
  titleDiv.textContent = result.title || 'Untitled';

  infoDiv.appendChild(titleDiv);

  return infoDiv;
}

function createResultButtons(result, hasFavoriteTrack) {
  const buttonsContainer = document.createElement('div');
  buttonsContainer.className = 'result-buttons';

  // Play button
  const playBtn = document.createElement('button');
  playBtn.className = 'result-play-btn';
  playBtn.title = 'Play';
  playBtn.innerHTML = '<span class="play-icon">▶</span>';

  // Favorite button
  const favoriteBtn = document.createElement('button');
  favoriteBtn.className = `result-favorite ${hasFavoriteTrack ? 'active' : ''}`;
  favoriteBtn.innerHTML = window.resonateLogoSVG || '';
  const favLabel = hasFavoriteTrack ? 'Remove from resonates' : 'Add to resonates';
  favoriteBtn.title = favLabel;
  favoriteBtn.setAttribute('aria-label', favLabel);

  // Expand button
  const expandBtn = document.createElement('button');
  expandBtn.className = 'result-expand';
  expandBtn.title = '▼';
  expandBtn.innerHTML = '<span class="expand-icon">▼</span>';

  buttonsContainer.appendChild(playBtn);
  buttonsContainer.appendChild(favoriteBtn);
  buttonsContainer.appendChild(expandBtn);

  return { buttonsContainer, playBtn, favoriteBtn, expandBtn };
}

// Helper functions for creating favorites-style elements
function createFavoriteInfo(result) {
  const infoDiv = document.createElement('div');
  infoDiv.className = 'favorite-info';

  const titleDiv = document.createElement('div');
  titleDiv.className = 'favorite-title';
  titleDiv.textContent = result.title || 'Untitled';

  const creatorDiv = document.createElement('div');
  creatorDiv.className = 'favorite-creator';
  creatorDiv.textContent = result.creator || 'Unknown';

  const metaDiv = document.createElement('div');
  metaDiv.className = 'result-meta';
  renderResultMeta(metaDiv, getResultMetaState(result));

  infoDiv.appendChild(titleDiv);
  infoDiv.appendChild(creatorDiv);
  infoDiv.appendChild(metaDiv);

  return infoDiv;
}

function getShareCapabilities() {
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const canCopy = (() => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') return true;
      return !!(document && typeof document.queryCommandSupported === 'function' && document.queryCommandSupported('copy'));
    } catch {
      return false;
    }
  })();
  return { canShare, canCopy };
}

function getCastCapabilities(audioEl) {
  const el = audioEl || (elements && elements.audio) || document.getElementById('audio');
  const remote = el && el.remote ? el.remote : null;
  const canRemotePlayback = !!(remote && typeof remote.prompt === 'function');
  const canAirPlay = !!(el && typeof el.webkitShowPlaybackTargetPicker === 'function');
  return { canRemotePlayback, canAirPlay };
}

function applyCastButtonState(el) {
  if (!el) return;
  const audioEl = (elements && elements.audio) ? elements.audio : document.getElementById('audio');
  const { canRemotePlayback, canAirPlay } = getCastCapabilities(audioEl);
  const available = canRemotePlayback || canAirPlay;
  const castState = (window.CastManager && typeof window.CastManager.getCastState === 'function')
    ? window.CastManager.getCastState()
    : null;
  const CastState = (window.cast && window.cast.framework) ? window.cast.framework.CastState : null;
  const castDevicesAvailable = CastState ? castState !== CastState.NO_DEVICES_AVAILABLE : null;
  const castSessionActive = (window.CastManager && typeof window.CastManager.isSessionActive === 'function')
    ? window.CastManager.isSessionActive()
    : false;
  const shouldShow = castSessionActive || castDevicesAvailable !== false || available;
  const fallbackTitle = isRunningAsPWA() ? 'Open in browser to cast' : 'Use browser menu to cast';
  const title = available ? 'Cast' : fallbackTitle;

  try { el.title = ''; } catch {}
  try { el.removeAttribute('data-tooltip'); } catch {}
  try { el.setAttribute('aria-label', title); } catch {}
  try { el.dataset.castMode = available ? 'native' : 'browser'; } catch {}
  try { el.classList.toggle('cast-available', available); } catch {}
  try { el.classList.toggle('cast-fallback', !available); } catch {}
  try { el.hidden = !shouldShow; } catch {}
  try { el.setAttribute('aria-hidden', shouldShow ? 'false' : 'true'); } catch {}
  try {
    const badge = el.querySelector('.cast-badge');
    if (badge) badge.hidden = available;
  } catch {}
}

function getShareIconMarkup(mode) {
  const shareSvg = `
    <svg class="header-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3v10" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 11v7a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-7" />
    </svg>
  `;
  const copySvg = `
    <svg class="header-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="10" height="12" rx="2" />
      <rect x="5" y="3" width="10" height="12" rx="2" />
    </svg>
  `;

  const svg = mode === 'copy' ? copySvg : shareSvg;
  return `<span class="header-icon" aria-hidden="true">${svg}</span>`;
}

function setShareButtonIcon(el, mode) {
  if (!el) return;
  try {
    // Preserve sheet-item-label if present (used in bottom sheet context).
    // Clone the node *before* innerHTML replacement to avoid a detached-node
    // reference after the parent's children are destroyed by the assignment.
    const labelEl = el.querySelector('.sheet-item-label');
    const labelClone = labelEl ? labelEl.cloneNode(true) : null;
    el.innerHTML = getShareIconMarkup(mode);
    if (labelClone) el.appendChild(labelClone);
  } catch {}
}

function applyShareButtonState(el) {
  if (!el) return;

  const { canShare, canCopy } = getShareCapabilities();
  const allowTitle = !(el.classList && el.classList.contains('theme-selector'));

  if (canShare) {
    try { el.dataset.shareMode = 'share'; } catch {}
    if (allowTitle) {
      try { el.title = 'Share'; } catch {}
    }
    try { el.setAttribute('aria-label', 'Share'); } catch {}
    setShareButtonIcon(el, 'share');
    try { el.classList.remove('disabled'); } catch {}
    if (el.tagName === 'BUTTON') el.disabled = false;
    try { el.removeAttribute('aria-disabled'); } catch {}
    try { el.style.pointerEvents = ''; } catch {}
    return;
  }

  if (canCopy) {
    try { el.dataset.shareMode = 'copy'; } catch {}
    if (allowTitle) {
      try { el.title = 'Copy link'; } catch {}
    }
    try { el.setAttribute('aria-label', 'Copy link'); } catch {}
    setShareButtonIcon(el, 'copy');
    try { el.classList.remove('disabled'); } catch {}
    if (el.tagName === 'BUTTON') el.disabled = false;
    try { el.removeAttribute('aria-disabled'); } catch {}
    try { el.style.pointerEvents = ''; } catch {}
    return;
  }

  try { el.dataset.shareMode = 'disabled'; } catch {}
  if (allowTitle) {
    try { el.title = 'Sharing not available'; } catch {}
  }
  try { el.setAttribute('aria-label', 'Sharing not available'); } catch {}
  setShareButtonIcon(el, 'share');
  try { el.classList.add('disabled'); } catch {}
  if (el.tagName === 'BUTTON') el.disabled = true;
  try { el.setAttribute('aria-disabled', 'true'); } catch {}
  try { el.style.pointerEvents = 'none'; } catch {}
}

function createFavoriteActions(result, hasFavoriteTrack, options = {}) {
  const { showPlay = true } = options;
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'favorite-actions';

  // Play button
  let playBtn = null;
  if (showPlay) {
    playBtn = document.createElement('button');
    playBtn.className = 'button';
    playBtn.title = 'Play';
    playBtn.textContent = '▶';
    actionsDiv.appendChild(playBtn);
  }

  // Favorite button
  const favoriteBtn = document.createElement('button');
  favoriteBtn.className = `button result-favorite ${hasFavoriteTrack ? 'active' : ''}`;
  favoriteBtn.innerHTML = window.resonateLogoSVG || '';
  const favLabel = hasFavoriteTrack ? 'Remove from resonates' : 'Add to resonates';
  favoriteBtn.title = favLabel;
  favoriteBtn.setAttribute('aria-label', favLabel);

  // Share button
  const shareBtn = document.createElement('button');
  shareBtn.className = 'button result-share';
  shareBtn.title = 'Share';
  shareBtn.textContent = '🔗';
  applyShareButtonState(shareBtn);

  // Expand button (for albums)
  const expandBtn = document.createElement('button');
  expandBtn.className = 'button result-expand';
  expandBtn.title = 'View album tracks';
  expandBtn.textContent = '▼';

  actionsDiv.appendChild(favoriteBtn);
  actionsDiv.appendChild(shareBtn);
  actionsDiv.appendChild(expandBtn);

  return { actionsDiv, playBtn, favoriteBtn, shareBtn, expandBtn };
}

function createSearchResultElement(result, globalIndex) {
  // Validate input
  if (!result || !result.identifier) {
    window.logger?.warn('Invalid result data provided to createSearchResultElement', 'UI');
    return document.createElement('div'); // Return empty div as fallback
  }

  const resultEl = document.createElement('div');
  resultEl.className = 'search-result favorite-item';
  resultEl.setAttribute('role', 'article');
  resultEl.setAttribute('tabindex', '0');
  resultEl.setAttribute('aria-label', `${result.title || 'Untitled'} by ${result.creator || 'Unknown'}`);
  // Asociar la descripción y otros datos al DOM para uso en tracklist-v2.js
  resultEl.__resultData = result;
  // Persist explicit track-list classification so background metadata respects it
  if (result.isTrackList) {
    resultEl.dataset.isTrackList = 'true';
    resultEl.classList.add('is-track-list');
  } else {
    resultEl.dataset.isTrackList = 'false';
  }

  const hasFavoriteTrack = isAlbumInFavorites(result.identifier);

  // Create cover container and add to DOM immediately (before async load)
  const coverContainer = document.createElement('div');
  coverContainer.className = 'result-cover';
  
  // Add cover to the left FIRST (synchronously)
  resultEl.appendChild(coverContainer);

  // Build structure using helper functions for favorites layout
  const infoDiv = createFavoriteInfo(result);
  const { actionsDiv, favoriteBtn, shareBtn, expandBtn } = createFavoriteActions(result, hasFavoriteTrack, { showPlay: false });

  // Add ARIA labels to buttons
  favoriteBtn.setAttribute('aria-label', hasFavoriteTrack ? 'Remove from resonates' : 'Add to resonates');
  shareBtn.setAttribute('aria-label', `Share ${result.title || 'Untitled'}`);
  expandBtn.setAttribute('aria-label', 'Show album tracks');

  // Show expand button immediately for all results
  // Respect explicit track-list override: list and behave as single
  // Hide expand control up-front for track-list results
  const initialForceSingle = (result.isTrackList === true) && (result.trackCount === 1 || result.isAlbum === false);
  expandBtn.style.display = initialForceSingle ? 'none' : 'inline-block';

  // Then add info and actions
  resultEl.appendChild(infoDiv);
  resultEl.appendChild(actionsDiv);

  // Load album info in background
  loadAlbumInfoBackground(result.identifier, resultEl);

  // Load cover image asynchronously WITHOUT blocking UI
  const coverUrl = window.CoverManager?.getCoverUrl
    ? window.CoverManager.getCoverUrl(result.identifier)
    : `https://archive.org/services/img/${encodeURIComponent(result.identifier)}`;

  if (window.CoverManager?.loadCover) {
    console.log(`[UI] Loading cover for search result: ${result.identifier}`);
    window.CoverManager.loadCover(result.identifier, {
      alt: `Album cover for ${result.title || 'Untitled'}`,
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      borderRadius: '6px',
      showFallback: false,
      lazy: false
    }).then(img => {
      console.log(`[UI] Cover returned, appending to coverContainer`, img, coverContainer);
      coverContainer.appendChild(img);
      console.log(`[UI] Cover appended. Container children:`, coverContainer.children.length);
    }).catch(err => {
      console.error(`[UI] Failed to load search result cover:`, err);
      window.logger?.warn({ message: 'Failed to load search result cover', error: err }, 'UI');
      if (coverUrl) {
        const img = new Image();
        img.alt = `Album cover for ${result.title || 'Untitled'}`;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '6px';
        img.src = coverUrl;
        console.log(`[UI] Fallback cover created and appending`);
        coverContainer.appendChild(img);
      }
    });
  } else if (coverUrl) {
    console.log(`[UI] CoverManager not available, creating direct image for: ${result.identifier}`);
    const img = new Image();
    img.alt = `Album cover for ${result.title || 'Untitled'}`;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '6px';
    img.src = coverUrl;
    coverContainer.appendChild(img);
  }

  // Play UX: click cover or title/info area
  const playFromSearchResult = async (e) => {
    e.stopPropagation();
    window.preparePlaybackTransitionFromList?.({
      closeSearch: true,
      closeResontes: true,
      closeTracksPanel: true,
      collapseExpandedAlbums: true,
      showLoader: true,
      loaderContext: result && result.trackCount > 1 ? 'album' : 'search',
      showProgress: false
    });
    showStatus('Getting track ready', 'info');
    await window.playOptimizedSearchResult(result, globalIndex, state.searchResults);
  };

  coverContainer.style.cursor = 'pointer';
  coverContainer.addEventListener('click', playFromSearchResult);

  shareBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const shareKind = result.isTrackList ? 'track' : 'album';
    await shareTrack(result.identifier, result.title, result.creator, null, shareKind);
  });

  infoDiv.addEventListener('click', playFromSearchResult);

  favoriteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();

    // Show loading state while fetching
    favoriteBtn.classList.add('resonate-btn-loading');

    try {
      const files = (window.AlbumTracks && typeof window.AlbumTracks.getTracks === 'function')
        ? await window.AlbumTracks.getTracks(result.identifier, { preferCache: true, allowFetch: true })
        : await fetchOptimizedPlayableFiles(result.identifier);
      if (files.length > 0) {
        let newActive = false;
        if (files.length > 1) {
          // Album handling
          const buttonState = getAlbumButtonState(result.identifier, files.length);
          if (buttonState.action === 'remove') {
            removeAlbumFromFavorites(result.identifier);
            newActive = false;
          } else if (buttonState.action === 'complete') {
            addAlbumToFavorites(result.identifier, files);
            newActive = true;
          } else if (buttonState.action === 'add') {
            addAlbumToFavorites(result.identifier, files);
            newActive = true;
          }
        } else {
          // Single track handling
          const track = files[0];
          toggleFavorite(track);
          newActive = isTrackFavorite(track);
        }
        applyResonteButtonState(favoriteBtn, newActive, { animate: true });
      }
    } catch (error) {
      window.logger?.error({ message: 'Error managing favorite', error }, 'UI');
      showStatus('Couldn\'t update resonates', 'error');
    } finally {
      favoriteBtn.classList.remove('resonate-btn-loading');
    }
  });

  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    let tracksContainer = resultEl.nextElementSibling;

    if (!tracksContainer || !tracksContainer.classList.contains('tracks-container')) {
      tracksContainer = document.createElement('div');
      tracksContainer.className = 'tracks-container tracklist collapsing';
      const parent = resultEl.parentNode;      if (parent) {        parent.insertBefore(tracksContainer, resultEl.nextSibling);      }
    }

    toggleAlbumTracks(result.identifier, tracksContainer, expandBtn);
  });

  return resultEl;
}

// ===== Card Context Menu =====

// Holds the last item/context state for the shared card-context-sheet.
let __cardContextState = null;

/**
 * Populate and open the shared card context bottom sheet.
 * @param {object} item      - The card data object (search result or resonates item)
 * @param {string} context   - 'search' | 'resonates' | 'favorites'
 * @param {object} options   - { identifier, title, creator, isAlbum, expandBtn, favBtn, globalIndex }
 */
function openCardContextMenu(item, context, options = {}) {
  const { identifier, title, creator, isAlbum, expandBtn, favBtn, globalIndex } = options;

  const titleEl = document.getElementById('card-context-title');
  if (titleEl) titleEl.textContent = title || 'Options';

  const subtitleEl = document.getElementById('card-context-subtitle');
  if (subtitleEl) subtitleEl.textContent = (creator && creator !== 'Unknown') ? `by ${creator}` : '';

  const playLabelEl = document.getElementById('card-ctx-play-label');
  if (playLabelEl) playLabelEl.textContent = isAlbum ? 'Play Album' : 'Play';

  const resonateLabelEl = document.getElementById('card-ctx-resonate-label');
  if (resonateLabelEl) {
    const isFav = isAlbumInFavorites(identifier);
    resonateLabelEl.textContent = isFav ? 'Remove from Resonates' : 'Add to Resonates';
  }

  const tracksBtn = document.getElementById('card-ctx-tracks');
  if (tracksBtn) tracksBtn.hidden = !isAlbum;

  __cardContextState = { item, context, identifier, title, creator, isAlbum, expandBtn, favBtn, globalIndex };

  if (window.BottomSheetAPI) {
    window.BottomSheetAPI.openById('card-context-sheet');
  }
}

/**
 * Wire up the static action buttons inside #card-context-sheet.
 * Called once after DOM is ready.
 */
function initCardContextSheetHandlers() {
  const playBtn = document.getElementById('card-ctx-play');
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      const st = __cardContextState;
      __cardContextState = null;
      if (!st) return;
      const { item, context, identifier, isAlbum, globalIndex } = st;
      try {
        if (context === 'search') {
          window.preparePlaybackTransitionFromList?.({
            closeSearch: true,
            closeResontes: true,
            closeTracksPanel: true,
            collapseExpandedAlbums: true,
            showLoader: true,
            loaderContext: isAlbum ? 'album' : 'search',
            showProgress: false
          });
          window.playOptimizedSearchResult?.(item, typeof globalIndex === 'number' ? globalIndex : 0, state.searchResults);
        } else {
          if (isAlbum) {
            window.preparePlaybackTransitionFromList?.({ closeResontes: true, closeTracksPanel: true, showLoader: true, loaderContext: 'album', showProgress: false });
            const fn = window.playAlbumFromResontes || window.playAlbumFromFavorites;
            if (typeof fn === 'function') fn(identifier, { force: true, origin: 'favorites' });
          } else {
            const track = (Array.isArray(item.tracks) && item.tracks.length) ? item.tracks[0] : item;
            window.preparePlaybackTransitionFromList?.({ closeResontes: true, closeTracksPanel: true, showLoader: true, loaderContext: 'resontes', showProgress: false });
            const playFn = window.playFromResontesQueue || window.playFromFavoritesQueue;
            if (typeof playFn === 'function') playFn(track);
          }
        }
      } catch {}
    });
  }

  const resonateBtn = document.getElementById('card-ctx-resonate');
  if (resonateBtn) {
    resonateBtn.addEventListener('click', async () => {
      const st = __cardContextState;
      __cardContextState = null;
      if (!st) return;
      const { identifier, isAlbum } = st;
      resonateBtn.disabled = true;
      try {
        const isFav = isAlbumInFavorites(identifier);
        if (isFav) {
          removeAlbumFromFavorites(identifier);
          updateFavoritesList();
          updateFavoriteButton();
          showStatus('Removed from resonates', 'info');
        } else {
          const files = (window.AlbumTracks && typeof window.AlbumTracks.getTracks === 'function')
            ? await window.AlbumTracks.getTracks(identifier, { preferCache: true, allowFetch: true })
            : await fetchOptimizedPlayableFiles(identifier);
          if (files.length > 1) {
            addAlbumToFavorites(identifier, files);
          } else if (files.length === 1) {
            toggleFavorite(files[0]);
          }
          showStatus('Added to resonates', 'success');
        }
        try { if (typeof window.refreshAllResonteButtons === 'function') window.refreshAllResonteButtons(); } catch {}
        try { updateFavoriteButton(); } catch {}
      } catch {
        showStatus("Couldn't update resonates", 'error');
      } finally {
        resonateBtn.disabled = false;
      }
    });
  }

  const tracksBtn = document.getElementById('card-ctx-tracks');
  if (tracksBtn) {
    tracksBtn.addEventListener('click', () => {
      const st = __cardContextState;
      __cardContextState = null;
      if (!st) return;
      const { identifier, expandBtn } = st;
      try {
        if (expandBtn) {
          expandBtn.click();
        } else {
          const card = document.querySelector(`.content-card[data-album-id="${CSS.escape(String(identifier))}"]`);
          if (card) {
            const eb = card.querySelector('.card-btn.expand');
            if (eb) eb.click();
          }
        }
      } catch {}
    });
  }

  const shareBtn = document.getElementById('card-ctx-share');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const st = __cardContextState;
      __cardContextState = null;
      if (!st) return;
      const { identifier, title, creator, isAlbum } = st;
      try {
        await shareTrack(identifier, title, creator, null, isAlbum ? 'album' : 'track');
      } catch {}
    });
  }
}

// ===== Card Grid (New) =====
function renderCardGrid(container, items, context = 'search', clearExisting = true) {
  if (!container) return;
  if (clearExisting) container.innerHTML = '';

  // Ensure a grid wrapper exists
  let grid = container.querySelector('.card-grid');
  if (!grid || clearExisting) {
    grid = document.createElement('div');
    grid.className = 'card-grid';
    if (clearExisting) container.appendChild(grid); else container.appendChild(grid);
  }

  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => {
    const hasStableIndex = item && typeof item.__globalIndex === 'number' && isFinite(item.__globalIndex);
    const globalIndex = hasStableIndex
      ? item.__globalIndex
      : (clearExisting ? index : state.searchResults.length - items.length + index);
    const card = buildContentCard(item, context, globalIndex);
    fragment.appendChild(card);
  });
  grid.appendChild(fragment);
}

/**
 * Apply inline fill styles to an image so it always covers its container,
 * regardless of CSS cascade order. Used for card media covers.
 * @param {HTMLImageElement} img
 */
function applyCardCoverFillStyles(img) {
  img.style.position = 'absolute';
  img.style.inset = '0';
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'cover';
  img.style.objectPosition = 'center';
  img.style.display = 'block';
}

function buildContentCard(item, context = 'search', globalIndex = 0) {
  // Normalize fields across contexts
  const identifier = item.identifier || item.id || item.albumId || item.id;
  const title = item.title || item.albumTitle || 'Untitled';
  const creator = item.creator || 'Unknown';

  const card = document.createElement('article');
  card.className = 'content-card';
  card.setAttribute('role', 'listitem');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `${title} by ${creator}`);

  // Data attributes for robust UI updates (favorites state, offline filter, analytics)
  try {
    card.dataset.context = String(context);
    card.dataset.albumId = String(identifier);
    card.dataset.globalIndex = String(globalIndex);
  } catch {}

  // Mark card as currently playing if it matches the active track
  try {
    const playingId = state.currentTrack && (state.currentTrack.albumId || state.currentTrack.id);
    if (playingId && String(playingId) === String(identifier)) {
      card.classList.add('is-playing');
      card.setAttribute('aria-label', `Now playing: ${title} by ${creator}`);
    }
  } catch {}

  try {
    if ((context === 'favorites' || context === 'resonates') && Array.isArray(item.tracks)) {
      card.__albumTracks = item.tracks;
    }
  } catch {}

  // Media
  const media = document.createElement('div');
  media.className = 'card-media';
  // Attach media early so async loads always have a target
  card.appendChild(media);
  
  // Load cover image asynchronously WITHOUT blocking UI
  const cardCoverUrl = window.CoverManager?.getCoverUrl
    ? window.CoverManager.getCoverUrl(identifier)
    : `https://archive.org/services/img/${encodeURIComponent(identifier)}`;

  if (window.CoverManager?.loadCover) {
    window.CoverManager.loadCover(identifier, {
      alt: `Cover for ${title}`,
      objectFit: 'cover',
      objectPosition: 'center',
      position: 'absolute',
      inset: '0',
      borderRadius: '0',
      lazy: true,
      showFallback: true,
      fallbackType: 'svg',
      fallbackTitle: title,
      fallbackCreator: creator
    }).then(img => {
      media.appendChild(img);
    }).catch(err => {
      window.logger?.warn({ message: 'Failed to load content card cover', error: err }, 'UI');
      if (cardCoverUrl) {
        const img = new Image();
        img.alt = `Cover for ${title}`;
        applyCardCoverFillStyles(img);
        img.src = cardCoverUrl;
        media.appendChild(img);
      }
    });
  } else if (cardCoverUrl) {
    const img = new Image();
    img.alt = `Cover for ${title}`;
    applyCardCoverFillStyles(img);
    img.src = cardCoverUrl;
    media.appendChild(img);
  }

  // Chips
  const chips = document.createElement('div');
  chips.className = 'card-chips';
  const chipType = document.createElement('span');
  chipType.className = 'chip chip-type';
  const isAlbum = ( !!item.isAlbum || (typeof item.trackCount === 'number' && item.trackCount > 1) || !!item.isAlbumTrack );
  const isPendingMeta = (context === 'search' && item && item.__metaPending === true);
  chipType.textContent = isAlbum ? 'Album' : (isPendingMeta ? '…' : 'Single');
  if (isPendingMeta) chipType.classList.add('chip-pending');
  chips.appendChild(chipType);

  // Offline chip (when we can determine it cheaply)

  try {
    if (context === 'favorites' || context === 'resonates') {
      const tracks = Array.isArray(item.tracks) ? item.tracks : [];
      const cachedCount = tracks.filter(t => t && t.url && isUrlOfflineAvailableSync(t.url)).length;
      if (cachedCount > 0) {
        const chipOffline = document.createElement('span');
        chipOffline.className = 'chip chip-quiet chip-offline';
        chipOffline.textContent = cachedCount === tracks.length ? 'Offline' : `Offline ${cachedCount}/${tracks.length}`;
        chips.appendChild(chipOffline);
      }
    }
  } catch (e) {}

  if (item.trackCount) {
    const chipTrackCount = document.createElement('span');
    chipTrackCount.className = 'chip chip-quiet chip-track-count';
    chipTrackCount.textContent = `${item.trackCount} tracks`;
    chips.appendChild(chipTrackCount);
  }
  media.appendChild(chips);

  // Play indicator overlay (appears on hover for search/favorites/resonates context)
  if (context === 'search' || context === 'favorites' || context === 'resonates') {
    const playOverlay = document.createElement('div');
    playOverlay.className = 'card-play-overlay';
    playOverlay.setAttribute('aria-hidden', 'true');
    media.appendChild(playOverlay);
  }

  // Body
  const body = document.createElement('div');
  body.className = 'card-body';

  const t = document.createElement('div');
  t.className = 'card-title';
  t.textContent = title;
  t.title = title;
  body.appendChild(t);

  if (creator && creator !== 'Unknown') {
    const c = document.createElement('div');
    c.className = 'card-creator';
    c.textContent = creator;
    c.title = creator;
    body.appendChild(c);
  }

  const meta = document.createElement('div');
  meta.className = 'result-meta';
  renderResultMeta(meta, getResultMetaState(item));
  body.appendChild(meta);

  // Actions - Simplified: Only Favorite + More button visible by default
  // Share and Expand are hidden on mobile, shown on desktop or in context menu
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  
  const favBtn = document.createElement('button');
  favBtn.className = 'card-btn favorite';
  favBtn.innerHTML = window.resonateLogoSVG || '';
  favBtn.setAttribute('aria-label', 'Add to resonates');
  
  // More button (⋯) that opens context menu on mobile
  const moreBtn = document.createElement('button');
  moreBtn.className = 'card-btn more';
  moreBtn.textContent = '⋯';
  moreBtn.title = 'More options';
  moreBtn.setAttribute('aria-label', 'More options');
  moreBtn.setAttribute('aria-haspopup', 'true');
  
  // Secondary actions (hidden by default on mobile, shown on desktop)
  const shareBtn = document.createElement('button');
  shareBtn.className = 'card-btn share';
  shareBtn.title = 'Share';
  shareBtn.textContent = '🔗';
  applyShareButtonState(shareBtn);
  
  const expandBtn = document.createElement('button');
  expandBtn.className = 'card-btn expand';
  expandBtn.innerHTML = '<span class="expand-icon">▼</span>';
  expandBtn.title = 'Show album tracks';
  expandBtn.setAttribute('aria-label', 'Show album tracks');
  expandBtn.setAttribute('aria-expanded', 'false');
  expandBtn.style.display = isAlbum ? 'flex' : 'none';
  
  // Order: Favorite, More, Share, Expand (share/expand hidden on mobile via CSS)
  actions.appendChild(favBtn);
  actions.appendChild(moreBtn);
  actions.appendChild(shareBtn);
  actions.appendChild(expandBtn);

  card.appendChild(body);

  // Compact overlay action bar over the cover (search cards only)
  // Favorites/resonates show buttons in a horizontal row below the card
  if (context === 'search') {
    actions.classList.add('card-actions-overlay');
    card.classList.add('actions-overlay');
    media.appendChild(actions);
    // Prevent clicks on the bar background from bubbling to the media click handler
    actions.addEventListener('click', (e) => { e.stopPropagation(); });
  } else {
    card.appendChild(actions);
  }

  // Initialize favorite state from current favorites (albums: any track favorite)
  try {
    const isFav = isAlbumInFavorites(identifier);
    favBtn.classList.toggle('active', isFav);
    favBtn.innerHTML = window.resonateLogoSVG || '';
    const label = isFav ? 'Remove from resonates' : 'Add to resonates';
    favBtn.title = label;
    favBtn.setAttribute('aria-label', label);
  } catch {}

  // Background enrichment updates cards via window.onSearchPageEnriched.

  // Event wiring
  if (context === 'search') {
    // Play UX: click cover or title
    const playFromCard = async (e) => {
      e.stopPropagation();
      updateContentCardPlayingState(identifier);
      window.preparePlaybackTransitionFromList?.({
        closeSearch: true,
        closeResontes: true,
        closeTracksPanel: true,
        collapseExpandedAlbums: true,
        showLoader: true,
        loaderContext: isAlbum ? 'album' : 'search',
        showProgress: false
      });
      showStatus('Loading your track', 'info');
      await window.playOptimizedSearchResult?.(item, globalIndex, state.searchResults);
    };

    media.style.cursor = 'pointer';
    t.style.cursor = 'pointer';
    media.addEventListener('click', playFromCard);
    t.addEventListener('click', playFromCard);

    // Card-level interactions: click/keyboard anywhere except buttons
    card.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('button')) return;
      playFromCard(e);
    });

    card.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target && e.target.closest && e.target.closest('button')) return;
      e.preventDefault();
      playFromCard(e);
    });

    // Favorite
    favBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      favBtn.classList.add('resonate-btn-loading');
      try {
        const files = (window.AlbumTracks && typeof window.AlbumTracks.getTracks === 'function')
          ? await window.AlbumTracks.getTracks(identifier, { preferCache: true, allowFetch: true })
          : await fetchOptimizedPlayableFiles(identifier);
        let newActive = false;
        if (files.length > 1) {
          const buttonState = getAlbumButtonState(identifier, files.length);
          if (buttonState.action === 'remove') {
            removeAlbumFromFavorites(identifier);
            newActive = false;
            try { updateSearchResultFavoriteState(identifier, false); } catch {}
          } else {
            addAlbumToFavorites(identifier, files);
            newActive = true;
            try { updateSearchResultFavoriteState(identifier, true); } catch {}
          }
        } else if (files.length === 1) {
          const track = files[0];
          toggleFavorite(track);
          newActive = isTrackFavorite(track);
          try { updateSearchResultFavoriteState(identifier, newActive); } catch {}
        }
        applyResonteButtonState(favBtn, newActive, { animate: true });
      } catch (err) {
        showStatus('Couldn\'t update resonates', 'error');
      } finally {
        favBtn.classList.remove('resonate-btn-loading');
      }
    });
    // Expand
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      let tracksContainer = card.nextElementSibling;
      if (!tracksContainer || !tracksContainer.classList.contains('tracks-container')) {
        tracksContainer = document.createElement('div');
        tracksContainer.className = 'tracks-container tracklist collapsing';
        const parent = card.parentNode; if (parent) parent.insertBefore(tracksContainer, card.nextSibling);
      }
      toggleAlbumTracks(identifier, tracksContainer, expandBtn);
    });

    // Prefetch on hover for instant expansion
    let hoverTimer = null;
    card.addEventListener('mouseenter', () => {
      if (isAlbum && typeof window.prefetchTracklistOnHover === 'function') {
        hoverTimer = setTimeout(() => {
          window.prefetchTracklistOnHover(identifier);
        }, 300); // Small delay to avoid prefetching on quick mouse movements
      }
    });
    card.addEventListener('mouseleave', () => {
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
    });

    // Share
    shareBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const shareKind = isAlbum ? 'album' : 'track';
        await shareTrack(identifier, title, creator, null, shareKind);
      } catch {}
    });
    
    // More button - opens context menu with clear actions
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCardContextMenu(item, 'search', { identifier, title, creator, isAlbum, expandBtn, favBtn, globalIndex });
    });
  } else {
    // favorites / resonates context
    const isAlbumFavorite = Array.isArray(item.tracks) ? item.tracks.length > 1 : isAlbum;
    // Mark card type for CSS layout tweaks
    card.classList.add(isAlbumFavorite ? 'album' : 'single');

    // Tap-to-play: click cover or title
    const playFromFavoriteCard = async (e) => {
      e.stopPropagation();
      try {
        if (isAlbumFavorite) {
          if (typeof window.playAlbumFromResontes === 'function') {
            window.playAlbumFromResontes(identifier, { force: true, origin: 'favorites' });
          } else if (typeof window.playAlbumFromFavorites === 'function') {
            window.playAlbumFromFavorites(identifier);
          } else if (typeof playAlbumFromResontes === 'function') {
            playAlbumFromResontes(identifier, { force: true, origin: 'favorites' });
          } else if (typeof playAlbumFromFavorites === 'function') {
            playAlbumFromFavorites(identifier);
          } else {
            try { showStatus('Album playback is not available yet', 'error', 2500); } catch {}
          }
        } else {
          const favoriteTrack = Array.isArray(item.tracks) && item.tracks.length ? item.tracks[0] : item;
          window.preparePlaybackTransitionFromList?.({
            closeSearch: true,
            closeResontes: true,
            closeTracksPanel: true,
            collapseExpandedAlbums: true,
            showLoader: true,
            loaderContext: 'resontes',
            showProgress: false
          });
          if (typeof window.playFromFavoritesQueue === 'function') {
            window.playFromFavoritesQueue(favoriteTrack);
          } else if (typeof playFromFavoritesQueue === 'function') {
            playFromFavoritesQueue(favoriteTrack);
          } else {
            try { showStatus('Playback is not available yet', 'error', 2500); } catch {}
          }
        }
      } catch {}
    };

    media.style.cursor = 'pointer';
    t.style.cursor = 'pointer';
    media.addEventListener('click', playFromFavoriteCard);
    t.addEventListener('click', playFromFavoriteCard);

    // Card-level interactions: click/keyboard anywhere except buttons
    card.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('button')) return;
      playFromFavoriteCard(e);
    });

    card.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target && e.target.closest && e.target.closest('button')) return;
      e.preventDefault();
      playFromFavoriteCard(e);
    });

    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Remove whole album
      removeAlbumFromFavorites(identifier);
      updateFavoritesList();
      updateFavoriteButton();
      showStatus('Removed from resonates', 'info');
    });

    expandBtn.style.display = isAlbumFavorite ? 'inline-block' : 'none';
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      let tracksContainer = card.nextElementSibling;
      if (!tracksContainer || !tracksContainer.classList.contains('tracks-container')) {
        tracksContainer = document.createElement('div');
        tracksContainer.className = 'tracks-container tracklist collapsing';
        const parent = card.parentNode;
        if (parent) parent.insertBefore(tracksContainer, card.nextSibling);
      }
      toggleAlbumTracks(identifier, tracksContainer, expandBtn);
    });

    // Share
    shareBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        const shareKind = isAlbumFavorite ? 'album' : 'track';
        shareTrack(identifier, title, creator, null, shareKind);
      } catch {}
    });
    
    // More button - opens context menu with clear actions
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCardContextMenu(item, context, { identifier, title, creator, isAlbum: isAlbumFavorite, expandBtn, favBtn, globalIndex });
    });
  }

  return card;
}

function containerForFavorites() {
  return elements.favoritesList || document.getElementById('favorites-list');
}

// Toggle album tracks visibility
function toggleAlbumTracks(albumId, tracksContainer, expandButton) {
  if (!tracksContainer || !tracksContainer.parentNode) {
    window.logger?.error('Tracks container is not a child of the expected parent node.', 'UI');
    return;
  }

  try {
    const card = tracksContainer.previousElementSibling;
    if (card && Array.isArray(card.__albumTracks)) {
      tracksContainer.__albumTracks = card.__albumTracks;
    }
  } catch {}

  // Check if container is currently collapsed (has the collapsing class)
  const isCollapsed = tracksContainer.classList.contains('collapsing');

  if (isCollapsed) {
    // Auto-collapse other expanded albums for cleaner UX
    try {
      if (window.__resonateExpandedAlbums) {
        window.__resonateExpandedAlbums.forEach(otherId => {
          if (otherId !== albumId) {
            const otherCards = document.querySelectorAll(`[data-album-id="${CSS.escape(otherId)}"]`);
            otherCards.forEach(otherCard => {
              const otherContainer = otherCard.nextElementSibling;
              const otherExpand = otherCard.querySelector('.card-btn.expand, .result-expand, button[aria-label*="Hide"]');
              if (otherContainer && otherContainer.classList.contains('tracks-container') && !otherContainer.classList.contains('collapsing')) {
                if (otherExpand) {
                  const icon = otherExpand.querySelector('.expand-icon');
                  if (icon) icon.textContent = '▼';
                  otherExpand.title = 'Show album tracks';
                  otherExpand.setAttribute('aria-label', 'Show album tracks');
                  otherExpand.setAttribute('aria-expanded', 'false');
                  otherExpand.classList.remove('expanded');
                }
                otherContainer.classList.add('collapsing');
                // Cancel any in-flight fetch for this album
                if (typeof window.cancelTracklistFetch === 'function') {
                  window.cancelTracklistFetch(otherId);
                }
              }
            });
          }
        });
        // Clear and re-add current
        window.__resonateExpandedAlbums.clear();
        window.__resonateExpandedAlbums.add(albumId);
      }
    } catch (e) {
      // Best effort
    }

    // Expand: remove collapsing class to show with animation
    const icon = expandButton.querySelector('.expand-icon');
    if (icon) icon.textContent = '▲';
    expandButton.title = 'Hide album tracks';
    expandButton.setAttribute('aria-label', 'Hide album tracks');
    expandButton.setAttribute('aria-expanded', 'true');
    expandButton.classList.add('expanded');
    
    try {
      if (!tracksContainer.dataset.tlv2Mounted) {
        // Show improved skeleton loader
        const loaderHTML = `
          <div class="tracks-loading-skeleton">
            <div class="skeleton-loader">
              <div class="skeleton-track"></div>
              <div class="skeleton-track"></div>
              <div class="skeleton-track"></div>
              <div class="skeleton-track"></div>
            </div>
          </div>
        `;
        tracksContainer.innerHTML = loaderHTML;
        
        if (typeof window.displayAlbumTracksV2 === 'function') {
          window.displayAlbumTracksV2(albumId, tracksContainer);
          tracksContainer.dataset.tlv2Mounted = 'true';
          try { if (typeof window.refreshAllResonteButtons === 'function') window.refreshAllResonteButtons(); } catch {}
        }
      }
    } catch (e) {
      tracksContainer.innerHTML = '<div class="no-results">No tracks found</div>';
    }
    
    // Trigger animation on next frame after content is ready
    requestAnimationFrame(() => {
      tracksContainer.classList.remove('collapsing');
      
      // Scroll into view after animation starts
      setTimeout(() => {
        try {
          tracksContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch {}
      }, 150);
    });
  } else {
    // Collapse: add collapsing class to hide with animation
    const icon = expandButton.querySelector('.expand-icon');
    if (icon) icon.textContent = '▼';
    expandButton.title = 'Show album tracks';
    expandButton.setAttribute('aria-label', 'Show album tracks');
    expandButton.setAttribute('aria-expanded', 'false');
    expandButton.classList.remove('expanded');
    tracksContainer.classList.add('collapsing');
    
    // Remove from expanded tracking
    try {
      if (window.__resonateExpandedAlbums) {
        window.__resonateExpandedAlbums.delete(albumId);
      }
    } catch {}
    
    // Cancel any in-flight metadata fetch
    if (typeof window.cancelTracklistFetch === 'function') {
      window.cancelTracklistFetch(albumId);
    }
  }
}

// Display tracks for an album
function displayAlbumTracks(albumId, tracksContainer) {
  const isInSearchResult = tracksContainer.closest('.search-result') !== null;
  const message = isInSearchResult ? 'Searching...' : 'Loading...';
  tracksContainer.innerHTML = `<div class="search-loading"><div class="loader"></div><span class="loader-text">${message}</span></div>`;

  const seedTracks = tracksContainer && Array.isArray(tracksContainer.__albumTracks)
    ? tracksContainer.__albumTracks
    : null;

  const tracksPromise = (window.AlbumTracks && typeof window.AlbumTracks.getTracks === 'function')
    ? window.AlbumTracks.getTracks(albumId, { sourceTracks: seedTracks, preferCache: true, allowFetch: true })
    : fetchOptimizedPlayableFiles(albumId);

  tracksPromise
    .then(files => {
      tracksContainer.innerHTML = '';

      if (files.length === 0) {
        tracksContainer.innerHTML = '<div class="no-results">No tracks found</div>';
        return;
      }

      const tracksList = document.createElement('div');
      tracksList.className = 'tracks-list';

      files.forEach((track, index) => {
        const trackItem = document.createElement('div');
        trackItem.className = 'track-item track-row';

        const isFavoritesContext = tracksContainer.closest('#favorites-list') !== null;

        const playFromTrackRow = () => {
          if (isFavoritesContext) {
            window.logger?.debug(`Track clicked in favorites context - calling playFromFavoritesQueue with track: ${track.title}`, 'PLAYBACK');
            window.preparePlaybackTransitionFromList?.({
              closeSearch: true,
              closeResontes: true,
              closeTracksPanel: true,
              collapseExpandedAlbums: true,
              showLoader: true,
              loaderContext: files.length > 1 ? 'album' : 'resontes',
              showProgress: false
            });
            if (typeof window.playFromFavoritesQueue === 'function') {
              window.playFromFavoritesQueue(track);
            } else if (typeof playFromFavoritesQueue === 'function') {
              playFromFavoritesQueue(track);
            }
          } else {
            if (typeof window.playSpecificSearchTrack === 'function') {
              window.playSpecificSearchTrack(track, albumId, index, files.length);
            }
          }
        };

        const isFavorite = isTrackFavorite(track);
        const trackNumber = track.trackNumber || index + 1;

        trackItem.innerHTML = `
          <div class="track-actions">
            <span class="track-number">${trackNumber}</span>
            <button class="track-favorite ${isFavorite ? 'active' : ''}" title="${isFavorite ? 'Remove from resonates' : 'Add to resonates'}" aria-label="${isFavorite ? 'Remove from resonates' : 'Add to resonates'}">${window.resonateLogoSVG || ''}</button>
            <button class="track-share" title="Share">🔗</button>
          </div>
          <div class="track-item-info">
            <div class="track-title track-row-title">${track.title || 'Untitled'}</div>
            <div class="track-creator">${track.creator || 'Unknown'}</div>
          </div>
        `;

        const favoriteBtn = trackItem.querySelector('.track-favorite');
        const shareBtn = trackItem.querySelector('.track-share');
        favoriteBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // Evitar que el clic se propague al resultado principal
          toggleFavorite(track);
          const isNowFavorite = isTrackFavorite(track);
          applyResonteButtonState(favoriteBtn, isNowFavorite, { animate: true });
        });

        if (shareBtn) {
          applyShareButtonState(shareBtn);
        }

        // Tap-to-play: click anywhere in the row except buttons
        trackItem.addEventListener('click', (e) => {
          if (e.target && e.target.closest && e.target.closest('button')) return;
          e.stopPropagation();
          playFromTrackRow();
        });

        // Share button listener
        if (shareBtn) {
          shareBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Evitar que el clic se propague al resultado principal
            const albumTitleForShare = track.album || (files[0] && files[0].album) || '';
            shareTrack(track.id || albumId, track.title, track.creator, albumTitleForShare, 'track', index);
          });
        }

        tracksList.appendChild(trackItem);
      });

      tracksContainer.appendChild(tracksList);
    })
    .catch(error => {
      window.logger?.error({ message: 'Error loading album tracks', error }, 'NETWORK');
      tracksContainer.innerHTML = '<div class="no-results">Error loading tracks</div>';
    });
}

function updatePlayButtonState() {
  const hasFavorites = !!(state.favorites && state.favorites.length > 0);
  const hasSearchResults = !!(state.searchResults && state.searchResults.length > 0);
  const hasSavedResume = !!(state.savedPlaybackState && state.savedPlaybackState.track && (state.savedPlaybackState.track.url || state.savedPlaybackState.track.id));
  const hasLegacyResume = !!(state.currentTrack && state.currentTrack.url);
  const hasResume = hasSavedResume || hasLegacyResume;

  // If we have neither favorites, search results, nor a resume snapshot, lock the player.
  const shouldLockPlayer = !hasFavorites && !hasSearchResults && !hasResume;

  // Apply a baseline disabled state to buttons inside the player content area.
  // We still override individual controls below for better UX.
  const playerContent = elements.playerContent;
  if (playerContent) {
    const buttons = playerContent.querySelectorAll('button');
    if (buttons) {
      buttons.forEach(button => {
        if (!button) return;
        // Don't disable buttons marked as always-enabled
        if (button.hasAttribute('data-always-enabled')) return;
        button.disabled = shouldLockPlayer;
      });
    }
  }

  if (shouldLockPlayer) {
    if (elements.prevBtn) elements.prevBtn.disabled = true;
    if (elements.playBtn) elements.playBtn.disabled = true;
    if (elements.nextBtn) elements.nextBtn.disabled = true;
    if (elements.favoriteBtn) elements.favoriteBtn.disabled = true;
    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.disabled = true;
    if (elements.playAllFavoritesBtn) elements.playAllFavoritesBtn.disabled = true;
    if (elements.playBtn) elements.playBtn.title = 'Search to get started';
    if (elements.prevBtn) elements.prevBtn.title = 'Search to get started';
    if (elements.nextBtn) elements.nextBtn.title = 'Search to get started';
    if (elements.favoriteBtn) elements.favoriteBtn.title = 'Search to get started';
    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.title = 'Search to get started';

    // Keep favorites toggle usable so users can open the panel and see the empty-state message.
    if (elements.favoritesToggle) elements.favoritesToggle.classList.remove('disabled');
    if (elements.playAllFavoritesBtn) elements.playAllFavoritesBtn.classList.add('disabled');
    
    // Keep buttons with data-always-enabled attribute enabled
    const alwaysEnabledButtons = playerContent ? playerContent.querySelectorAll('[data-always-enabled]') : [];
    alwaysEnabledButtons.forEach(btn => {
      if (btn) btn.disabled = false;
    });
  } else if (hasFavorites) {
    // Habilitar los controles relevantes cuando haya favoritos
    if (elements.prevBtn) elements.prevBtn.disabled = false;
    if (elements.playBtn) elements.playBtn.disabled = false;
    if (elements.nextBtn) elements.nextBtn.disabled = false;
    if (elements.favoriteBtn) elements.favoriteBtn.disabled = false;
    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.disabled = false;

    if (elements.playBtn) elements.playBtn.title = 'Play resonates';
    if (elements.prevBtn) elements.prevBtn.title = 'Previous track';
    if (elements.nextBtn) elements.nextBtn.title = 'Next track';
    if (elements.favoriteBtn) elements.favoriteBtn.title = 'Remove from resonates';
    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.title = 'Shuffle';

    // Enable favorites controls
    if (elements.favoritesToggle) elements.favoritesToggle.classList.remove('disabled');
    if (elements.playAllFavoritesBtn) elements.playAllFavoritesBtn.classList.remove('disabled');
  } else if (hasSearchResults) {
    // Search context: allow playback even without favorites
    enableControlsForSearchResults();
    // Favorites-only controls should remain disabled when there are no favorites.
    if (elements.playAllFavoritesBtn) elements.playAllFavoritesBtn.disabled = true;
    if (elements.playAllFavoritesBtn) elements.playAllFavoritesBtn.classList.add('disabled');
  } else if (hasResume) {
    // Resume snapshot exists: allow Play (and favoriting) even with an empty favorites list.
    if (elements.playBtn) elements.playBtn.disabled = false;
    if (elements.playBtn) elements.playBtn.title = 'Resume last track';

    if (elements.favoriteBtn) elements.favoriteBtn.disabled = false;
    if (elements.favoriteBtn) elements.favoriteBtn.title = 'Add to resonates';

    // Prev/Next depend on having a restored context; keep them conservative.
    if (elements.prevBtn) elements.prevBtn.disabled = true;
    if (elements.nextBtn) elements.nextBtn.disabled = true;
    if (elements.prevBtn) elements.prevBtn.title = 'Resume to enable navigation';
    if (elements.nextBtn) elements.nextBtn.title = 'Resume to enable navigation';

    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.disabled = true;
    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.title = 'Shuffle resonates';

    if (elements.playAllFavoritesBtn) elements.playAllFavoritesBtn.disabled = true;
    if (elements.playAllFavoritesBtn) elements.playAllFavoritesBtn.classList.add('disabled');

    // Keep favorites toggle usable so users can open the panel and see the empty-state message.
    if (elements.favoritesToggle) elements.favoritesToggle.classList.remove('disabled');
  }
}

function enableControlsForSearchResults() {
  // Si no hay favoritos pero hay resultados de búsqueda, habilitar los controles
  if (state.favorites.length === 0 && state.searchResults && state.searchResults.length > 0) {
    if (elements.playBtn) elements.playBtn.disabled = false;
    if (elements.playBtn) elements.playBtn.title = 'Play search result';

    if (elements.favoriteBtn) elements.favoriteBtn.disabled = false;
    if (elements.favoriteBtn) elements.favoriteBtn.title = 'Add to resonates';

    // The prev/next buttons work within search context
    if (elements.prevBtn) elements.prevBtn.disabled = false;
    if (elements.nextBtn) elements.nextBtn.disabled = false;
    if (elements.prevBtn) elements.prevBtn.title = 'Previous track (search)';
    if (elements.nextBtn) elements.nextBtn.title = 'Next track (search)';

    // The shuffle button works with current results
    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.disabled = false;
    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.title = 'Shuffle';
  }
}

// Connectivity monitoring
let __resonateConnectivityHandlersAttached = false;
let __resonateOfflineHintsShown = false;

function __resonateSetSearchOnlineState(isOnline) {
  // Keep search UX consistent with connectivity changes
  if (elements.searchInput) {
    // Avoid hard-disabling search: some environments report false offline.
    // Search will still fail gracefully at request-time if the network is truly down.
    elements.searchInput.disabled = false;
    elements.searchInput.placeholder = isOnline ? "Search for songs, artists, albums..." : "Offline (search may be unavailable)";
  }
}

function __resonateAttachConnectivityHandlersOnce() {
  if (__resonateConnectivityHandlersAttached) return;
  __resonateConnectivityHandlersAttached = true;

  // Let other scripts know that UI is handling connectivity status messaging
  window.__resonateConnectivityStatusHandled = true;

  window.addEventListener('online', () => {
    state.networkOnline = true;
    showStatus('Connection is restored', 'info', 2000);
    __resonateOfflineHintsShown = false;

    __resonateSetSearchOnlineState(true);
    updateOfflineIndicator();
    // Try to sync cached data when back online
    syncOfflineData();
  });

  window.addEventListener('offline', () => {
    state.networkOnline = false;
    showStatus('Switched to offline playback', 'offline', 4000);

    __resonateSetSearchOnlineState(false);
    updateOfflineIndicator();

    // Notificar si solo hay pistas offline disponibles
    if (typeof window.audioCache === 'object' && window.audioCache) {
      window.audioCache.getUsageStats().then(stats => {
        if (stats.itemCount > 0) {
          showStatus('You only have access to offline-saved tracks. Connect to update your library.', 'offline', 6000, 'offline');
        } else {
          showStatus('No offline tracks available. Connect to download your resonates.', 'offline', 6000, 'offline');
        }
      });
    }

    // Intentar reproducir desde caché si hay una pista actual
    if (state.currentTrack && elements.audio && elements.audio.src) {
      showStatus('Using cached version of track', 'info', 2000);
    }

    // Show offline-specific UI hints (once per offline session)
    if (!__resonateOfflineHintsShown) {
      __resonateOfflineHintsShown = true;
      showOfflineHints();
    }
  });
}

function setupConnectivityMonitoring() {
  // navigator.onLine can be undefined or unreliable in some contexts.
  // Default to online unless explicitly false.
  state.networkOnline = navigator.onLine !== false;

  __resonateSetSearchOnlineState(state.networkOnline);
  __resonateAttachConnectivityHandlersOnce();
}

// Configuration constants for page lifecycle
const MEDIA_SESSION_CLEANUP_DELAY_MS = 5000; // Delay before cleaning up MediaSession when page is hidden

/**
 * Helper function to restore MediaSession state
 * @private
 */
function restoreMediaSessionState() {
  if (!window.mediaSessionManager || !window.mediaSessionManager.isCleanedUp) {
    return;
  }
  
  window.mediaSessionManager.reset();
  
  // Re-setup handlers
  if (typeof setupMediaSession === 'function') {
    setupMediaSession();
  }
  
  // Re-update metadata if we have a current track
  if (window.state && window.state.currentTrack && window.state.currentIdentifier) {
    if (typeof updateMediaSessionMetadata === 'function') {
      updateMediaSessionMetadata(window.state.currentTrack, window.state.currentIdentifier);
    }
  }
}

// Page visibility and playback resume management
function setupPageVisibilityHandling() {
  if (window._resonatePageVisibilityInit) return;
  window._resonatePageVisibilityInit = true;
  // Listen for visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // App is hidden - save state
      savePlaybackState();
      
      // Battery optimization: cleanup MediaSession if no audio is playing
      if (window.mediaSessionManager && elements.audio && elements.audio.paused) {
        // Defer cleanup slightly to avoid issues with quick tab switches
        setTimeout(() => {
          if (document.hidden && elements.audio.paused) {
            window.mediaSessionManager.cleanup();
          }
        }, MEDIA_SESSION_CLEANUP_DELAY_MS);
      }
    } else {
      // App is visible again - re-initialize MediaSession if needed
      restoreMediaSessionState();
    }
  });

  // Page Lifecycle API: save state when the page is frozen (best-effort, supported on some browsers).
  // This helps on mobile/PWA when the OS suspends the page without firing other lifecycle events.
  try {
    document.addEventListener('freeze', () => {
      savePlaybackState();
      // Only cleanup MediaSession when audio is truly idle.  If audio is playing
      // or a track transition is in progress (isLoading), keep the handlers alive
      // so that lock-screen controls continue to work during background playback.
      if (window.mediaSessionManager) {
        const audio = elements && elements.audio;
        const isActiveOrTransitioning = (audio && !audio.paused) ||
          (window.state && window.state.isLoading);
        if (!isActiveOrTransitioning) {
          window.mediaSessionManager.cleanup();
        }
      }
    });
  } catch {
    // ignore
  }

  // Page Lifecycle API: restore MediaSession when page is resumed from frozen state
  try {
    document.addEventListener('resume', () => {
      // Re-initialize MediaSession if needed
      restoreMediaSessionState();
    });
  } catch {
    // ignore
  }

  // Also save state when page unloads
  window.addEventListener('beforeunload', () => {
    savePlaybackState();
    // Cleanup MediaSession on unload
    if (window.mediaSessionManager) {
      window.mediaSessionManager.cleanup();
    }
  });

  // Also save state when PWA might be closed (pagehide is better for mobile)
  window.addEventListener('pagehide', () => {
    savePlaybackState();
    // Cleanup MediaSession on pagehide
    if (window.mediaSessionManager) {
      window.mediaSessionManager.cleanup();
    }
  });
}

// Periodic autosave while playing (covers abrupt closes where lifecycle events might not fire)
function setupPlaybackAutosave() {
  if (window._resonatePlaybackAutosaveInit) return;
  window._resonatePlaybackAutosaveInit = true;

  const AUTOSAVE_INTERVAL_MS = 10000;
  let timerId = null;
  let lastSavedAt = 0;

  const shouldSkipTick = () => {
    try {
      if (!elements.audio) return true;
      if (elements.audio.paused) return true;
      if (!elements.audio.src) return true;
      if (!state || !state.currentTrack) return true;

      // Avoid saving during track transitions: require audio src to match the current loaded url when available.
      const audioSrc = canonicalizeUrlCandidate(elements.audio.currentSrc || elements.audio.src || '');
      const currentUrl = canonicalizeUrlCandidate(state.currentAudioUrl || '');
      if (currentUrl && audioSrc && audioSrc !== currentUrl) return true;

      return false;
    } catch {
      return true;
    }
  };

  const tick = () => {
    try {
      if (shouldSkipTick()) return;
      const now = Date.now();
      if (now - lastSavedAt < AUTOSAVE_INTERVAL_MS - 250) return;
      lastSavedAt = now;
      savePlaybackState();
    } catch {}
  };

  const start = () => {
    if (timerId) return;
    lastSavedAt = 0;
    timerId = window.setInterval(tick, AUTOSAVE_INTERVAL_MS);
  };

  const stop = () => {
    if (!timerId) return;
    window.clearInterval(timerId);
    timerId = null;
  };

  if (!elements.audio) return;
  elements.audio.addEventListener('play', start);
  elements.audio.addEventListener('pause', () => {
    try { savePlaybackState(); } catch {}
    stop();
  });
  elements.audio.addEventListener('ended', () => {
    try { savePlaybackState(); } catch {}
    stop();
  });
}

// Offline functionality setup


// Show offline-specific hints and information
function showOfflineHints() {
  const resontes = state.favorites || [];
  const favoritesCount = Array.isArray(resontes) ? resontes.length : 0;

  if (favoritesCount > 0) {
    showStatus('You have resonates available offline', 'info', 5000);
  } else {
    showStatus('Save your resonates to listen offline', 'warning', 6000);
  }

  // Check cache status
  if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.getUsageStats === 'function') {
    audioCache.getUsageStats().then(stats => {
      if (stats.itemCount > 0) {
        showStatus(`Cache has ${stats.itemCount} track${stats.itemCount !== 1 ? 's' : ''} saved`, 'info', 4000);
      }
    }).catch(error => {
      window.logger?.warn({ message: 'Failed to get cache stats', error }, 'CACHE');
    });
  }
}

// Sync data when back online
async function syncOfflineData() {
  try {
    // Reconciliación básica tras reconexión: merge de favoritos locales y persistidos
    try {
      const persisted = localStorage.getItem('resonate_favorites');
      const parsed = persisted ? JSON.parse(persisted) : [];
      const all = [...parsed, ...(state.favorites || [])];
      const unique = [];
      const seen = new Set();
      for (const fav of all) {
        const key = getTrackIdentityKey(fav) || (fav && fav.url ? String(fav.url) : '');
        if (key && !seen.has(key)) {
          unique.push(fav);
          seen.add(key);
        }
      }
      state.favorites = unique;
      localStorage.setItem('resonate_favorites', JSON.stringify(unique));
      window.logger?.info('Favorites reconciled after reconnect', 'UI');
      updateFavoritesList();
      updateFavoritesCount();
    } catch (reconcileError) {
      window.logger?.warn(`Failed to reconcile favorites: ${reconcileError.message}`, 'UI');
    }

    // Preload any pending favorites that weren't cached while offline
    if (state.favoritesPreloadEnabled && state.favorites && state.favorites.length > 0) {
      if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.preloadFavorites === 'function') {
        await audioCache.preloadFavorites(state.favorites);
        showStatus('Syncing your offline library', 'info', 2000);
      }
    }

    // Preload current search results if any
    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.preloadSearchResults === 'function') {
      if (Array.isArray(state.searchResults) && state.searchResults.length > 0) {
        await audioCache.preloadSearchResults(state.searchResults);
      }
    }

    // Could add other sync operations here (analytics, etc.)
  } catch (error) {
    window.logger?.warn(`Failed to sync offline data: ${error.message}`, 'SYNC');
  }
}

// Save current playback state to localStorage
function normalizePlaybackDescription(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    try {
      return value.map(v => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n\n');
    } catch {
      return '';
    }
  }

  try {
    if (typeof value === 'object') {
      const candidate = value.value || value.text || value.html;
      if (typeof candidate === 'string') return candidate;
    }
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function canonicalizeUrlCandidate(value) {
  if (!value) return '';
  try {
    return new URL(String(value), window.location.href).href;
  } catch {
    return String(value);
  }
}

async function hydrateSavedPlaybackItemDescription(savedState, identifier, trackTitleForUi) {
  try {
    if (!savedState || !identifier) return;
    if (typeof fetch !== 'function') return;

    const response = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
    if (!response.ok) return;

    const metadata = await response.json();
    const descRaw = metadata && metadata.metadata ? metadata.metadata.description : '';
    const itemDescription = normalizePlaybackDescription(descRaw).trim();
    if (!itemDescription) return;

    // Update in-memory state
    savedState.itemDescription = itemDescription;
    if (state.savedPlaybackState) state.savedPlaybackState.itemDescription = itemDescription;
    if (state.currentTrack && !state.currentTrack._albumDescription) {
      state.currentTrack._albumDescription = itemDescription;
    }

    // Persist without extending TTL (keep original timestamp)
    try {
      localStorage.setItem('resonate_playback_state', JSON.stringify(savedState));
    } catch {}

    // Rehydrate description UI
    try {
      if (window.updateDescriptionUI) {
        window.updateDescriptionUI({
          title: trackTitleForUi || (state.currentTrack && state.currentTrack.title) || 'Untitled',
          description: (savedState && savedState.trackDescription) ? savedState.trackDescription : '',
          _albumDescription: itemDescription
        });
      }
    } catch {}
  } catch (e) {
    window.logger?.warn(`Failed to hydrate item description: ${e.message}`, 'UI');
  }
}

function savePlaybackState() {
  if (state.currentTrack && elements.audio && elements.audio.src) {
    const trackTitle = state.currentTrack.title || 'Untitled';
    const itemDescription = normalizePlaybackDescription(state.currentTrack._albumDescription || '').trim();
    const trackDescription = normalizePlaybackDescription(state.currentTrack.description || '').trim();

    const trackUrlCanonical = canonicalizeUrlCandidate(state.currentTrack.url || '');
    const audioSrcAtSave = canonicalizeUrlCandidate(elements.audio.currentSrc || elements.audio.src || '');
    const currentAudioUrlCanonical = canonicalizeUrlCandidate(state.currentAudioUrl || '');
    const audioSrcKindAtSave = audioSrcAtSave && audioSrcAtSave.startsWith('blob:') ? 'blob' : 'url';

    // Strict coherence: do not persist if we're mid-transition and audio src doesn't match the loaded audio url.
    // This prevents snapshotting "new track metadata + old audio time" (or the opposite).
    if (currentAudioUrlCanonical && audioSrcAtSave && currentAudioUrlCanonical !== audioSrcAtSave) {
      return;
    }

    // Keep a compact, stable snapshot. Do not duplicate large track payloads.
    const trackSnapshot = {
      id: state.currentTrack.id,
      url: state.currentTrack.url,
      title: state.currentTrack.title,
      creator: state.currentTrack.creator,
      albumId: state.currentTrack.albumId || state.currentTrack.id,
      albumTitle: state.currentTrack.albumTitle || state.currentTrack.album || '',
      album: state.currentTrack.album || '',
      trackIndex: typeof state.currentTrack.trackIndex === 'number' ? state.currentTrack.trackIndex : 0,
      totalTracks: typeof state.currentTrack.totalTracks === 'number' ? state.currentTrack.totalTracks : 1,
      isAlbumTrack: !!state.currentTrack.isAlbumTrack,
      file: state.currentTrack.file,
      name: state.currentTrack.name
    };

    const currentTime = Number(elements.audio.currentTime);

    const queueSnapshot = (() => {
      try {
        if (typeof playbackManager === 'undefined' || !playbackManager) return null;
        if (typeof playbackManager.getCurrentContext !== 'function') return null;

        const context = playbackManager.getCurrentContext();
        if (!context) return null;

        const ctx = playbackManager.contextData && playbackManager.contextData[context]
          ? playbackManager.contextData[context]
          : null;

        const currentIndex = ctx && typeof ctx.currentIndex === 'number' && isFinite(ctx.currentIndex)
          ? ctx.currentIndex
          : null;

        const albumId = (context === 'album' && typeof playbackManager.getCurrentAlbumId === 'function')
          ? playbackManager.getCurrentAlbumId()
          : null;

        return {
          v: 1,
          context: String(context),
          currentIndex,
          albumId: albumId != null ? String(albumId) : null
        };
      } catch {
        return null;
      }
    })();

    const tracklistSnapshot = (() => {
      try {
        if (typeof playbackManager === 'undefined' || !playbackManager) return null;
        if (typeof playbackManager.getCurrentContext !== 'function') return null;

        const context = playbackManager.getCurrentContext();
        if (!context) return null;

        const ctx = playbackManager.contextData && playbackManager.contextData[context]
          ? playbackManager.contextData[context]
          : null;
        const items = ctx && Array.isArray(ctx.items) ? ctx.items : [];
        if (!items.length) return null;

        const albumId = (context === 'album' && typeof playbackManager.getCurrentAlbumId === 'function')
          ? playbackManager.getCurrentAlbumId()
          : (state.currentTrack && (state.currentTrack.albumId || state.currentTrack.id)) || null;

        const slim = items.map((t, idx) => ({
          id: t && (t.id || t.trackId || t.url) ? (t.id || t.trackId || t.url) : null,
          trackId: t && (t.trackId || t.id) ? (t.trackId || t.id) : null,
          url: t && t.url ? t.url : null,
          title: t && t.title ? t.title : 'Untitled',
          creator: t && t.creator ? t.creator : 'Unknown',
          albumId: t && (t.albumId || t.album || t.id) ? (t.albumId || t.album || t.id) : null,
          albumTitle: t && (t.albumTitle || t.album) ? (t.albumTitle || t.album) : '',
          trackIndex: (t && typeof t.trackIndex === 'number' && isFinite(t.trackIndex)) ? t.trackIndex : idx,
          totalTracks: (t && typeof t.totalTracks === 'number' && isFinite(t.totalTracks)) ? t.totalTracks : items.length
        })).filter(t => t && (t.url || t.id)).slice(0, 200);

        if (!slim.length) return null;

        return {
          v: 1,
          context: String(context),
          albumId: albumId != null ? String(albumId) : null,
          items: slim
        };
      } catch {
        return null;
      }
    })() || (() => {
      try {
        const items = Array.isArray(state.currentTracklist) ? state.currentTracklist : [];
        if (!items.length) return null;
        const albumId = (state.currentTrack && (state.currentTrack.albumId || state.currentTrack.id)) || null;
        const slim = items.map((t, idx) => ({
          id: t && (t.id || t.trackId || t.url) ? (t.id || t.trackId || t.url) : null,
          trackId: t && (t.trackId || t.id) ? (t.trackId || t.id) : null,
          url: t && t.url ? t.url : null,
          title: t && t.title ? t.title : 'Untitled',
          creator: t && t.creator ? t.creator : 'Unknown',
          albumId: t && (t.albumId || t.album || t.id) ? (t.albumId || t.album || t.id) : null,
          albumTitle: t && (t.albumTitle || t.album) ? (t.albumTitle || t.album) : '',
          trackIndex: (t && typeof t.trackIndex === 'number' && isFinite(t.trackIndex)) ? t.trackIndex : idx,
          totalTracks: (t && typeof t.totalTracks === 'number' && isFinite(t.totalTracks)) ? t.totalTracks : items.length
        })).filter(t => t && (t.url || t.id)).slice(0, 200);
        if (!slim.length) return null;
        return {
          v: 1,
          context: (state && state.currentTrack && state.currentTrack.isAlbumTrack) ? 'album' : 'unknown',
          albumId: albumId != null ? String(albumId) : null,
          items: slim
        };
      } catch {
        return null;
      }
    })();

    const playbackState = {
      v: 2,
      track: trackSnapshot,
      trackTitle,
      itemDescription,
      trackDescription,
      trackUrlCanonical,
      audioSrcAtSave,
      audioSrcKindAtSave,
      currentTime: Number.isFinite(currentTime) ? currentTime : 0,
      wasPlaying: !!(elements.audio && !elements.audio.paused),
      queue: queueSnapshot,
      tracklist: tracklistSnapshot,
      timestamp: Date.now()
    };

    try {
      localStorage.setItem('resonate_playback_state', JSON.stringify(playbackState));
      state.savedPlaybackState = playbackState;
      window.logger?.debug('Playback state saved', 'PLAYBACK');
    } catch (e) {
      window.logger?.warn({ message: 'Failed to save playback state', error: e }, 'PLAYBACK');
    }
  }
}

// Load saved playback state from previous session
function loadSavedPlaybackState() {
  try {
    const savedStateStr = localStorage.getItem('resonate_playback_state');
    if (!savedStateStr) return null;

    const parsed = JSON.parse(savedStateStr);
    const timestamp = parsed && parsed.timestamp ? parsed.timestamp : 0;
    const age = Date.now() - timestamp;
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    if (age < maxAge && parsed && parsed.track && parsed.currentTime !== undefined) {
      // Migrate legacy snapshots (v1) to v2 in-memory without extending TTL.
      const savedState = (parsed.v === 2)
        ? parsed
        : {
          v: 2,
          track: parsed.track,
          trackTitle: (parsed.trackTitle || (parsed.track && parsed.track.title) || 'Untitled'),
          itemDescription: normalizePlaybackDescription(
            parsed.itemDescription || (parsed.track && (parsed.track._albumDescription || parsed.track.description)) || ''
          ).trim(),
          trackDescription: normalizePlaybackDescription(
            parsed.trackDescription || (parsed.track && parsed.track.description) || ''
          ).trim(),
          trackUrlCanonical: canonicalizeUrlCandidate((parsed.track && parsed.track.url) || ''),
          audioSrcAtSave: canonicalizeUrlCandidate((parsed.track && parsed.track.url) || ''),
          audioSrcKindAtSave: 'url',
          currentTime: parsed.currentTime,
          timestamp
        };

      // Backfill missing strict-coherence fields for already-v2 snapshots.
      if (!savedState.trackDescription) {
        savedState.trackDescription = normalizePlaybackDescription((savedState.track && savedState.track.description) || '').trim();
      }
      if (!savedState.trackUrlCanonical) {
        savedState.trackUrlCanonical = canonicalizeUrlCandidate((savedState.track && savedState.track.url) || '');
      }
      if (!savedState.audioSrcAtSave) {
        // Best-effort: older snapshots didn't persist the audio src; use canonical track url.
        savedState.audioSrcAtSave = savedState.trackUrlCanonical;
      }
      if (!savedState.audioSrcKindAtSave) {
        savedState.audioSrcKindAtSave = (savedState.audioSrcAtSave && String(savedState.audioSrcAtSave).startsWith('blob:')) ? 'blob' : 'url';
      }

      state.savedPlaybackState = savedState;
      state.savedPlaybackQueueSnapshot = savedState && savedState.queue ? savedState.queue : null;
      state.savedPlaybackTracklist = savedState && savedState.tracklist ? savedState.tracklist : null;

      if (state.savedPlaybackTracklist && Array.isArray(state.savedPlaybackTracklist.items)) {
        state.currentTracklist = state.savedPlaybackTracklist.items.slice();
      }

      // Help continuous playback on refresh: remember the last context so playback.js can
      // reconstruct a loop even if the context restore races favorites loading.
      try {
        const lastCtx = state.savedPlaybackQueueSnapshot && state.savedPlaybackQueueSnapshot.context
          ? String(state.savedPlaybackQueueSnapshot.context)
          : '';
        if (lastCtx === 'favorites') {
          state.isPlayingFavorites = true;
        }
      } catch {}

      // Restore the track information (but don't start playing yet)
      state.currentTrack = { ...savedState.track };
      if (savedState.trackTitle && !state.currentTrack.title) state.currentTrack.title = savedState.trackTitle;
      if (savedState.itemDescription && !state.currentTrack._albumDescription) {
        state.currentTrack._albumDescription = savedState.itemDescription;
      }
      if (savedState.trackDescription && !state.currentTrack.description) {
        state.currentTrack.description = savedState.trackDescription;
      }
      {
        const trackTitle = state.currentTrack.title || 'Untitled';
        const isAlbumTrack = (state.currentTrack.totalTracks || 1) > 1 || !!state.currentTrack.isAlbumTrack;
        const albumTitle = (state.currentTrack.albumTitle || state.currentTrack.album || '').toString().trim();
        const titleText = (isAlbumTrack && albumTitle && albumTitle.toLowerCase() !== trackTitle.toLowerCase())
          ? `${albumTitle} — ${trackTitle}`
          : trackTitle;
        window.updateTitleTicker(titleText);
      }
      const totalTracks = Number.isFinite(state.currentTrack.totalTracks) ? state.currentTrack.totalTracks : 1;
      const trackIndex = Number.isFinite(state.currentTrack.trackIndex) ? state.currentTrack.trackIndex : 0;
      if (elements.creator) {
        elements.creator.textContent = totalTracks > 1
          ? `${state.currentTrack.creator || 'Unknown'} (${trackIndex + 1}/${totalTracks})`
          : `${state.currentTrack.creator || 'Unknown'}`;
      }
      setArtwork(state.currentTrack, state.currentTrack.id);
      updateFavoriteButton();

      // Rehydrate description UI from snapshot (itemDescription + trackTitle)
      try {
        if (window.updateDescriptionUI) {
          window.updateDescriptionUI({
            ...state.currentTrack,
            title: savedState.trackTitle || state.currentTrack.title || 'Untitled',
            description: savedState.trackDescription || state.currentTrack.description || '',
            _albumDescription: savedState.itemDescription || state.currentTrack._albumDescription || ''
          });
        }
      } catch {}

      // Seed album tracks from saved snapshot (best-effort) so Tracks list is available on resume.
      try {
        const tl = savedState && savedState.tracklist ? savedState.tracklist : null;
        if (tl && Array.isArray(tl.items) && tl.items.length && window.AlbumTracks && typeof window.AlbumTracks.seedAlbumTracks === 'function') {
          const albumId = tl.albumId || (state.currentTrack && (state.currentTrack.albumId || state.currentTrack.id));
          if (albumId) {
            window.AlbumTracks.seedAlbumTracks(String(albumId), tl.items, { source: 'playback-state' });
          }
        }
      } catch {}

      // Persist migrated shape (best-effort) without extending TTL.
      try {
        localStorage.setItem('resonate_playback_state', JSON.stringify(savedState));
      } catch {}

      // If favorites produced a minimal track without description, hydrate description lightly.
      if (!savedState.itemDescription && state.currentTrack && state.currentTrack.id) {
        hydrateSavedPlaybackItemDescription(savedState, state.currentTrack.id, savedState.trackTitle);
      }

      showStatus('Resuming your last track', 'info', 5000);
      // Ensure controls reflect the presence of a resume snapshot (Play should be enabled).
      try { updatePlayButtonState(); } catch {}
      return savedState;
    } else {
      // Expired, remove it
      localStorage.removeItem('resonate_playback_state');
      state.savedPlaybackState = null;
      state.savedPlaybackQueueSnapshot = null;
    }
  } catch (error) {
    window.logger?.warn({ message: 'Error loading saved playback state', error }, 'PLAYBACK');
    state.savedPlaybackState = null;
    state.savedPlaybackQueueSnapshot = null;
  }
  return null;
}

// --- Service Worker Auto-Update (Mode B: prompt) ---
const SW_UPDATE_CHANNEL_NAME = 'resonate_sw_update_v1';
const SW_UPDATE_SESSION_DISMISS_KEY = 'resonate_sw_update_banner_dismissed';
const SW_UPDATE_SESSION_DISMISS_VERSION_KEY = 'resonate_sw_update_banner_dismissed_version';
const SW_UPDATE_LEADER_KEY = 'resonate_sw_update_leader_v1';
const SW_UPDATE_LEADER_TTL_MS = 12000;
const SW_UPDATE_PENDING_RELOAD_KEY = 'resonate_sw_update_pending_reload';
const SW_UPDATE_RELOAD_MARKER_KEY = 'resonate_update_reload';
const SW_UPDATE_AUTO_APPLY_ONCE_KEY = 'resonate_sw_update_auto_applied';
const SW_UPDATE_LAST_CHECK_KEY = 'resonate_sw_update_last_check_v1';

const SW_UPDATE_CHECK_THROTTLE_MS = 60 * 1000;
const SW_UPDATE_PERIODIC_CHECK_PWA_MS = 10 * 60 * 1000;
const SW_UPDATE_PERIODIC_CHECK_BROWSER_MS = 30 * 60 * 1000;
const SW_UPDATE_PLAYBACK_QUERY_TIMEOUT_MS = 700;
const SW_UPDATE_SCHEDULED_REMINDER_KEY = 'resonate_sw_update_scheduled_reminder';
const SW_UPDATE_SCHEDULE_30MIN_MS = 30 * 60 * 1000;
const SW_UPDATE_SCHEDULE_1HOUR_MS = 60 * 60 * 1000;
const SW_UPDATE_SCHEDULE_2HOURS_MS = 2 * 60 * 60 * 1000;

// Force autoupdate: apply updates automatically when ready.
// Safety: if playback is active, activation/reload is deferred until idle.
const SW_FORCE_AUTOUPDATE = false;

function isPlaybackActiveInThisWindow() {
  try {
    const audio = elements && elements.audio ? elements.audio : null;
    return !!(audio && !audio.paused);
  } catch {
    return false;
  }
}

function getAutoAppliedSwVersionForSession() {
  try {
    const raw = sessionStorage.getItem(SW_UPDATE_AUTO_APPLY_ONCE_KEY);
    const s = (raw != null ? String(raw) : '').trim();
    return s || null;
  } catch {
    return null;
  }
}

function markAutoAppliedSwVersionForSession(version) {
  try {
    if (!version) return;
    sessionStorage.setItem(SW_UPDATE_AUTO_APPLY_ONCE_KEY, String(version));
  } catch {
    // ignore
  }
}

function wasAutoAppliedForVersion(version) {
  if (!version) return false;
  try {
    return getAutoAppliedSwVersionForSession() === String(version);
  } catch {
    return false;
  }
}

function getLastSwUpdateCheckTs() {
  try {
    const raw = localStorage.getItem(SW_UPDATE_LAST_CHECK_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function setLastSwUpdateCheckTs(ts) {
  try {
    localStorage.setItem(SW_UPDATE_LAST_CHECK_KEY, String(Number(ts) || Date.now()));
  } catch {
    // ignore
  }
}

function getResonateVersionFromMeta() {
  try {
    const el = document.querySelector('meta[name="resonate-version"]');
    const v = el && el.getAttribute ? el.getAttribute('content') : null;
    const s = (v != null ? String(v) : '').trim();
    return s || null;
  } catch {
    return null;
  }
}

function getUpdateTabId() {
  try {
    const key = 'resonate_tab_id_v1';
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `tab_${Math.random().toString(16).slice(2)}_${Date.now()}`;
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return `tab_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  }
}

const __resonateUpdateTabId = getUpdateTabId();

function canUseBroadcastChannel() {
  try { return typeof BroadcastChannel === 'function'; } catch { return false; }
}

function ensureUpdateChannel() {
  if (window.__resonateSwUpdateChannel) return window.__resonateSwUpdateChannel;
  try {
    if (canUseBroadcastChannel()) {
      window.__resonateSwUpdateChannel = new BroadcastChannel(SW_UPDATE_CHANNEL_NAME);
      return window.__resonateSwUpdateChannel;
    }
  } catch {
    // ignore
  }
  window.__resonateSwUpdateChannel = null;
  return null;
}

function broadcastUpdateMessage(msg) {
  try {
    const payload = { ...(msg || {}), _from: __resonateUpdateTabId, _ts: Date.now() };
    const ch = ensureUpdateChannel();
    if (ch) {
      ch.postMessage(payload);
      return;
    }
  } catch {
    // ignore
  }

  // Fallback: storage event
  try {
    localStorage.setItem('resonate_sw_update_broadcast_fallback', JSON.stringify({ ...(msg || {}), _from: __resonateUpdateTabId, _ts: Date.now() }));
  } catch {
    // ignore
  }
}

function onBroadcastUpdateMessage(handler) {
  const safeHandler = (data) => {
    try {
      if (!data || (data._from && data._from === __resonateUpdateTabId)) return;
      handler(data);
    } catch {
      // ignore
    }
  };

  const ch = ensureUpdateChannel();
  if (ch) {
    try {
      ch.addEventListener('message', (ev) => safeHandler(ev && ev.data));
    } catch {
      // ignore
    }
  }

  try {
    window.addEventListener('storage', (ev) => {
      if (!ev || ev.key !== 'resonate_sw_update_broadcast_fallback') return;
      try {
        const parsed = ev.newValue ? JSON.parse(ev.newValue) : null;
        safeHandler(parsed);
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }
}

function getDismissedUpdateVersion() {
  try {
    const raw = sessionStorage.getItem(SW_UPDATE_SESSION_DISMISS_VERSION_KEY);
    const s = (raw != null ? String(raw) : '').trim();
    return s || null;
  } catch {
    return null;
  }
}

function isUpdateBannerDismissedForSession(newVersion = null) {
  try {
    if (sessionStorage.getItem(SW_UPDATE_SESSION_DISMISS_KEY) !== 'true') return false;
    const dismissedVersion = getDismissedUpdateVersion();
    if (!newVersion) return false;
    if (!dismissedVersion) return false;
    return String(newVersion) === String(dismissedVersion);
  } catch {
    return false;
  }
}

function dismissUpdateBannerForSession(newVersion = null) {
  try { sessionStorage.setItem(SW_UPDATE_SESSION_DISMISS_KEY, 'true'); } catch {}
  try {
    if (newVersion) sessionStorage.setItem(SW_UPDATE_SESSION_DISMISS_VERSION_KEY, String(newVersion));
  } catch {}
}

function getScheduledUpdateReminderTs(newVersion = null) {
  try {
    const raw = localStorage.getItem(SW_UPDATE_SCHEDULED_REMINDER_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || !entry.ts) return null;
    if (newVersion && entry.version && String(entry.version) !== String(newVersion)) return null;
    return Number(entry.ts) || null;
  } catch {
    return null;
  }
}

function setScheduledUpdateReminderTs(ts, newVersion = null) {
  try {
    localStorage.setItem(SW_UPDATE_SCHEDULED_REMINDER_KEY, JSON.stringify({ ts: Number(ts), version: newVersion || null }));
  } catch {
    // ignore
  }
}

function clearScheduledUpdateReminder() {
  try { localStorage.removeItem(SW_UPDATE_SCHEDULED_REMINDER_KEY); } catch {}
}

function isUpdateReminderDue(newVersion = null) {
  const ts = getScheduledUpdateReminderTs(newVersion);
  if (!ts) return false;
  return Date.now() >= ts;
}

function isUpdateSnoozed(newVersion = null) {
  const ts = getScheduledUpdateReminderTs(newVersion);
  if (!ts) return false;
  return Date.now() < ts;
}

function tryBecomeUpdateLeader() {
  try {
    const now = Date.now();
    const raw = localStorage.getItem(SW_UPDATE_LEADER_KEY);
    const existing = raw ? JSON.parse(raw) : null;
    const isStale = !existing || !existing.ts || (now - Number(existing.ts) > SW_UPDATE_LEADER_TTL_MS);
    if (isStale) {
      localStorage.setItem(SW_UPDATE_LEADER_KEY, JSON.stringify({ id: __resonateUpdateTabId, ts: now }));
    }
    const checkRaw = localStorage.getItem(SW_UPDATE_LEADER_KEY);
    const check = checkRaw ? JSON.parse(checkRaw) : null;
    return !!(check && check.id === __resonateUpdateTabId);
  } catch {
    // If localStorage is unavailable, degrade to showing in current tab.
    return true;
  }
}

function renewUpdateLeaderLease() {
  try {
    const raw = localStorage.getItem(SW_UPDATE_LEADER_KEY);
    const existing = raw ? JSON.parse(raw) : null;
    if (!existing || existing.id !== __resonateUpdateTabId) return;
    localStorage.setItem(SW_UPDATE_LEADER_KEY, JSON.stringify({ id: __resonateUpdateTabId, ts: Date.now() }));
  } catch {
    // ignore
  }
}

function showServiceWorkerUpdateBanner({ currentVersion = null, newVersion = null } = {}) {
  if (isUpdateBannerDismissedForSession(newVersion)) return;
  if (document.getElementById('sw-update-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'sw-update-banner';
  banner.className = 'pwa-install-banner sw-update-banner';

  const versionText = (currentVersion && newVersion)
    ? `Update available (v${currentVersion} → v${newVersion})`
    : (newVersion ? `Update available (v${newVersion})` : 'Update available');

  banner.innerHTML = `
    <div class="pwa-banner-content">
      <div class="pwa-banner-text">
        <div class="pwa-banner-buttons">
          ${versionText}
          <button class="pwa-install-btn sw-update-apply-btn">Update</button>
          <button class="pwa-install-btn sw-update-later-btn" style="background: transparent; color: var(--fg); border: 1px solid rgba(255,255,255,0.18)">Later</button>
          <button class="pwa-close-btn sw-update-close-btn" aria-label="Close">✕</button>
        </div>
      </div>
    </div>
  `;

  const applyBtn = banner.querySelector('.sw-update-apply-btn');
  const laterBtn = banner.querySelector('.sw-update-later-btn');
  const closeBtn = banner.querySelector('.sw-update-close-btn');

  const hide = (dismiss = false) => {
    try {
      if (dismiss) dismissUpdateBannerForSession(newVersion);
      banner.classList.remove('active');
      setTimeout(() => {
        try { banner.remove(); } catch {}
      }, 300);
    } catch {
      try { banner.remove(); } catch {}
    }
  };

  applyBtn?.addEventListener('click', async () => {
    try {
      hide(false);
      await applyServiceWorkerUpdateAcrossTabs();
    } catch (e) {
      window.logger?.warn({ message: 'Apply update failed', error: e }, 'SYSTEM');
      showStatus('Update failed', 'warning', 3500);
    }
  });

  const later = () => {
    hide(true);
    broadcastUpdateMessage({ type: 'UPDATE_BANNER_DISMISSED', newVersion: newVersion || null });
  };

  laterBtn?.addEventListener('click', later);
  closeBtn?.addEventListener('click', later);

  document.body.appendChild(banner);
  setTimeout(() => banner.classList.add('active'), 100);

  // Keep leadership alive while visible so only one tab prompts.
  const leaseTimer = window.setInterval(() => {
    if (!document.getElementById('sw-update-banner')) {
      window.clearInterval(leaseTimer);
      return;
    }
    renewUpdateLeaderLease();
  }, Math.max(2000, Math.floor(SW_UPDATE_LEADER_TTL_MS / 3)));
}

function showUpdateModal({ currentVersion = null, newVersion = null } = {}) {
  if (document.getElementById('sw-update-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'sw-update-modal-overlay';
  overlay.className = 'sw-update-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'sw-update-modal-title');

  const versionLine = (currentVersion && newVersion)
    ? `v${currentVersion} → v${newVersion}`
    : (newVersion ? `v${newVersion}` : null);

  overlay.innerHTML = `
    <div class="sw-update-modal" id="sw-update-modal">
      <button class="sw-update-modal-close" aria-label="Close">✕</button>
      <span class="sw-update-modal-icon" aria-hidden="true">🚀</span>
      <h2 class="sw-update-modal-title" id="sw-update-modal-title">Updates available!</h2>
      ${versionLine ? `<div class="sw-update-modal-version">${versionLine}</div>` : ''}
      <p class="sw-update-modal-body">
        Resonate has a new version with improvements and fixes.<br>
        Do you want to update now or schedule it for later?
      </p>
      <div class="sw-update-modal-actions">
        <button class="sw-update-modal-btn-primary sw-update-modal-apply">Update now</button>
        <button class="sw-update-modal-btn-secondary sw-update-modal-later">Remind me later</button>
        <div class="sw-update-modal-schedule" id="sw-update-schedule-panel">
          <div class="sw-update-modal-schedule-label">When would you like to be reminded?</div>
          <div class="sw-update-modal-schedule-options">
            <button class="sw-update-modal-schedule-btn" data-delay="${SW_UPDATE_SCHEDULE_30MIN_MS}">In 30 min</button>
            <button class="sw-update-modal-schedule-btn" data-delay="${SW_UPDATE_SCHEDULE_1HOUR_MS}">In 1 hour</button>
            <button class="sw-update-modal-schedule-btn" data-delay="${SW_UPDATE_SCHEDULE_2HOURS_MS}">In 2 hours</button>
            <button class="sw-update-modal-schedule-btn" data-delay="0">This session</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const applyBtn = overlay.querySelector('.sw-update-modal-apply');
  const laterBtn = overlay.querySelector('.sw-update-modal-later');
  const closeBtn = overlay.querySelector('.sw-update-modal-close');
  const schedulePanel = overlay.querySelector('#sw-update-schedule-panel');
  const scheduleBtns = overlay.querySelectorAll('.sw-update-modal-schedule-btn');

  let onKeyDown = null;

  const hide = () => {
    try {
      if (onKeyDown) {
        document.removeEventListener('keydown', onKeyDown);
        onKeyDown = null;
      }
      overlay.classList.remove('active');
      setTimeout(() => {
        try { overlay.remove(); } catch {}
      }, 300);
    } catch {
      try { overlay.remove(); } catch {}
    }
  };

  applyBtn?.addEventListener('click', async () => {
    try {
      clearScheduledUpdateReminder();
      hide();
      await applyServiceWorkerUpdateAcrossTabs();
    } catch (e) {
      window.logger?.warn({ message: 'Apply update failed', error: e }, 'SYSTEM');
      showStatus('Error applying the update', 'warning', 3500);
    }
  });

  laterBtn?.addEventListener('click', () => {
    schedulePanel?.classList.toggle('visible');
  });

  scheduleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const delay = Number(btn.getAttribute('data-delay')) || 0;
      if (delay > 0) {
        setScheduledUpdateReminderTs(Date.now() + delay, newVersion);
      } else {
        dismissUpdateBannerForSession(newVersion);
        clearScheduledUpdateReminder();
      }
      hide();
      broadcastUpdateMessage({ type: 'UPDATE_BANNER_DISMISSED', newVersion: newVersion || null });
    });
  });

  closeBtn?.addEventListener('click', () => {
    dismissUpdateBannerForSession(newVersion);
    hide();
  });

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      dismissUpdateBannerForSession(newVersion);
      hide();
    }
  });

  // Close on Escape key
  onKeyDown = (e) => {
    if (e.key === 'Escape') {
      dismissUpdateBannerForSession(newVersion);
      hide();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add('active'), 50);

  // Keep leadership alive while visible so only one tab prompts.
  const leaseTimer = window.setInterval(() => {
    if (!document.getElementById('sw-update-modal-overlay')) {
      window.clearInterval(leaseTimer);
      return;
    }
    renewUpdateLeaderLease();
  }, Math.max(2000, Math.floor(SW_UPDATE_LEADER_TTL_MS / 3)));
}

function requestWorkerVersion(worker) {
  return new Promise((resolve) => {
    try {
      if (!worker || typeof worker.postMessage !== 'function') return resolve(null);
      const channel = new MessageChannel();
      const timeout = window.setTimeout(() => resolve(null), 1200);
      channel.port1.onmessage = (ev) => {
        window.clearTimeout(timeout);
        try {
          const data = ev && ev.data ? ev.data : null;
          resolve(data && data.version ? String(data.version) : null);
        } catch {
          resolve(null);
        }
      };
      worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
    } catch {
      resolve(null);
    }
  });
}

async function computeCurrentAndWaitingVersions(registration) {
  try {
    const current = await requestWorkerVersion(navigator.serviceWorker?.controller) || getResonateVersionFromMeta();
    const waiting = await requestWorkerVersion(registration && registration.waiting ? registration.waiting : null);
    return { currentVersion: current, newVersion: waiting };
  } catch {
    return { currentVersion: getResonateVersionFromMeta(), newVersion: null };
  }
}

function waitForWaitingWorker(registration, timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (!registration) return resolve(false);
    if (registration.waiting) return resolve(true);

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(!!value);
    };

    const installing = registration.installing;
    if (installing && typeof installing.addEventListener === 'function') {
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed') {
          // Allow the registration to update its waiting reference.
          setTimeout(() => finish(registration.waiting), 50);
        }
      });
    }

    setTimeout(() => finish(registration.waiting), Math.max(200, Number(timeoutMs) || 0));
  });
}

async function maybeAnnounceUpdateReady(registration) {
  try {
    if (!registration || !registration.waiting) return;
    const versions = await computeCurrentAndWaitingVersions(registration);
    broadcastUpdateMessage({ type: 'UPDATE_READY', ...versions });

    if (!tryBecomeUpdateLeader()) return;

    if (SW_FORCE_AUTOUPDATE) {
      // Trigger coordinated apply across tabs (best-effort).
      // Note: do NOT gate on "auto-applied" here; another window may not have the waiting SW yet.
      await applyServiceWorkerUpdateAcrossTabs({ expectedNewVersion: versions.newVersion || null });
      return;
    }

    if (isUpdateSnoozed(versions.newVersion)) return;
    if (isUpdateReminderDue(versions.newVersion)) clearScheduledUpdateReminder();
    showUpdateModal(versions);
  } catch {
    // ignore
  }
}

async function queryPlaybackStateAcrossWindows(timeoutMs = SW_UPDATE_PLAYBACK_QUERY_TIMEOUT_MS) {
  // Ensure the coordination handler is installed so we can receive PLAYBACK_STATE messages.
  try { ensureServiceWorkerUpdateCoordinationHandlers(); } catch {}

  const reqId = (() => {
    try {
      return (crypto && crypto.randomUUID) ? crypto.randomUUID() : `req_${Math.random().toString(16).slice(2)}_${Date.now()}`;
    } catch {
      return `req_${Math.random().toString(16).slice(2)}_${Date.now()}`;
    }
  })();

  const query = {
    reqId,
    states: new Map([[__resonateUpdateTabId, isPlaybackActiveInThisWindow()]]),
    createdAt: Date.now()
  };

  window.__resonateSwPlaybackQuery = query;
  broadcastUpdateMessage({ type: 'QUERY_PLAYBACK_STATE', reqId });

  await new Promise((resolve) => window.setTimeout(resolve, Math.max(100, Number(timeoutMs) || 0)));

  try {
    const active = window.__resonateSwPlaybackQuery;
    if (active && active.reqId === reqId) {
      window.__resonateSwPlaybackQuery = null;
      const playing = new Set();
      for (const [tabId, isPlaying] of active.states.entries()) {
        if (isPlaying) playing.add(tabId);
      }
      return playing;
    }
  } catch {
    // ignore
  }

  // Fallback: local only.
  return new Set(isPlaybackActiveInThisWindow() ? [__resonateUpdateTabId] : []);
}

function ensureSwIdleNotifierOnce() {
  try {
    if (window.__resonateSwIdleNotifierInstalled) return;
    window.__resonateSwIdleNotifierInstalled = true;
  } catch {
    // ignore
  }

  const audio = elements && elements.audio ? elements.audio : null;
  if (!audio || typeof audio.addEventListener !== 'function') return;

  const notifyIdle = () => {
    try {
      if (!window.__resonateSwShouldNotifyIdle) return;
      window.__resonateSwShouldNotifyIdle = false;
      broadcastUpdateMessage({ type: 'WINDOW_IDLE', tabId: __resonateUpdateTabId, ts: Date.now() });
    } catch {
      // ignore
    }
  };

  audio.addEventListener('pause', notifyIdle);
  audio.addEventListener('ended', notifyIdle);
}

async function applyServiceWorkerUpdateAcrossTabs({ expectedNewVersion = null } = {}) {
  if (!('serviceWorker' in navigator)) return;

  try {
    try {
      if (window.__resonateSwApplyInProgress) return;
      window.__resonateSwApplyInProgress = true;
    } catch {
      // ignore
    }

    try { ensureServiceWorkerUpdateCoordinationHandlers(); } catch {}

    // Save state best-effort so we can resume after reload.
    try { savePlaybackState(); } catch {}

    try { sessionStorage.setItem(SW_UPDATE_PENDING_RELOAD_KEY, 'true'); } catch {}
    try { sessionStorage.setItem(SW_UPDATE_RELOAD_MARKER_KEY, '1'); } catch {}

    broadcastUpdateMessage({ type: 'APPLY_UPDATE', expectedNewVersion: expectedNewVersion || null });

    const reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) {
      showStatus('No Service Worker registration found', 'warning', 3000);
      return;
    }

    const tryActivateWaitingWorker = async () => {
      if (!reg || !reg.waiting) return false;

      const waitingVersion = expectedNewVersion || (await requestWorkerVersion(reg.waiting));
      if (waitingVersion && wasAutoAppliedForVersion(waitingVersion)) {
        return true;
      }

      const playingTabs = await queryPlaybackStateAcrossWindows();
      if (playingTabs && playingTabs.size > 0) {
        // Defer activation until all windows are idle.
        try { window.__resonateSwShouldNotifyIdle = true; } catch {}
        ensureSwIdleNotifierOnce();
        broadcastUpdateMessage({ type: 'UPDATE_ACTIVATION_DEFERRED', expectedNewVersion: waitingVersion || null, ts: Date.now() });
        showStatus('Update will apply when playback is idle', 'info', 3500);
        return true;
      }

      if (waitingVersion) markAutoAppliedSwVersionForSession(waitingVersion);
      try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch {}
      return true;
    };

    // If update already waiting, try to activate it.
    if (await tryActivateWaitingWorker()) return;

    // Otherwise, ask the browser to check.
    try {
      await reg.update();
    } catch {
      // ignore
    }

    // If it is now waiting, try to activate it.
    if (await tryActivateWaitingWorker()) return;

    // Give the browser a moment to move installing -> waiting, then retry.
    try {
      await waitForWaitingWorker(reg, 4500);
    } catch {}
    if (await tryActivateWaitingWorker()) return;

    showStatus('Update is not ready yet', 'info', 2500);
  } finally {
    try { window.__resonateSwApplyInProgress = false; } catch {}
  }
}

function ensureServiceWorkerControllerChangeReloadHandler() {
  if (window.__resonateSwControllerChangeHandlerInstalled) return;
  window.__resonateSwControllerChangeHandlerInstalled = true;

  try {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      try {
        const pending = sessionStorage.getItem(SW_UPDATE_PENDING_RELOAD_KEY) === 'true';
        if (!pending) return;
        sessionStorage.removeItem(SW_UPDATE_PENDING_RELOAD_KEY);
        sessionStorage.setItem(SW_UPDATE_RELOAD_MARKER_KEY, '1');
        window.location.reload();
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }
}

function ensureServiceWorkerUpdateCoordinationHandlers() {
  if (window.__resonateSwUpdateCoordinationInit) return;
  window.__resonateSwUpdateCoordinationInit = true;

  ensureServiceWorkerControllerChangeReloadHandler();

  onBroadcastUpdateMessage(async (msg) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'QUERY_PLAYBACK_STATE') {
      try {
        broadcastUpdateMessage({
          type: 'PLAYBACK_STATE',
          reqId: msg.reqId || null,
          tabId: __resonateUpdateTabId,
          isPlaying: isPlaybackActiveInThisWindow(),
          ts: Date.now()
        });
      } catch {
        // ignore
      }
      return;
    }

    if (msg.type === 'PLAYBACK_STATE') {
      try {
        const q = window.__resonateSwPlaybackQuery;
        if (!q || !q.reqId || !msg.reqId || q.reqId !== msg.reqId) return;
        const tabId = msg.tabId ? String(msg.tabId) : null;
        if (!tabId) return;
        q.states.set(tabId, !!msg.isPlaying);
      } catch {
        // ignore
      }
      return;
    }

    if (msg.type === 'UPDATE_READY') {
      if (!tryBecomeUpdateLeader()) return;

      if (SW_FORCE_AUTOUPDATE) {
        await applyServiceWorkerUpdateAcrossTabs({ expectedNewVersion: msg.newVersion || null });
        return;
      }

      if (isUpdateBannerDismissedForSession(msg.newVersion || null)) return;
      if (isUpdateSnoozed(msg.newVersion || null)) return;
      showUpdateModal({ currentVersion: msg.currentVersion || null, newVersion: msg.newVersion || null });
      return;
    }

    if (msg.type === 'UPDATE_ACTIVATION_DEFERRED') {
      // If this window is playing, arm an idle notifier so the leader can retry activation.
      try {
        const isPlaying = isPlaybackActiveInThisWindow();
        if (isPlaying) {
          window.__resonateSwShouldNotifyIdle = true;
          ensureSwIdleNotifierOnce();
        }
      } catch {
        // ignore
      }
      return;
    }

    if (msg.type === 'WINDOW_IDLE') {
      // When any window becomes idle, the leader retries activation (throttled).
      try {
        if (!tryBecomeUpdateLeader()) return;
        const now = Date.now();
        const last = Number(window.__resonateSwLastIdleRetryTs || 0);
        if (now - last < 500) return;
        window.__resonateSwLastIdleRetryTs = now;
        await applyServiceWorkerUpdateAcrossTabs({ expectedNewVersion: msg.expectedNewVersion || null });
      } catch {
        // ignore
      }
      return;
    }

    if (msg.type === 'UPDATE_BANNER_DISMISSED') {
      // Hide if visible in this tab.
      const banner = document.getElementById('sw-update-banner');
      if (banner) {
        try { banner.classList.remove('active'); } catch {}
        try { banner.remove(); } catch {}
      }
      dismissUpdateBannerForSession(msg.newVersion || null);
      return;
    }

    if (msg.type === 'APPLY_UPDATE') {
      try { savePlaybackState(); } catch {}
      try { sessionStorage.setItem(SW_UPDATE_PENDING_RELOAD_KEY, 'true'); } catch {}
      try { sessionStorage.setItem(SW_UPDATE_RELOAD_MARKER_KEY, '1'); } catch {}

      // Only a leader should activate the waiting worker. Others just prepare for reload.
      try {
        if (isPlaybackActiveInThisWindow()) {
          window.__resonateSwShouldNotifyIdle = true;
          ensureSwIdleNotifierOnce();
        }

        if (tryBecomeUpdateLeader()) {
          await applyServiceWorkerUpdateAcrossTabs({ expectedNewVersion: msg.expectedNewVersion || null });
        } else {
          // Best-effort: warm the update check so waiting is ready when the leader activates.
          const reg = await navigator.serviceWorker.getRegistration('/');
          if (reg) {
            try { await reg.update(); } catch {}
          }
        }
      } catch {
        // ignore
      }
    }
  });
}

async function checkForServiceWorkerUpdates(reason = '') {
  if (!('serviceWorker' in navigator)) return;
  try { ensureServiceWorkerUpdateCoordinationHandlers(); } catch {}

  try {
    try {
      if (window.__resonateSwUpdateCheckInProgress) return;
      window.__resonateSwUpdateCheckInProgress = true;
    } catch {
      // ignore
    }

    // Throttle across all windows (localStorage) and prefer a single leader.
    try {
      const now = Date.now();
      const last = getLastSwUpdateCheckTs();
      if (last && now - last < SW_UPDATE_CHECK_THROTTLE_MS) return;
      if (!tryBecomeUpdateLeader()) return;
      setLastSwUpdateCheckTs(now);
    } catch {
      // ignore
    }

    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      if (!reg) return;
      await reg.update();
      try { await waitForWaitingWorker(reg, 4500); } catch {}
      await maybeAnnounceUpdateReady(reg);
    } catch (e) {
      // ignore
    }
  } finally {
    try { window.__resonateSwUpdateCheckInProgress = false; } catch {}
  }
}

function ensureServiceWorkerUpdateCheckHandlers() {
  if (window.__resonateSwUpdateCheckHandlersInstalled) return;
  window.__resonateSwUpdateCheckHandlersInstalled = true;

  // PWA/standalone often doesn't navigate, so add resume/focus checks.
  try {
    window.addEventListener('focus', () => checkForServiceWorkerUpdates('focus'));
  } catch {}

  try {
    window.addEventListener('pageshow', () => checkForServiceWorkerUpdates('pageshow'));
  } catch {}

  try {
    document.addEventListener('visibilitychange', () => {
      try {
        if (!document.hidden) checkForServiceWorkerUpdates('visible');
      } catch {}
    });
  } catch {}

  try {
    window.addEventListener('online', () => checkForServiceWorkerUpdates('online'));
  } catch {}

  try {
    const interval = (typeof isRunningAsPWA === 'function' && isRunningAsPWA())
      ? SW_UPDATE_PERIODIC_CHECK_PWA_MS
      : SW_UPDATE_PERIODIC_CHECK_BROWSER_MS;

    window.setInterval(() => {
      try {
        if (document.hidden) return;
        checkForServiceWorkerUpdates('periodic');
      } catch {
        // ignore
      }
    }, Math.max(60 * 1000, Number(interval) || SW_UPDATE_PERIODIC_CHECK_BROWSER_MS));
  } catch {
    // ignore
  }
}

function updateFavoritesList() {
  const favoritesRoot = elements.favoritesList || elements.resontesList;
  const favoritesList = elements.favoritesListContent || elements.resontesListContent || elements.favoritesList || elements.resontesList;
  if (!favoritesList) return;

  // Ensure toolbar bindings exist
  try { initializePanelToolbarsOnce(); } catch {}

  // Show header while panel is open
  try {
    const headerEl = elements.favoritesHeader || elements.resontesHeader;
    if (headerEl) {
      headerEl.hidden = !(favoritesRoot && favoritesRoot.classList && favoritesRoot.classList.contains('active'));
      const labelEl = elements.favoritesCountLabel || elements.resontesCountLabel;
      if (labelEl) {
        const count = (state && Array.isArray(state.favorites)) ? state.favorites.length : 0;
        const filterText = (state.favoritesUi && typeof state.favoritesUi.filterText === 'string') ? state.favoritesUi.filterText.trim() : '';
        
        // Dynamic header similar to search results: "{N} resonates for '{term}'"
        if (filterText) {
          labelEl.textContent = `${count} resonates for '${filterText}'`;
        } else {
          labelEl.textContent = `${count} Resonates`;
        }
      }
    }

    // Placeholder that includes the resontes count
    const filterEl = elements.favoritesFilter || elements.resontesFilter;
    if (filterEl) {
      const count = (state && Array.isArray(state.favorites)) ? state.favorites.length : 0;
      const msg = count > 0
        ? `Search your ${count} resonates`
        : 'Search your resonates';
      filterEl.placeholder = msg;
      filterEl.title = msg;
    }

    const offlineOnlyEl = elements.favoritesOfflineOnly || elements.resontesOfflineOnly;
    if (offlineOnlyEl) {
      offlineOnlyEl.checked = !!(state.favoritesUi && state.favoritesUi.offlineOnly);
      try { setBodyUiState('favorites-show-offline-chips', !!(state.favoritesUi && state.favoritesUi.offlineOnly)); } catch {}
    }
    if (filterEl) {
      const ft = (state.favoritesUi && typeof state.favoritesUi.filterText === 'string') ? state.favoritesUi.filterText : '';
      if (filterEl.value !== ft) filterEl.value = ft;
    }
    
    // Render type filter pills for resonates (All, Single, Album)
    try {
      let filtersHost = document.getElementById('resontes-type-filters');
      if (filtersHost) {
        const activeTypeFilter = (state.favoritesUi && typeof state.favoritesUi.typeFilter === 'string') ? state.favoritesUi.typeFilter : '';
        const filterDefs = [
          { id: '', label: 'All' },
          { id: 'single', label: 'Single' },
          { id: 'album', label: 'Album' }
        ];
        
        filtersHost.innerHTML = filterDefs.map(d => {
          const isActive = d.id === activeTypeFilter || (!d.id && !activeTypeFilter);
          const pressed = isActive ? 'true' : 'false';
          const cls = `filter-pill${isActive ? ' active' : ''}`;
          return `<button type="button" class="${cls}" data-type-filter="${escapeHtml(d.id)}" aria-pressed="${pressed}">${escapeHtml(d.label)}</button>`;
        }).join('');
        
        if (!filtersHost.dataset.bound) {
          filtersHost.dataset.bound = 'true';
          filtersHost.addEventListener('click', (e) => {
            const btn = e && e.target ? e.target.closest('button[data-type-filter]') : null;
            if (!btn) return;
            try { e.preventDefault(); e.stopPropagation(); } catch {}
            const next = String(btn.getAttribute('data-type-filter') || '').trim();
            if (!state.favoritesUi) state.favoritesUi = {};
            state.favoritesUi.typeFilter = next;
            updateFavoritesList();
          });
        }
      }
    } catch {}
  } catch {}

  favoritesList.innerHTML = '';

  // Actualizar estado del botón de reproducción
  updatePlayButtonState();

  // Actualizar contador visual
  updateFavoritesCount();

  if (state.favorites.length === 0) {

    favoritesList.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">${window.resonateLogoSVG || '◌'}</div>
        <div class="no-results-title">You don't have any resonates yet</div>
        <div class="no-results-hint">Search music and add tracks to your resonates</div>
      </div>
    `;
    return;
  }

  const favoritesByAlbum = {};

  state.favorites.forEach(favorite => {
    const albumId = favorite.albumId || favorite.id;
    if (!favoritesByAlbum[albumId]) {
      favoritesByAlbum[albumId] = {
        albumTitle: favorite.albumTitle || 'Untitled Album',
        albumCreator: favorite.creator,
        tracks: []
      };
    }
    favoritesByAlbum[albumId].tracks.push(favorite);
  });

  try {
    if (window.AlbumTracks && typeof window.AlbumTracks.seedAlbumTracks === 'function') {
      Object.keys(favoritesByAlbum).forEach((albumId) => {
        const group = favoritesByAlbum[albumId];
        if (!group || !Array.isArray(group.tracks)) return;
        window.AlbumTracks.seedAlbumTracks(albumId, group.tracks, {
          source: 'favorites',
          albumTitle: group.albumTitle
        });
      });
    }
  } catch {}

  // Favorites UI: Solo grid (no list mode)
  let items = Object.keys(favoritesByAlbum).map(albumId => ({
    identifier: albumId,
    title: favoritesByAlbum[albumId].albumTitle || 'Untitled',
    creator: favoritesByAlbum[albumId].albumCreator || 'Unknown',
    trackCount: favoritesByAlbum[albumId].tracks.length,
    isAlbum: favoritesByAlbum[albumId].tracks.length > 1,
    tracks: favoritesByAlbum[albumId].tracks
  }));

  // Sort by track count descending (albums with more tracks first, singles last)
  items.sort((a, b) => {
    const aCount = (typeof a.trackCount === 'number' && a.trackCount > 0) ? a.trackCount : 0;
    const bCount = (typeof b.trackCount === 'number' && b.trackCount > 0) ? b.trackCount : 0;
    return bCount - aCount;
  });

  // Update albumTitle for tracks that don't have it or have degraded info
  state.favorites.forEach(favorite => {
    const albumId = favorite.albumId || favorite.id;
    const album = favoritesByAlbum[albumId];
    if (album && favorite.albumTitle && favorite.albumTitle !== favorite.title && album.albumTitle === 'Untitled Album') {
      album.albumTitle = favorite.albumTitle;
    }
  });

  // Favorites toolbar filters
  const filterText = normalizeFilterText(state.favoritesUi && state.favoritesUi.filterText);
  if (filterText) {
    items = items.filter(item => getTextForSearchItem(item).includes(filterText));
  }
  
  // Type filter for resonates (single/album)
  const typeFilter = (state.favoritesUi && typeof state.favoritesUi.typeFilter === 'string') ? state.favoritesUi.typeFilter : '';
  if (typeFilter === 'single') {
    items = items.filter(item => !item.isAlbum);
  } else if (typeFilter === 'album') {
    items = items.filter(item => item.isAlbum);
  }

  const offlineOnly = !!(state.favoritesUi && state.favoritesUi.offlineOnly);
  if (offlineOnly && (!offlineIndex || !offlineIndex.builtAt)) {
    try {
      ensureOfflineIndexFresh({ force: false }).then(() => {
        try {
          if (state.favoritesUi && state.favoritesUi.offlineOnly) updateFavoritesList();
        } catch {}
      });
    } catch {}
  }
  if (offlineOnly) {
    items = items.filter(item => {
      const tracks = Array.isArray(item.tracks) ? item.tracks : [];
      return tracks.some(t => t && t.url && isUrlOfflineAvailableSync(t.url));
    });
  }
  
  // Update the count label with filtered results if filters are active
  try {
    const labelEl = elements.favoritesCountLabel || elements.resontesCountLabel;
    if (labelEl && filterText) {
      labelEl.textContent = `${items.length} resonates for '${filterText}'`;
    } else if (labelEl && typeFilter) {
      // Show type filter with proper label based on value
      let typeLabel = 'resonates';
      if (typeFilter === 'single') {
        typeLabel = 'singles';
      } else if (typeFilter === 'album') {
        typeLabel = 'albums';
      }
      labelEl.textContent = `${items.length} ${typeLabel}`;
    }
  } catch {}

  renderCardGrid(favoritesList, items, 'resonates', true);
}

// Inicializar el listener de event delegation para los botones play en favoritos
// Se llama una sola vez en la inicialización de la app
function initializeFavoritesPlayListener() {
  // Favorites grid uses tap-to-play (cover/title). No play buttons to delegate.
  return;
}

// Handler global para clicks en botones play de favoritos (event delegation)
function handleFavoritesPlayClick(e) {
  // Favorites grid uses tap-to-play (cover/title). No play buttons to delegate.
  return;
}

class FavoritesToggle {
  constructor(element = elements.favoritesToggle, listElement = elements.favoritesList) {
    this.element = element;
    this.listElement = listElement;
    this.isVisible = false;
    this.isDisabled = false;

    this.handleClick = this.handleClick.bind(this);
    this.handleKeydown = this.handleKeydown.bind(this);

    if (this.element) {
      this.element.addEventListener('click', this.handleClick);
      this.element.addEventListener('keydown', this.handleKeydown);
    }

    this.updateAriaAttributes();
  }

  handleClick(event) {
    if (this.isDisabled) return;
    event.preventDefault();

    this.toggle();
    window.logger?.info(`Resontes toggle ${this.isVisible ? 'opened' : 'closed'}`, 'UI');
  }

  /**
   * Maneja eventos de teclado para accesibilidad
   */
  handleKeydown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.handleClick(event);
    }
  }

  /**
   * Alterna la visibilidad de la lista de favoritos
   */
  toggle() {
    this.isVisible = !this.isVisible;
    this.updateVisibility();
    this.updateAriaAttributes();

    // Actualizar lista cuando se muestra
    if (this.isVisible) {
      updateFavoritesList();
      try { if (typeof window.setResontesPanelInsets === 'function') window.setResontesPanelInsets(); } catch {}
    }
  }

  /**
   * Muestra la lista de favoritos
   */
  show() {
    if (this.isVisible) return;
    this.isVisible = true;
    this.updateVisibility();
    this.updateAriaAttributes();
    updateFavoritesList();
    try { if (typeof window.setResontesPanelInsets === 'function') window.setResontesPanelInsets(); } catch {}
  }

  /**
   * Oculta la lista de favoritos
   */
  hide() {
    this.isVisible = false;
    this.updateVisibility();
    this.updateAriaAttributes();
  }

  /**
   * Actualiza la visibilidad de los elementos
   */
  updateVisibility() {
    if (this.isVisible) {
      this.listElement?.classList.add('active');
      this.element?.classList.add('active');
      try { const hb = elements.headerResontesBtn; if (hb) { hb.classList.add('active'); hb.setAttribute('aria-expanded', 'true'); } } catch {}
      try { state.favoritesVisible = true; } catch {}
      try { setBodyUiState('resontes-open', true); } catch {}

      // If search results are open, close them (but don't hide resontes).
      try {
        if (elements.searchResults && elements.searchResults.classList && elements.searchResults.classList.contains('active')) {
          elements.searchResults.classList.remove('active');
          try { if (elements.searchResultsHeader) elements.searchResultsHeader.hidden = true; } catch {}
          try { state.searchActive = false; } catch {}
          try { setSearchOpenState(false); } catch {}
        }
      } catch {}

      // Keep overlay insets in sync with viewport (keyboard, rotations)
      try { if (typeof window.requestViewportUpdate === 'function') window.requestViewportUpdate(); } catch {}
      try { if (typeof window.setResontesPanelInsets === 'function') window.setResontesPanelInsets(); } catch {}

      // Embedded UX:
      // - Mobile/tablet: scroll favorites into view (avoid forcing the keyboard open).
      // - Desktop: focus the filter for fast typing.
      try {
        const isDesktop = !!(window.matchMedia && window.matchMedia('(min-width: 1024px)').matches);

        if (isDesktop && elements.favoritesFilter) {
          try { elements.favoritesFilter.focus({ preventScroll: true }); } catch { try { elements.favoritesFilter.focus(); } catch {} }
        } else {
          const panel = this.listElement;
          if (panel && typeof panel.scrollIntoView === 'function') {
            requestAnimationFrame(() => {
              try { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { try { panel.scrollIntoView(true); } catch {} }
            });
          }
        }
      } catch {}
    } else {
      this.listElement?.classList.remove('active');
      this.element?.classList.remove('active');
      try { const hb = elements.headerResontesBtn; if (hb) { hb.classList.remove('active'); hb.setAttribute('aria-expanded', 'false'); } } catch {}
      try { state.favoritesVisible = false; } catch {}
      try { setBodyUiState('resontes-open', false); } catch {}
    }
  }

  /**
   * Actualiza los atributos ARIA para accesibilidad
   */
  updateAriaAttributes() {
    if (!this.element) return;

    const isExpanded = this.isVisible ? 'true' : 'false';
    this.element.setAttribute('aria-expanded', isExpanded);
    const countText = (state && Array.isArray(state.favorites)) ? state.favorites.length : 0;
    const label = `View resonates (${countText} saved). ${this.isVisible ? 'Resonates list is visible' : 'Click to view your saved resonates'}`;
    this.element.setAttribute('aria-label', label);

    try {
      const hb = elements.headerResontesBtn;
      if (hb) { hb.setAttribute('aria-expanded', isExpanded); hb.setAttribute('aria-label', `View resonates (${countText} saved)`); }
    } catch {}
  }

  /**
   * Deshabilita el toggle
   */
  disable() {
    this.isDisabled = true;
    this.element?.classList.add('disabled');
    this.element?.setAttribute('aria-disabled', 'true');
  }

  /**
   * Habilita el toggle
   */
  enable() {
    this.isDisabled = false;
    this.element?.classList.remove('disabled');
    this.element?.removeAttribute('aria-disabled');
  }

  /**
   * Obtiene el estado actual
   */
  getState() {
    return {
      isVisible: this.isVisible,
      isDisabled: this.isDisabled
    };
  }
}

// Instancia global del componente
let resontesToggleInstance = null;

// Tracks which header buttons have already had listeners attached
const _headerResontesListenerSet = new WeakSet();

// Make the component available across scripts and provide an idempotent initializer.
// Some startup paths (or future refactors) can otherwise leave the toggle unbound.
window.ResontesToggle = FavoritesToggle;
window.ensureResontesToggleInitialized = function ensureResontesToggleInitialized() {
  try {
    const hb = elements.headerResontesBtn || document.getElementById('header-resontes-btn');
    if (hb && !_headerResontesListenerSet.has(hb)) {
      _headerResontesListenerSet.add(hb);
      hb.addEventListener('click', function (event) {
        try { event?.preventDefault?.(); } catch {}
        try { event?.stopPropagation?.(); } catch {}
        if (!resontesToggleInstance) window.ensureResontesToggleInitialized?.();
        if (resontesToggleInstance) resontesToggleInstance.toggle();
      });
      hb.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          try { e.stopPropagation(); } catch {}
          if (!resontesToggleInstance) window.ensureResontesToggleInitialized?.();
          if (resontesToggleInstance) resontesToggleInstance.toggle();
        }
      });
    }

    if (resontesToggleInstance) return resontesToggleInstance;
    if (!elements.resontesList) return null;
    resontesToggleInstance = new FavoritesToggle(elements.resontesToggle || null, elements.resontesList);

    return resontesToggleInstance;
  } catch (e) {
    window.logger?.warn({ message: 'Failed to initialize ResontesToggle', error: e }, 'UI');
    return null;
  }
};

/**
 * Función legacy para compatibilidad hacia atrás
 * @deprecated Usar la instancia de ResontesToggle directamente
 */
function toggleResontesList() {
  if (resontesToggleInstance) {
    resontesToggleInstance.toggle();
  } else {
    window.logger?.warn('Resonates toggle instance not initialized', 'UI');
  }
}

function updateFavoritesCount() {
  const countElement = (elements.resontesCount || document.getElementById('resontes-count') || elements.favoritesCount || document.getElementById('favorites-count'));
  const toggleBtn = (elements.resontesToggle || elements.favoritesToggle);
  const headerBtn = elements.headerResontesBtn || document.getElementById('header-resontes-btn');
  const headerCountEl = elements.headerResontesCount || document.getElementById('header-resontes-count');
  
  if (countElement && toggleBtn) {
    const count = state.favorites ? state.favorites.length : 0;
    countElement.textContent = count > 0 ? count : '0';
    if (headerCountEl) headerCountEl.textContent = count > 0 ? count : '0';
    try { toggleBtn.classList.toggle('has-resontes', count > 0); } catch {}
    try { if (headerBtn) headerBtn.classList.toggle('has-resontes', count > 0); } catch {}
    
    // Improve ARIA label for accessibility
    try { toggleBtn.setAttribute('aria-label', `View resonates (${count} saved)`); } catch {}
    try { if (headerBtn) headerBtn.setAttribute('aria-label', `View resonates (${count} saved)`); } catch {}
    
    // Update aria-expanded based on visibility
    const panel = (elements.resontesList || elements.favoritesList);
    const isExpanded = panel?.classList.contains('active') || false;
    try { toggleBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false'); } catch {}
    try { if (headerBtn) headerBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false'); } catch {}

    // Friendly placeholder copy for the filter input (English)
    try {
      const filterEl = (elements.resontesFilter || elements.favoritesFilter);
      if (filterEl) {
        const msg = count > 0
          ? `Search your ${count} resonates`
          : 'Search your resonates';
        filterEl.placeholder = msg;
        filterEl.title = msg;
      }
    } catch {}
  }
}

function hideResontesList() {
  window.logger?.debug({ message: 'hideResontesList called', hasToggle: !!resontesToggleInstance }, 'UI');
  // Siempre ejecutar el ocultamiento, sin importar el estado previo
  if (resontesToggleInstance) {
    window.logger?.debug('Calling resontesToggleInstance.hide()', 'UI');
    resontesToggleInstance.hide();
  }
  // Siempre ejecutar el fallback para asegurar que se oculta
  window.logger?.debug('Executing fallback - removing active class', 'UI');
  state.resontesVisible = false;
  if (elements.resontesList) {
    elements.resontesList.classList.remove('active');
    window.logger?.debug({ message: 'Resonates list active class removed', hasActive: elements.resontesList.classList.contains('active') }, 'UI');
  } else {
    window.logger?.warn('elements.resontesList not found', 'UI');
  }
  try { setBodyUiState('resontes-embedded-open', false); } catch {}
  try {
    if (elements.resontesHeader) elements.resontesHeader.hidden = true;
  } catch {}
  if (elements.resontesToggle) {
    elements.resontesToggle.classList.remove('active');
    elements.resontesToggle.setAttribute('aria-expanded', 'false');
  }
  try {
    const hb = elements.headerResontesBtn || document.getElementById('header-resontes-btn');
    if (hb) { hb.classList.remove('active'); hb.setAttribute('aria-expanded', 'false'); }
  } catch {}
}

// Backward-compatible alias (favorites -> resontes)
function hideFavoritesList() {
  return hideResontesList();
}

function startApp() {
  state.appStarted = true;
  elements.startView.classList.add('hidden');
  elements.app.classList.add('active');

  // Use the user gesture from the Start button to resume playback if possible.
  // This avoids clearing an already-restored title (resume state) on startup.
  try {
    state.userInteracted = true;
  } catch {}

  try {
    if (typeof togglePlay === 'function') {
      togglePlay();
    } else {
      forcePlay();
    }
  } catch {
    try { forcePlay(); } catch {}
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

  const accentAlt = getComputedStyle(document.documentElement).getPropertyValue('--accent-alt').trim();
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  container.innerHTML = `
    <div>
      <button id="start-favorites-btn" style="background:${accentAlt}; color:${bg}; border:none; padding:8px 12px; font-size:14px; border-radius:12px; cursor:pointer;">Play resonates</button>
      <button id="start-favorites-close" aria-label="Close" style="background:transparent; border:none; color:#666; font-size:16px; cursor:pointer;">✕</button>
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
    window.logger?.error({ message: 'Error starting playback from CTA', error: err }, 'PLAYBACK');
    showStatus(typeof err === 'string' ? err : `Error: ${err && err.message ? err.message : err}`, 'error');
  }
}

// Las listas permanecen visibles durante la reproducción
// El usuario controla manualmente su visibilidad
function addHideFavoritesOnPlay() {
  // Esta función ya no modifica el comportamiento de reproducción
  // Las listas permanecen visibles durante la reproducción
}

// Register service worker and handle updates
async function registerServiceWorker() {
  const shouldDisableSw = (() => {
    try {
      const loc = window.location;
      const qs = new URLSearchParams(loc && loc.search ? loc.search : '');
      if (qs.get('nosw') === '1') return true;

      const host = String((loc && loc.hostname) ? loc.hostname : '').toLowerCase();
      const proto = String((loc && loc.protocol) ? loc.protocol : '').toLowerCase();

      // Disable SW only for file:// to avoid caching surprises with local files.
      if (proto === 'file:') return true;
    } catch {
      // ignore
    }
    return false;
  })();

  if (shouldDisableSw) {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) {
          try { await reg.unregister(); } catch {}
        }
      }
    } catch {}
    try {
      if (typeof caches !== 'undefined' && caches && typeof caches.keys === 'function') {
        const keys = await caches.keys();
        for (const k of keys) {
          try { await caches.delete(k); } catch {}
        }
      }
    } catch {}
    try { window.logger?.info('Service Worker disabled (dev/nosw)', 'SYSTEM'); } catch {}
    return;
  }

  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      window.logger?.info(`Service Worker registered with scope: ${registration.scope}`, 'SYSTEM');

      // Update coordination across tabs (Mode B prompt)
      ensureServiceWorkerUpdateCoordinationHandlers();

      // PWA-friendly update checks (focus/pageshow/visibility/periodic)
      ensureServiceWorkerUpdateCheckHandlers();

      // If an update is already waiting, announce it.
      try {
        await maybeAnnounceUpdateReady(registration);
      } catch {}

      // Also proactively check for updates on startup (throttled).
      try {
        await checkForServiceWorkerUpdates('startup');
      } catch {}

      // Watch for future updates.
      try {
        registration.addEventListener('updatefound', () => {
          try {
            const newWorker = registration.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              // When installed with an existing controller, it's waiting.
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                maybeAnnounceUpdateReady(registration);
              }
            });
          } catch {
            // ignore
          }
        });
      } catch {}
    } catch (error) {
      window.logger?.error({ message: 'Service Worker registration failed', error }, 'SYSTEM');
      if (error.message.includes('Failed to fetch')) {
        window.logger?.warn('Ensure the Service Worker file is accessible and the server is running.', 'SYSTEM');
      }
    }
  } else {
    window.logger?.warn('Service Workers are not supported in this browser.', 'SYSTEM');
  }
}

// PWA installation prompt setup
function setupPWAInstall() {
  if (isRunningAsPWA()) return; // Don't show if already installed

  // If this navigation is a shared link, we use a dedicated banner UX.
  // Capture the install prompt (if any) but never show the generic install banner.
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('play')) {
      try { sessionStorage.setItem('resonate_shared_link_banner_active', 'true'); } catch {}
    }
  } catch {}

  // Check if user previously dismissed the *generic* banner.
  // Important: even if dismissed, we must still capture the install prompt and
  // keep window.installPWA working for shared-link and other entry banners.
  const dismissed = localStorage.getItem('resonate_pwa_banner_dismissed') === 'true';

  // Ensure we capture the install prompt even if it fires early.
  // Expose for other UI surfaces (e.g., shared-link banner)
  try {
    if (typeof window.__resonateDeferredInstallPrompt === 'undefined') {
      window.__resonateDeferredInstallPrompt = null;
    }
  } catch {}

  // Best-effort: remember that the user has (or had) the PWA installed.
  // There is no reliable cross-browser "is installed" API, so we use heuristics.
  try {
    window.addEventListener('appinstalled', () => {
      try {
        localStorage.setItem('resonate_has_run_standalone', 'true');
        localStorage.setItem('resonate_standalone_last_seen', String(Date.now()));
      } catch {}
    });
  } catch {}

  // Define installPWA early and keep it stable. It always uses the captured prompt.
  if (typeof window.installPWA !== 'function') {
    window.installPWA = async () => {
      const prompt = (() => {
        try { return window.__resonateDeferredInstallPrompt || null; } catch { return null; }
      })();
      if (!prompt) {
        const isIOS = (() => {
          try {
            const ua = String(navigator.userAgent || '').toLowerCase();
            const iOS = /iphone|ipad|ipod/.test(ua);
            const isMS = typeof window.MSStream !== 'undefined';
            return iOS && !isMS;
          } catch {
            return false;
          }
        })();

        showStatus(
          isIOS
            ? "To install: tap Share → Add to Home Screen"
            : "To install: open your browser menu → Add to Home Screen",
          'info',
          6500
        );
        return;
      }

      try {
        prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === 'accepted') {
          showStatus('Resonate is installing', 'info', 3000);
        }
      } catch {
        try { showStatus('Install could not start on this device', 'warning', 5000); } catch {}
      }

      try { hidePWAInstallBanner(); } catch {}
      try { window.__resonateDeferredInstallPrompt = null; } catch {}
    };
  }

  // One-time prompt capture (safe to call multiple times)
  ensureInstallPromptCapture();

  // If the prompt was already captured before setup runs, show the banner now.
  try {
    if (window.__resonateDeferredInstallPrompt && !document.getElementById('open-in-app-banner')) {
      const sharedLinkActive = (() => {
        try { return sessionStorage.getItem('resonate_shared_link_banner_active') === 'true'; } catch { return false; }
      })();
      if (!sharedLinkActive && !dismissed) {
        showPWAInstallBanner();
      }
    }
  } catch {}
}

// Capture `beforeinstallprompt` as early/reliably as possible.
// This event can fire before we finish initializing UI, so we hook it once and stash it globally.
function ensureInstallPromptCapture() {
  try {
    if (window.__resonateInstallPromptHooked === true) return;
    window.__resonateInstallPromptHooked = true;
  } catch {
    // If we can't set a sentinel, continue best-effort.
  }

  try {
    window.addEventListener('beforeinstallprompt', (e) => {
      try {
        e.preventDefault();
      } catch {}

      try { window.__resonateDeferredInstallPrompt = e; } catch {}

      // Mark that the install prompt exists in this session (helps entry-banner heuristics)
      try { sessionStorage.setItem('resonate_install_prompt_seen', 'true'); } catch {}

      // If an "Open app" banner is visible, switch it to "Install".
      try {
        if (typeof window.__resonateEntryBannerSetMode === 'function') {
          window.__resonateEntryBannerSetMode('install');
        }
      } catch {}

      // Shared-link pages use a dedicated banner; don't stack two prompts.
      try {
        const sharedLinkActive = (() => {
          try { return sessionStorage.getItem('resonate_shared_link_banner_active') === 'true'; } catch { return false; }
        })();
        if (sharedLinkActive || document.getElementById('open-in-app-banner')) {
          return;
        }
      } catch {}

      // Only show the generic banner if the user hasn't dismissed it.
      try {
        const dismissed = localStorage.getItem('resonate_pwa_banner_dismissed') === 'true';
        if (dismissed) return;
      } catch {}

      try { showPWAInstallBanner(); } catch {}
    });
  } catch {
    // ignore
  }
}

function maybeShowOpenInAppBannerForSharedLink() {
  try {
    if (isRunningAsPWA()) return;
    if (document.getElementById('open-in-app-banner')) return;
    // Avoid stacking multiple top banners.
    // If the generic install banner is already showing (race), replace it with the shared-link banner.
    const installBanner = document.getElementById('pwa-install-banner');
    if (installBanner) {
      try { hidePWAInstallBanner(); } catch {}
      try { installBanner.remove(); } catch {}
    }
    if (document.getElementById('sw-update-banner')) return;

    const url = new URL(window.location.href);
    const playIdentifier = url.searchParams.get('play');
    const entrySource = url.searchParams.get('src');
    const isApexEntry = entrySource === 'apex';
    if (!playIdentifier && !isApexEntry) return;

    const tParam = url.searchParams.get('t');
    const parsedTrackIndex = tParam !== null ? parseInt(tParam, 10) : null;
    const trackIndex = Number.isFinite(parsedTrackIndex) && parsedTrackIndex >= 0 ? parsedTrackIndex : null;

    const shareUrl = (playIdentifier && typeof window.buildShareUrl === 'function')
      ? window.buildShareUrl(playIdentifier, trackIndex)
      : window.location.href;

    // Best-effort: if we're not already at the canonical shared URL, navigate there.
    // Only applies for actual shared-link playback entries (play=...).
    if (playIdentifier) {
      try {
        const currentNoHash = String(window.location.href || '').split('#')[0];
        const shareNoHash = String(shareUrl || '').split('#')[0];
        if (shareNoHash && currentNoHash && shareNoHash !== currentNoHash) {
          window.location.replace(shareUrl);
          return;
        }
      } catch {}
    }

    // Dismiss policy: per-session to avoid annoyance during navigation.
    const dismissKey = 'resonate_shared_link_banner_dismissed';
    try {
      if (sessionStorage.getItem(dismissKey) === 'true') return;
    } catch {}

    // Mark banner active to suppress the generic install banner.
    // Used both for shared links and for tagged apex entries.
    try { sessionStorage.setItem('resonate_shared_link_banner_active', 'true'); } catch {}

    const installedLikely = (() => {
      try {
        const hasFlag = localStorage.getItem('resonate_has_run_standalone') === 'true';
        if (!hasFlag) return false;

        const rawTs = localStorage.getItem('resonate_standalone_last_seen');
        const ts = rawTs ? parseInt(rawTs, 10) : NaN;
        if (!Number.isFinite(ts) || ts <= 0) return false;

        // If this is too old, treat it as unknown to avoid false "Open app" after uninstall.
        const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
        return (Date.now() - ts) <= MAX_AGE_MS;
      } catch {
        return false;
      }
    })();

    // If an install prompt is available in this session, assume "not installed".
    const installPromptAvailable = (() => {
      try {
        if (Boolean(window.__resonateDeferredInstallPrompt)) return true;
      } catch {}
      try {
        return sessionStorage.getItem('resonate_install_prompt_seen') === 'true';
      } catch {
        return false;
      }
    })();

    const isIOS = (() => {
      try {
        const ua = String(navigator.userAgent || '').toLowerCase();
        const iOS = /iphone|ipad|ipod/.test(ua);
        const isMS = typeof window.MSStream !== 'undefined';
        return iOS && !isMS;
      } catch {
        return false;
      }
    })();

    // Decide which single banner variant to show.
    // Default to "Install" unless we are fairly sure the app exists.
    let mode = (installedLikely && !installPromptAvailable) ? 'open' : 'install';

    const subtitleText = 'Faster playback, offline support, and fewer interruptions.';

    const getTitleText = (m) => (m === 'open' ? 'Open in the Resonate app' : 'Install Resonate to keep listening');
    const getPrimaryText = (m) => {
      if (m === 'open') return 'Open app';
      return (isIOS && !installPromptAvailable) ? 'Add to Home Screen' : 'Install';
    };
    const secondaryText = 'Continue in browser';

    const banner = document.createElement('div');
    banner.id = 'open-in-app-banner';
    banner.className = 'pwa-install-banner open-in-app-banner';
    banner.dataset.entryBannerMode = mode;
    banner.innerHTML = `
      <div class="pwa-banner-content">
        <div class="open-in-app-text" role="status" aria-live="polite">
          <div class="open-in-app-title">${getTitleText(mode)}</div>
          <div class="open-in-app-subtitle">${subtitleText}</div>
        </div>
        <div class="open-in-app-actions">
          <button class="pwa-install-btn open-in-app-btn" type="button">${getPrimaryText(mode)}</button>
          <button class="pwa-install-btn pwa-install-btn-secondary" type="button">${secondaryText}</button>
          <button class="pwa-close-btn" aria-label="Close" type="button">✕</button>
        </div>
      </div>
    `;

    const primaryBtn = banner.querySelector('.open-in-app-btn');
    const titleEl = banner.querySelector('.open-in-app-title');
    const secondaryBtn = banner.querySelector('.pwa-install-btn-secondary');
    const closeBtn = banner.querySelector('.pwa-close-btn');

    const setBannerMode = (nextMode) => {
      try {
        const nm = nextMode === 'open' ? 'open' : 'install';
        if (mode === nm) return;
        mode = nm;
        try { banner.dataset.entryBannerMode = mode; } catch {}
        if (titleEl) titleEl.textContent = getTitleText(mode);
        if (primaryBtn) primaryBtn.textContent = getPrimaryText(mode);
      } catch {
        // ignore
      }
    };

    // Expose a hook so the install-prompt listener can flip the banner to "Install"
    // if beforeinstallprompt fires after the banner is rendered.
    try { window.__resonateEntryBannerSetMode = setBannerMode; } catch {}

    if (primaryBtn) {
      primaryBtn.addEventListener('click', () => {
        if (mode === 'open') {
          // Best-effort: navigating to the canonical app URL is what enables OS link capturing.
          try { showStatus('Opening Resonate…', 'info', 2000); } catch {}
          try { window.location.replace(shareUrl); } catch {}
          return;
        }

        // Install mode
        if (typeof window.installPWA === 'function') {
          window.installPWA();
          return;
        }
        showStatus(
          isIOS
            ? 'To install: tap Share → Add to Home Screen'
            : 'To install: open your browser menu → Add to Home Screen',
          'info',
          6500
        );
      });
    }

    if (secondaryBtn) {
      secondaryBtn.addEventListener('click', () => {
        // Continue in browser just dismisses the banner for this session.
        try { sessionStorage.setItem(dismissKey, 'true'); } catch {}
        try { window.__resonateEntryBannerSetMode = null; } catch {}
        try { banner.classList.remove('active'); } catch {}
        setTimeout(() => {
          try { banner.remove(); } catch {}
        }, 300);
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        try { sessionStorage.setItem(dismissKey, 'true'); } catch {}
        try { window.__resonateEntryBannerSetMode = null; } catch {}
        try { banner.classList.remove('active'); } catch {}
        setTimeout(() => {
          try { banner.remove(); } catch {}
        }, 300);
      });
    }

    document.body.appendChild(banner);
    setTimeout(() => {
      try { banner.classList.add('active'); } catch {}
    }, 100);

    // If the prompt arrives a bit later, switch to install automatically.
    // (Common on Android where beforeinstallprompt fires after initial load.)
    setTimeout(() => {
      try {
        if (mode !== 'open') return;
        if (Boolean(window.__resonateDeferredInstallPrompt)) {
          setBannerMode('install');
        }
      } catch {}
    }, 1200);
  } catch {
    // ignore
  }
}

window.maybeShowOpenInAppBannerForSharedLink = maybeShowOpenInAppBannerForSharedLink;

// Show PWA install banner
function showPWAInstallBanner() {
  // Check if banner already exists
  if (document.getElementById('pwa-install-banner')) return;
  // Avoid stacking with shared-link banner.
  if (document.getElementById('open-in-app-banner')) return;

  const isIOS = (() => {
    try {
      const ua = String(navigator.userAgent || '').toLowerCase();
      const iOS = /iphone|ipad|ipod/.test(ua);
      const isMS = typeof window.MSStream !== 'undefined';
      return iOS && !isMS;
    } catch {
      return false;
    }
  })();

  const installPromptAvailable = (() => {
    try { return Boolean(window.__resonateDeferredInstallPrompt); } catch { return false; }
  })();

  const primaryLabel = (isIOS && !installPromptAvailable) ? 'Add to Home Screen' : 'Install';

  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  // Reuse the shared-link banner layout for a consistent, friendlier UX.
  banner.className = 'pwa-install-banner open-in-app-banner';
  banner.innerHTML = `
    <div class="pwa-banner-content">
      <div class="open-in-app-text" role="status" aria-live="polite">
        <div class="open-in-app-title">Install Resonate to keep listening</div>
        <div class="open-in-app-subtitle">Faster playback, offline support, and fewer interruptions.</div>
      </div>
      <div class="open-in-app-actions">
        <button class="pwa-install-btn open-in-app-btn" type="button">${primaryLabel}</button>
        <button class="pwa-install-btn pwa-install-btn-secondary" type="button">Not now</button>
        <button class="pwa-close-btn" aria-label="Close" type="button">✕</button>
      </div>
    </div>
  `;

  // Add event listeners
  const installBtn = banner.querySelector('.pwa-install-btn');
  const notNowBtn = banner.querySelector('.pwa-install-btn-secondary');
  const closeBtn = banner.querySelector('.pwa-close-btn');

  installBtn.addEventListener('click', () => {
    if (typeof window.installPWA === 'function') {
      window.installPWA();
    }
  });

  closeBtn.addEventListener('click', () => {
    hidePWAInstallBanner();
    // Save preference to not show again
    try {
      localStorage.setItem('resonate_pwa_banner_dismissed', 'true');
    } catch (e) {
      window.logger?.warn({ message: 'Could not save PWA banner preference', error: e }, 'UI');
    }
  });

  if (notNowBtn) {
    notNowBtn.addEventListener('click', () => {
      hidePWAInstallBanner();
      try {
        localStorage.setItem('resonate_pwa_banner_dismissed', 'true');
      } catch (e) {
        window.logger?.warn({ message: 'Could not save PWA banner preference', error: e }, 'UI');
      }
    });
  }

  // Add to body
  document.body.appendChild(banner);

  // Show with animation
  setTimeout(() => {
    banner.classList.add('active');
  }, 100);
}

// Hide PWA install banner
function hidePWAInstallBanner() {
  const banner = document.getElementById('pwa-install-banner');
  if (banner) {
    banner.classList.remove('active');
    setTimeout(() => {
      if (banner.parentNode) {
        banner.parentNode.removeChild(banner);
      }
    }, 300); // Match transition duration
  }
}

// Push notifications setup
function setupPushNotifications() {
  if ('Notification' in window && 'serviceWorker' in navigator) {
    Notification.requestPermission().then((permission) => {
      // Permission granted - silent
    });
  }
}

// PWA detection
function isRunningAsPWA() {
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
         window.navigator.standalone === true;
  if (standalone) {
    try {
      localStorage.setItem('resonate_has_run_standalone', 'true');
      localStorage.setItem('resonate_standalone_last_seen', String(Date.now()));
    } catch {}
  }
  return standalone;
}

// Search history management is now in js/search-history.js.
// The functions loadSearchHistory, saveSearchHistory, addToSearchHistory,
// formatSearchHistoryTime, clearSearchHistory, and removeFromSearchHistory
// are exposed on window by that module.

function displaySearchHistory() {
  // Mark that we are showing history so ensureSearchFiltersHeader hides the type filter buttons.
  try {
    ensureSearchFilterDefaults();
    state.searchUi.showingHistory = true;
  } catch {}

  const history = loadSearchHistory();

  if (history.length === 0) {
    elements.searchResultsList.innerHTML = `
      <div class="no-results search-history-empty">
        <div class="no-results-icon">🕐</div>
        <div class="no-results-title">No recent searches</div>
        <div class="no-results-hint">Your search history will appear here</div>
      </div>`;
    elements.searchResults.classList.add('active');
    try {
      initializePanelToolbarsOnce();
      if (elements.searchResultsHeader) elements.searchResultsHeader.hidden = false;
      if (elements.searchResultsCount) elements.searchResultsCount.textContent = 'Recent searches';
      try { ensureSearchFiltersHeader(); } catch {}
    } catch {}
    state.searchActive = true;
    setSearchOpenState(true);
    scheduleSearchInsetsBurst();
    return;
  }

  const fragment = document.createDocumentFragment();

  history.forEach((item, index) => {
    const query = item.query;
    const timeLabel = formatSearchHistoryTime(item.timestamp);

    const historyItem = document.createElement('div');
    historyItem.className = 'search-history-item';
    historyItem.setAttribute('role', 'option');
    historyItem.setAttribute('tabindex', '0');
    historyItem.setAttribute('aria-label', query);

    historyItem.innerHTML = `
      <span class="history-icon" aria-hidden="true">🕐</span>
      <span class="history-query">${escapeHtml(query)}</span>
      ${timeLabel ? `<span class="history-time" aria-hidden="true">${escapeHtml(timeLabel)}</span>` : ''}
      <button class="history-remove btn-tertiary" data-index="${index}" title="Remove" aria-label="Remove ${escapeHtml(query)}">✕</button>
    `;

    const triggerSearch = () => {
      elements.searchInput.value = query;
      try {
        if (window.SEARCH_UI_CONFIG && window.SEARCH_UI_CONFIG.closeKeyboardOnSubmit) {
          elements.searchInput.blur();
          setKeyboardOpenState(false);
        }
      } catch {}
      dispatchSearchWithFastPath(query, { keepKeyboard: true, addToHistory: false, showLoader: true });
    };

    const removeItem = (e) => {
      e.stopPropagation();
      removeFromSearchHistory(index);
      displaySearchHistory();
    };

    // Click: search on item click, remove on button click
    historyItem.addEventListener('click', (e) => {
      if (e.target.closest('.history-remove')) return;
      triggerSearch();
    });

    // Keyboard: Enter to search, Delete/Backspace to remove
    historyItem.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        triggerSearch();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeItem(e);
      }
    });

    // Remove button click
    const removeBtn = historyItem.querySelector('.history-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', removeItem);
    }

    fragment.appendChild(historyItem);
  });

  // Clear all button
  const clearAllDiv = document.createElement('div');
  clearAllDiv.className = 'search-history-clear';
  clearAllDiv.innerHTML = '<button class="clear-history-btn">Clear history</button>';
  clearAllDiv.querySelector('.clear-history-btn').addEventListener('click', () => {
    clearSearchHistory();
    showStatus('Your search history cleared', 'info', 2000);
    displaySearchHistory();
  });
  fragment.appendChild(clearAllDiv);

  elements.searchResultsList.innerHTML = '';
  elements.searchResultsList.appendChild(fragment);
  elements.searchResults.classList.add('active');
  try {
    initializePanelToolbarsOnce();
    if (elements.searchResultsHeader) elements.searchResultsHeader.hidden = false;
    if (elements.searchResultsCount) elements.searchResultsCount.textContent = `Recent searches (${history.length})`;
    try { ensureSearchFiltersHeader(); } catch {}
  } catch {}
  state.searchActive = true;
  setSearchOpenState(true);
  scheduleSearchInsetsBurst();
}

function normalizeTrackTitle(title) {
  const t = typeof title === 'string' ? title.trim() : '';
  return t ? t : 'Track';
}

function normalizeTrackCreator(creator) {
  const c = typeof creator === 'string' ? creator.trim() : '';
  return c ? c : '';
}

function getCanonicalShareOrigin() {
  try {
    const origin = String(window.location.origin || '').trim();
    const hostname = String(window.location.hostname || '').trim().toLowerCase();
    // Production canonicalization: ensure shared links match the PWA install origin.
    // Keep localhost/dev origins untouched.
    if (hostname === 'resonateplayer.com' || hostname === 'www.resonateplayer.com') {
      return 'https://www.resonateplayer.com';
    }
    return origin;
  } catch {
    return window.location.origin;
  }
}

function buildShareUrl(identifier, trackIndex = null) {
  const baseUrl = new URL(getCanonicalShareOrigin());
  baseUrl.hash = '';
  baseUrl.search = '';
  // Always share within the PWA scope entrypoint.
  baseUrl.pathname = '/';

  const params = new URLSearchParams();
  params.set('play', identifier);

  const idx = typeof trackIndex === 'number' && isFinite(trackIndex) && trackIndex >= 0 ? Math.floor(trackIndex) : null;
  if (idx !== null) {
    params.set('t', String(idx));
  }

  baseUrl.search = params.toString();
  return baseUrl.toString();
}

// Expose for other scripts (initialization.js) to reuse a single canonical share-link builder.
window.buildShareUrl = buildShareUrl;

function applyTrackMetaTagsForIdentifier(identifier, title, creator = '', trackIndex = null) {
  if (!identifier) return;

  const normalizedTitle = normalizeTrackTitle(title);
  const normalizedCreator = normalizeTrackCreator(creator);
  const shareUrl = buildShareUrl(identifier, trackIndex);
  const imageUrl = `https://archive.org/services/img/${identifier}`;

  const displayTitle = normalizedCreator ? `${normalizedTitle} - ${normalizedCreator}` : normalizedTitle;
  const description = normalizedCreator
    ? `Listen to "${normalizedTitle}" by ${normalizedCreator} on Resonate Player. Free music from archive.org.`
    : `Listen to "${normalizedTitle}" on Resonate Player. Free music from archive.org.`;

  document.title = `${displayTitle} | Resonate Player`;

  // Open Graph
  updateMetaTag('property', 'og:title', displayTitle);
  updateMetaTag('property', 'og:description', description);
  updateMetaTag('property', 'og:image', imageUrl);
  updateMetaTag('property', 'og:url', shareUrl);
  updateMetaTag('property', 'og:type', 'music.song');

  // Twitter
  updateMetaTag('property', 'twitter:card', 'summary_large_image');
  updateMetaTag('property', 'twitter:title', displayTitle);
  updateMetaTag('property', 'twitter:description', description);
  updateMetaTag('property', 'twitter:image', imageUrl);
  updateMetaTag('property', 'twitter:url', shareUrl);

  // Basic meta
  updateMetaTag('name', 'description', description);

  window.logger?.debug({ message: 'Meta tags updated for sharing', title: normalizedTitle, creator: normalizedCreator, imageUrl, shareUrl }, 'NETWORK');
}

// Update Open Graph meta tags for rich previews
function updateMetaTags(track, identifier) {
  if (!track || !identifier) return;
  const trackIndex = typeof track.trackIndex === 'number' && isFinite(track.trackIndex) ? track.trackIndex : null;
  applyTrackMetaTagsForIdentifier(identifier, track.title, track.creator, trackIndex);
}

// Helper function to update or create meta tags
function updateMetaTag(attrName, attrValue, content) {
  let metaTag = document.querySelector(`meta[${attrName}="${attrValue}"]`);

  if (metaTag) {
    metaTag.setAttribute('content', content);
  } else {
    metaTag = document.createElement('meta');
    metaTag.setAttribute(attrName, attrValue);
    metaTag.setAttribute('content', content);
    document.head.appendChild(metaTag);
  }
}

// Share functionality
async function shareTrack(identifier, title = 'Track', creator = null, albumTitle = null, kind = 'track', trackIndex = null) {
  if (!identifier) {
    showStatus('Nothing to share right now', 'warning');
    return;
  }

  const shareKind = kind === 'album' ? 'album' : 'track';

  const normalizedTrackTitle = normalizeTrackTitle(title);

  let resolvedCreator = creator;
  if (resolvedCreator === null || resolvedCreator === undefined) {
    try {
      if (window.state && window.state.currentTrack && window.state.currentTrack.id === identifier) {
        resolvedCreator = window.state.currentTrack.creator;
      }
    } catch {}
  }
  resolvedCreator = normalizeTrackCreator(resolvedCreator);

  let resolvedAlbumTitle = albumTitle;
  if (resolvedAlbumTitle === null || resolvedAlbumTitle === undefined) {
    try {
      if (window.state && window.state.currentTrack && window.state.currentTrack.id === identifier) {
        resolvedAlbumTitle = window.state.currentTrack.albumTitle || window.state.currentTrack.album || '';
      }
    } catch {}
  }
  const normalizedAlbumTitle = typeof resolvedAlbumTitle === 'string' ? resolvedAlbumTitle.trim() : '';
  const includeAlbumTitle = !!(
    normalizedAlbumTitle &&
    normalizedAlbumTitle.toLowerCase() !== normalizedTrackTitle.toLowerCase()
  );

  let resolvedTrackIndex = trackIndex;
  if (resolvedTrackIndex === null || resolvedTrackIndex === undefined) {
    try {
      if (shareKind === 'track' && includeAlbumTitle && window.state && window.state.currentTrack && window.state.currentTrack.id === identifier) {
        resolvedTrackIndex = window.state.currentTrack.trackIndex;
      }
    } catch {}
  }
  if (!(typeof resolvedTrackIndex === 'number' && isFinite(resolvedTrackIndex) && resolvedTrackIndex >= 0)) {
    resolvedTrackIndex = null;
  }

  const shareUrlTrackIndex = (shareKind === 'track' && includeAlbumTitle) ? resolvedTrackIndex : null;

  const shareUrl = buildShareUrl(identifier, shareUrlTrackIndex);
  const shareDataTitle = shareKind === 'album'
    ? normalizedTrackTitle
    : (includeAlbumTitle ? `${normalizedAlbumTitle} — ${normalizedTrackTitle}` : normalizedTrackTitle);

  const textParts = [];
  if (shareKind === 'album') {
    textParts.push('You might like this album!');
    textParts.push(`"${normalizedTrackTitle}"`);
  } else {
    textParts.push('You might like this!');
    textParts.push(`"${normalizedTrackTitle}"`);
    if (includeAlbumTitle) textParts.push(normalizedAlbumTitle);
  }

  if (resolvedCreator) textParts.push(resolvedCreator);
  textParts.push('Enjoy it freely on Resonate Player');
  const shareText = textParts.join('\n\n');

  window.logger?.debug({
    message: 'Attempting to share',
    shareUrl,
    title: shareDataTitle,
    shareText,
    creator: resolvedCreator,
    albumTitle: normalizedAlbumTitle,
    kind: shareKind,
    trackIndex: shareUrlTrackIndex
  }, 'NETWORK');

  // Keep meta tags in sync for rich previews
  applyTrackMetaTagsForIdentifier(identifier, shareDataTitle, resolvedCreator, shareUrlTrackIndex);

  const { canShare, canCopy } = getShareCapabilities();
  if (!canShare) {
    if (canCopy) {
      const copied = await tryCopyToClipboard(shareUrl);
      if (copied) {
        // Analytics: track clipboard copy as share
        try {
          if (window.ResonateAnalytics && typeof window.ResonateAnalytics.trackShare === 'function') {
            window.ResonateAnalytics.trackShare({ method: 'copy_link', content_type: shareKind, item_id: identifier });
          }
        } catch (_) {}
        showStatus('Link copied to clipboard', 'info', 4000);
        return;
      }
    }
    window.logger?.info('Web Share API no disponible', 'SYSTEM');
    showStatus('Sharing not available', 'warning', 4000);
    return;
  }

  // Try to get cover image for sharing
  let coverFile = null;
  try {
    // Use CoverManager if available, otherwise fallback to local implementation
    if (window.CoverManager && typeof window.CoverManager.getCoverImageForSharing === 'function') {
      coverFile = await window.CoverManager.getCoverImageForSharing(identifier);
    } else {
      coverFile = await getCoverImageForSharing(identifier);
    }
    window.logger?.debug('Cover image obtained for sharing', 'NETWORK');
  } catch (error) {
    window.logger?.warn({ message: 'Could not get cover image', error }, 'NETWORK');
  }

  const isShareCancelled = (err) => {
    return !!(err && (err.name === 'AbortError' || err.name === 'NotAllowedError'));
  };

  const isLikelyFileShareUnsupported = (err) => {
    if (!err) return false;
    const name = typeof err.name === 'string' ? err.name : '';
    if (name === 'TypeError' || name === 'NotSupportedError' || name === 'DataError') return true;

    const message = typeof err.message === 'string' ? err.message : '';
    return /\b(files?|file)\b/i.test(message) || /canShare/i.test(message);
  };

  try {
    window.logger?.debug('Using Web Share API with enriched message', 'NETWORK');

    // Analytics: track share event
    try {
      if (window.ResonateAnalytics && typeof window.ResonateAnalytics.trackShare === 'function') {
        window.ResonateAnalytics.trackShare({
          method: 'web_share',
          content_type: shareKind,
          item_id: identifier
        });
      }
    } catch (_) {}

    const baseShareData = {
      title: shareDataTitle,
      text: shareText,
      url: shareUrl
    };

    // Aggressive behavior: if we have a cover file, try sharing it even when
    // navigator.canShare({ files }) is missing or returns false.
    if (coverFile) {
      try {
        window.logger?.debug('Attempting to include cover image in share', 'NETWORK');
        await navigator.share({ ...baseShareData, files: [coverFile] });
        window.logger?.info('Web Share API success (with cover file)', 'NETWORK');
        showStatus('Track shared successfully', 'info', 6000);
        return;
      } catch (errorWithFile) {
        if (isShareCancelled(errorWithFile)) {
          return;
        }

        // If file sharing isn't supported, retry once without the cover.
        if (isLikelyFileShareUnsupported(errorWithFile)) {
          try {
            window.logger?.debug('File share unsupported, retrying without cover', 'NETWORK');
            await navigator.share(baseShareData);
            window.logger?.info('Web Share API success (without cover)', 'NETWORK');
            showStatus('Track shared successfully', 'info', 6000);
            return;
          } catch (errorWithoutFile) {
            if (isShareCancelled(errorWithoutFile)) {
              return;
            }
            window.logger?.warn({ message: 'Web Share API failed', error: errorWithoutFile }, 'NETWORK');
            showStatus('Sharing not available', 'warning', 4000);
            return;
          }
        }

        window.logger?.warn({ message: 'Web Share API failed', error: errorWithFile }, 'NETWORK');
        showStatus('Sharing not available', 'warning', 4000);
        return;
      }
    }

    await navigator.share(baseShareData);
    window.logger?.info('Web Share API success', 'NETWORK');
    showStatus('Track shared successfully', 'info', 6000);
  } catch (error) {
    // If user cancels, don't spam.
    if (isShareCancelled(error)) {
      return;
    }
    window.logger?.warn({ message: 'Web Share API failed', error }, 'NETWORK');
    showStatus('Sharing not available', 'warning', 4000);
  }
}

// Get cover image as File for sharing
async function getCoverImageForSharing(identifier) {
  const coverUrl = `https://archive.org/services/img/${identifier}`;

  try {
    const response = await fetch(coverUrl);
    if (!response.ok) {
      window.logger?.warn({ message: 'Cover image request failed', status: response.status, identifier }, 'NETWORK');
      return null;
    }

    const blob = await response.blob();

    if (!blob || !blob.size) {
      return null;
    }

    if (typeof File === 'undefined') {
      return null;
    }

    // Create File from Blob
    const filename = `cover-${identifier}.jpg`;
    const blobType = blob && typeof blob.type === 'string' ? blob.type : '';
    const fileType = blobType && blobType.startsWith('image/') ? blobType : 'image/jpeg';
    return new File([blob], filename, { type: fileType });
  } catch (error) {
    // Best-effort only: sharing should still work without the cover.
    window.logger?.warn({ message: 'Cover image fetch failed (continuing without image)', error }, 'NETWORK');
    return null;
  }
}

async function tryCopyToClipboard(text) {
  if (!text) return false;

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy copy
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.pointerEvents = 'none';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return !!ok;
  } catch {
    return false;
  }
}

// Back-compat wrapper: older callers used this for share previews
function updateMetaTagsForSharing(identifier, title, creator = '') {
  applyTrackMetaTagsForIdentifier(identifier, title, creator);
}

// Initialize UI toggles
initializePreloadResontesToggle();
window.initializePreloadResontesToggle = initializePreloadResontesToggle;

// Bind favorites toggle immediately (idempotent). This prevents cases where the
// app starts partially (or init order changes) and the favorites button has no handler.
try {
  // Prefer resontes toggle initializer.
  if (typeof window.ensureResontesToggleInitialized === 'function') {
    window.ensureResontesToggleInitialized();
  }

  // Back-compat: some startup paths still call ensureFavoritesToggleInitialized().
  if (typeof window.ensureFavoritesToggleInitialized !== 'function' && typeof window.ensureResontesToggleInitialized === 'function') {
    window.ensureFavoritesToggleInitialized = window.ensureResontesToggleInitialized;
  }
  if (typeof window.ensureFavoritesToggleInitialized === 'function') {
    window.ensureFavoritesToggleInitialized();
  }
} catch {}

// Premium desktop UX: toolbars + shortcuts
try { initializePanelToolbarsOnce(); } catch {}
try { initializeDesktopShortcutsOnce(); } catch {}

// Expose critical functions globally for cross-module access
window.loadResontes = loadResontes;
window.saveResontes = saveResontes;
window.isTrackResonte = isTrackResonte;
window.toggleResonteTrack = toggleResonteTrack;
// Legacy alias used by some UI surfaces (e.g., Tracklist V2)
window.toggleResonte = toggleResonteTrack;
window.addAlbumToResontes = addAlbumToResontes;
window.removeAlbumFromResontes = removeAlbumFromResontes;
window.updateResontesList = updateResontesList;
window.updateResontesCount = updateResontesCount;

// Legacy exports (favorites)
window.loadFavorites = loadFavorites;
window.saveFavorites = saveFavorites;
window.isTrackFavorite = isTrackFavorite;
window.toggleFavorite = toggleFavorite;
window.addAlbumToFavorites = addAlbumToFavorites;
window.removeAlbumFromFavorites = removeAlbumFromFavorites;
window.updateFavoritesList = updateFavoritesList;
window.updateFavoritesCount = updateFavoritesCount;
window.updateContentCardPlayingState = updateContentCardPlayingState;
window.loadVolume = loadVolume;
window.saveVolume = saveVolume;
// ...existing code...
window.saveMutedState = saveMutedState;
window.showStatus = showStatus;
window.updatePlayButtonState = updatePlayButtonState;
window.startApp = startApp;
window.createStartFavoritesCTA = createStartFavoritesCTA;
window.hideStartFavoritesCTA = hideStartFavoritesCTA;
window.registerServiceWorker = registerServiceWorker;
window.updateServiceWorker = updateServiceWorker;
window.setupPWAInstall = setupPWAInstall;
window.getCastCapabilities = getCastCapabilities;
window.applyCastButtonState = applyCastButtonState;
window.displaySearchResults = displaySearchResults;
window.hideSearchResults = hideSearchResults;
window.hideTracksListPanel = hideTracksListPanel;
window.hideResontesList = hideResontesList;
window.preparePlaybackTransitionFromList = preparePlaybackTransitionFromList;
window.initializeFavoritesPlayListener = initializeFavoritesPlayListener;
window.initializeResontesPlayListener = initializeFavoritesPlayListener;
window.displaySearchHistory = displaySearchHistory;
window.loadSavedPlaybackState = loadSavedPlaybackState;
window.setupPlaybackAutosave = setupPlaybackAutosave;
window.state = state;
window.elements = elements;
window.SEARCH_CONFIG = SEARCH_CONFIG;

// Signal that ui.js has fully loaded
window.uiScriptLoaded = true;
if (window.logger) {
  window.logger.info('UI script fully loaded and exported to window', 'UI');
}

// Manual update trigger for Service Worker
async function updateServiceWorker() {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) { showStatus('No Service Worker registration found', 'warning', 3000); return; }
    try {
      await reg.update();
      // Mode B: if update is waiting, show prompt (leader-only)
      if (reg.waiting) {
        await maybeAnnounceUpdateReady(reg);
      } else {
        showStatus('Checking for updates…', 'info', 2500);
      }
    } catch (err) {
      window.logger?.warn({ message: 'Manual SW update error', error: err }, 'SYSTEM');
      showStatus('Service Worker update failed', 'warning', 3500);
    }
  } catch (e) {
    window.logger?.error({ message: 'updateServiceWorker unexpected error', error: e }, 'SYSTEM');
  }
}

// Optionally wire a button if present in DOM
(() => {
  const btn = document.getElementById('update-sw-btn');
  if (btn) {
    btn.addEventListener('click', (e) => { e.preventDefault(); updateServiceWorker(); });
  }
})();

// ============================================================
//  PLAYLISTS PANEL
// ============================================================

(function initPlaylistsPanel() {
  // ── Helpers ────────────────────────────────────────────────
  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatDuration(secs) {
    if (!secs || !isFinite(secs) || secs < 0) return '';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function pm() {
    return window.PlaylistManager || null;
  }

  // ── Panel visibility ───────────────────────────────────────
  function showPlaylistsPanel() {
    try {
      const panel = document.getElementById('playlists-list');
      if (!panel) return;
      panel.classList.add('active');
      const btn = document.getElementById('playlists-toggle');
      if (btn) btn.setAttribute('aria-expanded', 'true');
      // Close other panels
      try { if (typeof hideSearchResults === 'function') hideSearchResults(); } catch { /* best-effort */ }
      try { if (typeof hideResontesList === 'function') hideResontesList(); } catch { /* best-effort */ }
      renderPlaylistsPanel();
    } catch {}
  }

  function hidePlaylistsPanel() {
    try {
      const panel = document.getElementById('playlists-list');
      if (!panel) return;
      panel.classList.remove('active');
      const btn = document.getElementById('playlists-toggle');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    } catch {}
  }

  function togglePlaylistsPanel() {
    const panel = document.getElementById('playlists-list');
    if (!panel) return;
    if (panel.classList.contains('active')) {
      hidePlaylistsPanel();
    } else {
      showPlaylistsPanel();
    }
  }

  window.showPlaylistsPanel = showPlaylistsPanel;
  window.hidePlaylistsPanel = hidePlaylistsPanel;
  window.togglePlaylistsPanel = togglePlaylistsPanel;

  // ── Render panel ───────────────────────────────────────────
  function renderPlaylistsPanel() {
    const body = document.getElementById('playlists-panel-body');
    if (!body) return;

    const mgr = pm();
    const playlists = mgr ? mgr.getAll() : [];

    // Update header count badge
    const countBadge = document.getElementById('playlists-count');
    if (countBadge) countBadge.textContent = playlists.length > 0 ? String(playlists.length) : '';

    if (playlists.length === 0) {
      body.innerHTML = '<p class="playlists-empty-msg">No playlists yet.<br>Create one with <strong>+ New</strong> or import a Grayjay JSON file.</p>';
      return;
    }

    body.innerHTML = '';
    playlists.forEach(pl => {
      const card = document.createElement('div');
      card.className = 'pl-card';
      card.setAttribute('role', 'listitem');

      const trackCount = Array.isArray(pl.tracks) ? pl.tracks.length : 0;

      card.innerHTML = `
        <div class="pl-card-header" tabindex="0" role="button" aria-expanded="false" aria-label="${escHtml(pl.name)}, ${trackCount} tracks">
          <div class="pl-card-info">
            <div class="pl-card-name">${escHtml(pl.name)}</div>
            <div class="pl-card-meta">${trackCount} track${trackCount !== 1 ? 's' : ''}</div>
          </div>
          <div class="pl-card-btns">
            <button class="pl-card-btn pl-card-btn--play" type="button" title="Play playlist" aria-label="Play ${escHtml(pl.name)}">
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="16" height="16" aria-hidden="true" focusable="false"><polygon points="5,3 19,12 5,21"/></svg>
            </button>
            <button class="pl-card-btn pl-card-btn--rename" type="button" title="Rename playlist" aria-label="Rename ${escHtml(pl.name)}">✏️</button>
            <button class="pl-card-btn pl-card-btn--export" type="button" title="Export to Grayjay JSON" aria-label="Export ${escHtml(pl.name)}">📤</button>
            <button class="pl-card-btn pl-card-btn--danger pl-card-btn--delete" type="button" title="Delete playlist" aria-label="Delete ${escHtml(pl.name)}">🗑</button>
          </div>
        </div>
        <div class="pl-tracks-list" aria-label="Tracks in ${escHtml(pl.name)}"></div>
      `;

      const header = card.querySelector('.pl-card-header');
      const tracksList = card.querySelector('.pl-tracks-list');

      // Toggle track list on header click
      header.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const isOpen = tracksList.classList.toggle('open');
        header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        if (isOpen) renderPlaylistTracks(tracksList, pl);
      });
      header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); header.click(); }
      });

      // Play
      card.querySelector('.pl-card-btn--play').addEventListener('click', (e) => {
        e.stopPropagation();
        try { if (typeof window.playFromPlaylist === 'function') window.playFromPlaylist(pl, 0); } catch {}
      });

      // Rename
      card.querySelector('.pl-card-btn--rename').addEventListener('click', (e) => {
        e.stopPropagation();
        const newName = window.prompt('Rename playlist:', pl.name);
        if (!newName || !newName.trim()) return;
        try { pm() && pm().renamePlaylist(pl.id, newName.trim()); } catch {}
        renderPlaylistsPanel();
      });

      // Export
      card.querySelector('.pl-card-btn--export').addEventListener('click', (e) => {
        e.stopPropagation();
        try { pm() && pm().exportToGrayjay(pl.id); } catch {}
      });

      // Delete
      card.querySelector('.pl-card-btn--delete').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!window.confirm(`Delete playlist "${pl.name}"?`)) return;
        try { pm() && pm().deletePlaylist(pl.id); } catch {}
        renderPlaylistsPanel();
      });

      body.appendChild(card);
    });
  }

  function renderPlaylistTracks(container, pl) {
    container.innerHTML = '';
    const tracks = Array.isArray(pl.tracks) ? pl.tracks : [];
    if (tracks.length === 0) {
      container.innerHTML = '<div class="pl-tracks-empty-msg">No tracks yet.</div>';
      return;
    }
    const currentUrl = window.state && window.state.currentTrack ? window.state.currentTrack.url : null;
    tracks.forEach((track, idx) => {
      const row = document.createElement('div');
      row.className = 'pl-track-row' + (currentUrl && track.url === currentUrl ? ' pl-track-row--playing' : '');
      row.setAttribute('role', 'listitem');

      const trackDuration = track.duration ? formatDuration(track.duration) : '';
      row.innerHTML = `
        <div style="min-width:0">
          <div class="pl-track-title">${escHtml(track.title || 'Untitled')}</div>
          <div class="pl-track-creator">${escHtml(track.creator || '')}${trackDuration ? ' · ' + escHtml(trackDuration) : ''}</div>
        </div>
        <button class="pl-track-remove-btn" type="button" title="Remove from playlist" aria-label="Remove ${escHtml(track.title || 'Untitled')} from playlist">&#x2715;</button>
      `;

      row.addEventListener('click', (e) => {
        if (e.target.closest('.pl-track-remove-btn')) return;
        try { if (typeof window.playFromPlaylist === 'function') window.playFromPlaylist(pl, idx); } catch {}
      });

      row.querySelector('.pl-track-remove-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        try { pm() && pm().removeTrack(pl.id, track.url); } catch {}
        // Re-fetch the updated playlist and re-render the track list
        const updated = pm() ? pm().getById(pl.id) : null;
        if (updated) {
          pl.tracks = updated.tracks;
          renderPlaylistTracks(container, pl);
        } else {
          renderPlaylistsPanel();
        }
      });

      container.appendChild(row);
    });
  }

  window.renderPlaylistsPanel = renderPlaylistsPanel;

  // ── Add-to-playlist picker popup ──────────────────────────
  let _pickerBackdrop = null;

  function closePlaylistPicker() {
    try {
      if (_pickerBackdrop && _pickerBackdrop.parentNode) {
        _pickerBackdrop.parentNode.removeChild(_pickerBackdrop);
      }
    } catch {}
    _pickerBackdrop = null;
  }

  function showPlaylistPicker(track, anchorEl) {
    closePlaylistPicker();

    const mgr = pm();
    const playlists = mgr ? mgr.getAll() : [];

    // Backdrop (click-away dismiss)
    _pickerBackdrop = document.createElement('div');
    _pickerBackdrop.className = 'pl-picker-backdrop';
    _pickerBackdrop.addEventListener('click', closePlaylistPicker);
    document.body.appendChild(_pickerBackdrop);

    // Popup
    const picker = document.createElement('div');
    picker.className = 'pl-picker';
    picker.setAttribute('role', 'menu');
    picker.innerHTML = `<div class="pl-picker-header">Add to playlist</div><div class="pl-picker-list"></div>`;
    const list = picker.querySelector('.pl-picker-list');

    playlists.forEach(pl => {
      const btn = document.createElement('button');
      btn.className = 'pl-picker-item';
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      btn.textContent = pl.name;
      btn.addEventListener('click', () => {
        try {
          const added = mgr.addTrack(pl.id, track);
          if (typeof window.showStatus === 'function') {
            window.showStatus(added ? `Added to "${pl.name}"` : `Already in "${pl.name}"`, 'info', 2000);
          }
        } catch {}
        closePlaylistPicker();
      });
      list.appendChild(btn);
    });

    // "New playlist" option
    const newBtn = document.createElement('button');
    newBtn.className = 'pl-picker-item pl-picker-item--new';
    newBtn.type = 'button';
    newBtn.setAttribute('role', 'menuitem');
    newBtn.textContent = '+ New playlist';
    newBtn.addEventListener('click', () => {
      closePlaylistPicker();
      const name = window.prompt('New playlist name:');
      if (!name || !name.trim()) return;
      try {
        if (!mgr) return;
        const pl = mgr.createPlaylist(name.trim());
        mgr.addTrack(pl.id, track);
        if (typeof window.showStatus === 'function') {
          window.showStatus(`Added to "${pl.name}"`, 'info', 2000);
        }
      } catch {}
    });
    list.appendChild(newBtn);

    document.body.appendChild(picker);

    // Position near anchor
    try {
      const rect = anchorEl ? anchorEl.getBoundingClientRect() : null;
      const vpW = window.innerWidth || 320;
      const vpH = window.innerHeight || 568;

      if (rect) {
        let top = rect.bottom + 4;
        let left = rect.left;
        const pickerW = 240;
        if (left + pickerW > vpW - 8) left = vpW - pickerW - 8;
        if (left < 8) left = 8;
        if (top + 280 > vpH) top = rect.top - 280;
        if (top < 8) top = 8;
        picker.style.top = top + 'px';
        picker.style.left = left + 'px';
      } else {
        picker.style.top = '50%';
        picker.style.left = '50%';
        picker.style.transform = 'translate(-50%, -50%)';
      }
    } catch {}
  }

  window.showPlaylistPicker = showPlaylistPicker;

  // ── Wire buttons after DOM ready ──────────────────────────
  function wirePlaylists() {
    // Toggle button in app menu sheet
    const toggleBtn = document.getElementById('playlists-toggle');
    if (toggleBtn && !toggleBtn.dataset.playlistBound) {
      toggleBtn.dataset.playlistBound = '1';
      toggleBtn.addEventListener('click', (e) => {
        try { e.preventDefault(); e.stopPropagation(); } catch {}
        togglePlaylistsPanel();
      });
    }

    // Close button
    const closeBtn = document.getElementById('playlists-close-btn');
    if (closeBtn && !closeBtn.dataset.playlistBound) {
      closeBtn.dataset.playlistBound = '1';
      closeBtn.addEventListener('click', hidePlaylistsPanel);
    }

    // New playlist button
    const newBtn = document.getElementById('playlists-new-btn');
    if (newBtn && !newBtn.dataset.playlistBound) {
      newBtn.dataset.playlistBound = '1';
      newBtn.addEventListener('click', () => {
        const name = window.prompt('New playlist name:');
        if (!name || !name.trim()) return;
        try { pm() && pm().createPlaylist(name.trim()); } catch {}
        renderPlaylistsPanel();
      });
    }

    // Import button
    const importBtn = document.getElementById('playlists-import-btn');
    const importInput = document.getElementById('playlist-import-input');
    if (importBtn && importInput && !importBtn.dataset.playlistBound) {
      importBtn.dataset.playlistBound = '1';
      importBtn.addEventListener('click', () => {
        importInput.value = '';
        importInput.click();
      });
      importInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const mgr = pm();
          if (!mgr) return;
          const pl = await mgr.importFromGrayjay(file);
          if (typeof window.showStatus === 'function') {
            window.showStatus(`Imported "${pl.name}" (${pl.tracks.length} tracks)`, 'info', 3000);
          }
          renderPlaylistsPanel();
        } catch (err) {
          if (typeof window.showStatus === 'function') {
            window.showStatus('Could not import playlist. Check the file format.', 'error', 4000);
          }
        }
      });
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    wirePlaylists();
  } else {
    window.addEventListener('DOMContentLoaded', wirePlaylists);
  }
})();
