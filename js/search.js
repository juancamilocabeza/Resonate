// Search functionality
// Loader Manager reference is already defined in playback.js
// const getLoaderManager = () => window.loaderManager;

const SEARCH_DEFAULTS = {
  resultsPerPage: 8,
  timeout: 20000,
  metadataTimeout: 60000
};

const SEARCH_LIMITS = {
  metadataBatchSize: 4,
  maxResultsToPreload: 3,
  maxResultsToLoad: 10,
  playlistBatchSize: 2,
  prefetchNextCount: 2
};

// Cache schema/version for search result caching.
// Bump when search query/ranking behavior changes to avoid mixing old results.
const SEARCH_CACHE_SCHEMA = 'intent-pop-v2';

// Curated filter options for Archive.org searches.
// Note: Archive advancedsearch doesn't expose robust faceting; keep this list intentionally small.
window.SEARCH_FILTERS_CONFIG = window.SEARCH_FILTERS_CONFIG || {
  mediatypeDefault: 'audio'
};

// AbortController state for cancellable operations
const searchControllers = {
  currentSearch: null,
  activeMetadata: new Map(),
  tracklistFetches: new Map(),
  hoverPrefetch: new Map()
};

// Track expanded albums for auto-collapse
window.__resonateExpandedAlbums = new Set();

// In-flight de-duplication + background prefetch controllers
const searchInFlight = {
  pages: new Map(),
  metadata: new Map(),
  pagePrefetchControllers: new Map(),
  prefetchQuery: '',
  prefetchGeneration: 0
};

function getSearchCacheKey(query, page) {
  const q = (query || '').trim();
  const filterKey = getSearchFilterCacheKey();
  const orderKey = getSearchOrderingCacheKey(q);
  return `search:${SEARCH_CACHE_SCHEMA}:${q}:${filterKey}:${orderKey}:${page}`;
}

// Expose a stable cache-key helper for the UI (used for deferred metadata enrichment updates).
try {
  if (typeof window !== 'undefined' && typeof window.__resonateGetSearchCacheKey !== 'function') {
    window.__resonateGetSearchCacheKey = (query, page) => getSearchCacheKey(query, page);
  }
} catch {}

function getSearchOrderingCacheKey(query) {
  try {
    const intentInfo = parseSearchIntent(query);
    const mode = getServerSortModeForIntent(intentInfo);
    return `ord=${mode}`;
  } catch {
    return 'ord=rel';
  }
}

function getServerSortModeForIntent(intentInfo) {
  try {
    const intent = intentInfo && typeof intentInfo === 'object' ? String(intentInfo.intent || '') : '';
    // Keep "production-like" behavior for artist searches: popularity tends to surface best-known items.
    if (intent === 'artist' || intent === 'unknown' || intent === '') return 'pop';
    return 'rel';
  } catch {
    return 'rel';
  }
}

function getArchiveSortParam(intentInfo) {
  const mode = getServerSortModeForIntent(intentInfo);
  if (mode === 'pop') return '&sort[]=downloads+desc';
  return '';
}

function getSearchFilterState() {
  const st = getSearchStateRef();
  const ui = st && st.searchUi ? st.searchUi : {};
  const cfg = window.SEARCH_FILTERS_CONFIG || {};

  const mediatype = (ui.mediatype || cfg.mediatypeDefault || 'audio').trim() || 'audio';

  return { mediatype };
}

// Network-facing filters for Archive.org requests.
// Categories were removed; only mediatype remains.
function getSearchNetworkFilterState() {
  try {
    const st = getSearchStateRef();
    const ui = st && st.searchUi ? st.searchUi : {};
    const cfg = window.SEARCH_FILTERS_CONFIG || {};
    const mediatype = (ui.mediatype || cfg.mediatypeDefault || 'audio').trim() || 'audio';
    return { mediatype };
  } catch {
    return { mediatype: 'audio' };
  }
}

function getSearchFilterCacheKey() {
  try {
    const f = getSearchNetworkFilterState();
    return `m=${f.mediatype}`;
  } catch {
    return 'm=audio';
  }
}

function getSearchFilterClauseParts(filters) {
  const f = filters || getSearchNetworkFilterState();

  const parts = [];
  // Always include mediatype (keeps results playable/consistent).
  parts.push(`mediatype:${f.mediatype || 'audio'}`);

  return parts;
}

function extractFirstQuotedPhrase(raw) {
  try {
    const s = String(raw || '');
    const m = s.match(/"([^\"]+)"/);
    if (!m) return null;
    const phrase = String(m[1] || '').trim();
    const idx = typeof m.index === 'number' ? m.index : s.indexOf(m[0]);
    const remainder = (s.slice(0, idx) + ' ' + s.slice(idx + m[0].length))
      .replace(/\s+/g, ' ')
      .trim();
    if (!phrase) return null;
    return { phrase, remainder };
  } catch {
    return null;
  }
}

function parseSearchIntent(rawQuery) {
  const raw = String(rawQuery || '').trim();
  const normalized = normalizeString(raw);
  const tokens = tokenizeNormalized(normalized);
  const result = {
    raw,
    normalized,
    tokens,
    intent: 'unknown',
    artist: '',
    title: ''
  };

  if (!raw) return result;

  // Explicit prefixes
  try {
    const mArtist = raw.match(/^\s*(artist|band)\s*:\s*(.+)$/i);
    if (mArtist && mArtist[2]) {
      result.intent = 'artist';
      result.artist = String(mArtist[2]).trim();
      return result;
    }
    const mTitle = raw.match(/^\s*(title|song|track|album)\s*:\s*(.+)$/i);
    if (mTitle && mTitle[2]) {
      result.intent = 'title';
      result.title = String(mTitle[2]).trim();
      return result;
    }
  } catch {}

  // Quoted phrase implies title intent; if there is remainder, treat as mixed.
  const quoted = extractFirstQuotedPhrase(raw);
  if (quoted) {
    if (quoted.remainder) {
      result.intent = 'mixed';
      result.title = quoted.phrase;
      result.artist = quoted.remainder;
    } else {
      result.intent = 'title';
      result.title = quoted.phrase;
    }
    return result;
  }

  // Split patterns: "X - Y" or "X by Y".
  try {
    const byMatch = raw.match(/^(.+?)\s+by\s+(.+?)$/i);
    if (byMatch && byMatch[1] && byMatch[2]) {
      result.intent = 'mixed';
      // "title by artist" pattern
      result.title = String(byMatch[1]).trim();
      result.artist = String(byMatch[2]).trim();
      return result;
    }

    const dashMatch = raw.match(/^(.+?)\s*[\-–—]\s*(.+?)$/);
    if (dashMatch && dashMatch[1] && dashMatch[2]) {
      result.intent = 'mixed';
      // Common expectation: "artist - title"
      result.artist = String(dashMatch[1]).trim();
      result.title = String(dashMatch[2]).trim();
      return result;
    }
  } catch {}

  // Heuristic intent
  const trackHintRe = /\b(live|remix|remastered|remaster|acoustic|demo|cover|feat\.?|ft\.?|edit|version|official|single|album|lp|ep|discography|vol\.?|pt\.?|part)\b/i;
  const hasTrackHints = trackHintRe.test(raw) || /\d/.test(raw);

  if (raw.startsWith('"')) {
    result.intent = 'title';
    result.title = raw.replace(/^"+|"+$/g, '').trim();
    return result;
  }

  // Default to artist intent for short inputs (better for band names),
  // unless there are track-like hints.
  if (tokens.length <= 3 && !hasTrackHints) {
    result.intent = 'artist';
    result.artist = raw;
    return result;
  }

  if (hasTrackHints) {
    result.intent = 'title';
    result.title = raw;
    return result;
  }

  // Longer queries without explicit separators are often mixed, but keep parts empty.
  result.intent = tokens.length >= 5 ? 'mixed' : 'artist';
  if (result.intent === 'artist') result.artist = raw;
  return result;
}

function makeSolrGroupTerm(text, { phraseIfMultiWord = false } = {}) {
  const s = String(text || '').trim();
  if (!s) return '';
  // Avoid basic syntax errors from accidental parentheses; keep it permissive.
  const cleaned = s.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!phraseIfMultiWord) return cleaned;
  if (!/\s/.test(cleaned)) return cleaned;
  // Wrap multi-word phrases to help Solr phrase matching.
  const escaped = cleaned.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function buildOptimizedArchiveQuery(query, filters, intentInfo) {
  const q = String(query || '').trim();
  if (!q) return '';

  const intent = intentInfo || parseSearchIntent(q);
  const qTerm = makeSolrGroupTerm(q);
  let phases;

  if (intent && intent.intent === 'mixed' && intent.artist && intent.title) {
    const artistTerm = makeSolrGroupTerm(intent.artist);
    const titleTerm = makeSolrGroupTerm(intent.title, { phraseIfMultiWord: true });
    phases = [
      `(creator:(${artistTerm}) AND title:(${titleTerm}))`,
      `(title:(${titleTerm}) AND creator:(${artistTerm}))`,
      `(title:(${titleTerm}))`,
      `(creator:(${artistTerm}))`,
      `(${qTerm})`
    ];
  } else if (intent && intent.intent === 'title') {
    phases = [
      `(title:(${qTerm}))`,
      `(title:(${qTerm}) AND creator:(${qTerm}))`,
      `(creator:(${qTerm}))`,
      `(${qTerm})`
    ];
  } else if (intent && intent.intent === 'artist') {
    phases = [
      `(creator:(${qTerm}))`,
      `(title:(${qTerm}) AND creator:(${qTerm}))`,
      `(title:(${qTerm}))`,
      `(${qTerm})`
    ];
  } else {
    // Phase strategy: search title AND creator first, then general.
    phases = [
      `(title:(${qTerm}) AND creator:(${qTerm}))`,
      `(title:(${qTerm}))`,
      `(creator:(${qTerm}))`,
      `(${qTerm})`
    ];
  }

  const orGroup = `(${phases.join(' OR ')})`;
  const filterParts = getSearchFilterClauseParts(filters);
  if (!filterParts.length) return orGroup;

  return `${orGroup} AND ${filterParts.map(p => `(${p})`).join(' AND ')}`;
}

function scheduleTaskIdle(task, { timeout = 1500 } = {}) {
  try {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => {
        try { task(); } catch {}
      }, { timeout });
      return;
    }
  } catch {}
  setTimeout(() => {
    try { task(); } catch {}
  }, 0);
}

async function enrichSearchResultsWithMetadata(processedResults, query, { signal, keepUnplayables = false } = {}) {
  const enrichedResults = [];
  const batchSize = SEARCH_LIMITS.metadataBatchSize;

  for (let i = 0; i < processedResults.length; i += batchSize) {
    if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const batch = processedResults.slice(i, i + batchSize);
    const batchPromises = batch.map(async (item) => {
      try {
        const files = (window.AlbumTracks && typeof window.AlbumTracks.getTracks === 'function')
          ? await window.AlbumTracks.getTracks(item.identifier, { preferCache: true, allowFetch: true })
          : await fetchOptimizedPlayableFiles(item.identifier);
        const count = Array.isArray(files) ? files.length : 0;
        if (count > 0) {
          const isTrackList = item.isTrackList === true && count <= 1;
          return {
            ...item,
            // Only force "single" for track-list items when there is a single playable file.
            // If multiple playable files exist, treat as an album.
            isTrackList,
            isAlbum: (count > 1),
            trackCount: count
          };
        }
        return keepUnplayables
          ? {
            ...item,
            isAlbum: false,
            trackCount: 0,
            unplayable: true
          }
          : null;
      } catch {
        return keepUnplayables
          ? {
            ...item,
            isAlbum: false,
            trackCount: 0,
            unplayable: true
          }
          : null;
      }
    });
    const batchResultsRaw = await Promise.all(batchPromises);
    const batchResults = keepUnplayables ? batchResultsRaw.filter(Boolean) : batchResultsRaw.filter(Boolean);
    enrichedResults.push(...batchResults);
  }

  // For deferred/background enrichment, preserve original order to avoid index churn.
  if (!keepUnplayables) {
    // Apply priority ordering: Single > Album; Exact contains > Typo-similar > others
    prioritizeResults(enrichedResults, query);
  }
  return enrichedResults;
}

function scheduleSearchPageEnrichment({ cacheKey, normalizedQuery, page, processedResults, hasMore, total, priority = 'idle' }) {
  try {
    const resolvedKey = cacheKey || getSearchCacheKey(normalizedQuery, page);
    const schedule = (task) => {
      if (priority === 'immediate') {
        setTimeout(() => {
          try { task(); } catch {}
        }, 0);
        return;
      }
      scheduleTaskIdle(task, { timeout: 1500 });
    };

    schedule(async () => {
      try {
        const existing = window.enhancedCache && window.enhancedCache.get('search', resolvedKey);
        if (existing && existing.deferredMetadata !== true) return; // already full

        const enrichedResults = await enrichSearchResultsWithMetadata(processedResults, normalizedQuery, { keepUnplayables: true });
        const full = {
          results: enrichedResults,
          hasMore,
          total,
          deferredMetadata: false
        };
        if (window.enhancedCache) window.enhancedCache.set('search', resolvedKey, full);

        // Notify UI: if ui.js isn't loaded yet, queue it for later.
        try {
          if (typeof window.onSearchPageEnriched === 'function') {
            window.onSearchPageEnriched({ query: normalizedQuery, page });
          } else {
            if (!Array.isArray(window.__pendingSearchEnriched)) window.__pendingSearchEnriched = [];
            window.__pendingSearchEnriched.push({ query: normalizedQuery, page, ts: Date.now() });
          }
        } catch {}
      } catch {
        // background enrichment is best-effort
      }
    });
  } catch {
    // ignore
  }
}

function getSearchStateRef() {
  return window.state || (typeof state !== 'undefined' ? state : null);
}

function getSearchElementsRef() {
  return window.elements || (typeof elements !== 'undefined' ? elements : null);
}

function getSearchConfigRef() {
  return window.SEARCH_CONFIG || (typeof SEARCH_CONFIG !== 'undefined' ? SEARCH_CONFIG : null);
}

function getSearchConfigNumber(key, fallback) {
  const config = getSearchConfigRef() || {};
  const value = config[key];
  const parsed = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getSearchFetchFn() {
  return window.fetchWithTimeout ? window.fetchWithTimeout : (window.fetch || fetch);
}

function isSearchNetworkAvailable() {
  try {
    const st = getSearchStateRef();
    if (st && st.networkOnline === false) return false;
    if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return false;
    return true;
  } catch {
    // Default to "online" so we don't block searches in environments
    // where connectivity APIs are missing/buggy.
    return true;
  }
}

function shouldPreferArchiveProxy() {
  try {
    const qs = new URLSearchParams((window.location && window.location.search) ? window.location.search : '');
    if (qs.get('noProxy') === '1') return false;
    if (qs.get('proxy') === '1') return true;

    // Circuit breaker: if the proxy is failing (e.g., upstream TLS issues),
    // avoid repeatedly hammering it during scroll/prefetch.
    try {
      const disabledUntil = typeof window.__resonateArchiveProxyDisabledUntil === 'number'
        ? window.__resonateArchiveProxyDisabledUntil
        : 0;
      if (disabledUntil && Date.now() < disabledUntil) return false;
    } catch {}

    const host = String((window.location && window.location.hostname) ? window.location.hostname : '');
    if (host === 'localhost' || host === '127.0.0.1') {
      return qs.get('proxy') === '1';
    }
    return true;
  } catch {
    return false;
  }
}

function disableArchiveProxyTemporarily(reason) {
  try {
    window.__resonateArchiveProxyDisabledUntil = Date.now() + 2 * 60 * 1000;
    window.__resonateArchiveProxyDisabledReason = reason || 'proxy-unavailable';
  } catch {}
}

function isProxyNetworkError(err) {
  try {
    const msg = String((err && err.message) ? err.message : err).toLowerCase();
    return (
      msg.includes('err_connection_refused') ||
      msg.includes('connection refused') ||
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('load failed')
    );
  } catch {
    return false;
  }
}

function toArchiveProxyUrl(archiveUrl) {
  try {
    const u = new URL(String(archiveUrl || ''));
    if (u.hostname !== 'archive.org') return String(archiveUrl || '');
    if (!u.pathname.endsWith('/advancedsearch.php')) return String(archiveUrl || '');
    const qs = u.searchParams.toString();
    return `/api/archive/advancedsearch${qs ? `?${qs}` : ''}`;
  } catch {
    return String(archiveUrl || '');
  }
}

function toArchiveMetadataProxyUrl(metadataUrl) {
  try {
    const u = new URL(String(metadataUrl || ''));
    if (u.hostname !== 'archive.org') return String(metadataUrl || '');
    const m = u.pathname.match(/^\/metadata\/(.+)$/);
    if (!m || !m[1]) return String(metadataUrl || '');
    const id = String(m[1]).replace(/\/+$/, '');
    return `/api/archive/metadata/${encodeURIComponent(id)}`;
  } catch {
    return String(metadataUrl || '');
  }
}

async function fetchArchiveMetadataWithFallback(url, init) {
  const fetchFn = getSearchFetchFn();

  const directUrl = String(url || '');
  const proxyUrl = toArchiveMetadataProxyUrl(directUrl);
  const preferProxy = shouldPreferArchiveProxy();

  const candidates = preferProxy
    ? [proxyUrl, directUrl]
    : [directUrl, proxyUrl];

  const seen = new Set();
  let lastError = null;
  let lastResponse = null;
  let lastUsedProxy = false;

  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);

    const isProxy = candidate.startsWith('/api/archive/');
    const adjustedInit = { ...(init || {}) };
    if (isProxy) {
      const baseTimeout = typeof adjustedInit.timeout === 'number' ? adjustedInit.timeout : 60000;
      adjustedInit.timeout = Math.max(baseTimeout, 60000);
      adjustedInit.headers = { ...(adjustedInit.headers || {}), 'Accept': 'application/json' };
    }

    try {
      const resp = await fetchFn(candidate, adjustedInit);
      lastResponse = resp;
      lastUsedProxy = isProxy;
      if (resp && resp.ok) {
        return { response: resp, usedProxy: isProxy };
      }
      if (isProxy && resp && resp.status === 404) {
        disableArchiveProxyTemporarily('proxy-404');
        continue;
      }

      if (isProxy && resp && resp.status === 502) {
        disableArchiveProxyTemporarily('proxy-502');
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastError = err;
      if (isProxy && isProxyNetworkError(err)) {
        disableArchiveProxyTemporarily('proxy-network-error');
      }
    }
  }

  if (lastResponse) return { response: lastResponse, usedProxy: lastUsedProxy };
  throw lastError || new Error('Network request failed');
}

async function fetchArchiveAdvancedSearchWithFallback(url, init) {
  const fetchFn = getSearchFetchFn();

  const directUrl = String(url || '');
  const proxyUrl = toArchiveProxyUrl(directUrl);
  const preferProxy = shouldPreferArchiveProxy();

  const candidates = preferProxy
    ? [proxyUrl, directUrl]
    : [directUrl, proxyUrl];

  const seen = new Set();
  let lastError = null;
  let lastResponse = null;
  let lastUsedProxy = false;

  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);

    const isProxy = candidate.startsWith('/api/archive/');
    const adjustedInit = { ...(init || {}) };
    // Keep Archive search timeouts generous even when going through the proxy.
    if (isProxy) {
      const baseTimeout = typeof adjustedInit.timeout === 'number' ? adjustedInit.timeout : 20000;
      adjustedInit.timeout = Math.max(baseTimeout, 45000);
    }

    try {
      const resp = await fetchFn(candidate, adjustedInit);
      lastResponse = resp;
      lastUsedProxy = isProxy;
      if (resp && resp.ok) {
        return { response: resp, usedProxy: isProxy };
      }
      // If proxy endpoint doesn't exist (static server), try direct next.
      if (isProxy && resp && resp.status === 404) {
        disableArchiveProxyTemporarily('proxy-404');
        continue;
      }

      if (isProxy && resp && resp.status === 502) {
        disableArchiveProxyTemporarily('proxy-502');
      }
      // Otherwise treat non-OK as a failure and allow fallback.
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastError = err;
      // Continue to next candidate.
      if (isProxy && isProxyNetworkError(err)) {
        disableArchiveProxyTemporarily('proxy-network-error');
      }
    }
  }

  if (lastResponse) {
    return { response: lastResponse, usedProxy: lastUsedProxy };
  }
  throw lastError || new Error('Network request failed');
}

function isAbortError(error) {
  try {
    if (!error) return false;
    if (error && typeof error === 'object' && String(error.name || '') === 'AbortError') return true;
    const msg = String((error && typeof error === 'object' && 'message' in error) ? error.message : error).toLowerCase();
    return msg.includes('aborterror') || msg === 'aborted' || msg.includes('aborted');
  } catch {
    return false;
  }
}

function logSearch(message, level = 'debug', category = 'NETWORK') {
  // Abort errors are expected during cancellations (new search, prefetch generation changes, etc.).
  // Avoid spamming the console with stacks.
  try {
    if (isAbortError(message)) {
      if (level === 'error' || level === 'warn') level = 'debug';
      if (message instanceof Error) message = message.message || 'Aborted';
    }
  } catch {}

  if (window.logger) {
    if (typeof window.logger._call === 'function') {
      window.logger._call(level, message, category);
      return;
    }

    const normalized = String(category || 'SYSTEM').toLowerCase();
    const wrapper = window.logger[normalized];
    if (typeof wrapper === 'function') {
      wrapper(message, level);
      return;
    }
  }

  const fn = level === 'error'
    ? console.error
    : level === 'warn'
      ? console.warn
      : console.log;
  fn(message);
}

function markResultUnplayable(result) {
  if (!result) return;
  try {
    result.unplayable = true;
    result.trackCount = 0;
    result.isAlbum = false;
  } catch {}

  const identifier = result.identifier || result.id || result.albumId || result.album_id;
  if (!identifier) return;
  const safeId = String(identifier);

  try {
    const cards = document.querySelectorAll(`.content-card[data-album-id="${CSS.escape(safeId)}"]`);
    cards.forEach((card) => {
      card.classList.add('unplayable');
      card.setAttribute('aria-disabled', 'true');
      card.setAttribute('tabindex', '-1');
    });
  } catch {}

  try {
    const legacy = document.querySelectorAll(`.search-result[data-album-id="${CSS.escape(safeId)}"]`);
    legacy.forEach((el) => {
      el.classList.add('unplayable');
      el.setAttribute('aria-disabled', 'true');
      el.setAttribute('tabindex', '-1');
    });
  } catch {}
}

function isSearchDebugEnabled() {
  try {
    if (window.SEARCH_DEBUG === true) return true;
    const qs = new URLSearchParams((window.location && window.location.search) ? window.location.search : '');
    if (qs.get('searchDebug') === '1') return true;
  } catch {}

  try {
    const v = localStorage.getItem('resonate_search_debug');
    if (v && v !== '0' && v !== 'false') return true;
  } catch {}

  return false;
}

function debugSearch(event, details) {
  try {
    if (!isSearchDebugEnabled()) return;
    const payload = {
      ts: Date.now(),
      event: String(event || ''),
      ...(details && typeof details === 'object' ? details : {})
    };
    window.__lastSearchDebug = payload;
    if (!Array.isArray(window.__searchDebugLog)) window.__searchDebugLog = [];
    window.__searchDebugLog.push(payload);
    if (window.__searchDebugLog.length > 200) window.__searchDebugLog.shift();
    try { console.log('[SEARCH_DEBUG]', payload); } catch {}
  } catch {
    // ignore
  }
}

function setSearchActiveUI(isActive) {
  const els = getSearchElementsRef();
  if (els && els.searchResults && els.searchResults.classList) {
    els.searchResults.classList.toggle('active', Boolean(isActive));
  }
  // Mutually exclusive panels: opening search hides resontes
  try {
    if (isActive && typeof window.hideResontesList === 'function') {
      window.hideResontesList();
    }
  } catch {
    // ignore
  }
  try {
    if (isActive && typeof window.setSearchPanelInsets === 'function') {
      requestAnimationFrame(window.setSearchPanelInsets);
    }
  } catch {
    // ignore
  }
  const st = getSearchStateRef();
  if (st) st.searchActive = Boolean(isActive);

  // Let the UI track search-panel view time (perf/debug).
  try {
    if (typeof window.__resonateOnSearchPanelActiveChange === 'function') {
      window.__resonateOnSearchPanelActiveChange(Boolean(isActive));
    }
  } catch {
    // ignore
  }
}

function setSearchErrorMessage(message) {
  const els = getSearchElementsRef();
  if (els && els.searchResultsList) {
    els.searchResultsList.innerHTML = `<div class="no-results">${message}</div>`;
  }
}

async function performFastSearch(query, options = {}) {
  const normalizedQuery = (query || '').trim();
  if (!normalizedQuery) {
    return { results: [], hasMore: false, total: 0, deferredMetadata: true, fastPath: true };
  }

  // Fast-path never blocks on metadata; it should fail fast and let optimized search win.
  if (!isSearchNetworkAvailable()) {
    return { results: [], hasMore: false, total: 0, deferredMetadata: true, fastPath: true };
  }

  const signal = options && options.signal;
  const rows = (() => {
    const n = options && (options.rows ?? options.resultsPerPage);
    const parsed = typeof n === 'number' ? n : parseInt(n, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 6;
  })();

  const timeout = (() => {
    const n = options && options.timeout;
    const parsed = typeof n === 'number' ? n : parseInt(n, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const cfgTimeout = getSearchConfigNumber('timeout', SEARCH_DEFAULTS.timeout);
    return Math.min(cfgTimeout, 3500);
  })();

  const networkFilters = getSearchNetworkFilterState();
  const uiFilters = getSearchFilterState();
  const intentInfo = parseSearchIntent(query);
  const optimizedQuery = buildOptimizedArchiveQuery(query, networkFilters, intentInfo);
  const encodedQuery = encodeURIComponent(optimizedQuery);
  const sortParam = getArchiveSortParam(intentInfo);

  const url = `https://archive.org/advancedsearch.php?q=${encodedQuery}&fl[]=identifier,title,creator,description,downloads,addeddate,year,imagecount,collection,mediatype&rows=${rows}&page=1&output=json${sortParam}`;

  debugSearch('fast_request', {
    query: normalizedQuery,
    rows,
    intent: intentInfo,
    serverSort: sortParam,
    optimizedQueryPreview: String(optimizedQuery || '').slice(0, 240)
  });

  const { response, usedProxy } = await fetchArchiveAdvancedSearchWithFallback(url, {
    signal,
    timeout,
    headers: { 'Accept': 'application/json' }
  });
  if (!(response && response.ok)) throw new Error('Fast search network error');

  const data = await response.json();
  const docs = (data.response && data.response.docs) ? data.response.docs : [];

  debugSearch('fast_response', {
    query: normalizedQuery,
    hits: docs.length,
    numFound: (data.response && typeof data.response.numFound === 'number') ? data.response.numFound : null,
    usedProxy
  });

  const processedResults = docs.map(item => ({
    identifier: item.identifier,
    title: item.title || 'Untitled',
    creator: item.creator || 'Unknown',
    description: item.description || '',
    mediatype: item.mediatype || null,
    collection: item.collection || null,
    downloads: (() => {
      const n = typeof item.downloads === 'number' ? item.downloads : parseFloat(item.downloads);
      return Number.isFinite(n) ? n : null;
    })(),
    addeddate: item.addeddate || null,
    year: (() => {
      const n = typeof item.year === 'number' ? item.year : parseInt(item.year, 10);
      return Number.isFinite(n) ? n : null;
    })(),
    imagecount: (() => {
      const n = typeof item.imagecount === 'number' ? item.imagecount : parseInt(item.imagecount, 10);
      return Number.isFinite(n) ? n : 0;
    })(),
    hasNonDefaultCover: (() => {
      const n = typeof item.imagecount === 'number' ? item.imagecount : parseInt(item.imagecount, 10);
      return Number.isFinite(n) && n > 0;
    })(),
    isTrackList: (() => {
      const t = normalizeString(item.title || '').trim();
      if (!t) return false;
      const re = /^(track\s*list|tracklist|track-list|lista\s+de\s+(temas|canciones))\b/;
      const match = t.match(re);
      if (!match) return false;
      const remainder = t.slice(match[0].length);
      const remainderClean = remainder.replace(/[\s\-–—:]+/g, '');
      return remainderClean.length === 0;
    })(),
    isAlbum: null,
    trackCount: null,
    relevanceScore: calculateRelevanceScore(item, query, { intentInfo, filters: uiFilters })
  }));
  if (processedResults.length > 1) {
    processedResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  const total = (data.response && typeof data.response.numFound === 'number') ? data.response.numFound : 0;
  const hasMore = (typeof total === 'number' && isFinite(total) && total > 0)
    ? rows < total
    : (docs.length === rows);

  return { results: processedResults, hasMore, total, deferredMetadata: true, fastPath: true };
}

async function performOptimizedSearch(query, page = 0, options = {}) {
  const normalizedQuery = (query || '').trim();
  if (!normalizedQuery) {
    setSearchActiveUI(false);
    return { results: [], hasMore: false };
  }

  const abortPrevious = options.abortPrevious !== false;
  const showLoader = options.showLoader !== false;
  const activateUI = options.activateUI !== false;
  // Default to fast-first-render; metadata enrichment runs in idle time.
  const deferMetadata = options.deferMetadata !== false;
  const scheduleEnrichment = options.scheduleEnrichment !== false;
  const enrichmentPriority = (options && typeof options.enrichmentPriority === 'string' && options.enrichmentPriority)
    ? options.enrichmentPriority
    : 'idle';

  const cacheKey = getSearchCacheKey(query, page);
  const cached = window.enhancedCache && window.enhancedCache.get('search', cacheKey);
  if (cached) {
    // If we have a deferred result and the caller wants full enrichment, upgrade it.
    if (cached.deferredMetadata === true && !deferMetadata) {
      try {
        const processed = Array.isArray(cached.results) ? cached.results : [];
        const enrichedResults = await enrichSearchResultsWithMetadata(processed, normalizedQuery, { signal: options.signal });
        const upgraded = {
          results: enrichedResults,
          hasMore: Boolean(cached.hasMore),
          total: typeof cached.total === 'number' ? cached.total : 0,
          deferredMetadata: false
        };
        if (window.enhancedCache) window.enhancedCache.set('search', cacheKey, upgraded);
        return upgraded;
      } catch {
        return cached;
      }
    }
    return cached;
  }

  // If we have no cache, only then gate on connectivity.
  // This avoids false-offline states blocking search entirely.
  if (!isSearchNetworkAvailable()) {
    logSearch('Searching needs internet connection', 'info', 'UI');
    if (window.showStatus) window.showStatus('Searching needs internet connection', 'warning', 3000);
    if (activateUI) {
      setSearchErrorMessage('Offline: connect to the internet to search.');
    }
    setSearchActiveUI(false);
    return { results: [], hasMore: false };
  }

  const inFlight = searchInFlight.pages.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const searchPromise = (async () => {
    let ownsController = false;
    let signal = options.signal;

    // Abort previous search if exists (foreground only)
    if (!signal) {
      if (abortPrevious && searchControllers.currentSearch) {
        searchControllers.currentSearch.abort();
        logSearch('Previous search aborted', 'debug', 'NETWORK');
      }

      // Create new AbortController for this search
      searchControllers.currentSearch = new AbortController();
      signal = searchControllers.currentSearch.signal;
      ownsController = true;
    }

    if (activateUI) {
      setSearchActiveUI(true);
    }
    if (showLoader && window.Loaders && typeof window.Loaders.showLoader === 'function') {
      window.Loaders.showLoader({ type: 'spinner', showProgress: false, context: 'search' });
    }
    try {
      // Optimized query compatible with Archive.org API
      // Multi-phase search strategy for better relevance
      const networkFilters = getSearchNetworkFilterState();
      const uiFilters = getSearchFilterState();
      const intentInfo = parseSearchIntent(query);
      const optimizedQuery = buildOptimizedArchiveQuery(query, networkFilters, intentInfo);
      const encodedQuery = encodeURIComponent(optimizedQuery);
      const sortParam = getArchiveSortParam(intentInfo);
      const resultsPerPage = getSearchConfigNumber('resultsPerPage', SEARCH_DEFAULTS.resultsPerPage);
      const timeout = getSearchConfigNumber('timeout', SEARCH_DEFAULTS.timeout);
      // Include fields needed for client-side sorting (popularidad/fecha) without extra fetch.
      const url = `https://archive.org/advancedsearch.php?q=${encodedQuery}&fl[]=identifier,title,creator,description,downloads,addeddate,year,imagecount,collection,mediatype&rows=${resultsPerPage}&page=${page + 1}&output=json${sortParam}`;

      debugSearch('request', {
        query: normalizedQuery,
        page,
        cacheKey,
        filters: networkFilters,
        uiFilters,
        intent: intentInfo,
        serverSort: sortParam,
        optimizedQueryPreview: String(optimizedQuery || '').slice(0, 240)
      });

      const { response, usedProxy } = await fetchArchiveAdvancedSearchWithFallback(url, {
        signal,
        timeout,
        headers: {
          'Accept': 'application/json'
        }
      });
      if (!(response && response.ok)) throw new Error('Network error');
      const data = await response.json();
      const results = (data.response && data.response.docs) ? data.response.docs : [];

      debugSearch('response', {
        query: normalizedQuery,
        page,
        hits: results.length,
        numFound: (data.response && typeof data.response.numFound === 'number') ? data.response.numFound : null,
        usedRelaxed: false,
        usedProxy
      });

      // CA2: if there are no hits, try a relaxed query (tokens OR across key fields).
      // This only runs on the first page to avoid doubling network cost on infinite scroll.
      let effectiveResults = results;
      let effectiveEncoded = encodedQuery;
      let effectiveSortParam = sortParam;
      if (page === 0 && effectiveResults.length === 0) {
        try {
          const relaxedQuery = buildRelaxedArchiveQuery(query, networkFilters, intentInfo);
          const relaxedEncoded = encodeURIComponent(relaxedQuery);
          const relaxedUrl = `https://archive.org/advancedsearch.php?q=${relaxedEncoded}&fl[]=identifier,title,creator,description,downloads,addeddate,year,imagecount,collection,mediatype&rows=${resultsPerPage}&page=1&output=json${sortParam}`;
          debugSearch('relaxed_attempt', {
            query: normalizedQuery,
            relaxedQueryPreview: String(relaxedQuery || '').slice(0, 240)
          });
          const relaxedAttempt = await fetchArchiveAdvancedSearchWithFallback(relaxedUrl, { signal, timeout, headers: { 'Accept': 'application/json' } });
          const relaxedResp = relaxedAttempt && relaxedAttempt.response;
          if (relaxedResp && relaxedResp.ok) {
            const relaxedData = await relaxedResp.json();
            const relaxedDocs = (relaxedData.response && relaxedData.response.docs) ? relaxedData.response.docs : [];
            if (relaxedDocs.length > 0) {
              effectiveResults = relaxedDocs;
              effectiveEncoded = relaxedEncoded;
              debugSearch('relaxed_used', {
                query: normalizedQuery,
                hits: relaxedDocs.length,
                numFound: (relaxedData.response && typeof relaxedData.response.numFound === 'number') ? relaxedData.response.numFound : null,
                usedProxy: Boolean(relaxedAttempt && relaxedAttempt.usedProxy)
              });
              // Prefer total from relaxed query if we fell back.
              if (relaxedData.response && typeof relaxedData.response.numFound === 'number') {
                data.response = data.response || {};
                data.response.numFound = relaxedData.response.numFound;
              }
            } else {
              debugSearch('relaxed_nohits', { query: normalizedQuery });
            }
          }
        } catch {
          // best-effort: if relaxed fails, continue with empty results
          debugSearch('relaxed_error', { query: normalizedQuery });
        }
      }

      // Post-process results for improved relevance in client
      let processedResults = effectiveResults.map(item => ({
        identifier: item.identifier,
        title: item.title || 'Untitled',
        creator: item.creator || 'Unknown',
        description: item.description || '', // Ensure description is included
        mediatype: item.mediatype || null,
        collection: item.collection || null,
        downloads: (() => {
          const n = typeof item.downloads === 'number' ? item.downloads : parseFloat(item.downloads);
          return Number.isFinite(n) ? n : null;
        })(),
        addeddate: item.addeddate || null,
        year: (() => {
          const n = typeof item.year === 'number' ? item.year : parseInt(item.year, 10);
          return Number.isFinite(n) ? n : null;
        })(),
        imagecount: (() => {
          const n = typeof item.imagecount === 'number' ? item.imagecount : parseInt(item.imagecount, 10);
          return Number.isFinite(n) ? n : 0;
        })(),
        // Heuristic: if Archive reports images, prefer it over generic placeholder covers.
        // (Archive can still generate thumbs, but imagecount=0 is a strong signal of default cover.)
        hasNonDefaultCover: (() => {
          const n = typeof item.imagecount === 'number' ? item.imagecount : parseInt(item.imagecount, 10);
          return Number.isFinite(n) && n > 0;
        })(),
        // Heuristic: mark explicit "track list" items to be rendered as singles
        isTrackList: (() => {
          // NOTE: Descriptions for real albums commonly include a "Tracklist" section.
          // To avoid false positives, we only classify as track-list when the TITLE itself
          // is essentially just "tracklist" / "lista de canciones".
          const t = normalizeString(item.title || '').trim();
          if (!t) return false;

          const re = /^(track\s*list|tracklist|track-list|lista\s+de\s+(temas|canciones))\b/;
          const match = t.match(re);
          if (!match) return false;

          const remainder = t.slice(match[0].length);
          const remainderClean = remainder.replace(/[\s\-–—:]+/g, '');
          return remainderClean.length === 0;
        })(),
        isAlbum: null,
        trackCount: null,
        relevanceScore: calculateRelevanceScore(item, query, { intentInfo, filters: uiFilters })
      }));
      // Sort by calculated relevance score (if many results)
      if (processedResults.length > 1) {
        processedResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
      }

      // If we got results but they look low-quality, the ranking can feel "off".
      // In those cases (page 0 only), retry once using popularity ordering from Archive.
      const qTokensForQuality = tokenizeNormalized(normalizeString(normalizedQuery));
      const intentKind = String((intentInfo && intentInfo.intent) ? intentInfo.intent : 'unknown');
      let directMatchCount = countDirectMatches(processedResults, normalizedQuery);
      const minCoverageStrong = (intentKind === 'title')
        ? (qTokensForQuality.length >= 4 ? 0.78 : 0.88)
        : (intentKind === 'mixed')
          ? (qTokensForQuality.length >= 4 ? 0.72 : 0.82)
          : (qTokensForQuality.length >= 4 ? 0.70 : 0.80);
      let strongTokenMatchCount = countStrongTokenMatches(processedResults, normalizedQuery, { minCoverage: minCoverageStrong });
      let similarOnly = processedResults.length > 0 && directMatchCount === 0 && strongTokenMatchCount === 0;

      let qualityMetrics = null;
      const isLowQualityTop = (() => {
        try {
          // Heuristic: if the top results have very low scores AND low token coverage,
          // relevance ranking likely failed. Keep conservative to avoid extra network calls.
          if (!Array.isArray(processedResults) || processedResults.length < 4) return false;
          if (!Array.isArray(qTokensForQuality) || qTokensForQuality.length === 0) return false;
          if (strongTokenMatchCount > 0) return false;

          const topN = Math.min(5, processedResults.length);
          let sum = 0;
          let covSum = 0;
          for (let i = 0; i < topN; i++) {
            const s = processedResults[i] && typeof processedResults[i].relevanceScore === 'number'
              ? processedResults[i].relevanceScore
              : 0;
            sum += s;
            covSum += computeTokenCoverageForResult(processedResults[i], qTokensForQuality);
          }
          const avg = sum / Math.max(1, topN);
          const avgCov = covSum / Math.max(1, topN);

          const tlen = qTokensForQuality.length;
          let scoreThreshold = tlen <= 2 ? 3.75 : tlen <= 4 ? 4.75 : 5.75;
          let covThreshold = tlen <= 2 ? 0.34 : tlen <= 4 ? 0.38 : 0.42;

          // For title/mixed searches, be stricter: better to keep relevance than to jump
          // to popularity unless we're confident the ranking is poor.
          if (intentKind === 'title') {
            scoreThreshold += 0.75;
            covThreshold += 0.06;
          } else if (intentKind === 'mixed') {
            scoreThreshold += 0.35;
            covThreshold += 0.04;
          }

          qualityMetrics = {
            topN,
            avg,
            avgCov,
            tlen,
            scoreThreshold,
            covThreshold
          };

          return avg < scoreThreshold && avgCov < covThreshold;
        } catch {
          return false;
        }
      })();

      debugSearch('quality', {
        query: normalizedQuery,
        intentKind,
        qTokens: qTokensForQuality,
        minCoverageStrong,
        directMatchCount,
        strongTokenMatchCount,
        similarOnly,
        effectiveSortParam,
        ...(qualityMetrics || {})
      });

      debugSearch('retry_check', {
        query: normalizedQuery,
        page,
        willRetry: Boolean(page === 0 && (similarOnly || isLowQualityTop) && effectiveSortParam === ''),
        similarOnly,
        isLowQualityTop,
        effectiveSortParam
      });

      if (page === 0 && (similarOnly || isLowQualityTop) && effectiveSortParam === '') {
        try {
          const retrySort = '&sort[]=downloads+desc';
          const retryUrl = `https://archive.org/advancedsearch.php?q=${effectiveEncoded}&fl[]=identifier,title,creator,description,downloads,addeddate,year,imagecount,collection,mediatype&rows=${resultsPerPage}&page=1&output=json${retrySort}`;
          const retryAttempt = await fetchArchiveAdvancedSearchWithFallback(retryUrl, { signal, timeout, headers: { 'Accept': 'application/json' } });
          const retryResp = retryAttempt && retryAttempt.response;
          if (retryResp && retryResp.ok) {
            const retryData = await retryResp.json();
            const retryDocs = (retryData.response && retryData.response.docs) ? retryData.response.docs : [];

            debugSearch('retry_response', {
              query: normalizedQuery,
              hits: retryDocs.length,
              numFound: (retryData.response && typeof retryData.response.numFound === 'number') ? retryData.response.numFound : null
            });

            if (retryDocs.length > 0) {
              processedResults = retryDocs.map(item => ({
                identifier: item.identifier,
                title: item.title || 'Untitled',
                creator: item.creator || 'Unknown',
                description: item.description || '',
                mediatype: item.mediatype || null,
                collection: item.collection || null,
                downloads: (() => {
                  const n = typeof item.downloads === 'number' ? item.downloads : parseFloat(item.downloads);
                  return Number.isFinite(n) ? n : null;
                })(),
                addeddate: item.addeddate || null,
                year: (() => {
                  const n = typeof item.year === 'number' ? item.year : parseInt(item.year, 10);
                  return Number.isFinite(n) ? n : null;
                })(),
                imagecount: (() => {
                  const n = typeof item.imagecount === 'number' ? item.imagecount : parseInt(item.imagecount, 10);
                  return Number.isFinite(n) ? n : 0;
                })(),
                hasNonDefaultCover: (() => {
                  const n = typeof item.imagecount === 'number' ? item.imagecount : parseInt(item.imagecount, 10);
                  return Number.isFinite(n) && n > 0;
                })(),
                isTrackList: (() => {
                  const t = normalizeString(item.title || '').trim();
                  if (!t) return false;
                  const re = /^(track\s*list|tracklist|track-list|lista\s+de\s+(temas|canciones))\b/;
                  const match = t.match(re);
                  if (!match) return false;
                  const remainder = t.slice(match[0].length);
                  const remainderClean = remainder.replace(/[\s\-–—:]+/g, '');
                  return remainderClean.length === 0;
                })(),
                isAlbum: null,
                trackCount: null,
                relevanceScore: calculateRelevanceScore(item, query, { intentInfo, filters: uiFilters })
              }));
              if (processedResults.length > 1) {
                processedResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
              }

              // Update totals if we swapped to retry results.
              if (retryData.response && typeof retryData.response.numFound === 'number') {
                data.response = data.response || {};
                data.response.numFound = retryData.response.numFound;
              }
              directMatchCount = countDirectMatches(processedResults, normalizedQuery);
              strongTokenMatchCount = countStrongTokenMatches(processedResults, normalizedQuery, { minCoverage: minCoverageStrong });
              similarOnly = processedResults.length > 0 && directMatchCount === 0 && strongTokenMatchCount === 0;

              debugSearch('retry_applied', {
                query: normalizedQuery,
                directMatchCount,
                strongTokenMatchCount,
                similarOnly,
                topIdentifiers: processedResults.slice(0, 3).map(r => r && r.identifier).filter(Boolean)
              });
            }
          }
        } catch {
          // best-effort
          debugSearch('retry_error', { query: normalizedQuery });
        }
      }
      const total = (data.response && data.response.numFound) ? data.response.numFound : 0;
      const hasMore = (typeof total === 'number' && isFinite(total) && total > 0)
        ? ((page + 1) * resultsPerPage) < total
        : (effectiveResults.length === resultsPerPage);

      // directMatchCount/similarOnly already computed (may reflect retry)

      if (deferMetadata) {
        const fastResult = {
          results: processedResults,
          hasMore,
          total,
          deferredMetadata: true,
          similarOnly
        };
        if (window.enhancedCache) window.enhancedCache.set('search', cacheKey, fastResult);
        // Enrich in idle time so first paint isn't blocked.
        if (scheduleEnrichment) {
          scheduleSearchPageEnrichment({
            cacheKey,
            normalizedQuery,
            page,
            processedResults,
            hasMore,
            total,
            priority: enrichmentPriority
          });
        }
        return fastResult;
      }

      // Full (blocking) enrichment: filter non-playables and compute track counts.
      const enrichedResults = await enrichSearchResultsWithMetadata(processedResults, normalizedQuery, { signal });
      const searchResult = { results: enrichedResults, hasMore, total, deferredMetadata: false, similarOnly };
      if (window.enhancedCache) window.enhancedCache.set('search', cacheKey, searchResult);
      return searchResult;
    } catch (error) {
      // If the user typed a new query, the previous one is expected to abort.
      if (error && (error.name === 'AbortError' || String(error).includes('AbortError'))) {
        logSearch('Search aborted', 'debug', 'NETWORK');
        return { results: [], hasMore: false };
      }
      logSearch(error, 'error', 'NETWORK');
      // Fallback: try simple query if optimized fails
      try {
        const networkFilters = getSearchNetworkFilterState();
        const uiFilters = getSearchFilterState();
        const intentInfoFallback = parseSearchIntent(query);
        const sortParamFallback = getArchiveSortParam(intentInfoFallback);
        const simpleQuery = encodeURIComponent(`(${String(query || '').trim()}) AND ${getSearchFilterClauseParts(networkFilters).map(p => `(${p})`).join(' AND ')}`);
        const resultsPerPage = getSearchConfigNumber('resultsPerPage', SEARCH_DEFAULTS.resultsPerPage);
        const timeout = getSearchConfigNumber('timeout', SEARCH_DEFAULTS.timeout);
        const fallbackUrl = `https://archive.org/advancedsearch.php?q=${simpleQuery}&fl[]=identifier,title,creator,description,downloads,addeddate,year,imagecount,collection,mediatype&rows=${resultsPerPage}&page=${page + 1}&output=json${sortParamFallback}`;
        const fallbackAttempt = await fetchArchiveAdvancedSearchWithFallback(fallbackUrl, {
          signal,
          timeout
        });
        const fallbackResponse = fallbackAttempt && fallbackAttempt.response;
        if (fallbackResponse && fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json();
          const fallbackResults = (fallbackData.response && fallbackData.response.docs) ? fallbackData.response.docs : [];
          const processedFallbackResults = fallbackResults.map(item => ({
            identifier: item.identifier,
            title: item.title || 'Untitled',
            creator: item.creator || 'Unknown',
            description: item.description || '',
            mediatype: item.mediatype || null,
            collection: item.collection || null,
            downloads: (() => {
              const n = typeof item.downloads === 'number' ? item.downloads : parseFloat(item.downloads);
              return Number.isFinite(n) ? n : null;
            })(),
            addeddate: item.addeddate || null,
            year: (() => {
              const n = typeof item.year === 'number' ? item.year : parseInt(item.year, 10);
              return Number.isFinite(n) ? n : null;
            })(),
            imagecount: (() => {
              const n = typeof item.imagecount === 'number' ? item.imagecount : parseInt(item.imagecount, 10);
              return Number.isFinite(n) ? n : 0;
            })(),
            hasNonDefaultCover: (() => {
              const n = typeof item.imagecount === 'number' ? item.imagecount : parseInt(item.imagecount, 10);
              return Number.isFinite(n) && n > 0;
            })(),
            isAlbum: null,
            trackCount: null,
            relevanceScore: calculateRelevanceScore(item, query, { filters: uiFilters })
          }));
          if (processedFallbackResults.length > 1) {
            processedFallbackResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
          }
          const total = (fallbackData.response && fallbackData.response.numFound) ? fallbackData.response.numFound : 0;
          const hasMore = (typeof total === 'number' && isFinite(total) && total > 0)
            ? ((page + 1) * resultsPerPage) < total
            : (fallbackResults.length === resultsPerPage);

          const directMatchCount = countDirectMatches(processedFallbackResults, normalizedQuery);
          const similarOnly = processedFallbackResults.length > 0 && directMatchCount === 0;

          if (deferMetadata) {
            const fastResult = {
              results: processedFallbackResults,
              hasMore,
              total,
              deferredMetadata: true,
              similarOnly
            };
            if (window.enhancedCache) window.enhancedCache.set('search', cacheKey, fastResult);
            if (scheduleEnrichment) {
              scheduleSearchPageEnrichment({
                cacheKey,
                normalizedQuery,
                page,
                processedResults: processedFallbackResults,
                hasMore,
                total,
                priority: enrichmentPriority
              });
            }
            return fastResult;
          }

          const enrichedFallback = await enrichSearchResultsWithMetadata(processedFallbackResults, normalizedQuery, { signal });
          const searchResult = { results: enrichedFallback, hasMore, total, deferredMetadata: false, similarOnly };
          if (window.enhancedCache) window.enhancedCache.set('search', cacheKey, searchResult);
          return searchResult;
        }
      } catch (fallbackError) {
        if (fallbackError && (fallbackError.name === 'AbortError' || String(fallbackError).includes('AbortError'))) {
          logSearch('Search aborted', 'debug', 'NETWORK');
          return { results: [], hasMore: false };
        }
        logSearch(fallbackError, 'error', 'NETWORK');
      }
      if (activateUI) {
        setSearchErrorMessage('Error in search. Try other terms.');
      }
      return { results: [], hasMore: false };
    } finally {
      if (showLoader && window.Loaders && typeof window.Loaders.hideLoader === 'function') {
        window.Loaders.hideLoader();
      }
      // Clean up controller after search completes or is aborted (foreground-only)
      if (ownsController && searchControllers.currentSearch) {
        searchControllers.currentSearch = null;
      }
    }
  })();

  searchInFlight.pages.set(cacheKey, searchPromise);
  try {
    return await searchPromise;
  } finally {
    searchInFlight.pages.delete(cacheKey);
  }
}

// Auxiliary function to calculate relevance in client
function calculateRelevanceScore(item, query, { intentInfo, filters } = {}) {
  const qRaw = String(query || '');
  const qNorm = normalizeString(qRaw);
  if (!qNorm) return 0;

  const titleNorm = normalizeString(item.title || '');
  const creatorNorm = normalizeString(item.creator || '');
  const descriptionNorm = normalizeString(item.description || '');

  const intent = intentInfo || parseSearchIntent(qRaw);
  const mult = { title: 1.0, creator: 1.0, description: 1.0 };

  const scoreWhole = (queryNorm, weights) => {
    const tokens = tokenizeNormalized(queryNorm);
    const hasTokens = tokens.length > 0;
    let score = 0;

    // Phrase-like matches
    if (titleNorm === queryNorm) score += (weights.titleExact || 0) * mult.title;
    if (creatorNorm === queryNorm) score += (weights.creatorExact || 0) * mult.creator;
    if (titleNorm.startsWith(queryNorm)) score += (weights.titleStartsWith || 0) * mult.title;
    if (titleNorm.includes(queryNorm)) score += (weights.titleIncludes || 0) * mult.title;
    if (creatorNorm.startsWith(queryNorm)) score += (weights.creatorStartsWith || 0) * mult.creator;
    if (creatorNorm.includes(queryNorm)) score += (weights.creatorIncludes || 0) * mult.creator;
    if (descriptionNorm.includes(queryNorm)) score += (weights.descriptionIncludes || 0) * mult.description;
    if (titleNorm.includes(queryNorm) && creatorNorm.includes(queryNorm)) score += (weights.titleCreatorBothIncludes || 0);

    if (hasTokens) {
      let titleHits = 0;
      let creatorHits = 0;
      let descHits = 0;
      for (const tok of tokens) {
        if (!tok) continue;
        if (titleNorm.includes(tok)) titleHits++;
        if (creatorNorm.includes(tok)) creatorHits++;
        if (descriptionNorm.includes(tok)) descHits++;

        if (titleNorm.startsWith(tok)) score += (weights.titleTokenStartsWith || 0) * mult.title;
        if (creatorNorm.startsWith(tok)) score += (weights.creatorTokenStartsWith || 0) * mult.creator;
      }
      score += titleHits * (weights.titleTokenHit || 0) * mult.title;
      score += creatorHits * (weights.creatorTokenHit || 0) * mult.creator;
      score += descHits * (weights.descriptionTokenHit || 0) * mult.description;

      const coverage = Math.min(1, (titleHits + creatorHits + descHits) / Math.max(1, tokens.length));
      score += coverage * (weights.coverageBonus || 0);
      if (weights.creatorAllTokensBonus && creatorHits >= tokens.length) score += weights.creatorAllTokensBonus;
      if (weights.titleAllTokensBonus && titleHits >= tokens.length) score += weights.titleAllTokensBonus;
    }

    // Lightweight typo similarity (only if we didn't get any direct signal)
    if (score < 2) {
      if (isTypoSimilar(queryNorm, titleNorm)) score += (weights.titleTypo || 0) * mult.title;
      if (isTypoSimilar(queryNorm, creatorNorm)) score += (weights.creatorTypo || 0) * mult.creator;
      if (hasTokens) {
        const bestTitle = bestTokenTypoBoost(tokens, titleNorm);
        const bestCreator = bestTokenTypoBoost(tokens, creatorNorm);
        score += bestTitle * (weights.titleTokenTypo || 0) * mult.title;
        score += bestCreator * (weights.creatorTokenTypo || 0) * mult.creator;
      }
    }
    return score;
  };

  const weightsBaseline = {
    titleExact: 20,
    creatorExact: 14,
    titleStartsWith: 10,
    titleIncludes: 10,
    creatorStartsWith: 0,
    creatorIncludes: 6,
    descriptionIncludes: 2,
    titleCreatorBothIncludes: 4,
    titleTokenStartsWith: 1.5,
    creatorTokenStartsWith: 0,
    titleTokenHit: 4,
    creatorTokenHit: 2.5,
    descriptionTokenHit: 0.75,
    coverageBonus: 6,
    titleTypo: 2,
    creatorTypo: 1.5,
    titleTokenTypo: 1,
    creatorTokenTypo: 0.75
  };

  const weightsArtist = {
    titleExact: 14,
    creatorExact: 26,
    titleStartsWith: 10,
    titleIncludes: 8,
    creatorStartsWith: 18,
    creatorIncludes: 12,
    descriptionIncludes: 2,
    titleCreatorBothIncludes: 4,
    titleTokenStartsWith: 1.0,
    creatorTokenStartsWith: 1.0,
    titleTokenHit: 3.0,
    creatorTokenHit: 5.0,
    descriptionTokenHit: 0.5,
    coverageBonus: 6,
    creatorAllTokensBonus: 10,
    titleTypo: 2,
    creatorTypo: 2,
    titleTokenTypo: 1,
    creatorTokenTypo: 1
  };

  const weightsTitle = {
    titleExact: 26,
    creatorExact: 10,
    titleStartsWith: 18,
    titleIncludes: 12,
    creatorStartsWith: 0,
    creatorIncludes: 6,
    descriptionIncludes: 3,
    titleCreatorBothIncludes: 2,
    titleTokenStartsWith: 1.5,
    creatorTokenStartsWith: 0,
    titleTokenHit: 5.0,
    creatorTokenHit: 2.5,
    descriptionTokenHit: 1.0,
    coverageBonus: 6,
    titleAllTokensBonus: 10,
    titleTypo: 2,
    creatorTypo: 1.5,
    titleTokenTypo: 1,
    creatorTokenTypo: 0.75
  };

  let score;

  if (intent && intent.intent === 'mixed' && intent.artist && intent.title) {
    const aNorm = normalizeString(intent.artist);
    const tNorm = normalizeString(intent.title);
    const scoreArtistPart = scoreWhole(aNorm, weightsArtist);
    const scoreTitlePart = scoreWhole(tNorm, weightsTitle);
    score = scoreArtistPart + scoreTitlePart;
    // Synergy bonus: reward results that plausibly match both sides.
    if (scoreArtistPart >= 8 && scoreTitlePart >= 10) score += 18;
    else if (scoreArtistPart >= 10 && scoreTitlePart >= 4) score += 6;
  } else if (intent && intent.intent === 'title') {
    score = scoreWhole(qNorm, weightsTitle);
  } else if (intent && intent.intent === 'artist') {
    score = scoreWhole(qNorm, weightsArtist);
    // Penalize "Various" creator for artist intent.
    if (creatorNorm === 'various' || creatorNorm === 'various artists') score -= 8;
  } else {
    score = scoreWhole(qNorm, weightsBaseline);
  }

  // Prefer items that likely have a real cover (not Archive's generic placeholder).
  try {
    const ic = (item && item.imagecount != null)
      ? (typeof item.imagecount === 'number' ? item.imagecount : parseInt(item.imagecount, 10))
      : 0;
    if (Number.isFinite(ic) && ic > 0) score += 1.25;
  } catch {}

  // Tiny tie-breakers: keep stable ordering for obviously related content
  try {
    if (item && item.downloads != null) {
      const d = typeof item.downloads === 'number' ? item.downloads : parseFloat(item.downloads);
      if (Number.isFinite(d) && d > 0) score += Math.min(2, Math.log10(d + 1) / 2);
    }
  } catch {}

  // Music-first: podcasts are extremely noisy for artist queries (incidental mentions in descriptions).
  // Keep them accessible, but push them down unless the user explicitly searched for podcasts.
  try {
    const queryIsPodcasty = /\bpodcast(s)?\b/i.test(qRaw);
    if (!queryIsPodcasty) {
      const cRaw = item ? item.collection : null;
      const cols = Array.isArray(cRaw)
        ? cRaw.map(x => String(x || '').toLowerCase()).filter(Boolean)
        : (cRaw ? [String(cRaw).toLowerCase()].filter(Boolean) : []);
      const isPodcastCollection = cols.some(c => c === 'podcasts' || c.startsWith('podcasts_'));
      if (isPodcastCollection) score -= 10;
    }
  } catch {}

  return score;
}

// Safe function to convert values to string and lowercase
function safeToLowerCase(value) {
  if (typeof value === 'string') {
    return value.toLowerCase();
  }
  if (value == null) {
    return '';
  }
  // Convert array or object to string if necessary
  return String(value).toLowerCase();
}

function normalizeString(value) {
  const s = typeof value === 'string' ? value : String(value ?? '');
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function tokenizeNormalized(norm) {
  const s = String(norm || '').trim();
  if (!s) return [];
  // Keep simple and fast: split by whitespace and common separators.
  const raw = s.split(/[\s\-_/.,;:()\[\]{}"'`~!@#$%^&*+=?|\\]+/g).filter(Boolean);
  // Remove very short tokens that add noise.
  const tokens = raw.filter(t => t.length >= 2);
  // Cap to avoid worst-case O(n*m) work for long queries.
  return tokens.slice(0, 8);
}

function bestTokenTypoBoost(tokens, textNorm) {
  try {
    if (!Array.isArray(tokens) || tokens.length === 0) return 0;
    const words = tokenizeNormalized(textNorm);
    if (words.length === 0) return 0;
    let boost = 0;
    for (const tok of tokens) {
      if (!tok) continue;
      // Only compare against a small subset for perf.
      const sample = words.length > 16 ? words.slice(0, 16) : words;
      for (const w of sample) {
        if (w === tok) { boost = Math.max(boost, 1); break; }
        if (Math.abs(w.length - tok.length) > 2) continue;
        if (damerauLevenshtein(tok, w) <= getTypoThreshold(tok.length)) {
          boost = Math.max(boost, 0.75);
          break;
        }
      }
      if (boost >= 1) break;
    }
    return boost;
  } catch {
    return 0;
  }
}

function countDirectMatches(processedResults, rawQuery) {
  try {
    const q = normalizeString(rawQuery);
    if (!q) return 0;
    let count = 0;
    for (const r of (processedResults || [])) {
      const t = normalizeString(r && r.title ? r.title : '');
      const c = normalizeString(r && r.creator ? r.creator : '');
      if (t.includes(q) || c.includes(q)) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

function computeTokenCoverageForResult(result, tokens, { includeDescription = true } = {}) {
  try {
    const toks = Array.isArray(tokens) ? tokens : [];
    if (toks.length === 0) return 0;
    const t = normalizeString(result && result.title ? result.title : '');
    const c = normalizeString(result && result.creator ? result.creator : '');
    const d = includeDescription ? normalizeString(result && result.description ? result.description : '') : '';
    let hits = 0;
    for (const tok of toks) {
      if (!tok) continue;
      if (t.includes(tok) || c.includes(tok) || (includeDescription && d.includes(tok))) hits++;
    }
    return hits / Math.max(1, toks.length);
  } catch {
    return 0;
  }
}

function countStrongTokenMatches(processedResults, rawQuery, { minCoverage = 0.8 } = {}) {
  try {
    const q = normalizeString(rawQuery);
    const tokens = tokenizeNormalized(q);
    if (tokens.length === 0) return 0;
    let count = 0;
    for (const r of (processedResults || [])) {
      const cov = computeTokenCoverageForResult(r, tokens);
      if (cov >= minCoverage) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

function buildRelaxedArchiveQuery(query, filters, intentInfo) {
  const raw = String(query || '');
  const q = normalizeString(raw);
  const intent = intentInfo || parseSearchIntent(raw);
  const tokens = tokenizeNormalized(q);
  if (tokens.length === 0) {
    const parts = getSearchFilterClauseParts(filters);
    return `(${query}) AND ${parts.map(p => `(${p})`).join(' AND ')}`;
  }
  const escapeToken = (t) => {
    // Very small escaping to reduce syntax errors; Archive/Solr is permissive.
    return String(t).replace(/[()]/g, ' ');
  };

  const buildGroup = (groupTokens, mode) => {
    const toks = (groupTokens || []).map(escapeToken).filter(Boolean);
    if (toks.length === 0) return '';
    if (mode === 'artist') {
      return toks.map(tok => `(creator:(${tok}) OR title:(${tok}))`).join(' OR ');
    }
    if (mode === 'title') {
      return toks.map(tok => `(title:(${tok}) OR description:(${tok}))`).join(' OR ');
    }
    return toks.map(tok => `(title:(${tok}) OR creator:(${tok}) OR description:(${tok}))`).join(' OR ');
  };

  let clauseExpr = '';
  if (intent && intent.intent === 'mixed' && intent.artist && intent.title) {
    const aTokens = tokenizeNormalized(normalizeString(intent.artist));
    const tTokens = tokenizeNormalized(normalizeString(intent.title));
    const aGroup = buildGroup(aTokens, 'artist');
    const tGroup = buildGroup(tTokens, 'title');
    const anyGroup = buildGroup(tokens, 'any');
    if (aGroup && tGroup) {
      clauseExpr = `(((${aGroup}) AND (${tGroup})) OR (${aGroup}) OR (${tGroup}) OR (${anyGroup}))`;
    } else {
      clauseExpr = `(${anyGroup})`;
    }
  } else if (intent && intent.intent === 'artist') {
    clauseExpr = `(${buildGroup(tokens, 'artist')})`;
  } else if (intent && intent.intent === 'title') {
    clauseExpr = `(${buildGroup(tokens, 'title')})`;
  } else {
    clauseExpr = `(${buildGroup(tokens, 'any')})`;
  }

  const parts = getSearchFilterClauseParts(filters);
  return `${clauseExpr} AND ${parts.map(p => `(${p})`).join(' AND ')}`;
}

function damerauLevenshtein(a, b) {
  const alen = a.length;
  const blen = b.length;
  if (alen === 0) return blen;
  if (blen === 0) return alen;
  const INF = alen + blen;
  const da = new Map();
  const score = Array.from({ length: alen + 2 }, () => new Array(blen + 2).fill(0));
  score[0][0] = INF;
  for (let i = 0; i <= alen; i++) {
    score[i + 1][1] = i;
    score[i + 1][0] = INF;
  }
  for (let j = 0; j <= blen; j++) {
    score[1][j + 1] = j;
    score[0][j + 1] = INF;
  }
  for (let i = 1; i <= alen; i++) {
    let db = 0;
    for (let j = 1; j <= blen; j++) {
      const i1 = (da.get(b[j - 1]) ?? 0);
      const j1 = db;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      if (cost === 0) db = j;
      score[i + 1][j + 1] = Math.min(
        score[i][j] + cost,
        score[i + 1][j] + 1,
        score[i][j + 1] + 1,
        score[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1)
      );
    }
    da.set(a[i - 1], i);
  }
  return score[alen + 1][blen + 1];
}

function getTypoThreshold(len) {
  if (len <= 5) return 1;
  if (len <= 10) return 2;
  return Math.max(2, Math.floor(len * 0.1));
}

function isTypoSimilar(queryNorm, textNorm) {
  const threshold = getTypoThreshold(queryNorm.length);
  const dist = damerauLevenshtein(queryNorm, textNorm);
  return dist <= threshold;
}

function prioritizeResults(items, query) {
  const q = normalizeString(query);
  const hasExact = (item) => {
    const t = normalizeString(item.title || '');
    const c = normalizeString(item.creator || '');
    return t.includes(q) || c.includes(q);
  };
  const hasFuzzy = (item) => {
    const t = normalizeString(item.title || '');
    const c = normalizeString(item.creator || '');
    return isTypoSimilar(q, t) || isTypoSimilar(q, c);
  };
  items.sort((a, b) => {
    // Always push known-unplayable items to the bottom.
    const aUn = (a && (a.unplayable || a.trackCount === 0)) ? 1 : 0;
    const bUn = (b && (b.unplayable || b.trackCount === 0)) ? 1 : 0;
    if (aUn !== bUn) return aUn - bUn;

    // Type rank respecting requested priority:
    // 1) Single exact; 2) Album exact; 3) Track list exact (rendered as single);
    // Then fuzzy in same order; finally relevance.
    const typeRank = (item) => {
      if (item.isTrackList) return 2; // rank after album
      if ((item.trackCount === 1) || (item.isAlbum === false)) return 0; // single
      return 1; // album
    };
    const aType = typeRank(a);
    const bType = typeRank(b);
    if (aType !== bType) return aType - bType;
    const aExact = hasExact(a) ? 1 : 0;
    const bExact = hasExact(b) ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    const aFuzzy = hasFuzzy(a) ? 1 : 0;
    const bFuzzy = hasFuzzy(b) ? 1 : 0;
    if (aFuzzy !== bFuzzy) return bFuzzy - aFuzzy;

    // Prefer results whose cover isn't the generic Archive placeholder.
    const aCover = (a && a.hasNonDefaultCover) ? 1 : 0;
    const bCover = (b && b.hasNonDefaultCover) ? 1 : 0;
    if (aCover !== bCover) return bCover - aCover;

    const ar = typeof a.relevanceScore === 'number' ? a.relevanceScore : 0;
    const br = typeof b.relevanceScore === 'number' ? b.relevanceScore : 0;
    return br - ar;
  });
}

async function fetchOptimizedPlayableFiles(identifier, options = {}) {
  const cached = window.enhancedCache && window.enhancedCache.get('metadata', identifier);
  if (cached) {
    return cached;
  }

  // If prefetch, don't block on in-flight; just skip
  const isPrefetch = !!(options && options.prefetch);
  const signal = options && options.signal;

  const inFlight = searchInFlight.metadata.get(identifier);
  if (inFlight) {
    return isPrefetch ? cached || [] : inFlight;
  }

  const metadataPromise = (async () => {
    // If there's already a controller for this identifier, abort it and replace.
    const existingController = searchControllers.activeMetadata.get(identifier);
    if (existingController) {
      try { existingController.abort(); } catch {}
      searchControllers.activeMetadata.delete(identifier);
    }
  
    // Create AbortController for this metadata fetch
    const controller = signal ? null : new AbortController();
    if (controller) searchControllers.activeMetadata.set(identifier, controller);

    const url = `https://archive.org/metadata/${identifier}`;
    try {
      // Force longer timeout for metadata fetching
      const metadataTimeout = getSearchConfigNumber('metadataTimeout', SEARCH_DEFAULTS.metadataTimeout);
      const fetchSignal = signal || (controller ? controller.signal : undefined);
      const { response, usedProxy } = await fetchArchiveMetadataWithFallback(url, { 
        signal: fetchSignal,
        timeout: metadataTimeout,
        headers: { 'Accept': 'application/json' }
      });
      if (!(response && response.ok)) throw new Error('Error fetching metadata');
      const metadata = await response.json();
      if (!(metadata && metadata.files)) {
        throw new Error('Invalid metadata');
      }
      let mediaFiles = metadata.files.filter(file =>
        isPlayableMediaFile(file)
      );
      let audioFiles = mediaFiles.filter(file => isPlayableAudioFile(file));
      let videoFiles = mediaFiles.filter(file => isPlayableVideoFile(file));
    // Sort remaining files by format priority with network-aware sizing
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const effectiveType = connection && connection.effectiveType ? connection.effectiveType : '';
    const downlink = connection && typeof connection.downlink === 'number' ? connection.downlink : 0;
    const slowNetwork = effectiveType === '2g' || effectiveType === 'slow-2g' || downlink < 1;
    const midNetwork = effectiveType === '3g' || downlink < 5;
    const qualityTier = getNetworkQualityTierForAudio();
    const allowFlac = isWifiEthernetConnection();
    if (!allowFlac) {
      audioFiles = audioFiles.filter(file => !String(file.name || '').toLowerCase().endsWith('.flac'));
    }
    const preferMp3 = qualityTier === 'eco';
    const preferFlac = allowFlac && qualityTier === 'ultra-hd';

    // Sort video files by format priority (prefer mp4 for better compatibility)
    videoFiles.sort((a, b) => {
      const aIsMp4 = a.name.toLowerCase().endsWith('.mp4');
      const bIsMp4 = b.name.toLowerCase().endsWith('.mp4');
      const aIsWebm = a.name.toLowerCase().endsWith('.webm');
      const bIsWebm = b.name.toLowerCase().endsWith('.webm');
      const aSize = a.size || 0;
      const bSize = b.size || 0;

      // Prefer mp4 for compatibility
      if (aIsMp4 && !bIsMp4) return -1;
      if (!aIsMp4 && bIsMp4) return 1;
      
      // Then webm for quality
      if (aIsWebm && !bIsWebm) return -1;
      if (!aIsWebm && bIsWebm) return 1;
      
      // On slow networks prefer smaller files
      if (slowNetwork && aSize !== bSize) return aSize - bSize;
      
      // Finally sort by size
      return aSize - bSize;
    });

    audioFiles.sort((a, b) => {
      const aIsFlac = a.name.toLowerCase().endsWith('.flac');
      const bIsFlac = b.name.toLowerCase().endsWith('.flac');
      const aIsOgg = a.name.toLowerCase().endsWith('.ogg');
      const bIsOgg = b.name.toLowerCase().endsWith('.ogg');
      const aIsMp3 = a.name.toLowerCase().endsWith('.mp3');
      const bIsMp3 = b.name.toLowerCase().endsWith('.mp3');
      const aSize = a.size || 0;
      const bSize = b.size || 0;

      if (preferFlac) {
        if (aIsFlac && !bIsFlac) return -1;
        if (!aIsFlac && bIsFlac) return 1;
      }

      if (preferMp3) {
        if (aIsMp3 && !bIsMp3) return -1;
        if (!aIsMp3 && bIsMp3) return 1;
      }

      // On slow networks prefer the smallest payload first
      if (slowNetwork) {
        if (aSize !== bSize) return aSize - bSize;
      }

      // On mid networks bias toward smaller MP3 over larger OGG if size differs greatly
      if (midNetwork && Math.abs(aSize - bSize) > 1500000) {
        return aSize - bSize;
      }

      // Prioritize .ogg over .mp3 for quality when network is good enough
      if (!preferMp3 && !preferFlac) {
        if (aIsOgg && !bIsOgg) return -1;
        if (!aIsOgg && bIsOgg) return 1;
      }
      // Then prioritize .mp3 over other formats
      if (aIsMp3 && !bIsMp3 && !bIsOgg) return -1;
      if (!aIsMp3 && bIsMp3 && !aIsOgg) return 1;
      // Finally sort by size
      return aSize - bSize;
    });
      
      // Prefer video files if available, otherwise use audio files
      const filesToProcess = videoFiles.length > 0 ? videoFiles : audioFiles;
      const isVideo = videoFiles.length > 0;
      
      if (filesToProcess.length === 0) {
        return [];
      }
      const playableFiles = createPlayableFiles(filesToProcess, identifier, metadata, { qualityTier, allowFlac, isVideo });
      if (window.enhancedCache) window.enhancedCache.set('metadata', identifier, playableFiles);
      try {
        debugSearch('metadata_response', { identifier, usedProxy: Boolean(usedProxy), files: Array.isArray(metadata.files) ? metadata.files.length : null, isVideo });
      } catch {}
      return playableFiles;
    } catch (error) {
      if (isAbortError(error)) {
        // Expected cancellation; let caller decide if it needs to surface this.
        throw error;
      }
      logSearch(error, 'error', 'NETWORK');
      throw error;
    } finally {
      // Clean up controller after metadata fetch completes or is aborted
      searchControllers.activeMetadata.delete(identifier);
    }
  })();

  searchInFlight.metadata.set(identifier, metadataPromise);
  try {
    return await metadataPromise;
  } finally {
    searchInFlight.metadata.delete(identifier);
  }
}

// Check if file is playable audio (filter out metadata, images, archives)
function isPlayableVideoFile(file) {
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
  // Accept common video formats
  const videoFormats = ['.mp4', '.webm', '.ogv', '.ogg'];
  const isVideoFile = videoFormats.some(format =>
    file.name.toLowerCase().endsWith(format)
  );
  if (!isVideoFile) return false;
  const fileSize = file.size || 0;
  if (fileSize < 50000) return false;
  if (fileSize > 2000000000) return false; // 2GB max for videos
  return true;
}

function isPlayableAudioFile(file) {
  if (!file.name) return false;
  const FLAC_MAX_BYTES = 200 * 1024 * 1024;
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
  // Only accept .flac, .ogg and .mp3 formats (priority handled elsewhere)
  const audioFormats = ['.flac', '.ogg', '.mp3'];
  const isAudioFile = audioFormats.some(format =>
    file.name.toLowerCase().endsWith(format)
  );
  if (!isAudioFile) return false;
  const fileSize = file.size || 0;
  const isFlac = file.name.toLowerCase().endsWith('.flac');
  if (isFlac && fileSize > FLAC_MAX_BYTES) return false;
  if (fileSize < 50000) return false;
  if (fileSize > 500000000) return false;
  return true;
}

function isPlayableMediaFile(file) {
  return isPlayableAudioFile(file) || isPlayableVideoFile(file);
}

function shouldLogAudioFormatDebug() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    const debugParam = String(params.get('debug') || '').toLowerCase();
    const storedDebug = String(localStorage.getItem('resonate_debug') || '').toLowerCase();
    const storedLevel = String(localStorage.getItem('resonate_log_level') || '').toLowerCase();
    return debugParam === '1' || debugParam === 'true' || storedDebug === 'true' || storedLevel === 'debug';
  } catch {
    return false;
  }
}

function logAudioFormatSelection(tracks, { identifier, qualityTier, allowFlac } = {}) {
  if (!shouldLogAudioFormatDebug()) return;
  try {
    const counts = {};
    for (const track of tracks || []) {
      const fmt = String(track && (track.format || '')).toUpperCase() || 'UNKNOWN';
      counts[fmt] = (counts[fmt] || 0) + 1;
    }
    logSearch({
      message: 'Audio format selection',
      identifier,
      qualityTier,
      allowFlac,
      formats: counts
    }, 'debug', 'SEARCH');
  } catch {
    // best-effort
  }
}

function getNetworkQualityTierForAudio() {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'disconnected';
  } catch {}

  const connection = (typeof navigator !== 'undefined')
    ? (navigator.connection || navigator.mozConnection || navigator.webkitConnection)
    : null;

  let tier = 'standard';
  if (connection) {
    const { effectiveType, downlink, type } = connection;
    const linkType = String(type || '').toLowerCase();
    const isWifi = linkType === 'wifi' || linkType === 'ethernet';

    if (isWifi) {
      tier = 'ultra-hd';
    } else if (effectiveType === '5g' || downlink >= 20) {
      tier = 'ultra-hd';
    } else if (effectiveType === '4g' || downlink >= 5) {
      tier = 'high-quality';
    } else if (effectiveType === '3g' || downlink >= 1.5) {
      tier = 'eco';
    } else if (effectiveType === '2g' || effectiveType === 'slow-2g' || downlink > 0) {
      tier = 'eco';
    }
  }

  return tier;
}

function isWifiEthernetConnection() {
  try {
    const connection = (typeof navigator !== 'undefined')
      ? (navigator.connection || navigator.mozConnection || navigator.webkitConnection)
      : null;
    if (!connection) return false;
    const linkType = String(connection.type || '').toLowerCase();
    return linkType === 'wifi' || linkType === 'ethernet';
  } catch {
    return false;
  }
}

function createPlayableFiles(audioFiles, identifier, metadata, { qualityTier, allowFlac = true, isVideo = false } = {}) {
  let playableFiles;
  const tier = (qualityTier === 'disconnected') ? 'eco' : (qualityTier || 'standard');
  const preferMp3 = tier === 'eco';
  const preferFlac = allowFlac && tier === 'ultra-hd';
  const preferOgg = !preferMp3 && !preferFlac;

  const pickPreferred = (existing, candidate) => {
    if (!existing) return candidate;
    
    if (isVideo) {
      // For video files, prefer mp4 for compatibility
      const existingIsMp4 = existing.fileName.toLowerCase().endsWith('.mp4');
      const candidateIsMp4 = candidate.fileName.toLowerCase().endsWith('.mp4');
      if (candidateIsMp4 && !existingIsMp4) return candidate;
      if (existingIsMp4 && !candidateIsMp4) return existing;
    } else {
      // For audio files, use existing logic
      const existingIsFlac = existing.fileName.toLowerCase().endsWith('.flac');
      const candidateIsFlac = candidate.fileName.toLowerCase().endsWith('.flac');
      const existingIsOgg = existing.fileName.toLowerCase().endsWith('.ogg');
      const candidateIsOgg = candidate.fileName.toLowerCase().endsWith('.ogg');
      const existingIsMp3 = existing.fileName.toLowerCase().endsWith('.mp3');
      const candidateIsMp3 = candidate.fileName.toLowerCase().endsWith('.mp3');

      if (preferFlac) {
        if (candidateIsFlac && !existingIsFlac) return candidate;
        if (existingIsFlac && !candidateIsFlac) return existing;
      } else if (preferMp3) {
        if (candidateIsMp3 && !existingIsMp3) return candidate;
        if (existingIsMp3 && !candidateIsMp3) return existing;
      } else if (preferOgg) {
        if (candidateIsOgg && !existingIsOgg) return candidate;
        if (existingIsOgg && !candidateIsOgg) return existing;
      }
    }
    
    const existingSize = Number.isFinite(existing.fileSize) ? existing.fileSize : 0;
    const candidateSize = Number.isFinite(candidate.fileSize) ? candidate.fileSize : 0;

    if (candidateSize && existingSize) {
      return candidateSize < existingSize ? candidate : existing;
    }

    return existing;
  };
  if (audioFiles.length > 1) {
    // First create all playable files
    let allFiles = audioFiles.map((file, index) => {
      const metaRoot = (metadata && metadata.metadata) ? metadata.metadata : {};
      const trackInfo = extractTrackInfo(file, metaRoot);
      
      // Safely extract creator, handling various data types
      let creator = trackInfo.artist || metaRoot.creator || 'Unknown artist';
      if (typeof creator !== 'string') {
        // Handle cases where creator is an array or object
        if (Array.isArray(creator)) {
          creator = creator.join(', ');
        } else if (typeof creator === 'object') {
          creator = Object.values(creator).join(', ');
        } else {
          creator = String(creator);
        }
      }
      
      return {
        url: `https://archive.org/download/${identifier}/${encodeURIComponent(file.name)}`,
        title: trackInfo.title || metaRoot.title || file.name || identifier,
        creator: creator,
        description: (metaRoot && metaRoot.description) ? metaRoot.description : '',
        id: identifier,
        format: (file.name.split('.').pop() || 'mp3').toUpperCase(),
        trackNumber: trackInfo.trackNumber,
        duration: file.length || 0,
        album: metaRoot.title || identifier,
        isAlbumTrack: true,
        isVideo: isVideo,
        albumId: identifier,
        trackIndex: index,
        totalTracks: audioFiles.length,
        fileName: file.name,
        fileSize: file.size || 0
      };
    });
    // Deduplication: prefer .ogg over .mp3 for the same track based on title and artist
    const seenTracks = new Map();
    for (const file of allFiles) {
      // Create normalized key based on title and artist for better deduplication
      const titleValue = (typeof file.title === 'string' ? file.title : (file.title || ''));
      const creatorValue = (typeof file.creator === 'string' ? file.creator : (file.creator || ''));
      const normalizedTitle = String(titleValue).toLowerCase().trim().replace(/\s+/g, ' ');
      const normalizedArtist = String(creatorValue).toLowerCase().trim().replace(/\s+/g, ' ');
      // Include a stable per-track discriminator to avoid collapsing entire albums
      // when title/artist fall back to the album-level metadata.
      const tn = (typeof file.trackNumber === 'number' && isFinite(file.trackNumber) && file.trackNumber > 0)
        ? String(file.trackNumber)
        : '';
      const stem = String(file.fileName || '')
        .toLowerCase()
        .replace(/\.(mp3|ogg)$/i, '')
        .trim()
        .replace(/\s+/g, ' ');
      const trackKey = tn
        ? `${normalizedArtist}|${tn}|${normalizedTitle}`
        : `${normalizedArtist}|${stem}|${normalizedTitle}`;
      const existing = seenTracks.get(trackKey);
      if (!existing) {
        // First time seeing this track
        seenTracks.set(trackKey, file);
      } else {
        // Choose best format/size for current quality tier
        const preferred = pickPreferred(existing, file);
        seenTracks.set(trackKey, preferred);
      }
    }
    playableFiles = Array.from(seenTracks.values());
    // Sort by track number or title
    playableFiles.sort((a, b) => {
      if (a.trackNumber !== undefined && b.trackNumber !== undefined) {
        return a.trackNumber - b.trackNumber;
      }
      return (a.title || '').localeCompare(b.title || '');
    });
    // Update trackIndex and totalTracks after deduplication
    playableFiles.forEach((file, index) => {
      file.trackIndex = index;
      file.totalTracks = playableFiles.length;
    });
  } else {
    const audioFile = audioFiles[0];
    const metaRoot = (metadata && metadata.metadata) ? metadata.metadata : {};
    const trackInfo = extractTrackInfo(audioFile, metaRoot);
    
    // Safely extract creator, handling various data types
    let creator = trackInfo.artist || metaRoot.creator || 'Unknown artist';
    if (typeof creator !== 'string') {
      // Handle cases where creator is an array or object
      if (Array.isArray(creator)) {
        creator = creator.join(', ');
      } else if (typeof creator === 'object') {
        creator = Object.values(creator).join(', ');
      } else {
        creator = String(creator);
      }
    }
    
    playableFiles = [{
      url: `https://archive.org/download/${identifier}/${encodeURIComponent(audioFile.name)}`,
      title: trackInfo.title || metaRoot.title || audioFile.name || identifier,
      creator: creator,
      description: (metaRoot && metaRoot.description) ? metaRoot.description : '',
      id: identifier,
      format: (audioFile.name.split('.').pop() || 'mp3').toUpperCase(),
      album: metaRoot.title || identifier,
      isAlbumTrack: false,
      isVideo: isVideo,
      trackIndex: 0,
      totalTracks: 1,
      fileName: audioFile.name,
      fileSize: audioFile.size || 0
    }];
  }
  try {
    if (window.TrackNormalizer && typeof window.TrackNormalizer.normalizeTrackList === 'function') {
      const metaRoot = (metadata && metadata.metadata) ? metadata.metadata : {};
      const albumTitle = metaRoot && metaRoot.title ? metaRoot.title : identifier;
      playableFiles = window.TrackNormalizer.normalizeTrackList(playableFiles, {
        albumId: identifier,
        albumTitle,
        totalTracks: Array.isArray(playableFiles) ? playableFiles.length : 0
      });
    }
  } catch {}
  return playableFiles;
}

async function buildSearchSinglesTrackList(results, { limit = SEARCH_LIMITS.maxResultsToLoad, signal } = {}) {
  const items = Array.isArray(results) ? results : [];
  const maxItems = Number.isFinite(limit) ? limit : items.length;
  const singles = [];

  for (const item of items) {
    if (singles.length >= maxItems) break;
    if (!item || item.unplayable === true) continue;
    const isSingle = (item.trackCount === 1) || (item.isAlbum === false);
    if (!isSingle) continue;

    try {
      const files = (window.AlbumTracks && typeof window.AlbumTracks.getTracks === 'function')
        ? await window.AlbumTracks.getTracks(item.identifier, { preferCache: true, allowFetch: true, signal })
        : await fetchOptimizedPlayableFiles(item.identifier, { signal });
      if (!files || !files.length) continue;
      let track = files[0];
      if (!track || !track.url) continue;
      if (item.description && !track._albumDescription) {
        track._albumDescription = item.description;
      }
      if (window.TrackNormalizer && typeof window.TrackNormalizer.normalizeTrack === 'function') {
        track = window.TrackNormalizer.normalizeTrack(track, {
          albumId: item.identifier,
          albumTitle: track.album || item.title || '',
          trackIndex: 0,
          totalTracks: 1
        });
      }
      singles.push(track);
    } catch {
      // skip invalid single
    }
  }

  return singles;
}

// Abort all active search operations (main search and metadata fetches)
function abortAllSearchOperations() {
  try {
    // Abort main search
    if (searchControllers.currentSearch) {
      searchControllers.currentSearch.abort();
      searchControllers.currentSearch = null;
      logSearch('Search operation aborted by user', 'debug', 'NETWORK');
    }
    
    // Abort all metadata fetches
    if (searchControllers.activeMetadata.size > 0) {
      searchControllers.activeMetadata.forEach((controller, identifier) => {
        controller.abort();
      });
      searchControllers.activeMetadata.clear();
      logSearch(`${searchControllers.activeMetadata.size} metadata fetches aborted`, 'debug', 'NETWORK');
    }

    // Abort all background page prefetch fetches
    if (searchInFlight.pagePrefetchControllers.size > 0) {
      searchInFlight.pagePrefetchControllers.forEach((controller) => {
        try { controller.abort(); } catch {}
      });
      searchInFlight.pagePrefetchControllers.clear();
    }
    searchInFlight.pages.clear();
    searchInFlight.metadata.clear();
    
    // Hide loader
    if (window.Loaders && typeof window.Loaders.hideLoader === 'function') {
      window.Loaders.hideLoader();
    }
  } catch (error) {
    logSearch(`Error aborting search operations: ${error.message}`, 'warn', 'NETWORK');
  }
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

async function playOptimizedSearchResult(result, index, allResults) {
  const st = getSearchStateRef();
  if (st && st.isLoading) {
    logSearch('Playback in progress, ignoring click', 'debug', 'PLAYBACK');
    return;
  }

  if (result && (result.unplayable === true || result.trackCount === 0)) {
    try { markResultUnplayable(result); } catch {}
    window.showStatus?.('No playable audio files found for this result.', 'warning', 2500);
    const hasNext = allResults && index < allResults.length - 1;
    if (hasNext) {
      setTimeout(() => {
        playOptimizedSearchResult(allResults[index + 1], index + 1, allResults);
      }, 600);
    }
    if (!hasNext && window.Loaders && typeof window.Loaders.hideLoader === 'function') {
      window.Loaders.hideLoader();
    }
    return;
  }
  
  try {
    if (window.Loaders && typeof window.Loaders.showLoader === 'function') {
      window.Loaders.showLoader({ type: 'spinner', showProgress: false, context: 'search' });
    }
    
    logSearch('Loading track...', 'info', 'UI');
    window.showStatus?.(`Loading track...`, 'info', null, 'normal', true);
    
    const files = (window.AlbumTracks && typeof window.AlbumTracks.getTracks === 'function')
      ? await window.AlbumTracks.getTracks(result.identifier, { preferCache: true, allowFetch: true })
      : await fetchOptimizedPlayableFiles(result.identifier);
    
    if (files.length > 0) {
      // Guard: skip if file or URL is missing/invalid
      const firstTrack = files[0];
      if (!firstTrack || !firstTrack.url || typeof firstTrack.url !== 'string' || firstTrack.url.includes('/undefined') || firstTrack.url.trim() === '') {
        logSearch('Invalid or missing audio URL in search result, skipping playback', 'warn', 'PLAYBACK');
        window.showStatus?.('Invalid audio file for this result, skipping.', 'warning', 2000);
        // Try next result if available
        const hasNext = allResults && index < allResults.length - 1;
        if (hasNext) {
          setTimeout(() => {
            playOptimizedSearchResult(allResults[index + 1], index + 1, allResults);
          }, 1000);
        }
        if (!hasNext && window.Loaders && typeof window.Loaders.hideLoader === 'function') {
          window.Loaders.hideLoader();
        }
        return;
      }
      // Ocultar listas después de obtener los archivos pero antes de reproducir
      if (typeof window.hideSearchResults === 'function') window.hideSearchResults();
      if (typeof window.hideFavoritesList === 'function') window.hideFavoritesList();
      
      // Auto-collapse expanded albums when playback starts
      if (typeof window.collapseAllExpandedAlbums === 'function') {
        window.collapseAllExpandedAlbums();
      }

      if (files.length > 1) {
        // Es un álbum
        if (window.Loaders && typeof window.Loaders.showLoader === 'function') {
          window.Loaders.showLoader({ type: 'spinner', showProgress: false, context: 'album' });
        }
        logSearch('Found an album with tracks', 'info', 'UI');
        window.showStatus?.(`Found an album with tracks`, 'info', 2000);
        const st2 = getSearchStateRef();
        if (st2) {
          st2.albumOrigin = 'search';
          // Resetear contadores de repetición al iniciar nuevo álbum
          if (!st2.contextRepeatCount) st2.contextRepeatCount = {};
          st2.contextRepeatCount[result.identifier] = 0;
        }
        if (window.playbackManager) window.playbackManager.setAlbumPlaylist(result.identifier, files, 0);
        // Don't preload entire album - only load queue after first track starts
        // Propagar descripción del resultado como descripción de álbum
        if (result.description && !firstTrack._albumDescription) {
          firstTrack._albumDescription = result.description;
        }
        await window.playAudioTrackOptimized(firstTrack, result.identifier, 0, files.length, true);
        window.loadPlaybackQueue?.('album', files, 1);
      } else {
        // Es un single: preparar cola solo con singles para reproducción continua
        const singleTracks = await buildSearchSinglesTrackList(allResults);
        const singleIndex = singleTracks.findIndex(item => String(item.albumId || item.id || '') === String(result.identifier));
        if (window.playbackManager && singleTracks.length > 0) {
          window.playbackManager.setContext('search', singleTracks, singleIndex >= 0 ? singleIndex : 0);
        }
        if (singleTracks.length > 0) {
          window.loadPlaybackQueue?.('search', singleTracks, singleIndex >= 0 ? singleIndex + 1 : 0);
        }
        let track = files[0];
        if (window.TrackNormalizer && typeof window.TrackNormalizer.normalizeTrack === 'function') {
          track = window.TrackNormalizer.normalizeTrack(track, {
            albumId: result.identifier,
            albumTitle: track && track.album ? track.album : (result.title || ''),
            trackIndex: 0,
            totalTracks: 1
          });
        }
        if (!track || !track.url || typeof track.url !== 'string' || track.url.includes('/undefined') || track.url.trim() === '') {
          logSearch('Invalid or missing audio URL for single, skipping playback', 'warn', 'PLAYBACK');
          window.showStatus?.('Invalid audio file for this result, skipping.', 'warning', 2000);
          const hasNext = allResults && index < allResults.length - 1;
          if (hasNext) {
            setTimeout(() => {
              playOptimizedSearchResult(allResults[index + 1], index + 1, allResults);
            }, 1000);
          }
          if (!hasNext && window.Loaders && typeof window.Loaders.hideLoader === 'function') {
            window.Loaders.hideLoader();
          }
          return;
        }
        await window.playAudioTrackOptimized(track, result.identifier, 0, 1, true);
      }
    } else {
      // Some Archive items match metadata queries but have no playable audio files.
      // Treat this as a recoverable case: inform the user and try the next result.
      try { markResultUnplayable(result); } catch {}
      logSearch('No playable audio files found for this result', 'info', 'PLAYBACK');
      window.showStatus?.('No playable audio files found for this result. Trying next…', 'warning', 2500);
      const hasNext = allResults && index < allResults.length - 1;
      if (hasNext) {
        setTimeout(() => {
          playOptimizedSearchResult(allResults[index + 1], index + 1, allResults);
        }, 1000);
      }
      if (!hasNext && window.Loaders && typeof window.Loaders.hideLoader === 'function') {
        window.Loaders.hideLoader();
      }
      return;
    }
  } catch (error) {
    logSearch(error, 'error', 'PLAYBACK');

    const hasNext = allResults && index < allResults.length - 1;
    if (hasNext) {
      logSearch('Issue with this track, trying next', 'warn', 'UI');
      window.showStatus?.(`Issue with this track, trying next`, 'error', 1500);
      setTimeout(() => {
        playOptimizedSearchResult(allResults[index + 1], index + 1, allResults);
      }, 1500);
    } else {
      if (window.Loaders && typeof window.Loaders.hideLoader === 'function') {
        window.Loaders.hideLoader();
      }
      // Mensaje claro y sugerencia al usuario
      logSearch('Playback finished or unrecoverable error', 'error', 'UI');
      window.showStatus?.(
        'Playback finished. Try searching for more music or add tracks to your resonates.',
        'info',
        4000
      );
    }
  }
}

async function playSpecificSearchTrack(track, albumId, trackIndex, totalTracks) {
  const st = getSearchStateRef();
  if (st && st.isLoading) return;
  
  try {
    if (window.Loaders && typeof window.Loaders.showLoader === 'function') {
      window.Loaders.showLoader({ type: 'spinner', showProgress: false, context: totalTracks > 1 ? 'album' : 'search' });
    }
    
    logSearch('Loading track...', 'info', 'UI');
    window.showStatus?.(`Loading track...`, 'info', null, 'normal', true);
    window.hideSearchResults?.();
    
    if (totalTracks > 1) {
      let files = (window.AlbumTracks && typeof window.AlbumTracks.getTracks === 'function')
        ? await window.AlbumTracks.getTracks(albumId, { preferCache: true, allowFetch: true })
        : await fetchOptimizedPlayableFiles(albumId);
      try {
        if (window.TrackNormalizer && typeof window.TrackNormalizer.normalizeTrackList === 'function') {
          files = window.TrackNormalizer.normalizeTrackList(files, {
            albumId,
            totalTracks: Array.isArray(files) ? files.length : 0
          });
        }
      } catch {}
      if (window.playbackManager) window.playbackManager.setAlbumPlaylist(albumId, files, trackIndex);
      const st2 = getSearchStateRef();
      if (st2) {
        st2.albumOrigin = 'search';
        // Resetear contador de repetición al reproducir álbum
        if (!st2.contextRepeatCount) st2.contextRepeatCount = {};
        st2.contextRepeatCount[albumId] = 0;
      }
      // Load FIFO queue with album tracks
      // Start FIFO after the selected track to avoid replaying it on auto-advance.
      window.loadPlaybackQueue?.('album', files, trackIndex + 1);
    }
    // Loader se oculta cuando audio.play() inicia
    let normalizedTrack = track;
    try {
      if (window.TrackNormalizer && typeof window.TrackNormalizer.normalizeTrack === 'function') {
        normalizedTrack = window.TrackNormalizer.normalizeTrack(track, {
          albumId,
          trackIndex,
          totalTracks
        });
      }
    } catch {}
    await window.playAudioTrackOptimized(normalizedTrack, albumId, trackIndex, totalTracks, true);
  } catch (error) {
    logSearch(error, 'error', 'PLAYBACK');

    logSearch('Something went wrong', 'error', 'UI');
    window.showStatus?.(`Something went wrong`, 'error');
  }
}

async function playAlbumFromResontes(albumId, options = {}) {
  const st = getSearchStateRef();
  const force = !!(options && typeof options === 'object' && options.force);
  if (!force && st && st.isLoading) return;

  if (window.Loaders && typeof window.Loaders.showLoader === 'function') {
    window.Loaders.showLoader({ type: 'spinner', showProgress: false, context: 'album' });
  }

  if (typeof window.hideSearchResults === 'function') window.hideSearchResults();
  if (typeof window.hideResontesList === 'function') window.hideResontesList();
  
  try {
    logSearch('Loading album...', 'info', 'UI');
    window.showStatus?.(`Loading album...`, 'info', null, 'normal', true);
    // Resetear contador de repetición de álbum
    const st3 = getSearchStateRef();
    if (st3) {
      if (!st3.contextRepeatCount) st3.contextRepeatCount = {};
      st3.contextRepeatCount[albumId] = 0;
    }
    const files = (window.AlbumTracks && typeof window.AlbumTracks.getTracks === 'function')
      ? await window.AlbumTracks.getTracks(albumId, { preferCache: true, allowFetch: true })
      : await fetchOptimizedPlayableFiles(albumId);
    try {
      if (window.TrackNormalizer && typeof window.TrackNormalizer.normalizeTrackList === 'function') {
        const albumTitle = (files && files[0] && files[0].album) ? files[0].album : '';
        files = window.TrackNormalizer.normalizeTrackList(files, {
          albumId,
          albumTitle,
          totalTracks: Array.isArray(files) ? files.length : 0
        });
      }
    } catch {}
    if (files.length > 0) {
      if (window.Loaders && typeof window.Loaders.showLoader === 'function') {
        window.Loaders.showLoader({ type: 'spinner', showProgress: false, context: 'album' });
      }
      if (window.playbackManager) window.playbackManager.setAlbumPlaylist(albumId, files, 0);
      // Don't preload entire album - start playing first track immediately
      // Loader se ocultar� cuando audio.play() inicie
      await window.playAudioTrackOptimized(files[0], albumId, 0, files.length, true);
      // Load queue AFTER first track starts playing to avoid blocking
      window.loadPlaybackQueue?.('album', files, 1);
      logSearch('Now playing your full album', 'info', 'UI');
      window.showStatus?.(`Now playing your full album`, 'info');
    } else {
      throw new Error('No tracks found in album');
    }
  } catch (error) {
    if (window.Loaders && typeof window.Loaders.hideLoader === 'function') window.Loaders.hideLoader();
    logSearch(error, 'error', 'PLAYBACK');
    // Handle offline/cache errors more gracefully
    if (error.message.includes('Offline and audio not available in cache')) {
      logSearch('Album needs internet to play', 'error', 'UI');
      window.showStatus?.('Album needs internet to play', 'error', 4000);
    } else {
      logSearch('Error loading album', 'error', 'UI');
      window.showStatus?.(`Error loading album`, 'error');
    }
  }
}

async function playOptimizedResonte(resonteIndex = 0) {
  if (!window.state?.isLoading && window.state?.resontes?.length > 0) {
    if (window.Loaders && typeof window.Loaders.showLoader === 'function') {
      window.Loaders.showLoader({ type: 'spinner', showProgress: false, context: 'resonte' });
    }
    
    logSearch('Loading resonate...', 'info', 'UI');
    window.showStatus?.('Loading resonate...', 'info', null, 'normal', true);
    if (window.state) window.state.isPlayingResontes = true;
    try {
      let actualIndex;
      if (window.state?.shuffleResontes) {
        actualIndex = Math.floor(Math.random() * window.state.resontes.length);
      } else {
        actualIndex = resonteIndex >= 0 ? resonteIndex : 0;
      }
      if (window.playbackManager) window.playbackManager.setContext('resontes', window.state.resontes, actualIndex);
      const resonte = window.state.resontes[actualIndex];
      // Validate resonte has URL
      if (!resonte.url) {
        logSearch({ message: 'Resonte without valid URL', resonte }, 'error', 'PLAYBACK');
        logSearch('Resonate is broken, skipping it', 'error', 'UI');
        window.showStatus?.('Resonate is broken, skipping it', 'error', 2000);
        const nextIndex = (actualIndex + 1) % window.state.resontes.length;
        return playOptimizedResonte(nextIndex);
      }
      logSearch('Loading resonate...', 'info', 'UI');
      window.showStatus?.('Loading resonate...', 'info', null, 'normal', true);
      let track = {
        url: resonte.url,
        title: resonte.title || 'Untitled',
        creator: resonte.creator || 'Unknown',
        id: resonte.id,
        isAlbumTrack: resonte.isAlbumTrack || false,
        albumId: resonte.albumId || resonte.id,
        trackIndex: resonte.trackIndex || 0,
        totalTracks: resonte.totalTracks || 1,
        trackId: resonte.trackId || resonte.id
      };
      try {
        if (window.TrackNormalizer && typeof window.TrackNormalizer.normalizeTrack === 'function') {
          track = window.TrackNormalizer.normalizeTrack(track, {
            albumId: track.albumId,
            trackIndex: track.trackIndex,
            totalTracks: track.totalTracks
          });
        }
      } catch {}
      if (!track.url || track.url === '') {
        throw new Error('Audio URL not available in resonte');
      }
      // Loader se oculta cuando audio.play() inicia
      // CHECK IF PRELOADED RESONTES CACHE
      const resontesQueue = typeof window.audioCache !== 'undefined' && window.audioCache ? window.audioCache.getResontesQueue() : [];
      const isPreloaded = resontesQueue.includes(track.url);
      if (isPreloaded) {
        logSearch(`Playing from preloaded resontes: ${track.title}`, 'debug', 'PLAYBACK');
      } else {
        logSearch(`Resonte not preloaded, loading from network: ${track.title}`, 'debug', 'PLAYBACK');
      }
      const cached = typeof window.audioCache !== 'undefined' && window.audioCache ? await window.audioCache.get(track.url) : null;
      if (!cached && !window.state.networkOnline) {
        logSearch("Resonate isn't available offline. Skipping it", 'warn', 'UI');
        window.showStatus?.("Resonate isn't available offline. Skipping it", 'error', 2000);
        const nextIndex = (actualIndex + 1) % window.state.resontes.length;
        return playOptimizedResonte(nextIndex);
      }
      await window.playAudioTrackOptimized(track, resonte.id, resonte.trackIndex, resonte.totalTracks, true);
      if (typeof window.updateShuffleButton === 'function') window.updateShuffleButton();
    } catch (error) {
      logSearch(error, 'error', 'PLAYBACK');
      logSearch('Error with this resonate', 'error', 'UI');
      window.showStatus?.('Error with this resonate', 'error');
      if (window.state?.resontes?.length > 1) {
        const nextIndex = (resonteIndex + 1) % window.state.resontes.length;
        setTimeout(() => playOptimizedResonte(nextIndex), 1000);
      }
    }
  }
}

async function playRandomSearchResults() {
  const st = getSearchStateRef();
  const results = st && Array.isArray(st.searchResults) ? st.searchResults : [];
  if (!st || st.isLoading || results.length === 0) return;
  try {
    logSearch('Loading playlist...', 'info', 'UI');
    window.showStatus?.('Loading playlist...', 'info', null, 'normal', true);
    // Ensure shuffle is ON for "random" mode
    if (window.state && window.state.shuffleFavorites === false && typeof window.toggleShuffleFavorites === 'function') {
      window.toggleShuffleFavorites();
    }

    const singleTracks = await buildSearchSinglesTrackList(results);
    if (!singleTracks.length) {
      await playOptimizedSearchResult(results[0], 0, results);
      logSearch('Playing tracks from search', 'info', 'UI');
      window.showStatus?.(`Playing tracks from search`, 'info', 3000);
      return;
    }

    // Continuous search context with playable tracks
    if (window.playbackManager) {
      window.playbackManager.setContext('search', singleTracks, 0);
    }
    window.loadPlaybackQueue?.('search', singleTracks, 0);

    const firstTrack = singleTracks[0];
    await window.playAudioTrackOptimized(firstTrack, firstTrack.albumId || firstTrack.id, firstTrack.trackIndex || 0, firstTrack.totalTracks || 1, true);
    logSearch('Playing tracks from search', 'info', 'UI');
    window.showStatus?.(`Playing tracks from search`, 'info', 3000);
  } catch (error) {
    if (window.Loaders && typeof window.Loaders.hideLoader === 'function') window.Loaders.hideLoader();
    logSearch(error, 'error', 'PLAYBACK');
    logSearch("Couldn't load search tracks", 'error', 'UI');
    window.showStatus?.(`Couldn't load search tracks`, 'error');
  }
}

// Prefetch next search results in background (non-blocking)
async function prefetchNextSearchResults(allResults, currentIndex) {
  const st = getSearchStateRef();
  if (!allResults || currentIndex >= allResults.length - 1 || !(st && st.networkOnline)) return;
  
  // Precarga solo los metadatos de las 2 siguientes bsquedas (no audio en paralelo)
  for (let i = 1; i <= SEARCH_LIMITS.prefetchNextCount && currentIndex + i < allResults.length; i++) {
    const nextResult = allResults[currentIndex + i];
    if (nextResult) {
      try {
        // Just fetch metadata (already cached in enhancedCache)
        const files = (window.AlbumTracks && typeof window.AlbumTracks.getTracks === 'function')
          ? await window.AlbumTracks.getTracks(nextResult.identifier, { preferCache: true, allowFetch: true })
          : await fetchOptimizedPlayableFiles(nextResult.identifier);
        if (files && files.length > 0 && typeof audioCache !== 'undefined' && audioCache) {
          // Prefetch only the first track's audio in low-priority queue
          audioCache.prefetchAudio(files[0].url, false).catch(() => {});
        }
      } catch (error) {
        // Silent fail - esto es background prefetch
      }
    }
  }
}

function prefetchNextSearchPages(query, currentPage, hasMore, count = 2) {
  const normalizedQuery = (query || '').trim();
  if (!normalizedQuery) return;

  const filterKey = getSearchFilterCacheKey();
  const orderKey = getSearchOrderingCacheKey(normalizedQuery);
  const prefetchKey = `${normalizedQuery}::${filterKey}::${orderKey}`;

  const st = getSearchStateRef();
  const online = (st && st.networkOnline !== undefined) ? st.networkOnline : (typeof navigator !== 'undefined' ? navigator.onLine !== false : true);
  if (!online) return;

  if (!hasMore) return;
  const safePage = Number.isFinite(currentPage) ? currentPage : 0;
  const pages = [];
  for (let i = 1; i <= Math.max(1, count); i++) {
    pages.push(safePage + i);
  }

  if (searchInFlight.prefetchQuery !== prefetchKey) {
    searchInFlight.prefetchQuery = prefetchKey;
    searchInFlight.prefetchGeneration++;

    // Cancel any in-flight prefetch controllers from other queries
    const prefix = `search:${SEARCH_CACHE_SCHEMA}:${normalizedQuery}:${filterKey}:${orderKey}:`;
    const controllerKeysToAbort = [];
    for (const key of searchInFlight.pagePrefetchControllers.keys()) {
      if (!key.startsWith(prefix)) controllerKeysToAbort.push(key);
    }
    controllerKeysToAbort.forEach((key) => {
      const controller = searchInFlight.pagePrefetchControllers.get(key);
      if (controller) {
        try { controller.abort(); } catch {}
      }
      searchInFlight.pagePrefetchControllers.delete(key);
    });
  }

  const generation = searchInFlight.prefetchGeneration;

  const schedule = (task) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => task(), { timeout: 1500 });
    } else {
      setTimeout(task, 0);
    }
  };

  schedule(async () => {
    for (const page of pages) {
      if (generation !== searchInFlight.prefetchGeneration) return;
      const cacheKey = getSearchCacheKey(normalizedQuery, page);

      const cached = window.enhancedCache && window.enhancedCache.get('search', cacheKey);
      if (cached) continue;
      if (searchInFlight.pages.has(cacheKey)) continue;

      const controller = new AbortController();
      searchInFlight.pagePrefetchControllers.set(cacheKey, controller);
      try {
        const result = await performOptimizedSearch(normalizedQuery, page, {
          abortPrevious: false,
          showLoader: false,
          activateUI: false,
          deferMetadata: true,
          signal: controller.signal
        });
        // If the next page indicates no more results, don't keep fetching further.
        if (!result || !result.hasMore) break;
      } catch {
        // Silent fail (background)
      } finally {
        searchInFlight.pagePrefetchControllers.delete(cacheKey);
      }
    }
  });
}

window.performOptimizedSearch = performOptimizedSearch;
window.performFastSearch = performFastSearch;
window.fetchOptimizedPlayableFiles = fetchOptimizedPlayableFiles;
window.playOptimizedSearchResult = playOptimizedSearchResult;

// Prefetch tracklist on hover for instant expansion
window.prefetchTracklistOnHover = function prefetchTracklistOnHover(identifier) {
  try {
    if (!identifier) return;
    const id = String(identifier);
    
    // Skip if already cached or being prefetched
    if (window.enhancedCache && window.enhancedCache.get('metadata', id)) return;
    if (searchControllers.hoverPrefetch.has(id)) return;
    
    // Skip if offline
    if (!isSearchNetworkAvailable()) return;
    
    // Create controller for this prefetch
    const controller = new AbortController();
    searchControllers.hoverPrefetch.set(id, controller);
    
    // Start prefetch (low priority, best effort)
    fetchOptimizedPlayableFiles(id, { prefetch: true, signal: controller.signal })
      .then(() => {
        searchControllers.hoverPrefetch.delete(id);
      })
      .catch((err) => {
        searchControllers.hoverPrefetch.delete(id);
        // Silent failure for prefetch
        if (!isAbortError(err)) {
          debugSearch('hover_prefetch_failed', { identifier: id, error: err.message });
        }
      });
  } catch (e) {
    // Best effort, ignore errors
  }
};

// Cancel tracklist fetch when collapsed
window.cancelTracklistFetch = function cancelTracklistFetch(identifier) {
  try {
    if (!identifier) return;
    const id = String(identifier);
    
    // Cancel active metadata fetch
    const controller = searchControllers.activeMetadata.get(id);
    if (controller) {
      try { controller.abort(); } catch {}
      searchControllers.activeMetadata.delete(id);
    }
    
    // Cancel hover prefetch
    const hoverController = searchControllers.hoverPrefetch.get(id);
    if (hoverController) {
      try { hoverController.abort(); } catch {}
      searchControllers.hoverPrefetch.delete(id);
    }
  } catch (e) {
    // Best effort
  }
};
window.playSpecificSearchTrack = playSpecificSearchTrack;
window.playAlbumFromResontes = playAlbumFromResontes;
// Back-compat: some UI surfaces still call the old function name.
window.playAlbumFromFavorites = playAlbumFromResontes;
window.playOptimizedResonte = playOptimizedResonte;
window.playRandomSearchResults = playRandomSearchResults;
window.abortAllSearchOperations = abortAllSearchOperations;
window.prefetchNextSearchPages = prefetchNextSearchPages;