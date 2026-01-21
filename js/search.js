// Search functionality
// Loader Manager reference is already defined in playback.js
// const getLoaderManager = () => window.loaderManager;

const SEARCH_DEFAULTS = {
  resultsPerPage: 8,
  timeout: 15000,
  metadataTimeout: 60000
};

const SEARCH_LIMITS = {
  metadataBatchSize: 2,
  maxResultsToPreload: 3,
  maxResultsToLoad: 10,
  playlistBatchSize: 2,
  prefetchNextCount: 2
};

// AbortController state for cancellable operations
const searchControllers = {
  currentSearch: null,
  activeMetadata: new Map()
};

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
  return `search:${q}:${page}`;
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
        const files = await fetchOptimizedPlayableFiles(item.identifier);
        const count = Array.isArray(files) ? files.length : 0;
        if (count > 0) {
          return {
            ...item,
            // Respect explicit track-list flag: render as single even if multiple files
            isAlbum: item.isTrackList ? false : (count > 1),
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

function scheduleSearchPageEnrichment({ normalizedQuery, page, processedResults, hasMore, total, generation }) {
  try {
    const cacheKey = getSearchCacheKey(normalizedQuery, page);
    scheduleTaskIdle(async () => {
      try {
        if (generation !== searchInFlight.prefetchGeneration) return;
        const existing = window.enhancedCache && window.enhancedCache.get('search', cacheKey);
        if (existing && existing.deferredMetadata !== true) return; // already full

        const enrichedResults = await enrichSearchResultsWithMetadata(processedResults, normalizedQuery, { keepUnplayables: true });
        const full = {
          results: enrichedResults,
          hasMore,
          total,
          deferredMetadata: false
        };
        if (window.enhancedCache) window.enhancedCache.set('search', cacheKey, full);

        try {
          if (typeof window.onSearchPageEnriched === 'function') {
            window.onSearchPageEnriched({ query: normalizedQuery, page });
          }
        } catch {}
      } catch {
        // background enrichment is best-effort
      }
    }, { timeout: 1500 });
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

function logSearch(message, level = 'debug', category = 'NETWORK') {
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

function setSearchActiveUI(isActive) {
  const els = getSearchElementsRef();
  if (els && els.searchResults && els.searchResults.classList) {
    els.searchResults.classList.toggle('active', Boolean(isActive));
  }
  // Mutually exclusive panels: opening search hides favorites
  try {
    if (isActive && typeof window.hideFavoritesList === 'function') {
      window.hideFavoritesList();
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
}

function setSearchErrorMessage(message) {
  const els = getSearchElementsRef();
  if (els && els.searchResultsList) {
    els.searchResultsList.innerHTML = `<div class="no-results">${message}</div>`;
  }
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
  const deferMetadata = options.deferMetadata === true;

  // Prevent search when offline
  const st = getSearchStateRef();
  if (!(st && st.networkOnline)) {
    logSearch('Searching needs internet connection', 'info', 'UI');
    if (window.showStatus) window.showStatus('Searching needs internet connection', 'warning', 3000);
    setSearchActiveUI(false);
    return { results: [], hasMore: false };
  }
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
    if (showLoader && window.Loaders) {
      window.Loaders.showLoader({ type: 'spinner', showProgress: false });
    }
    try {
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
      const resultsPerPage = getSearchConfigNumber('resultsPerPage', SEARCH_DEFAULTS.resultsPerPage);
      const timeout = getSearchConfigNumber('timeout', SEARCH_DEFAULTS.timeout);
      const url = `https://archive.org/advancedsearch.php?q=${encodedQuery}&fl[]=identifier,title,creator,description&rows=${resultsPerPage}&page=${page + 1}&output=json&sort[]=downloads+desc`;
      const fetchFn = getSearchFetchFn();
      const response = await fetchFn(url, {
        signal,
        timeout,
        headers: {
          'Accept': 'application/json'
        }
      });
      if (!(response && response.ok)) throw new Error('Network error');
      const data = await response.json();
      const results = (data.response && data.response.docs) ? data.response.docs : [];
      // Post-process results for improved relevance in client
      const processedResults = results.map(item => ({
        identifier: item.identifier,
        title: item.title || 'Untitled',
        creator: item.creator || 'Unknown',
        description: item.description || '', // Ensure description is included
        // Heuristic: mark explicit "track list" items to be rendered as singles
        isTrackList: (() => {
          const t = normalizeString(item.title || '');
          const d = normalizeString(item.description || '');
          const cues = [
            'track list', 'tracklist', 'lista de temas', 'lista de canciones', 'track-list'
          ];
          return cues.some(c => t.includes(c) || d.includes(c));
        })(),
        isAlbum: null,
        trackCount: null,
        relevanceScore: calculateRelevanceScore(item, query)
      }));
      // Sort by calculated relevance score (if many results)
      if (processedResults.length > 1) {
        processedResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
      }
      const total = (data.response && data.response.numFound) ? data.response.numFound : 0;
      const hasMore = (typeof total === 'number' && isFinite(total) && total > 0)
        ? ((page + 1) * resultsPerPage) < total
        : (results.length === resultsPerPage);

      if (deferMetadata) {
        const fastResult = {
          results: processedResults,
          hasMore,
          total,
          deferredMetadata: true
        };
        if (window.enhancedCache) window.enhancedCache.set('search', cacheKey, fastResult);
        // Enrich in idle time so infinite-scroll can append instantly.
        scheduleSearchPageEnrichment({
          normalizedQuery,
          page,
          processedResults,
          hasMore,
          total,
          generation: searchInFlight.prefetchGeneration
        });
        return fastResult;
      }

      // Full (blocking) enrichment: filter non-playables and compute track counts.
      const enrichedResults = await enrichSearchResultsWithMetadata(processedResults, normalizedQuery, { signal });
      const searchResult = { results: enrichedResults, hasMore, total, deferredMetadata: false };
      if (window.enhancedCache) window.enhancedCache.set('search', cacheKey, searchResult);
      return searchResult;
    } catch (error) {
      logSearch(error, 'error', 'NETWORK');
      // Fallback: try simple query if optimized fails
      try {
        const simpleQuery = encodeURIComponent(`(${query}) AND mediatype:audio`);
        const resultsPerPage = getSearchConfigNumber('resultsPerPage', SEARCH_DEFAULTS.resultsPerPage);
        const timeout = getSearchConfigNumber('timeout', SEARCH_DEFAULTS.timeout);
        const fallbackUrl = `https://archive.org/advancedsearch.php?q=${simpleQuery}&fl[]=identifier,title,creator&rows=${resultsPerPage}&page=${page + 1}&output=json&sort[]=downloads+desc`;
        const fetchFn2 = getSearchFetchFn();
        const fallbackResponse = await fetchFn2(fallbackUrl, {
          signal,
          timeout
        });
        if (fallbackResponse && fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json();
          const fallbackResults = (fallbackData.response && fallbackData.response.docs) ? fallbackData.response.docs : [];
          const processedFallbackResults = fallbackResults.map(item => ({
            identifier: item.identifier,
            title: item.title || 'Untitled',
            creator: item.creator || 'Unknown',
            description: '',
            isAlbum: null,
            trackCount: null,
            relevanceScore: 0.5 // Neutral score for fallback results
          }));
          const total = (fallbackData.response && fallbackData.response.numFound) ? fallbackData.response.numFound : 0;
          const hasMore = (typeof total === 'number' && isFinite(total) && total > 0)
            ? ((page + 1) * resultsPerPage) < total
            : (fallbackResults.length === resultsPerPage);

          if (deferMetadata) {
            const fastResult = {
              results: processedFallbackResults,
              hasMore,
              total,
              deferredMetadata: true
            };
            if (window.enhancedCache) window.enhancedCache.set('search', cacheKey, fastResult);
            scheduleSearchPageEnrichment({
              normalizedQuery,
              page,
              processedResults: processedFallbackResults,
              hasMore,
              total,
              generation: searchInFlight.prefetchGeneration
            });
            return fastResult;
          }

          const enrichedFallback = await enrichSearchResultsWithMetadata(processedFallbackResults, normalizedQuery, { signal });
          const searchResult = { results: enrichedFallback, hasMore, total, deferredMetadata: false };
          if (window.enhancedCache) window.enhancedCache.set('search', cacheKey, searchResult);
          return searchResult;
        }
      } catch (fallbackError) {
        logSearch(fallbackError, 'error', 'NETWORK');
      }
      if (activateUI) {
        setSearchErrorMessage('Error in search. Try other terms.');
      }
      return { results: [], hasMore: false };
    } finally {
      if (showLoader && window.Loaders) {
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
function calculateRelevanceScore(item, query) {
  let score = 0;
  const q = normalizeString(query);
  const titleNorm = normalizeString(item.title);
  const creatorNorm = normalizeString(item.creator);
  const descriptionNorm = normalizeString(item.description);
  if (titleNorm.includes(q)) {
    score += 3;
  }
  if (creatorNorm.includes(q)) {
    score += 2;
  }
  if (descriptionNorm.includes(q)) {
    score += 1;
  }
  if (titleNorm.startsWith(q)) {
    score += 2;
  }
  if (titleNorm.includes(q) && creatorNorm.includes(q)) {
    score += 2;
  }
  if (!titleNorm.includes(q) && !creatorNorm.includes(q)) {
    if (isTypoSimilar(q, titleNorm)) score += 1;
    if (isTypoSimilar(q, creatorNorm)) score += 1;
  }
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
    const ar = typeof a.relevanceScore === 'number' ? a.relevanceScore : 0;
    const br = typeof b.relevanceScore === 'number' ? b.relevanceScore : 0;
    return br - ar;
  });
}

async function fetchOptimizedPlayableFiles(identifier) {
  const cached = window.enhancedCache && window.enhancedCache.get('metadata', identifier);
  if (cached) {
    return cached;
  }

  const inFlight = searchInFlight.metadata.get(identifier);
  if (inFlight) {
    return inFlight;
  }

  const metadataPromise = (async () => {
    // If there's already a controller for this identifier, abort it and replace.
    const existingController = searchControllers.activeMetadata.get(identifier);
    if (existingController) {
      try { existingController.abort(); } catch {}
      searchControllers.activeMetadata.delete(identifier);
    }
  
    // Create AbortController for this metadata fetch
    const controller = new AbortController();
    searchControllers.activeMetadata.set(identifier, controller);

    const url = `https://archive.org/metadata/${identifier}`;
    try {
      // Force longer timeout for metadata fetching
      const fetchFn = getSearchFetchFn();
      const metadataTimeout = getSearchConfigNumber('metadataTimeout', SEARCH_DEFAULTS.metadataTimeout);
      const response = await fetchFn(url, { 
        signal: controller.signal,
        timeout: metadataTimeout 
      });
      if (!(response && response.ok)) throw new Error('Error fetching metadata');
      const metadata = await response.json();
      if (!(metadata && metadata.files)) {
        throw new Error('Invalid metadata');
      }
      let audioFiles = metadata.files.filter(file =>
        isPlayableAudioFile(file)
      );
    // Sort remaining files by format priority with network-aware sizing
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const effectiveType = connection && connection.effectiveType ? connection.effectiveType : '';
    const downlink = connection && typeof connection.downlink === 'number' ? connection.downlink : 0;
    const slowNetwork = effectiveType === '2g' || effectiveType === 'slow-2g' || downlink < 1;
    const midNetwork = effectiveType === '3g' || downlink < 5;

    audioFiles.sort((a, b) => {
      const aIsOgg = a.name.toLowerCase().endsWith('.ogg');
      const bIsOgg = b.name.toLowerCase().endsWith('.ogg');
      const aIsMp3 = a.name.toLowerCase().endsWith('.mp3');
      const bIsMp3 = b.name.toLowerCase().endsWith('.mp3');
      const aSize = a.size || 0;
      const bSize = b.size || 0;

      // On slow networks prefer the smallest payload first
      if (slowNetwork) {
        if (aSize !== bSize) return aSize - bSize;
      }

      // On mid networks bias toward smaller MP3 over larger OGG if size differs greatly
      if (midNetwork && Math.abs(aSize - bSize) > 1500000) {
        return aSize - bSize;
      }

      // Prioritize .ogg over .mp3 for quality when network is good enough
      if (aIsOgg && !bIsOgg) return -1;
      if (!aIsOgg && bIsOgg) return 1;
      // Then prioritize .mp3 over other formats
      if (aIsMp3 && !bIsMp3 && !bIsOgg) return -1;
      if (!aIsMp3 && bIsMp3 && !aIsOgg) return 1;
      // Finally sort by size
      return aSize - bSize;
    });
      if (audioFiles.length === 0) {
        return [];
      }
      const playableFiles = createPlayableFiles(audioFiles, identifier, metadata);
      if (window.enhancedCache) window.enhancedCache.set('metadata', identifier, playableFiles);
      return playableFiles;
    } catch (error) {
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
  // Only accept .ogg and .mp3 formats (priority: .ogg first, then .mp3)
  const audioFormats = ['.ogg', '.mp3'];
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
        albumId: identifier,
        trackIndex: index,
        totalTracks: audioFiles.length,
        fileName: file.name
      };
    });
    // Deduplication: prefer .ogg over .mp3 for the same track based on title and artist
    const seenTracks = new Map();
    for (const file of allFiles) {
      // Create normalized key based on title and artist for better deduplication
      const normalizedTitle = (file.title || '').toLowerCase().trim().replace(/\s+/g, ' ');
      const normalizedArtist = (file.creator || '').toLowerCase().trim().replace(/\s+/g, ' ');
      const trackKey = `${normalizedTitle}|${normalizedArtist}`;
      const existing = seenTracks.get(trackKey);
      if (!existing) {
        // First time seeing this track
        seenTracks.set(trackKey, file);
      } else {
        // Check if current file is .ogg and existing is not
        const currentIsOgg = file.fileName.toLowerCase().endsWith('.ogg');
        const existingIsOgg = existing.fileName.toLowerCase().endsWith('.ogg');
        if (currentIsOgg && !existingIsOgg) {
          // Replace with .ogg version
          seenTracks.set(trackKey, file);
        }
        // If existing is already .ogg, keep it
        // If both are .mp3 or both are .ogg, keep the first one
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
      trackIndex: 0,
      totalTracks: 1
    }];
  }
  return playableFiles;
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
    if (window.Loaders) {
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
  
  try {
    if (window.Loaders) {
      window.Loaders.showLoader({ type: 'spinner', showProgress: false });
    }
    
    logSearch('Loading track...', 'info', 'UI');
    window.showStatus?.(`Loading track...`, 'info', null, 'normal', true);
    
    const files = await fetchOptimizedPlayableFiles(result.identifier);
    
    if (files.length > 0) {
      // Guard: skip if file or URL is missing/invalid
      const firstTrack = files[0];
      if (!firstTrack || !firstTrack.url || typeof firstTrack.url !== 'string' || firstTrack.url.includes('/undefined') || firstTrack.url.trim() === '') {
        logSearch('Invalid or missing audio URL in search result, skipping playback', 'warn', 'PLAYBACK');
        window.showStatus?.('Invalid audio file for this result, skipping.', 'warning', 2000);
        // Try next result if available
        if (allResults && index < allResults.length - 1) {
          setTimeout(() => {
            playOptimizedSearchResult(allResults[index + 1], index + 1, allResults);
          }, 1000);
        }
        if (window.Loaders) window.Loaders.hideLoader();
        return;
      }
      // Ocultar listas después de obtener los archivos pero antes de reproducir
      if (typeof window.hideSearchResults === 'function') window.hideSearchResults();
      if (typeof window.hideFavoritesList === 'function') window.hideFavoritesList();

      if (files.length > 1) {
        // Es un álbum
        if (window.Loaders) {
          window.Loaders.showLoader({ type: 'spinner', showProgress: false });
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
        // Propagar descripción del resultado al track si no la tiene
        if (result.description && !firstTrack.description) {
          firstTrack.description = result.description;
        }
        await window.playAudioTrackOptimized(firstTrack, result.identifier, 0, files.length, true);
        window.loadPlaybackQueue?.('album', files, 1);
      } else {
        // Es un single: preparar cola solo con singles para reproducción continua
        const singles = allResults.filter(item => (item.trackCount === 1) || (item.isAlbum === false));
        // Fetch playable files for all singles and filter out those with invalid URLs
        const validSingles = [];
        for (const single of singles) {
          try {
            const singleFiles = await fetchOptimizedPlayableFiles(single.identifier);
            if (singleFiles && singleFiles[0] && singleFiles[0].url && typeof singleFiles[0].url === 'string' && !singleFiles[0].url.includes('/undefined') && singleFiles[0].url.trim() !== '') {
              validSingles.push(single);
            }
          } catch (e) {
            // skip invalid
          }
        }
        const singleIndex = validSingles.findIndex(item => item.identifier === result.identifier);
        if (window.playbackManager) {
          window.playbackManager.setContext('search', validSingles, singleIndex);
        }
        window.loadPlaybackQueue?.('search', validSingles, singleIndex + 1);
        const track = files[0];
        if (!track || !track.url || typeof track.url !== 'string' || track.url.includes('/undefined') || track.url.trim() === '') {
          logSearch('Invalid or missing audio URL for single, skipping playback', 'warn', 'PLAYBACK');
          window.showStatus?.('Invalid audio file for this result, skipping.', 'warning', 2000);
          if (allResults && index < allResults.length - 1) {
            setTimeout(() => {
              playOptimizedSearchResult(allResults[index + 1], index + 1, allResults);
            }, 1000);
          }
          if (window.Loaders) window.Loaders.hideLoader();
          return;
        }
        await window.playAudioTrackOptimized(track, result.identifier, 0, 1, true);
      }
    } else {
      window.showStatus?.('No playable audio files found for this result.', 'warning', 3000);
      throw new Error('No playable audio files found');
    }
  } catch (error) {
    logSearch(error, 'error', 'PLAYBACK');

    if (allResults && index < allResults.length - 1) {
      logSearch('Issue with this track, trying next', 'warn', 'UI');
      window.showStatus?.(`Issue with this track, trying next`, 'error', 1500);
      setTimeout(() => {
        playOptimizedSearchResult(allResults[index + 1], index + 1, allResults);
      }, 1500);
    } else {
      // Mensaje claro y sugerencia al usuario
      logSearch('Playback finished or unrecoverable error', 'error', 'UI');
      window.showStatus?.(
        'Playback finished. Try searching for more music or add tracks to your favorites.',
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
    if (window.Loaders) {
      window.Loaders.showLoader({ type: 'spinner', showProgress: false });
    }
    
    logSearch('Loading track...', 'info', 'UI');
    window.showStatus?.(`Loading track...`, 'info', null, 'normal', true);
    window.hideSearchResults?.();
    
    if (totalTracks > 1) {
      const files = await fetchOptimizedPlayableFiles(albumId);
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
    if (window.Loaders) window.Loaders.hideLoader();
    
    // Loader se ocultar� cuando audio.play() inicie
    await window.playAudioTrackOptimized(track, albumId, trackIndex, totalTracks, true);
  } catch (error) {
    logSearch(error, 'error', 'PLAYBACK');

    logSearch('Something went wrong', 'error', 'UI');
    window.showStatus?.(`Something went wrong`, 'error');
  }
}

async function playAlbumFromFavorites(albumId) {
  const st = getSearchStateRef();
  if (st && st.isLoading) return;

  if (window.Loaders) {
    window.Loaders.showLoader({ type: 'spinner', showProgress: false });
  }

  if (typeof window.hideSearchResults === 'function') window.hideSearchResults();
  if (typeof window.hideFavoritesList === 'function') window.hideFavoritesList();
  
  try {
    logSearch('Loading album...', 'info', 'UI');
    window.showStatus?.(`Loading album...`, 'info', null, 'normal', true);
    // Resetear contador de repetición de álbum
    const st3 = getSearchStateRef();
    if (st3) {
      if (!st3.contextRepeatCount) st3.contextRepeatCount = {};
      st3.contextRepeatCount[albumId] = 0;
    }
    const files = await fetchOptimizedPlayableFiles(albumId);
    if (files.length > 0) {
      if (window.Loaders) {
        window.Loaders.showLoader({ type: 'spinner', showProgress: false });
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
    if (window.Loaders) window.Loaders.hideLoader();
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

async function playOptimizedFavorite(favoriteIndex = 0) {
  if (!window.state?.isLoading && window.state?.favorites?.length > 0) {
    if (window.Loaders) {
      window.Loaders.showLoader({ type: 'spinner', showProgress: false });
    }
    
    logSearch('Loading favorite...', 'info', 'UI');
    window.showStatus?.(`Loading favorite...`, 'info', null, 'normal', true);
    if (window.state) window.state.isPlayingFavorites = true;
    try {
      let actualIndex;
      if (window.state?.shuffleFavorites) {
        actualIndex = Math.floor(Math.random() * window.state.favorites.length);
      } else {
        actualIndex = favoriteIndex >= 0 ? favoriteIndex : 0;
      }
      if (window.playbackManager) window.playbackManager.setContext('favorites', window.state.favorites, actualIndex);
      const favorite = window.state.favorites[actualIndex];
      // Validate favorite has URL
      if (!favorite.url) {
        logSearch({ message: 'Favorite without valid URL', favorite }, 'error', 'PLAYBACK');
        logSearch('Favorite is broken, skipping it', 'error', 'UI');
        window.showStatus?.('Favorite is broken, skipping it', 'error', 2000);
        const nextIndex = (actualIndex + 1) % window.state.favorites.length;
        return playOptimizedFavorite(nextIndex);
      }
      logSearch('Loading favorite...', 'info', 'UI');
      window.showStatus?.(`Loading favorite...`, 'info', null, 'normal', true);
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
      if (window.Loaders) window.Loaders.hideLoader();
      // CHECK IF PRELOADED FAVORITES CACHE
      const favoritesQueue = typeof window.audioCache !== 'undefined' && window.audioCache ? window.audioCache.getFavoritesQueue() : [];
      const isPreloaded = favoritesQueue.includes(track.url);
      if (isPreloaded) {
        logSearch(`Playing from preloaded favorites: ${track.title}`, 'debug', 'PLAYBACK');
      } else {
        logSearch(`Favorite not preloaded, loading from network: ${track.title}`, 'debug', 'PLAYBACK');
      }
      const cached = typeof window.audioCache !== 'undefined' && window.audioCache ? await window.audioCache.get(track.url) : null;
      if (!cached && !window.state.networkOnline) {
        logSearch("Favorite isn't offline. Skipping it", 'warn', 'UI');
        window.showStatus?.("Favorite isn't offline. Skipping it", 'error', 2000);
        const nextIndex = (actualIndex + 1) % window.state.favorites.length;
        if (window.Loaders) window.Loaders.hideLoader();
        return playOptimizedFavorite(nextIndex);
      }
      if (window.Loaders) window.Loaders.hideLoader();
      await window.playAudioTrackOptimized(track, favorite.id, favorite.trackIndex, favorite.totalTracks, true);
      if (typeof window.updateShuffleButton === 'function') window.updateShuffleButton();
    } catch (error) {
      logSearch(error, 'error', 'PLAYBACK');
      logSearch('Error with this favorite', 'error', 'UI');
      window.showStatus?.(`Error with this favorite`, 'error');
      if (window.state?.favorites?.length > 1) {
        const nextIndex = (favoriteIndex + 1) % window.state.favorites.length;
        setTimeout(() => playOptimizedFavorite(nextIndex), 1000);
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

    // Continuous search context (no caps)
    if (window.playbackManager) {
      window.playbackManager.setContext('search', results, 0);
    }
    window.loadPlaybackQueue?.('search', results, 0);

    // Start playing from the first result (shuffle will affect the subsequent selection)
    await playOptimizedSearchResult(results[0], 0, results);
    logSearch('Playing tracks from search', 'info', 'UI');
    window.showStatus?.(`Playing tracks from search`, 'info', 3000);
  } catch (error) {
    if (window.Loaders) window.Loaders.hideLoader();
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
        const files = await fetchOptimizedPlayableFiles(nextResult.identifier);
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

  const st = getSearchStateRef();
  const online = (st && st.networkOnline !== undefined) ? st.networkOnline : (typeof navigator !== 'undefined' ? navigator.onLine !== false : true);
  if (!online) return;

  if (!hasMore) return;
  const safePage = Number.isFinite(currentPage) ? currentPage : 0;
  const pages = [];
  for (let i = 1; i <= Math.max(1, count); i++) {
    pages.push(safePage + i);
  }

  if (searchInFlight.prefetchQuery !== normalizedQuery) {
    searchInFlight.prefetchQuery = normalizedQuery;
    searchInFlight.prefetchGeneration++;

    // Cancel any in-flight prefetch controllers from other queries
    const prefix = `search:${normalizedQuery}:`;
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
window.playOptimizedSearchResult = playOptimizedSearchResult;
window.playSpecificSearchTrack = playSpecificSearchTrack;
window.playAlbumFromFavorites = playAlbumFromFavorites;
window.playOptimizedFavorite = playOptimizedFavorite;
window.playRandomSearchResults = playRandomSearchResults;
window.abortAllSearchOperations = abortAllSearchOperations;
window.prefetchNextSearchPages = prefetchNextSearchPages;