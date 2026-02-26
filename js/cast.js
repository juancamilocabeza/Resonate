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
  var lastRemoteAdvanceAt = 0;
  var lastRemoteContentId = '';
  var lastMediaSessionId = '';
  var castPlaybackMonitorId = null;

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
            startCastPlaybackMonitor();
          } else {
            stopCastPlaybackMonitor();
          }
          updateLocalTransportState();
        } catch (e) {}
      });

      remoteController.addEventListener(window.cast.framework.RemotePlayerEventType.PLAYER_STATE_CHANGED, function () {
        try {
          if (remotePlayer && !remotePlayer.isPaused) {
            enforceLocalPause();
          }
          updateLocalTransportState();
          maybeAdvanceOnRemoteEnd();
          maybeAdvanceNearRemoteEnd();
        } catch (e) {}
      });

      remoteController.addEventListener(window.cast.framework.RemotePlayerEventType.MEDIA_INFO_CHANGED, function () {
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
        } catch (e) {}
      });

      remoteController.addEventListener(window.cast.framework.RemotePlayerEventType.CURRENT_TIME_CHANGED, function () {
        try {
          if (typeof window.updateMediaPositionState === 'function') {
            window.updateMediaPositionState();
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  function getRemotePositionState() {
    try {
      if (!remotePlayer || !remotePlayer.isConnected) return null;
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
    try {
      if (!session || typeof session.getMediaSession !== 'function') return;
      var mediaSession = session.getMediaSession();
      if (!mediaSession) return;
      var mediaSessionId = mediaSession.mediaSessionId ? String(mediaSession.mediaSessionId) : '';
      if (mediaSessionId && mediaSessionId === lastMediaSessionId) return;
      if (mediaSessionId) lastMediaSessionId = mediaSessionId;

      mediaSession.addUpdateListener(function (isAlive) {
        try {
          if (!isAlive) return;
          if (mediaSession.media) {
            syncLocalTrackFromRemoteMedia(mediaSession.media, false);
          }
          maybeAdvanceOnMediaSession(mediaSession);
        } catch (e) {}
      });
    } catch (e) {}
  }

  function updateLocalTransportState() {
    try {
      if (!remotePlayer) return;
      var playBtn = (window.elements && window.elements.playBtn) ? window.elements.playBtn : document.getElementById('play-btn');
      if (!playBtn) return;
      var isPlaying = !remotePlayer.isPaused;
      playBtn.textContent = isPlaying ? '⏸' : '▶';
      playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
      if (window.mediaSessionManager && window.mediaSessionManager.isSupported) {
        window.mediaSessionManager.updatePlaybackState(isPlaying ? 'playing' : 'paused');
      }
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
            attachMediaSessionListeners(session);
            if (state === String(window.cast.framework.SessionState.SESSION_STARTED)
              || state === String(window.cast.framework.SessionState.SESSION_RESUMED)) {
              startCastPlaybackMonitor();
            } else if (state === String(window.cast.framework.SessionState.SESSION_ENDED)) {
              stopCastPlaybackMonitor();
            }
            try {
              if (remotePlayer && remotePlayer.mediaInfo) {
                syncLocalTrackFromRemoteMedia(remotePlayer.mediaInfo, true);
              }
            } catch (e) {}
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
    } catch (e) {
      return false;
    }
  }

  function skipBy(deltaSeconds) {
    try {
      var state = getRemotePositionState();
      if (!state) return false;
      return seekTo(state.position + Number(deltaSeconds || 0));
    } catch (e) {
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

    return session.loadMedia(request).then(function (result) {
      try {
        attachMediaSessionListeners(session);
      } catch (e) {}
      return result;
    });
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
      updateLocalTransportState();
    } catch (e) {}
  }

  window.CastManager = {
    isReady: function () { return castReady; },
    getInitError: function () { return castInitError; },
    getCastState: getCastState,
    getRemotePositionState: getRemotePositionState,
    init: initCastFramework,
    requestSession: requestSession,
    isSessionActive: isSessionActive,
    disconnect: disconnect,
    togglePlayback: togglePlayback,
    seekTo: seekTo,
    skipBy: skipBy,
    loadMediaFromTrack: loadMediaFromTrack
  };
})();
