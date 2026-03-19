/**
 * archive-monitor.js
 * Monitors archive.org availability and provides UX for when it is unreachable.
 * Exposes window.archiveMonitor for integration with the rest of the app.
 */
(function () {
  'use strict';

  if (window.__resonateArchiveMonitorLoaded) return;
  window.__resonateArchiveMonitorLoaded = true;

  // ── Config ──────────────────────────────────────────────────────────────────
  var FAILURES_THRESHOLD = 2;          // failures before marking archive down
  var RETRY_INTERVAL_MS  = 60 * 1000; // retry check every 60 s while down
  var CHECK_TIMEOUT_MS   = 8000;       // timeout for availability check
  var PROBE_PATH         = '/api/archive/advancedsearch?q=test+music&rows=1&output=json';
  var PROBE_FALLBACK     = 'https://archive.org/advancedsearch.php?q=test+music&rows=1&output=json';
  var BANNER_ID          = 'archive-maintenance-banner';
  var STORAGE_KEY        = 'resonate_archive_dismissed_at';
  var DISMISS_COOLDOWN   = 5 * 60 * 1000; // 5 min cooldown before banner can re-appear after dismiss

  // ── State ───────────────────────────────────────────────────────────────────
  var consecutiveFailures = 0;
  var archiveDown         = false;
  var retryTimer          = null;
  var retryInProgress     = false;
  var lastCachedCount     = 0;

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function isOnline() {
    if (window.state && typeof window.state.networkOnline === 'boolean') {
      return window.state.networkOnline;
    }
    return navigator.onLine !== false;
  }

  function dispatchStatusEvent(isDown) {
    try {
      var evt = new CustomEvent('archiveStatusChange', { detail: { down: isDown } });
      window.dispatchEvent(evt);
    } catch (e) {
      // ignore
    }
  }

  // ── Availability probe ───────────────────────────────────────────────────────
  function probeArchive() {
    if (retryInProgress) return Promise.resolve(false);
    if (!isOnline()) return Promise.resolve(false);

    retryInProgress = true;

    var controller;
    var timerId;
    try {
      controller = new AbortController();
      timerId = setTimeout(function () {
        try { controller.abort(); } catch (e) { /* ignore */ }
      }, CHECK_TIMEOUT_MS);
    } catch (e) {
      retryInProgress = false;
      return Promise.resolve(false);
    }

    // Try proxy endpoint first; fall back to direct
    var urls = [PROBE_PATH, PROBE_FALLBACK];
    var idx = 0;

    function tryNext() {
      if (idx >= urls.length) {
        clearTimeout(timerId);
        retryInProgress = false;
        return Promise.resolve(false);
      }
      var url = urls[idx++];
      return fetch(url, { signal: controller.signal, method: 'GET', cache: 'no-store' })
        .then(function (resp) {
          clearTimeout(timerId);
          retryInProgress = false;
          return resp && (resp.ok || resp.status < 500);
        })
        .catch(function (err) {
          if (err && err.name === 'AbortError') {
            clearTimeout(timerId);
            retryInProgress = false;
            return false;
          }
          return tryNext();
        });
    }

    return tryNext().catch(function () {
      clearTimeout(timerId);
      retryInProgress = false;
      return false;
    });
  }

  // ── Banner & UI ──────────────────────────────────────────────────────────────
  function getBanner() {
    return document.getElementById(BANNER_ID);
  }

  function wasDismissedRecently() {
    try {
      var ts = parseInt(localStorage.getItem(STORAGE_KEY), 10) || 0;
      return ts > 0 && (Date.now() - ts) < DISMISS_COOLDOWN;
    } catch (e) {
      return false;
    }
  }

  function saveDismissTime() {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch (e) { /* ignore */ }
  }

  function clearDismissTime() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* ignore */ }
  }

  function getCachedCount(callback) {
    try {
      var cache = window.audioCache;
      if (cache && typeof cache.getAllMetadata === 'function') {
        cache.getAllMetadata().then(function (meta) {
          callback(Array.isArray(meta) ? meta.length : 0);
        }).catch(function () { callback(0); });
      } else {
        callback(0);
      }
    } catch (e) {
      callback(0);
    }
  }

  function updateBannerCacheCount(count) {
    lastCachedCount = count;
    var banner = getBanner();
    if (!banner) return;
    var countEl = banner.querySelector('.archive-banner-cache-count');
    if (countEl) {
      countEl.textContent = count > 0
        ? (count + ' track' + (count === 1 ? '' : 's') + ' available')
        : 'No cached tracks';
    }
    var playBtn = banner.querySelector('.archive-banner-play-btn');
    if (playBtn) {
      playBtn.disabled = count === 0;
      playBtn.title = count === 0 ? 'No cached tracks available' : 'Play a random cached track';
    }
  }

  function showBanner() {
    var banner = getBanner();
    if (!banner) return;
    if (wasDismissedRecently()) return;

    getCachedCount(function (count) {
      updateBannerCacheCount(count);
      banner.hidden = false;
      banner.setAttribute('aria-hidden', 'false');
      document.body.classList.add('archive-down');
    });
  }

  function hideBanner() {
    var banner = getBanner();
    if (!banner) return;
    banner.hidden = true;
    banner.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('archive-down');
  }

  function dismissBanner() {
    saveDismissTime();
    hideBanner();
  }

  // ── Random cached playback ────────────────────────────────────────────────────
  function playRandomCached() {
    try {
      var cache = window.audioCache;
      if (!cache || typeof cache.getAllMetadata !== 'function') {
        showBannerNotice('No cached tracks found.', 'error');
        return;
      }

      cache.getAllMetadata().then(function (meta) {
        var tracks = Array.isArray(meta) ? meta : [];

        // Prefer resonates/favorites; fall back to any cached track
        var resonateTracks = tracks.filter(function (t) {
          return t && (t.isFavorite || t.isResonte || t.context === 'resontes' || t.context === 'favorites');
        });
        var pool = resonateTracks.length > 0 ? resonateTracks : tracks;

        if (pool.length === 0) {
          showBannerNotice('No cached tracks available. Save some resonates first!', 'warning');
          return;
        }

        var pick = pool[Math.floor(Math.random() * pool.length)];
        if (pick && typeof window.playOfflineTrack === 'function') {
          window.playOfflineTrack(pick);
        } else if (pick) {
          // Fallback: call playAudioTrackOptimized if available
          var track = {
            url: pick.url,
            title: pick.title || 'Untitled',
            creator: pick.creator || 'Unknown',
            id: pick.url,
            isOffline: true
          };
          if (typeof window.playAudioTrackOptimized === 'function') {
            window.playAudioTrackOptimized(track, track.id);
          }
        }
      }).catch(function () {
        showBannerNotice('Could not load cached tracks.', 'error');
      });
    } catch (e) {
      // ignore
    }
  }

  function showBannerNotice(msg, type) {
    var banner = getBanner();
    if (!banner) return;
    var noticeEl = banner.querySelector('.archive-banner-notice');
    if (!noticeEl) return;
    noticeEl.textContent = msg;
    noticeEl.className = 'archive-banner-notice archive-banner-notice--' + (type || 'info');
    noticeEl.hidden = false;
    setTimeout(function () {
      noticeEl.hidden = true;
      noticeEl.textContent = '';
    }, 4000);
  }

  // ── Retry loop ───────────────────────────────────────────────────────────────
  function startRetryLoop() {
    stopRetryLoop();
    retryTimer = setInterval(function () {
      if (!archiveDown) { stopRetryLoop(); return; }
      if (!isOnline()) return;
      probeArchive().then(function (ok) {
        if (ok && archiveDown) {
          markArchiveUp();
        }
      });
    }, RETRY_INTERVAL_MS);
  }

  function stopRetryLoop() {
    if (retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
    }
  }

  // ── Core state transitions ───────────────────────────────────────────────────
  function markArchiveDown() {
    if (archiveDown) return; // already down
    archiveDown = true;
    consecutiveFailures = 0;
    dispatchStatusEvent(true);
    showBanner();
    startRetryLoop();
  }

  function markArchiveUp() {
    archiveDown = false;
    consecutiveFailures = 0;
    clearDismissTime();
    dispatchStatusEvent(false);
    hideBanner();
    stopRetryLoop();
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  /**
   * Call this when an archive.org fetch succeeds.
   */
  function reportSuccess() {
    consecutiveFailures = 0;
    if (archiveDown) {
      markArchiveUp();
    }
  }

  /**
   * Call this when an archive.org fetch fails (and the device is online).
   * Pass the error for context; abort errors are ignored.
   */
  function reportFailure(err) {
    // Ignore user-initiated aborts
    if (err && (err.name === 'AbortError' || String(err.message || '').includes('aborted'))) return;
    if (!isOnline()) return;
    consecutiveFailures++;
    if (!archiveDown && consecutiveFailures >= FAILURES_THRESHOLD) {
      // Confirm with a probe before showing the banner
      probeArchive().then(function (ok) {
        if (!ok) {
          markArchiveDown();
        } else {
          consecutiveFailures = 0;
        }
      });
    }
  }

  /**
   * Trigger a manual re-check (e.g. user presses "Check again").
   */
  function checkNow() {
    var banner = getBanner();
    var retryBtn = banner && banner.querySelector('.archive-banner-retry-btn');
    if (retryBtn) {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Checking…';
    }

    probeArchive().then(function (ok) {
      if (ok) {
        markArchiveUp();
      } else {
        if (retryBtn) {
          retryBtn.disabled = false;
          retryBtn.textContent = 'Check again';
        }
        showBannerNotice('archive.org is still unreachable.', 'warning');
      }
    });
  }

  window.archiveMonitor = {
    reportSuccess: reportSuccess,
    reportFailure: reportFailure,
    checkNow: checkNow,
    isDown: function () { return archiveDown; },
    playRandomCached: playRandomCached
  };

  // ── Banner wire-up (runs after DOM ready) ─────────────────────────────────────
  function wireBanner() {
    var banner = getBanner();
    if (!banner) return;

    var retryBtn = banner.querySelector('.archive-banner-retry-btn');
    var dismissBtn = banner.querySelector('.archive-banner-dismiss-btn');
    var playBtn = banner.querySelector('.archive-banner-play-btn');

    if (retryBtn) {
      retryBtn.addEventListener('click', function () {
        checkNow();
      });
    }

    if (dismissBtn) {
      dismissBtn.addEventListener('click', function () {
        dismissBanner();
      });
    }

    if (playBtn) {
      playBtn.addEventListener('click', function () {
        playRandomCached();
      });
    }

    // Update cache count when banner becomes visible
    var observer = new MutationObserver(function () {
      if (!banner.hidden) {
        getCachedCount(updateBannerCacheCount);
      }
    });
    observer.observe(banner, { attributes: true, attributeFilter: ['hidden'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireBanner, { once: true });
  } else {
    wireBanner();
  }

  // ── Hook into online/offline events ─────────────────────────────────────────
  window.addEventListener('online', function () {
    if (archiveDown) {
      // When connectivity resumes, probe again quickly
      setTimeout(function () {
        probeArchive().then(function (ok) {
          if (ok) markArchiveUp();
        });
      }, 2000);
    }
  });

  window.addEventListener('offline', function () {
    // If device goes offline, hide the archive banner (it's a different issue)
    hideBanner();
    stopRetryLoop();
  });

})();
