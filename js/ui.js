// Search configuration
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
  searchInput: document.getElementById('search-input'),
  searchResults: document.getElementById('search-results'),
  searchResultsList: document.getElementById('search-results-list'),
  searchLoader: document.getElementById('search-loader'),
  playAllFavoritesBtn: document.getElementById('play-all-favorites-btn'),
  favoritesToggle: document.getElementById('favorites-toggle'),
  favoritesList: document.getElementById('favorites-list'),
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
  repeatBtn: document.getElementById('repeat-btn'),
  currentTrackShare: document.getElementById('current-track-share')
};

// Search configuration
const SEARCH_CONFIG = {
  resultsPerPage: 5,
  timeout: 8000,
  enableLazyLoading: true
};

// Loader Manager - Centralized loader state management
class LoaderManager {
  constructor() {
    this.activeLoaders = new Set();
  }

  /**
   * Show loader on play button
   * @param {string} context - Context identifier for tracking
   */
  showPlayButtonLoader(context = 'default') {
    if (this.activeLoaders.has(`play-${context}`)) return;

    this.activeLoaders.add(`play-${context}`);
    elements.playBtn.disabled = true;
    elements.playBtn.innerHTML = '<span class="loader" aria-label="Loading" role="status"></span>';
    state.isLoading = true;
  }

  /**
   * Hide loader on play button
   * @param {string} context - Context identifier for tracking
   */
  hidePlayButtonLoader(context = 'default') {
    this.activeLoaders.delete(`play-${context}`);

    // Only restore if no other loaders are active
    if (this.activeLoaders.size === 0) {
      elements.playBtn.disabled = false;
      elements.playBtn.textContent = elements.audio.paused ? '▶' : '| |';
      if (elements.audio.paused) {
        elements.playBtn.classList.remove('playing');
      } else {
        elements.playBtn.classList.add('playing');
      }
      state.isLoading = false;
    }
  }

  /**
   * Show search loader
   */
  showSearchLoader() {
    if (elements.searchLoader) {
      elements.searchLoader.style.display = 'flex';
      elements.searchLoader.setAttribute('aria-live', 'polite');
      elements.searchLoader.setAttribute('aria-label', 'Searching tracks...');
    }
  }

  /**
   * Hide search loader
   */
  hideSearchLoader() {
    if (elements.searchLoader) {
      elements.searchLoader.style.display = 'none';
      elements.searchLoader.removeAttribute('aria-live');
    }
  }

  /**
   * Create a loading overlay for containers
   * @param {HTMLElement} container - Container element
   * @param {string} message - Loading message
   * @returns {HTMLElement} - The loading element
   */
  createContainerLoader(container, message = 'Loading...') {
    const loaderEl = document.createElement('div');
    loaderEl.className = 'container-loader';
    loaderEl.innerHTML = `
      <div class="loader-overlay">
        <span class="loader" aria-label="${message}" role="status"></span>
        <span class="loader-text">${message}</span>
      </div>
    `;

    container.innerHTML = '';
    container.appendChild(loaderEl);
    return loaderEl;
  }

  /**
   * Remove loading overlay from container
   * @param {HTMLElement} container - Container element
   */
  removeContainerLoader(container) {
    const loader = container.querySelector('.container-loader');
    if (loader) {
      loader.remove();
    }
  }
}

// Global loader manager instance
const loaderManager = new LoaderManager();

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
  isAndroid: /Android/.test(navigator.userAgent),
  expandedAlbums: new Set(),
  shuffleFavorites: false,
  repeatMode: 'all', // 'all', 'one', 'off'
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

  currentSearchPage: 0,
  currentSearchHasMore: false,
  currentSearchQuery: '',
  isLoadingMore: false,
  savedPlaybackState: null
};

// Favorites management
function loadFavorites() {
  try {
    window.logger.info('Loading favorites from localStorage...', 'UI');
    const favorites = localStorage.getItem('resonate_favorites');
    window.logger.debug('Raw favorites from localStorage retrieved', 'UI');

    if (favorites) {
      let parsedFavorites = JSON.parse(favorites);
      window.logger.debug(`Parsed ${parsedFavorites.length} favorites`, 'UI');

      // Filter out unsupported format favorites (keep .ogg and .mp3)
      const originalCount = parsedFavorites.length;
      parsedFavorites = parsedFavorites.filter(fav => {
        if (!fav.url) return false;
        const url = fav.url.toLowerCase();
        return url.endsWith('.ogg') || url.endsWith('.mp3');
      });

      if (parsedFavorites.length < originalCount) {
        // Save filtered favorites back to localStorage
        localStorage.setItem('resonate_favorites', JSON.stringify(parsedFavorites));
        window.logger.info(`Filtered ${originalCount - parsedFavorites.length} unsupported format favorites`, 'UI');
      }

      state.favorites = parsedFavorites;
      window.logger.info(`Final favorites loaded: ${state.favorites.length} items`, 'UI');

      // Precargar favoritos en cola FIFO
      if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.preloadFavorites === 'function') {
        audioCache.preloadFavorites(state.favorites);
        window.logger.debug('Favorites preload initiated', 'CACHE');
      }
    } else {
      window.logger.info('No favorites found in localStorage', 'UI');
      state.favorites = [];
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
    const payload = JSON.stringify(state.favorites || []);
    localStorage.setItem('resonate_favorites', payload);
    window.logger.debug('Favorites saved to localStorage', 'UI');
    // Request preload/update of favorites in cache if available
    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.preloadFavorites === 'function') {
      audioCache.preloadFavorites(state.favorites || []);
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
        elements.audio.volume = volume;
        if (elements.volumeSlider) {
          elements.volumeSlider.value = volume;
        }
      }
    }

    if (savedMuted === 'true') {
      elements.audio.muted = true;
      updateVolumeIcon();
    } else {
      elements.audio.muted = false;
    }

    updateVolumeIcon();
  } catch (e) {
    window.logger.warn(`Error loading volume settings: ${e.message}`, 'UI');
    // Set default volume
    elements.audio.volume = 0.7;
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
    window.logger.warn(`Error saving volume: ${e.message}`, 'UI');
  }
}

function saveMutedState(muted) {
  try {
    localStorage.setItem('resonate_muted', muted.toString());
  } catch (e) {
    window.logger.warn(`Error saving mute state: ${e.message}`, 'UI');
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

function toggleFavorite(track) {
  if (!track || !track.url) return;

  // Only allow .ogg and .mp3 files to be favorited
  const urlLower = track.url.toLowerCase();
  if (!urlLower.endsWith('.ogg') && !urlLower.endsWith('.mp3')) {
    showStatus('Only .ogg and .mp3 are supported', 'error');
    return;
  }

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
    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.prefetchAudio === 'function') {
      audioCache.prefetchAudio(track.url, true);
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
        title: track.title || 'Untitled',
        creator: track.creator || 'Unknown',
        url: track.url,
        isAlbumTrack: true,
        albumId: albumId,
        trackIndex: index,
        totalTracks: files.length,
        albumTitle: track.album || files[0]?.album || 'Album'
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
  const resultElements = document.querySelectorAll('.search-result');
  resultElements.forEach(resultEl => {
    const resultInfo = resultEl.querySelector('.result-info');
    if (resultInfo && resultInfo.textContent.includes(albumId)) {
      const favoriteBtn = resultEl.querySelector('.result-favorite');
      if (favoriteBtn) {
        favoriteBtn.classList.toggle('active', isFavorite);
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

function showStatus(message, type = 'info', duration = null, priority = 'normal') {
  console.log('showStatus called with:', message, type, duration, priority);
  if (!elements.statusMessages) {
    console.error('statusMessages element not found');
    return;
  }

  const currentMessage = elements.statusMessages.querySelector('.status-message');
  const currentPriority = currentMessage ? currentMessage.dataset.priority || 'normal' : 'none';

  // Priority levels: offline > error > warning > info > normal
  const priorityLevels = { 'offline': 5, 'error': 4, 'warning': 3, 'info': 2, 'normal': 1, 'none': 0 };

  // Don't overwrite higher or equal priority messages
  if (priorityLevels[currentPriority] >= priorityLevels[priority]) {
    console.log('Not showing message due to priority:', currentPriority, '>=', priority);
    return;
  }

  elements.statusMessages.innerHTML = '';

  const messageEl = document.createElement('div');
  messageEl.className = `status-message status-${type}`;
  messageEl.textContent = message;
  messageEl.dataset.priority = priority;
  messageEl.setAttribute('aria-live', 'polite');
  messageEl.setAttribute('aria-atomic', 'true');
  elements.statusMessages.appendChild(messageEl);

  console.log('Message element added:', messageEl);

  // Auto-determine duration - TODOS los mensajes se ocultan automáticamente
  let finalDuration = duration;
  
  if (finalDuration === null || finalDuration === 0) {
    // Default durations by type and priority
    // Garantizar que TODOS los mensajes tengan auto-ocultamiento
    if (type === 'error' || type === 'offline') {
      finalDuration = 5000; // Errors and offline: 5 seconds
    } else if (type === 'warning') {
      finalDuration = 4000; // Warnings: 4 seconds
    } else if (type === 'info') {
      finalDuration = 3000; // Info: 3 seconds
    } else {
      finalDuration = 3000; // Default: 3 seconds
    }
  }

  // GARANTÍA: Todos los mensajes SIEMPRE se ocultan después de su duración
  setTimeout(() => {
    if (messageEl.parentNode) {
      messageEl.remove();
      console.log('Message removed after timeout');
    }
  }, finalDuration);
}

// Test function to show a message that auto-hides
function showTestStatus() {
  showStatus('Test message - auto-hides in 3 seconds', 'info');
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

  const archiveCoverUrl = `https://archive.org/services/img/${identifier}`;

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
  elements.searchResults.classList.remove('active');
  state.searchActive = false;
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
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || 'Untitled',
      artist: track.creator || 'Unknown',
      album: track.album || identifier
    });

    updateMediaPositionState();
  } catch (error) {
    console.error('Error updating Media Session:', error);
  }
}

function setupSearchOnEnter() {
  console.log('Setting up search event listener...');
  elements.searchInput.addEventListener('keydown', (e) => {
    console.log('Key pressed:', e.key);
      if (e.key === 'Enter') {
        console.log('Enter key pressed, performing search...');
        state.currentSearchPage = 0;
        state.currentSearchQuery = elements.searchInput.value.trim();
        console.log('Search query:', state.currentSearchQuery);
        if (state.currentSearchQuery) {
          // Show search loader
          loaderManager.showSearchLoader();
          elements.searchResults.classList.add('active');
          performOptimizedSearch(state.currentSearchQuery, 0).then(result => {
            displaySearchResults(result);
            // Add to search history after successful search
            addToSearchHistory(state.currentSearchQuery);
          }).catch(error => {
            console.error('Search error:', error);
            showStatus('Search encountered an error', 'error');
            // Hide loader on error
            loaderManager.hideSearchLoader();
          });
        } else {
          hideSearchResults();
        }
      }
  });
}

function setupSearchFocusBehavior() {
  let lastSearchQuery = '';
  let isCleaning = false;

  elements.searchInput.addEventListener('focus', () => {
    if (isCleaning) return;

    const currentQuery = elements.searchInput.value.trim();

    // If input is empty, show search history
    if (currentQuery === '') {
      displaySearchHistory();
      state.searchActive = true;
      // Auto-hide favorites when search is active
      hideFavoritesList();
      return;
    }

    // If input has text, show results or perform search
    if (currentQuery.length > 0) {
      // Auto-hide favorites when search is active
      hideFavoritesList();

      // If we have matching results for this query, show them
      if (state.searchResults.length > 0 && currentQuery === state.currentSearchQuery) {
        elements.searchResults.classList.add('active');
        state.searchActive = true;
        return;
      }

      // Otherwise, perform new search with current query
      loaderManager.showSearchLoader();
      elements.searchResults.classList.add('active');
      state.searchActive = true;
      performOptimizedSearch(currentQuery, 0).then(result => {
        displaySearchResults(result);
      }).catch(error => {
        console.error('Search error:', error);
        showStatus('Search problem occurred', 'error');
        loaderManager.hideSearchLoader();
      });
    }
  });

  elements.searchInput.addEventListener('input', (e) => {
    const currentQuery = e.target.value.trim();

    // Detectar si el usuario está borrando
    if (currentQuery.length < lastSearchQuery.length) {
      isCleaning = true;

      // Realizar limpieza completa inmediatamente
      performCompleteCleanup();
    }
    else {
      isCleaning = false;
      displaySearchResults();

      // Auto-hide favorites when search is active
      if (currentQuery.length > 0) {
        hideFavoritesList();
      }
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

  console.log('Cleanup complete: search results hidden and state reset');
}

function hideSearchResults() {
  // Verificar si había resultados para ocultar antes de limpiar y registrar
  const hadActiveResults = elements.searchResults && elements.searchResults.classList.contains('active');

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

  // Solo registrar si efectivamente había resultados activos naturales (no siempre).
  if (hadActiveResults) {
    console.log('Search results hidden and cleared');
  }
}

function displaySearchResults(searchData, clearExisting = true) {
  // Hide search loader when results arrive
  loaderManager.hideSearchLoader();

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

  if (results.length === 0 && clearExisting) {
    elements.searchResultsList.innerHTML = '<div class="no-results">No results found</div>';
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
  // Skip metadata loading only for file:// protocol to avoid CORS timeout errors
  const isFileProtocol = window.location.protocol === 'file:';
  if (isFileProtocol) {
    const metaElement = resultEl.querySelector('.result-meta');
    if (metaElement) {
      metaElement.innerHTML = '<span style="color: var(--muted); font-size: 10px;">Info no disponible (file://)</span>';
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
      if (trackCount === 0) {
        metaElement.innerHTML = '<span style="color: var(--muted); font-size: 10px;">No playable tracks</span>';
      } else {
        metaElement.innerHTML = isAlbum ?
          `<span class="album-indicator">${trackCount} tracks</span>` :
          `<span class="album-indicator">Single track</span>`;
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
      expandButton.style.display = trackCount > 1 ? 'inline-block' : 'none';
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

  const creatorDiv = document.createElement('div');
  creatorDiv.className = 'result-creator';
  creatorDiv.textContent = result.creator || 'Unknown';

  const metaDiv = document.createElement('div');
  metaDiv.className = 'result-meta';
  const albumSpan = document.createElement('span');
  albumSpan.className = 'result-album';
  metaDiv.appendChild(albumSpan);

  infoDiv.appendChild(titleDiv);
  infoDiv.appendChild(creatorDiv);
  infoDiv.appendChild(metaDiv);

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

  // Album indicator will be added by loadAlbumInfoBackground
  const metaDiv = document.createElement('div');
  metaDiv.className = 'result-meta'; // Keep for compatibility with loadAlbumInfoBackground
  const albumSpan = document.createElement('span');
  albumSpan.className = 'result-album';
  metaDiv.appendChild(albumSpan);

  infoDiv.appendChild(titleDiv);
  infoDiv.appendChild(creatorDiv);
  infoDiv.appendChild(metaDiv);

  return infoDiv;
}

function createFavoriteActions(result, hasFavoriteTrack) {
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'favorite-actions';

  // Play button
  const playBtn = document.createElement('button');
  playBtn.className = '';
  playBtn.title = 'Play';
  playBtn.textContent = '▶';

  // Favorite button
  const favoriteBtn = document.createElement('button');
  favoriteBtn.className = ` ${hasFavoriteTrack ? 'active' : ''}`;
  favoriteBtn.title = hasFavoriteTrack ? 'Remove from favorites' : 'Add to favorites';
  favoriteBtn.textContent = hasFavoriteTrack ? '❤️' : '🩶';

  // Share button
  const shareBtn = document.createElement('button');
  shareBtn.className = 'result-share';
  shareBtn.title = 'Share';
  shareBtn.textContent = '🔗';

  // Expand button (for albums)
  const expandBtn = document.createElement('button');
  expandBtn.className = ''; // Keep existing class for styling
  expandBtn.title = 'View album tracks';
  expandBtn.textContent = '▼';

  actionsDiv.appendChild(playBtn);
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

  const hasFavoriteTrack = isAlbumInFavorites(result.identifier);

  // Create cover container
  const coverContainer = document.createElement('div');
  coverContainer.className = 'result-cover';

  // Load cover image
  const img = new Image();
  img.alt = 'Album cover';
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
  const { actionsDiv, playBtn, favoriteBtn, shareBtn, expandBtn } = createFavoriteActions(result, hasFavoriteTrack);

  // Show expand button immediately for all results
  expandBtn.style.display = 'inline-block';

  // Add cover to the left, then info and actions
  resultEl.appendChild(coverContainer);
  resultEl.appendChild(infoDiv);
  resultEl.appendChild(actionsDiv);

  // Load album info in background
  loadAlbumInfoBackground(result.identifier, resultEl);

  // Event listeners
  playBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const title = result.title || 'Untitled';
    showStatus(`Loading your track`, 'info');
    await playOptimizedSearchResult(result, globalIndex, state.searchResults);
  });

  shareBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await shareTrack(result.identifier, result.title, result.creator);
  });

  infoDiv.addEventListener('click', async (e) => {
    if (e.target.closest('.result-buttons')) return;
    const title = result.title || 'Untitled';
    showStatus(`Getting track ready`, 'info');
    await playOptimizedSearchResult(result, globalIndex, state.searchResults);
  });

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

// Toggle album tracks visibility
function toggleAlbumTracks(albumId, tracksContainer, expandButton) {
  if (tracksContainer.style.display === 'none') {
    displayAlbumTracks(albumId, tracksContainer);
    tracksContainer.style.display = 'block';
    expandButton.textContent = '▲';
    expandButton.title = '▲';
    state.expandedAlbums.add(albumId);
  } else {
    tracksContainer.style.display = 'none';
    expandButton.textContent = '▼';
    expandButton.title = '▼';
    state.expandedAlbums.delete(albumId);
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

        const isFavorite = isTrackFavorite(track);
        const trackNumber = track.trackNumber || index + 1;

        trackItem.innerHTML = `
          <div class="track-actions">
            <span class="track-number">${trackNumber}</span>
            <button class="track-play" data-url="${track.url}" data-title="${track.title}">▶</button>
            <button class="track-favorite ${isFavorite ? 'active' : ''}">${isFavorite ? '❤️' : '🩶'}</button>
            <button class="track-share" title="Share">🔗</button>
          </div>
          <div class="track-item-info">
            <div class="track-title">${track.title || 'Untitled'}</div>
            <div class="track-creator">${track.creator || 'Unknown'}</div>
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

        // Share button listener
        const shareBtn = trackItem.querySelector('.track-share');
        if (shareBtn) {
          shareBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Evitar que el clic se propague al resultado principal
            shareTrack(track.id || albumId, track.title, track.creator);
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
  // Disable/enable all buttons in the player-content div based on favorites count
  const playerContent = elements.playerContent;
  if (playerContent) {
    const buttons = playerContent.querySelectorAll('button');
    if (buttons) {
      buttons.forEach(button => {
        if (button) button.disabled = state.favorites.length === 0;
      });
    }
  }

  if (!state.favorites || state.favorites.length === 0) {
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

    // Disable favorites controls
    if (elements.favoritesToggle) elements.favoritesToggle.classList.add('disabled');
    if (elements.playAllFavoritesBtn) elements.playAllFavoritesBtn.classList.add('disabled');
  } else {
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
    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.title = 'Shuffle favorites';

    // Enable favorites controls
    if (elements.favoritesToggle) elements.favoritesToggle.classList.remove('disabled');
    if (elements.playAllFavoritesBtn) elements.playAllFavoritesBtn.classList.remove('disabled');
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
    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.title = 'Shuffle results';
  }
}

// Connectivity monitoring
function setupConnectivityMonitoring() {
  state.networkOnline = navigator.onLine;

  window.addEventListener('online', () => {
    state.networkOnline = true;
    showStatus('Internet is back online', 'info', 2000);
    // Re-enable search input when back online
    if (elements.searchInput) {
      elements.searchInput.disabled = false;
      elements.searchInput.placeholder = "Search tracks";
    }
  });

  window.addEventListener('offline', () => {
    state.networkOnline = false;
    showStatus('Offline only. No internet access', 'warning', 4000);
    // Disable search functionality when offline
    if (elements.searchInput) {
      elements.searchInput.disabled = true;
      elements.searchInput.placeholder = "Search unavailable offline";
    }
    // Hide any active search results
    hideSearchResults();
  });
}

// Page visibility and playback resume management
function setupPageVisibilityHandling() {
  // Listen for visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // App is hidden - save state
      savePlaybackState();
    }
  });

  // Also save state when page unloads
  window.addEventListener('beforeunload', savePlaybackState);

  // Also save state when PWA might be closed (pagehide is better for mobile)
  window.addEventListener('pagehide', savePlaybackState);
}

// Offline functionality setup
function setupOfflineFunctionality() {
  // Create offline indicator element
  createOfflineIndicator();

  // Detectar cambios de conectividad
  window.addEventListener('online', () => {
    showStatus('Connection is restored', 'info', 2000);
    state.networkOnline = true;
    updateOfflineIndicator();
    // Try to sync cached data when back online
    syncOfflineData();
  });

  window.addEventListener('offline', () => {
    showStatus('Switched to offline playback', 'info', 4000);
    state.networkOnline = false;
    updateOfflineIndicator();

    // Intentar reproducir desde caché si hay una pista actual
    if (state.currentTrack && elements.audio.src) {
      showStatus('Using cached version of track', 'info', 2000);
    }

    // Show offline-specific UI hints
    showOfflineHints();
  });

  // Initial check
  state.networkOnline = navigator.onLine;
  updateOfflineIndicator();
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
    if (state.favorites && state.favorites.length > 0) {
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
function savePlaybackState() {
  if (state.currentTrack && elements.audio && elements.audio.src) {
    const playbackState = {
      track: state.currentTrack,
      currentTime: elements.audio.currentTime,
      volume: elements.audio.volume,
      muted: elements.audio.muted,
      wasPlaying: !elements.audio.paused,
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

    const savedState = JSON.parse(savedStateStr);
    const age = Date.now() - (savedState.timestamp || 0);
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    if (age < maxAge && savedState.track && savedState.currentTime !== undefined) {
      state.savedPlaybackState = savedState;

      // Restore the track information (but don't start playing yet)
      state.currentTrack = savedState.track;
      elements.title.textContent = state.currentTrack.title;
      elements.creator.textContent = state.currentTrack.totalTracks > 1 ?
        `${state.currentTrack.creator || 'Unknown'} (${state.currentTrack.trackIndex + 1}/${state.currentTrack.totalTracks})` :
        `${state.currentTrack.creator || 'Unknown'}`;
      setArtwork(state.currentTrack, state.currentTrack.id);
      updateFavoriteButton();

      showStatus('Resuming your last track', 'info', 5000);
      return savedState;
    } else {
      // Expired, remove it
      localStorage.removeItem('resonate_playback_state');
      state.savedPlaybackState = null;
    }
  } catch (error) {
    console.warn('Error loading saved playback state:', error);
    state.savedPlaybackState = null;
  }
  return null;
}

function updateFavoritesList() {
  const favoritesList = elements.favoritesList;
  favoritesList.innerHTML = '';

  // Actualizar estado del botón de reproducción
  updatePlayButtonState();

  // Actualizar contador visual
  updateFavoritesCount();

  if (state.favorites.length === 0) {
    favoritesList.innerHTML = '<div class="no-results" style="padding: 12px; text-align: center;">No favorites</div>';
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

    // Highlight currently playing track
    if (state.currentTrack && (
      state.currentTrack.albumId === albumId ||
      state.currentTrack.id === albumId ||
      (isAlbum && albumData.tracks.some(track => track.url === state.currentTrack.url))
    )) {
      albumItem.classList.add('now-playing');
    }

    // Create cover container
    const coverContainer = document.createElement('div');
    coverContainer.className = 'result-cover';

    // Load cover image with lazy loading
    const img = new Image();
    img.alt = 'Album cover';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '6px';

    const archiveCoverUrl = `https://archive.org/services/img/${albumId}`;

    // Configure event listeners BEFORE setting src
    img.onload = () => {
      coverContainer.appendChild(img);
    };

    img.onerror = () => {
      // Let the image fail naturally - no fallback
    };

    // Lazy loading: create intersection observer to load image when visible
    const lazyLoadCover = (entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Load the image when it becomes visible
          img.src = archiveCoverUrl;
          observer.unobserve(entry.target);
        }
      });
    };

    const observer = new IntersectionObserver(lazyLoadCover, {
      rootMargin: '50px' // Load 50px before the image comes into view
    });

    observer.observe(coverContainer);

    // Crear objeto mock para usar createFavoriteInfo
    const mockResult = {
      title: albumData.albumTitle || 'Untitled',
      creator: albumData.albumCreator || 'Unknown',
      identifier: albumId
    };

    // Usar createFavoriteInfo para consistencia
    const infoDiv = createFavoriteInfo(mockResult);

    // Agregar indicador de álbum manualmente
    const metaElement = infoDiv.querySelector('.result-meta');
    if (metaElement && isAlbum) {
      metaElement.innerHTML = `<span class="album-indicator">${albumData.tracks.length} tracks</span>`;
    }

    // Usar createFavoriteActions para consistencia
    const { actionsDiv, playBtn, favoriteBtn, shareBtn, expandBtn } = createFavoriteActions(mockResult, true);

    // Configurar botones
    playBtn.setAttribute('data-id', albumId);
    playBtn.setAttribute('data-is-album', isAlbum);
    favoriteBtn.setAttribute('data-id', albumId);
    expandBtn.setAttribute('data-id', albumId);

    // Mostrar botón de expandir solo para álbumes
    expandBtn.style.display = isAlbum ? 'inline-block' : 'none';

    albumItem.appendChild(coverContainer);
    albumItem.appendChild(infoDiv);
    albumItem.appendChild(actionsDiv);

    // Event listeners
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

    shareBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      shareTrack(albumId, albumData.albumTitle, albumData.albumCreator);
    });

    favoriteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const albumId = favoriteBtn.getAttribute('data-id');

      state.favorites = state.favorites.filter(fav => fav.albumId !== albumId);
      saveFavorites();
      updateFavoritesList();
      updateFavoriteButton();
      showStatus('Favorite was removed', 'info');
    });

    // Agregar funcionalidad de expandir pistas del álbum
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      let tracksContainer = albumItem.nextElementSibling;
      if (!tracksContainer || !tracksContainer.classList.contains('tracks-container')) {
        tracksContainer = document.createElement('div');
        tracksContainer.className = 'tracks-container';
        tracksContainer.style.display = 'none';
        favoritesList.insertBefore(tracksContainer, albumItem.nextSibling); // ← FUERA del favorite-item (CORRECTO)
      }
      toggleAlbumTracks(albumId, tracksContainer, expandBtn);
    });

    favoritesList.appendChild(albumItem);
  });
}

/**
 * FavoritesToggle - Componente para manejar el toggle de la lista de favoritos
 * Maneja la visibilidad, accesibilidad y estado del toggle de favoritos
 */
class FavoritesToggle {
  constructor() {
    this.element = elements.favoritesToggle;
    this.listElement = elements.favoritesList;
    this.isVisible = false;
    this.isDisabled = false;

    this.init();
  }

  /**
   * Inicializa el componente
   */
  init() {
    if (!this.element) {
      console.warn('FavoritesToggle: Element not found');
      return;
    }

    this.updateAriaAttributes();
    this.bindEvents();
  }

  /**
   * Vincula los eventos necesarios
   */
  bindEvents() {
    this.element.addEventListener('click', this.handleClick.bind(this));
    this.element.addEventListener('keydown', this.handleKeydown.bind(this));
  }

  /**
   * Maneja el clic en el toggle
   */
  handleClick(event) {
    event.preventDefault();
    event.stopPropagation();

    if (this.isDisabled) return;

    // Ocultar resultados de búsqueda si están activos
    if (state.searchActive) {
      hideSearchResults();
    }

    this.toggle();

    // Log para debugging
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
    if (!this.isVisible) return;
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
    } else {
      this.listElement?.classList.remove('active');
      this.element?.classList.remove('active');
    }
  }

  /**
   * Actualiza los atributos ARIA para accesibilidad
   */
  updateAriaAttributes() {
    if (!this.element) return;

    const isExpanded = this.isVisible ? 'true' : 'false';
    this.element.setAttribute('aria-expanded', isExpanded);
    this.element.setAttribute('aria-label',
      `Favorites list ${this.isVisible ? 'visible' : 'hidden'}`
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
  if (countElement) {
    const count = state.favorites ? state.favorites.length : 0;
    countElement.textContent = `(${count})`;
  }
}

function hideFavoritesList() {
  if (favoritesToggleInstance) {
    favoritesToggleInstance.hide();
  } else {
    // Fallback si la instancia no está disponible
    state.favoritesVisible = false;
    elements.favoritesList?.classList.remove('active');
    elements.favoritesToggle?.classList.remove('active');
    elements.favoritesToggle?.setAttribute('aria-expanded', 'false');
  }
}

function startApp() {
  state.appStarted = true;
  elements.startView.classList.add('hidden');
  elements.app.classList.add('active');
  forcePlay();
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
      <button id="start-favorites-btn" style="background:#6ee7b7; color:#000; border:none; padding:8px 12px; font-size:14px; border-radius:12px; cursor:pointer;">Play favorites</button>
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

// Hide favorites list when playing a favorite
function addHideFavoritesOnPlay() {
  // In playFromFavoritesQueue
  const originalPlayFromFavoritesQueue = window.playFromFavoritesQueue;
  window.playFromFavoritesQueue = async function (...args) {
    hideFavoritesList();
    return originalPlayFromFavoritesQueue.apply(this, args);
  };

  // In playAlbumFromFavorites
  const originalPlayAlbumFromFavorites = window.playAlbumFromFavorites;
  window.playAlbumFromFavorites = async function (...args) {
    hideFavoritesList();
    return originalPlayAlbumFromFavorites.apply(this, args);
  };

  // In playSpecificTrack
  const originalPlaySpecificTrack = window.playSpecificTrack;
  window.playSpecificTrack = async function (...args) {
    hideFavoritesList();
    return originalPlaySpecificTrack.apply(this, args);
  };
}

// Register service worker and handle updates
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    if (window.location.protocol === 'https:' || window.location.hostname === 'localhost') {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          registration.update().catch(err => console.warn('Update SW error:', err));
          if (registration.waiting) {
            try {
              registration.waiting.postMessage({ type: 'SKIP_WAITING' });
              showStatus('App is updating right now', 'info', 3000);
            } catch (e) {
              if (typeof registration.waiting.skipWaiting === 'function') {
                registration.waiting.skipWaiting();
              }
            }
          }
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                if (isRunningAsPWA()) {
                  try {
                    newWorker.postMessage({ type: 'SKIP_WAITING' });
                    showStatus('App update is installing', 'info', 3000);
                  } catch (err) {
                    console.warn('SKIP_WAITING error:', err);
                  }
                } else {
                  showStatus('New version available for you', 'info', 5000);
                }
              }
            });
          });
        })
        .catch((error) => {
          console.error('Service Worker registration error:', error);
        });

      let swRefreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (swRefreshing) return;
        swRefreshing = true;
        window.location.reload();
      });
    }
  }
}

// PWA installation prompt setup
function setupPWAInstall() {
  if (isRunningAsPWA()) return; // Don't show if already installed

  // Check if user previously dismissed the banner
  const dismissed = localStorage.getItem('resonate_pwa_banner_dismissed') === 'true';
  if (dismissed) return;

  let deferredPrompt;

  // Define installPWA function first to ensure it's available
  window.installPWA = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        showStatus('Resonate is installing', 'info', 3000);
      }
      hidePWAInstallBanner();
      deferredPrompt = null;
    }
  };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showPWAInstallBanner();
  });
}

// Show PWA install banner
function showPWAInstallBanner() {
  // Check if banner already exists
  if (document.getElementById('pwa-install-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.className = 'pwa-install-banner';
  banner.innerHTML = `
    <div class="pwa-banner-content">
      <div class="pwa-banner-text">
        <div class="pwa-banner-buttons">Install Resonate for a better experience
          <button class="pwa-install-btn">Install</button>
          <button class="pwa-close-btn" aria-label="Close">✕</button>
        </div>
      </div>
    </div>
  `;

  // Add event listeners
  const installBtn = banner.querySelector('.pwa-install-btn');
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
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
         window.navigator.standalone === true;
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
    return;
  }

  const fragment = document.createDocumentFragment();

  history.forEach((query, index) => {
    const historyItem = document.createElement('div');
    historyItem.className = 'search-history-item';

    historyItem.innerHTML = `
      <div class="history-content">
        <span class="history-query">${query}</span>
        <button class="history-remove" data-index="${index}" title="Remove">✕</button>
      </div>
    `;

    // Click on query to search
    historyItem.addEventListener('click', (e) => {
      if (!e.target.classList.contains('history-remove')) {
        elements.searchInput.value = query;
        // Trigger search
        state.currentSearchPage = 0;
        state.currentSearchQuery = query;
        loaderManager.showSearchLoader();
        elements.searchResults.classList.add('active');
        performOptimizedSearch(query, 0).then(result => {
          displaySearchResults(result);
        }).catch(error => {
          console.error('Search error:', error);
          showStatus('Search error', 'error');
          loaderManager.hideSearchLoader();
        });
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

// Update Open Graph meta tags for rich previews
function updateMetaTags(track, identifier) {
  if (!track || !identifier) return;

  const baseUrl = window.location.origin;
  const shareUrl = `${baseUrl}${window.location.pathname}?play=${encodeURIComponent(identifier)}`;
  const imageUrl = `https://archive.org/services/img/${identifier}`;

  // Update title and description
  document.title = `${track.title} - ${track.creator} | Resonate Player`;

  // Update Open Graph tags
  updateMetaTag('property', 'og:title', `${track.title} - ${track.creator}`);
  updateMetaTag('property', 'og:description', `Listen to "${track.title}" by ${track.creator} on Resonate Player. Free music from archive.org.`);
  updateMetaTag('property', 'og:image', imageUrl);
  updateMetaTag('property', 'og:url', shareUrl);

  // Update Twitter tags
  updateMetaTag('property', 'twitter:title', `${track.title} - ${track.creator}`);
  updateMetaTag('property', 'twitter:description', `Listen to "${track.title}" by ${track.creator} on Resonate Player. Free music from archive.org.`);
  updateMetaTag('property', 'twitter:image', imageUrl);
  updateMetaTag('property', 'twitter:url', shareUrl);

  // Update basic meta description
  updateMetaTag('name', 'description', `Listen to "${track.title}" by ${track.creator} on Resonate Player. Free music from archive.org.`);

  console.log('Meta tags updated for sharing:', { title: track.title, creator: track.creator, imageUrl, shareUrl });
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
async function shareTrack(identifier, title = 'Track', creator = 'Unknown') {
  const shareUrl = `${window.location.origin}${window.location.pathname}?play=${encodeURIComponent(identifier)}`;
  const shortTitle = `"${title}"`;
  const shareTitle = `You might like this!\n${shortTitle}`;
  const shareText = `${shareTitle}\n\nEnjoy it freely on Resonate Player`;

  console.log('Attempting to share:', { shareUrl, shareTitle, shareText });

  // Update Open Graph meta tags for rich previews
  updateMetaTagsForSharing(identifier, title, creator);

  // Try to get cover image for sharing
  let coverFile = null;
  try {
    coverFile = await getCoverImageForSharing(identifier);
    console.log('Cover image obtained for sharing');
  } catch (error) {
    console.warn('Could not get cover image:', error.message);
    // Continue without image
  }

  // Try Web Share API first (for mobile and supported browsers)
  if (navigator.share) {
    try {
      console.log('Usando Web Share API con mensaje enriquecido');

      const shareData = {
        title: shareTitle,
        text: shareText,
        url: shareUrl
      };

      // Add image if available and supported
      if (coverFile && navigator.canShare && navigator.canShare({ files: [coverFile] })) {
        shareData.files = [coverFile];
        console.log('Incluyendo imagen de portada en el compartir');
      }

      await navigator.share(shareData);
      console.log('Web Share API exitoso');
      showStatus('Track shared successfully', 'info', 6000);
      return;
    } catch (error) {
      console.log('Web Share API falló:', error.message);
      // User cancelled or error - fallback to clipboard
      // Continue to fallback, don't show error message yet
    }
  } else {
    console.log('Web Share API no disponible');
  }

  // Fallback: Copy to clipboard
  try {
    console.log('Intentando copiar al portapapeles');
    await navigator.clipboard.writeText(shareText);
    console.log('Portapapeles exitoso');
    showStatus('Share link copied', 'info', 6000);
  } catch (clipboardError) {
    console.error('Clipboard API falló:', clipboardError.message);
    // Last resort: show URL for manual copying
    try {
      // Try to show a simple alert with the URL
      alert(`Copy this link to share:\n\n${shareUrl}`);
      showStatus('Share link in popup', 'info', 6000);
    } catch (alertError) {
      // If alert also fails, show in status
      console.error('Alert también falló:', alertError.message);
      showStatus('Here is your share link', 'warning', 10000);
    }
  }
}

// Get cover image as File for sharing
async function getCoverImageForSharing(identifier) {
  const coverUrl = `https://archive.org/services/img/${identifier}`;

  try {
    const response = await fetch(coverUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();

    // Create File from Blob
    const filename = `cover-${identifier}.jpg`;
    return new File([blob], filename, { type: blob.type });
  } catch (error) {
    console.error('Error obteniendo imagen de portada:', error);
    throw error;
  }
}

// Update meta tags for rich sharing (Open Graph, Twitter Cards)
function updateMetaTagsForSharing(identifier, title, creator) {
  const baseUrl = window.location.origin;
  const shareUrl = `${baseUrl}${window.location.pathname}?play=${encodeURIComponent(identifier)}`;
  const imageUrl = `https://archive.org/services/img/${identifier}`;

  // Update page title
  document.title = `${title} - ${creator} | Resonate Player`;

  // Update Open Graph tags
  updateMetaTag('property', 'og:title', `${title} - ${creator}`);
  updateMetaTag('property', 'og:description', `Listen to "${title}" by ${creator} on Resonate Player. Free music from archive.org.`);
  updateMetaTag('property', 'og:image', imageUrl);
  updateMetaTag('property', 'og:url', shareUrl);
  updateMetaTag('property', 'og:type', 'music.song');

  // Update Twitter Card tags
  updateMetaTag('property', 'twitter:card', 'summary_large_image');
  updateMetaTag('property', 'twitter:title', `${title} - ${creator}`);
  updateMetaTag('property', 'twitter:description', `Listen to "${title}" by ${creator} on Resonate Player. Free music from archive.org.`);
  updateMetaTag('property', 'twitter:image', imageUrl);
  updateMetaTag('property', 'twitter:url', shareUrl);

  // Update basic meta description
  updateMetaTag('name', 'description', `Listen to "${title}" by ${creator} on Resonate Player. Free music from archive.org.`);

  console.log('Meta tags updated for sharing with cover:', {
    title: `${title} - ${creator}`,
    imageUrl,
    shareUrl
  });
}

// Expose critical functions globally for cross-module access
window.loadFavorites = loadFavorites;
window.saveFavorites = saveFavorites;
window.loadVolume = loadVolume;
window.saveVolume = saveVolume;
window.saveMutedState = saveMutedState;
window.showStatus = showStatus;
window.updatePlayButtonState = updatePlayButtonState;
window.startApp = startApp;
window.createStartFavoritesCTA = createStartFavoritesCTA;
window.hideStartFavoritesCTA = hideStartFavoritesCTA;
window.registerServiceWorker = registerServiceWorker;
window.setupPWAInstall = setupPWAInstall;
window.displaySearchResults = displaySearchResults;
window.hideSearchResults = hideSearchResults;
window.hideFavoritesList = hideFavoritesList;
window.loadSearchHistory = loadSearchHistory;
window.saveSearchHistory = saveSearchHistory;
window.addToSearchHistory = addToSearchHistory;
window.displaySearchHistory = displaySearchHistory;
window.clearSearchHistory = clearSearchHistory;
window.removeFromSearchHistory = removeFromSearchHistory;
window.state = state;
window.elements = elements;
