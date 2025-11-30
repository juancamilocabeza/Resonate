// Application initialization

async function initializeApp() {
  console.log('DEBUG: Starting initializeApp()');

  // Inicializar caché de audio primero
  try {
    console.log('DEBUG: About to initialize audioCache');
    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.init === 'function') {
      console.log('DEBUG: audioCache available, calling init()');
      await audioCache.init();
      console.log('DEBUG: audioCache.init() completed successfully');
      window.logger?.info('Audio cache initialized successfully', 'CACHE');
    } else {
      console.log('DEBUG: audioCache not available or missing init method');
      window.logger?.warn('audioCache not available, continuing without cache', 'CACHE');
    }
  } catch (error) {
    console.error('DEBUG: Error in audioCache.init():', error);
    window.logger?.error(`Error initializing cache: ${error.message}`, 'CACHE');
  }


  window.loadFavorites();
  // Preparar el CTA (se mostrará si hay favoritos precargados)
  //createStartFavoritesCTA();
  // setupLoadingSafety() is called only when actual loading operations are in progress

  // Pre-cargar favoritos para reproducción offline
  if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.preloadFavorites === 'function') {
    setTimeout(async () => {
      try {
        await audioCache.preloadFavorites(state.favorites);
        window.logger?.info('Favorites preloaded for offline playback', 'CACHE');
      } catch (error) {
        window.logger?.warn(`Failed to preload favorites: ${error.message}`, 'CACHE');
      }
    }, 1000); // Delay to avoid blocking initial load
  }

  // Inicializar el componente FavoritesToggle
  if (typeof FavoritesToggle !== 'undefined') {
    favoritesToggleInstance = new FavoritesToggle();
    window.logger.info('FavoritesToggle component initialized', 'UI');
  } else {
    window.logger.warn('FavoritesToggle class not available', 'UI');
  }

  // Cargar estado de reproducción guardado (última sesión)
  loadSavedPlaybackState();

  setupConnectivityMonitoring();
  setupPageVisibilityHandling();
  setupListenTracking();

  // Preparar reproducción de favoritos (sin autoplay por restricciones del navegador)
  // Solo preparar la cola sin hacer peticiones de red automáticas
  if (state.favorites.length > 0) {
    // Preparing favorites queue (no network requests during init)
    setTimeout(async () => {
      try {
        // Solo cargar la cola FIFO sin precargar audio
        await loadPlaybackQueue('favorites', state.favorites, 0);
        if (state.playbackQueue.length > 0) {
          const firstTrack = state.playbackQueue[0];
          showStatus(`Listo para reproducir: ${firstTrack.title}. Haz clic en el botón de reproducción.`, 'info', 3000);
        }
      } catch (error) {
        window.logger.error(`Error preparing favorites queue: ${error.message}`, 'PLAYBACK');
      }
    }, 500);
  }

  // Configurar Media Session API
  setupMediaSession();
  setupSearchOnEnter();
  setupSearchFocusBehavior();
  setupProgressBarInteraction();

  // Configurar elementos opcionales - SOLO SI EXISTEN
  if (elements.playAllFavoritesBtn) {
    elements.playAllFavoritesBtn.addEventListener('click', async () => {
      if (state.favorites.length === 0) {
        showStatus('No hay favoritos para reproducir', 'info');
        return;
      }

      state.userInteracted = true;
      showStatus('Reproduciendo todos los favoritos', 'info');
      await playFromFavoritesQueue();
    });
  }

  // Volume control event listeners
  if (elements.volumeSlider) {
    elements.volumeSlider.addEventListener('input', (e) => {
      const volume = parseFloat(e.target.value);
      if (!isNaN(volume)) {
        elements.audio.volume = volume;
        saveVolume(volume);
        updateVolumeIcon();
        window.logger.debug(`Volume changed to ${volume}`, 'UI');
      }
    });
  }

  if (elements.volumeIcon) {
    elements.volumeIcon.addEventListener('click', () => {
      window.logger.info('Mute toggle clicked', 'UI');
      toggleMute();
    });
  }



  if (elements.audio) {
    elements.audio.addEventListener('timeupdate', updateProgressBar);
    elements.audio.addEventListener('loadedmetadata', updateProgressBar);
    elements.audio.addEventListener('play', () => {
      elements.playBtn.textContent = '| |';
      // Actualizar Media Session
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
    });

    elements.audio.addEventListener('pause', () => {
      elements.playBtn.textContent = '▶';
      // Actualizar Media Session
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
    });


    elements.audio.addEventListener('error', (e) => {
      window.logger.error(`Audio error: ${e.target.error?.code} - ${e.target.error?.message}`, 'PLAYBACK');
      showStatus('Playback error', 'error');

      // Restore state on error
      state.isLoading = false;
      elements.playBtn.disabled = false;
      elements.playBtn.textContent = '▶';
    });
  }

  if (elements.shuffleFavoritesBtn) {
    elements.shuffleFavoritesBtn.addEventListener('click', () => {
      window.logger.info('Shuffle favorites toggle clicked', 'UI');
      toggleShuffleFavorites();
    });
  }

  if (elements.prevBtn) {
    elements.prevBtn.addEventListener('click', () => {
      window.logger.info('Previous track button clicked', 'UI');
      playPrevious();
    });
  }

  if (elements.playBtn) {
    elements.playBtn.addEventListener('click', () => {
      window.logger.info('Play/pause button clicked', 'UI');
      togglePlay();
    });
    // Ocultar CTA si el usuario hace clic en el botón de reproducir
    elements.playBtn.addEventListener('click', hideStartFavoritesCTA);
  }

  if (elements.nextBtn) {
    elements.nextBtn.addEventListener('click', () => {
      window.logger.info('Next track button clicked', 'UI');
      playNext();
    });
  }

  if (elements.favoriteBtn) {
    elements.favoriteBtn.addEventListener('click', async () => {
      if (state.currentTrack && !state.currentTrack.url && state.currentTrack.id) {
        try {
          const files = await fetchOptimizedPlayableFiles(state.currentTrack.id);
          if (files.length > 0) {
            state.currentTrack.url = files[0].url;
            toggleFavorite(state.currentTrack);
          }
        } catch (error) {
          window.logger.error(`Error fetching URL for favorite: ${error.message}`, 'UI');
          showStatus('Error al agregar favorito', 'error');
        }
      } else {
        toggleFavorite(state.currentTrack);
      }
    });
  }



  document.addEventListener('click', (e) => {
    if (!elements.searchInput.contains(e.target) &&
      !elements.searchResults.contains(e.target)) {
      hideSearchResults();
    }
  });

  document.addEventListener('click', () => {
    state.userInteracted = true;
  });

  // Configurar botón de inicio
  if (elements.startButton) {
    elements.startButton.addEventListener('click', () => {
      window.logger.info('Start app button clicked', 'UI');
      startApp();
    });
  }

  updateShuffleButton();

  if (elements.repeatBtn) {
    elements.repeatBtn.addEventListener('click', () => {
      window.logger.info('Repeat mode toggle clicked', 'UI');
      toggleRepeatMode();
    });
    updateRepeatBtn();
  }

  loadRepeatMode();

  // Inicializar PWA
  registerServiceWorker();
  setupPWAInstall();
  setupOfflineFunctionality();

  // Handle back button to hide search results and favorites list
  window.addEventListener('popstate', (e) => {
    // Check if search results or favorites are visible
    const searchVisible = window.elements && window.elements.searchResults &&
      window.elements.searchResults.classList.contains('active');
    const favoritesVisible = window.elements && window.elements.favoritesList &&
      window.elements.favoritesList.classList.contains('active');

    if (searchVisible || favoritesVisible) {
      // Hide them and prevent navigation by pushing state back
      if (searchVisible) window.hideSearchResults();
      if (favoritesVisible) window.hideFavoritesList();
      // Push state again to stay on the page
      window.history.pushState(null, '', window.location.href);
    } else if (isRunningAsPWA()) {
      // PWA behavior: prevent closing the app
      window.history.pushState(null, '', window.location.href);
      showStatus('Presiona el botón de acción flotante para cerrar la aplicación', 'info', 3000);
    }
    // If not PWA and no elements visible, allow normal back navigation (don't push state)
  });

  // Initialize push state to catch back button attempts
  window.history.pushState(null, '', window.location.href);

  // Additional safeguard for PWA: disable back button navigation entirely
  if (isRunningAsPWA()) {
    let lastUrl = window.location.href;
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        // If URL changed and we're in PWA, prevent it
        window.location.href = lastUrl;
      }
      lastUrl = window.location.href;
    }, 1000);
  }

  // Si la app está ejecutándose como PWA, eliminar el splash y mostrar la app inmediatamente
  if (isRunningAsPWA()) {
    try {
      if (elements.startView) elements.startView.classList.add('hidden');
      if (elements.app) elements.app.classList.add('active');
      // Remover cualquier elemento splash personalizado si existe
      const splashEl = document.querySelector('.start-view');
      if (splashEl && splashEl.parentNode) splashEl.parentNode.removeChild(splashEl);
      window.logger.info('PWA detected: splash removed and app activated', 'SYSTEM');
    } catch (err) {
      window.logger.warn(`Error while hiding splash for PWA: ${err.message}`, 'SYSTEM');
    }
  }

  // Hide favorites list when playing a favorite
  addHideFavoritesOnPlay();

  // EXPONER FUNCIONES GLOBALES CRÍTICAS
  window.onplay = onplay;
  window.state = state;
  window.elements = elements;
  window.playPrevious = playPrevious;
  window.playNext = playNext;
  window.playPreviousInContext = playPreviousInContext;
  window.playNextInContext = playNextInContext;
  window.forcePlay = forcePlay;
  window.playOptimizedFavorite = playOptimizedFavorite;
  window.playAlbumFromFavorites = playAlbumFromFavorites;
  window.playSpecificTrack = playSpecificTrack;
  window.toggleShuffleFavorites = toggleShuffleFavorites;
  window.addAlbumToFavorites = addAlbumToFavorites;
  window.removeAlbumFromFavorites = removeAlbumFromFavorites;
  window.isAlbumInFavorites = isAlbumInFavorites;
  window.playRandomSearchResults = playRandomSearchResults;
  window.audioCache = typeof audioCache !== 'undefined' ? audioCache : null;
  window.installPWA = typeof installPWA !== 'undefined' ? installPWA : null;
  window.preloadNextTrack = preloadNextTrack;
  window.loadPlaybackQueue = loadPlaybackQueue;
  window.playFromFavoritesQueue = playFromFavoritesQueue;
  window.dispatchEvent(new Event('resonate:results-rendered'));

  // Handle offline mode after everything is initialized
  console.log('DEBUG: About to call handleOfflineMode');
  setTimeout(() => {
    console.log('DEBUG: Calling handleOfflineMode now');
    handleOfflineMode();
  }, 100); // Small delay to ensure everything is ready

  console.log('DEBUG: initializeApp completed successfully');

}

// Function to show offline music section when we have cached music but no favorites
async function showOfflineMusicSection() {
  try {
    if (typeof audioCache === 'undefined' || !audioCache || typeof audioCache.getAllMetadata !== 'function') {
      return;
    }

    const cachedMetadata = await audioCache.getAllMetadata();
    if (!cachedMetadata || cachedMetadata.length === 0) {
      return;
    }

    // Create offline music section if it doesn't exist
    let offlineSection = document.getElementById('offline-music-section');
    if (!offlineSection) {
      offlineSection = document.createElement('div');
      offlineSection.id = 'offline-music-section';
      offlineSection.className = 'offline-music-section';
      offlineSection.innerHTML = `
        <div class="offline-music-header">
          <h3>🎵 Música Offline</h3>
          <p>Tienes ${cachedMetadata.length} pista(s) disponible(s) sin conexión</p>
        </div>
        <div id="offline-music-list" class="offline-music-list"></div>
      `;

      // Insert after search section
      const searchSection = document.querySelector('.discovery-section');
      if (searchSection) {
        searchSection.appendChild(offlineSection);
      }
    }

    // Populate the list
    const listContainer = document.getElementById('offline-music-list');
    if (listContainer) {
      listContainer.innerHTML = '';

      cachedMetadata.forEach((metadata, index) => {
        const item = document.createElement('div');
        item.className = 'offline-music-item';
        item.innerHTML = `
          <div class="offline-music-info">
            <div class="offline-music-title">${metadata.title || 'Sin título'}</div>
            <div class="offline-music-creator">${metadata.creator || 'Desconocido'}</div>
            <div class="offline-music-size">${formatBytes(metadata.size || 0)}</div>
          </div>
          <button class="offline-play-btn" data-url="${metadata.url}" data-index="${index}">
            ▶
          </button>
        `;

        // Add click handler
        const playBtn = item.querySelector('.offline-play-btn');
        playBtn.addEventListener('click', () => {
          playOfflineTrack(metadata);
        });

        listContainer.appendChild(item);
      });
    }

    // Show the section
    offlineSection.style.display = 'block';

  } catch (error) {
    console.warn('Error showing offline music section:', error);
  }
}

// Function to play an offline track
async function playOfflineTrack(metadata) {
  try {
    const track = {
      url: metadata.url,
      title: metadata.title || 'Sin título',
      creator: metadata.creator || 'Desconocido',
      id: metadata.url, // Use URL as ID for offline tracks
      isOffline: true
    };

    // Use existing playback function
    if (typeof playAudioTrackOptimized === 'function') {
      await playAudioTrackOptimized(track, track.id);
    }

  } catch (error) {
    console.error('Error playing offline track:', error);
    if (typeof showStatus === 'function') {
      showStatus('Error reproduciendo pista offline', 'error');
    }
  }
}

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Function to handle offline mode detection after initialization is complete
function handleOfflineMode() {
  console.log('DEBUG: handleOfflineMode called');
  console.log('DEBUG: navigator.onLine =', navigator.onLine);

  // EMERGENCY FALLBACK: Always ensure app is visible first
  try {
    const fallback = document.getElementById('offline-fallback');
    const app = document.getElementById('app');
    console.log('DEBUG: Elements found - fallback:', !!fallback, 'app:', !!app);

    if (fallback && app) {
      // Start with app visible by default
      fallback.style.display = 'none';
      app.style.display = 'block';
      console.log('DEBUG: App set to visible by default');
    }
  } catch (emergencyError) {
    console.error('DEBUG: Emergency fallback failed:', emergencyError);
  }

  // Only check offline status if we're actually offline
  if (!navigator.onLine) {
    console.log('DEBUG: Device is offline, checking content...');

    try {
      // Check favorites first
      const favoritesCount = localStorage.getItem('resonate_favorites');
      let hasFavorites = false;

      try {
        if (favoritesCount) {
          const favorites = JSON.parse(favoritesCount);
          hasFavorites = favorites && favorites.length > 0;
        }
      } catch (e) {
        console.warn('DEBUG: Error parsing favorites:', e);
        hasFavorites = false;
      }

      console.log('DEBUG: hasFavorites =', hasFavorites);

      // Check if there's any cached music available (synchronous check first)
      let hasCachedMusic = false;
      try {
        if (typeof audioCache !== 'undefined' && audioCache) {
          console.log('DEBUG: audioCache available, checking getAllMetadata...');
          // Try synchronous check first, then async if needed
          if (typeof audioCache.getAllMetadata === 'function') {
            // For now, assume we have cached music if audioCache is available
            // We'll do the real check asynchronously later
            hasCachedMusic = true;
            console.log('DEBUG: Assuming cached music available initially');
          }
        } else {
          console.log('DEBUG: audioCache not available');
        }
      } catch (e) {
        console.warn('DEBUG: Error checking cached music:', e);
        hasCachedMusic = false;
      }

      console.log('DEBUG: hasCachedMusic =', hasCachedMusic);

      // Show offline fallback only if no favorites AND no cached music
      if (!hasFavorites && !hasCachedMusic) {
        console.log('DEBUG: Showing offline fallback');
        const fallback = document.getElementById('offline-fallback');
        const app = document.getElementById('app');

        if (fallback && app) {
          app.style.display = 'none';
          fallback.style.display = 'flex';
          document.body.style.overflow = 'hidden';
        }
        if (window.logger) window.logger.info('Showing offline fallback - no cached music available', 'SYSTEM');
      } else {
        // We have either favorites or cached music, ensure app is visible
        console.log('DEBUG: App should be visible - has content');
        if (window.logger) window.logger.info(`App ready for offline use - Favorites: ${hasFavorites}, Cached music: ${hasCachedMusic}`, 'SYSTEM');

        // If we have cached music but no favorites, show offline music section asynchronously
        if (hasCachedMusic && !hasFavorites) {
          console.log('DEBUG: Scheduling offline music section display');
          setTimeout(async () => {
            try {
              console.log('DEBUG: Calling showOfflineMusicSection');
              await showOfflineMusicSection();
            } catch (asyncError) {
              console.error('DEBUG: Error in showOfflineMusicSection:', asyncError);
            }
          }, 500); // Small delay to ensure UI is ready
        }
      }
    } catch (error) {
      console.error('DEBUG: Error in handleOfflineMode:', error);
      if (window.logger) window.logger.error(`Error in handleOfflineMode: ${error.message}`, 'SYSTEM');
      // Fallback: ensure app is visible (already done at top)
    }
  } else {
    console.log('DEBUG: Device is online, no offline handling needed');
  }

  console.log('DEBUG: handleOfflineMode completed');
}

// Esperar a que los scripts críticos estén disponibles
function waitForAllScripts() {
  return new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = 500; // 5 seconds max wait

    const checkScripts = () => {
      attempts++;
      window.logger.debug(`Checking scripts (attempt ${attempts})`, 'SYSTEM');

      // Ser menos estricto - solo requerir los scripts más críticos
      if (typeof state !== 'undefined' &&
          typeof elements !== 'undefined' &&
          typeof showStatus !== 'undefined') {
        window.logger.info('Critical scripts loaded, proceeding...', 'SYSTEM');
        resolve();
      } else if (attempts >= maxAttempts) {
        window.logger.warn('Timeout waiting for scripts, proceeding with available...', 'SYSTEM');
        resolve(); // Continue anyway after timeout
      } else {
        setTimeout(checkScripts, 10);
      }
    };
    checkScripts();
  });
}


// Inicialización segura que espera a todos los scripts
async function safeInitialize() {
  try {
    window.logger.info('Waiting for all scripts to be available...', 'SYSTEM');
    await waitForAllScripts();
    window.logger.info('All scripts loaded, initializing application...', 'SYSTEM');

    await initializeApp();
  } catch (error) {
    window.logger.error(`Error in safe initialization: ${error.message}`, 'SYSTEM');
    // Fallback mínimo
    try {
      if (typeof loadFavorites !== 'undefined') loadFavorites();
      if (typeof setupConnectivityMonitoring !== 'undefined') setupConnectivityMonitoring();
      window.logger.info('Basic fallback completed', 'SYSTEM');
    } catch (fallbackError) {
      window.logger.error(`Error in fallback: ${fallbackError.message}`, 'SYSTEM');
    }
  }
}

// Iniciar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', safeInitialize);
} else {
  safeInitialize();
}
