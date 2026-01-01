const elements = {
  audio: document.getElementById('audio'),
  art: document.getElementById('art'),
  title: document.getElementById('title'),
  creator: document.getElementById('creator'),
  description: document.getElementById('description'),
    statusMessages: document.getElementById('status-messages'),
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
  searchResults: document.getElementById('search-results'),
  searchResultsList: document.getElementById('search-results-list'),
  searchLoader: document.getElementById('search-loader'),
  playAllFavoritesBtn: document.getElementById('play-all-favorites-btn'),
  favoritesToggle: document.getElementById('favorites-toggle'),
  favoritesList: document.getElementById('favorites-list'),
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
    elements.descriptionContainer.style.display = 'block';
    elements.toggleDescriptionBtn.style.display = '';
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
    elements.descriptionContainer.style.display = 'none';
    elements.toggleDescriptionBtn.style.display = 'none';
    if (modal) modal.style.display = 'none';
    if (modalDesc) modalDesc.innerHTML = '';
  }
}
window.updateDescriptionUI = updateDescriptionUI;

// Title Ticker Management
function updateTitleTicker(titleText) {
  if (!elements.title) return;
  
  // Remover cualquier clase de ticker anterior
  elements.title.classList.remove('ticker');
  
  if (!titleText) return;
  
  // Usar setTimeout para asegurar que el DOM se actualice primero
  setTimeout(() => {
    // Obtener el ancho disponible del contenedor padre
    const container = elements.title.parentElement;
    if (!container) return;
    
    const containerWidth = container.clientWidth;
    const titleWidth = elements.title.scrollWidth;
    
    // Activar ticker si el texto es más ancho que el contenedor
    if (titleWidth > containerWidth) {
      // Calcular duración basada en la longitud del texto
      const duration = Math.max(15, Math.ceil((titleText.length / 30) * 15));
      elements.title.style.animationDuration = duration + 's';
      elements.title.classList.add('ticker');
    }
  }, 0);
}
window.updateTitleTicker = updateTitleTicker;

const SEARCH_CONFIG = {
  resultsPerPage: 6,
  timeout: 8000,
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
  isAndroid: /Android/.test(navigator.userAgent),
  expandedAlbums: new Set(),
  shuffleFavorites: false,
  repeatMode: 'all', // 'all', 'one', 'off'
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
  favoritesPreloadEnabled: true,
  contextReloadCount: {},
  contextRepeatCount: {},

  currentSearchPage: 0,
  currentSearchHasMore: false,
  currentSearchQuery: '',
  isLoadingMore: false,
  savedPlaybackState: null,
  // View mode: 'grid' | 'list' (new card grid by default)
  viewMode: 'grid'
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
        const url = fav.url.toLowerCase();
        return url.endsWith('.ogg') || url.endsWith('.mp3');
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

/**
 * Carga los favoritos desde localStorage, eliminando duplicados, resolviendo conflictos locales
 * y limpiando favoritos huérfanos (sin archivo en caché).
 * Prioriza los favoritos más recientes en caso de conflicto.
 */
function toggleFavorite(track) {
  if (!track || !track.url) return;
      // Limpieza automática de favoritos huérfanos:
      // Elimina favoritos cuyo archivo no existe en la caché local (ni en Cache API ni IndexedDB).
  // Only allow .ogg and .mp3 files to be favorited
  const urlLower = track.url.toLowerCase();
  if (!urlLower.endsWith('.ogg') && !urlLower.endsWith('.mp3')) {
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
      albumTitle: track.album || track.title
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

function showStatus(message, type = 'info', duration = null, priority = 'normal', showSpinner = false) {
  if (!elements.statusMessages) {
    return;
  }

  const currentMessage = elements.statusMessages.querySelector('.status-message');
  const currentPriority = currentMessage ? currentMessage.dataset.priority || 'normal' : 'none';

  // Priority levels: offline > error > warning > info > normal
  const priorityLevels = { 'offline': 5, 'error': 4, 'warning': 3, 'info': 2, 'normal': 1, 'none': 0 };

  // Don't overwrite higher or equal priority messages
  if (priorityLevels[currentPriority] >= priorityLevels[priority]) {
    return;
  }

  // Fade out existing message before replacing
  if (currentMessage) {
    currentMessage.classList.add('fade-out');
    setTimeout(() => {
      if (currentMessage.parentNode) {
        currentMessage.remove();
      }
    }, 300);
  } else {
    elements.statusMessages.innerHTML = '';
  }

  const messageEl = document.createElement('div');
  messageEl.className = `status-message status-${type}`;
  messageEl.dataset.priority = priority;
  messageEl.setAttribute('aria-live', 'polite');
  messageEl.setAttribute('aria-atomic', 'true');
  messageEl.setAttribute('role', 'alert');

  // Add spinner if requested
  if (showSpinner) {
    const spinner = document.createElement('span');
    spinner.className = 'loader';
    spinner.style.marginRight = '8px';
    messageEl.appendChild(spinner);
  }

  // Add message text
  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  messageEl.appendChild(textSpan);

  elements.statusMessages.appendChild(messageEl);

  // Auto-determine duration
  let finalDuration = duration;
  
  if (finalDuration === null || finalDuration === 0) {
    if (type === 'error' || type === 'offline') {
      finalDuration = 5000;
    } else if (type === 'warning') {
      finalDuration = 4000;
    } else if (type === 'info') {
      finalDuration = 3000;
    } else {
      finalDuration = 3000;
    }
  }

  setTimeout(() => {
    if (messageEl.parentNode) {
      messageEl.classList.add('fade-out');
      setTimeout(() => {
        if (messageEl.parentNode) {
          messageEl.remove();
          console.log('Message removed after timeout');
        }
      }, 300);
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
    
    // Handle Escape key to close results
    if (e.key === 'Escape') {
      console.log('Escape key pressed, closing results...');
      hideSearchResults();
      elements.searchInput.blur();
      return;
    }
    
    // Handle ArrowDown to navigate results
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateSearchResults('down');
      return;
    }
    
    // Handle ArrowUp to navigate results
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateSearchResults('up');
      return;
    }
    
    // Handle Enter to search or activate focused result
    if (e.key === 'Enter') {
      console.log('Enter key pressed, performing search...');
      
      // If a search result is focused, play it
      const focusedResult = elements.searchResultsList.querySelector('.search-result.focused');
      if (focusedResult) {
        e.preventDefault();
        const playBtn = focusedResult.querySelector('[class*="play"]');
        if (playBtn) {
          playBtn.click();
          return;
        }
      }
      
      // Otherwise, perform search
      state.currentSearchPage = 0;
      state.currentSearchQuery = elements.searchInput.value.trim();
      console.log('Search query:', state.currentSearchQuery);
      if (state.currentSearchQuery) {

        elements.searchResults.classList.add('active');
        (window.performOptimizedSearch || performOptimizedSearch)(state.currentSearchQuery, 0).then(result => {
          displaySearchResults(result);
          addToSearchHistory(state.currentSearchQuery);
        }).catch(error => {
          console.error('Search error:', error);
          showStatus('Search encountered an error', 'error');

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

    // Si el input está vacío, mostrar historial
    if (currentQuery === '') {
      displaySearchHistory();
      state.searchActive = true;
      hideFavoritesList();
      return;
    }

    // Si hay texto, solo mostrar resultados existentes si coinciden
    if (currentQuery.length > 0) {
      hideFavoritesList();
      if (state.searchResults.length > 0 && currentQuery === state.currentSearchQuery) {
        elements.searchResults.classList.add('active');
        state.searchActive = true;
      }
      // No lanzar nueva búsqueda automáticamente
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

// Keyboard navigation for search results
function navigateSearchResults(direction) {
  if (!elements.searchResults.classList.contains('active')) {
    return;
  }
  
  const results = Array.from(elements.searchResultsList.querySelectorAll('.search-result'));
  if (results.length === 0) return;
  
  const currentFocused = elements.searchResultsList.querySelector('.search-result.focused');
  let nextResult;
  
  if (!currentFocused) {
    nextResult = direction === 'down' ? results[0] : results[results.length - 1];
  } else {
    const currentIndex = results.indexOf(currentFocused);
    let nextIndex = direction === 'down' ? currentIndex + 1 : currentIndex - 1;
    
    if (nextIndex < 0) nextIndex = results.length - 1;
    if (nextIndex >= results.length) nextIndex = 0;
    
    nextResult = results[nextIndex];
  }
  
  // Remove focused class from all results
  results.forEach(r => r.classList.remove('focused'));
  
  // Add focused class to next result
  if (nextResult) {
    nextResult.classList.add('focused');
    nextResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
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
    elements.searchResultsList.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">🔍</div>
        <div class="no-results-title">No Results Found</div>
        <div class="no-results-hint">Try different keywords or check your spelling</div>
      </div>
    `;
    elements.searchResults.classList.add('active');
    // Volver a deshabilitar los controles si no hay resultados
    if (state.favorites.length === 0) {
      updatePlayButtonState();
    }
    return;
  }

  // Render results either as legacy list or new card grid
  if (state.viewMode === 'grid') {
    renderCardGrid(elements.searchResultsList, results, 'search', clearExisting);
  } else {
    const fragment = document.createDocumentFragment();
    results.forEach((result, index) => {
      const globalIndex = clearExisting ? index : state.searchResults.length - results.length + index;
      const resultEl = createSearchResultElement(result, globalIndex);
      fragment.appendChild(resultEl);
    });
    if (clearExisting) {
      elements.searchResultsList.appendChild(fragment);
    } else {
      const existingObserver = elements.searchResultsList.querySelector('.lazy-load-observer');
      if (existingObserver) existingObserver.remove();
      elements.searchResultsList.appendChild(fragment);
    }
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
  const { actionsDiv, playBtn, favoriteBtn, shareBtn, expandBtn } = createFavoriteActions(result, hasFavoriteTrack);

  // Add ARIA labels to buttons
  playBtn.setAttribute('aria-label', `Play ${result.title || 'Untitled'}`);
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

  // Event listeners
  playBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const title = result.title || 'Untitled';
    showStatus(`Loading your track`, 'info');
    await window.playOptimizedSearchResult(result, globalIndex, state.searchResults);
  });

  shareBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await shareTrack(result.identifier, result.title);
  });

  infoDiv.addEventListener('click', async (e) => {
    if (e.target.closest('.result-buttons')) return;
    const title = result.title || 'Untitled';
    showStatus(`Getting track ready`, 'info');
    await window.playOptimizedSearchResult(result, globalIndex, state.searchResults);
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
    const globalIndex = clearExisting ? index : state.searchResults.length - items.length + index;
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
      `<g fill='#6ee7b7aa' font-family='sans-serif' font-weight='700'>` +
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
  media.appendChild(chips);

  // Body
  const body = document.createElement('div');
  body.className = 'card-body';

  const metaOverlay = document.createElement('div');
  metaOverlay.className = 'result-meta-overlay';

  const chipTypeOverlay = document.createElement('span');
  chipTypeOverlay.className = 'chip';
  chipTypeOverlay.textContent = isAlbum ? 'Album' : 'Single';
  metaOverlay.appendChild(chipTypeOverlay);

  if (item.trackCount) {
    const chipTrackCount = document.createElement('span');
    chipTrackCount.className = 'chip';
    chipTrackCount.textContent = `${item.trackCount} tracks`;
    metaOverlay.appendChild(chipTrackCount);
  }

  body.appendChild(metaOverlay);

  const t = document.createElement('div');
  t.className = 'card-title';
  t.textContent = title;
  t.title = title;
  body.appendChild(t);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const playBtn = document.createElement('button');
  playBtn.className = 'card-btn play';
  playBtn.title = 'Play';
  playBtn.textContent = '▶';
  const favBtn = document.createElement('button');
  favBtn.className = 'card-btn favorite';
  favBtn.textContent = isAlbum ? '🩶' : '🩶';
  const expandBtn = document.createElement('button');
  expandBtn.className = 'card-btn expand';
  expandBtn.title = '▼';
  expandBtn.textContent = '▼';
  expandBtn.style.display = isAlbum ? 'flex' : 'none';
  actions.appendChild(playBtn);
  actions.appendChild(favBtn);
  actions.appendChild(expandBtn);

  card.appendChild(media);
  card.appendChild(body);
  card.appendChild(actions);

  // Background album info population (track count / album flag)
  try { loadAlbumInfoBackground(identifier, card); } catch (e) {}

  // Event wiring
  if (context === 'search') {
    // Play
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showStatus('Loading your track', 'info');
      window.playOptimizedSearchResult?.(item, globalIndex, state.searchResults);
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
          } else {
            addAlbumToFavorites(identifier, files);
            favBtn.classList.add('active');
            favBtn.textContent = '❤️';
          }
        } else if (files.length === 1) {
          const track = files[0];
          const before = isTrackFavorite(track);
          toggleFavorite(track);
          const after = isTrackFavorite(track);
          favBtn.classList.toggle('active', after);
          favBtn.textContent = after ? '❤️' : '🩶';
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
  } else {
    // favorites context
    // Integrate with existing delegation; set attributes
    playBtn.setAttribute('data-id', identifier);
    const isAlbumFavorite = Array.isArray(item.tracks) ? item.tracks.length > 1 : isAlbum;
    playBtn.setAttribute('data-is-album', String(isAlbumFavorite));
    // Mark card type for CSS layout tweaks
    card.classList.add(isAlbumFavorite ? 'album' : 'single');

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
        const parent = containerForFavorites(); parent.insertBefore(tracksContainer, card.nextSibling);
      }
      toggleAlbumTracks(identifier, tracksContainer, expandBtn);
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

        const isFavorite = isTrackFavorite(track);
        const trackNumber = track.trackNumber || index + 1;

        trackItem.innerHTML = `
          <div class="track-actions">
            <span class="track-number">${trackNumber}</span>
            <button class="track-play" data-url="${track.url}" data-title="${track.title}" data-id="${albumId}" data-is-album="false">▶</button>
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
          
          // Detectar si estamos en favoritos o en resultados de búsqueda
          const isFavoritesContext = tracksContainer.closest('#favorites-list') !== null;
          
          if (isFavoritesContext) {
            // Si estamos en favoritos, usar la función que oculta los favoritos
            // Pasar el track específico para reproducir el correcto
            console.log('🎵 Track clicked in favorites context - calling playFromFavoritesQueue with track:', track.title);
            playFromFavoritesQueue(track);
          } else {
            // Si estamos en resultados, usar la función normal de búsqueda
            window.playSpecificSearchTrack(track, albumId, index, files.length);
          }
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
            shareTrack(track.id || albumId, track.title);
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
let __resonateConnectivityHandlersAttached = false;

function __resonateSetSearchOnlineState(isOnline) {
  // Keep search UX consistent with connectivity changes
  if (elements.searchInput) {
    elements.searchInput.disabled = !isOnline;
    elements.searchInput.placeholder = isOnline ? "Search tracks" : "Search unavailable offline";
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
  if (!document.getElementById('offline-indicator')) {
    createOfflineIndicator();
  }

  // Initial check
  state.networkOnline = navigator.onLine;
  updateOfflineIndicator();

  __resonateAttachConnectivityHandlersOnce();
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
      window.updateTitleTicker(state.currentTrack.title);
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

  if (state.viewMode === 'grid') {
    // Transform into items for card renderer
    const items = Object.keys(favoritesByAlbum).map(albumId => ({
      identifier: albumId,
      title: favoritesByAlbum[albumId].albumTitle || 'Untitled',
      creator: favoritesByAlbum[albumId].albumCreator || 'Unknown',
      trackCount: favoritesByAlbum[albumId].tracks.length,
      isAlbum: favoritesByAlbum[albumId].tracks.length > 1,
      tracks: favoritesByAlbum[albumId].tracks
    }));

    renderCardGrid(favoritesList, items, 'favorites', true);
  } else {
    // Legacy list rendering (original implementation)
    Object.keys(favoritesByAlbum).forEach(albumId => {
      const albumData = favoritesByAlbum[albumId];
      const isAlbum = albumData.tracks.length > 1;

      const albumItem = document.createElement('div');
      albumItem.className = 'favorite-item';
      albumItem.setAttribute('role', 'listitem');
      albumItem.setAttribute('aria-label', `${albumData.albumTitle || 'Untitled'} by ${albumData.albumCreator || 'Unknown'}${isAlbum ? ` - ${albumData.tracks.length} tracks` : ''}`);

      if (state.currentTrack && (
        state.currentTrack.albumId === albumId ||
        state.currentTrack.id === albumId ||
        (isAlbum && albumData.tracks.some(track => track.url === state.currentTrack.url))
      )) {
        albumItem.classList.add('now-playing');
        albumItem.setAttribute('aria-current', 'true');
      }

      const coverContainer = document.createElement('div');
      coverContainer.className = 'result-cover';

      const img = new Image();
      img.alt = 'Album cover';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '6px';

      const archiveCoverUrl = `https://archive.org/services/img/${albumId}`;
      img.onload = () => { coverContainer.appendChild(img); };
      const lazyLoadCover = (entries, observer) => {
        entries.forEach(entry => { if (entry.isIntersecting) { img.src = archiveCoverUrl; observer.unobserve(entry.target); } });
      };
      const observer = new IntersectionObserver(lazyLoadCover, { rootMargin: '50px' });
      observer.observe(coverContainer);

      const mockResult = { title: albumData.albumTitle || 'Untitled', creator: albumData.albumCreator || 'Unknown', identifier: albumId };
      const infoDiv = createFavoriteInfo(mockResult);
      const metaElement = infoDiv.querySelector('.result-meta');
      if (metaElement && isAlbum) metaElement.innerHTML = `<span class="album-indicator">${albumData.tracks.length} tracks</span>`;
      const { actionsDiv, playBtn, favoriteBtn, shareBtn, expandBtn } = createFavoriteActions(mockResult, true);
      playBtn.setAttribute('data-id', albumId);
      playBtn.setAttribute('data-is-album', isAlbum);
      playBtn.title = 'Play';
      favoriteBtn.setAttribute('data-id', albumId);
      expandBtn.setAttribute('data-id', albumId);
      expandBtn.style.display = isAlbum ? 'inline-block' : 'none';
      albumItem.appendChild(coverContainer);
      albumItem.appendChild(infoDiv);
      albumItem.appendChild(actionsDiv);
      albumItem.addEventListener('click', (e) => {
        const isPlayButton = e.target.tagName === 'BUTTON' && e.target.title === 'Play' && e.target.textContent.trim() === '▶';
        if (!isPlayButton) e.stopPropagation();
      });
      shareBtn.addEventListener('click', (e) => { e.stopPropagation(); shareTrack(albumId, albumData.albumTitle); });
      favoriteBtn.addEventListener('click', (e) => { e.stopPropagation(); const albumId = favoriteBtn.getAttribute('data-id'); state.favorites = state.favorites.filter(fav => fav.albumId !== albumId); saveFavorites(); updateFavoritesList(); updateFavoriteButton(); showStatus('Favorite was removed', 'info'); });
      expandBtn.addEventListener('click', (e) => { e.stopPropagation(); let tracksContainer = albumItem.nextElementSibling; if (!tracksContainer || !tracksContainer.classList.contains('tracks-container')) { tracksContainer = document.createElement('div'); tracksContainer.className = 'tracks-container'; tracksContainer.style.display = 'none'; favoritesList.insertBefore(tracksContainer, albumItem.nextSibling); } toggleAlbumTracks(albumId, tracksContainer, expandBtn); });
      favoritesList.appendChild(albumItem);
    });
  }
}

// Inicializar el listener de event delegation para los botones play en favoritos
// Se llama una sola vez en la inicialización de la app
function initializeFavoritesPlayListener() {
  const favoritesList = elements.favoritesList;
  if (!favoritesList) {
    console.warn('❌ favoritesList element not found');
    return;
  }
  
  console.log('🎯 Initializing favorites play button listener with event delegation');
  
  // Event listener en CAPTURE PHASE para ejecutarse ANTES que otros listeners en elementos hijos
  favoritesList.addEventListener('click', handleFavoritesPlayClick, true);
  console.log('✅ Event listener added to favoritesList (CAPTURE PHASE)');
}

// Handler global para clicks en botones play de favoritos (event delegation)
function handleFavoritesPlayClick(e) {
  console.log('handleFavoritesPlayClick triggered - event target:', e.target.tagName, e.target.textContent);
  
  let button = e.target;
  
  // Si el click fue en un elemento dentro del botón (ej: SVG, span), buscar el botón padre
  if (button.tagName !== 'BUTTON') {
    button = button.closest('button');
    if (!button) {
      console.log('⚠️ Click not on a button or within a button element');
      return;
    }
  }
  
  // IMPORTANTE: Ignorar clics dentro de track items (pistas expandidas)
  // Estos tienen su propio listener directo que maneja la reproducción
  if (button.closest('.track-item')) {
    console.log('⚠️ Click was inside a track-item - letting the direct listener handle it');
    return;
  }
  
  // Verificar si es un botón play verificando:
  // 1. Que sea un botón
  // 2. Que tenga atributos data-id y data-is-album (que lo identifican como botón play en favoritos)
  // 3. Que el textContent sea "▶"
  const hasPlayDataAttributes = button.hasAttribute('data-id') && button.hasAttribute('data-is-album');
  const isPlaySymbol = button.textContent.trim() === '▶';
  
  if (button.tagName === 'BUTTON' && hasPlayDataAttributes && isPlaySymbol) {
    console.log('✅ VALID PLAY BUTTON CLICK DETECTED');
    e.preventDefault();
    e.stopPropagation();
    
    const isAlbum = button.getAttribute('data-is-album') === 'true';
    const id = button.getAttribute('data-id');
    
    console.log('📊 Button data - isAlbum:', isAlbum, 'id:', id);
    
    if (isAlbum) {
      console.log('🎵 Calling playAlbumFromFavorites for album:', id);
      if (typeof playAlbumFromFavorites === 'function') {
        playAlbumFromFavorites(id);
      } else {
        console.error('❌ playAlbumFromFavorites is NOT a function!');
      }
    } else {
      console.log('🎵 Calling playFromFavoritesQueue for single track');
      // Para single tracks, encontrar el track correcto en favoritos
      // y pasarlo a la función
      if (typeof playFromFavoritesQueue === 'function') {
        // Si el botón está dentro de un track item expandido, el track objeto está disponible
        // en el contexto del listener que agregó. Pero aquí en event delegation,
        // necesitamos encontrarlo basado en data-id (que es el albumId)
        // El track estaría en state.favorites con ese albumId
        const favoriteTrack = state.favorites.find(fav => fav.albumId === id || fav.id === id);
        if (favoriteTrack) {
          console.log('Found favorite track:', favoriteTrack.title, '- passing to playFromFavoritesQueue');
          playFromFavoritesQueue(favoriteTrack);
        } else {
          console.warn('Favorite track not found for id:', id, '- playing from queue start');
          playFromFavoritesQueue();
        }
      } else {
        console.error('❌ playFromFavoritesQueue is NOT a function!');
      }
    }
  } else {
    console.log('⚠️ Click was not on a play button - has data attrs:', hasPlayDataAttributes, 'is play symbol:', isPlaySymbol, 'tagName:', button.tagName);
  }
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
    console.log('FavoritesToggle.hide() called - current isVisible:', this.isVisible);
    this.isVisible = false;
    console.log('Set isVisible to false');
    this.updateVisibility();
    console.log('Called updateVisibility()');
    this.updateAriaAttributes();
    console.log('FavoritesToggle.hide() completed');
  }

  /**
   * Actualiza la visibilidad de los elementos
   */
  updateVisibility() {
    console.log('updateVisibility() called - isVisible:', this.isVisible);
    if (this.isVisible) {
      console.log('Adding active class');
      this.listElement?.classList.add('active');
      this.element?.classList.add('active');
    } else {
      console.log('Removing active class');
      this.listElement?.classList.remove('active');
      this.element?.classList.remove('active');
      console.log('Active class removed - listElement has active:', this.listElement?.classList.contains('active'));
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
  const toggleBtn = elements.favoritesToggle;
  
  if (countElement && toggleBtn) {
    const count = state.favorites ? state.favorites.length : 0;
    countElement.textContent = count > 0 ? count : '0';
    
    // Improve ARIA label for accessibility
    toggleBtn.setAttribute('aria-label', `View favorites (${count} saved)`);
    
    // Update aria-expanded based on visibility
    const isExpanded = elements.favoritesList?.classList.contains('active') || false;
    toggleBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
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
  
  if (elements.favoritesToggle) {
    elements.favoritesToggle.classList.remove('active');
    elements.favoritesToggle.setAttribute('aria-expanded', 'false');
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

        elements.searchResults.classList.add('active');
        if (window.performOptimizedSearch) {
          window.performOptimizedSearch(query, 0).then(result => {
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
async function shareTrack(identifier, title = 'Track') {
  const shareUrl = `${window.location.origin}${window.location.pathname}?play=${encodeURIComponent(identifier)}`;
  const shortTitle = `"${title}"`;
  const shareTitle = `You might like this!\n${shortTitle}`;
  const shareText = `${shareTitle}\n\nEnjoy it freely on Resonate Player`;

  console.log('Attempting to share:', { shareUrl, shareTitle, shareText });

  // Update Open Graph meta tags for rich previews
  updateMetaTagsForSharing(identifier, title);

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
function updateMetaTagsForSharing(identifier, title) {
  const baseUrl = window.location.origin;
  const shareUrl = `${baseUrl}${window.location.pathname}?play=${encodeURIComponent(identifier)}`;
  const imageUrl = `https://archive.org/services/img/${identifier}`;

  // Update page title
  document.title = `${title} | Resonate Player`;

  // Update Open Graph tags
  updateMetaTag('property', 'og:title', `${title}`);
  updateMetaTag('property', 'og:description', `Listen to "${title}" on Resonate Player. Free music from archive.org.`);
  updateMetaTag('property', 'og:image', imageUrl);
  updateMetaTag('property', 'og:url', shareUrl);
  updateMetaTag('property', 'og:type', 'music.song');

  // Update Twitter Card tags
  updateMetaTag('property', 'twitter:card', 'summary_large_image');
  updateMetaTag('property', 'twitter:title', `${title}`);
  updateMetaTag('property', 'twitter:description', `Listen to "${title}" on Resonate Player. Free music from archive.org.`);
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

// Initialize UI toggles
initializePreloadFavoritesToggle();

// Expose critical functions globally for cross-module access
window.loadFavorites = loadFavorites;
window.saveFavorites = saveFavorites;
window.loadVolume = loadVolume;
window.saveVolume = saveVolume;
// ...existing code...
if (elements.shuffleFavoritesBtn) {
  elements.shuffleFavoritesBtn.addEventListener('click', () => {
    // Ciclo de modos: Off → Repeat All → Repeat One → Shuffle → Shuffle+Repeat → Off
    const config = window.getPlaybackConfigStatus ? window.getPlaybackConfigStatus() : { repeat: 'context', shuffle: false };
    let next = { repeat: 'off', shuffle: false };
    if (config.repeat === 'off' && !config.shuffle) {
      next = { repeat: 'all', shuffle: false };
    } else if (config.repeat === 'all' && !config.shuffle) {
      next = { repeat: 'one', shuffle: false };
    } else if (config.repeat === 'one' && !config.shuffle) {
      next = { repeat: 'off', shuffle: true };
    } else if (config.repeat === 'off' && config.shuffle) {
      next = { repeat: 'all', shuffle: true };
    } else if (config.repeat === 'all' && config.shuffle) {
      next = { repeat: 'off', shuffle: false };
    }
    // Actualizar PlaybackStateManager
    if (window.playbackStateManager) {
      window.playbackStateManager.setRepeatMode(next.repeat);
      window.playbackStateManager.setShuffleMode(next.shuffle);
    }
    // No status UI update needed
  });
}
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
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      showStatus('Checking for updates…', 'info', 2500);
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