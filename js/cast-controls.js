(function () {
  'use strict';

  function getAudioElement() {
    return (window.elements && window.elements.audio) || document.getElementById('audio');
  }

  function getCastButton() {
    return (window.elements && window.elements.currentTrackCast)
      || document.getElementById('current-track-cast');
  }

  function showCastHint(message, type, duration) {
    try {
      window.logger?.info(message, 'CAST');
    } catch (error) {
      window.logger?.warn({ message: 'Could not log Cast status', error: error }, 'CAST');
    }
    if (typeof window.showStatus === 'function') {
      window.showStatus(message, type || 'info', duration === undefined ? 3500 : duration);
    }
  }

  function reportCastError(message, error) {
    try {
      window.logger?.warn({ message: message, error: error }, 'UI');
    } catch (loggingError) {
      window.console?.warn(message, error, loggingError);
    }
  }

  function pulseCastButton(button) {
    if (!button) return;
    button.classList.remove('cast-pulse');
    void button.offsetWidth;
    button.classList.add('cast-pulse');
  }

  function isAllowedCastUrl(url) {
    if (!url) return false;
    try {
      const parsedUrl = new URL(String(url), window.location.href);
      return /\.(flac|ogg|mp3)$/i.test(parsedUrl.pathname || '');
    } catch (error) {
      return /\.(flac|ogg|mp3)(\?|#|$)/i.test(String(url || '').trim());
    }
  }

  function pickCastUrl(track, audioSrc) {
    const trackUrl = track && track.url ? String(track.url) : '';
    if (trackUrl && isAllowedCastUrl(trackUrl)) return trackUrl;
    if (audioSrc && !String(audioSrc).startsWith('blob:') && isAllowedCastUrl(audioSrc)) return audioSrc;
    return trackUrl || audioSrc || '';
  }

  function syncCastPlaybackContext(track, state) {
    const manager = window.playbackManager;
    if (!manager || typeof manager.getCurrentContext !== 'function') return;

    try {
      const currentContext = manager.getCurrentContext();
      const currentContextData = currentContext && manager.contextData
        ? manager.contextData[currentContext]
        : null;
      if (currentContext && currentContextData && Array.isArray(currentContextData.items) && currentContextData.items.length > 0) {
        let startIndex = -1;
        if (track && typeof track.trackIndex === 'number' && track.trackIndex >= 0) {
          startIndex = track.trackIndex;
        }

        if (startIndex < 0 && track) {
          if (currentContext === 'search') {
            startIndex = currentContextData.items.findIndex(item => item && (item.identifier || item.id) === (track.albumId || track.id));
          } else if (track.url) {
            startIndex = currentContextData.items.findIndex(item => item && item.url === track.url);
          }
        }

        if (startIndex < 0) startIndex = 0;
        currentContextData.currentIndex = startIndex;

        if (currentContext === 'album' && !currentContextData.currentAlbumId) {
          currentContextData.currentAlbumId = (track && (track.albumId || track.album || track.id))
            || currentContextData.currentAlbumId
            || null;
        }

        if (typeof window.loadPlaybackQueue === 'function'
          && ['album', 'favorites', 'searchPlaylist'].includes(currentContext)) {
          const nextIndex = Math.min(Math.max(startIndex + 1, 0), currentContextData.items.length);
          window.loadPlaybackQueue(currentContext, currentContextData.items, nextIndex);
        }
        return;
      }

      const searchPlaylist = Array.isArray(state.searchPlaylist) ? state.searchPlaylist : [];
      if (state.autoPlaySearchResults && searchPlaylist.length > 0) {
        const startIndex = getTrackIndex(searchPlaylist, track && track.url, item => item && item.url, track);
        if (typeof manager.setSearchPlaylist === 'function') {
          manager.setSearchPlaylist(searchPlaylist, startIndex);
        } else if (typeof manager.setContext === 'function') {
          manager.setContext('searchPlaylist', searchPlaylist, startIndex);
        }
        loadQueueAfterCurrentTrack('searchPlaylist', searchPlaylist, startIndex);
        return;
      }

      const currentTracklist = Array.isArray(state.currentTracklist) ? state.currentTracklist : [];
      const savedTracklist = state.savedPlaybackTracklist && Array.isArray(state.savedPlaybackTracklist.items)
        ? state.savedPlaybackTracklist.items
        : [];
      const fallbackList = currentTracklist.length ? currentTracklist : savedTracklist;
      if (fallbackList.length > 1 && typeof manager.setAlbumPlaylist === 'function') {
        const albumId = (track && (track.albumId || track.album || track.id))
          || (state.savedPlaybackTracklist && state.savedPlaybackTracklist.albumId)
          || (fallbackList[0] && (fallbackList[0].albumId || fallbackList[0].album || fallbackList[0].id))
          || null;
        const startIndex = getTrackIndex(fallbackList, track && track.url, item => item && item.url, track, true);
        manager.setAlbumPlaylist(albumId, fallbackList, startIndex);
        loadQueueAfterCurrentTrack('album', fallbackList, startIndex);
        return;
      }

      if (state.isPlayingFavorites && Array.isArray(state.favorites) && state.favorites.length > 0
        && typeof manager.setContext === 'function') {
        const startIndex = getTrackIndex(state.favorites, track && track.url, item => item && item.url, track);
        manager.setContext('favorites', state.favorites, startIndex);
        loadQueueAfterCurrentTrack('favorites', state.favorites, startIndex);
        return;
      }

      if (Array.isArray(state.searchResults) && state.searchResults.length > 0
        && typeof manager.setContext === 'function') {
        const startIndex = getTrackIndex(
          state.searchResults,
          track && track.id,
          item => item && (item.identifier || item.id),
          track
        );
        manager.setContext('search', state.searchResults, startIndex);
        loadQueueAfterCurrentTrack('search', state.searchResults, startIndex);
      }
    } catch (error) {
      reportCastError('Could not synchronize playback queue before casting', error);
    }
  }

  function getTrackIndex(items, matchValue, getItemValue, track, preferTrackIndex) {
    let index = preferTrackIndex && track && typeof track.trackIndex === 'number' ? track.trackIndex : -1;
    if (index < 0 && matchValue) {
      index = items.findIndex(item => getItemValue(item) === matchValue);
    }
    return index < 0 ? 0 : index;
  }

  function loadQueueAfterCurrentTrack(context, items, currentIndex) {
    if (typeof window.loadPlaybackQueue !== 'function') return;
    const nextIndex = Math.min(Math.max(currentIndex + 1, 0), items.length);
    window.loadPlaybackQueue(context, items, nextIndex);
  }

  function isLocalDevelopmentOrigin() {
    try {
      const location = window.location || {};
      const hostname = String(location.hostname || '').toLowerCase();
      const port = String(location.port || '');
      return hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === '[::1]'
        || hostname.endsWith('.local')
        || hostname.includes('dev.')
        || port === '3000'
        || port === '8080';
    } catch (error) {
      return false;
    }
  }

  async function ensureRemotePlaybackAvailability(audioElement) {
    if (!audioElement || !audioElement.remote || typeof audioElement.remote.watchAvailability !== 'function') return null;
    if (typeof window.__resonateRemotePlaybackAvailable === 'boolean') {
      return window.__resonateRemotePlaybackAvailable;
    }

    return new Promise(resolve => {
      let settled = false;
      const finish = available => {
        if (settled) return;
        settled = true;
        window.__resonateRemotePlaybackAvailable = !!available;
        resolve(!!available);
      };

      try {
        const availabilityPromise = audioElement.remote.watchAvailability(finish);
        if (availabilityPromise && typeof availabilityPromise.catch === 'function') {
          availabilityPromise.catch(error => {
            reportCastError('Could not check remote playback availability', error);
            finish(false);
          });
        }
      } catch (error) {
        reportCastError('Could not check remote playback availability', error);
        finish(false);
      }

      window.setTimeout(() => finish(false), 1200);
    });
  }

  function getCastCapabilities(audioElement) {
    return typeof window.getCastCapabilities === 'function'
      ? window.getCastCapabilities(audioElement)
      : { canRemotePlayback: false, canAirPlay: false };
  }

  async function tryGoogleCast(track, audioElement, castUrl, state) {
    const manager = window.CastManager;
    if (isLocalDevelopmentOrigin() || !manager) return false;

    let managerReady = false;
    try {
      if (typeof manager.ensureReady === 'function') {
        managerReady = !!(await manager.ensureReady());
      } else if (typeof manager.init === 'function') {
        managerReady = !!manager.init();
      }
      if (!managerReady && typeof manager.isReady === 'function') {
        managerReady = !!manager.isReady();
      }
    } catch (error) {
      reportCastError('Could not initialize Cast sender', error);
      return false;
    }

    if (!managerReady) return false;

    try {
      syncCastPlaybackContext(track, state);
      await manager.requestSession();
      if (!castUrl) {
        showCastHint('Connected to Cast. Select a track to play.');
        return true;
      }

      const duration = track && typeof track.duration === 'number' && isFinite(track.duration) && track.duration > 0
        ? track.duration
        : audioElement && typeof audioElement.duration === 'number' && isFinite(audioElement.duration) && audioElement.duration > 0
          ? audioElement.duration
          : null;
      const currentTime = audioElement ? audioElement.currentTime : 0;
      await manager.loadMediaFromTrack(track, castUrl, currentTime, duration, { force: true });
      showCastHint('Casting to device');
      return true;
    } catch (error) {
      reportCastError('Cast session failed', error);
      showCastHint('Cast session failed. Check sender domain and devices.', 'warning', 4500);
      return false;
    }
  }

  async function handleCast() {
    const audioElement = getAudioElement();
    const castButton = getCastButton();
    const state = window.state || {};
    const track = state.currentTrack || null;
    const audioSrc = audioElement ? (audioElement.currentSrc || audioElement.src || '') : '';

    pulseCastButton(castButton);
    if (!audioElement) showCastHint('Cast is available, pick a device to connect');

    const capabilities = getCastCapabilities(audioElement);
    const castUrl = pickCastUrl(track, audioSrc);
    if (await tryGoogleCast(track, audioElement, castUrl, state)) return;

    if (capabilities.canRemotePlayback) {
      const available = await ensureRemotePlaybackAvailability(audioElement);
      if (available === false) {
        const isPwa = typeof window.isRunningAsPWA === 'function' && window.isRunningAsPWA();
        showCastHint(isPwa ? 'Open in browser and use the Cast menu' : 'Use your browser menu to cast this track', 'info', 4000);
        return;
      }

      try {
        await audioElement.remote.prompt();
        showCastHint('Choose a device to cast');
        return;
      } catch (error) {
        if (error && (error.name === 'AbortError' || error.name === 'NotAllowedError')) {
          showCastHint('Cast prompt dismissed', 'info', 2500);
          return;
        }
        reportCastError('Cast prompt failed', error);
      }
    }

    if (capabilities.canAirPlay) {
      try {
        audioElement.webkitShowPlaybackTargetPicker();
        showCastHint('Choose an AirPlay device');
        return;
      } catch (error) {
        if (error && (error.name === 'AbortError' || error.name === 'NotAllowedError')) {
          showCastHint('AirPlay picker dismissed', 'info', 2500);
          return;
        }
        reportCastError('AirPlay picker failed', error);
      }
    }

    if (isLocalDevelopmentOrigin()) {
      showCastHint('Local Cast uses the browser remote playback flow. The Google sender SDK stays off on localhost to avoid console errors.', 'info', 5000);
      return;
    }

    const isPwa = typeof window.isRunningAsPWA === 'function' && window.isRunningAsPWA();
    try {
      const hintKey = 'resonate_cast_hint_shown';
      if (window.sessionStorage.getItem(hintKey) !== 'true') {
        showCastHint(isPwa
          ? 'Casting needs the browser menu. Opening a browser tab.'
          : 'Use your browser menu to cast this track', 'info', 4000);
        window.sessionStorage.setItem(hintKey, 'true');
      }
    } catch (error) {
      reportCastError('Could not save Cast hint preference', error);
    }
    if (isPwa) {
      showCastHint('Use your browser menu to cast this track', 'info', 4000);
      return;
    }

    if (!audioSrc) {
      showCastHint('Play a track first to cast', 'info', 3000);
      return;
    }

    showCastHint('Use your browser menu to cast this track', 'info', 4000);
  }

  function initializeCastControls() {
    const button = getCastButton();
    if (!button || button.dataset.resonateCastControlsBound === 'true') return;
    button.dataset.resonateCastControlsBound = 'true';
    button.addEventListener('click', () => {
      handleCast().catch(error => {
        reportCastError('Cast action failed', error);
        showCastHint('Could not start casting. Please try again.', 'warning', 4500);
      });
    });
    button.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleCast().catch(error => {
          reportCastError('Cast action failed', error);
          showCastHint('Could not start casting. Please try again.', 'warning', 4500);
        });
      }
    });
  }

  initializeCastControls();
})();
