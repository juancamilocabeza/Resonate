(function () {
  'use strict';

  var DEFAULT_CAF_APP_ID = 'CC1AD845';
  var castReady = false;
  var castInitAttempted = false;
  var castInitError = null;
  var lastMediaUrl = '';
  var lastSessionId = '';
  var castHintSessionId = '';
  var remotePlayer = null;
  var remoteController = null;

  function getCastAppId() {
    try {
      var meta = document.querySelector('meta[name="cast-app-id"]');
      var fromMeta = meta ? String(meta.getAttribute('content') || '').trim() : '';
      if (fromMeta) return fromMeta;
    } catch (e) {}
    return DEFAULT_CAF_APP_ID;
  }

  function isCastFrameworkReady() {
    return !!(window.cast && window.cast.framework && window.chrome && window.chrome.cast);
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
        audio.pause();
      }
    } catch (e) {}
  }

  function maybeShowCastingHint(sessionId) {
    try {
      if (!sessionId || castHintSessionId === sessionId) return;
      castHintSessionId = sessionId;
      if (typeof window.showAutoplayCta === 'function') {
        window.showAutoplayCta('Playing on Cast device');
      }
    } catch (e) {}
  }

  function ensureRemotePlayer() {
    if (!isCastFrameworkReady()) return;
    if (remotePlayer && remoteController) return;

    try {
      remotePlayer = new window.cast.framework.RemotePlayer();
      remoteController = new window.cast.framework.RemotePlayerController(remotePlayer);

      remoteController.addEventListener(window.cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED, function () {
        try {
          var connected = !!remotePlayer.isConnected;
          if (connected) {
            enforceLocalPause();
            var context = getCastContext();
            var session = context ? context.getCurrentSession() : null;
            var sessionId = session && session.getSessionId ? String(session.getSessionId()) : '';
            maybeShowCastingHint(sessionId);
          }
        } catch (e) {}
      });

      remoteController.addEventListener(window.cast.framework.RemotePlayerEventType.PLAYER_STATE_CHANGED, function () {
        try {
          if (remotePlayer && !remotePlayer.isPaused) {
            enforceLocalPause();
          }
        } catch (e) {}
      });

      remoteController.addEventListener(window.cast.framework.RemotePlayerEventType.MEDIA_INFO_CHANGED, function () {
        try {
          if (remotePlayer && remotePlayer.mediaInfo) {
            enforceLocalPause();
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  function initCastFramework() {
    if (castInitAttempted) return castReady;
    castInitAttempted = true;

    if (!isCastFrameworkReady()) {
      castInitError = 'Cast framework not ready';
      return false;
    }

    try {
      var appId = getCastAppId();
      var context = window.cast.framework.CastContext.getInstance();
      context.setOptions({
        receiverApplicationId: appId,
        autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
      });

      try {
        context.addEventListener(window.cast.framework.CastContextEventType.SESSION_STATE_CHANGED, function (event) {
          try {
            var state = event && event.sessionState ? String(event.sessionState) : '';
            var session = context.getCurrentSession();
            var sessionId = session && session.getSessionId ? String(session.getSessionId()) : '';
            if (sessionId !== lastSessionId) {
              lastSessionId = sessionId;
              lastMediaUrl = '';
            }
            updateCastUi(state, session);
            ensureRemotePlayer();
            if (sessionId) {
              maybeShowCastingHint(sessionId);
            }
          } catch (e) {}
        });
      } catch (e) {}

      try {
        context.addEventListener(window.cast.framework.CastContextEventType.CAST_STATE_CHANGED, function () {
          try {
            if (typeof window.applyCastButtonState === 'function') {
              window.applyCastButtonState(document.getElementById('current-track-cast'));
            }
          } catch (e) {}
        });
      } catch (e) {}

      castReady = true;
      castInitError = null;
      return true;
    } catch (e) {
      castInitError = e && e.message ? e.message : 'Cast init failed';
      castReady = false;
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
    return context.requestSession();
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
    return state === SessionState.SESSION_STARTED || state === SessionState.SESSION_RESUMED;
  }

  function disconnect() {
    var context = getCastContext();
    if (!context) return false;
    try {
      context.endCurrentSession(true);
      return true;
    } catch (e) {
      return false;
    }
  }

  function getCoverUrl(track) {
    if (!track) return '';
    var id = track.id || track.identifier || track.albumId || '';
    if (!id) return '';
    return 'https://archive.org/services/img/' + encodeURIComponent(id);
  }

  function loadMediaFromTrack(track, audioUrl, currentTime, duration, options) {
    if (!isCastFrameworkReady()) return Promise.reject(new Error('Cast framework not available'));

    var url = audioUrl || (track && track.url) || '';
    if (!url) return Promise.reject(new Error('No audio URL to cast'));

    var force = options && options.force === true;
    if (!force && lastMediaUrl && lastMediaUrl === url) {
      return Promise.resolve();
    }
    lastMediaUrl = url;

    var title = (track && track.title) ? String(track.title) : 'Track';
    var artist = (track && track.creator) ? String(track.creator) : '';
    var album = (track && (track.albumTitle || track.album)) ? String(track.albumTitle || track.album) : '';
    var trackNumber = (track && typeof track.trackIndex === 'number' && isFinite(track.trackIndex)) ? (track.trackIndex + 1) : null;
    var totalTracks = (track && typeof track.totalTracks === 'number' && isFinite(track.totalTracks)) ? track.totalTracks : null;
    var artUrl = getCoverUrl(track);
    var durationSeconds = (typeof duration === 'number' && isFinite(duration) && duration > 0) ? duration : null;

    var mediaInfo = new window.chrome.cast.media.MediaInfo(url, 'audio/mpeg');
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

    return session.loadMedia(request);
  }

  function onGCastApiAvailable(isAvailable) {
    if (!isAvailable) return;
    initCastFramework();
  }

  function updateCastUi(state, session) {
    var SessionState = window.cast && window.cast.framework ? window.cast.framework.SessionState : null;
    if (!SessionState) return;
    var active = state === SessionState.SESSION_STARTED || state === SessionState.SESSION_RESUMED;
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

  if (isCastFrameworkReady()) {
    initCastFramework();
    try {
      var ctx = getCastContext();
      var st = ctx ? ctx.getSessionState() : null;
      updateCastUi(st, ctx ? ctx.getCurrentSession() : null);
      ensureRemotePlayer();
    } catch (e) {}
  }

  window.CastManager = {
    isReady: function () { return castReady; },
    getInitError: function () { return castInitError; },
    getCastState: getCastState,
    init: initCastFramework,
    requestSession: requestSession,
    isSessionActive: isSessionActive,
    disconnect: disconnect,
    loadMediaFromTrack: loadMediaFromTrack
  };
})();
