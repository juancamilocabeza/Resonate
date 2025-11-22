// DOM Elements and state
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
  repeatBtn: document.getElementById('repeat-btn')
};

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
    const favorites = localStorage.getItem('resonate_favorites');
    if (favorites) {
      state.favorites = JSON.parse(favorites);

      // Precargar favoritos en cola FIFO
      audioCache.preloadFavorites(state.favorites);
    }

    // Actualizar estado del botón de reproducción
    updatePlayButtonState();
  } catch (e) {
    state.favorites = [];
    updatePlayButtonState();
  }
}

function saveFavorites() {
  try {
    const payload = JSON.stringify(state.favorites || []);
    localStorage.setItem('resonate_favorites', payload);
    // Request preload/update of favorites in cache if available
    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.preloadFavorites === 'function') {
      audioCache.preloadFavorites(state.favorites || []);
    }
  } catch (err) {
    console.error('Error saving favorites:', err);
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
    console.warn('Error loading volume settings:', e);
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
    console.warn('Error saving volume:', e);
  }
}

function saveMutedState(muted) {
  try {
    localStorage.setItem('resonate_muted', muted.toString());
  } catch (e) {
    console.warn('Error saving mute state:', e);
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
  showStatus(isMuted ? 'Silenciado' : 'Volumen activado', 'info', 1000);
}

function isTrackFavorite(track) {
  if (!track || !track.url) return false;
  return state.favorites.some(fav => fav.url === track.url);
}

function toggleFavorite(track) {
  if (!track || !track.url) return;

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
        audioCache.prefetchAudio(newFavorite.url, true);
      }
    }

    audioCache.remove(track.url);
    showStatus('Removed from favorites', 'info');
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
    audioCache.prefetchAudio(track.url, true);

    showStatus('Agregado a favoritos', 'info');
  }

  saveFavorites();
  updateFavoriteButton();
  updateFavoritesList();
  updatePlayButtonState();
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
        title: track.title || 'Sin título',
        creator: track.creator || 'Desconocido',
        url: track.url,
        isAlbumTrack: true,
        albumId: albumId,
        trackIndex: index,
        totalTracks: files.length,
        albumTitle: track.album || files[0]?.album || 'Álbum'
      };
      state.favorites.push(favoriteTrack);
      addedCount++;

      // Precargar cada favorito en caché
      audioCache.prefetchAudio(track.url, true);
    }
  });

  if (addedCount > 0) {
    saveFavorites();
    updateFavoriteButton();
    updateFavoritesList();
    updatePlayButtonState();
    showStatus(`Álbum agregado a favoritos (${addedCount} pistas)`, 'info');
  } else {
    showStatus('Todas las pistas del álbum ya están en favoritos', 'info');
  }
}

// FUNCIÓN: Remover álbum completo de favoritos
function removeAlbumFromFavorites(albumId) {
  const initialCount = state.favorites.length;
  state.favorites = state.favorites.filter(fav => fav.albumId !== albumId);
  const removedCount = initialCount - state.favorites.length;

  // Remover de la cola FIFO de favoritos
  const favoritesQueue = audioCache.getFavoritesQueue();
  favoritesQueue.forEach(url => {
    const favTrack = state.favorites.find(f => f.url === url);
    if (!favTrack) {
      audioCache.removeFromFavoritesQueue(url);
    }
  });

  saveFavorites();
  updateFavoriteButton();
  updateFavoritesList();
  updatePlayButtonState();

  if (removedCount > 0) {
    showStatus(`Álbum removido de favoritos (${removedCount} pistas)`, 'info');
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
        favoriteBtn.title = isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos';
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

function showStatus(message, type = 'info', duration = 3000) {
  elements.statusMessages.innerHTML = '';

  const messageEl = document.createElement('div');
  messageEl.className = `status-message status-${type}`;
  messageEl.textContent = message;
  elements.statusMessages.appendChild(messageEl);

  if (duration > 0) {
    setTimeout(() => {
      if (messageEl.parentNode) {
        messageEl.remove();
      }
    }, duration);
  }
}

function hideSearchResults() {
  elements.searchResults.classList.remove('active');
  state.searchActive = false;
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
    const artwork = [];
    const isLocal = window.location.protocol === 'file:';
    const resonateIconUrl = 'icons/favicon.svg';

    // Only set artwork if not running locally, as file:// URLs are not allowed in Media Session
    if (!isLocal) {
      artwork.push({ src: resonateIconUrl, sizes: '512x512', type: 'image/svg+xml' });
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || 'Untitled',
      artist: track.creator || 'Unknown',
      album: track.album || identifier,
      artwork: artwork
    });

    updateMediaPositionState();
  } catch (error) {
    console.error('Error updating Media Session:', error);
  }
}

function setupSearchOnEnter() {
  elements.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      state.currentSearchPage = 0;
      state.currentSearchQuery = elements.searchInput.value.trim();
      if (state.currentSearchQuery) {
        performOptimizedSearch(state.currentSearchQuery, 0)
          .then(result => displaySearchResults(result, true));
      } else {
        elements.searchResults.classList.remove('active');
        state.searchActive = false;
      }
      hideSearchResults();
    }
  });
}

function setupSearchFocusBehavior() {
  let lastSearchQuery = '';
  let isCleaning = false;

  elements.searchInput.addEventListener('focus', () => {
    if (isCleaning) return;

    // Restore search results when refocusing if search term still matches
    if (state.searchResults.length > 0 &&
      elements.searchInput.value.trim() === state.currentSearchQuery &&
      state.currentSearchQuery.length > 0) {
      elements.searchResults.classList.add('active');
      state.searchActive = true;

      // Auto-hide favorites when search is active
      hideFavoritesList();
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
    elements.searchResultsList.innerHTML = '<div class="no-results">No se encontraron resultados</div>';
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
  try {
    const metadata = await fetchOptimizedPlayableFiles(identifier);
    const itemMetadata = metadata[0]?.metadata;
    const coverImg = resultEl.querySelector('.result-cover img');
    if (coverImg) {
      preloadCover(identifier, coverImg);
    }
    const isAlbum = metadata.length > 1;
    const trackCount = metadata.length;

    const metaElement = resultEl.querySelector('.result-meta');
    if (metaElement) {
      if (trackCount === 0) {
        metaElement.innerHTML = '<span style="color: var(--muted); font-size: 10px;">No hay pistas reproducibles</span>';
      } else {
        metaElement.innerHTML = isAlbum ?
          `<span class="album-indicator">${trackCount} pistas</span>` :
          `<span class="album-indicator">Pista individual</span>`;
      }
    }

    // Actualizar el estado del botón de favorito
    const favoriteBtn = resultEl.querySelector('.result-favorite');
    if (favoriteBtn) {
      const isFavorite = isAlbumInFavorites(identifier);
      favoriteBtn.classList.toggle('active', isFavorite);
      favoriteBtn.innerHTML = isFavorite ? '❤️' : '🩶';
      favoriteBtn.title = isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos';
    }

    // Si es un álbum, agregar botón para expandir pistas
    if (isAlbum && trackCount > 0 && !resultEl.querySelector('.expand-tracks')) {
      const expandButton = document.createElement('button');
      expandButton.className = 'expand-tracks';
      expandButton.innerHTML = '▼ <span>Ver pistas</span>';
      resultEl.appendChild(expandButton);

      const tracksContainer = document.createElement('div');
      tracksContainer.className = 'tracks-container';
      tracksContainer.style.display = 'none';
      resultEl.appendChild(tracksContainer);

      expandButton.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent triggering result listener
        toggleAlbumTracks(identifier, tracksContainer, expandButton);
      });
    }
  } catch (error) {
    console.error('Error loading album info:', error);
    const metaElement = resultEl.querySelector('.result-meta');
    if (metaElement) {
      metaElement.innerHTML = '<span style="color: var(--muted); font-size: 10px;">Error cargando información</span>';
    }
  }
}

function createSearchResultElement(result, globalIndex) {
  const resultEl = document.createElement('div');
  resultEl.className = 'search-result';

  const hasFavoriteTrack = isAlbumInFavorites(result.identifier);

  resultEl.innerHTML = `
    <div class="result-actions">
      <div class="result-info">
        <div class="result-title">
          ${result.title}
        </div>
          <div class="result-creator">${result.creator}</div>
          <div class="result-meta"><span class="result-album"></span></div>
        </div>
        <button class="result-play-btn" title="Reproducir">
          <span class="play-icon">▶</span>
        </button>
        <button class="result-favorite ${hasFavoriteTrack ? 'active' : ''}" title="${hasFavoriteTrack ? 'Quitar de favoritos' : 'Agregar a favoritos'}">
          ${hasFavoriteTrack ? '❤️' : '🩶'}
        </button>
        <button class="result-expand" title="Ver pistas del álbum">
          <span class="expand-icon">▼</span>
        </button>
      </div>
  `;

  // Cargar información de álbum en segundo plano
  loadAlbumInfoBackground(result.identifier, resultEl);

  // Listener para el botón de reproducción
  const playBtn = resultEl.querySelector('.result-play-btn');
  playBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    showStatus(`Cargando: ${result.title}`, 'info', 0);
    await playOptimizedSearchResult(result, globalIndex, state.searchResults);
  });

  // Listener para el resultado completo (área de información)
  const resultInfo = resultEl.querySelector('.result-info');
  resultInfo.addEventListener('click', async (e) => {
    if (e.target.closest('.result-actions')) return;
    showStatus(`Cargando: ${result.title}`, 'info', 0);
    await playOptimizedSearchResult(result, globalIndex, state.searchResults);
  });

  const favoriteBtn = resultEl.querySelector('.result-favorite');
  favoriteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();

    try {
      const files = await fetchOptimizedPlayableFiles(result.identifier);
      if (files.length > 0) {
        if (files.length > 1) {
          // Es un álbum - agregar/remover todas las pistas
          if (hasFavoriteTrack) {
            removeAlbumFromFavorites(result.identifier);
            favoriteBtn.classList.remove('active');
            favoriteBtn.innerHTML = '🩶';
            favoriteBtn.title = 'Agregar a favoritos';
          } else {
            addAlbumToFavorites(result.identifier, files);
            favoriteBtn.classList.add('active');
            favoriteBtn.innerHTML = '❤️';
            favoriteBtn.title = 'Quitar de favoritos';
          }
        } else {
          // Es una pista individual
          const track = files[0];
          toggleFavorite(track);
          const isNowFavorite = isTrackFavorite(track);
          favoriteBtn.classList.toggle('active', isNowFavorite);
          favoriteBtn.innerHTML = isNowFavorite ? '❤️' : '🩶';
          favoriteBtn.title = isNowFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos';
        }
      }
    } catch (error) {
      console.error('Error al gestionar favorito:', error);
      showStatus('Error al gestionar favorito', 'error');
    }
  });

  const expandBtn = resultEl.querySelector('.result-expand');
  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const tracksContainer = resultEl.querySelector('.tracks-container') ||
      document.createElement('div');

    if (!resultEl.contains(tracksContainer)) {
      tracksContainer.className = 'tracks-container';
      tracksContainer.style.display = 'none';
      resultEl.appendChild(tracksContainer);
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
    expandButton.innerHTML = '▲ <span>Ocultar pistas</span>';
    state.expandedAlbums.add(albumId);
  } else {
    tracksContainer.style.display = 'none';
    expandButton.innerHTML = '▼ <span>Ver pistas</span>';
    state.expandedAlbums.delete(albumId);
  }
}

// Display tracks for an album
function displayAlbumTracks(albumId, tracksContainer) {
  tracksContainer.innerHTML = '<div class="search-loading"><span class="loader"></span></div>';

  fetchOptimizedPlayableFiles(albumId)
    .then(files => {
      tracksContainer.innerHTML = '';

      if (files.length === 0) {
        tracksContainer.innerHTML = '<div class="no-results">No se encontraron pistas</div>';
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
          </div>
          <div class="track-item-info">
            <div class="track-title">${track.title || 'Sin título'}</div>
            <div class="track-creator">${track.creator || 'Desconocido'}</div>
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

        tracksList.appendChild(trackItem);
      });

      tracksContainer.appendChild(tracksList);
    })
    .catch(error => {
      console.error('Error cargando pistas del álbum:', error);
      tracksContainer.innerHTML = '<div class="no-results">Error al cargar las pistas</div>';
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
    if (elements.playBtn) elements.playBtn.title = 'Realiza una búsqueda para comenzar';
    if (elements.prevBtn) elements.prevBtn.title = 'Realiza una búsqueda para comenzar';
    if (elements.nextBtn) elements.nextBtn.title = 'Realiza una búsqueda para comenzar';
    if (elements.favoriteBtn) elements.favoriteBtn.title = 'Realiza una búsqueda para comenzar';
    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.title = 'Realiza una búsqueda para comenzar';

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

    if (elements.playBtn) elements.playBtn.title = 'Reproducir favoritos';
    if (elements.prevBtn) elements.prevBtn.title = 'Pista anterior';
    if (elements.nextBtn) elements.nextBtn.title = 'Siguiente pista';
    if (elements.favoriteBtn) elements.favoriteBtn.title = 'Quitar favorito';
    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.title = 'Mezclar favoritos';

    // Enable favorites controls
    if (elements.favoritesToggle) elements.favoritesToggle.classList.remove('disabled');
    if (elements.playAllFavoritesBtn) elements.playAllFavoritesBtn.classList.remove('disabled');
  }
}

function enableControlsForSearchResults() {
  // Si no hay favoritos pero hay resultados de búsqueda, habilitar los controles
  if (state.favorites.length === 0 && state.searchResults && state.searchResults.length > 0) {
    if (elements.playBtn) elements.playBtn.disabled = false;
    if (elements.playBtn) elements.playBtn.title = 'Reproducir resultado de búsqueda';

    if (elements.favoriteBtn) elements.favoriteBtn.disabled = false;
    if (elements.favoriteBtn) elements.favoriteBtn.title = 'Agregar a favoritos';

    // Los botones prev/next funcionan dentro del contexto de búsqueda
    if (elements.prevBtn) elements.prevBtn.disabled = false;
    if (elements.nextBtn) elements.nextBtn.disabled = false;
    if (elements.prevBtn) elements.prevBtn.title = 'Pista anterior (búsqueda)';
    if (elements.nextBtn) elements.nextBtn.title = 'Siguiente pista (búsqueda)';

    // El botón shuffle funciona con los resultados actuales
    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.disabled = false;
    if (elements.shuffleFavoritesBtn) elements.shuffleFavoritesBtn.title = 'Mezclar resultados';
  }
}

// Connectivity monitoring
function setupConnectivityMonitoring() {
  state.networkOnline = navigator.onLine;

  window.addEventListener('online', () => {
    state.networkOnline = true;
    showStatus('Connection restored', 'info', 2000);
  });

  window.addEventListener('offline', () => {
    state.networkOnline = false;
    showStatus('Offline - Playing from cache', 'error', 3000);
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

// Offlunctionality setup
function setupOfflineFunctionality() {
  // Detectar cambios de conectividad
  window.addEventListener('online', () => {
    showStatus('Conexión restaurada', 'info', 2000);
    state.networkOnline = true;
  });

  window.addEventListener('offline', () => {
    showStatus('Modo offline activado', 'info', 3000);
    state.networkOnline = false;

    // Intentar reproducir desde caché si hay una pista actual
    if (state.currentTrack && elements.audio.src) {
      showStatus('Reproduciendo desde caché', 'info', 2000);
    }
  });
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
        `${state.currentTrack.creator || 'Desconocido'} (${state.currentTrack.trackIndex + 1}/${state.currentTrack.totalTracks})` :
        `${state.currentTrack.creator || 'Desconocido'}`;
      setArtwork(state.currentTrack, state.currentTrack.id);
      updateFavoriteButton();

      showStatus(`Última pista: ${savedState.track.title} en ${formatTime(savedState.currentTime)}`, 'info', 5000);
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

  if (state.favorites.length === 0) {
    favoritesList.innerHTML = '<div class="no-results" style="padding: 12px; text-align: center;">No hay favoritos</div>';
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

    const albumIndicator = isAlbum ?
      `<span class="album-indicator">${albumData.tracks.length} pistas</span>` :
      '';

    albumItem.innerHTML = `
      <div class="favorite-info">
        <div class="favorite-title">
          ${albumData.albumTitle || 'Sin título'}
        </div>
        <div class="favorite-creator">${albumData.albumCreator || 'Desconocido'}</div>
        ${albumIndicator}
      </div>
      <div class="favorite-actions">
        <button class="button" data-id="${albumId}" data-is-album="${isAlbum}">▶</button>
        <button class="button" data-id="${albumId}">❤️</button>
      </div>
     `;

    const coverImg = albumItem.querySelector('.result-cover img');
    if (coverImg) {
      preloadCover(albumId, coverImg);
    }

    const playBtn = albumItem.querySelector('.button');
    const removeBtn = albumItem.querySelector('.button:nth-child(2)');

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

    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const albumId = removeBtn.getAttribute('data-id');

      state.favorites = state.favorites.filter(fav => fav.albumId !== albumId);
      saveFavorites();
      updateFavoritesList();
      updateFavoriteButton();
      showStatus('Eliminado de favoritos', 'info');
    });

    favoritesList.appendChild(albumItem);
  });
}

function toggleFavoritesList() {
  if (elements.favoritesToggle.classList.contains('disabled')) return;

  state.favoritesVisible = !state.favoritesVisible;

  if (state.favoritesVisible) {
    elements.favoritesList.classList.add('active');
    elements.favoritesToggle.textContent = '▲ ❤️';
    updateFavoritesList();
  } else {
    elements.favoritesList.classList.remove('active');
    elements.favoritesToggle.textContent = '▼ ❤️';
  }
}

function hideFavoritesList() {
  state.favoritesVisible = false;
  elements.favoritesList.classList.remove('active');
  elements.favoritesToggle.textContent = '▼ ❤️';
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
      <button id="start-favorites-btn" style="background:#6ee7b7; color:#000; border:none; padding:8px 12px; font-size:14px; border-radius:12px; cursor:pointer;">Reproducir favoritos</button>
      <button id="start-favorites-close" aria-label="Cerrar" style="background:transparent; border:none; color:#666; font-size:16px; cursor:pointer;">✕</button>
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

}

  // Register service worker and handle updates
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
                showStatus('Actualizando aplicación...', 'info', 3000);
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
                      showStatus('Actualización disponible — aplicando ahora...', 'info', 3000);
                    } catch (err) {
                      console.warn('SKIP_WAITING error:', err);
                    }
                  } else {
                    showStatus('Nueva versión disponible. Recarga la aplicación.', 'info', 5000);
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
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      setTimeout(() => {
        if (deferredPrompt) {
          showStatus('¿Quieres instalar Resonate para una mejor experiencia?', 'info', 5000);
        }
      }, 30000);
    });
    window.installPWA = async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          showStatus('Resonate se está instalando...', 'info', 3000);
        }
        deferredPrompt = null;
      }
    };
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
  function handleCoverError(imgElement, retryCount = 0) {
    // Siempre usar el ícono de Resonate
    useSVGPlaceholder(imgElement);
  }
 
  function useSVGPlaceholder(imgElement) {
    imgElement.src = 'icons/favicon.svg';
    imgElement.alt = 'Ícono de Resonate';
    imgElement.style.opacity = '0.8';
    imgElement.style.border = '1px solid #334155';
    imgElement.onerror = null; // Remover handler para evitar loops

    if (window.logger) {
      logger.info('Cover set to Resonate icon', 'UI');
    }
  }

// Función para obtener URL de portada: siempre retornar el ícono de Resonate
function getCoverUrl(identifier, metadata) {
  // Siempre mostrar el ícono de Resonate
  return 'icons/favicon.svg';
}
async function preloadCover(identifier, imgElement) {
  // Siempre usar el ícono de Resonate
  imgElement.src = 'icons/favicon.svg';
  imgElement.alt = 'Ícono de Resonate';
}



  // Exponer la función globalmente
  window.handleCoverError = handleCoverError;
  window.getCoverUrl = getCoverUrl;


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
