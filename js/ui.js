const elements = {
  audio: document.getElementById('audio'),
  art: document.getElementById('art'),
  title: document.getElementById('title'),
  creator: document.getElementById('creator'),
  description: document.getElementById('description'),
    descriptionContainer: document.getElementById('description-container'),
    toggleDescriptionBtn: document.getElementById('toggle-description-btn'),
  progressBar: document.getElementById('progress-bar'),
  progressSection: document.querySelector('.progress-section'),
  progress: document.getElementById('progress'),
  currentTime: document.getElementById('current-time'),
  totalTime: document.getElementById('total-time'),
  prevBtn: document.getElementById('prev-btn'),
  playBtn: document.getElementById('play-btn'),
  nextBtn: document.getElementById('next-btn'),
  favoriteBtn: document.getElementById('favorite-btn'),
  shuffleFavoritesBtn: document.getElementById('shuffle-favorites-btn'),
  searchInput: document.getElementById('search-input'),
  searchClear: document.getElementById('search-clear'),
  searchResults: document.getElementById('search-results'),
  searchResultsList: document.getElementById('search-results-list'),
  searchResultsHeader: document.getElementById('search-results-header'),
  searchResultsCount: document.getElementById('search-results-count'),
  searchOfflineOnly: document.getElementById('search-offline-only'),
  searchResultsClose: document.getElementById('search-results-close'),
  searchLoader: document.getElementById('search-loader'),
  playAllFavoritesBtn: document.getElementById('play-all-favorites-btn'),
  favoritesToggle: document.getElementById('favorites-toggle'),
  favoritesList: document.getElementById('favorites-list'),
  favoritesHeader: document.getElementById('favorites-header'),
  favoritesCountLabel: document.getElementById('favorites-count-label'),
  favoritesListContent: document.getElementById('favorites-list-content'),
  favoritesFilter: document.getElementById('favorites-filter'),
  favoritesClear: document.getElementById('favorites-clear'),
  favoritesOfflineOnly: document.getElementById('favorites-offline-only'),
  favoritesClose: document.getElementById('favorites-close'),
  preloadFavoritesToggle: document.getElementById('preload-favorites-toggle'),
  volumeIcon: document.getElementById('volume-icon'),
  volumeSlider: document.getElementById('volume-slider'),
  // New elements for tab navigation
  navTabs: document.querySelectorAll('.nav-tab'),
  playerTab: document.getElementById('player-tab'),
  searchTab: document.getElementById('search-tab'),
  favoritesTab: document.getElementById('favorites-tab'),
  startView: document.getElementById('start-view'),
  startButton: document.getElementById('start-button'),
  app: document.getElementById('app'),
  playerContent: document.getElementById('player-content'),
  currentTrackShare: document.getElementById('current-track-share')
};

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
  } catch {}
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

  // Favorites toolbar
  try {
    if (elements.favoritesClose) {
      elements.favoritesClose.addEventListener('click', () => {
        try { hideFavoritesList(); } catch {}
      });
    }

    if (elements.favoritesFilter) {
      const input = elements.favoritesFilter;
      const clearBtn = elements.favoritesClear;
      const updateClearBtn = () => {
        if (!clearBtn) return;
        const hasValue = Boolean((input.value || '').trim());
        clearBtn.hidden = !hasValue;
        clearBtn.disabled = !hasValue;
      };
      input.addEventListener('input', (e) => {
        state.favoritesUi = state.favoritesUi || {};
        state.favoritesUi.filterText = (e.target.value || '').trim();
        updateFavoritesList();
        updateClearBtn();
      });
      if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          input.value = '';
          state.favoritesUi = state.favoritesUi || {};
          state.favoritesUi.filterText = '';
          updateFavoritesList();
          updateClearBtn();
          try { input.focus({ preventScroll: true }); } catch { try { input.focus(); } catch {} }
        });
      }
      updateClearBtn();
    }
  } catch {}
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
        if (elements.favoritesList && elements.favoritesList.classList.contains('active')) {
          e.preventDefault();
          hideFavoritesList();
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

// Expose for other scripts (search.js) to call when toggling UI
window.setSearchPanelInsets = setSearchPanelInsets;
window.setFavoritesPanelInsets = setFavoritesPanelInsets;

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
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch {}

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

    state.currentSearchPage = 0;
    state.currentSearchQuery = q;

    const queryAtDispatch = q;
    state.searchRequestId = (state.searchRequestId || 0) + 1;
    const requestId = state.searchRequestId;

    elements.searchResults.classList.add('active');
    setSearchOpenState(true);
    scheduleSearchInsetsBurst();

    (window.performOptimizedSearch || performOptimizedSearch)(queryAtDispatch, 0).then(result => {
      if ((state.searchRequestId || 0) !== requestId) return;
      if (((input.value || '').trim()) !== queryAtDispatch) return;
      displaySearchResults(result);
      addToSearchHistory(queryAtDispatch);
    }).catch(error => {
      console.error('Search error:', error);
      showStatus('Search encountered an error', 'error');
    });

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
        state.searchRequestId = (state.searchRequestId || 0) + 1;
        const requestId = state.searchRequestId;

        elements.searchResults.classList.add('active');
        setSearchOpenState(true);
        scheduleSearchInsetsBurst();

        if (isCoarsePointer || config.closeKeyboardOnSubmit) closeSearchKeyboard();

        (window.performOptimizedSearch || performOptimizedSearch)(queryAtDispatch, 0).then(result => {
          if ((state.searchRequestId || 0) !== requestId) return;
          if (((input.value || '').trim()) !== queryAtDispatch) return;
          displaySearchResults(result);
          addToSearchHistory(queryAtDispatch);
        }).catch(error => {
          console.error('Search error:', error);
          showStatus('Search encountered an error', 'error');
        });
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

// Control de descripción de pista
function updateDescriptionUI(track) {
  if (!elements.descriptionContainer || !elements.toggleDescriptionBtn) return;
  // ...existing code...
  // Modal elements
  const modal = document.getElementById('description-modal');
  const modalDesc = document.getElementById('modal-description');
  const closeModalBtn = document.getElementById('close-description-modal');

  // Buscar la mejor descripción disponible
  const bestDescription = window.getBestDescription
    ? window.getBestDescription(track, track?._albumDescription, '')
    : (track?.description || track?._albumDescription || '');

  if (bestDescription && bestDescription.trim() !== '') {
    elements.toggleDescriptionBtn.style.display = 'inline-flex';
    elements.toggleDescriptionBtn.textContent = 'Info';
    elements.toggleDescriptionBtn.disabled = false;
    console.log('[updateDescriptionUI] Mostrando botón de descripción');
    elements.toggleDescriptionBtn.onclick = function() {
      console.log('[updateDescriptionUI] Click en botón de descripción, mostrando modal');
      if (modal && modalDesc) {
        modalDesc.innerHTML = sanitizeHTML(bestDescription);
        modal.style.display = 'flex';
      }
    };
    if (closeModalBtn && modal) {
      closeModalBtn.onclick = function() {
        console.log('[updateDescriptionUI] Cerrando modal de descripción');
        modal.style.display = 'none';
      };
    }
  } else {
    console.log('[updateDescriptionUI] Ocultando botón de descripción, no hay descripción disponible');
    if (elements.toggleDescriptionBtn) elements.toggleDescriptionBtn.style.display = 'none';
    if (modal) modal.style.display = 'none';
    if (modalDesc) modalDesc.innerHTML = '';
  }
}
window.updateDescriptionUI = updateDescriptionUI;

// Title Ticker Management
let titleTickerTimeoutId = null;
let titleTickerToken = 0;
const TITLE_TICKER_START_DELAY_MS = 1000;
const TITLE_TICKER_ECO_MIN_DURATION_S = 30;
const TITLE_TICKER_ECO_MULTIPLIER = 2;
let titleTickerInteractionInit = false;

function getActiveThemeName() {
  try {
    return document.documentElement.getAttribute('data-theme') || 'night';
  } catch {
    return 'night';
  }
}

function isEnergySaverThemeActive() {
  return getActiveThemeName() === 'energy-saver';
}

function initTitleTickerInteractions() {
  if (titleTickerInteractionInit) return;
  titleTickerInteractionInit = true;
  if (!elements.title) return;

  // In energy-saver: ticker only starts when the user taps the title.
  elements.title.addEventListener('click', () => {
    if (!elements.title) return;
    if (!isEnergySaverThemeActive()) return;

    const overflowRaw = elements.title.style.getPropertyValue('--title-overflow') || '';
    const overflowPx = Number.parseFloat(String(overflowRaw).replace('px', ''));
    if (!Number.isFinite(overflowPx) || overflowPx <= 0) return;

    const span = elements.title.querySelector('.title-text');
    if (span) {
      const duration = span.style.getPropertyValue('animation-duration');
      if (duration) {
        // Ensure eco wildcard rules don't clamp the ticker duration.
        span.style.setProperty('animation-duration', duration, 'important');
      }
    }

    // Toggle for convenience; when active, ticker remains infinite.
    if (elements.title.classList.contains('ticker')) {
      elements.title.classList.remove('ticker');
      return;
    }

    if (span) {
      void span.offsetWidth;
    }
    elements.title.classList.add('ticker');
  });
}

initTitleTickerInteractions();
function updateTitleTicker(titleText) {
  if (!elements.title) return;
  
  // Remover cualquier clase de ticker anterior
  elements.title.classList.remove('ticker');
  elements.title.style.removeProperty('--title-overflow');

  // Cancel any scheduled ticker activation from a previous title.
  if (titleTickerTimeoutId) {
    clearTimeout(titleTickerTimeoutId);
    titleTickerTimeoutId = null;
  }
  const myToken = ++titleTickerToken;
  
  if (!titleText) {
    try {
      const existingSpan = elements.title.querySelector('.title-text');
      if (existingSpan) existingSpan.textContent = '';
      else elements.title.textContent = '';
    } catch {}
    return;
  }

  // Ensure we always animate an inner span to avoid layout jumps.
  let titleSpan = elements.title.querySelector('.title-text');
  if (!titleSpan) {
    titleSpan = document.createElement('span');
    titleSpan.className = 'title-text';
    // Wrap existing content instead of clearing first to avoid visible flicker.
    while (elements.title.firstChild) {
      titleSpan.appendChild(elements.title.firstChild);
    }
    elements.title.appendChild(titleSpan);
  }
  titleSpan.textContent = titleText;
  titleSpan.style.removeProperty('animation-duration');
  
  // Esperar un tick para asegurar que el DOM/layout se actualice primero
  setTimeout(() => {
    if (!elements.title) return;
    if (myToken !== titleTickerToken) return;

    const liveSpan = elements.title.querySelector('.title-text');
    if (!liveSpan) return;

    // Obtener el ancho disponible del contenedor padre
    const container = elements.title.parentElement;
    if (!container) return;
    
    const containerWidth = elements.title.clientWidth || container.clientWidth;
    const titleWidth = liveSpan.scrollWidth;
    
    // Activar ticker si el texto es más ancho que el contenedor
    if (titleWidth > containerWidth) {
      // Calcular duración basada en la longitud del texto
      const baseDuration = Math.max(15, Math.ceil((titleText.length / 30) * 15));
      const isEco = isEnergySaverThemeActive();
      const duration = isEco
        ? Math.max(TITLE_TICKER_ECO_MIN_DURATION_S, Math.ceil(baseDuration * TITLE_TICKER_ECO_MULTIPLIER))
        : baseDuration;

      // Eco mode clamps animation durations globally; force our duration to win.
      liveSpan.style.setProperty('animation-duration', duration + 's', isEco ? 'important' : '');

      // Animate only the overflow distance; keeps start position stable.
      const overflowPx = Math.max(0, titleWidth - containerWidth);
      elements.title.style.setProperty('--title-overflow', overflowPx + 'px');

      // Night/Day: show first, then auto-start ticker.
      // Energy-saver: never auto-start; user can tap to start.
      if (!isEco) {
        titleTickerTimeoutId = setTimeout(() => {
          if (!elements.title) return;
          if (myToken !== titleTickerToken) return;

          // Force reflow so animation restarts reliably when class is added.
          void liveSpan.offsetWidth;

          elements.title.classList.add('ticker');
          titleTickerTimeoutId = null;
        }, TITLE_TICKER_START_DELAY_MS);
      }
    }
  }, 0);
}
window.updateTitleTicker = updateTitleTicker;

const SEARCH_CONFIG = {
  resultsPerPage: 20,
  timeout: 20000,
  enableLazyLoading: true
};

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
  networkType: 'online',
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
  favoritesPreloadEnabled: true,
  contextReloadCount: {},
  contextRepeatCount: {},

  currentSearchPage: 0,
  currentSearchHasMore: false,
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

function setFavoritesPreloadEnabled(enabled) {
  state.favoritesPreloadEnabled = !!enabled;
  try {
    localStorage.setItem('resonate_preload_favorites_enabled', String(enabled));
  } catch (e) {
    window.logger?.warn(`Could not save favorites preload preference: ${e.message}`, 'UI');
  }

  if (elements.preloadFavoritesToggle) {
    elements.preloadFavoritesToggle.checked = state.favoritesPreloadEnabled;
  }

  const statusMsg = enabled ? 'Favorites preload enabled' : 'Favorites preload disabled';
  showStatus(statusMsg, 'info', 2000);
}

function initializePreloadFavoritesToggle() {
  loadFavoritesPreloadPreference();

  if (!elements.preloadFavoritesToggle) return;

  elements.preloadFavoritesToggle.checked = state.favoritesPreloadEnabled;
  elements.preloadFavoritesToggle.addEventListener('change', (e) => {
    setFavoritesPreloadEnabled(e.target.checked);
  });
}

// Initialize preload preference on load
loadFavoritesPreloadPreference();

// Favorites management
function isSupportedAudioUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  // Accept URLs with query strings/fragments (e.g. .mp3?download=1)
  try {
    const u = new URL(trimmed, window.location.href);
    const p = (u.pathname || '').toLowerCase();
    return p.endsWith('.ogg') || p.endsWith('.mp3');
  } catch {
    return /\.(ogg|mp3)(\?|#|$)/i.test(trimmed);
  }
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
      // Filter out unsupported format favorites (keep .ogg and .mp3)
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
          if (fav.url && !seen.has(fav.url)) {
            unique.unshift(fav); // Mantiene el orden de los más recientes
            seen.add(fav.url);
          }
        }
        parsedFavorites = unique;
        localStorage.setItem('resonate_favorites', JSON.stringify(parsedFavorites));
        window.logger.info('Favorites merged and deduplicated (conflict resolution)', 'UI');
      }
    }
    // Eliminar duplicados por url
    const uniqueFavorites = [];
    const seenUrls = new Set();
    for (const fav of parsedFavorites) {
      if (!seenUrls.has(fav.url)) {
        uniqueFavorites.push(fav);
        seenUrls.add(fav.url);
      }
    }
    state.favorites = uniqueFavorites;
    window.logger.info(`Final favorites loaded: ${state.favorites.length} items`, 'UI');

    // Notify other modules (e.g., initialization/restore) that favorites are ready.
    try {
      window.dispatchEvent(new CustomEvent('resonate:favorites-loaded', {
        detail: { count: state.favorites.length }
      }));
    } catch {
      try { window.dispatchEvent(new Event('resonate:favorites-loaded')); } catch {}
    }

    // Precargar favoritos en cola FIFO
    if (state.favoritesPreloadEnabled && typeof audioCache !== 'undefined' && audioCache && typeof audioCache.preloadFavorites === 'function') {
      audioCache.preloadFavorites(state.favorites).catch(err => {
        showStatus('Error preloading favorites for offline: ' + (err && err.message ? err.message : err), 'error', 6000, 'error');
        window.logger.error('Error preloading favorites for offline: ' + (err && err.message ? err.message : err), 'UI');
      });
      window.logger.debug('Favorites preload initiated', 'CACHE');
    }
    // Actualizar estado del botón de reproducción
    updatePlayButtonState();
    // Actualizar la lista visual de favoritos
    updateFavoritesList();
    updateFavoritesCount();
  } catch (e) {
    window.logger.error(`Error loading favorites: ${e.message}`, 'UI');
    state.favorites = [];
    updatePlayButtonState();
  }
}

function saveFavorites() {
  try {
    // Eliminar duplicados antes de guardar
    const uniqueFavorites = [];
    const seenUrls = new Set();
    for (const fav of (state.favorites || [])) {
      if (!seenUrls.has(fav.url)) {
        uniqueFavorites.push(fav);
        seenUrls.add(fav.url);
      }
    }
    state.favorites = uniqueFavorites;
    const payload = JSON.stringify(state.favorites);
    localStorage.setItem('resonate_favorites', payload);
    window.logger.debug('Favorites saved to localStorage', 'UI');
    // Request preload/update of favorites in cache if available
    if (state.favoritesPreloadEnabled && typeof audioCache !== 'undefined' && audioCache && typeof audioCache.preloadFavorites === 'function') {
      audioCache.preloadFavorites(state.favorites).catch(err => {
        showStatus('Error preloading favorites for offline: ' + (err && err.message ? err.message : err), 'error', 6000, 'error');
        window.logger.error('Error preloading favorites for offline: ' + (err && err.message ? err.message : err), 'UI');
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
  if (!track || !track.url) return false;
  return state.favorites.some(fav => fav.url === track.url);
}

/**
 * Carga los favoritos desde localStorage, eliminando duplicados, resolviendo conflictos locales
 * y limpiando favoritos huérfanos (sin archivo en caché).
 * Prioriza los favoritos más recientes en caso de conflicto.
 */
function toggleFavorite(track) {
  if (!track || !track.url) return;
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
    state.favorites = state.favorites.filter(fav => fav.url !== track.url);

      // Resolución automática de conflictos:
      // Fusiona favoritos persistidos y en memoria, priorizando los más recientes (al final de la lista).
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
        if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.prefetchAudio === 'function') {
          audioCache.prefetchAudio(newFavorite.url, true);
        }
      }
    }

    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.remove === 'function') {
      audioCache.remove(track.url);
    }
    showStatus('Track removed from favorites', 'info');
  } else {
    // Evitar duplicados
    if (state.favorites.some(fav => fav.url === track.url)) {
      showStatus('Track is already in your favorites', 'info');
      return;
    }
    const favoriteTrack = {
      id: track.id,
      title: track.title || 'Untitled',
      creator: track.creator || 'Unknown',
      url: track.url,
      isAlbumTrack: track.isAlbumTrack || false,
      albumId: track.albumId || track.id,
      trackIndex: track.trackIndex || 0,
      totalTracks: track.totalTracks || 1,
      albumTitle: track.album || track.title,
      downloadOffline: !!track.downloadOffline
    };
    state.favorites.push(favoriteTrack);

    // Precargar el favorito en caché
    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.prefetchAudio === 'function') {
      audioCache.prefetchAudio(track.url, true).catch(err => {
        showStatus('Error preloading favorite for offline: ' + (err && err.message ? err.message : err), 'error', 6000, 'error');
        window.logger.error('Error preloading favorite for offline: ' + (err && err.message ? err.message : err), 'UI');
      });
    }

    showStatus('Track added to your favorites', 'info');
  }

  saveFavorites();
  updateFavoriteButton();
  updateFavoritesList();
  updateFavoritesCount();

  // Si la pista pertenece a un álbum, verificar si necesitamos actualizar el botón del álbum
  if (track.albumId && track.albumId !== track.id) {
    updateAlbumButtonForTrack(track.albumId);
  }
// Reconciliación básica tras reconexión: merge de favoritos locales y persistidos
window.addEventListener('online', () => {
  try {
    // Cargar favoritos persistidos
    const persisted = localStorage.getItem('resonate_favorites');
    let parsed = [];
    if (persisted) {
      parsed = JSON.parse(persisted);
    }
    // Merge con los favoritos en memoria
    const all = [...parsed, ...(state.favorites || [])];
    const unique = [];
    const seen = new Set();
    for (const fav of all) {
      if (fav.url && !seen.has(fav.url)) {
        unique.push(fav);
        seen.add(fav.url);
      }
    }
    state.favorites = unique;
    localStorage.setItem('resonate_favorites', JSON.stringify(unique));
    window.logger.info('Favorites reconciled after reconnect', 'UI');
    updateFavoritesList();
    updateFavoritesCount();

    // Sincronizar caché de audio: recargar favoritas y resultados de búsqueda
    if (typeof window.audioCache === 'object' && window.audioCache) {
      // Precarga favoritas (mínimo 10)
      window.audioCache.preloadFavorites(state.favorites);
      // Precarga resultados de búsqueda actuales si existen
      if (Array.isArray(state.searchResults) && state.searchResults.length > 0) {
        window.audioCache.preloadSearchResults(state.searchResults);
      }
    }
    if (typeof window.showStatus === 'function') {
      window.showStatus('Conexión recuperada: sincronizando caché offline', 'info', 4000, 'info');
    }
  } catch (e) {
    window.logger.error('Error during favorites reconciliation: ' + (e && e.message ? e.message : e), 'UI');
  }
});
}

// Toggle per-track offline download preference
async function toggleDownloadOffline(track) {
  if (!track || !track.url || typeof window.audioCache === 'undefined' || !window.audioCache) return;
  try {
    const desired = !!track.downloadOffline;
    const meta = {
      trackId: track.id || track.trackId,
      albumId: track.albumId,
      title: track.title,
      creator: track.creator,
      downloadOffline: desired
    };

    if (desired) {
      await window.audioCache.prefetchAudio(track.url, true);
    }

    if (typeof window.audioCache.updateMetadata === 'function') {
      await window.audioCache.updateMetadata(track.url, meta);
    }

    // Sync favorite entry if present
    const fav = state.favorites.find(f => f.url === track.url);
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

  files.forEach((track, index) => {
    // Verificar si la pista ya está en favoritos
    if (!state.favorites.some(fav => fav.url === track.url)) {
      const favoriteTrack = {
        id: track.id,
        title: track.title || 'Untitled',
        creator: track.creator || 'Unknown',
        url: track.url,
        isAlbumTrack: true,
        albumId: albumId,
        trackIndex: index,
        totalTracks: files.length,
        albumTitle: track.album || files[0]?.album || 'Album',
        downloadOffline: !!track.downloadOffline
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
    showStatus(`Album and all tracks saved`, 'info');
  } else {
    showStatus('All tracks already favorited', 'info');
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
    return { action: 'remove', label: 'Remove from favorites', isActive: true };
  } else if (favoritedCount === 0) {
    // Ninguna pista está en favoritos
    return { action: 'add', label: 'Add to favorites', isActive: false };
  } else {
    // Estado mixto: algunas pistas favoritas, otras no
    return { action: 'complete', label: 'Completar álbum', isActive: false };
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
          // Extraer información de la pista del botón (asumiendo que tenemos data attributes o podemos inferir)
          // Como alternativa, podemos buscar la pista por URL o recrear la lógica

          // Buscar el botón play que tiene data-url
          const playBtn = trackItem.querySelector('.track-play');
          if (playBtn && playBtn.dataset.url) {
            const trackUrl = playBtn.dataset.url;
            const isFavorite = isTrackFavorite({ url: trackUrl });

            favoriteBtn.classList.toggle('active', isFavorite);
            favoriteBtn.textContent = isFavorite ? '❤️' : '🩶';
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
      favoriteBtn.classList.toggle('active', !!isFavorite);
      favoriteBtn.textContent = isFavorite ? '❤️' : '🩶';
      favoriteBtn.title = isFavorite ? 'Remove from favorites' : 'Add to favorites';
    });
  } catch {}

  // Legacy list path
  const resultElements = document.querySelectorAll('.search-result');
  resultElements.forEach(resultEl => {
    const resultInfo = resultEl.querySelector('.result-info');
    if (resultInfo && resultInfo.textContent.includes(safeAlbumId)) {
      const favoriteBtn = resultEl.querySelector('.result-favorite');
      if (favoriteBtn) {
        favoriteBtn.classList.toggle('active', !!isFavorite);
        favoriteBtn.innerHTML = isFavorite ? '❤️' : '🩶';
        favoriteBtn.title = isFavorite ? 'Remove from favorites' : 'Add to favorites';
      }
    }
  });
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
        const trackMatch = metaText.match(/(\d+)\s+pistas?/);
        if (trackMatch) {
          const trackCount = parseInt(trackMatch[1]);
          const buttonState = getAlbumButtonState(albumId, trackCount);

          button.classList.toggle('active', buttonState.isActive);
          button.textContent = buttonState.isActive ? '❤️' : '🩶';
          button.title = buttonState.label;
        }
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

function showStatus(message, type = 'info', duration = null, priority = 'normal', showSpinner = false) {
  // Status messages disabled - no-op function
  return;
}

function setArtwork(track, identifier) {
  if (!track || !elements.art) return;

  // Clear existing artwork
  elements.art.innerHTML = '';

  // Create artwork element
  const img = new Image();
  img.alt = 'Album cover';
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'cover';
  img.style.borderRadius = '12px';

  // Evitar que el identificador sea undefined
  const safeIdentifier = identifier || (track && track.id) || (track && track.identifier) || 'default';
  const archiveCoverUrl = `https://archive.org/services/img/${safeIdentifier}`;

  // Create load handler function
  const handleLoad = () => {
    elements.art.appendChild(img);
  };

  // Configure event listeners BEFORE setting src
  img.onload = handleLoad;
  img.onerror = () => {
    // Let the image fail naturally - no fallback
  };

  // Set src AFTER configuring event listeners
  img.src = archiveCoverUrl;

  // Handle case where image is already complete (cached)
  if (img.complete && img.naturalHeight !== 0) {
    handleLoad();
  }
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
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

function updateMediaSessionMetadata(track, identifier) {
  if (!('mediaSession' in navigator)) return;

  try {
    const trackTitle = track.title || 'Untitled';
    const albumTitle = (track.albumTitle || track.album || identifier || '').toString().trim();
    const isAlbumTrack = ((track.totalTracks || 1) > 1) || !!track.isAlbumTrack;
    const displayTitle = (isAlbumTrack && albumTitle && albumTitle.toLowerCase() !== trackTitle.toLowerCase())
      ? `${albumTitle} — ${trackTitle}`
      : trackTitle;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: displayTitle,
      artist: track.creator || 'Unknown',
      album: albumTitle
    });

    updateMediaPositionState();
  } catch (error) {
    console.error('Error updating Media Session:', error);
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
  state.isLoadingMore = false;
  state.searchActive = false;

  // Limpiar timeouts
  if (state.searchTimeout) {
    clearTimeout(state.searchTimeout);
    state.searchTimeout = null;
  }

  // Limpiar cualquier observador de lazy loading
  const lazyObserver = elements.searchResultsList.querySelector('.lazy-load-observer');
  if (lazyObserver) lazyObserver.remove();

  // Limpiar el DOM
  elements.searchResultsList.innerHTML = '';

  console.log('Cleanup complete: search results hidden and state reset');
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

function displaySearchResults(searchData, clearExisting = true) {
  // Hide search loader when results arrive


  if (!searchData) return;
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

  // Ensure toolbar bindings exist
  try { initializePanelToolbarsOnce(); } catch {}

  // Update toolbar visibility + count
  try {
    if (elements.searchResultsHeader) elements.searchResultsHeader.hidden = false;
    if (elements.searchResultsCount) {
      const totalCount = (typeof total === 'number' && isFinite(total) && total > 0) ? total : null;
      const visibleCount = Array.isArray(state.searchResults) ? state.searchResults.length : 0;
      elements.searchResultsCount.textContent = totalCount ? `${visibleCount} / ${totalCount}` : `${visibleCount} results`;
    }
    if (elements.searchOfflineOnly) {
      elements.searchOfflineOnly.checked = !!(state.searchUi && state.searchUi.offlineOnly);
      try { setBodyUiState('search-show-offline-chips', !!(state.searchUi && state.searchUi.offlineOnly)); } catch {}
    }
  } catch {}

  if (results.length === 0 && clearExisting) {
    elements.searchResultsList.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">🔍</div>
        <div class="no-results-title">No Results Found</div>
        <div class="no-results-hint">Try different keywords or check your spelling</div>
      </div>
    `;
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

  // Render from state (supports toolbar filters without mutating base results)
  rerenderSearchResultsFromState(clearExisting);

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

  // Background prefetch: keep 2 pages ahead for infinite scroll
  try {
    if (typeof window.prefetchNextSearchPages === 'function') {
      window.prefetchNextSearchPages(state.currentSearchQuery, state.currentSearchPage, state.currentSearchHasMore, 2);
    }
  } catch {}
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

  renderCardGrid(elements.searchResultsList, viewItems, 'search', clearExisting);

  // Refresh count label
  try {
    if (elements.searchResultsCount) {
      elements.searchResultsCount.textContent = `${viewItems.length} results`;
    }
  } catch {}
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
        const result = await (window.performOptimizedSearch || performOptimizedSearch)(state.currentSearchQuery, state.currentSearchPage);
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
  // Skip metadata loading only for file:// protocol to avoid CORS timeout errors
  const isFileProtocol = window.location.protocol === 'file:';
  if (isFileProtocol) {
    const metaElement = resultEl.querySelector('.result-meta');
    if (metaElement) {
      metaElement.innerHTML = '<span style="color: var(--muted); font-size: 10px;">Info no disponible (file://)</span>';
    }
    return;
  }

  // Skip when offline to prevent noisy failures
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    const metaElement = resultEl.querySelector('.result-meta');
    if (metaElement) {
      metaElement.innerHTML = '<span style="color: var(--muted); font-size: 10px;">Info not available offline</span>';
    }
    return;
  }

  try {
    const metadata = await fetchOptimizedPlayableFiles(identifier);
    const itemMetadata = metadata[0]?.metadata;
    const isAlbum = metadata.length > 1;
    const trackCount = metadata.length;

    console.log(`Album check for ${identifier}: ${trackCount} tracks, isAlbum: ${isAlbum}`);

    const metaElement = resultEl.querySelector('.result-meta');
    if (metaElement) {
      const forceSingle = resultEl.dataset.isTrackList === 'true';
      if (trackCount === 0) {
        metaElement.innerHTML = '<span style="color: var(--muted); font-size: 10px;">No playable tracks</span>';
      } else {
        metaElement.innerHTML = (isAlbum && !forceSingle)
          ? `<span class="album-indicator">${trackCount} tracks</span>`
          : `<span class="album-indicator">Single track</span>`;
      }
    }

    // Actualizar el estado del botón de favorito
    const favoriteBtn = resultEl.querySelector('.result-favorite');
    if (favoriteBtn) {
      const buttonState = isAlbum ? getAlbumButtonState(identifier, trackCount) : getAlbumButtonState(identifier, 1);
      favoriteBtn.classList.toggle('active', buttonState.isActive);
      favoriteBtn.innerHTML = buttonState.isActive ? '❤️' : '🩶';
      favoriteBtn.title = buttonState.label;
    }

    // Mostrar/ocultar el botón de expandir basado en si es un álbum
    const expandButton = resultEl.querySelector('.favorite-actions button:last-child');
    if (expandButton) {
      const forceSingle = resultEl.dataset.isTrackList === 'true';
      // Never show expand for explicit track-list items
      expandButton.style.display = (!forceSingle && trackCount > 1) ? 'inline-block' : 'none';
    }
  } catch (error) {
    console.error('Error loading album info for:', identifier, error);
    console.error('Error details:', error.message, error.stack);

    const metaElement = resultEl.querySelector('.result-meta');
    if (metaElement) {
      metaElement.innerHTML = `<span style="color: var(--muted); font-size: 10px;">Error: ${error.message.includes('Timeout') ? 'Timeout' : 'Unknown error'}</span>`;
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
  favoriteBtn.title = hasFavoriteTrack ? 'Remove from favorites' : 'Add to favorites';
  favoriteBtn.textContent = hasFavoriteTrack ? '❤️' : '🩶';

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

  infoDiv.appendChild(titleDiv);
  infoDiv.appendChild(creatorDiv);

  return infoDiv;
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
  favoriteBtn.title = hasFavoriteTrack ? 'Remove from favorites' : 'Add to favorites';
  favoriteBtn.textContent = hasFavoriteTrack ? '❤️' : '🩶';

  // Share button
  const shareBtn = document.createElement('button');
  shareBtn.className = 'button result-share';
  shareBtn.title = 'Share';
  shareBtn.textContent = '🔗';

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
    console.warn('Invalid result data provided to createSearchResultElement');
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

  // Create cover container
  const coverContainer = document.createElement('div');
  coverContainer.className = 'result-cover';

  // Load cover image
  const img = new Image();
  img.alt = `Album cover for ${result.title || 'Untitled'}`;
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'cover';
  img.style.borderRadius = '6px';

  const archiveCoverUrl = `https://archive.org/services/img/${result.identifier}`;

  // Configure event listeners BEFORE setting src
  img.onload = () => {
    coverContainer.appendChild(img);
  };

  img.onerror = () => {
    // Let the image fail naturally - no fallback
  };

  // Set src AFTER configuring event listeners
  img.src = archiveCoverUrl;

  // Build structure using helper functions for favorites layout
  const infoDiv = createFavoriteInfo(result);
  const { actionsDiv, favoriteBtn, shareBtn, expandBtn } = createFavoriteActions(result, hasFavoriteTrack, { showPlay: false });

  // Add ARIA labels to buttons
  favoriteBtn.setAttribute('aria-label', hasFavoriteTrack ? 'Remove from favorites' : 'Add to favorites');
  shareBtn.setAttribute('aria-label', `Share ${result.title || 'Untitled'}`);
  expandBtn.setAttribute('aria-label', 'Show album tracks');

  // Show expand button immediately for all results
  // Respect explicit track-list override: list and behave as single
  // Hide expand control up-front for track-list results
  expandBtn.style.display = result.isTrackList ? 'none' : 'inline-block';

  // Add cover to the left, then info and actions
  resultEl.appendChild(coverContainer);
  resultEl.appendChild(infoDiv);
  resultEl.appendChild(actionsDiv);

  // Load album info in background
  loadAlbumInfoBackground(result.identifier, resultEl);

  // Play UX: click cover or title/info area
  const playFromSearchResult = async (e) => {
    e.stopPropagation();
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

    try {
      const files = await fetchOptimizedPlayableFiles(result.identifier);
      if (files.length > 0) {
        if (files.length > 1) {
          // Album handling
          const buttonState = getAlbumButtonState(result.identifier, files.length);
          if (buttonState.action === 'remove') {
            removeAlbumFromFavorites(result.identifier);
            favoriteBtn.classList.remove('active');
            favoriteBtn.textContent = '🩶';
            favoriteBtn.title = 'Add to favorites';
          } else if (buttonState.action === 'complete') {
            addAlbumToFavorites(result.identifier, files);
            favoriteBtn.classList.add('active');
            favoriteBtn.textContent = '❤️';
            favoriteBtn.title = 'Remove from favorites';
          } else if (buttonState.action === 'add') {
            addAlbumToFavorites(result.identifier, files);
            favoriteBtn.classList.add('active');
            favoriteBtn.textContent = '❤️';
            favoriteBtn.title = 'Remove from favorites';
          }
        } else {
          // Single track handling
          const track = files[0];
          toggleFavorite(track);
          const isNowFavorite = isTrackFavorite(track);
          favoriteBtn.classList.toggle('active', isNowFavorite);
          favoriteBtn.textContent = isNowFavorite ? '❤️' : '🩶';
          favoriteBtn.title = isNowFavorite ? 'Remove from favorites' : 'Add to favorites';
        }
      }
    } catch (error) {
      console.error('Error managing favorite:', error);
      showStatus('Couldn\'t manage favorite', 'error');
    }
  });

  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    let tracksContainer = resultEl.nextElementSibling;

    if (!tracksContainer || !tracksContainer.classList.contains('tracks-container')) {
      tracksContainer = document.createElement('div');
      tracksContainer.className = 'tracks-container';
      tracksContainer.style.display = 'none';
      const parent = resultEl.parentNode;      if (parent) {        parent.insertBefore(tracksContainer, resultEl.nextSibling);      }
    }

    toggleAlbumTracks(result.identifier, tracksContainer, expandBtn);
  });

  return resultEl;
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

  // Media
  const media = document.createElement('div');
  media.className = 'card-media';
  const img = new Image();
  img.alt = `Cover for ${title}`;
  img.loading = 'lazy';
  img.src = `https://archive.org/services/img/${identifier}`;
  img.onerror = () => {
    // Compact inline SVG placeholder to avoid external dependencies
    const svg = encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'>` +
      `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
      `<stop offset='0%' stop-color='#1f2937'/><stop offset='100%' stop-color='#111827'/></linearGradient></defs>` +
      `<rect width='100%' height='100%' fill='url(#g)'/>` +
      `<g fill='rgba(61, 169, 255, 0.67)' font-family='sans-serif' font-weight='700'>` +
      `<text x='50%' y='48%' dominant-baseline='middle' text-anchor='middle' font-size='22'>No Cover</text>` +
      `<text x='50%' y='66%' dominant-baseline='middle' text-anchor='middle' font-size='12'>${(creator || '').toString().slice(0,24)}</text>` +
      `</g></svg>`
    );
    img.src = `data:image/svg+xml;charset=utf-8,${svg}`;
  };
  media.appendChild(img);

  // Chips
  const chips = document.createElement('div');
  chips.className = 'card-chips';
  const chipType = document.createElement('span');
  chipType.className = 'chip';
  const isAlbum = !item.isTrackList && ( !!item.isAlbum || (typeof item.trackCount === 'number' && item.trackCount > 1) || !!item.isAlbumTrack );
  chipType.textContent = isAlbum ? 'Album' : 'Single';
  chips.appendChild(chipType);

  // Offline chip (when we can determine it cheaply)
  try {
    if (context === 'favorites') {
      const tracks = Array.isArray(item.tracks) ? item.tracks : [];
      const cachedCount = tracks.filter(t => t && t.url && isUrlOfflineAvailableSync(t.url)).length;
      if (cachedCount > 0) {
        const chipOffline = document.createElement('span');
        chipOffline.className = 'chip chip-quiet chip-offline';
        chipOffline.textContent = cachedCount === tracks.length ? 'Offline' : `Offline ${cachedCount}/${tracks.length}`;
        chips.appendChild(chipOffline);
      }
    } else if (context === 'search') {
      if (isAlbumOfflineAvailableSync(identifier)) {
        const chipOffline = document.createElement('span');
        chipOffline.className = 'chip chip-quiet chip-offline';
        chipOffline.textContent = 'Offline';
        chips.appendChild(chipOffline);
      }
    }
  } catch {}

  if (item.trackCount) {
    const chipTrackCount = document.createElement('span');
    chipTrackCount.className = 'chip chip-quiet';
    chipTrackCount.textContent = `${item.trackCount} tracks`;
    chips.appendChild(chipTrackCount);
  }
  media.appendChild(chips);

  // Body
  const body = document.createElement('div');
  body.className = 'card-body';

  const t = document.createElement('div');
  t.className = 'card-title';
  t.textContent = title;
  t.title = title;
  body.appendChild(t);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const favBtn = document.createElement('button');
  favBtn.className = 'card-btn favorite';
  favBtn.textContent = isAlbum ? '🩶' : '🩶';
  const shareBtn = document.createElement('button');
  shareBtn.className = 'card-btn share';
  shareBtn.title = 'Share';
  shareBtn.textContent = '🔗';
  const expandBtn = document.createElement('button');
  expandBtn.className = 'card-btn expand';
  expandBtn.title = '▼';
  expandBtn.textContent = '▼';
  expandBtn.style.display = isAlbum ? 'flex' : 'none';
  actions.appendChild(favBtn);
  actions.appendChild(shareBtn);
  actions.appendChild(expandBtn);

  card.appendChild(media);
  card.appendChild(body);
  card.appendChild(actions);

  // Initialize favorite state from current favorites (albums: any track favorite)
  try {
    const isFav = isAlbumInFavorites(identifier);
    favBtn.classList.toggle('active', isFav);
    favBtn.textContent = isFav ? '❤️' : '🩶';
    favBtn.title = isFav ? 'Remove from favorites' : 'Add to favorites';
  } catch {}

  // Background album info population (track count / album flag)
  try { loadAlbumInfoBackground(identifier, card); } catch (e) {}

  // Event wiring
  if (context === 'search') {
    // Play UX: click cover or title
    const playFromCard = async (e) => {
      e.stopPropagation();
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
      try {
        const files = await fetchOptimizedPlayableFiles(identifier);
        if (files.length > 1) {
          const buttonState = getAlbumButtonState(identifier, files.length);
          if (buttonState.action === 'remove') {
            removeAlbumFromFavorites(identifier);
            favBtn.classList.remove('active');
            favBtn.textContent = '🩶';
            try { updateSearchResultFavoriteState(identifier, false); } catch {}
          } else {
            addAlbumToFavorites(identifier, files);
            favBtn.classList.add('active');
            favBtn.textContent = '❤️';
            try { updateSearchResultFavoriteState(identifier, true); } catch {}
          }
        } else if (files.length === 1) {
          const track = files[0];
          const before = isTrackFavorite(track);
          toggleFavorite(track);
          const after = isTrackFavorite(track);
          favBtn.classList.toggle('active', after);
          favBtn.textContent = after ? '❤️' : '🩶';
          try { updateSearchResultFavoriteState(identifier, after); } catch {}
        }
      } catch (err) {
        showStatus('Couldn\'t manage favorite', 'error');
      }
    });
    // Expand
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      let tracksContainer = card.nextElementSibling;
      if (!tracksContainer || !tracksContainer.classList.contains('tracks-container')) {
        tracksContainer = document.createElement('div');
        tracksContainer.className = 'tracks-container';
        tracksContainer.style.display = 'none';
        const parent = card.parentNode; if (parent) parent.insertBefore(tracksContainer, card.nextSibling);
      }
      toggleAlbumTracks(identifier, tracksContainer, expandBtn);
    });

    // Share
    shareBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const shareKind = isAlbum ? 'album' : 'track';
        await shareTrack(identifier, title, creator, null, shareKind);
      } catch {}
    });
  } else {
    // favorites context
    const isAlbumFavorite = Array.isArray(item.tracks) ? item.tracks.length > 1 : isAlbum;
    // Mark card type for CSS layout tweaks
    card.classList.add(isAlbumFavorite ? 'album' : 'single');

    // Tap-to-play: click cover or title
    const playFromFavoriteCard = async (e) => {
      e.stopPropagation();
      try {
        if (isAlbumFavorite) {
          if (typeof window.playAlbumFromFavorites === 'function') {
            window.playAlbumFromFavorites(identifier);
          } else if (typeof playAlbumFromFavorites === 'function') {
            playAlbumFromFavorites(identifier);
          }
        } else {
          const favoriteTrack = Array.isArray(item.tracks) && item.tracks.length ? item.tracks[0] : item;
          if (typeof window.playFromFavoritesQueue === 'function') {
            window.playFromFavoritesQueue(favoriteTrack);
          } else if (typeof playFromFavoritesQueue === 'function') {
            playFromFavoritesQueue(favoriteTrack);
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
      showStatus('Favorite was removed', 'info');
    });

    expandBtn.style.display = isAlbumFavorite ? 'inline-block' : 'none';
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      let tracksContainer = card.nextElementSibling;
      if (!tracksContainer || !tracksContainer.classList.contains('tracks-container')) {
        tracksContainer = document.createElement('div');
        tracksContainer.className = 'tracks-container';
        tracksContainer.style.display = 'none';
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
  }

  return card;
}

function containerForFavorites() {
  return elements.favoritesList || document.getElementById('favorites-list');
}

// Toggle album tracks visibility
function toggleAlbumTracks(albumId, tracksContainer, expandButton) {
  if (!tracksContainer || !tracksContainer.parentNode) {
    console.error('Tracks container is not a child of the expected parent node.');
    return;
  }

  if (tracksContainer.style.display === 'none') {
    tracksContainer.style.display = 'block';
    expandButton.textContent = '▲';

    // Progressive enhancement: render Tracklist V2 when enabled
    try {
      if (window.features && window.features.tracklistV2) {
        // Avoid duplicate mounting
        if (!tracksContainer.dataset.tlv2Mounted) {
          if (typeof window.displayAlbumTracksV2 === 'function') {
            window.displayAlbumTracksV2(albumId, tracksContainer);
            tracksContainer.dataset.tlv2Mounted = 'true';
          }
        }
      } else {
        // Legacy renderer fallback
        displayAlbumTracks(albumId, tracksContainer);
      }
    } catch (e) {
      // Fallback to legacy on any issue
      try { displayAlbumTracks(albumId, tracksContainer); } catch {}
    }
  } else {
    tracksContainer.style.display = 'none';
    expandButton.textContent = '▼';
  }
}

// Display tracks for an album
function displayAlbumTracks(albumId, tracksContainer) {
  const isInSearchResult = tracksContainer.closest('.search-result') !== null;
  const message = isInSearchResult ? 'Searching...' : 'Loading...';
  tracksContainer.innerHTML = `<div class="search-loading"><div class="loader"></div><span class="loader-text">${message}</span></div>`;

  fetchOptimizedPlayableFiles(albumId)
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
        trackItem.className = 'track-item';

        const isFavoritesContext = tracksContainer.closest('#favorites-list') !== null;

        const playFromTrackRow = () => {
          if (isFavoritesContext) {
            console.log('🎵 Track clicked in favorites context - calling playFromFavoritesQueue with track:', track.title);
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
            <button class="track-favorite ${isFavorite ? 'active' : ''}">${isFavorite ? '❤️' : '🩶'}</button>
            <button class="track-share" title="Share">🔗</button>
          </div>
          <div class="track-item-info">
            <div class="track-title">${track.title || 'Untitled'}</div>
            <div class="track-creator">${track.creator || 'Unknown'}</div>
          </div>
        `;

        const favoriteBtn = trackItem.querySelector('.track-favorite');
        favoriteBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // Evitar que el clic se propague al resultado principal
          toggleFavorite(track);
          const isNowFavorite = isTrackFavorite(track);
          favoriteBtn.classList.toggle('active', isNowFavorite);
          favoriteBtn.textContent = isNowFavorite ? '❤️' : '🩶';
        });

        // Tap-to-play: click anywhere in the row except buttons
        trackItem.addEventListener('click', (e) => {
          if (e.target && e.target.closest && e.target.closest('button')) return;
          e.stopPropagation();
          playFromTrackRow();
        });

        // Share button listener
        const shareBtn = trackItem.querySelector('.track-share');
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
      console.error('Error cargando pistas del álbum:', error);
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
  } else if (hasFavorites) {
    // Habilitar los controles relevantes cuando haya favoritos
    if (elements.prevBtn) elements.prevBtn.disabled = false;
    if (elements.playBtn) elements.playBtn.disabled = false;
    if (elements.nextBtn) elements.nextBtn.disabled = false;
    if (elements.favoriteBtn) elements.favoriteBtn.disabled = false;
    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.disabled = false;

    if (elements.playBtn) elements.playBtn.title = 'Play favorites';
    if (elements.prevBtn) elements.prevBtn.title = 'Previous track';
    if (elements.nextBtn) elements.nextBtn.title = 'Next track';
    if (elements.favoriteBtn) elements.favoriteBtn.title = 'Remove favorite';
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
    if (elements.favoriteBtn) elements.favoriteBtn.title = 'Add to favorites';

    // Prev/Next depend on having a restored context; keep them conservative.
    if (elements.prevBtn) elements.prevBtn.disabled = true;
    if (elements.nextBtn) elements.nextBtn.disabled = true;
    if (elements.prevBtn) elements.prevBtn.title = 'Resume to enable navigation';
    if (elements.nextBtn) elements.nextBtn.title = 'Resume to enable navigation';

    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.disabled = true;
    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.title = 'Shuffle favorites';

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
    if (elements.favoriteBtn) elements.favoriteBtn.title = 'Add to favorites';

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

// Network information helpers
function getNavigatorConnection() {
  return navigator.connection || navigator.mozConnection || navigator.webkitConnection;
}

function deriveNetworkLabel() {
  if (!state.networkOnline) {
    state.networkType = 'offline';
    return 'Offline';
  }

  const connection = getNavigatorConnection();
  let tier = 'online';

  if (connection) {
    const { effectiveType, downlink } = connection;

    if (effectiveType === '5g' || downlink >= 20) {
      tier = '5G';
    } else if (effectiveType === '4g' || downlink >= 5) {
      tier = '4G';
    } else if (effectiveType === '3g' || downlink >= 1.5) {
      tier = '3G';
    } else if (effectiveType === '2g' || effectiveType === 'slow-2g' || downlink > 0) {
      tier = '2G';
    }
  }

  state.networkType = tier.toLowerCase();
  return tier;
}

let __resonateNetworkListenerAttached = false;

function updateNetworkIndicator() {
  const indicator = document.getElementById('network-indicator');
  if (!indicator) return;

  indicator.textContent = deriveNetworkLabel();
}

function attachNetworkInformationListener() {
  const connection = getNavigatorConnection();
  if (!connection || __resonateNetworkListenerAttached || typeof connection.addEventListener !== 'function') return;

  __resonateNetworkListenerAttached = true;
  connection.addEventListener('change', () => {
    updateNetworkIndicator();
  });
}

// Connectivity monitoring
let __resonateConnectivityHandlersAttached = false;

function __resonateSetSearchOnlineState(isOnline) {
  // Keep search UX consistent with connectivity changes
  if (elements.searchInput) {
    elements.searchInput.disabled = !isOnline;
    elements.searchInput.placeholder = isOnline ? "Discover something new to play" : "Search unavailable offline";
  }

  if (!isOnline) {
    // Hide any active search results when offline
    if (typeof hideSearchResults === 'function') hideSearchResults();
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

    __resonateSetSearchOnlineState(true);
    updateOfflineIndicator();
    updateNetworkIndicator();
    // Try to sync cached data when back online
    syncOfflineData();
  });

  window.addEventListener('offline', () => {
    state.networkOnline = false;
    showStatus('Switched to offline playback', 'offline', 4000);

    __resonateSetSearchOnlineState(false);
    updateOfflineIndicator();
    updateNetworkIndicator();

    // Notificar si solo hay pistas offline disponibles
    if (typeof window.audioCache === 'object' && window.audioCache) {
      window.audioCache.getUsageStats().then(stats => {
        if (stats.itemCount > 0) {
          showStatus('Solo tienes acceso a pistas guardadas offline. Conéctate para actualizar tu biblioteca.', 'offline', 6000, 'offline');
        } else {
          showStatus('No hay pistas disponibles offline. Conéctate para descargar tus favoritas.', 'offline', 6000, 'offline');
        }
      });
    }

    // Intentar reproducir desde caché si hay una pista actual
    if (state.currentTrack && elements.audio && elements.audio.src) {
      showStatus('Using cached version of track', 'info', 2000);
    }

    // Show offline-specific UI hints
    showOfflineHints();
  });
}

function setupConnectivityMonitoring() {
  state.networkOnline = navigator.onLine;

  __resonateSetSearchOnlineState(state.networkOnline);
  __resonateAttachConnectivityHandlersOnce();
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
    }
  });

  // Page Lifecycle API: save state when the page is frozen (best-effort, supported on some browsers).
  // This helps on mobile/PWA when the OS suspends the page without firing other lifecycle events.
  try {
    document.addEventListener('freeze', () => {
      savePlaybackState();
    });
  } catch {
    // ignore
  }

  // Also save state when page unloads
  window.addEventListener('beforeunload', savePlaybackState);

  // Also save state when PWA might be closed (pagehide is better for mobile)
  window.addEventListener('pagehide', savePlaybackState);
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
function setupOfflineFunctionality() {
  // Create offline indicator element
  if (!document.getElementById('offline-indicator')) {
    createOfflineIndicator();
  }

  // Create network indicator element
  if (!document.getElementById('network-indicator')) {
    createNetworkIndicator();
  }

  // Initial check
  state.networkOnline = navigator.onLine;
  updateNetworkIndicator();
  updateOfflineIndicator();

  __resonateAttachConnectivityHandlersOnce();
  attachNetworkInformationListener();
}

// Create network indicator in the header
function createNetworkIndicator() {
  if (document.getElementById('network-indicator')) return;

  const indicator = document.createElement('div');
  indicator.id = 'network-indicator';
  indicator.className = 'network-indicator';
  indicator.setAttribute('aria-live', 'polite');
  indicator.textContent = deriveNetworkLabel();

  const headerControls = document.querySelector('.header-controls');
  if (headerControls) {
    headerControls.appendChild(indicator);
  } else {
    const header = document.querySelector('header');
    if (header) {
      header.appendChild(indicator);
    } else {
      document.body.insertBefore(indicator, document.body.firstChild);
    }
  }
}

// Create offline indicator in the UI
function createOfflineIndicator() {
  const indicator = document.createElement('div');
  indicator.id = 'offline-indicator';
  indicator.className = 'offline-indicator hidden';
  indicator.innerHTML = `
    <div class="offline-icon"></div>
    <div class="offline-text">No connection</div>
  `;

  // Add to header or main container
  const header = document.querySelector('header');
  if (header) {
    header.appendChild(indicator);
  } else {
    document.body.insertBefore(indicator, document.body.firstChild);
  }
}

// Update offline indicator visibility and state
function updateOfflineIndicator() {
  const indicator = document.getElementById('offline-indicator');
  if (!indicator) return;

  if (!state.networkOnline) {
    indicator.classList.remove('hidden');
    indicator.classList.add('active');
    indicator.querySelector('.offline-text').textContent = 'No connection';

    // Add offline class to body for styling
    document.body.classList.add('offline-mode');
  } else {
    indicator.classList.remove('active');
    indicator.classList.add('hidden');

    // Remove offline class from body
    document.body.classList.remove('offline-mode');
  }
}

// Show offline-specific hints and information
function showOfflineHints() {
  const favoritesCount = state.favorites ? state.favorites.length : 0;

  if (favoritesCount > 0) {
    showStatus('You have offline favorites', 'info', 5000);
  } else {
    showStatus('Save favorites to listen offline', 'warning', 6000);
  }

  // Check cache status
  if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.getUsageStats === 'function') {
    audioCache.getUsageStats().then(stats => {
      if (stats.itemCount > 0) {
        showStatus('Cache has saved many tracks', 'info', 4000);
      }
    }).catch(error => {
      console.warn('Failed to get cache stats:', error);
    });
  }
}

// Sync data when back online
async function syncOfflineData() {
  try {
    // Preload any pending favorites that weren't cached while offline
    if (state.favoritesPreloadEnabled && state.favorites && state.favorites.length > 0) {
      if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.preloadFavorites === 'function') {
        await audioCache.preloadFavorites(state.favorites);
        showStatus('Syncing your offline library', 'info', 2000);
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
      timestamp: Date.now()
    };

    try {
      localStorage.setItem('resonate_playback_state', JSON.stringify(playbackState));
      state.savedPlaybackState = playbackState;
      console.log('Playback state saved');
    } catch (e) {
      console.warn('Failed to save playback state:', e);
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
      elements.creator.textContent = totalTracks > 1
        ? `${state.currentTrack.creator || 'Unknown'} (${trackIndex + 1}/${totalTracks})`
        : `${state.currentTrack.creator || 'Unknown'}`;
      setArtwork(state.currentTrack, state.currentTrack.id);
      updateFavoriteButton();

      // Rehydrate description UI from snapshot (itemDescription + trackTitle)
      try {
        if (window.updateDescriptionUI) {
          window.updateDescriptionUI({
            title: savedState.trackTitle || state.currentTrack.title || 'Untitled',
            description: savedState.trackDescription || '',
            _albumDescription: savedState.itemDescription || ''
          });
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
    console.warn('Error loading saved playback state:', error);
    state.savedPlaybackState = null;
    state.savedPlaybackQueueSnapshot = null;
  }
  return null;
}

// --- Service Worker Auto-Update (Mode B: prompt) ---
const SW_UPDATE_CHANNEL_NAME = 'resonate_sw_update_v1';
const SW_UPDATE_SESSION_DISMISS_KEY = 'resonate_sw_update_banner_dismissed';
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

// Force autoupdate: apply updates automatically when ready.
// Safety: if playback is active, activation/reload is deferred until idle.
const SW_FORCE_AUTOUPDATE = true;

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

function isUpdateBannerDismissedForSession() {
  try { return sessionStorage.getItem(SW_UPDATE_SESSION_DISMISS_KEY) === 'true'; } catch { return false; }
}

function dismissUpdateBannerForSession() {
  try { sessionStorage.setItem(SW_UPDATE_SESSION_DISMISS_KEY, 'true'); } catch {}
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
  if (isUpdateBannerDismissedForSession()) return;
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
      if (dismiss) dismissUpdateBannerForSession();
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
      console.warn('Apply update failed:', e);
      showStatus('Update failed', 'warning', 3500);
    }
  });

  const later = () => {
    hide(true);
    broadcastUpdateMessage({ type: 'UPDATE_BANNER_DISMISSED' });
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

    showServiceWorkerUpdateBanner(versions);
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

      if (isUpdateBannerDismissedForSession()) return;
      showServiceWorkerUpdateBanner({ currentVersion: msg.currentVersion || null, newVersion: msg.newVersion || null });
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
      dismissUpdateBannerForSession();
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
  const favoritesRoot = elements.favoritesList;
  const favoritesList = elements.favoritesListContent || elements.favoritesList;
  if (!favoritesList) return;

  // Ensure toolbar bindings exist
  try { initializePanelToolbarsOnce(); } catch {}

  // Show header while panel is open
  try {
    if (elements.favoritesHeader) {
      elements.favoritesHeader.hidden = !(favoritesRoot && favoritesRoot.classList && favoritesRoot.classList.contains('active'));
      if (elements.favoritesCountLabel) {
        elements.favoritesCountLabel.textContent = `Favorites (${state.favorites.length})`;
      }
    }

    // Friendly placeholder that includes the favorites count (English)
    if (elements.favoritesFilter) {
      const count = (state && Array.isArray(state.favorites)) ? state.favorites.length : 0;
      const noun = count === 1 ? 'favorite' : 'favorites';
      const msg = count > 0
        ? `Search within your ${count} ${noun}`
        : 'Search your favorites';
      elements.favoritesFilter.placeholder = msg;
      elements.favoritesFilter.title = msg;
    }

    if (elements.favoritesOfflineOnly) {
      elements.favoritesOfflineOnly.checked = !!(state.favoritesUi && state.favoritesUi.offlineOnly);
      try { setBodyUiState('favorites-show-offline-chips', !!(state.favoritesUi && state.favoritesUi.offlineOnly)); } catch {}
    }
    if (elements.favoritesFilter) {
      const ft = (state.favoritesUi && typeof state.favoritesUi.filterText === 'string') ? state.favoritesUi.filterText : '';
      if (elements.favoritesFilter.value !== ft) elements.favoritesFilter.value = ft;
    }
  } catch {}

  favoritesList.innerHTML = '';

  // Actualizar estado del botón de reproducción
  updatePlayButtonState();

  // Actualizar contador visual
  updateFavoritesCount();

  if (state.favorites.length === 0) {

    favoritesList.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">♡</div>
        <div class="no-results-title">No Favorites Yet</div>
        <div class="no-results-hint">Search for music and click the heart to save your favorites</div>
      </div>
    `;
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

  // Favorites UI: Solo grid (no list mode)
  let items = Object.keys(favoritesByAlbum).map(albumId => ({
    identifier: albumId,
    title: favoritesByAlbum[albumId].albumTitle || 'Untitled',
    creator: favoritesByAlbum[albumId].albumCreator || 'Unknown',
    trackCount: favoritesByAlbum[albumId].tracks.length,
    isAlbum: favoritesByAlbum[albumId].tracks.length > 1,
    tracks: favoritesByAlbum[albumId].tracks
  }));

  // Favorites toolbar filters
  const filterText = normalizeFilterText(state.favoritesUi && state.favoritesUi.filterText);
  if (filterText) {
    items = items.filter(item => getTextForSearchItem(item).includes(filterText));
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

  renderCardGrid(favoritesList, items, 'favorites', true);
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
    window.logger?.info(`Favorites toggle ${this.isVisible ? 'opened' : 'closed'}`, 'UI');
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
      try { state.favoritesVisible = true; } catch {}
      try { setBodyUiState('favorites-embedded-open', true); } catch {}

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
      try { state.favoritesVisible = false; } catch {}
      try { setBodyUiState('favorites-embedded-open', false); } catch {}
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
    this.element.setAttribute('aria-label',
      `View favorites (${countText} saved). ${this.isVisible ? 'Favorites list is visible' : 'Click to view your saved favorites'}`
    );
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
let favoritesToggleInstance = null;

// Make the component available across scripts and provide an idempotent initializer.
// Some startup paths (or future refactors) can otherwise leave the toggle unbound.
window.FavoritesToggle = FavoritesToggle;
window.ensureFavoritesToggleInitialized = function ensureFavoritesToggleInitialized() {
  try {
    if (favoritesToggleInstance) return favoritesToggleInstance;
    if (!elements.favoritesToggle || !elements.favoritesList) return null;
    favoritesToggleInstance = new FavoritesToggle(elements.favoritesToggle, elements.favoritesList);
    return favoritesToggleInstance;
  } catch (e) {
    try { console.warn('Failed to initialize FavoritesToggle:', e); } catch {}
    return null;
  }
};

/**
 * Función legacy para compatibilidad hacia atrás
 * @deprecated Usar la instancia de FavoritesToggle directamente
 */
function toggleFavoritesList() {
  if (favoritesToggleInstance) {
    favoritesToggleInstance.toggle();
  } else {
    console.warn('FavoritesToggle instance not initialized');
  }
}

function updateFavoritesCount() {
  const countElement = document.getElementById('favorites-count');
  const toggleBtn = elements.favoritesToggle;
  
  if (countElement && toggleBtn) {
    const count = state.favorites ? state.favorites.length : 0;
    countElement.textContent = count > 0 ? count : '0';
    
    // Improve ARIA label for accessibility
    toggleBtn.setAttribute('aria-label', `View favorites (${count} saved)`);
    
    // Update aria-expanded based on visibility
    const isExpanded = elements.favoritesList?.classList.contains('active') || false;
    toggleBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

    // Friendly placeholder copy for the filter input (English)
    try {
      if (elements.favoritesFilter) {
        const noun = count === 1 ? 'favorite' : 'favorites';
        const msg = count > 0
          ? `Search within your ${count} ${noun}`
          : 'Search your favorites';
        elements.favoritesFilter.placeholder = msg;
        elements.favoritesFilter.title = msg;
      }
    } catch {}
  }
}

function hideFavoritesList() {
  console.log('hideFavoritesList called - favoritesToggleInstance:', !!favoritesToggleInstance);
  
  // Siempre ejecutar el ocultamiento, sin importar el estado previo
  if (favoritesToggleInstance) {
    console.log('Calling favoritesToggleInstance.hide()');
    favoritesToggleInstance.hide();
  }
  
  // Siempre ejecutar el fallback para asegurar que se oculta
  console.log('Executing fallback - removing active class');
  state.favoritesVisible = false;
  
  if (elements.favoritesList) {
    elements.favoritesList.classList.remove('active');
    console.log('Favorites list active class removed, has active:', elements.favoritesList.classList.contains('active'));
  } else {
    console.warn('elements.favoritesList not found');
  }

  try { setBodyUiState('favorites-embedded-open', false); } catch {}

  try {
    if (elements.favoritesHeader) elements.favoritesHeader.hidden = true;
  } catch {}
  
  if (elements.favoritesToggle) {
    elements.favoritesToggle.classList.remove('active');
    elements.favoritesToggle.setAttribute('aria-expanded', 'false');
  }
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
      <button id="start-favorites-btn" style="background:${accentAlt}; color:${bg}; border:none; padding:8px 12px; font-size:14px; border-radius:12px; cursor:pointer;">Play favorites</button>
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
    console.error('Error al iniciar reproducción desde CTA:', err);
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
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      console.log('Service Worker registered with scope:', registration.scope);

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
      console.error('Service Worker registration failed:', error);
      if (error.message.includes('Failed to fetch')) {
        console.error('Ensure the Service Worker file is accessible and the server is running.');
      }
    }
  } else {
    console.warn('Service Workers are not supported in this browser.');
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
      console.warn('Could not save PWA banner preference');
    }
  });

  if (notNowBtn) {
    notNowBtn.addEventListener('click', () => {
      hidePWAInstallBanner();
      try {
        localStorage.setItem('resonate_pwa_banner_dismissed', 'true');
      } catch (e) {
        console.warn('Could not save PWA banner preference');
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

// Search history management
function loadSearchHistory() {
  try {
    const history = localStorage.getItem('resonate_search_history');
    return history ? JSON.parse(history) : [];
  } catch (e) {
    window.logger?.warn(`Error loading search history: ${e.message}`, 'UI');
    return [];
  }
}

function saveSearchHistory(history) {
  try {
    localStorage.setItem('resonate_search_history', JSON.stringify(history));
  } catch (e) {
    window.logger?.warn(`Error saving search history: ${e.message}`, 'UI');
  }
}

function addToSearchHistory(query) {
  if (!query || !query.trim()) return;

  const history = loadSearchHistory();
  const trimmedQuery = query.trim();

  // Remove if already exists (to move to front)
  const filtered = history.filter(item => item !== trimmedQuery);

  // Add to beginning, limit to 10 items
  filtered.unshift(trimmedQuery);
  const limited = filtered.slice(0, 10);

  saveSearchHistory(limited);
}

function displaySearchHistory() {
  const history = loadSearchHistory();

  if (history.length === 0) {
    elements.searchResultsList.innerHTML = '<div class="no-results">No recent searches</div>';
    elements.searchResults.classList.add('active');
    try {
      initializePanelToolbarsOnce();
      if (elements.searchResultsHeader) elements.searchResultsHeader.hidden = false;
      if (elements.searchResultsCount) elements.searchResultsCount.textContent = 'Recent searches';
    } catch {}
    state.searchActive = true;
    setSearchOpenState(true);
    scheduleSearchInsetsBurst();
    return;
  }

  const fragment = document.createDocumentFragment();

  history.forEach((query, index) => {
    const historyItem = document.createElement('div');
    historyItem.className = 'search-history-item';

    historyItem.innerHTML = `
      <span class="history-query">${query}</span>
      <button class="history-remove btn-tertiary" data-index="${index}" title="Remove">✕</button>
    `;

    // Click on query to search
    historyItem.addEventListener('click', (e) => {
      if (!e.target.classList.contains('history-remove')) {
        elements.searchInput.value = query;
        try {
          if (window.SEARCH_UI_CONFIG && window.SEARCH_UI_CONFIG.closeKeyboardOnSubmit) {
            elements.searchInput.blur();
            setKeyboardOpenState(false);
          }
        } catch {}
        // Trigger search
        state.currentSearchPage = 0;
        state.currentSearchQuery = query;

        const queryAtDispatch = query;
        state.searchRequestId = (state.searchRequestId || 0) + 1;
        const requestId = state.searchRequestId;

        elements.searchResults.classList.add('active');
        state.searchActive = true;
        setSearchOpenState(true);
        scheduleSearchInsetsBurst();
        if (window.performOptimizedSearch) {
          window.performOptimizedSearch(queryAtDispatch, 0).then(result => {
            if ((state.searchRequestId || 0) !== requestId) return;
            if ((elements.searchInput.value || '').trim() !== queryAtDispatch) return;
            displaySearchResults(result);
          }).catch(error => {
            console.error('Search error:', error);
            showStatus('Search error', 'error');
          });
        } else {
          console.error('performOptimizedSearch is not available');
          showStatus('Search unavailable', 'error');
        }
      }
    });

    fragment.appendChild(historyItem);
  });

  // Add clear all button
  if (history.length > 0) {
    const clearAllDiv = document.createElement('div');
    clearAllDiv.className = 'search-history-clear';
    clearAllDiv.innerHTML = '<button class="clear-history-btn">Clear history</button>';
    clearAllDiv.querySelector('.clear-history-btn').addEventListener('click', () => {
      clearSearchHistory();
      displaySearchHistory();
    });
    fragment.appendChild(clearAllDiv);
  }

  elements.searchResultsList.innerHTML = '';
  elements.searchResultsList.appendChild(fragment);
  elements.searchResults.classList.add('active');
  try {
    initializePanelToolbarsOnce();
    if (elements.searchResultsHeader) elements.searchResultsHeader.hidden = false;
    if (elements.searchResultsCount) elements.searchResultsCount.textContent = `Recent searches (${history.length})`;
  } catch {}
  state.searchActive = true;
  setSearchOpenState(true);
  scheduleSearchInsetsBurst();

  // Add event listeners for remove buttons
  document.querySelectorAll('.history-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.index);
      removeFromSearchHistory(index);
      displaySearchHistory();
    });
  });
}

function clearSearchHistory() {
  saveSearchHistory([]);
  showStatus('Your search history cleared', 'info', 2000);
}

function removeFromSearchHistory(index) {
  const history = loadSearchHistory();
  if (index >= 0 && index < history.length) {
    history.splice(index, 1);
    saveSearchHistory(history);
  }
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

  console.log('Meta tags updated for sharing:', { title: normalizedTitle, creator: normalizedCreator, imageUrl, shareUrl });
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

  console.log('Attempting to share:', {
    shareUrl,
    title: shareDataTitle,
    shareText,
    creator: resolvedCreator,
    albumTitle: normalizedAlbumTitle,
    kind: shareKind,
    trackIndex: shareUrlTrackIndex
  });

  // Keep meta tags in sync for rich previews
  applyTrackMetaTagsForIdentifier(identifier, shareDataTitle, resolvedCreator, shareUrlTrackIndex);

  if (!navigator.share) {
    console.log('Web Share API no disponible');
    showStatus('Sharing not available', 'warning', 4000);
    return;
  }

  // Try to get cover image for sharing
  let coverFile = null;
  try {
    coverFile = await getCoverImageForSharing(identifier);
    console.log('Cover image obtained for sharing');
  } catch (error) {
    console.warn('Could not get cover image:', error.message);
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
    console.log('Usando Web Share API con mensaje enriquecido');

    const baseShareData = {
      title: shareDataTitle,
      text: shareText,
      url: shareUrl
    };

    // Aggressive behavior: if we have a cover file, try sharing it even when
    // navigator.canShare({ files }) is missing or returns false.
    if (coverFile) {
      try {
        console.log('Attempting to include cover image in share');
        await navigator.share({ ...baseShareData, files: [coverFile] });
        console.log('Web Share API exitoso (with cover file)');
        showStatus('Track shared successfully', 'info', 6000);
        return;
      } catch (errorWithFile) {
        if (isShareCancelled(errorWithFile)) {
          return;
        }

        // If file sharing isn't supported, retry once without the cover.
        if (isLikelyFileShareUnsupported(errorWithFile)) {
          try {
            console.log('File share unsupported, retrying without cover');
            await navigator.share(baseShareData);
            console.log('Web Share API exitoso (without cover)');
            showStatus('Track shared successfully', 'info', 6000);
            return;
          } catch (errorWithoutFile) {
            if (isShareCancelled(errorWithoutFile)) {
              return;
            }
            console.log('Web Share API falló:', errorWithoutFile && errorWithoutFile.message ? errorWithoutFile.message : errorWithoutFile);
            showStatus('Sharing not available', 'warning', 4000);
            return;
          }
        }

        console.log('Web Share API falló:', errorWithFile && errorWithFile.message ? errorWithFile.message : errorWithFile);
        showStatus('Sharing not available', 'warning', 4000);
        return;
      }
    }

    await navigator.share(baseShareData);
    console.log('Web Share API exitoso');
    showStatus('Track shared successfully', 'info', 6000);
  } catch (error) {
    // If user cancels, don't spam.
    if (isShareCancelled(error)) {
      return;
    }
    console.log('Web Share API falló:', error && error.message ? error.message : error);
    showStatus('Sharing not available', 'warning', 4000);
  }
}

// Get cover image as File for sharing
async function getCoverImageForSharing(identifier) {
  const coverUrl = `https://archive.org/services/img/${identifier}`;

  try {
    const response = await fetch(coverUrl);
    if (!response.ok) {
      console.warn('Cover image request failed:', response.status, identifier);
      return null;
    }

    const blob = await response.blob();

    if (!blob || !blob.size) {
      return null;
    }

    // Create File from Blob
    const filename = `cover-${identifier}.jpg`;
    const blobType = blob && typeof blob.type === 'string' ? blob.type : '';
    const fileType = blobType && blobType.startsWith('image/') ? blobType : 'image/jpeg';
    return new File([blob], filename, { type: fileType });
  } catch (error) {
    // Best-effort only: sharing should still work without the cover.
    console.warn('Cover image fetch failed (continuing without image):', error && error.message ? error.message : error);
    return null;
  }
}

// Back-compat wrapper: older callers used this for share previews
function updateMetaTagsForSharing(identifier, title, creator = '') {
  applyTrackMetaTagsForIdentifier(identifier, title, creator);
}

// Initialize UI toggles
initializePreloadFavoritesToggle();

// Bind favorites toggle immediately (idempotent). This prevents cases where the
// app starts partially (or init order changes) and the favorites button has no handler.
try {
  if (typeof window.ensureFavoritesToggleInitialized === 'function') {
    window.ensureFavoritesToggleInitialized();
  }
} catch {}

// Premium desktop UX: toolbars + shortcuts
try { initializePanelToolbarsOnce(); } catch {}
try { initializeDesktopShortcutsOnce(); } catch {}

// Expose critical functions globally for cross-module access
window.loadFavorites = loadFavorites;
window.saveFavorites = saveFavorites;
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
window.displaySearchResults = displaySearchResults;
window.hideSearchResults = hideSearchResults;
window.hideFavoritesList = hideFavoritesList;
window.loadSearchHistory = loadSearchHistory;
window.initializeFavoritesPlayListener = initializeFavoritesPlayListener;
window.saveSearchHistory = saveSearchHistory;
window.addToSearchHistory = addToSearchHistory;
window.displaySearchHistory = displaySearchHistory;
window.clearSearchHistory = clearSearchHistory;
window.removeFromSearchHistory = removeFromSearchHistory;
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
      console.warn('Manual SW update error:', err);
      showStatus('Service Worker update failed', 'warning', 3500);
    }
  } catch (e) {
    console.error('updateServiceWorker unexpected error:', e);
  }
}

// Optionally wire a button if present in DOM
(() => {
  const btn = document.getElementById('update-sw-btn');
  if (btn) {
    btn.addEventListener('click', (e) => { e.preventDefault(); updateServiceWorker(); });
  }
})();