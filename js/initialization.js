// Application initialization

// Function to update meta tags for shared link previews
async function updateMetaTagsForSharedLink(identifier) {
  try {
    // Fetch basic metadata from archive.org
    const response = await fetch(`https://archive.org/metadata/${identifier}`);
    if (!response.ok) {
      throw new Error('Failed to fetch metadata');
    }

    const metadata = await response.json();
    const title = metadata.metadata?.title || 'Shared content';
    const creator = metadata.metadata?.creator || 'Resonate Player';

    // Update meta tags for social media sharing
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

    console.log('Meta tags updated for shared link:', { title, creator, imageUrl, shareUrl });

  } catch (error) {
    console.warn('Error updating meta tags for shared link:', error);
    // Fallback: update with generic content but correct image
    const imageUrl = `https://archive.org/services/img/${identifier}`;
    updateMetaTag('property', 'og:image', imageUrl);
    updateMetaTag('property', 'twitter:image', imageUrl);
  }
}

// Function to handle shared links (play parameter)
async function handleSharedLink() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const playIdentifier = urlParams.get('play');

    if (playIdentifier) {
      console.log('Shared link detected, playing:', playIdentifier);
      showStatus('Preparing to load your shared track', 'info');

      // Update meta tags for social media previews immediately
      try {
        await updateMetaTagsForSharedLink(playIdentifier);
      } catch (error) {
        console.warn('Error updating meta tags for shared link:', error);
      }

      // Clear the URL parameter to avoid re-triggering
      const url = new URL(window.location);
      url.searchParams.delete('play');
      window.history.replaceState({}, '', url);

      // Wait a bit for the app to be fully initialized
      setTimeout(async () => {
        try {
          await playSharedContent(playIdentifier);
        } catch (error) {
          console.error('Error playing shared content:', error);
          showStatus('Failed to load the shared track', 'error');
        }
      }, 1000);
    }
  } catch (error) {
    console.error('Error handling shared link:', error);
  }
}

// Function to play content from shared link
async function playSharedContent(identifier) {
  try {
    // Fetch the playable files for this identifier
    const files = await fetchOptimizedPlayableFiles(identifier);

    if (!files || files.length === 0) {
      throw new Error('No playable tracks found');
    }

    // Determine if this is an album (multiple tracks) or single track
    const isAlbum = files.length > 1;

    if (isAlbum) {
      // Handle album sharing - load all tracks into playlist
      console.log(`Shared album detected: ${files.length} tracks`);

      // Create album metadata
      const albumData = {
        id: identifier,
        title: files[0].title || 'Shared album',
        creator: files[0].creator || 'Unknown',
        tracks: files.length
      };

      // Add album metadata to each track
      const tracksWithMetadata = files.map((track, index) => ({
        ...track,
        albumId: identifier,
        albumTitle: albumData.title,
        trackIndex: index,
        totalTracks: files.length
      }));

      // Load album tracks into playback queue
      await loadPlaybackQueue('shared-album', tracksWithMetadata, 0);

      showStatus('Your shared album is ready to play', 'info', 3000);

      // Start playing the first track
      if (tracksWithMetadata.length > 0) {
        await playAudioTrackOptimized(tracksWithMetadata[0], identifier);
      }

    } else {
      // Handle single track sharing
      const track = files[0];

      // Update meta tags for rich previews when sharing
      if (typeof updateMetaTags === 'function') {
        updateMetaTags(track, identifier);
      }

      showStatus('Now playing your shared track', 'info', 3000);

      // Use existing playback function
      await playAudioTrackOptimized(track, identifier);
    }

  } catch (error) {
    console.error('Error in playSharedContent:', error);
    throw error;
  }
}

async function initializeApp() {
  console.log('Starting app initialization...');

  // Make loaderManager globally accessible (it's defined in ui.js which loads before)
  if (typeof window !== 'undefined' && window.loaderManager) {
    window.loaderManager = window.loaderManager;
  }

  // One-time: Clear old SW audio cache from previous versions (avoid duplicate audio storage)
  try {
    const swAudioCacheCleared = localStorage.getItem('resonate_sw_audio_cache_cleared');
    if (!swAudioCacheCleared) {
      // Clear old audio cache from SW on first load after update
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'CLEAR_AUDIO_CACHE'
        });
        window.logger?.info('Requested SW to clear old audio cache', 'INIT');
        localStorage.setItem('resonate_sw_audio_cache_cleared', 'true');
      }
    }
  } catch (error) {
    window.logger?.warn(`Failed to clear SW cache: ${error.message}`, 'INIT');
  }

  // Inicializar caché de audio primero
  try {
    console.log('Initializing audio cache...');
    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.init === 'function') {
      await audioCache.init();
      window.logger?.info('Audio cache initialized successfully', 'CACHE');
      console.log('Audio cache initialized');
    } else {
      console.warn('audioCache not available, continuing without cache');
      window.logger?.warn('audioCache not available, continuing without cache', 'CACHE');
    }
  } catch (error) {
    console.error('Error initializing cache:', error);
    window.logger?.error(`Error initializing cache: ${error.message}`, 'CACHE');
  }


  // Load favorites if available, otherwise retry
  if (typeof window.loadFavorites === 'function') {
    window.loadFavorites();
  } else {
    // Retry after a short delay if ui.js hasn't loaded yet
    setTimeout(() => {
      if (typeof window.loadFavorites === 'function') {
        window.loadFavorites();
      } else {
        window.logger?.error('loadFavorites function not available', 'INIT');
      }
    }, 100);
  }
  // Preparar el CTA (se mostrará si hay favoritos precargados)
  //createStartFavoritesCTA();
  // setupLoadingSafety() is called only when actual loading operations are in progress

  // Pre-cargar favoritos para reproducción offline (single guarded run)
  if (state.favoritesPreloadEnabled && typeof audioCache !== 'undefined' && audioCache && typeof audioCache.preloadFavorites === 'function') {
    setTimeout(async () => {
      try {
        await audioCache.preloadFavorites(state.favorites);
        window.logger?.info('Favorites preload attempted once at startup', 'CACHE');
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

  // Inicializar el listener de event delegation para botones play en favoritos
  if (typeof window.initializeFavoritesPlayListener === 'function') {
    console.log('Calling initializeFavoritesPlayListener...');
    window.initializeFavoritesPlayListener();
    window.logger.info('Favorites play button listener initialized', 'UI');
  } else {
    console.warn('initializeFavoritesPlayListener function not available - window.initializeFavoritesPlayListener:', typeof window.initializeFavoritesPlayListener);
    window.logger.warn('initializeFavoritesPlayListener function not available', 'UI');
  }

  // Cargar estado de reproducción guardado (última sesión)
  loadSavedPlaybackState();

  // Handle shared links (play parameter)
  await handleSharedLink();

  // Setup functions - verificar existencia antes de llamar
  if (typeof setupConnectivityMonitoring === 'function') {
    setupConnectivityMonitoring();
  }

  if (typeof setupPageVisibilityHandling === 'function') {
    setupPageVisibilityHandling();
  }

  if (typeof setupListenTracking === 'function') {
    setupListenTracking();
  }

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
          showStatus('Tap play to start your favorites', 'info', 3000);
        }
      } catch (error) {
        window.logger.error(`Error preparing favorites queue: ${error.message}`, 'PLAYBACK');
      }
    }, 500);
  }

  // Configurar funciones de UI - verificar existencia antes de llamar
  if (typeof setupMediaSession === 'function') {
    setupMediaSession();
  }

  if (typeof setupSearchOnEnter === 'function') {
    setupSearchOnEnter();
  }

  if (typeof setupSearchFocusBehavior === 'function') {
    setupSearchFocusBehavior();
  }

  if (typeof setupProgressBarInteraction === 'function') {
    setupProgressBarInteraction();
  }

  // Configurar elementos opcionales - SOLO SI EXISTEN
  if (elements.playAllFavoritesBtn) {
    elements.playAllFavoritesBtn.addEventListener('click', async () => {
      if (state.favorites.length === 0) {
        showStatus('Add some favorites first to play', 'info');
        return;
      }

      state.userInteracted = true;
      showStatus('Starting your favorites collection', 'info');
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
      showStatus('Sorry, there was a playback issue', 'error');

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
          showStatus('Couldn\'t add that to favorites', 'error');
        }
      } else {
        toggleFavorite(state.currentTrack);
      }
    });
  }

  if (elements.currentTrackShare) {
    elements.currentTrackShare.addEventListener('click', async () => {
      if (state.currentTrack && state.currentTrack.id) {
        await shareTrack(state.currentTrack.id, state.currentTrack.title, state.currentTrack.creator);
      } else {
        showStatus('Nothing to share right now', 'warning');
      }
    });
  }



  // Event listener para el h1 - ocultar resultados de búsqueda o favoritos al hacer clic
  const appTitle = document.getElementById('app-title');
  if (appTitle) {
    appTitle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Ocultar resultados de búsqueda si están visibles
      const searchVisible = elements.searchResults && elements.searchResults.classList.contains('active');
      if (searchVisible) {
        hideSearchResults();
      }
      
      // Ocultar lista de favoritos si está visible
      const favoritesVisible = elements.favoritesList && elements.favoritesList.classList.contains('active');
      if (favoritesVisible) {
        hideFavoritesList();
      }
      
      window.logger?.info('App title clicked - hiding search results and favorites list', 'UI');
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

  // EXPONER FUNCIONES GLOBALES CRÍTICAS (después de setupPWAInstall)
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
      showStatus('Use the action button to exit', 'info', 3000);
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

  // No ocultar automáticamente las listas al reproducir
  // addHideFavoritesOnPlay(); // Deshabilitado: las listas permanecen visibles durante reproducción

// EXPONER FUNCIONES GLOBALES CRÍTICAS
  window.onplay = onplay;
  window.state = state;
  // Note: window.elements is exported by ui.js at the end of that file
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
  window.installPWA = typeof window.installPWA !== 'undefined' ? window.installPWA : null;
  window.preloadNextTrack = preloadNextTrack;
  window.loadPlaybackQueue = loadPlaybackQueue;
  window.playFromFavoritesQueue = playFromFavoritesQueue;
  window.dispatchEvent(new Event('resonate:results-rendered'));

  // Debug functions for offline testing
  window.forceShowApp = () => {
    console.log('Forcing app to show...');
    const fallback = document.getElementById('offline-fallback');
    const app = document.getElementById('app');
    if (fallback) fallback.style.display = 'none';
    if (app) app.style.display = 'block';
    console.log('App forced to show');
  };

  window.testOfflineMode = () => {
    console.log('Testing offline mode...');
    handleOfflineMode();
  };

  // Handle offline mode after everything is initialized
  setTimeout(() => {
    handleOfflineMode();
  }, 100); // Small delay to ensure everything is ready

  // Initialize onboarding for first-time users
  if (typeof onboardingManager !== 'undefined' && onboardingManager) {
    setTimeout(() => {
      onboardingManager.initialize();
      window.logger.info('Onboarding system initialized', 'UI');
    }, 500); // Delay to let UI render first
  }

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
          <h3>🎵 Offline Music</h3>
          <p>You have ${cachedMetadata.length} track(s) available offline</p>
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
            <div class="offline-music-title">${metadata.title || 'Untitled'}</div>
            <div class="offline-music-creator">${metadata.creator || 'Unknown'}</div>
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
      title: metadata.title || 'Untitled',
      creator: metadata.creator || 'Unknown',
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
      showStatus('Couldn\'t play offline track right now', 'error');
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
  // CRITICAL FIX: Always show the full app interface regardless of connection status
  // The app should work the same online and offline - users just get connectivity indicators
  try {
    const fallback = document.getElementById('offline-fallback');
    const app = document.getElementById('app');

    if (fallback && app) {
      // Always show the main app, never the fallback
      fallback.style.display = 'none';
      app.style.display = 'block';
      document.body.style.overflow = 'auto'; // Ensure scrolling works
    }

    if (window.logger) window.logger.info('App interface ensured visible', 'SYSTEM');

    // Check offline status for indicators only
    const isOffline = !navigator.onLine;
    if (window.logger) window.logger.info(`Network status: ${isOffline ? 'offline' : 'online'}`, 'SYSTEM');

    // Show connectivity indicators but don't hide the app
    if (isOffline) {
      showStatus('You\'re offline. Play favorites anytime!', 'warning', 5000, 'offline');
      if (window.logger) window.logger.info('Offline mode indicators activated', 'SYSTEM');
    }
    // Note: Offline music section is completely disabled as requested

  } catch (error) {
    // Emergency fallback - ensure app is always visible
    try {
      const fallback = document.getElementById('offline-fallback');
      const app = document.getElementById('app');
      if (fallback) fallback.style.display = 'none';
      if (app) app.style.display = 'block';
    } catch (emergencyError) {
      console.error('Critical emergency fallback failed:', emergencyError);
    }

    if (window.logger) window.logger.error(`Error in handleOfflineMode: ${error.message}`, 'SYSTEM');
  }
}

// Esperar a que los scripts críticos estén disponibles
function waitForAllScripts() {
  return new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = 500; // 5 seconds max wait

    const checkScripts = () => {
      attempts++;
      if (window.logger && typeof window.logger.debug === 'function') {
        window.logger.debug(`Checking scripts (attempt ${attempts})`, 'SYSTEM');
      } else {
        console.log(`Checking scripts (attempt ${attempts})`);
      }

      // Esperar específicamente a que ui.js se haya cargado completamente
      if (window.uiScriptLoaded === true &&
          typeof state !== 'undefined' &&
          typeof elements !== 'undefined' &&
          typeof showStatus !== 'undefined') {
        if (window.logger) {
          window.logger.info('Critical scripts loaded, proceeding...', 'SYSTEM');
        } else {
          console.log('Critical scripts loaded, proceeding...');
        }
        resolve();
      } else if (attempts >= maxAttempts) {
        console.error('CRITICAL: Timeout waiting for scripts. App may not function correctly.', {
          uiScriptLoaded: window.uiScriptLoaded,
          stateAvailable: typeof state !== 'undefined',
          elementsAvailable: typeof elements !== 'undefined',
          showStatusAvailable: typeof showStatus !== 'undefined'
        });
        
        // Show error UI if we can
        try {
          const app = document.getElementById('app');
          if (app) {
            app.innerHTML = `
              <div style="font-family:system-ui;padding:24px;text-align:center;margin-top:48px">
                <h2>⚠️ App Loading Error</h2>
                <p>Some resources failed to load. Please check your connection and reload.</p>
                <button onclick="location.reload()" style="margin-top:16px;padding:12px 24px;font-size:16px;cursor:pointer;background:#007bff;color:white;border:none;border-radius:4px">
                  Reload App
                </button>
              </div>
            `;
            app.style.display = 'block';
          }
        } catch (err) {
          console.error('Failed to show error UI:', err);
        }
        
        resolve(); // Continue anyway after timeout
      } else {
        setTimeout(checkScripts, 10);
      }
    };
    checkScripts();
  });
}


// Inicialización segura que espera a todos los scripts
// Register Service Worker for offline functionality
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then((registration) => {
        window.logger.info('Service Worker registered successfully', 'SYSTEM');
      })
      .catch((error) => {
        window.logger.warn(`Service Worker registration failed: ${error.message}`, 'SYSTEM');
      });
  } else {
    window.logger.warn('Service Worker not supported in this browser', 'SYSTEM');
  }
}

async function safeInitialize() {
  try {
    window.logger.info('Waiting for all scripts to be available...', 'SYSTEM');
    await waitForAllScripts();
    window.logger.info('All scripts loaded, initializing application...', 'SYSTEM');
    
    // Register Service Worker immediately for offline support
    registerServiceWorker();

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
