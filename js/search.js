// Search functionality

async function performOptimizedSearch(query, page = 0) {
  if (!query.trim()) {
    elements.searchResults.classList.remove('active');
    state.searchActive = false;
    return { results: [], hasMore: false };
  }

  const cacheKey = `search:${query}:${page}`;
  const cached = enhancedCache.get('search', cacheKey);

  if (cached) {
    console.log('Cached results count:', cached.results.length);
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
      description: item.description || '', // Ensure description is included
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
          title: item.title || 'Untitled',
          creator: item.creator || 'Unknown',
          description: '',
          isAlbum: null,
          trackCount: null,
          relevanceScore: 0.5 // Neutral score for fallback results
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
      console.error('Fallback also failed:', fallbackError);
    }

    elements.searchResultsList.innerHTML = '<div class="no-results">Error in search. Try other terms.</div>';
    return { results: [], hasMore: false };
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

async function fetchOptimizedPlayableFiles(identifier, timeoutMs = 10000) {
  const cached = enhancedCache.get('metadata', identifier);

  if (cached) {
    return cached;
  }

  const url = `https://archive.org/metadata/${identifier}`;

  try {
    const response = await fetchWithTimeout(url, { timeout: timeoutMs });
    if (!response.ok) throw new Error('Error fetching metadata');
    const metadata = await response.json();

    if (!metadata?.files) {
      throw new Error('Invalid metadata');
    }

    let audioFiles = metadata.files.filter(file =>
      isPlayableAudioFile(file)
    );

    // Sort remaining files by size (backup sorting)
    audioFiles.sort((a, b) => {
      const aIsMp3 = a.name.toLowerCase().endsWith('.mp3');
      const bIsMp3 = b.name.toLowerCase().endsWith('.mp3');

      if (aIsMp3 && !bIsMp3) return -1;
      if (!aIsMp3 && bIsMp3) return 1;

      return (a.size || 0) - (b.size || 0);
    });

    if (audioFiles.length === 0) {
      return [];
    }

    const playableFiles = createPlayableFiles(audioFiles, identifier, metadata);

    enhancedCache.set('metadata', identifier, playableFiles);

    return playableFiles;

  } catch (error) {
    console.error('Error loading optimized files:', error);
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
          creator: trackInfo.artist || metadata.metadata?.creator || 'Unknown artist',
          description: metadata.metadata?.description || '', // Added description
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
      creator: trackInfo.artist || metadata.metadata?.creator || 'Unknown artist',
      description: metadata.metadata?.description || '', // Added description
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

async function playOptimizedSearchResult(result, index, allResults) {
  if (state.isLoading) {
    console.log('Playback in progress, ignoring click');
    return;
  }

  state.isLoading = true;
  elements.playBtn.disabled = true;
  elements.playBtn.innerHTML = '<span class="loader"></span>';

  try {
    hideSearchResults();
    showStatus(`Loading: ${result.title}`, 'info', 0);

    const files = await fetchOptimizedPlayableFiles(result.identifier);

    if (files.length > 0) {
      if (files.length > 1) {
        showStatus(`Album detected: ${files.length} tracks`, 'info', 2000);
        state.albumOrigin = 'search';
        playbackManager.setAlbumPlaylist(result.identifier, files, 0);

        // Load FIFO queue with album tracks
        loadPlaybackQueue('album', files, 0);

        const firstTrack = files[0];
        await playAudioTrackOptimized(firstTrack, result.identifier, 0, files.length);
      } else {
        // Create preloaded list with all result tracks
        const searchPlaylist = [];

        // Preload all tracks from all results
        for (let i = 0; i < allResults.length; i++) {
          try {
            const resultFiles = await fetchOptimizedPlayableFiles(allResults[i].identifier);
            if (resultFiles && resultFiles.length > 0) {
              if (resultFiles.length > 1) {
                // For albums, take only first track for simplicity
                searchPlaylist.push(resultFiles[0]);
              } else {
                searchPlaylist.push(resultFiles[0]);
              }
            }
          } catch (error) {
            console.error(`Error preloading result ${i}:`, error);
          }
        }

        // Set up preloaded playback
        setupPreloadedPlayback(searchPlaylist, index);

        // Load FIFO queue with search results
        loadPlaybackQueue('search', searchPlaylist, index);

        const track = files[0];
        await playAudioTrackOptimized(track, result.identifier);
      }
    } else {
      throw new Error('No playable audio files found');
    }

  } catch (error) {
    console.error('Error in playOptimizedSearchResult:', error);

    // Restore state even on error
    state.isLoading = false;
    elements.playBtn.disabled = false;
    elements.playBtn.textContent = '▶';

    if (allResults && index < allResults.length - 1) {
      showStatus(`Error with "${result.title}", trying next...`, 'error', 1500);
      setTimeout(() => {
        playOptimizedSearchResult(allResults[index + 1], index + 1, allResults);
      }, 1500);
    } else {
      showStatus(`Error: ${error.message}`, 'error');
    }
  }
  // NOTE: We remove the finally here because we handle state in catch and in playAudioTrackOptimized
}

async function playSpecificTrack(track, albumId, trackIndex, totalTracks) {
  if (state.isLoading) return;

  state.isLoading = true;
  elements.playBtn.disabled = true;
  elements.playBtn.innerHTML = '<span class="loader"></span>';

  try {
    hideSearchResults();
    showStatus(`Loading: ${track.title}`, 'info', 0);

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
    showStatus(`Error: ${error.message}`, 'error');
  } finally {
    state.isLoading = false;
    elements.playBtn.disabled = false;
    elements.playBtn.textContent = '||';
  }
}

async function playAlbumFromFavorites(albumId) {
  if (state.isLoading) return;

  state.isLoading = true;
  elements.playBtn.disabled = true;
  elements.playBtn.innerHTML = '<span class="loader"></span>';

  try {
    showStatus(`Loading full album...`, 'info', 0);

    const files = await fetchOptimizedPlayableFiles(albumId);

    if (files.length > 0) {
      playbackManager.setAlbumPlaylist(albumId, files, 0);

      // Load FIFO queue with album tracks
      loadPlaybackQueue('album', files, 0);

      await playAudioTrackOptimized(files[0], albumId, 0, files.length);

      showStatus(`Playing full album: ${files[0].album || albumId}`, 'info');
    } else {
      throw new Error('No tracks found in album');
    }

  } catch (error) {
    console.error('Error in playAlbumFromFavorites:', error);
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

    // Validate favorite has URL
    if (!favorite.url) {
      console.error('Favorite without valid URL:', favorite);
      showStatus('Error: Invalid favorite, skipping to next', 'error', 2000);
      const nextIndex = (actualIndex + 1) % state.favorites.length;
      return playOptimizedFavorite(nextIndex);
    }

    showStatus(`Loading favorite: ${favorite.title}`, 'info', 0);

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
    const favoritesQueue = audioCache.getFavoritesQueue();
    const isPreloaded = favoritesQueue.includes(track.url);

    if (isPreloaded) {
      console.log('Playing from preloaded favorites:', track.title);
    } else {
      console.log('Favorite not preloaded, loading from network:', track.title);
    }

    const cached = await audioCache.get(track.url);
    if (!cached && !state.networkOnline) {
      showStatus('Favorite not available offline, skipping...', 'error', 2000);
      const nextIndex = (actualIndex + 1) % state.favorites.length;
      return playOptimizedFavorite(nextIndex);
    }

    await playAudioTrackOptimized(track, favorite.id, favorite.trackIndex, favorite.totalTracks);

    updateShuffleButton();

  } catch (error) {
    console.error('Error in playOptimizedFavorite:', error);
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

// Random search results playback
async function playRandomSearchResults() {
  if (state.isLoading || state.searchResults.length === 0) return;

  state.isLoading = true;
  elements.playBtn.disabled = true;
  elements.playBtn.innerHTML = '<span class="loader"></span>';

  try {
    showStatus('Preparing preloaded playlist...', 'info', 0);

    // Create playlist with all tracks from results
    const searchPlaylist = [];

    // Preload all tracks from results
    for (const result of state.searchResults) {
      try {
        const files = await fetchOptimizedPlayableFiles(result.identifier);
        if (files && files.length > 0) {
          // For albums, add all tracks
          if (files.length > 1) {
            searchPlaylist.push(...files);
          } else {
            // For individual tracks, add single track
            searchPlaylist.push(files[0]);
          }
        }
      } catch (error) {
        console.error(`Error loading tracks for ${result.identifier}:`, error);
      }
    }

    if (searchPlaylist.length === 0) {
      throw new Error('Could not load tracks from results');
    }

    // Set up preloaded playback
    setupPreloadedPlayback(searchPlaylist, 0);

    // Load FIFO queue with search results
    loadPlaybackQueue('search', searchPlaylist, 0);

    // Play first track
    const firstTrack = searchPlaylist[0];
    await playAudioTrackOptimized(firstTrack, firstTrack.id, 0, 1);

    showStatus(`Playing ${searchPlaylist.length} tracks in preloaded order`, 'info', 3000);

  } catch (error) {
    console.error('Error in playRandomSearchResults:', error);
    showStatus(`Error: ${error.message}`, 'error');
  } finally {
    state.isLoading = false;
    elements.playBtn.disabled = false;
    elements.playBtn.textContent = '||';
  }
}

window.playOptimizedSearchResult = playOptimizedSearchResult;
window.playSpecificTrack = playSpecificTrack;
window.playAlbumFromFavorites = playAlbumFromFavorites;
window.playOptimizedFavorite = playOptimizedFavorite;
window.playRandomSearchResults = playRandomSearchResults;
