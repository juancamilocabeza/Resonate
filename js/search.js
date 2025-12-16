// Search functionality
// Loader Manager reference is already defined in playback.js
// const getLoaderManager = () => window.loaderManager;

const SEARCH_DEFAULTS = {
  resultsPerPage: 5,
  timeout: 8000,
  metadataTimeout: 30000
};

const SEARCH_LIMITS = {
  metadataBatchSize: 2,
  maxResultsToPreload: 3,
  maxResultsToLoad: 10,
  playlistBatchSize: 2,
  prefetchNextCount: 2
};

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
  const st = getSearchStateRef();
  if (st) st.searchActive = Boolean(isActive);
}

function setSearchErrorMessage(message) {
  const els = getSearchElementsRef();
  if (els && els.searchResultsList) {
    els.searchResultsList.innerHTML = `<div class="no-results">${message}</div>`;
  }
}

async function performOptimizedSearch(query, page = 0) {
  const normalizedQuery = (query || '').trim();
  if (!normalizedQuery) {
    setSearchActiveUI(false);
    return { results: [], hasMore: false };
  }
  // Prevent search when offline
  const st = getSearchStateRef();
  if (!(st && st.networkOnline)) {
    logSearch('Searching needs internet connection', 'info', 'UI');
    if (window.showStatus) window.showStatus('Searching needs internet connection', 'warning', 3000);
    setSearchActiveUI(false);
    return { results: [], hasMore: false };
  }
  const cacheKey = `search:${query}:${page}`;
  const cached = window.enhancedCache && window.enhancedCache.get('search', cacheKey);
  if (cached) {
    return cached;
  }
  setSearchActiveUI(true);
  if (window.Loaders) {
    window.Loaders.showLoader({ type: 'spinner' });
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
      isAlbum: null,
      trackCount: null,
      relevanceScore: calculateRelevanceScore(item, query)
    }));
    // Sort by calculated relevance score (if many results)
    if (processedResults.length > 1) {
      processedResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
    }
    // Filter out non-playable items by checking optimized playable files
    // Limit concurrent metadata fetches to avoid excessive parallel downloads
    const enrichedResults = [];
    const batchSize = SEARCH_LIMITS.metadataBatchSize; // Process metadata in small batches
    
    for (let i = 0; i < processedResults.length; i += batchSize) {
      const batch = processedResults.slice(i, i + batchSize);
      const batchPromises = batch.map(async (item) => {
        try {
          const files = await fetchOptimizedPlayableFiles(item.identifier);
          const count = Array.isArray(files) ? files.length : 0;
          if (count > 0) {
            return {
              ...item,
              isAlbum: count > 1,
              trackCount: count
            };
          }
          return null;
        } catch (e) {
          // On error fetching metadata, skip the item to avoid presenting non-playables
          return null;
        }
      });
      const batchResults = (await Promise.all(batchPromises)).filter(Boolean);
      enrichedResults.push(...batchResults);
    }
    const hasMore = results.length === resultsPerPage;
    const searchResult = {
      results: enrichedResults,
      hasMore,
      total: (data.response && data.response.numFound) ? data.response.numFound : 0
    };
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
        // Filter out non-playable items in fallback path too
        const enrichedFallback = [];
        const batchSize = SEARCH_LIMITS.metadataBatchSize; // Process metadata in small batches
        
        for (let i = 0; i < processedFallbackResults.length; i += batchSize) {
          const batch = processedFallbackResults.slice(i, i + batchSize);
          const batchPromises = batch.map(async (item) => {
            try {
              const files = await fetchOptimizedPlayableFiles(item.identifier);
              const count = Array.isArray(files) ? files.length : 0;
              if (count > 0) {
                return {
                  ...item,
                  isAlbum: count > 1,
                  trackCount: count
                };
              }
              return null;
            } catch (e) {
              return null;
            }
          });
          const batchResults = (await Promise.all(batchPromises)).filter(Boolean);
          enrichedFallback.push(...batchResults);
        }
        const searchResult = {
          results: enrichedFallback,
          hasMore: fallbackResults.length === resultsPerPage,
          total: (fallbackData.response && fallbackData.response.numFound) ? fallbackData.response.numFound : 0
        };
        if (window.enhancedCache) window.enhancedCache.set('search', cacheKey, searchResult);
        return searchResult;
      }
    } catch (fallbackError) {
      logSearch(fallbackError, 'error', 'NETWORK');
    }
    setSearchErrorMessage('Error in search. Try other terms.');
    return { results: [], hasMore: false };
  } finally {
    if (window.Loaders) {
      window.Loaders.hideLoader();
    }
  }
}

// Auxiliary function to calculate relevance in client
function calculateRelevanceScore(item, query) {
  let score = 0;
  const queryLower = query.toLowerCase();
  const titleLower = safeToLowerCase(item.title);
  const creatorLower = safeToLowerCase(item.creator);
  const descriptionLower = safeToLowerCase(item.description);
  // Points for exact match in title
  if (titleLower.includes(queryLower)) {
    score += 3;
  }
  // Points for exact match in creator
  if (creatorLower.includes(queryLower)) {
    score += 2;
  }
  // Points for match in description
  if (descriptionLower.includes(queryLower)) {
    score += 1;
  }
  // Bonus if title starts with query starting
  if (titleLower.startsWith(queryLower)) {
    score += 2;
  }
  // Bonus if title and creator match query
  if (titleLower.includes(queryLower) && creatorLower.includes(queryLower)) {
    score += 2;
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

async function fetchOptimizedPlayableFiles(identifier) {
  const cached = window.enhancedCache && window.enhancedCache.get('metadata', identifier);
  if (cached) {
    return cached;
  }
  const url = `https://archive.org/metadata/${identifier}`;
  try {
    // Force longer timeout for metadata fetching
    const fetchFn = getSearchFetchFn();
    const metadataTimeout = getSearchConfigNumber('metadataTimeout', SEARCH_DEFAULTS.metadataTimeout);
    const response = await fetchFn(url, { timeout: metadataTimeout });
    if (!(response && response.ok)) throw new Error('Error fetching metadata');
    const metadata = await response.json();
    if (!(metadata && metadata.files)) {
      throw new Error('Invalid metadata');
    }
    let audioFiles = metadata.files.filter(file =>
      isPlayableAudioFile(file)
    );
    // Sort remaining files by format priority (.ogg first, then .mp3, then others)
    audioFiles.sort((a, b) => {
      const aIsOgg = a.name.toLowerCase().endsWith('.ogg');
      const bIsOgg = b.name.toLowerCase().endsWith('.ogg');
      const aIsMp3 = a.name.toLowerCase().endsWith('.mp3');
      const bIsMp3 = b.name.toLowerCase().endsWith('.mp3');
      // Prioritize .ogg over .mp3
      if (aIsOgg && !bIsOgg) return -1;
      if (!aIsOgg && bIsOgg) return 1;
      // Then prioritize .mp3 over other formats
      if (aIsMp3 && !bIsMp3 && !bIsOgg) return -1;
      if (!aIsMp3 && bIsMp3 && !aIsOgg) return 1;
      // Finally sort by size
      return (a.size || 0) - (b.size || 0);
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
      window.Loaders.showLoader({ type: 'spinner' });
    }
    
    logSearch('Loading track...', 'info', 'UI');
    window.showStatus?.(`Loading track...`, 'info', null, 'normal', true);
    
    const files = await fetchOptimizedPlayableFiles(result.identifier);
    
    if (files.length > 0) {
      // Ocultar listas después de obtener los archivos pero antes de reproducir
      if (typeof window.hideSearchResults === 'function') window.hideSearchResults();
      if (typeof window.hideFavoritesList === 'function') window.hideFavoritesList();
      
      if (files.length > 1) {
        if (window.Loaders) {
          window.Loaders.showLoader({ type: 'spinner' });
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
        const firstTrack = files[0];
        // Loader se ocultar� cuando audio.play() inicie
        await window.playAudioTrackOptimized(firstTrack, result.identifier, 0, files.length);
        // Load queue AFTER first track starts playing to avoid blocking
        window.loadPlaybackQueue?.('album', files, 1);
      } else {
        // Create preloaded list with next search results (limit to avoid excessive downloads)
        const searchPlaylist = [];
        const maxResultsToPreload = SEARCH_LIMITS.maxResultsToPreload;
        
        // Preload metadata for only the next few results (not audio files yet)
        for (let i = index; i < Math.min(index + maxResultsToPreload, allResults.length); i++) {
          try {
            const resultFiles = await fetchOptimizedPlayableFiles(allResults[i].identifier);
            if (resultFiles && resultFiles.length > 0) {
              if (resultFiles.length > 1) {
                searchPlaylist.push(resultFiles[0]);
              } else {
                searchPlaylist.push(resultFiles[0]);
              }
            }
          } catch (error) {
            logSearch(error, 'warn', 'NETWORK');
          }
        }
        // Set up preloaded playback
        window.setupPreloadedPlayback?.(searchPlaylist, index);
        // Resetear contador de repetición de search
        const st3 = getSearchStateRef();
        if (st3) {
          if (!st3.contextRepeatCount) st3.contextRepeatCount = {};
          st3.contextRepeatCount['search'] = 0;
        }
        // Load FIFO queue with search results
        window.loadPlaybackQueue?.('search', searchPlaylist, index);
        const track = files[0];
        // Loader se ocultar� cuando audio.play() inicie
        await window.playAudioTrackOptimized(track, result.identifier);
      }
    } else {
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
      logSearch('Playback error occurred', 'error', 'UI');
      window.showStatus?.(`Playback error occurred`, 'error');
    }
  }
}

async function playSpecificSearchTrack(track, albumId, trackIndex, totalTracks) {
  const st = getSearchStateRef();
  if (st && st.isLoading) return;
  
  try {
    if (window.Loaders) {
      window.Loaders.showLoader({ type: 'spinner' });
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
      window.loadPlaybackQueue?.('album', files, trackIndex);
    }
    if (window.Loaders) window.Loaders.hideLoader();
    
    // Loader se ocultar� cuando audio.play() inicie
    await window.playAudioTrackOptimized(track, albumId, trackIndex, totalTracks);
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
    window.Loaders.showLoader({ type: 'spinner' });
  }

  if (typeof window.hideSearchResults === 'function') window.hideSearchResults();
  if (typeof window.hideFavoritesList === 'function') window.hideFavoritesList();
  
  try {
    logSearch('Loading album...', 'info', 'UI');
    window.showStatus?.(`Loading album...`, 'info', null, 'normal', true);
    co// Resetear contador de repetición de álbum
      const st3 = getSearchStateRef();
      if (st3) {
        if (!st3.contextRepeatCount) st3.contextRepeatCount = {};
        st3.contextRepeatCount[albumId] = 0;
      }
      const files = await fetchOptimizedPlayableFiles(albumId);
    if (files.length > 0) {
      if (window.Loaders) {
        window.Loaders.showLoader({ type: 'spinner' });
      }
      if (window.playbackManager) window.playbackManager.setAlbumPlaylist(albumId, files, 0);
      // Don't preload entire album - start playing first track immediately
      // Loader se ocultar� cuando audio.play() inicie
      await window.playAudioTrackOptimized(files[0], albumId, 0, files.length);
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
      window.Loaders.showLoader({ type: 'spinner' });
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
      if (window.Loaders) window.Loaders.hideLoader();
      }
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
        window.showStatus?.('Favorite isn\'t offline. Skipping it', 'error', 2000);
        const nextIndex = (actualIndex + 1) % window.state.favorites.length;
        return playOptimizedFavorite(nextIndex);
    if (window.Loaders) {
      window.Loaders.showLoader({ type: 'spinner' });
    }
    
      }
      await window.playAudioTrackOptimized(track, favorite.id, favorite.trackIndex, favorite.totalTracks);
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
    // Create playlist with first N tracks from results (limit to avoid excessive downloads)
    const searchPlaylist = [];
    const maxResultsToLoad = SEARCH_LIMITS.maxResultsToLoad; // Limit to first 10 results to avoid excessive parallel loading
    
    // Load tracks in batches to avoid excessive parallel fetches
    const batchSize = SEARCH_LIMITS.playlistBatchSize;
    for (let i = 0; i < Math.min(maxResultsToLoad, results.length); i += batchSize) {
      const batch = results.slice(i, i + batchSize);
      const batchPromises = batch.map(async (result) => {
        try {
          const files = await fetchOptimizedPlayableFiles(result.identifier);
          if (files && files.length > 0) {
            // For albums, add all tracks
            if (files.length > 1) {
              return files;
            } else {
              // For individual tracks, add single track
              return [files[0]];
            }
          }
          return [];
        } catch (error) {
          logSearch(error, 'warn', 'NETWORK');
          return [];
        }
      });
      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(tracks => searchPlaylist.push(...tracks));
    }
    
    if (searchPlaylist.length === 0) {
      throw new Error('Could not load tracks from results');
    }
    // Set up preloaded playback
    window.setupPreloadedPlayback?.(searchPlaylist, 0);
    // Load FIFO queue with search results
    window.loadPlaybackQueue?.('search', searchPlaylist, 0);
    // Play first track
    const firstTrack = searchPlaylist[0];
    await window.playAudioTrackOptimized(firstTrack, firstTrack.id, 0, 1);
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

window.performOptimizedSearch = performOptimizedSearch;
window.playOptimizedSearchResult = playOptimizedSearchResult;
window.playSpecificSearchTrack = playSpecificSearchTrack;
window.playAlbumFromFavorites = playAlbumFromFavorites;
window.playOptimizedFavorite = playOptimizedFavorite;
window.playRandomSearchResults = playRandomSearchResults;