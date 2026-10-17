(function () {
  'use strict';

  var CAST_SENDER_SCRIPT_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
  var DEFAULT_CAF_APP_ID = 'CC1AD845';
  var castReady = false;
  var castInitAttempted = false;
  var castInitError = null;
  var castScriptLoadPromise = null;
  var castApiWaiters = [];
  var lastMediaUrl = '';
  var lastSessionId = '';
  var castHintSessionId = '';
  var remotePlayer = null;
  var remoteController = null;
  var lastRemoteAdvanceAt = 0;
  var lastRemoteContentId = '';
  var lastMediaSessionId = '';
  var castPlaybackMonitorId = null;
  var remotePlayerListeners = [];
  var castContextListeners = [];
  var mediaSessionUpdateListener = null;
  var observedMediaSession = null;
  var localAudioListeners = [];
  var suppressLocalAudioSync = false;
  var hadActiveCastSession = false;
  var fallbackInProgress = false;
  var lastLocalSeekAt = 0;
  var lastLocalSeekPosition = -1;
  var pendingMuteState = null;
  var requestTimeoutMs = 30000;

  function addTrackedListener(target, type, listener, collection) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, listener);
    collection.push({ target: target, type: type, listener: listener });
  }

  function destroyCastManager() {
    detachSessionListeners();
    removeTrackedListeners(remotePlayerListeners);
    removeTrackedListeners(castContextListeners);
    removeTrackedListeners(localAudioListeners);
    remotePlayer = null;
    remoteController = null;
    hadActiveCastSession = false;
    castReady = false;
    castInitAttempted = false;
    fallbackInProgress = false;
    try {
      var button = (window.elements && window.elements.currentTrackCast)
        || document.getElementById('current-track-cast');
      if (button) {
        button.removeAttribute('data-cast-state');
        button.removeAttribute('aria-pressed');
      }
    } catch (error) {
      logCastError('Could not reset Cast button state during cleanup', error);
    }
  }

  class CastManager {
    isReady() { return castReady; }
    getInitError() { return castInitError; }
    getCastState() { return getCastState(); }
    getCastButtonState() {
      var button = (window.elements && window.elements.currentTrackCast)
        || document.getElementById('current-track-cast');
      return button && button.dataset ? button.dataset.castState || 'NOT_CONNECTED' : 'NOT_CONNECTED';
    }
    getRemotePositionState() { return getRemotePositionState(); }
    init() { return initCastFramework(); }
    ensureReady() { return ensureCastFrameworkReady(); }
    requestSession() { return requestSession(); }
    isSessionActive() { return isSessionActive(); }
    disconnect() { return disconnect(); }
    togglePlayback() { return togglePlayback(); }
    play() { return play(); }
    pause() { return pause(); }
    prepareLocalPlaybackForCast() { return prepareLocalPlaybackForCast(); }
    resumeLocalPlaybackAfterCastFailure(snapshot) {
      return resumeLocalPlaybackAfterCastFailure(snapshot);
    }
    seekTo(seconds) { return seekTo(seconds); }
    skipBy(deltaSeconds) { return skipBy(deltaSeconds); }
    setVolume(volume, muted) { return setVolume(volume, muted); }
    loadMediaFromTrack(track, audioUrl, currentTime, duration, options) {
      return loadMediaFromTrack(track, audioUrl, currentTime, duration, options);
    }
    destroy() { return destroyCastManager(); }
  }

  function removeTrackedListeners(collection) {
    while (collection.length) {
      var binding = collection.pop();
      try {
        if (binding.target && typeof binding.target.removeEventListener === 'function') {
          binding.target.removeEventListener(binding.type, binding.listener);
        }
      } catch (error) {
        logCastError('Could not remove a Cast event listener', error);
      }
    }
  }

  function logCastError(message, error) {
    try {
      if (window.logger && typeof window.logger.warn === 'function') {
        window.logger.warn({ message: message, error: error }, 'CAST');
      } else if (window.console && typeof window.console.warn === 'function') {
        window.console.warn(message, error);
      }
    } catch (loggingError) {
      if (window.console && typeof window.console.warn === 'function') {
        window.console.warn(message, error, loggingError);
      }
    }
  }

  function withTimeout(promise, operation) {
    var timer;
    return Promise.race([
      Promise.resolve(promise),
      new Promise(function (_resolve, reject) {
        timer = window.setTimeout(function () {
          reject(new Error(operation + ' timed out'));
        }, requestTimeoutMs);
      })
    ]).finally(function () {
      if (timer) window.clearTimeout(timer);
    });
  }

  function getDefaultCastAppId() {
    try {
      var sdkDefault = window.chrome
        && window.chrome.cast
        && window.chrome.cast.media
        && window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID;
      if (sdkDefault) return String(sdkDefault);
    } catch (e) {}
    return DEFAULT_CAF_APP_ID;
  }

  function isLocalDevelopmentOrigin() {
    try {
      var location = window.location || {};
      var hostname = String(location.hostname || '').toLowerCase();
      var port = String(location.port || '');
      return hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === '[::1]'
        || hostname.endsWith('.local')
        || hostname.indexOf('dev.') >= 0
        || port === '3000'
        || port === '8080';
    } catch (e) {
      return false;
    }
  }

  function parseCastDevFlag(value) {
    var normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'sdk' || normalized === 'sender' || normalized === 'force') return 'sdk';
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
    return null;
  }

  function isLocalDevelopmentCastEnabled() {
    if (!isLocalDevelopmentOrigin()) return true;

    try {
      var search = window.location && window.location.search ? String(window.location.search) : '';
      var queryValue = parseCastDevFlag(new URLSearchParams(search).get('castDev'));
      if (queryValue === 'sdk') {
        return true;
      }
      if (queryValue === false) {
        try { window.localStorage.removeItem('resonate_cast_dev'); } catch (storageError) {}
        return false;
      }
    } catch (e) {}

    try {
      return parseCastDevFlag(window.localStorage && window.localStorage.getItem('resonate_cast_dev')) === 'sdk';
    } catch (e) {
      return false;
    }
  }

  function getCastAppId() {
    var defaultAppId = getDefaultCastAppId();
    try {
      var meta = document.querySelector('meta[name="cast-app-id"]');
      var fromMeta = meta ? String(meta.getAttribute('content') || '').trim() : '';
      var allowProduction = meta
        ? String(meta.getAttribute('data-allow-production') || '').trim().toLowerCase() === 'true'
        : false;
      if (!fromMeta) return defaultAppId;
      if (fromMeta === defaultAppId) return fromMeta;
      if (allowProduction || isLocalDevelopmentOrigin()) return fromMeta;
    } catch (e) {}
    return defaultAppId;
  }

  function isCastFrameworkReady() {
    return !!(window.cast && window.cast.framework && window.chrome && window.chrome.cast);
  }

  function isStandaloneDisplayMode() {
    try {
      return !!((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
        || window.navigator.standalone === true);
    } catch (e) {
      return false;
    }
  }

  function hasSecureCastOrigin() {
    try {
      if (window.isSecureContext) return true;
      var hostname = String(window.location && window.location.hostname || '').toLowerCase();
      return hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === '[::1]'
        || hostname.endsWith('.local');
    } catch (e) {
      return false;
    }
  }

  function isSupportedCastSenderBrowser() {
    try {
      if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
        return false;
      }
    } catch (e) {}

    try {
      var uaData = navigator.userAgentData;
      if (uaData && Array.isArray(uaData.brands) && uaData.brands.length) {
        for (var i = 0; i < uaData.brands.length; i++) {
          var brand = String(uaData.brands[i] && uaData.brands[i].brand || '').toLowerCase();
          if (brand.indexOf('opera') >= 0 || brand.indexOf('brave') >= 0 || brand.indexOf('vivaldi') >= 0) {
            return false;
          }
          if (brand.indexOf('google chrome') >= 0 || brand.indexOf('microsoft edge') >= 0) {
            return true;
          }
        }
        return false;
      }
    } catch (e) {}

    try {
      var ua = String(navigator.userAgent || '');
      var vendor = String(navigator.vendor || '');
      if (!ua) return false;
      if (/iPad|iPhone|iPod/i.test(ua)) return false;
      if (/Firefox|FxiOS/i.test(ua)) return false;
      if (/OPR|Opera|Vivaldi/i.test(ua)) return false;
      if (/Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR/i.test(ua)) return false;
      if (/Edg/i.test(ua)) return true;
      if (/Chrome|Chromium/i.test(ua) && /Google Inc\./i.test(vendor)) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  function shouldLoadCastSenderFramework() {
    if (isCastFrameworkReady()) return true;
    if (!hasSecureCastOrigin()) {
      castInitError = 'Cast sender requires HTTPS or localhost';
      return false;
    }
    if (!isSupportedCastSenderBrowser()) {
      castInitError = 'Cast sender unsupported in this browser; using native cast fallback';
      return false;
    }
    if (!isLocalDevelopmentCastEnabled()) {
      castInitError = 'Cast sender disabled in local development; use native remote playback locally or force the sender SDK with ?castDev=sdk';
      return false;
    }
    return true;
  }

  function shouldPreloadCastSenderFramework() {
    if (!shouldLoadCastSenderFramework()) return false;
    if (isLocalDevelopmentOrigin()) return false;
    return true;
  }

  function settleCastApiWaiters(isAvailable) {
    var waiters = castApiWaiters.splice(0, castApiWaiters.length);
    for (var i = 0; i < waiters.length; i++) {
      try {
        waiters[i](!!isAvailable);
      } catch (e) {}
    }
  }

  function refreshCastButtonState() {
    try {
      updateCastButtonState();
      if (typeof window.applyCastButtonState === 'function') {
        window.applyCastButtonState(document.getElementById('current-track-cast'));
      }
    } catch (e) {}
  }

  function findCastSenderScript() {
    try {
      return document.querySelector('script[data-resonate-cast-sender="true"], script[src*="www.gstatic.com/cv/js/sender/v1/cast_sender.js"]');
    } catch (e) {
      return null;
    }
  }

  function loadCastFrameworkScript() {
    if (isCastFrameworkReady()) return Promise.resolve(true);
    var existing = findCastSenderScript();
    if (!existing && !shouldLoadCastSenderFramework()) return Promise.resolve(false);
    if (castScriptLoadPromise) return castScriptLoadPromise;

    castScriptLoadPromise = new Promise(function (resolve) {
      castApiWaiters.push(resolve);

      existing = existing || findCastSenderScript();
      if (!existing) {
        var script = document.createElement('script');
        script.async = true;
        script.defer = true;
        script.src = CAST_SENDER_SCRIPT_URL;
        script.dataset.resonateCastSender = 'true';
        script.addEventListener('error', function () {
          castInitError = 'Cast sender failed to load';
          settleCastApiWaiters(false);
          refreshCastButtonState();
        }, { once: true });
        (document.head || document.documentElement).appendChild(script);
      }

      window.setTimeout(function () {
        if (!isCastFrameworkReady()) {
          castInitError = castInitError || 'Cast sender load timed out';
          settleCastApiWaiters(false);
          refreshCastButtonState();
        }
      }, 8000);
    });

    return castScriptLoadPromise;
  }

  function preloadCastFrameworkScript() {
    try {
      if (!shouldPreloadCastSenderFramework()) return Promise.resolve(false);
      return loadCastFrameworkScript();
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function ensureCastFrameworkReady() {
    if (castReady) return Promise.resolve(true);
    if (isCastFrameworkReady()) return Promise.resolve(initCastFramework());
    return loadCastFrameworkScript().then(function (isAvailable) {
      if (!isAvailable) return false;
      return initCastFramework();
    });
  }

  function getAudioElement() {
    try {
      if (window.elements && window.elements.audio) return window.elements.audio;
    } catch (e) {}
    return document.getElementById('audio');
  }

  function enforceLocalPause() {
    try {
      var audio = getAudioElement();
      if (audio && !audio.paused) {
        suppressLocalAudioSync = true;
        audio.pause();
        suppressLocalAudioSync = false;
      }
    } catch (error) {
      suppressLocalAudioSync = false;
      logCastError('Could not pause local audio while casting', error);
    }
  }

  function prepareLocalPlaybackForCast() {
    var audio = getAudioElement();
    if (!audio) return null;
    var snapshot = {
      currentTime: Number(audio.currentTime) || 0,
      wasPlaying: !audio.paused && !audio.ended,
      source: normalizeContentId(audio.currentSrc || audio.src || '')
    };
    suppressLocalAudioSync = true;
    try {
      if (snapshot.wasPlaying) audio.pause();
    } catch (error) {
      logCastError('Could not pause local audio while connecting to Cast', error);
    } finally {
      suppressLocalAudioSync = false;
    }
    return snapshot;
  }

  function resumeLocalPlaybackAfterCastFailure(snapshot) {
    if (!snapshot || isSessionActive() || isSessionPending()) return false;
    var audio = getAudioElement();
    if (!audio) return false;

    var currentSource = normalizeContentId(audio.currentSrc || audio.src || '');
    if (snapshot.source && currentSource === snapshot.source) {
      try {
        if (isFinite(Number(audio.duration)) && Number(audio.duration) > 0) {
          audio.currentTime = Math.min(snapshot.currentTime, Number(audio.duration));
        } else {
          audio.currentTime = snapshot.currentTime;
        }
      } catch (error) {
        logCastError('Could not restore local audio position after Cast connection failed', error);
      }
    }

    if (!snapshot.wasPlaying) return true;
    try {
      var playResult = audio.play();
      if (playResult && typeof playResult.catch === 'function') {
        playResult.catch(function (error) {
          logCastError('Could not resume local audio after Cast connection failed', error);
        });
      }
      return true;
    } catch (error) {
      logCastError('Could not resume local audio after Cast connection failed', error);
      return false;
    }
  }

  function maybeShowCastingHint(sessionId) {
    try {
      if (!sessionId || castHintSessionId === sessionId) return;
      castHintSessionId = sessionId;
    } catch (e) {}
  }

  function getCurrentRemotePosition() {
    var position = remotePlayer ? Number(remotePlayer.currentTime) : NaN;
    if (!isFinite(position) || position < 0) {
      var audio = getAudioElement();
      position = audio ? Number(audio.currentTime) : 0;
    }
    return isFinite(position) && position >= 0 ? position : 0;
  }

  function restoreLocalPlayback() {
    if (!hadActiveCastSession || fallbackInProgress || isSessionActive()) return;
    fallbackInProgress = true;

    // Capture the receiver position before ending the session and resume HTML5 audio at that point.
    var audio = getAudioElement();
    var track = window.state && window.state.currentTrack ? window.state.currentTrack : null;
    var mediaInfo = remotePlayer && remotePlayer.mediaInfo;
    var fallbackTrack = mediaInfo ? buildFallbackTrackFromMediaInfo(mediaInfo, track) : null;
    if (fallbackTrack && fallbackTrack.track) {
      track = Object.assign({}, track || {}, fallbackTrack.track);
      if (window.state) window.state.currentTrack = track;
      updateLocalNowPlaying(track, fallbackTrack.identifier);
    }

    var source = track && track.url
      ? String(track.url)
      : mediaInfo && mediaInfo.contentId
        ? String(mediaInfo.contentId)
        : '';
    var position = getCurrentRemotePosition();
    var shouldPlay = !!(remotePlayer && !remotePlayer.isPaused);

    hadActiveCastSession = false;
    if (!audio || !source) {
      fallbackInProgress = false;
      updateLocalTransportState();
      return;
    }

    var normalizedSource = normalizeContentId(source);
    var currentSource = normalizeContentId(audio.currentSrc || audio.src || '');
    var sourceChanged = !currentSource || currentSource !== normalizedSource;
    var restorePosition = function () {
      suppressLocalAudioSync = true;
      try {
        if (isFinite(Number(audio.duration)) && Number(audio.duration) > 0) {
          audio.currentTime = Math.min(position, Number(audio.duration));
        } else {
          audio.currentTime = position;
        }
      } catch (error) {
        logCastError('Could not restore local playback position', error);
      }
      suppressLocalAudioSync = false;
      updateLocalTransportState();

      if (shouldPlay) {
        var playResult;
        try {
          playResult = audio.play();
        } catch (error) {
          fallbackInProgress = false;
          logCastError('Could not resume local playback after Cast ended', error);
          return;
        }
        if (playResult && typeof playResult.then === 'function') {
          Promise.resolve(playResult).then(function () {
            fallbackInProgress = false;
          }).catch(function (error) {
            fallbackInProgress = false;
            logCastError('Could not resume local playback after Cast ended', error);
          });
        } else {
          fallbackInProgress = false;
        }
      } else {
        fallbackInProgress = false;
      }
    };

    if (sourceChanged) {
      var metadataTimer = null;
      var metadataSettled = false;
      var cleanupMetadataWait = function () {
        metadataSettled = true;
        audio.removeEventListener('loadedmetadata', onMetadata);
        audio.removeEventListener('error', onAudioError);
        if (metadataTimer) window.clearTimeout(metadataTimer);
      };
      var onMetadata = function () {
        cleanupMetadataWait();
        restorePosition();
      };
      var onAudioError = function () {
        cleanupMetadataWait();
        fallbackInProgress = false;
        logCastError('Local audio failed to load after Cast ended', audio.error || new Error('Unknown audio error'));
      };
      audio.addEventListener('loadedmetadata', onMetadata, { once: true });
      audio.addEventListener('error', onAudioError, { once: true });
      audio.src = source;
      try {
        audio.load();
        if (!metadataSettled) {
          metadataTimer = window.setTimeout(function () {
            cleanupMetadataWait();
            fallbackInProgress = false;
            logCastError('Local audio did not become ready after Cast ended', new Error('Audio metadata load timed out'));
          }, requestTimeoutMs);
        }
      } catch (error) {
        cleanupMetadataWait();
        fallbackInProgress = false;
        logCastError('Could not reload local audio after Cast ended', error);
      }
    } else {
      restorePosition();
    }
  }

  function applyRemoteVolumeToLocal() {
    if (!remotePlayer || !remotePlayer.isConnected) return;
    var audio = getAudioElement();
    if (!audio) return;
    var volume = Number(remotePlayer.volumeLevel);
    var muted = !!remotePlayer.isMuted;
    if (!isFinite(volume)) return;

    suppressLocalAudioSync = true;
    try {
      audio.volume = Math.max(0, Math.min(1, volume));
      audio.muted = muted;
      pendingMuteState = null;
      if (window.state) window.state.currentVolume = audio.volume;
      var slider = window.elements && window.elements.volumeSlider;
      if (slider) slider.value = String(audio.volume);
      if (typeof window.saveVolume === 'function') window.saveVolume(audio.volume);
      if (typeof window.saveMutedState === 'function') window.saveMutedState(muted);
      if (typeof window.updateVolumeIcon === 'function') window.updateVolumeIcon();
    } catch (error) {
      logCastError('Could not synchronize remote volume with the local player', error);
    } finally {
      suppressLocalAudioSync = false;
    }
  }

  function syncVolumeToRemote() {
    if (!remotePlayer || !remotePlayer.isConnected || !remoteController) return;
    var audio = getAudioElement();
    if (!audio) return;
    try {
      var volume = Math.max(0, Math.min(1, Number(audio.volume)));
      if (isFinite(volume) && volume !== Number(remotePlayer.volumeLevel)) {
        remotePlayer.volumeLevel = volume;
        remoteController.setVolumeLevel();
      }
      if (!!audio.muted !== !!remotePlayer.isMuted && pendingMuteState !== !!audio.muted) {
        pendingMuteState = !!audio.muted;
        remoteController.muteOrUnmute();
      }
    } catch (error) {
      logCastError('Could not synchronize local volume with Cast', error);
    }
  }

  function handleLocalAudioEvent(type) {
    if (suppressLocalAudioSync || fallbackInProgress || !remotePlayer
      || !remotePlayer.isConnected || !isSessionActive()) return;
    try {
      if (type === 'play') {
        play();
        enforceLocalPause();
      } else if (type === 'pause') {
        pause();
      } else if (type === 'seeked') {
        var audio = getAudioElement();
        if (!audio) return;
        var now = Date.now();
        var position = Number(audio.currentTime);
        if (now - lastLocalSeekAt < 300 && Math.abs(position - lastLocalSeekPosition) < 0.5) return;
        lastLocalSeekAt = now;
        lastLocalSeekPosition = position;
        seekTo(position);
      } else if (type === 'volumechange') {
        syncVolumeToRemote();
      }
    } catch (error) {
      logCastError('Could not synchronize local ' + type + ' event with Cast', error);
    }
  }

  function attachLocalAudioListeners() {
    var audio = getAudioElement();
    if (!audio || localAudioListeners.length) return;
    ['play', 'pause', 'seeked', 'volumechange'].forEach(function (type) {
      var listener = function () { handleLocalAudioEvent(type); };
      addTrackedListener(audio, type, listener, localAudioListeners);
    });
  }

  function detachMediaSessionListener() {
    if (!observedMediaSession || !mediaSessionUpdateListener) return;
    try {
      if (typeof observedMediaSession.removeUpdateListener === 'function') {
        observedMediaSession.removeUpdateListener(mediaSessionUpdateListener);
      }
    } catch (error) {
      logCastError('Could not remove Cast media-session listener', error);
    }
    observedMediaSession = null;
    mediaSessionUpdateListener = null;
    lastMediaSessionId = '';
  }

  function detachSessionListeners() {
    detachMediaSessionListener();
    stopCastPlaybackMonitor();
  }

  function ensureRemotePlayer() {
    if (!isCastFrameworkReady()) return;
    if (remotePlayer && remoteController) {
      attachLocalAudioListeners();
      return;
    }

    try {
      remotePlayer = new window.cast.framework.RemotePlayer();
      // A single controller instance serves the lifetime of the app; detach its listeners on destroy.
      remoteController = new window.cast.framework.RemotePlayerController(remotePlayer);

      addTrackedListener(remoteController, window.cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED, function () {
        try {
          var connected = !!remotePlayer.isConnected;
          if (connected) {
            hadActiveCastSession = true;
            enforceLocalPause();
            var context = getCastContext();
            var session = context ? context.getCurrentSession() : null;
            var sessionId = session && session.getSessionId ? String(session.getSessionId()) : '';
            maybeShowCastingHint(sessionId);
            startCastPlaybackMonitor();
            if (remotePlayer.mediaInfo) applyRemoteVolumeToLocal();
            else syncVolumeToRemote();
          } else {
            stopCastPlaybackMonitor();
            restoreLocalPlayback();
          }
          refreshCastButtonState();
          updateLocalTransportState();
        } catch (error) {
          logCastError('Could not synchronize Cast connection state', error);
        }
      }, remotePlayerListeners);

      addTrackedListener(remoteController, window.cast.framework.RemotePlayerEventType.PLAYER_STATE_CHANGED, function () {
        try {
          if (remotePlayer && !remotePlayer.isPaused) {
            enforceLocalPause();
          }
          updateLocalTransportState();
          maybeAdvanceOnRemoteEnd();
          maybeAdvanceNearRemoteEnd();
        } catch (error) {
          logCastError('Could not synchronize remote playback state', error);
        }
      }, remotePlayerListeners);

      addTrackedListener(remoteController, window.cast.framework.RemotePlayerEventType.MEDIA_INFO_CHANGED, function () {
        try {
          if (remotePlayer && remotePlayer.mediaInfo) {
            enforceLocalPause();
          }
          updateLocalTransportState();
          if (remotePlayer && remotePlayer.mediaInfo) {
            syncLocalTrackFromRemoteMedia(remotePlayer.mediaInfo, false);
          }
          try {
            var context = getCastContext();
            var session = context ? context.getCurrentSession() : null;
            attachMediaSessionListeners(session);
          } catch (e) {}
        } catch (error) {
          logCastError('Could not synchronize remote media information', error);
        }
      }, remotePlayerListeners);

      addTrackedListener(remoteController, window.cast.framework.RemotePlayerEventType.CURRENT_TIME_CHANGED, function () {
        try {
          syncRemoteProgressToLocalUi();
          if (typeof window.updateMediaPositionState === 'function') {
            window.updateMediaPositionState();
          }
        } catch (error) {
          logCastError('Could not synchronize remote playback position', error);
        }
      }, remotePlayerListeners);

      [
        window.cast.framework.RemotePlayerEventType.VOLUME_LEVEL_CHANGED,
        window.cast.framework.RemotePlayerEventType.IS_MUTED_CHANGED
      ].forEach(function (eventType) {
        if (!eventType) return;
        addTrackedListener(remoteController, eventType, applyRemoteVolumeToLocal, remotePlayerListeners);
      });
      attachLocalAudioListeners();
    } catch (error) {
      logCastError('Could not initialize the Cast remote player', error);
    }
  }

  function getRemotePositionState() {
    try {
      if (!remotePlayer || !remotePlayer.isConnected || !isSessionActive()) return null;
      var duration = Number(remotePlayer.duration);
      var position = Number(remotePlayer.currentTime);
      var playbackRate = Number(remotePlayer.playbackRate || 1);
      if (!isFinite(duration) || duration <= 0) return null;
      if (!isFinite(position) || position < 0) position = 0;
      if (!isFinite(playbackRate) || playbackRate <= 0) playbackRate = 1;
      return { duration: duration, position: position, playbackRate: playbackRate };
    } catch (e) {
      return null;
    }
  }

  function syncRemoteProgressToLocalUi() {
    if (!remotePlayer || !remotePlayer.isConnected) return;
    var duration = Number(remotePlayer.duration);
    var position = Number(remotePlayer.currentTime);
    if (!isFinite(duration) || duration <= 0 || !isFinite(position)) return;
    position = Math.max(0, Math.min(position, duration));

    var elements = window.elements || {};
    if (elements.progress) elements.progress.style.width = (position / duration * 100) + '%';
    if (elements.currentTime) {
      elements.currentTime.textContent = typeof window.formatTime === 'function'
        ? window.formatTime(position)
        : formatClockTime(position);
    }
    if (elements.totalTime) {
      elements.totalTime.textContent = typeof window.formatTime === 'function'
        ? window.formatTime(duration)
        : formatClockTime(duration);
    }
    if (elements.progressBar) {
      elements.progressBar.setAttribute('aria-valuenow', String(Math.round(position / duration * 100)));
      elements.progressBar.setAttribute('aria-valuetext', formatClockTime(position) + ' de ' + formatClockTime(duration));
    }
  }

  function formatClockTime(seconds) {
    var value = Math.max(0, Math.floor(Number(seconds) || 0));
    var minutes = Math.floor(value / 60);
    var remainingSeconds = value % 60;
    return minutes + ':' + (remainingSeconds < 10 ? '0' : '') + remainingSeconds;
  }

  function normalizeContentId(contentId) {
    if (!contentId) return '';
    try {
      if (typeof canonicalizeUrl === 'function') {
        return canonicalizeUrl(String(contentId));
      }
      return new URL(String(contentId), window.location.href).href;
    } catch (e) {
      return String(contentId || '');
    }
  }

  function findTrackInCurrentContextByUrl(contentId) {
    try {
      var manager = window.playbackManager;
      if (!manager || typeof manager.getCurrentContext !== 'function') return null;
      var context = manager.getCurrentContext();
      if (!context || !manager.contextData || !manager.contextData[context]) return null;
      var ctx = manager.contextData[context];
      var items = Array.isArray(ctx.items) ? ctx.items : [];
      if (!items.length) return null;
      var target = normalizeContentId(contentId);
      if (!target) return null;

      var idx = -1;
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var itemUrl = item && item.url ? normalizeContentId(item.url) : '';
        if (itemUrl && itemUrl === target) {
          idx = i;
          break;
        }
      }
      if (idx < 0) return null;
      ctx.currentIndex = idx;

      var identifier = '';
      if (context === 'album' && typeof manager.getCurrentAlbumId === 'function') {
        identifier = manager.getCurrentAlbumId();
      }
      return { track: items[idx], identifier: identifier || (items[idx] && (items[idx].albumId || items[idx].id)) || '' };
    } catch (e) {
      return null;
    }
  }

  function buildFallbackTrackFromMediaInfo(mediaInfo, fallbackTrack) {
    try {
      var meta = mediaInfo && mediaInfo.metadata ? mediaInfo.metadata : null;
      var title = meta && meta.title ? String(meta.title) : (fallbackTrack && fallbackTrack.title) ? String(fallbackTrack.title) : 'Track';
      var creator = meta && meta.artist ? String(meta.artist) : (fallbackTrack && fallbackTrack.creator) ? String(fallbackTrack.creator) : 'Unknown';
      var albumTitle = meta && meta.albumName ? String(meta.albumName) : (fallbackTrack && (fallbackTrack.albumTitle || fallbackTrack.album)) ? String(fallbackTrack.albumTitle || fallbackTrack.album) : '';
      var trackNumber = meta && Number.isFinite(meta.trackNumber) ? Number(meta.trackNumber) : (fallbackTrack && Number.isFinite(fallbackTrack.trackIndex) ? fallbackTrack.trackIndex + 1 : null);
      var totalTracks = meta && Number.isFinite(meta.totalTrackCount) ? Number(meta.totalTrackCount) : (fallbackTrack && Number.isFinite(fallbackTrack.totalTracks) ? fallbackTrack.totalTracks : 1);
      var duration = mediaInfo && Number.isFinite(mediaInfo.duration) ? Number(mediaInfo.duration) : (fallbackTrack && Number.isFinite(fallbackTrack.duration) ? fallbackTrack.duration : null);

      var track = {
        url: mediaInfo && mediaInfo.contentId ? String(mediaInfo.contentId) : '',
        title: title,
        creator: creator,
        albumTitle: albumTitle,
        trackIndex: trackNumber ? Math.max(0, trackNumber - 1) : 0,
        totalTracks: totalTracks || 1,
        duration: duration || undefined,
        isAlbumTrack: (totalTracks || 1) > 1
      };

      var identifier = (fallbackTrack && (fallbackTrack.albumId || fallbackTrack.id)) ? (fallbackTrack.albumId || fallbackTrack.id) : '';
      return { track: track, identifier: identifier };
    } catch (e) {
      return null;
    }
  }

  function updateLocalNowPlaying(track, identifier) {
    try {
      if (!track) return false;
      var elements = window.elements || {};
      var trackTitle = track.title || 'Untitled';
      var isAlbumTrack = (track.totalTracks || 1) > 1;
      var albumTitle = (track.albumTitle || track.album || '').toString().trim();
      var displayTitle = (isAlbumTrack && albumTitle && albumTitle.toLowerCase() !== trackTitle.toLowerCase())
        ? albumTitle + ' - ' + trackTitle
        : trackTitle;
      if (window.TrackNormalizer && typeof window.TrackNormalizer.sanitizeDisplayTitle === 'function') {
        displayTitle = window.TrackNormalizer.sanitizeDisplayTitle(displayTitle, track.creator, albumTitle);
      }
      if (typeof window.updateTitleTicker === 'function') {
        window.updateTitleTicker(displayTitle);
      } else if (elements.title) {
        elements.title.textContent = displayTitle;
      }
      if (elements.creator) {
        elements.creator.textContent = isAlbumTrack
          ? (track.creator || 'Unknown') + ' (' + (Number(track.trackIndex || 0) + 1) + '/' + (track.totalTracks || 1) + ')'
          : (track.creator || 'Unknown');
      }
      if (typeof window.updateDescriptionUI === 'function') {
        window.updateDescriptionUI(track);
      }
      if (typeof setArtwork === 'function') {
        setArtwork(track, identifier).catch(function () {});
      }
      if (typeof updateFavoriteButton === 'function') {
        updateFavoriteButton();
      }
      if (typeof updateMediaSessionMetadata === 'function') {
        updateMediaSessionMetadata(track, identifier);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function syncLocalTrackFromRemoteMedia(mediaInfo, force) {
    try {
      if (!mediaInfo) return false;
      var contentId = mediaInfo.contentId ? String(mediaInfo.contentId) : '';
      if (!contentId) return false;
      var normalized = normalizeContentId(contentId);
      if (!normalized) return false;
      if (!force && lastRemoteContentId && lastRemoteContentId === normalized) return false;
      lastRemoteContentId = normalized;

      var match = findTrackInCurrentContextByUrl(contentId);
      var fallbackTrack = (window.state && window.state.currentTrack) ? window.state.currentTrack : null;
      var payload = match ? match : buildFallbackTrackFromMediaInfo(mediaInfo, fallbackTrack);
      if (!payload || !payload.track) return false;

      var identifier = payload.identifier || (payload.track.albumId || payload.track.id) || (fallbackTrack && (fallbackTrack.albumId || fallbackTrack.id)) || '';
      var merged = Object.assign({}, payload.track);
      merged.url = merged.url || contentId;
      merged.id = merged.id || identifier || merged.url;
      if (!Number.isFinite(merged.trackIndex)) merged.trackIndex = 0;
      if (!Number.isFinite(merged.totalTracks)) merged.totalTracks = 1;
      merged.isAlbumTrack = (merged.totalTracks || 1) > 1;
      merged.albumId = merged.albumId || identifier || merged.id;

      if (!window.state) window.state = {};
      window.state.currentTrack = Object.assign({}, window.state.currentTrack || {}, merged);

      return updateLocalNowPlaying(window.state.currentTrack, identifier);
    } catch (e) {
      return false;
    }
  }

  function maybeAdvanceOnRemoteEnd() {
    try {
      if (!remotePlayer || !remotePlayer.isConnected) return;
      var playerState = remotePlayer.playerState || '';
      var idleReason = remotePlayer.idleReason || '';
      var RemotePlayerState = window.cast && window.cast.framework ? window.cast.framework.RemotePlayerState : null;
      var IdleReason = window.chrome && window.chrome.cast ? window.chrome.cast.media.IdleReason : null;
      var isIdle = RemotePlayerState ? playerState === RemotePlayerState.IDLE : String(playerState) === 'IDLE';
      var isFinished = IdleReason ? idleReason === IdleReason.FINISHED : String(idleReason) === 'FINISHED';

      if (!isIdle || !isFinished) return;
      var now = Date.now();
      if (now - lastRemoteAdvanceAt < 1200) return;
      lastRemoteAdvanceAt = now;
      if (typeof window.playNext === 'function') {
        window.playNext();
      }
    } catch (e) {}
  }

  function maybeAdvanceNearRemoteEnd() {
    try {
      if (!remotePlayer || !remotePlayer.isConnected) return;
      var duration = Number(remotePlayer.duration || 0);
      var position = Number(remotePlayer.currentTime || 0);
      if (!isFinite(duration) || duration <= 0) return;
      if (!isFinite(position) || position < 0) position = 0;

      var remaining = duration - position;
      if (remaining > 1.25) return;
      var now = Date.now();
      if (now - lastRemoteAdvanceAt < 1200) return;
      lastRemoteAdvanceAt = now;
      if (typeof window.playNext === 'function') {
        window.playNext();
      }
    } catch (e) {}
  }

  function startCastPlaybackMonitor() {
    if (castPlaybackMonitorId) return;
    castPlaybackMonitorId = window.setInterval(function () {
      try {
        if (!remotePlayer || !remotePlayer.isConnected) return;
        maybeAdvanceOnRemoteEnd();
        maybeAdvanceNearRemoteEnd();
      } catch (e) {}
    }, 1200);
  }

  function stopCastPlaybackMonitor() {
    if (!castPlaybackMonitorId) return;
    try { window.clearInterval(castPlaybackMonitorId); } catch (e) {}
    castPlaybackMonitorId = null;
  }

  function maybeAdvanceOnMediaSession(mediaSession) {
    try {
      if (!mediaSession) return;
      var playerState = mediaSession.playerState || '';
      var idleReason = mediaSession.idleReason || '';
      var PlayerState = window.chrome && window.chrome.cast ? window.chrome.cast.media.PlayerState : null;
      var IdleReason = window.chrome && window.chrome.cast ? window.chrome.cast.media.IdleReason : null;
      var isIdle = PlayerState ? playerState === PlayerState.IDLE : String(playerState) === 'IDLE';
      var isFinished = IdleReason ? idleReason === IdleReason.FINISHED : String(idleReason) === 'FINISHED';

      if (!isIdle || !isFinished) return;
      var now = Date.now();
      if (now - lastRemoteAdvanceAt < 1200) return;
      lastRemoteAdvanceAt = now;
      if (typeof window.playNext === 'function') {
        window.playNext();
      }
    } catch (e) {}
  }

  function attachMediaSessionListeners(session) {
    if (!session || typeof session.getMediaSession !== 'function') return;
    try {
      var mediaSession = session.getMediaSession();
      if (!mediaSession) {
        detachMediaSessionListener();
        return;
      }
      var mediaSessionId = mediaSession.mediaSessionId ? String(mediaSession.mediaSessionId) : '';
      if (mediaSession === observedMediaSession
        || (mediaSessionId && mediaSessionId === lastMediaSessionId)) return;

      detachMediaSessionListener();
      observedMediaSession = mediaSession;
      lastMediaSessionId = mediaSessionId;
      mediaSessionUpdateListener = function (isAlive) {
        try {
          if (!isAlive) return;
          if (mediaSession.media) syncLocalTrackFromRemoteMedia(mediaSession.media, false);
          maybeAdvanceOnMediaSession(mediaSession);
          updateLocalTransportState();
          applyRemoteVolumeToLocal();
          syncRemoteProgressToLocalUi();
        } catch (error) {
          logCastError('Could not synchronize Cast media-session state', error);
        }
      };
      if (typeof mediaSession.addUpdateListener === 'function') {
        mediaSession.addUpdateListener(mediaSessionUpdateListener);
      }
    } catch (error) {
      logCastError('Could not observe the Cast media session', error);
    }
  }

  function updateLocalTransportState() {
    try {
      var playBtn = (window.elements && window.elements.playBtn) ? window.elements.playBtn : document.getElementById('play-btn');
      if (!playBtn) return;
      var audio = getAudioElement();
      var isPlaying = remotePlayer && remotePlayer.isConnected && isSessionActive()
        ? !remotePlayer.isPaused
        : !!(audio && !audio.paused);
      if (window.setMainPlayButtonState) {
        window.setMainPlayButtonState(isPlaying);
      }
      if (window.mediaSessionManager && window.mediaSessionManager.isSupported) {
        window.mediaSessionManager.updatePlaybackState(isPlaying ? 'playing' : 'paused');
      }
    } catch (e) {}
  }

  function updateCastButtonState() {
    var button = (window.elements && window.elements.currentTrackCast)
      || document.getElementById('current-track-cast');
    if (!button) return;

    var CastState = window.cast && window.cast.framework ? window.cast.framework.CastState : null;
    var SessionState = window.cast && window.cast.framework ? window.cast.framework.SessionState : null;
    var castState = getCastState();
    var sessionState = getSessionState();
    var context = getCastContext();
    var session = null;
    try {
      session = context ? context.getCurrentSession() : null;
    } catch (error) {
      logCastError('Could not read the current Cast session', error);
    }
    var state = 'NOT_CONNECTED';
    var isActiveSession = !!(SessionState && (
      sessionState === SessionState.SESSION_STARTED
      || sessionState === SessionState.SESSION_RESUMED
      || (SessionState.SESSION_ENDING && sessionState === SessionState.SESSION_ENDING)
    ));
    var isStartingSession = !!(SessionState && (
      sessionState === SessionState.SESSION_STARTING
      || sessionState === SessionState.SESSION_RESUMING
    ));

    // CAF session lifecycle is authoritative; CastState can lag briefly at session end.
    if (isActiveSession) {
      state = 'CONNECTED';
    } else if (isStartingSession || (CastState && castState === CastState.CONNECTING)) {
      state = 'CONNECTING';
    } else if (remotePlayer && remotePlayer.isConnected
      && (!SessionState || sessionState == null) && session) {
      state = 'CONNECTED';
    } else if (CastState && castState === CastState.CONNECTED && session
      && (!SessionState || sessionState == null)) {
      state = 'CONNECTED';
    } else if (CastState && castState === CastState.NO_DEVICES_AVAILABLE) {
      state = 'NO_DEVICES_AVAILABLE';
    }

    try {
      button.dataset.castState = state;
      button.setAttribute('data-cast-state', state);
      button.setAttribute('aria-pressed', state === 'CONNECTED' ? 'true' : 'false');
    } catch (error) {
      logCastError('Could not expose the Cast button state', error);
    }
  }

  function handleSessionStateChange(context, state) {
    var SessionState = window.cast && window.cast.framework
      ? window.cast.framework.SessionState
      : null;
    if (!context || !SessionState) return;

    try {
      var session = context.getCurrentSession();
      var sessionId = session && session.getSessionId ? String(session.getSessionId()) : '';
      var isActive = state === String(SessionState.SESSION_STARTED)
        || state === String(SessionState.SESSION_RESUMED)
        || (SessionState.SESSION_ENDING
          && state === String(SessionState.SESSION_ENDING));
      var isStarting = state === String(SessionState.SESSION_STARTING)
        || state === String(SessionState.SESSION_RESUMING);
      var isFailed = (SessionState.SESSION_START_FAILED
          && state === String(SessionState.SESSION_START_FAILED))
        || (SessionState.SESSION_RESUME_FAILED
          && state === String(SessionState.SESSION_RESUME_FAILED));

      if (sessionId !== lastSessionId) {
        lastSessionId = sessionId;
        lastMediaUrl = '';
      }

      updateCastUi(state, session);
      ensureRemotePlayer();
      if (isActive) {
        hadActiveCastSession = true;
        // A confirmed sender session takes playback ownership, even if the receiver is still loading media.
        enforceLocalPause();
        if (sessionId) maybeShowCastingHint(sessionId);
        attachMediaSessionListeners(session);
        startCastPlaybackMonitor();
      } else if (isStarting) {
        attachMediaSessionListeners(session);
      } else if (isFailed || state === String(SessionState.SESSION_ENDED)) {
        restoreLocalPlayback();
        detachSessionListeners();
      }

      if (isActive && remotePlayer && remotePlayer.mediaInfo) {
        syncLocalTrackFromRemoteMedia(remotePlayer.mediaInfo, true);
      }
      refreshCastButtonState();
      updateLocalTransportState();
    } catch (error) {
      logCastError('Could not handle Cast session state change', error);
    }
  }

  function initCastFramework() {
    if (castReady) return true;

    if (!isCastFrameworkReady()) {
      castInitError = castInitError || 'Cast framework not ready';
      loadCastFrameworkScript();
      return false;
    }

    if (castInitAttempted) return castReady;
    castInitAttempted = true;

    try {
      var appId = getCastAppId();
      var context = window.cast.framework.CastContext.getInstance();
      context.setOptions({
        receiverApplicationId: appId,
        autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGINAL_URL
      });

      try {
        // Keep context observers for app lifetime so resumed sessions reattach without duplicate handlers.
        addTrackedListener(context, window.cast.framework.CastContextEventType.SESSION_STATE_CHANGED, function (event) {
          var state = event && event.sessionState
            ? String(event.sessionState)
            : String(getSessionState() || '');
          handleSessionStateChange(context, state);
        }, castContextListeners);
      } catch (error) {
        logCastError('Could not subscribe to Cast session changes', error);
      }

      try {
        addTrackedListener(context, window.cast.framework.CastContextEventType.CAST_STATE_CHANGED, function () {
          try {
            updateCastButtonState();
            if (typeof window.applyCastButtonState === 'function') {
              window.applyCastButtonState(document.getElementById('current-track-cast'));
            }
          } catch (error) {
            logCastError('Could not update the Cast button state', error);
          }
        }, castContextListeners);
      } catch (error) {
        logCastError('Could not subscribe to Cast availability changes', error);
      }

      castReady = true;
      castInitError = null;
      ensureRemotePlayer();
      attachLocalAudioListeners();
      // A session may have auto-joined before listeners were installed; reconcile its snapshot.
      handleSessionStateChange(context, String(context.getSessionState() || ''));
      return true;
    } catch (e) {
      castInitError = e && e.message ? e.message : 'Cast init failed';
      castReady = false;
      logCastError('Could not initialize the Cast framework', e);
      return false;
    }
  }

  function getCastContext() {
    if (!isCastFrameworkReady()) return null;
    try {
      return window.cast.framework.CastContext.getInstance();
    } catch (e) {
      return null;
    }
  }

  function getCastState() {
    if (!isCastFrameworkReady()) return null;
    try {
      var context = getCastContext();
      return context ? context.getCastState() : null;
    } catch (e) {
      return null;
    }
  }

  function requestSession() {
    var context = getCastContext();
    if (!context) return Promise.reject(new Error('Cast context not available'));
    try {
      return withTimeout(context.requestSession(), 'Cast session request').catch(function (error) {
        logCastError('Cast session request failed', error);
        refreshCastButtonState();
        throw error;
      });
    } catch (error) {
      logCastError('Cast session request failed', error);
      return Promise.reject(error);
    }
  }

  function getSessionState() {
    var context = getCastContext();
    if (!context) return null;
    try {
      return context.getSessionState();
    } catch (e) {
      return null;
    }
  }

  function isSessionActive() {
    if (!isCastFrameworkReady()) return false;
    var state = getSessionState();
    var SessionState = window.cast && window.cast.framework ? window.cast.framework.SessionState : null;
    if (!SessionState) return false;
    return state === SessionState.SESSION_STARTED
      || state === SessionState.SESSION_RESUMED
      || (SessionState.SESSION_ENDING && state === SessionState.SESSION_ENDING);
  }

  function isSessionPending() {
    if (!isCastFrameworkReady()) return false;
    var state = getSessionState();
    var SessionState = window.cast && window.cast.framework ? window.cast.framework.SessionState : null;
    if (!SessionState) return false;
    return state === SessionState.SESSION_STARTING || state === SessionState.SESSION_RESUMING;
  }

  function disconnect() {
    var context = getCastContext();
    if (!context) return false;
    try {
      context.endCurrentSession(true);
      return true;
    } catch (error) {
      logCastError('Could not end the Cast session', error);
      return false;
    }
  }

  function seekTo(seconds) {
    var context = getCastContext();
    if (!context) return false;
    var session = context.getCurrentSession();
    if (!session || typeof session.getMediaSession !== 'function') return false;
    try {
      var mediaSession = session.getMediaSession();
      if (!mediaSession) return false;
      var req = new window.chrome.cast.media.SeekRequest();
      req.currentTime = Math.max(0, Number(seconds) || 0);
      mediaSession.seek(req);
      return true;
    } catch (error) {
      logCastError('Could not seek the Cast receiver', error);
      return false;
    }
  }

  function skipBy(deltaSeconds) {
    try {
      var state = getRemotePositionState();
      if (!state) return false;
      return seekTo(state.position + Number(deltaSeconds || 0));
    } catch (error) {
      logCastError('Could not toggle Cast playback', error);
      return false;
    }
  }

  function togglePlayback() {
    if (!remoteController) return false;
    try {
      remoteController.playOrPause();
      return true;
    } catch (e) {
      return false;
    }
  }

  function play() {
    if (!remoteController) return false;
    try {
      if (remotePlayer && remotePlayer.isPaused) remoteController.playOrPause();
      return true;
    } catch (error) {
      logCastError('Could not start Cast playback', error);
      return false;
    }
  }

  function pause() {
    if (!remoteController) return false;
    try {
      if (remotePlayer && !remotePlayer.isPaused) remoteController.playOrPause();
      return true;
    } catch (error) {
      logCastError('Could not pause Cast playback', error);
      return false;
    }
  }

  function setVolume(volume, muted) {
    if (!remotePlayer || !remotePlayer.isConnected || !remoteController) return false;
    var value = Number(volume);
    if (!isFinite(value)) return false;
    try {
      remotePlayer.volumeLevel = Math.max(0, Math.min(1, value));
      remoteController.setVolumeLevel();
      if (typeof muted === 'boolean' && muted !== !!remotePlayer.isMuted) {
        remoteController.muteOrUnmute();
      }
      return true;
    } catch (error) {
      logCastError('Could not set Cast volume', error);
      return false;
    }
  }

  function getCoverUrl(track) {
    if (!track) return '';
    var supplied = track.coverArt || track.coverUrl || track.artwork || track.image || track.thumbnail;
    if (supplied) {
      try {
        return new URL(String(supplied), window.location.href).href;
      } catch (error) {
        logCastError('Ignoring invalid track artwork URL', error);
      }
    }
    var id = track.id || track.identifier || track.albumId || '';
    if (!id) return '';
    return 'https://archive.org/services/img/' + encodeURIComponent(id);
  }

  function getCastMediaContentType(track, url) {
    var format = '';
    try {
      format = track && track.format ? String(track.format).trim().toLowerCase() : '';
    } catch (e) {
      format = '';
    }

    if (!format) {
      try {
        var fileName = track && track.fileName ? String(track.fileName).trim().toLowerCase() : '';
        if (fileName) {
          var parts = fileName.split('.');
          format = parts.length > 1 ? String(parts.pop() || '').trim().toLowerCase() : '';
        }
      } catch (e) {
        format = '';
      }
    }

    if (!format) {
      try {
        var pathname = new URL(String(url || ''), window.location.href).pathname.toLowerCase();
        var match = pathname.match(/\.([a-z0-9]+)$/i);
        format = match && match[1] ? String(match[1]).toLowerCase() : '';
      } catch (e) {
        var rawUrl = String(url || '').toLowerCase();
        var fallbackMatch = rawUrl.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
        format = fallbackMatch && fallbackMatch[1] ? String(fallbackMatch[1]).toLowerCase() : '';
      }
    }

    switch (format) {
      case 'flac':
        return 'audio/flac';
      case 'ogg':
      case 'oga':
      case 'opus':
        return 'audio/ogg';
      case 'wav':
      case 'wave':
        return 'audio/wav';
      case 'aac':
        return 'audio/aac';
      case 'm4a':
      case 'mp4':
        return 'audio/mp4';
      case 'mp3':
      default:
        return 'audio/mpeg';
    }
  }

  function loadMediaFromTrack(track, audioUrl, currentTime, duration, options) {
    if (!isCastFrameworkReady()) return Promise.reject(new Error('Cast framework not available'));

    var url = audioUrl || (track && track.url) || '';
    if (!url) return Promise.reject(new Error('No audio URL to cast'));

    var force = options && options.force === true;
    if (!force && lastMediaUrl && lastMediaUrl === url) {
      return Promise.resolve();
    }

    var title = (track && track.title) ? String(track.title) : 'Track';
    var artist = (track && track.creator) ? String(track.creator) : '';
    var album = (track && (track.albumTitle || track.album)) ? String(track.albumTitle || track.album) : '';
    var trackNumber = (track && typeof track.trackIndex === 'number' && isFinite(track.trackIndex)) ? (track.trackIndex + 1) : null;
    var totalTracks = (track && typeof track.totalTracks === 'number' && isFinite(track.totalTracks)) ? track.totalTracks : null;
    var artUrl = getCoverUrl(track);
    var durationSeconds = (typeof duration === 'number' && isFinite(duration) && duration > 0) ? duration : null;
    var contentType = getCastMediaContentType(track, url);

    var mediaInfo = new window.chrome.cast.media.MediaInfo(url, contentType);
    mediaInfo.streamType = window.chrome.cast.media.StreamType.BUFFERED;
    if (durationSeconds) {
      mediaInfo.duration = durationSeconds;
    }
    var metadata = new window.chrome.cast.media.MusicTrackMediaMetadata();
    metadata.title = title;
    if (artist) metadata.artist = artist;
    if (album) metadata.albumName = album;
    if (trackNumber) metadata.trackNumber = trackNumber;
    if (totalTracks) metadata.totalTrackCount = totalTracks;
    if (artUrl) metadata.images = [new window.chrome.cast.Image(artUrl)];
    mediaInfo.metadata = metadata;

    var request = new window.chrome.cast.media.LoadRequest(mediaInfo);
    if (typeof currentTime === 'number' && isFinite(currentTime) && currentTime > 0) {
      request.currentTime = currentTime;
    }

    var context = getCastContext();
    if (!context) return Promise.reject(new Error('Cast context not available'));
    var session = context.getCurrentSession();
    if (!session) return Promise.reject(new Error('Cast session not available'));

    return withTimeout(Promise.resolve().then(function () {
      return session.loadMedia(request);
    }), 'Cast media load').then(function (result) {
      lastMediaUrl = url;
      try {
        attachMediaSessionListeners(session);
      } catch (e) {}
      return result;
    }).catch(function (error) {
      logCastError('Could not load media on the Cast receiver', error);
      throw error;
    });
  }

  function onGCastApiAvailable(isAvailable) {
    // Google calls this global callback once the asynchronously loaded sender SDK is ready.
    if (!isAvailable) {
      castInitError = castInitError || 'Cast API unavailable';
      settleCastApiWaiters(false);
      refreshCastButtonState();
      return;
    }
    initCastFramework();
    settleCastApiWaiters(true);
    refreshCastButtonState();
  }

  function updateCastUi(state, session) {
    var SessionState = window.cast && window.cast.framework ? window.cast.framework.SessionState : null;
    if (!SessionState) return;
    var active = state === SessionState.SESSION_STARTED
      || state === SessionState.SESSION_RESUMED
      || (SessionState.SESSION_ENDING && state === SessionState.SESSION_ENDING);
    try { document.body.classList.toggle('casting-active', !!active); } catch (e) {}

    try {
      var statusEl = document.getElementById('cast-status');
      if (!statusEl) return;
      var deviceName = '';
      try {
        if (session && typeof session.getCastDevice === 'function') {
          var device = session.getCastDevice();
          deviceName = device && device.friendlyName ? String(device.friendlyName) : '';
        }
      } catch (e) {}
      statusEl.textContent = deviceName ? 'Casting: ' + deviceName : 'Casting';
      if (deviceName) {
        statusEl.setAttribute('title', deviceName);
      } else {
        statusEl.removeAttribute('title');
      }
    } catch (e) {}
  }

  window.__onGCastApiAvailable = onGCastApiAvailable;
  window.__resonatePreloadCastSender = preloadCastFrameworkScript;

  if (isCastFrameworkReady()) {
    initCastFramework();
    try {
      var ctx = getCastContext();
      var st = ctx ? ctx.getSessionState() : null;
      updateCastUi(st, ctx ? ctx.getCurrentSession() : null);
      ensureRemotePlayer();
      updateLocalTransportState();
    } catch (e) {}
  } else {
    refreshCastButtonState();
  }

  window.CastManager = new CastManager();
})();
