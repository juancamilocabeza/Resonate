// Application initialization

async function initializeApp() {
  // Inicializar caché de audio primero
  try {
    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.init === 'function') {
      await audioCache.init();
      window.logger.info('Audio cache initialized successfully', 'CACHE');
    } else {
      window.logger.warn('audioCache not available, continuing without cache', 'CACHE');
    }
  } catch (error) {
    window.logger.error(`Error initializing cache: ${error.message}`, 'CACHE');
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
  window.installPWA = installPWA;
  window.preloadNextTrack = preloadNextTrack;
  window.loadPlaybackQueue = loadPlaybackQueue;
  window.playFromFavoritesQueue = playFromFavoritesQueue;
  window.dispatchEvent(new Event('resonate:results-rendered'));

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
