function scheduleResontesPreloadOnce() {
  if (!window.state || !window.state.resontesPreloadEnabled) return;
  if (typeof audioCache === 'undefined' || !audioCache || typeof audioCache.preloadResontes !== 'function') return;

  schedule(async () => {
    try {
      await audioCache.preloadResontes(window.state.resontes);
      window.logger?.info('Resontes preload attempted once at startup', 'CACHE');
    } catch (error) {
      window.logger?.warn(`Failed to preload resontes: ${error.message}`, 'CACHE');
    }
  }, INIT_TIMING.FAVORITES_PRELOAD_DELAY_MS);
}
function tryLoadResontesWithRetry() {
  if (typeof window.loadResontes === 'function') {
    window.loadResontes();
    return;
  }

  schedule(() => {
    if (typeof window.loadResontes === 'function') {
      window.loadResontes();
    } else {
      window.logger?.error('loadResontes function not available', 'INIT');
    }
  }, INIT_TIMING.LOAD_FAVORITES_RETRY_DELAY_MS);
}
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

function setFooterHeightVar() {
  try {
    const footer = document.querySelector('.footer');
    if (!footer) return;
    const rect = footer.getBoundingClientRect();
    const heightPx = Math.max(0, Math.round((rect && rect.height) || footer.offsetHeight || 0));
    if (!heightPx) return;
    document.documentElement.style.setProperty('--footer-height', `${heightPx}px`);
  } catch {
    // ignore
  }
}

function setHeaderHeightVar() {
  try {
    const header = document.querySelector('header');
    if (!header) return;
    const rect = header.getBoundingClientRect();
    const heightPx = Math.max(0, Math.round((rect && rect.height) || header.offsetHeight || 0));
    if (!heightPx) return;
    document.documentElement.style.setProperty('--header-height', `${heightPx}px`);
  } catch {
    // ignore
  }
}

function setVisualViewportInsetsVars() {
  try {
    const vv = window.visualViewport;
    if (!vv) {
      document.documentElement.style.setProperty('--vv-bottom-inset', `0px`);
      return;
    }

    const vvHeight = Number.isFinite(vv.height) ? vv.height : 0;
    const vvTop = Number.isFinite(vv.offsetTop) ? vv.offsetTop : 0;
    const layoutH = Number.isFinite(window.innerHeight) ? window.innerHeight : 0;

    // Bottom occlusion area (e.g., browser UI / system bars) not reflected in CSS safe-area insets.
    const bottomInset = Math.max(0, Math.round(layoutH - (vvHeight + vvTop)));
    document.documentElement.style.setProperty('--vv-bottom-inset', `${bottomInset}px`);
  } catch {
    // ignore
  }
}

function getViewportUpdateMetrics() {
  try {
    const vv = window.visualViewport;
    const layoutHeight = Number.isFinite(window.innerHeight) ? window.innerHeight : 0;
    const vvHeight = vv && Number.isFinite(vv.height) ? vv.height : 0;
    const vvTop = vv && Number.isFinite(vv.offsetTop) ? vv.offsetTop : 0;
    const appHeight = Math.max(0, Math.round(vvHeight || layoutHeight || 0));
    const bottomInset = vv ? Math.max(0, Math.round(layoutHeight - (vvHeight + vvTop))) : 0;
    const footerHeight = (() => {
      try {
        const footer = document.querySelector('.footer');
        if (!footer) return 0;
        const rect = footer.getBoundingClientRect();
        return Math.max(0, Math.round((rect && rect.height) || footer.offsetHeight || 0));
      } catch {
        return 0;
      }
    })();

    return {
      vv: vv || null,
      layoutHeight: Math.max(0, Math.round(layoutHeight || 0)),
      vpTop: Math.max(0, Math.round(vvTop || 0)),
      vpHeight: appHeight,
      appHeight,
      bottomInset,
      footerHeight
    };
  } catch {
    return {
      vv: null,
      layoutHeight: Math.max(0, Math.round(window.innerHeight || 0)),
      vpTop: 0,
      vpHeight: Math.max(0, Math.round(window.innerHeight || 0)),
      appHeight: Math.max(0, Math.round(window.innerHeight || 0)),
      bottomInset: 0,
      footerHeight: 0
    };
  }
}

// A tiny dispatcher so other modules can react to viewport/keyboard changes in-sync.
if (!window._resonateViewportUpdateBus) {
  window._resonateViewportUpdateBus = {
    subscribers: new Set()
  };
}

window.subscribeViewportUpdates = function subscribeViewportUpdates(cb) {
  try {
    if (typeof cb !== 'function') return () => {};
    window._resonateViewportUpdateBus.subscribers.add(cb);
    // Best-effort immediate sync.
    try { cb(getViewportUpdateMetrics()); } catch {}
    return () => {
      try { window._resonateViewportUpdateBus.subscribers.delete(cb); } catch {}
    };
  } catch {
    return () => {};
  }
};

// Set early and keep updated on viewport changes
setAppViewportHeightVar();
setHeaderHeightVar();
setFooterHeightVar();
setVisualViewportInsetsVars();
try {
  let scheduled = false;
  const scheduleUpdate = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      setAppViewportHeightVar();
      setHeaderHeightVar();
      setFooterHeightVar();
      setVisualViewportInsetsVars();

      // Keep overlays above the keyboard in the same frame as viewport vars.
      try {
        if (typeof window.setSearchPanelInsets === 'function') {
          window.setSearchPanelInsets();
        }
        if (typeof window.setFavoritesPanelInsets === 'function') {
          window.setFavoritesPanelInsets();
        }
      } catch {
        // ignore
      }

      // Notify subscribers.
      try {
        const metrics = getViewportUpdateMetrics();
        const subs = window._resonateViewportUpdateBus && window._resonateViewportUpdateBus.subscribers;
        if (subs && subs.size) {
          subs.forEach((fn) => {
            try { fn(metrics); } catch {}
          });
        }
      } catch {
        // ignore
      }
    });
  };

  // Allow other modules to trigger an in-sync viewport update.
  window.requestViewportUpdate = scheduleUpdate;

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

    const trySend = () => {
      if (localStorage.getItem('resonate_sw_audio_cache_cleared')) return true;
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_AUDIO_CACHE' });
        window.logger?.info('Requested SW to clear old audio cache', 'INIT');
        localStorage.setItem('resonate_sw_audio_cache_cleared', 'true');
        return true;
      }
      return false;
    };

    if (trySend()) return;

    if (navigator.serviceWorker) {
      try {
        navigator.serviceWorker.ready
          .then(() => {
            trySend();
          })
          .catch(() => {});
      } catch {}

      try {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          trySend();
        }, { once: true });
      } catch {}
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
  // Prefer new resontes API, fallback to legacy favorites.
  if (typeof window.loadResontes === 'function') {
    window.loadResontes();
    return;
  }

  if (typeof window.loadFavorites === 'function') {
    window.loadFavorites();
    return;
  }

  schedule(() => {
    if (typeof window.loadResontes === 'function') {
      window.loadResontes();
    } else if (typeof window.loadFavorites === 'function') {
      window.loadFavorites();
    } else {
      window.logger?.error('loadResontes/loadFavorites function not available', 'INIT');
    }
  }, INIT_TIMING.LOAD_FAVORITES_RETRY_DELAY_MS);
}

function scheduleFavoritesPreloadOnce() {
  if (!window.state) return;
  const enabled = (typeof window.state.resontesPreloadEnabled === 'boolean')
    ? window.state.resontesPreloadEnabled
    : !!window.state.favoritesPreloadEnabled;
  if (!enabled) return;
  if (typeof audioCache === 'undefined' || !audioCache || typeof audioCache.preloadFavorites !== 'function') return;

  schedule(async () => {
    try {
      await audioCache.preloadFavorites(window.state.resontes || window.state.favorites);
      window.logger?.info('Resontes preload attempted once at startup', 'CACHE');
    } catch (error) {
      window.logger?.warn(`Failed to preload resontes: ${error.message}`, 'CACHE');
    }
  }, INIT_TIMING.FAVORITES_PRELOAD_DELAY_MS);
}

function scheduleFavoritesQueuePreparation() {
  if (!window.state) return;
  const resontes = window.state.resontes || window.state.favorites;
  if (!Array.isArray(resontes) || resontes.length === 0) return;

  schedule(async () => {
    try {
      // If we have a saved snapshot for favorites, continue after the last played index.
      let startIndex = 0;
      try {
        const snap = window.state && window.state.savedPlaybackQueueSnapshot ? window.state.savedPlaybackQueueSnapshot : null;
        if (snap && snap.context === 'favorites' && Number.isFinite(Number(snap.currentIndex))) {
          const idx = Math.max(0, Math.floor(Number(snap.currentIndex)));
          startIndex = (idx + 1) % resontes.length;
          // Best-effort: restore the playbackManager context too.
          try {
            if (typeof playbackManager !== 'undefined' && playbackManager && typeof playbackManager.setContext === 'function') {
              playbackManager.setContext('favorites', resontes, idx);
            }
          } catch {}
        }
      } catch {}

      await loadPlaybackQueue('favorites', resontes, startIndex);
      if (window.state.playbackQueue.length > 0) {
        safeShowStatus('Tap Play to start your resonates', 'info', 3000);
      }
    } catch (error) {
      window.logger?.error(`Error preparing resontes queue: ${error.message}`, 'PLAYBACK');
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
      if (window.state && window.state.userInteracted) {
        window.history.pushState({}, '', url);
      } else {
        window.history.replaceState({}, '', url);
      }
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

  // Load resontes if available, otherwise retry
  tryLoadResontesWithRetry();
  // Preparar el CTA (se mostrará si hay resontes precargados)
  //createStartResontesCTA();
  // setupLoadingSafety() is called only when actual loading operations are in progress

  // Pre-cargar resontes para reproducción offline (single guarded run)
  scheduleResontesPreloadOnce();

  // Inicializar el componente ResontesToggle
  if (typeof window.ensureResontesToggleInitialized === 'function') {
    window.ensureResontesToggleInitialized();
    window.logger.info('ResontesToggle component initialized', 'UI');
  } else if (window && typeof window.ResontesToggle === 'function') {
    try {
      resontesToggleInstance = new window.ResontesToggle();
      window.logger.info('ResontesToggle component initialized (fallback)', 'UI');
    } catch (e) {
      window.logger.warn('ResontesToggle fallback init failed', 'UI');
    }
  } else if (typeof window.ensureFavoritesToggleInitialized === 'function') {
    // Back-compat (older builds): favorites toggle initializer.
    window.ensureFavoritesToggleInitialized();
    window.logger.info('FavoritesToggle component initialized (fallback)', 'UI');
  } else {
    window.logger.warn('Resonates toggle class not available', 'UI');
  }

  // Inicializar el listener de event delegation para botones play en resontes
  {
    const initPlayListener = (typeof window.initializeResontesPlayListener === 'function')
      ? window.initializeResontesPlayListener
      : ((typeof window.initializeFavoritesPlayListener === 'function')
        ? window.initializeFavoritesPlayListener
        : null);

    if (initPlayListener) {
      try {
        initPlayListener();
        window.logger.info('Resonates play listener initialized', 'UI');
      } catch (e) {
        window.logger.warn('Resonates play listener init failed', 'UI');
      }
    } else {
      window.logger.warn('Resonates play listener not available', 'UI');
    }
  }

  // Cargar estado de reproducción guardado (última sesión)
  loadSavedPlaybackState();

  // If favorites load after this (common on refresh), retry restoring the playback context then.
  try {
    if (!window.__resonateRestoreAfterFavoritesHandlerInstalled) {
      window.__resonateRestoreAfterFavoritesHandlerInstalled = true;
      window.addEventListener('resonate:resontes-loaded', async () => {
        try {
          const url = new URL(window.location.href);
          const hasSharedPlay = !!url.searchParams.get('play');
          if (hasSharedPlay) return;

          const snap = window.state && window.state.savedPlaybackQueueSnapshot ? window.state.savedPlaybackQueueSnapshot : null;
          if (!snap || !snap.context) return;
          if (String(snap.context) !== 'resontes') return;

          if (typeof window.restorePlaybackQueueFromSnapshot !== 'function') return;

          const restored = await window.restorePlaybackQueueFromSnapshot(snap);
          if (!restored) return;

          // Best-effort: rebuild FIFO queue to continue after the restored index.
          try {
            const resontes = window.state && Array.isArray(window.state.resontes) ? window.state.resontes : [];
            const idx = Number.isFinite(Number(snap.currentIndex)) ? Math.max(0, Math.floor(Number(snap.currentIndex))) : 0;
            const startIndex = resontes.length ? ((idx + 1) % resontes.length) : 0;
            if (resontes.length && typeof loadPlaybackQueue === 'function') {
              loadPlaybackQueue('resontes', resontes, startIndex);
            }
          } catch {}
        } catch {
          // ignore
        }
      });
    }
  } catch {}

  // Restore queue/context (best-effort) so Next/Prev keeps continuity after reload.
  try {
    const url = new URL(window.location.href);
    const hasSharedPlay = !!url.searchParams.get('play');
    if (!hasSharedPlay && window.state && window.state.savedPlaybackQueueSnapshot && typeof window.restorePlaybackQueueFromSnapshot === 'function') {
      const restored = await window.restorePlaybackQueueFromSnapshot(window.state.savedPlaybackQueueSnapshot);

      // If we restored a resontes context, rebuild FIFO queue so continuous playback doesn't stall.
      try {
        const snap = window.state.savedPlaybackQueueSnapshot;
        if (restored && snap && snap.context === 'resontes' && Array.isArray(window.state.resontes) && window.state.resontes.length) {
          const idx = Number.isFinite(Number(snap.currentIndex)) ? Math.max(0, Math.floor(Number(snap.currentIndex))) : 0;
          const startIndex = (idx + 1) % window.state.resontes.length;
          if (typeof loadPlaybackQueue === 'function') {
            loadPlaybackQueue('resontes', window.state.resontes, startIndex);
          }
        }
      } catch {}
    }
  } catch {}

  // If this load is the result of applying a SW update, try to resume playback automatically.
  try {
    const isUpdateReload = sessionStorage.getItem('resonate_update_reload') === '1';
    if (isUpdateReload) {
      sessionStorage.removeItem('resonate_update_reload');
      safeShowStatus('Updated to the latest version', 'info', 2500);
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

  if (typeof setupBufferingMonitoring === 'function') {
    setupBufferingMonitoring();
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
        showStatus('Add some resonates first to play', 'info');
        return;
      }

      window.state.userInteracted = true;
      showStatus('Starting your resonates', 'info');
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
    elements.audio.addEventListener('progress', updateBufferedProgress);
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

  if (elements.shuffleResontesBtn) {
    elements.shuffleResontesBtn.addEventListener('click', () => {
      window.logger.info('Shuffle toggle clicked', 'UI');
      toggleShuffleResontes();
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
      if (window.CastManager && typeof window.CastManager.isSessionActive === 'function' && window.CastManager.isSessionActive()) {
        if (typeof window.CastManager.togglePlayback === 'function') {
          window.CastManager.togglePlayback();
          return;
        }
      }
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

  if (elements.favoriteBtn && !elements.favoriteBtn.dataset.resonateFavoriteBound) {
    elements.favoriteBtn.dataset.resonateFavoriteBound = 'true';
    elements.favoriteBtn.addEventListener('click', async () => {
      const current = (window.state && window.state.currentTrack)
        ? window.state.currentTrack
        : ((window.state && window.state.savedPlaybackState && window.state.savedPlaybackState.track)
          ? window.state.savedPlaybackState.track
          : null);

      if (!current) {
        try { safeShowStatus('Play a track to add it to resonates', 'info', 2500); } catch {}
        return;
      }

      if (!current.url && elements && elements.audio && elements.audio.currentSrc) {
        current.url = elements.audio.currentSrc;
      }

      if (!current.url && current.id) {
        try {
          const files = await fetchOptimizedPlayableFiles(current.id);
          if (files.length > 0) {
            current.url = files[0].url;
          }
        } catch (error) {
          window.logger.error(`Error fetching URL for favorite: ${error.message}`, 'UI');
        }
      }

      if (current.url) {
        if (typeof window.toggleResonteTrack === 'function') {
          window.toggleResonteTrack(current);
        } else {
          toggleFavorite(current);
        }
      }
    });
  }

  if (elements.currentTrackCast) {
    const handleCast = async () => {
      const audioEl = (elements && elements.audio) ? elements.audio : document.getElementById('audio');
      const castBtn = (elements && elements.currentTrackCast) ? elements.currentTrackCast : document.getElementById('current-track-cast');
      const track = (state && state.currentTrack) ? state.currentTrack : null;
      const audioSrc = audioEl ? (audioEl.currentSrc || audioEl.src || '') : '';

      const syncCastPlaybackContext = () => {
        try {
          if (!window.playbackManager || typeof window.playbackManager.getCurrentContext !== 'function') return;

          const currentContext = window.playbackManager.getCurrentContext();
          const currentCtxData = currentContext && window.playbackManager.contextData
            ? window.playbackManager.contextData[currentContext]
            : null;
          if (currentContext && currentCtxData && Array.isArray(currentCtxData.items) && currentCtxData.items.length > 0) {
            let startIndex = -1;
            if (track && typeof track.trackIndex === 'number' && track.trackIndex >= 0) {
              startIndex = track.trackIndex;
            }

            if (startIndex < 0 && track) {
              if (currentContext === 'search') {
                startIndex = currentCtxData.items.findIndex(it => it && (it.identifier || it.id) === (track.albumId || track.id));
              } else if (track.url) {
                startIndex = currentCtxData.items.findIndex(it => it && it.url === track.url);
              }
            }

            if (startIndex < 0) startIndex = 0;
            currentCtxData.currentIndex = startIndex;

            if (currentContext === 'album' && !currentCtxData.currentAlbumId) {
              currentCtxData.currentAlbumId = (track && (track.albumId || track.album || track.id)) || currentCtxData.currentAlbumId || null;
            }

            if (typeof window.loadPlaybackQueue === 'function' && (currentContext === 'album' || currentContext === 'favorites' || currentContext === 'searchPlaylist')) {
              const nextIndex = Math.min(Math.max(startIndex + 1, 0), currentCtxData.items.length);
              window.loadPlaybackQueue(currentContext, currentCtxData.items, nextIndex);
            }
            return;
          }

          const searchPlaylist = (state && Array.isArray(state.searchPlaylist)) ? state.searchPlaylist : [];
          const preferSearchPlaylist = !!(state && state.autoPlaySearchResults);
          if (preferSearchPlaylist && searchPlaylist.length > 0) {
            let startIndex = -1;
            if (track && track.url) {
              startIndex = searchPlaylist.findIndex(it => it && it.url === track.url);
            }
            if (startIndex < 0) startIndex = 0;
            if (typeof window.playbackManager.setSearchPlaylist === 'function') {
              window.playbackManager.setSearchPlaylist(searchPlaylist, startIndex);
            } else if (typeof window.playbackManager.setContext === 'function') {
              window.playbackManager.setContext('searchPlaylist', searchPlaylist, startIndex);
            }
            if (typeof window.loadPlaybackQueue === 'function') {
              const nextIndex = Math.min(Math.max(startIndex + 1, 0), searchPlaylist.length);
              window.loadPlaybackQueue('searchPlaylist', searchPlaylist, nextIndex);
            }
            return;
          }

          const currentTracklist = (state && Array.isArray(state.currentTracklist)) ? state.currentTracklist : [];
          const savedTracklist = (state && state.savedPlaybackTracklist && Array.isArray(state.savedPlaybackTracklist.items))
            ? state.savedPlaybackTracklist.items
            : [];
          const fallbackList = currentTracklist.length ? currentTracklist : savedTracklist;

          if (fallbackList.length > 1) {
            const albumId = (track && (track.albumId || track.album || track.id))
              || (state && state.savedPlaybackTracklist && state.savedPlaybackTracklist.albumId)
              || (fallbackList[0] && (fallbackList[0].albumId || fallbackList[0].album || fallbackList[0].id))
              || null;
            let startIndex = (track && typeof track.trackIndex === 'number') ? track.trackIndex : -1;
            if (startIndex < 0 && track && track.url) {
              startIndex = fallbackList.findIndex(it => it && it.url === track.url);
            }
            if (startIndex < 0) startIndex = 0;
            if (typeof window.playbackManager.setAlbumPlaylist === 'function') {
              window.playbackManager.setAlbumPlaylist(albumId, fallbackList, startIndex);
              if (typeof window.loadPlaybackQueue === 'function') {
                const nextIndex = Math.min(Math.max(startIndex + 1, 0), fallbackList.length);
                window.loadPlaybackQueue('album', fallbackList, nextIndex);
              }
              return;
            }
          }

          if (state && state.isPlayingFavorites && Array.isArray(state.favorites) && state.favorites.length > 0) {
            let startIndex = -1;
            if (track && track.url) {
              startIndex = state.favorites.findIndex(it => it && it.url === track.url);
            }
            if (startIndex < 0) startIndex = 0;
            if (typeof window.playbackManager.setContext === 'function') {
              window.playbackManager.setContext('favorites', state.favorites, startIndex);
              if (typeof window.loadPlaybackQueue === 'function') {
                const nextIndex = Math.min(Math.max(startIndex + 1, 0), state.favorites.length);
                window.loadPlaybackQueue('favorites', state.favorites, nextIndex);
              }
              return;
            }
          }

          if (state && Array.isArray(state.searchResults) && state.searchResults.length > 0) {
            let startIndex = -1;
            if (track && track.id) {
              startIndex = state.searchResults.findIndex(it => it && (it.identifier || it.id) === track.id);
            }
            if (startIndex < 0) startIndex = 0;
            if (typeof window.playbackManager.setContext === 'function') {
              window.playbackManager.setContext('search', state.searchResults, startIndex);
              if (typeof window.loadPlaybackQueue === 'function') {
                const nextIndex = Math.min(Math.max(startIndex + 1, 0), state.searchResults.length);
                window.loadPlaybackQueue('search', state.searchResults, nextIndex);
              }
            }
          }
        } catch {}
      };

      const showCastHint = (message) => {
        try {
          if (window && typeof window.showAutoplayCta === 'function') {
            window.showAutoplayCta(message);
            return;
          }
        } catch {}
        try { showStatus(message, 'info', 6000); } catch {}
      };

      if (castBtn) {
        try {
          castBtn.classList.remove('cast-pulse');
          void castBtn.offsetWidth;
          castBtn.classList.add('cast-pulse');
        } catch {}
      }

      if (!audioEl) {
        showCastHint('Cast is available, pick a device to connect');
      }

      const ensureRemotePlaybackAvailability = async (el) => {
        if (!el || !el.remote || typeof el.remote.watchAvailability !== 'function') return null;
        try {
          if (typeof window.__resonateRemotePlaybackAvailable === 'boolean') {
            return window.__resonateRemotePlaybackAvailable;
          }
        } catch {}

        return new Promise((resolve) => {
          let settled = false;
          const finish = (value) => {
            if (settled) return;
            settled = true;
            try { window.__resonateRemotePlaybackAvailable = !!value; } catch {}
            resolve(!!value);
          };

          try {
            const maybePromise = el.remote.watchAvailability((available) => {
              finish(available);
            });
            if (maybePromise && typeof maybePromise.catch === 'function') {
              maybePromise.catch(() => finish(false));
            }
          } catch {
            finish(false);
          }

          setTimeout(() => finish(false), 1200);
        });
      };

      const caps = (typeof window.getCastCapabilities === 'function')
        ? window.getCastCapabilities(audioEl)
        : { canRemotePlayback: false, canAirPlay: false };

      if (window.CastManager && typeof window.CastManager.init === 'function') {
        try { window.CastManager.init(); } catch {}
      }

      if (window.CastManager && typeof window.CastManager.isReady === 'function' && window.CastManager.isReady()) {
        try {
          syncCastPlaybackContext();
          await window.CastManager.requestSession();

          var castTime = audioEl ? audioEl.currentTime : 0;
          var castUrl = audioSrc || (track && track.url) || '';
          if (!castUrl) {
            showCastHint('Connected to Cast. Select a track to play.');
            return;
          }
          var castDuration = null;
          if (track && typeof track.duration === 'number' && isFinite(track.duration) && track.duration > 0) {
            castDuration = track.duration;
          } else if (audioEl && typeof audioEl.duration === 'number' && isFinite(audioEl.duration) && audioEl.duration > 0) {
            castDuration = audioEl.duration;
          }
          await window.CastManager.loadMediaFromTrack(track, castUrl, castTime, castDuration, { force: true });
          showCastHint('Casting to device');
          return;
        } catch (err) {
          showCastHint('Cast session failed. Check sender domain and devices.');
        }
      }

      if (caps.canRemotePlayback) {
        const availability = await ensureRemotePlaybackAvailability(audioEl);
        if (availability === false) {
          const isPwa = (typeof isRunningAsPWA === 'function') ? isRunningAsPWA() : false;
          showCastHint(isPwa
            ? 'Open in browser and use the Cast menu'
            : 'Use your browser menu to cast this track');
          return;
        }
      }

      if (caps.canRemotePlayback) {
        try {
          await audioEl.remote.prompt();
          showStatus('Choose a device to cast', 'info', 4000);
          return;
        } catch (err) {
          if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
            showCastHint('Cast prompt dismissed');
            return;
          }
          window.logger?.warn({ message: 'Cast prompt failed', error: err }, 'UI');
        }
      }

      if (caps.canAirPlay) {
        try {
          audioEl.webkitShowPlaybackTargetPicker();
          showStatus('Choose an AirPlay device', 'info', 4000);
          return;
        } catch (err) {
          if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
            showCastHint('AirPlay picker dismissed');
            return;
          }
          window.logger?.warn({ message: 'AirPlay picker failed', error: err }, 'UI');
        }
      }

      const isPwa = (typeof isRunningAsPWA === 'function') ? isRunningAsPWA() : false;
      try {
        const hintKey = 'resonate_cast_hint_shown';
        if (sessionStorage.getItem(hintKey) !== 'true') {
          showCastHint(
            isPwa
              ? 'Casting needs the browser menu. Opening a browser tab.'
              : 'Use your browser menu to cast this track'
          );
          sessionStorage.setItem(hintKey, 'true');
        }
      } catch {}
      if (isPwa) {
        showCastHint('Use your browser menu to cast this track');
        return;
      }

      if (!audioSrc) {
        showCastHint('Play a track first to cast');
        return;
      }

      showCastHint('Use your browser menu to cast this track');
    };

    elements.currentTrackCast.addEventListener('click', handleCast);
    elements.currentTrackCast.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        handleCast();
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

      // Theme toggle should not close overlays (search/favorites).
      const themeToggle = document.getElementById('theme-toggle');
      if (themeToggle && target && themeToggle.contains(target)) {
        return;
      }

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
  let __resonateHistoryEntryAdded = false;
  const ensureHistoryEntry = () => {
    if (__resonateHistoryEntryAdded) return;
    if (!state || !state.userInteracted) return;
    try {
      window.history.pushState(null, '', window.location.href);
      __resonateHistoryEntryAdded = true;
    } catch {}
  };

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
      if (__resonateHistoryEntryAdded && state && state.userInteracted) {
        try { window.history.pushState(null, '', window.location.href); } catch {}
      }
      return;
    }
    // Otherwise allow normal back/exit (lighter behavior for PWA)
  });

  // Add a single history entry only after user interaction.
  const onFirstInteraction = () => {
    try { state.userInteracted = true; } catch {}
    ensureHistoryEntry();
  };
  document.addEventListener('click', onFirstInteraction, { once: true, passive: true });
  document.addEventListener('keydown', onFirstInteraction, { once: true, passive: true });
  document.addEventListener('touchstart', onFirstInteraction, { once: true, passive: true });

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
  // Preferred naming
  window.toggleShuffleResontes = toggleShuffleFavorites;
  window.addAlbumToFavorites = addAlbumToFavorites;
  window.removeAlbumFromFavorites = removeAlbumFromFavorites;
  window.isAlbumInFavorites = isAlbumInFavorites;
  window.addAlbumToResontes = addAlbumToFavorites;
  window.removeAlbumFromResontes = removeAlbumFromFavorites;
  window.isAlbumInResontes = isAlbumInFavorites;
  window.audioCache = typeof audioCache !== 'undefined' ? audioCache : null;
  // Note: playOptimizedFavorite, playAlbumFromFavorites, playSpecificSearchTrack, and playRandomSearchResults are exposed in search.js
  window.installPWA = typeof window.installPWA !== 'undefined' ? window.installPWA : null;
  window.preloadNextTrack = preloadNextTrack;
  window.loadPlaybackQueue = loadPlaybackQueue;
  window.playFromFavoritesQueue = playFromFavoritesQueue;
  window.playFromResontesQueue = playFromFavoritesQueue;
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

      const coreGlobalsReady =
        typeof window.state !== 'undefined' &&
        typeof window.elements !== 'undefined' &&
        typeof window.showStatus !== 'undefined';

      // Prefer the explicit marker, but fall back to core globals so we don't deadlock
      // if the marker is missing for any reason.
      const uiReady =
        window.uiScriptLoaded === true ||
        (coreGlobalsReady && (typeof window.loadFavorites === 'function' || typeof window.loadResontes === 'function'));

      // Esperar específicamente a que ui.js se haya cargado completamente
      if (uiReady && coreGlobalsReady) {
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
                  <button onclick="location.reload()" style="padding:12px 16px;font-size:16px;cursor:pointer;background:var(--primary,#3da9ff);color:var(--on-accent,#fff);border:none;border-radius:10px">
                    Retry
                  </button>
                  <button onclick="location.href='/'" style="padding:12px 16px;font-size:16px;cursor:pointer;background:var(--btn,#e5e5e5);color:var(--fg,#111);border:1px solid var(--surface-border,rgba(0,0,0,0.12));border-radius:10px">
                    Go to home
                  </button>
                </div>

                <details style="margin-top:12px">
                  <summary style="cursor:pointer">Show diagnostics</summary>
                  <pre style="white-space:pre-wrap;word-break:break-word;background:var(--bg,#111);color:var(--fg,#e5e5e5);padding:12px;border-radius:10px;overflow:auto;margin-top:10px;border:1px solid var(--surface-border,rgba(255,255,255,0.12))">${JSON.stringify(diagnostics, null, 2)}</pre>
                </details>

                <p style="margin:16px 0 0 0;color:var(--muted,#666);line-height:1.5">
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
