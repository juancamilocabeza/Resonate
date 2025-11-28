// Playback management classes and functions

class ContinuousPlaybackManager {
  constructor() {
    this.currentContext = null;
    this.contextData = {
      search: { currentIndex: -1, items: [] },
      favorites: { currentIndex: -1, items: [] },
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

    // Apply shuffle based on shuffleFavorites state for all contexts (album, favorites, search, searchPlaylist)
    if ((this.currentContext === 'album' || this.currentContext === 'favorites' || this.currentContext === 'search' || this.currentContext === 'searchPlaylist') && state.shuffleFavorites) {
      context.currentIndex = Math.floor(Math.random() * context.items.length);
    } else {
      context.currentIndex = (context.currentIndex + 1) % context.items.length;
    }

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
    context.currentIndex = (context.currentIndex - 1 + context.items.length) % context.items.length;

    return context.items[context.currentIndex];
  }
}

const playbackManager = new ContinuousPlaybackManager();

// Fetch with timeout for network operations
async function fetchWithTimeout(resource, options = {}) {
  const isLocal = window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const defaultTimeout = isLocal ? 30000 : 8000; // Higher timeout for local development
  const { timeout = defaultTimeout, ...fetchOptions } = options;

  const controller = new AbortController();
  // track the controller globally so we can abort from watchdogs
  try {
    state.lastFetchController = controller;
  } catch (e) {
    // state may not be available in some rare cases during early init
  }
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    const response = await fetch(resource, {
      ...fetchOptions,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    try { state.lastFetchController = null; } catch (e) { }
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    try { state.lastFetchController = null; } catch (e) { }
    if (error && error.name === 'AbortError') {
      const isLocal = window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const timeoutMsg = `Timeout: La petición tardó más de ${timeout}ms`;
      if (isLocal) {
        throw new Error(`${timeoutMsg}. Si ejecutas desde un archivo local, utiliza un servidor HTTP (ej: python -m http.server) para funcionalidad completa.`);
      }
      throw new Error(`${timeoutMsg}. Revisa tu conexión a internet.`);
    }
    // Provide better error messages for common network issues in development
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      const isLocal = window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (isLocal) {
        throw new Error('Error de red: Si abriste index.html directamente, ejecuta un servidor local (python -m http.server) para acceso completo a APIs.');
      }
    }
    throw error;
  }
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

// Load audio from cache or network
async function loadAudioWithCache(track) {
  if (!track || !track.url) {
    throw new Error('URL de audio no disponible');
  }

  // Only allow .ogg and .mp3 files
  const urlLower = track.url.toLowerCase();
  if (!urlLower.endsWith('.ogg') && !urlLower.endsWith('.mp3')) {
    throw new Error('Solo se permiten archivos .ogg y .mp3');
  }

  try {
    // Intentar obtener de la caché primero
    const cacheResult = typeof audioCache !== 'undefined' && audioCache && typeof audioCache.get === 'function' ? await audioCache.get(track.url) : null;

    if (cacheResult && cacheResult.blob) {
      console.log('Playing from cache:', track.title);
      const blobUrl = URL.createObjectURL(cacheResult.blob);
      return blobUrl;
    }

    // Si no está en caché y no hay conexión, no podemos cargarlo
    if (!state.networkOnline) {
      throw new Error('Offline and audio not available in cache');
    }

    // Load from network
    loaderManager.showPlayButtonLoader('network');

    const response = await fetchWithTimeout(track.url, { timeout: 15000 });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const blob = await response.blob();

    // Save to cache for future use (background)
    const isFavorite = isTrackFavorite(track);
    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.put === 'function') {
      audioCache.put(track.url, blob, true, isFavorite).catch(error => {
        console.error('Error saving to cache:', error);
      });
    }

    const blobUrl = URL.createObjectURL(blob);

    showStatus('Audio loaded', 'info', 1000);
    return blobUrl;

  } catch (error) {
    console.error('Error cargando audio:', error);

    // Intentar estrategias de fallback
    if (!state.networkOnline) {
      // Precargar pistas siguientes si estamos en un contexto
      preloadNextTrack();
    }

    throw error;
  }
}

function preloadNextTrack() {
  if (state.playbackQueue.length > 0) {
    const nextTrack = state.playbackQueue[0];
    if (nextTrack && nextTrack.url) {
      if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.prefetchAudio === 'function') {
        audioCache.prefetchAudio(nextTrack.url).catch(console.error);
      }
    }
  }
}

async function setArtwork(track, identifier) {
  elements.art.innerHTML = '';

  if (!track || !track.id) {
    elements.art.innerHTML = '<span class="hint">Sin portada</span>';
    return;
  }

  const img = new Image();
  img.alt = 'Portada del álbum';

  const archiveCoverUrl = `https://archive.org/services/img/${identifier}`;

  img.onload = () => {
    elements.art.appendChild(img);
  };

  img.onerror = () => {
    // No genre-specific artwork generation: just show placeholder
    elements.art.innerHTML = '<span class="hint">Sin portada</span>';
  };

  img.src = archiveCoverUrl;
}

// Play audio track with UI updates and state management
async function playAudioTrackOptimized(track, identifier, trackIndex = 0, totalTracks = 1) {
  if (!track || !track.url) {
    throw new Error('Pista no disponible');
  }
  hideSearchResults();
  elements.audio.pause();
  elements.audio.currentTime = 0;

  if (totalTracks > 1) {
    elements.title.textContent = `${track.title || 'Sin título'}`;
    elements.creator.textContent = `${track.creator || 'Desconocido'} (${trackIndex + 1}/${totalTracks})`;
  } else {
    elements.title.textContent = track.title;
    elements.creator.textContent = track.creator;
  }

  // ACTUALIZACIÓN: Mostrar descripción si está disponible de forma segura
  if (elements.description) {
    if (track.description && track.description.trim() !== '') {
      elements.description.textContent = track.description;
      // Asegurar que el contenedor padre esté visible
      if (elements.description.parentElement) {
        elements.description.parentElement.style.display = 'block';
      }
    } else {
      elements.description.textContent = '';
      // Ocultar el contenedor si no hay descripción
      if (elements.description.parentElement) {
        elements.description.parentElement.style.display = 'none';
      }
    }
  }

  await setArtwork(track, identifier);

  state.currentTrack = {
    ...track,
    url: track.url,
    id: track.id || identifier,
    trackIndex: trackIndex,
    totalTracks: totalTracks,
    isAlbumTrack: totalTracks > 1,
    albumId: identifier
  };

  updateFavoriteButton();
  updateMediaSessionMetadata(track, identifier);

  showStatus(`Cargando: ${track.title}`, 'info', 0);
  loaderManager.showPlayButtonLoader('track');

  return new Promise((resolve, reject) => {
    const audio = elements.audio;
    let timeoutId;

    const onCanPlay = () => {
      cleanup();
      audio.play().then(async () => {
        // Restore button state when playback starts
        state.isLoading = false;
        elements.playBtn.disabled = false;
        elements.playBtn.textContent = '| |';



        if (totalTracks > 1) {
          showStatus(`Playing: ${track.title} (${trackIndex + 1}/${totalTracks})`, 'info');
        } else {
          showStatus(`Playing: ${track.title}`, 'info');
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
            console.error('Error ejecutando callback onplay:', error);
          }
        }

        // Preload next track
        preloadNextTrack();

        resolve(true);
      }).catch(error => {
        // Handle playback error
        cleanup();
        state.isLoading = false;
        elements.playBtn.disabled = false;
        elements.playBtn.textContent = '▶';
        reject(error);
      });
    };

    const onError = (e) => {
      cleanup();
      state.isLoading = false;
      elements.playBtn.disabled = false;
      elements.playBtn.textContent = '▶';
      reject(new Error(`Error de audio: ${e.target.error?.message || 'Fuente no compatible'}`));
    };

    const cleanup = () => {
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('error', onError);
      clearTimeout(timeoutId);
    };

    // Cargar audio con caché
    loadAudioWithCache(track)
      .then(blobUrl => {
        // CORRECCIÓN CRÍTICA: Solo ahora limpiar la URL anterior y asignar la nueva
        if (state.currentBlobUrl) {
          URL.revokeObjectURL(state.currentBlobUrl);
        }

        state.currentBlobUrl = blobUrl;
        audio.src = blobUrl;
        audio.load();
        audio.preload = 'auto';

        timeoutId = setTimeout(() => {
          if (audio.readyState < 2) {
            cleanup();
            state.isLoading = false;
            elements.playBtn.disabled = false;
            elements.playBtn.textContent = '▶';
            reject(new Error('Tiempo de espera agotado al cargar audio'));
          }
        }, 20000);

        audio.addEventListener('canplay', onCanPlay, { once: true });
        audio.addEventListener('error', onError, { once: true });
      })
      .catch(error => {
        cleanup();
        state.isLoading = false;
        elements.playBtn.disabled = false;
        elements.playBtn.textContent = '▶';
        reject(error);
      });
  });
}

// Playback control functions
function playPrevious() {
  state.userInteracted = true;
  showStatus('Pista anterior', 'info');
  playPreviousInContext();
}

async function playNext() {
  state.userInteracted = true;
  showStatus('Siguiente pista', 'info');
  await playNextInContext();
}

async function resumeSavedPlayback() {
  const savedState = state.savedPlaybackState;
  if (!savedState) return;

  loaderManager.showPlayButtonLoader('resume');

  state.userInteracted = true;

  try {
    // Restore volume and mute settings
    if (savedState.volume !== undefined && elements.audio) {
      elements.audio.volume = savedState.volume;
      if (elements.volumeSlider) {
        elements.volumeSlider.value = savedState.volume;
      }
      state.currentVolume = savedState.volume;
    }
    if (savedState.muted !== undefined && elements.audio) {
      elements.audio.muted = savedState.muted;
      updateVolumeIcon();
    }

    showStatus(`Reprodiciendo pista guardada: ${savedState.track.title}`, 'info', 0);

    // Play the track
    await playAudioTrackOptimized(savedState.track, savedState.track.id, savedState.track.trackIndex, savedState.track.totalTracks);

    // Set the saved position
    if (savedState.currentTime && elements.audio && elements.audio.duration) {
      elements.audio.currentTime = savedState.currentTime;
      updateProgressBar();
    }

    // Clear the saved state since we resumed it
    state.savedPlaybackState = null;
    localStorage.removeItem('resonate_playback_state');

  } catch (error) {
    console.error('Error resuming saved playback:', error);
    showStatus(`Error al reanudar pista guardada: ${error.message}`, 'error');
    loaderManager.hidePlayButtonLoader('resume');
    // Try force play as fallback
    forcePlay();
  }
}

function togglePlay() {
  if (state.isLoading) return;

  // Check if there's a saved playback state to resume
  if (elements.audio.paused && !elements.audio.src && state.savedPlaybackState) {
    resumeSavedPlayback();
    return;
  }

  // Check if there's a saved track to resume (legacy)
  if (elements.audio.paused && !elements.audio.src && state.currentTrack && state.currentTrack.url) {
    // Resume last track
    playAudioTrackOptimized(state.currentTrack, state.currentTrack.id, state.currentTrack.trackIndex, state.currentTrack.totalTracks).catch(error => {
      console.error('Error resuming track:', error);
      forcePlay();
    });
    return;
  }

  // Prevenir reproducción si no hay favoritos y no hay audio cargado
  if (elements.audio.paused && !elements.audio.src && state.favorites.length === 0) {
    showStatus('Agrega favoritos para comenzar a reproducir', 'info');
    return;
  }

  state.userInteracted = true;

  if (elements.audio.paused) {
    if (!elements.audio.src) {
      forcePlay();
      return;
    }

    elements.audio.play().then(() => {
      elements.playBtn.textContent = '| |';
      showStatus('Reproduciendo', 'info');

      // Actualizar Media Session
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
    }).catch(error => {
      showStatus(`Error: ${error.message}`, 'error');
    });
  } else {
    elements.audio.pause();
    elements.playBtn.textContent = '▶';
    showStatus('Pausado', 'info');

    // Actualizar Media Session
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
  }
}

function loadPlaybackQueue(context, items, startIndex = 0) {
  state.playbackQueue = [];

  if (!items || items.length === 0) {
    // No items to load into FIFO
    return;
  }

  const queueSize = 10;
  // Queue behavior by context and shuffle mode
  if (context === 'favorites') {
    if (state.shuffleFavorites) {
      // Favorites random mode: load random selection for FIFO queue
      const shuffled = [...items].sort(() => Math.random() - 0.5);
      state.playbackQueue = shuffled.slice(0, queueSize);
    } else {
      // Sequential mode: take next `queueSize` items from startIndex
      for (let i = 0; i < queueSize; i++) {
        const index = (startIndex + i) % items.length;
        if (items[index]) state.playbackQueue.push(items[index]);
      }
    }
  } else if (context === 'search') {
    if (state.shuffleFavorites) {
      // Search random mode: shuffle and play all results
      const shuffledAll = [...items].sort(() => Math.random() - 0.5);
      state.playbackQueue = shuffledAll.slice();
    } else {
      // Sequential mode: play linearly all results from startIndex
      for (let i = 0; i < items.length; i++) {
        const index = (startIndex + i) % items.length;
        if (items[index]) state.playbackQueue.push(items[index]);
      }
    }
  } else {
    // Default behavior (other contexts): load next `queueSize` items
    for (let i = 0; i < queueSize; i++) {
      const index = (startIndex + i) % items.length;
      if (items[index]) state.playbackQueue.push(items[index]);
    }
  }

  // Preload tracks from queue
  if (state.networkOnline) {
    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.preloadTracks === 'function') {
      audioCache.preloadTracks(state.playbackQueue, true);
    }
  }
}

// Force playback by determining context and playing
function forcePlay() {
  if (!state.isInitialized) {
    state.isInitialized = true;
    showStatus('Iniciando Resonate...', 'info');
    elements.title.textContent = '';
    elements.creator.textContent = '';
  }

  state.userInteracted = true;

  // Clear previous playback state
  state.isLoading = false;
  state.playbackQueue = [];
  state.playbackHistory = [];

  if (state.favorites.length > 0) {
    showStatus('Playing favorites from FIFO queue', 'info');
    playFromFavoritesQueue();
  } else {
    showStatus('No hay favoritos. Realiza una búsqueda para comenzar', 'info');
  }
}

// FUNCIÓN: Reproducir desde cola FIFO de favoritos
async function playFromFavoritesQueue() {
  if (state.isLoading || state.favorites.length === 0) return;

  loaderManager.showPlayButtonLoader('favorites');

  state.isPlayingFavorites = true;

  try {
    // Cargar cola FIFO con favoritos
    loadPlaybackQueue('favorites', state.favorites, 0);

    if (state.playbackQueue.length === 0) {
      throw new Error('No se pudo cargar la cola de reproducción');
    }

    const track = state.playbackQueue[0];

    if (!track.url) {
      throw new Error('URL de audio no disponible en el favorito');
    }

    showStatus(`Loading from FIFO queue: ${track.title}`, 'info', 0);

    // Remove track from queue before playing
    state.playbackQueue.shift();

    await playAudioTrackOptimized(track, track.id, track.trackIndex, track.totalTracks);

    updateShuffleButton();

  } catch (error) {
    console.error('Error in playFromFavoritesQueue:', error);

    // Handle offline/cache errors by trying next track
    if (error.message.includes('Offline and audio not available in cache')) {
      showStatus('Pista no disponible sin conexión, saltando...', 'error', 2000);
      // Try next track in queue if available
      if (state.playbackQueue.length > 0) {
        setTimeout(() => playFromFavoritesQueue(), 2000);
        return;
      } else {
        showStatus('No hay más pistas disponibles sin conexión', 'error', 3000);
      }
    } else {
      showStatus(`Error: ${error.message}`, 'error');
    }
  } finally {
    state.isLoading = false;
    elements.playBtn.disabled = false;
    elements.playBtn.textContent = '| |';
  }
}

// Configure preloaded playback list
function setupPreloadedPlayback(tracks, startIndex = 0) {
  if (!tracks || tracks.length === 0) return;

  // Crear una lista de reproducción precargada
  const preloadedPlaylist = tracks.map(track => ({
    ...track,
    id: track.id || `preloaded-${Math.random().toString(36).substr(2, 9)}`
  }));

  // Configurar el contexto de reproducción precargado
  playbackManager.setContext('searchPlaylist', preloadedPlaylist, startIndex);
  state.autoPlaySearchResults = true;

  console.log(`Preloaded list configured with ${preloadedPlaylist.length} tracks`);
}

async function playNextInContext(maxRetries = 3) {
  // PREVENT MULTIPLE EXECUTION
  if (state.isLoading) return;
  state.isLoading = true;

  // Only replace in FIFO queue if song played completely, not on manual next button
  const currentTrackUrl = state.currentTrack?.url;

  try {
    const context = playbackManager.getCurrentContext();

    // ALBUMS: Play next track based on shuffle state (sequential if shuffle off, random if shuffle on)
    if (context === 'album') {
      const albumContext = playbackManager.contextData.album;
      const nextItem = playbackManager.getNextTrack();

      if (nextItem && albumContext.currentIndex < albumContext.items.length) {
        try {
          await playAudioTrackOptimized(nextItem, playbackManager.getCurrentAlbumId(), albumContext.currentIndex, albumContext.items.length);
          return;
        } catch (error) {
          console.error('Error reproduciendo pista de álbum:', error);

          // Automatically try next track for albums
          if (maxRetries > 0) {
            showStatus(`Pista problemática - saltando a la siguiente...`, 'error', 1500);
            return playNextInContext(maxRetries - 1);
          } else {
            showStatus('Múltiples pistas con errores - deteniendo reproducción', 'error', 3000);
            return;
          }
        }
      } else if (albumContext.currentIndex >= albumContext.items.length - 1) {
        // Album finished, check if we should continue with next search result
        if (state.albumOrigin === 'search') {
          const currentAlbumId = playbackManager.getCurrentAlbumId();
          const currentIndex = state.searchResults.findIndex(item => item.identifier === currentAlbumId);

          if (currentIndex !== -1 && currentIndex < state.searchResults.length - 1) {
            const nextResult = state.searchResults[currentIndex + 1];
            showStatus('Continuando con siguiente resultado de búsqueda...', 'info', 2000);

            playbackManager.setContext('search', state.searchResults, currentIndex + 1);
            await playOptimizedSearchResult(nextResult, currentIndex + 1, state.searchResults);
            return;
          }
        }
        showStatus('Fin del álbum', 'info', 2000);
        return;
      }
    }

    // Always play from FIFO queue if tracks available
    if (state.playbackQueue.length > 0) {
      const nextTrack = state.playbackQueue[0];

      // Check it's not the same as current track
      if (nextTrack && currentTrackUrl && nextTrack.url === currentTrackUrl) {
        // Skipping same track, moving to next
        state.playbackQueue.shift(); // Remover la duplicada
        if (state.playbackQueue.length > 0) {
          await playNextInContext(maxRetries); // Intentar con la siguiente
          return;
        }
      }

      const actualNextTrack = state.playbackQueue.shift();

      if (!actualNextTrack) {
        // No track available
        return;
      }

      // Agregar la pista actual al historial solo si es diferente
      if (state.currentTrack && state.currentTrack.url !== actualNextTrack.url) {
        state.playbackHistory.push(state.currentTrack);
      }

      try {
        await playAudioTrackOptimized(actualNextTrack, actualNextTrack.id, actualNextTrack.trackIndex, actualNextTrack.totalTracks);
        return;
      } catch (error) {
        console.error('Error reproduciendo desde cola FIFO:', error);

        // Automatically try next track instead of stopping
        if (maxRetries > 0) {
          showStatus(`Error en pista "${actualNextTrack.title || 'desconocida'}" - intentado siguiente...`, 'error', 2000);
          return playNextInContext(maxRetries - 1);
        } else {
          showStatus('Múltiples pistas con errores - deteniendo reproducción automática', 'error', 3000);
          return;
        }
      }
    }

    // Si estamos en un contexto de búsqueda con playlist precargada
    if (context === 'searchPlaylist' && state.autoPlaySearchResults) {
      if (!playbackManager.hasNextTrack()) {
        showStatus('Fin de la lista de reproducción', 'info', 2000);
        return;
      }

      const nextItem = playbackManager.getNextTrack();
      await playAudioTrackOptimized(nextItem, nextItem.id, 0, 1);
      return;
    }

    // Para otros contextos, usar el comportamiento de precarga existente
    if (!playbackManager.hasNextTrack()) {
      if (context === 'album') {
        showStatus('Fin del álbum', 'info', 2000);
        return;
      } else if (context === 'favorites') {
        showStatus('Fin de los favoritos. Realiza una búsqueda para continuar', 'info', 2000);
        return;
      }
      if (context === 'search') {
        showStatus('Fin de la búsqueda actual', 'info', 2000);
        return;
      }
      return;
    }

    const nextItem = playbackManager.getNextTrack();

    try {
      if (context === 'genre' || context === 'search') {
        const files = await fetchOptimizedPlayableFiles(nextItem.identifier);
        if (files && files.length > 0) {
          const track = files[0];
          await playAudioTrackOptimized(track, nextItem.identifier);
        } else {
          await playNextInContext();
        }
      } else if (context === 'favorites') {
        // Use cache for favorites
        if (!nextItem.url) {
          console.error('Favorite without valid URL:', nextItem);
          setTimeout(() => playNextInContext(), 1000);
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
          console.error('URL de audio vacía en favorito:', track);
          showStatus('Error: URL de audio no disponible', 'error', 2000);
          setTimeout(() => playNextInContext(), 1000);
          return;
        }

        // Verificar si está en caché antes de reproducir
        const cached = typeof audioCache !== 'undefined' && audioCache && typeof audioCache.get === 'function' ? await audioCache.get(track.url) : null;
        if (!cached && !state.networkOnline) {
          showStatus('Pista no disponible sin conexión, saltando...', 'error', 2000);
          setTimeout(() => playNextInContext(), 1000);
          return;
        }

        await playAudioTrackOptimized(track, nextItem.id, nextItem.trackIndex, nextItem.totalTracks);
      }

    } catch (error) {
      console.error('Error al reproducir siguiente pista:', error);

      if (error.message.includes('conexión') || error.message.includes('offline')) {
        showStatus('Sin conexión, intentando siguiente pista...', 'error', 2000);
        setTimeout(() => playNextInContext(), 1000);
      } else {
        setTimeout(() => playNextInContext(), 1000);
      }
    }
  } catch (error) {
    console.error('Error crítico en playNextInContext:', error);
  } finally {
    state.isLoading = false;
  }
}

async function playPreviousInContext() {
  // Usar historial para botón anterior
  if (state.playbackHistory.length > 0) {
    const previousTrack = state.playbackHistory.pop();

    // Poner la pista actual de vuelta en la cola FIFO
    if (state.currentTrack) {
      state.playbackQueue.unshift(state.currentTrack);
    }

    try {
      await playAudioTrackOptimized(previousTrack, previousTrack.id, previousTrack.trackIndex, previousTrack.totalTracks);
      return;
    } catch (error) {
      console.error('Error reproduciendo desde historial:', error);
    }
  }

  const context = playbackManager.getCurrentContext();
  if (!context || !playbackManager.contextData[context].items.length) return;

  let ctx = playbackManager.contextData[context];
  ctx.currentIndex = (ctx.currentIndex - 1 + ctx.items.length) % ctx.items.length;
  const prevItem = ctx.items[ctx.currentIndex];

  try {
    if (context === 'genre' || context === 'search') {
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
        console.error('Favorite without valid URL:', prevItem);
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
      const cached = typeof audioCache !== 'undefined' && audioCache && typeof audioCache.get === 'function' ? await audioCache.get(track.url) : null;
      if (!cached && !state.networkOnline) {
        showStatus('Pista no disponible sin conexión, saltando...', 'error', 2000);
        setTimeout(() => playPreviousInContext(), 1000);
        return;
      }

      await playAudioTrackOptimized(track, prevItem.id, prevItem.trackIndex, prevItem.totalTracks);
    } else if (context === 'album') {
      try {
        await playAudioTrackOptimized(prevItem, playbackManager.getCurrentAlbumId(), ctx.currentIndex, ctx.items.length);
        return;
      } catch (error) {
        console.error('Error reproduciendo pista anterior de álbum:', error);
        // Try the fallback of going back further in the context
        setTimeout(() => playPreviousInContext(), 1000);
      }
    } else if (context === 'album') {
      try {
        await playAudioTrackOptimized(prevItem, playbackManager.getCurrentAlbumId(), ctx.currentIndex, ctx.items.length);
        return;
      } catch (error) {
        console.error('Error reproduciendo pista anterior de álbum:', error);
        setTimeout(() => playPreviousInContext(), 1000);
      }
    } else if (context === 'searchPlaylist') {
      // Reproducir desde la lista de búsqueda precargada
      await playAudioTrackOptimized(prevItem, prevItem.id, 0, 1);
    }
    
    // Try/catch global para la función completa
  } catch (error) {
    console.error('Error al reproducir pista anterior:', error);
    setTimeout(() => playPreviousInContext(), 1000);
  }
}

// Repeat mode functions
function toggleRepeatMode() {
  const modes = ['all', 'one', 'off'];
  const currentIndex = modes.indexOf(state.repeatMode);
  state.repeatMode = modes[(currentIndex + 1) % modes.length];
  saveRepeatMode(state.repeatMode);
  updateRepeatBtn();
  showStatus(`Modo de repetición: ${state.repeatMode === 'all' ? 'Todas' : state.repeatMode === 'one' ? 'Una' : 'Apagado'}`, 'info', 2000);
}

function updateRepeatBtn() {
  if (!elements.repeatBtn) return;

  const icons = {
    all: '🔁', // Repeat all
    one: '🔂', // Repeat one
    off: '➡️'   // No repeat
  };

  elements.repeatBtn.textContent = icons[state.repeatMode] || '🔁';
  elements.repeatBtn.title = `Modo de repetición: ${state.repeatMode === 'all' ? 'Todas' : state.repeatMode === 'one' ? 'Una' : 'Apagado'}`;
}

function loadRepeatMode() {
  try {
    const saved = localStorage.getItem('resonate_repeat_mode');
    if (saved && ['all', 'one', 'off'].includes(saved)) {
      state.repeatMode = saved;
    }
  } catch (e) {
    state.repeatMode = 'all'; // Default
  }
}

function saveRepeatMode(mode) {
  try {
    localStorage.setItem('resonate_repeat_mode', mode);
  } catch (e) {
    console.warn('Error saving repeat mode:', e);
  }
}

function updateProgressBar() {
  if (!state.isSeeking && elements.audio.duration && isFinite(elements.audio.duration)) {
    const progressPercent = (elements.audio.currentTime / elements.audio.duration) * 100;
    elements.progress.style.width = `${progressPercent}%`;
    elements.currentTime.textContent = formatTime(elements.audio.currentTime);
    elements.totalTime.textContent = formatTime(elements.audio.duration);

    // Actualizar Media Session
    updateMediaPositionState();
  }
}

// Track listening statistics
function setupListenTracking() {
  let endedHandlerExecuted = false;

  elements.audio.addEventListener('play', () => {
    endedHandlerExecuted = false;
    if (state.currentTrack) {
      state.currentTrackListenStart = Date.now();
    }
  });

  elements.audio.addEventListener('ended', async () => {
    // PREVENIR EJECUCIÓN MÚLTIPLE
    if (endedHandlerExecuted) {
      return;
    }
    endedHandlerExecuted = true;

    if (state.currentTrack) {
      const listenDuration = Date.now() - state.currentTrackListenStart;
      const trackDuration = elements.audio.duration * 1000; // Convertir a ms

      // Si se escuchó al menos el 90% de la pista, marcarla como escuchada completamente
      if (listenDuration >= trackDuration * 0.9) {
        await audioCache.markAsFullyListened(state.currentTrack.url);
        // Replace in FIFO when playback completes
        if (isTrackFavorite(state.currentTrack)) {
          await audioCache.replaceFavoritesQueueItem(state.currentTrack.url, null, state.favorites);
        }

        // Update usage stats and warn if very high
        const stats = await audioCache.getUsageStats();
        if (stats && stats.usagePercentage > 90) {
          showStatus(`Storage: ${stats.usagePercentage.toFixed(1)}% used`, 'info', 3000);
        }
      } else {
        // Registrar que se saltó temprano
        const skipCount = state.tracksSkippedEarly.get(state.currentTrack.url) || 0;
        state.tracksSkippedEarly.set(state.currentTrack.url, skipCount + 1);
        // Track skipped early: increment skip counter silently
      }

      state.currentTrackListenStart = 0;
    }

    // Apply repeat mode
    if (state.repeatMode === 'one') {
      // Replay current track
      elements.audio.currentTime = 0;
      elements.audio.play();
      endedHandlerExecuted = false; // Allow loop
      return;
    } else if (state.repeatMode === 'all') {
      // Play next in context
      playNextInContext();
    } else {
      // 'off': Do nothing, stop playback
      showStatus('Reproducción finalizada', 'info', 2000);
    }
  });

  elements.audio.addEventListener('seeked', () => {
    // Si el usuario busca hacia atrás, reiniciar el contador de escucha
    if (state.currentTrackListenStart > 0) {
      state.currentTrackListenStart = Date.now();
    }
  });
}

// Enhanced progress bar interaction
function setupProgressBarInteraction() {
  let isDragging = false;

  const startDrag = (e) => {
    if (!elements.audio.duration || !isFinite(elements.audio.duration)) return;

    isDragging = true;
    state.isSeeking = true;
    elements.progressBar.classList.add('dragging');
    elements.progressSection.classList.add('dragging');

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
    elements.progressBar.classList.remove('dragging');
  };

  const updateProgressOnDrag = (e) => {
    const progressBarRect = elements.progressBar.getBoundingClientRect();
    let clientX;

    if (e.type.includes('touch')) {
      clientX = e.touches[0].clientX;
    } else {
      clientX = e.clientX;
    }

    // Adjust for the 42px offset occupied by current-time text
    // The clickable area is progressBarRect.width - 42px (current-time width) - 5px (total-time margin)
    const offsetLeft = 42; // Width of current-time element
    const offsetRight = 5; // Right margin for total-time
    const effectiveWidth = progressBarRect.width - offsetLeft - offsetRight;

    const clickPosition = Math.max(0, Math.min(1, (clientX - (progressBarRect.left + offsetLeft)) / effectiveWidth));
    const seekTime = clickPosition * elements.audio.duration;

    // Update display
    elements.progress.style.width = `${clickPosition * 100}%`;
    elements.currentTime.textContent = formatTime(seekTime);

    // Update audio on both drag and click
    elements.audio.currentTime = seekTime;
  };

  // Configure events - remove duplicates
  elements.progressBar.addEventListener('mousedown', startDrag);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', endDrag);

  elements.progressBar.addEventListener('touchstart', startDrag, { passive: false });
  document.addEventListener('touchmove', drag, { passive: false });
  document.addEventListener('touchend', endDrag, { passive: false });

  // SOLO UN event listener para click
  elements.progressBar.addEventListener('click', (e) => {
    if (!isDragging) { // Solo procesar clicks que no sean parte de un arrastre
      updateProgressOnDrag(e);
    }
  });
}

function updateShuffleButton() {
  const ctx = playbackManager.getCurrentContext();
  let noun = ctx === 'search' ? 'resultados de búsqueda' : ctx === 'album' ? 'álbum' : 'favoritos';

  // Shuffle button is always enabled for all contexts
  elements.shuffleFavoritesBtn.enable = false;

  if (state.shuffleFavorites) {
    elements.shuffleFavoritesBtn.classList.add('active');
    elements.shuffleFavoritesBtn.setAttribute('aria-label', `Desactivar reproducción aleatoria de ${noun}`);
  } else {
    elements.shuffleFavoritesBtn.classList.remove('active');
    elements.shuffleFavoritesBtn.setAttribute('aria-label', `Activar reproducción aleatoria de ${noun}`);
  }
}

function toggleShuffleFavorites() {
  state.shuffleFavorites = !state.shuffleFavorites;

  const context = playbackManager.getCurrentContext() || (state.favorites && state.favorites.length > 0 ? 'favorites' : 'search');

  if (state.shuffleFavorites) {
    // Activar modo aleatorio
    if (context === 'favorites' && state.favorites.length > 0) {
      showStatus('Reproducción aleatoria de favoritos activada', 'info', 2000);
      loadPlaybackQueue('favorites', state.favorites, 0);
      if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.loadFavoritesQueue === 'function') {
        audioCache.loadFavoritesQueue(state.favorites, true);
      }
    } else if (context === 'search' && state.searchResults && state.searchResults.length > 0) {
      showStatus('Reproducción aleatoria de resultados activada', 'info', 2000);
      loadPlaybackQueue('search', state.searchResults, 0);
      if (state.networkOnline) {
        if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.preloadTracks === 'function') {
          audioCache.preloadTracks(state.playbackQueue, true);
        }
      }
    } else {
      showStatus('Reproducción aleatoria activada', 'info', 2000);
    }
  } else {
    // Desactivar modo aleatorio: volver a modo secuencial
    if (context === 'favorites' && state.favorites.length > 0) {
      showStatus('Reproducción aleatoria de favoritos desactivada', 'info', 2000);
      const ctx = playbackManager.contextData['favorites'] || { currentIndex: 0, items: state.favorites };
      const currentIndex = typeof ctx.currentIndex === 'number' ? ctx.currentIndex : 0;
      loadPlaybackQueue('favorites', ctx.items.length ? ctx.items : state.favorites, currentIndex + 1);
    } else if (context === 'search' && state.searchResults && state.searchResults.length > 0) {
      showStatus('Reproducción secuencial de resultados activada', 'info', 2000);
      const ctx = playbackManager.contextData['search'] || { currentIndex: 0, items: state.searchResults };
      const currentIndex = typeof ctx.currentIndex === 'number' ? ctx.currentIndex : 0;
      loadPlaybackQueue('search', ctx.items.length ? ctx.items : state.searchResults, currentIndex + 1);
    } else {
      showStatus('Reproducción aleatoria desactivada', 'info', 2000);
    }
  }

  updateShuffleButton();
}

function setupMediaSession() {
  if (!('mediaSession' in navigator)) {
    // Media Session API not available in this environment
    return;
  }

  try {
    navigator.mediaSession.setActionHandler('play', () => {
      togglePlay();
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      togglePlay();
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      playPrevious();
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      playNext();
    });

    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const skipTime = details.seekOffset || 10;
      elements.audio.currentTime = Math.max(0, elements.audio.currentTime - skipTime);
    });

    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const skipTime = details.seekOffset || 10;
      elements.audio.currentTime = Math.min(elements.audio.duration, elements.audio.currentTime + skipTime);
    });

    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.fastSeek && 'fastSeek' in elements.audio) {
        elements.audio.fastSeek(details.seekTime);
      } else {
        elements.audio.currentTime = details.seekTime;
      }
    });
  } catch (error) {
    console.warn('Some Media Session actions unavailable:', error);
  }
}

async function playOptimizedFavorite(favoriteIndex = 0) {
  if (state.isLoading || state.favorites.length === 0) return;

  loaderManager.showPlayButtonLoader('favorite');

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
    const favoritesQueue = typeof audioCache !== 'undefined' && audioCache && typeof audioCache.getFavoritesQueue === 'function' ? audioCache.getFavoritesQueue() : [];
    const isPreloaded = favoritesQueue.includes(track.url);

    if (isPreloaded) {
      console.log('Playing from preloaded favorites:', track.title);
    } else {
      console.log('Favorite not preloaded, loading from network:', track.title);
    }

    const cached = typeof audioCache !== 'undefined' && audioCache && typeof audioCache.get === 'function' ? await audioCache.get(track.url) : null;
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

async function playSpecificTrack(track, albumId, trackIndex, totalTracks) {
  if (state.isLoading) return;

  loaderManager.showPlayButtonLoader('specific');

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
    loaderManager.hidePlayButtonLoader('specific');
  }
}

async function playRandomSearchResults() {
  if (state.isLoading || !state.searchResults || state.searchResults.length === 0) return;

  loaderManager.showPlayButtonLoader('random');

  try {
    // Shuffle the search results
    const shuffledResults = [...state.searchResults].sort(() => Math.random() - 0.5);

    // Set up playback context for random search results
    playbackManager.setContext('search', shuffledResults, 0);
    state.albumOrigin = 'search';

    // Load shuffled results into playback queue
    loadPlaybackQueue('search', shuffledResults, 0);

    if (state.playbackQueue.length === 0) {
      throw new Error('No playable tracks found in search results');
    }

    const firstTrack = state.playbackQueue[0];

    if (!firstTrack.url) {
      throw new Error('First track has no URL');
    }

    showStatus(`Playing random from search results: ${firstTrack.title}`, 'info', 0);

    // Remove from queue before playing
    state.playbackQueue.shift();

    await playAudioTrackOptimized(firstTrack, firstTrack.id, 0, 1);

    updateShuffleButton();

  } catch (error) {
    console.error('Error in playRandomSearchResults:', error);
    showStatus(`Error: ${error.message}`, 'error');
    loaderManager.hidePlayButtonLoader('random');
  }
}

window.playPrevious = playPrevious;
window.playNext = playNext;
window.resumeSavedPlayback = resumeSavedPlayback;
window.setupPreloadedPlayback = setupPreloadedPlayback;
window.playOptimizedFavorite = playOptimizedFavorite;
window.playSpecificTrack = playSpecificTrack;
window.playRandomSearchResults = playRandomSearchResults;
window.setupListenTracking = setupListenTracking;
