// Application initialization

const INIT_TIMING = {
  SHARED_LINK_PLAY_DELAY_MS: 1000,
  LOAD_FAVORITES_RETRY_DELAY_MS: 100,
  FAVORITES_QUEUE_PREP_DELAY_MS: 500,
  FAVORITES_PRELOAD_DELAY_MS: 1000,
  OFFLINE_MODE_DELAY_MS: 100,
  SCRIPT_WAIT_MAX_ATTEMPTS: 500,
  SCRIPT_WAIT_INTERVAL_MS: 10
};

// Feature flags bootstrap (progressive enhancement)
function initFeatureFlags() {
  try {
    const url = new URL(window.location.href);
    const tlv2Param = url.searchParams.get('tlv2');
    const stored = localStorage.getItem('resonate_feature_tracklist_v2');

    const enabled = tlv2Param === '1' || stored === 'true';
    window.features = window.features || {};
    window.features.tracklistV2 = Boolean(enabled);
  } catch (e) {
    window.features = window.features || {};
    window.features.tracklistV2 = false;
  }
}
// Initialize flags early
initFeatureFlags();

// Mobile viewport height helper (avoids 100vh issues on iOS/Android)
function setAppViewportHeightVar() {
  try {
    const heightPx = Math.max(0, Math.round((window.visualViewport && window.visualViewport.height) || window.innerHeight || 0));
    if (!heightPx) return;
    document.documentElement.style.setProperty('--app-height', `${heightPx}px`);
  } catch {
    // ignore
  }
}

// Set early and keep updated on viewport changes
setAppViewportHeightVar();
try {
  let scheduled = false;
  const scheduleUpdate = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      setAppViewportHeightVar();
    });
  };

  window.addEventListener('resize', scheduleUpdate, { passive: true });
  window.addEventListener('orientationchange', scheduleUpdate, { passive: true });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleUpdate, { passive: true });
    window.visualViewport.addEventListener('scroll', scheduleUpdate, { passive: true });
  }
} catch {
  // ignore
}

function logInitDebug(message, data) {
  try {
    if (window.logger && typeof window.logger.debug === 'function') {
      window.logger.debug(message, 'SYSTEM');
      if (data) window.logger.debug(JSON.stringify(data), 'SYSTEM');
      return;
    }
  } catch {}

  try {
    if (data !== undefined) {
      console.debug(message, data);
    } else {
      console.debug(message);
    }
  } catch {}
}

function logInitInfo(message) {
  try {
    window.logger?.info(message, 'SYSTEM');
  } catch {
    try { console.log(message); } catch {}
  }
}

function logInitWarn(message, error) {
  try {
    const msg = error ? `${message}: ${error.message || String(error)}` : message;
    window.logger?.warn(msg, 'SYSTEM');
  } catch {
    try { console.warn(message, error); } catch {}
  }
}

function logInitError(message, error) {
  try {
    const msg = error ? `${message}: ${error.message || String(error)}` : message;
    window.logger?.error(msg, 'SYSTEM');
  } catch {
    try { console.error(message, error); } catch {}
  }
}

function safeShowStatus(message, type = 'info', duration = null, priority = 'normal') {
  try {
    if (typeof showStatus === 'function') {
      showStatus(message, type, duration, priority);
    }
  } catch {
    // ignore
  }
}

function schedule(fn, delayMs) {
  return setTimeout(() => {
    try { fn(); } catch (e) { logInitWarn('Scheduled task failed', e); }
  }, delayMs);
}

function requestClearLegacySwAudioCacheOnce() {
  try {
    const swAudioCacheCleared = localStorage.getItem('resonate_sw_audio_cache_cleared');
    if (swAudioCacheCleared) return;

    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_AUDIO_CACHE' });
      window.logger?.info('Requested SW to clear old audio cache', 'INIT');
      localStorage.setItem('resonate_sw_audio_cache_cleared', 'true');
    }
  } catch (error) {
    window.logger?.warn(`Failed to clear SW cache: ${error.message}`, 'INIT');
  }
}

async function initAudioCacheIfAvailable() {
  try {
    if (typeof audioCache !== 'undefined' && audioCache && typeof audioCache.init === 'function') {
      await audioCache.init();
      window.logger?.info('Audio cache initialized successfully', 'CACHE');
      return true;
    }

    window.logger?.warn('audioCache not available, continuing without cache', 'CACHE');
    return false;
  } catch (error) {
    window.logger?.error(`Error initializing cache: ${error.message}`, 'CACHE');
    return false;
  }
}

function tryLoadFavoritesWithRetry() {
  if (typeof window.loadFavorites === 'function') {
    window.loadFavorites();
    return;
  }

  schedule(() => {
    if (typeof window.loadFavorites === 'function') {
      window.loadFavorites();
    } else {
      window.logger?.error('loadFavorites function not available', 'INIT');
    }
  }, INIT_TIMING.LOAD_FAVORITES_RETRY_DELAY_MS);
}

function scheduleFavoritesPreloadOnce() {
  if (!window.state || !window.state.favoritesPreloadEnabled) return;
  if (typeof audioCache === 'undefined' || !audioCache || typeof audioCache.preloadFavorites !== 'function') return;

  schedule(async () => {
    try {
      await audioCache.preloadFavorites(window.state.favorites);
      window.logger?.info('Favorites preload attempted once at startup', 'CACHE');
    } catch (error) {
      window.logger?.warn(`Failed to preload favorites: ${error.message}`, 'CACHE');
    }
  }, INIT_TIMING.FAVORITES_PRELOAD_DELAY_MS);
}

function scheduleFavoritesQueuePreparation() {
  if (!window.state || !window.state.favorites || window.state.favorites.length === 0) return;

  schedule(async () => {
    try {
      await loadPlaybackQueue('favorites', window.state.favorites, 0);
      if (window.state.playbackQueue.length > 0) {
        safeShowStatus('Tap play to start your favorites', 'info', 3000);
      }
    } catch (error) {
      window.logger?.error(`Error preparing favorites queue: ${error.message}`, 'PLAYBACK');
    }
  }, INIT_TIMING.FAVORITES_QUEUE_PREP_DELAY_MS);
}

// Function to update meta tags for shared link previews
async function updateMetaTagsForSharedLink(identifier, trackIndex = null) {
  try {
    // Fetch basic metadata from archive.org
    const response = await fetch(`https://archive.org/metadata/${identifier}`);
    if (!response.ok) {
      throw new Error('Failed to fetch metadata');
    }

    const metadata = await response.json();
    const albumTitle = metadata.metadata?.title || 'Shared content';
    const albumCreator = metadata.metadata?.creator || 'Resonate Player';

    let resolvedTitle = albumTitle;
    let resolvedCreator = albumCreator;

    // If a track index is provided, try to resolve the specific track title/creator.
    // Best-effort only: meta tags should still work even if this fails.
    const idx = typeof trackIndex === 'number' && isFinite(trackIndex) && trackIndex >= 0 ? Math.floor(trackIndex) : null;
    if (idx !== null) {
      try {
        const files = await fetchOptimizedPlayableFiles(identifier);
        if (Array.isArray(files) && files.length > 1 && idx < files.length) {
          const track = files[idx];
          const tTitle = track && track.title ? track.title : `Track ${idx + 1}`;
          const tCreator = track && track.creator ? track.creator : albumCreator;
          const tAlbum = (track && (track.albumTitle || track.album)) ? (track.albumTitle || track.album) : albumTitle;

          // Match in-app now-playing convention for album tracks.
          resolvedTitle = `${tAlbum} — ${tTitle}`;
          resolvedCreator = tCreator;
        }
      } catch (e) {
        // ignore
      }
    }

    // Update meta tags for social media sharing
    const shareUrl = (() => {
      try {
        if (typeof window.buildShareUrl === 'function') {
          return window.buildShareUrl(identifier, trackIndex);
        }
      } catch {}

      // Fallback: stay within current origin and root scope.
      const baseUrl = new URL(window.location.origin);
      baseUrl.hash = '';
      baseUrl.search = '';
      baseUrl.pathname = '/';

      const params = new URLSearchParams();
      params.set('play', identifier);
      const idx = typeof trackIndex === 'number' && isFinite(trackIndex) && trackIndex >= 0 ? Math.floor(trackIndex) : null;
      if (idx !== null) params.set('t', String(idx));
      baseUrl.search = params.toString();
      return baseUrl.toString();
    })();
    const imageUrl = `https://archive.org/services/img/${identifier}`;

    // Update page title
    document.title = `${resolvedTitle} - ${resolvedCreator} | Resonate Player`;

    // Update Open Graph tags
    updateMetaTag('property', 'og:title', `${resolvedTitle} - ${resolvedCreator}`);
    updateMetaTag('property', 'og:description', `Listen to "${resolvedTitle}" by ${resolvedCreator} on Resonate Player. Free music from archive.org.`);
    updateMetaTag('property', 'og:image', imageUrl);
    updateMetaTag('property', 'og:url', shareUrl);
    updateMetaTag('property', 'og:type', 'music.song');

    // Update Twitter Card tags
    updateMetaTag('property', 'twitter:card', 'summary_large_image');
    updateMetaTag('property', 'twitter:title', `${resolvedTitle} - ${resolvedCreator}`);
    updateMetaTag('property', 'twitter:description', `Listen to "${resolvedTitle}" by ${resolvedCreator} on Resonate Player. Free music from archive.org.`);
    updateMetaTag('property', 'twitter:image', imageUrl);
    updateMetaTag('property', 'twitter:url', shareUrl);

    // Update basic meta description
    updateMetaTag('name', 'description', `Listen to "${resolvedTitle}" by ${resolvedCreator} on Resonate Player. Free music from archive.org.`);

    console.log('Meta tags updated for shared link:', { title: resolvedTitle, creator: resolvedCreator, imageUrl, shareUrl, trackIndex: idx });

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
    const src = urlParams.get('src');
    const isApexEntry = src === 'apex';
    const trackIndexParam = urlParams.get('t');
    const parsedTrackIndex = trackIndexParam !== null ? parseInt(trackIndexParam, 10) : null;
    const trackIndex = Number.isFinite(parsedTrackIndex) && parsedTrackIndex >= 0 ? parsedTrackIndex : null;

    // If the user arrived via the apex domain redirect, show the same banner UX as shared links.
    if (isApexEntry && !playIdentifier) {
      try { sessionStorage.setItem('resonate_shared_link_banner_active', 'true'); } catch {}
      try {
        if (typeof window.maybeShowOpenInAppBannerForSharedLink === 'function') {
          window.maybeShowOpenInAppBannerForSharedLink();
        }
      } catch {}

      // Clean the marker param from the address bar (best-effort) once the banner is shown.
      try {
        const cleaned = new URL(window.location.href);
        cleaned.searchParams.delete('src');
        window.history.replaceState({}, '', cleaned);
      } catch {}
    }

    if (playIdentifier) {
      // Mark this navigation as a shared-link session (used to suppress generic install banners).
      try { sessionStorage.setItem('resonate_shared_link_banner_active', 'true'); } catch {}

      console.log('Shared link detected, playing:', playIdentifier);
      // If opened in browser, guide the user to open/install the PWA.
      try {
        if (typeof window.maybeShowOpenInAppBannerForSharedLink === 'function') {
          window.maybeShowOpenInAppBannerForSharedLink();
        }
      } catch {}
      safeShowStatus('Preparing to load your shared track', 'info');

      const cleanedUrl = new URL(window.location.href);
      cleanedUrl.searchParams.delete('play');
      cleanedUrl.searchParams.delete('t');
      // Preserve other params (e.g., src markers) unless we explicitly delete them.

      // Update meta tags for social media previews immediately
      try {
        await updateMetaTagsForSharedLink(playIdentifier, trackIndex);
      } catch (error) {
        console.warn('Error updating meta tags for shared link:', error);
      }

      // Wait a bit for the app to be fully initialized
      setTimeout(async () => {
        let sharedPlaybackStarted = false;
        try {
          await playSharedContent(playIdentifier, trackIndex);
          sharedPlaybackStarted = true;
        } catch (error) {
          console.error('Error playing shared content:', error);
          safeShowStatus('Failed to load the shared track', 'error');
        } finally {
          // Only clear the shared-link params once playback started successfully.
          if (sharedPlaybackStarted) {
            try {
              window.history.replaceState({}, '', cleanedUrl);
            } catch {}
          }
        }
      }, INIT_TIMING.SHARED_LINK_PLAY_DELAY_MS);
    }
  } catch (error) {
    console.error('Error handling shared link:', error);
  }
}

function tryHandleSharedLinkFromUrlString(targetUrlString) {
  try {
    if (!targetUrlString) return false;
    const url = new URL(String(targetUrlString), window.location.origin);

    const playIdentifier = url.searchParams.get('play');
    const trackIndexParam = url.searchParams.get('t');
    const parsedTrackIndex = trackIndexParam !== null ? parseInt(trackIndexParam, 10) : null;
    const trackIndex = Number.isFinite(parsedTrackIndex) && parsedTrackIndex >= 0 ? parsedTrackIndex : null;
    if (!playIdentifier) return false;

    // Keep the address bar in sync inside the app (best-effort).
    try {
      window.history.pushState({}, '', url);
    } catch {}

    safeShowStatus('Opening your shared track…', 'info', 2500);

    // Defer slightly so the rest of the app is ready.
    setTimeout(async () => {
      try {
        await playSharedContent(playIdentifier, trackIndex);
      } catch (err) {
        console.error('Error playing shared content (launchQueue):', err);
        safeShowStatus('Could not open the shared track', 'error', 4500);
      }
    }, 250);

    return true;
  } catch {
    return false;
  }
}

function setupLaunchQueueHandling() {
  try {
    if (!('launchQueue' in window)) return;
    if (window._resonateLaunchQueueInit) return;
    window._resonateLaunchQueueInit = true;

    window.launchQueue.setConsumer((launchParams) => {
      try {
        const targetURL = launchParams && launchParams.targetURL ? String(launchParams.targetURL) : '';
        // If we can handle it without a full navigation, do so.
        const handled = tryHandleSharedLinkFromUrlString(targetURL);
        if (handled) return;

        // Otherwise, fall back to navigation.
        if (targetURL) {
          try { window.location.href = targetURL; } catch {}
        }
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }
}

// Function to play content from shared link
async function playSharedContent(identifier, startTrackIndex = null) {
  try {
    // Fetch the playable files for this identifier
    const files = await fetchOptimizedPlayableFiles(identifier);

    if (!files || files.length === 0) {
      throw new Error('No playable tracks found');
    }

    // Determine if this is an album (multiple tracks) or single track
    const isAlbum = files.length > 1;

    const startIndex = (() => {
      if (!(typeof startTrackIndex === 'number' && Number.isFinite(startTrackIndex))) return 0;
      const idx = Math.floor(startTrackIndex);
      if (idx < 0) return 0;
      if (idx >= files.length) return 0;
      return idx;
    })();

    if (isAlbum) {
      // Handle album sharing - load all tracks into playlist
      console.log(`Shared album detected: ${files.length} tracks`);

      // Create album metadata
      const albumData = {
        id: identifier,
        title: files[0].album || identifier || 'Shared album',
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

      // Ensure album context is set so auto-advance stays within this album.
      try {
        if (window.playbackManager && typeof window.playbackManager.setAlbumPlaylist === 'function') {
          window.playbackManager.setAlbumPlaylist(identifier, tracksWithMetadata, startIndex);
        }
      } catch {}

      // Keep FIFO queue aligned as a fallback (start *after* the current track).
      try {
        const queueStart = tracksWithMetadata.length > 1 ? (startIndex + 1) % tracksWithMetadata.length : 0;
        await loadPlaybackQueue('album', tracksWithMetadata, queueStart);
      } catch {}

      safeShowStatus('Your shared album is ready to play', 'info', 3000);

      // Start playing the selected track
      if (tracksWithMetadata.length > 0) {
        const prevSharedAutoplay = window.state && Object.prototype.hasOwnProperty.call(window.state, 'sharedLinkAutoplay')
          ? window.state.sharedLinkAutoplay
          : undefined;
        try {
          window.state = window.state || {};
          window.state.sharedLinkAutoplay = true;
          await playAudioTrackOptimized(tracksWithMetadata[startIndex], identifier, startIndex, tracksWithMetadata.length);
        } finally {
          try {
            if (prevSharedAutoplay === undefined) {
              delete window.state.sharedLinkAutoplay;
            } else {
              window.state.sharedLinkAutoplay = prevSharedAutoplay;
            }
          } catch {}
        }
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
      const prevSharedAutoplay = window.state && Object.prototype.hasOwnProperty.call(window.state, 'sharedLinkAutoplay')
        ? window.state.sharedLinkAutoplay
        : undefined;
      try {
        window.state = window.state || {};
        window.state.sharedLinkAutoplay = true;
        await playAudioTrackOptimized(track, identifier);
      } finally {
        try {
          if (prevSharedAutoplay === undefined) {
            delete window.state.sharedLinkAutoplay;
          } else {
            window.state.sharedLinkAutoplay = prevSharedAutoplay;
          }
        } catch {}
      }
    }

  } catch (error) {
    console.error('Error in playSharedContent:', error);
    throw error;
  }
}

async function initializeApp() {
  logInitInfo('Starting app initialization...');

  // If the platform routes launches into an existing PWA instance, consume them.
  setupLaunchQueueHandling();

  // One-time: Clear old SW audio cache from previous versions (avoid duplicate audio storage)
  requestClearLegacySwAudioCacheOnce();

  // Inicializar caché de audio primero
  logInitDebug('Initializing audio cache...');
  await initAudioCacheIfAvailable();

  // Load favorites if available, otherwise retry
  tryLoadFavoritesWithRetry();
  // Preparar el CTA (se mostrará si hay favoritos precargados)
  //createStartFavoritesCTA();
  // setupLoadingSafety() is called only when actual loading operations are in progress

  // Pre-cargar favoritos para reproducción offline (single guarded run)
  scheduleFavoritesPreloadOnce();

  // Inicializar el componente FavoritesToggle
  if (typeof window.ensureFavoritesToggleInitialized === 'function') {
    window.ensureFavoritesToggleInitialized();
    window.logger.info('FavoritesToggle component initialized', 'UI');
  } else if (typeof FavoritesToggle !== 'undefined') {
    favoritesToggleInstance = new FavoritesToggle();
    window.logger.info('FavoritesToggle component initialized (fallback)', 'UI');
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

  // Restore queue/context (best-effort) so Next/Prev keeps continuity after reload.
  try {
    const url = new URL(window.location.href);
    const hasSharedPlay = !!url.searchParams.get('play');
    if (!hasSharedPlay && window.state && window.state.savedPlaybackQueueSnapshot && typeof window.restorePlaybackQueueFromSnapshot === 'function') {
      await window.restorePlaybackQueueFromSnapshot(window.state.savedPlaybackQueueSnapshot);
    }
  } catch {}

  // If this load is the result of applying a SW update, try to resume playback automatically.
  try {
    const isUpdateReload = sessionStorage.getItem('resonate_update_reload') === '1';
    if (isUpdateReload) {
      sessionStorage.removeItem('resonate_update_reload');
      const shouldAutoResume = !!(window.state && window.state.savedPlaybackState && window.state.savedPlaybackState.wasPlaying);
      if (shouldAutoResume) {
        setTimeout(() => {
          try {
            // togglePlay() will resumeSavedPlayback() if a snapshot exists.
            togglePlay();
          } catch {}
        }, 250);
      }
    }
  } catch {}

  // Apply volume/mute preferences (independent from playback snapshot TTL)
  try {
    if (typeof window.loadVolume === 'function') {
      window.loadVolume();
    }
  } catch {}

  // Handle shared links (play parameter)
  await handleSharedLink();

  // Setup functions - verificar existencia antes de llamar
  if (typeof setupConnectivityMonitoring === 'function') {
    setupConnectivityMonitoring();
  }

  if (typeof setupPageVisibilityHandling === 'function') {
    setupPageVisibilityHandling();
  }

  // Periodic autosave while playing (best-effort)
  if (typeof setupPlaybackAutosave === 'function') {
    setupPlaybackAutosave();
  }

  if (typeof setupListenTracking === 'function') {
    setupListenTracking();
  }

  // Prepare favorites queue (no autoplay)
  scheduleFavoritesQueuePreparation();

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
      if (!window.state || window.state.favorites.length === 0) {
        showStatus('Add some favorites first to play', 'info');
        return;
      }

      window.state.userInteracted = true;
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
      // Keep icon consistent with playback.js
      elements.playBtn.textContent = '⏸';
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

      // If playback.js has installed the enhanced auto-skip handler, avoid noisy/duplicated UX.
      if (!window._resonatePlaybackAutoSkipEnabled) {
        showStatus('Sorry, there was a playback issue', 'error');
        // Restore state on error (legacy fallback)
        if (window.state) window.state.isLoading = false;
        elements.playBtn.disabled = false;
        elements.playBtn.textContent = '▶';
      }
    });
  }

  if (elements.shuffleFavoritesBtn) {
    elements.shuffleFavoritesBtn.addEventListener('click', () => {
      window.logger.info('Shuffle toggle clicked', 'UI');
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
      if (window.state && window.state.currentTrack && !window.state.currentTrack.url && window.state.currentTrack.id) {
        try {
          const files = await fetchOptimizedPlayableFiles(window.state.currentTrack.id);
          if (files.length > 0) {
            window.state.currentTrack.url = files[0].url;
            toggleFavorite(window.state.currentTrack);
          }
        } catch (error) {
          window.logger.error(`Error fetching URL for favorite: ${error.message}`, 'UI');
          showStatus('Couldn\'t add that to favorites', 'error');
        }
      } else if (window.state) {
        toggleFavorite(window.state.currentTrack);
      }
    });
  }

  if (elements.currentTrackShare) {
    const handleShare = async () => {
      if (state.currentTrack && state.currentTrack.id) {
        const albumTitleForShare = state.currentTrack.albumTitle || state.currentTrack.album || '';
        const trackIndexForShare = (state.currentTrack.totalTracks || 1) > 1 && typeof state.currentTrack.trackIndex === 'number'
          ? state.currentTrack.trackIndex
          : null;
        await shareTrack(state.currentTrack.id, state.currentTrack.title, state.currentTrack.creator, albumTitleForShare, 'track', trackIndexForShare);
      } else {
        showStatus('Nothing to share right now', 'warning');
      }
    };

    elements.currentTrackShare.addEventListener('click', handleShare);
    elements.currentTrackShare.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        handleShare();
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
    try {
      const target = e.target;
      const clickedInsideSearch =
        (elements.searchInput && target && elements.searchInput.contains(target)) ||
        (elements.searchResults && target && elements.searchResults.contains(target));

      // Clicking the favorites toggle/list should not trigger the global close logic.
      // Otherwise, the same click that opens favorites can bubble here and immediately close it.
      const clickedInsideFavorites =
        (elements.favoritesToggle && target && elements.favoritesToggle.contains(target)) ||
        (elements.favoritesList && target && elements.favoritesList.contains(target));

      if (!clickedInsideSearch && !clickedInsideFavorites) {
        hideSearchResults();
      }
    } catch {
      // Best-effort: if anything is missing, don't hard-crash the click handler.
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

  // Sync persisted shuffle mode (PlaybackStateManager) into UI state.
  if (window.playbackStateManager && typeof window.playbackStateManager.getShuffleMode === 'function') {
    state.shuffleFavorites = window.playbackStateManager.getShuffleMode();
  }
  updateShuffleButton();

  // Inicializar PWA
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
      // Close overlays on back, but don't trap the user in the app.
      if (searchVisible) {
        // Abort ongoing search operations before closing
        if (typeof window.abortAllSearchOperations === 'function') {
          window.abortAllSearchOperations();
        }
        window.hideSearchResults();
      }
      if (favoritesVisible) window.hideFavoritesList();
      // Keep the user on the current page after closing overlays.
      window.history.pushState(null, '', window.location.href);
      return;
    }
    // Otherwise allow normal back/exit (lighter behavior for PWA)
  });

  // One state entry so back can close overlays; we no longer hard-block exit.
  window.history.pushState(null, '', window.location.href);

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
  window.toggleShuffleFavorites = toggleShuffleFavorites;
  window.addAlbumToFavorites = addAlbumToFavorites;
  window.removeAlbumFromFavorites = removeAlbumFromFavorites;
  window.isAlbumInFavorites = isAlbumInFavorites;
  window.audioCache = typeof audioCache !== 'undefined' ? audioCache : null;
  // Note: playOptimizedFavorite, playAlbumFromFavorites, playSpecificSearchTrack, and playRandomSearchResults are exposed in search.js
  window.installPWA = typeof window.installPWA !== 'undefined' ? window.installPWA : null;
  window.preloadNextTrack = preloadNextTrack;
  window.loadPlaybackQueue = loadPlaybackQueue;
  window.playFromFavoritesQueue = playFromFavoritesQueue;
  window.updateProgressBar = updateProgressBar;
  window.dispatchEvent(new Event('resonate:results-rendered'));

  // Debug functions for offline testing
  window.forceShowApp = () => {
    logInitDebug('Forcing app to show...');
    const fallback = document.getElementById('offline-fallback');
    const app = document.getElementById('app');
    if (fallback) fallback.style.display = 'none';
    if (app) app.style.display = 'block';
    logInitDebug('App forced to show');
  };

  window.testOfflineMode = () => {
    logInitDebug('Testing offline mode...');
    handleOfflineMode();
  };

  // Handle offline mode after everything is initialized
  schedule(handleOfflineMode, INIT_TIMING.OFFLINE_MODE_DELAY_MS);

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
      document.body.style.overflow = 'hidden';
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
    const maxAttempts = INIT_TIMING.SCRIPT_WAIT_MAX_ATTEMPTS; // ~5 seconds max wait

    const checkScripts = () => {
      attempts++;
      logInitDebug(`Checking scripts (attempt ${attempts})`);

      // Esperar específicamente a que ui.js se haya cargado completamente
      if (window.uiScriptLoaded === true &&
          typeof window.state !== 'undefined' &&
          typeof window.elements !== 'undefined' &&
          typeof window.showStatus !== 'undefined') {
        logInitInfo('Critical scripts loaded, proceeding...');
        resolve();
      } else if (attempts >= maxAttempts) {
        console.error('CRITICAL: Timeout waiting for scripts. App may not function correctly.', {
          uiScriptLoaded: window.uiScriptLoaded,
          stateAvailable: typeof window.state !== 'undefined',
          elementsAvailable: typeof window.elements !== 'undefined',
          showStatusAvailable: typeof window.showStatus !== 'undefined'
        });
        
        // Show error UI if we can
        try {
          const app = document.getElementById('app');
          if (app) {
            const isSharedLink = (() => {
              try { return new URL(window.location.href).searchParams.has('play'); } catch { return false; }
            })();
            const diagnostics = {
              uiScriptLoaded: window.uiScriptLoaded,
              stateAvailable: typeof window.state !== 'undefined',
              elementsAvailable: typeof window.elements !== 'undefined',
              showStatusAvailable: typeof window.showStatus !== 'undefined',
              online: (() => { try { return navigator.onLine; } catch { return true; } })(),
              swController: (() => { try { return Boolean(navigator.serviceWorker && navigator.serviceWorker.controller); } catch { return false; } })(),
              url: (() => { try { return String(window.location.href); } catch { return ''; } })()
            };

            app.innerHTML = `
              <div style="font-family:system-ui;padding:20px;max-width:520px;margin:0 auto;text-align:left">
                <h2 style="margin:16px 0 8px 0">Resonate couldn’t load</h2>
                <p style="margin:0 0 16px 0;line-height:1.5">
                  This usually happens when a script fails to download (network, ad-blocker, or a cached old version).
                  ${isSharedLink ? 'Your shared track link is still here — you can retry safely.' : ''}
                </p>

                <div style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0">
                  <button onclick="location.reload()" style="padding:12px 16px;font-size:16px;cursor:pointer;background:#3da9ff;color:white;border:none;border-radius:10px">
                    Retry
                  </button>
                  <button onclick="location.href='/'" style="padding:12px 16px;font-size:16px;cursor:pointer;background:#e5e5e5;color:#111;border:none;border-radius:10px">
                    Go to home
                  </button>
                </div>

                <details style="margin-top:12px">
                  <summary style="cursor:pointer">Show diagnostics</summary>
                  <pre style="white-space:pre-wrap;word-break:break-word;background:#111;color:#e5e5e5;padding:12px;border-radius:10px;overflow:auto;margin-top:10px">${JSON.stringify(diagnostics, null, 2)}</pre>
                </details>

                <p style="margin:16px 0 0 0;color:#666;line-height:1.5">
                  Tip: if this keeps happening, try disabling ad-blocker for this site, or clear the site data/cache and retry.
                </p>
              </div>
            `;
            app.style.display = 'block';
          }
        } catch (err) {
          console.error('Failed to show error UI:', err);
        }
        
        resolve(); // Continue anyway after timeout
      } else {
        setTimeout(checkScripts, INIT_TIMING.SCRIPT_WAIT_INTERVAL_MS);
      }
    };
    checkScripts();
  });
}


async function safeInitialize() {
  try {
    window.logger.info('Waiting for all scripts to be available...', 'SYSTEM');
    await waitForAllScripts();
    window.logger.info('All scripts loaded, initializing application...', 'SYSTEM');
    
    // Register Service Worker immediately for offline support (UI-owned behavior)
    if (typeof window.registerServiceWorker === 'function') {
      window.registerServiceWorker();
    }

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
