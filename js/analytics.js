// Resonate Analytics — thin wrapper over Google Analytics 4 (gtag)
// All tracking is best-effort and never throws to the caller.
// On localhost / file:// the gtag function is not loaded, so every call is
// silently skipped.

(function () {
  'use strict';

  /**
   * Send an event to GA4.  Always safe to call; does nothing when gtag is not
   * available (e.g. localhost or ad-blocked).
   *
   * @param {string} eventName   - GA4 event name (snake_case)
   * @param {Object} [params]    - Optional event parameters
   */
  function trackEvent(eventName, params) {
    try {
      if (typeof window.gtag !== 'function') return;
      window.gtag('event', eventName, params || {});
    } catch (_) {
      // best-effort — never surface analytics errors to the user
    }
  }

  /**
   * Called when a track begins playing.
   *
   * @param {{ title?: string, creator?: string, id?: string, duration?: number }} track
   */
  function trackPlay(track) {
    trackEvent('track_play', {
      track_title:  (track && track.title)   || undefined,
      track_artist: (track && track.creator) || undefined,
      track_id:     (track && track.id)      || undefined,
      track_duration_s: (track && typeof track.duration === 'number' && isFinite(track.duration))
        ? Math.round(track.duration)
        : undefined
    });
  }

  /**
   * Called when the user manually pauses playback.
   *
   * @param {{ title?: string, creator?: string, id?: string, currentTime?: number }} track
   */
  function trackPause(track) {
    trackEvent('track_pause', {
      track_title:   (track && track.title)   || undefined,
      track_artist:  (track && track.creator) || undefined,
      track_id:      (track && track.id)      || undefined,
      playback_time_s: (track && typeof track.currentTime === 'number' && isFinite(track.currentTime))
        ? Math.round(track.currentTime)
        : undefined
    });
  }

  /**
   * Called when the user skips to the next track.
   */
  function trackSkipNext() {
    trackEvent('track_skip_next');
  }

  /**
   * Called when the user goes back to the previous track.
   */
  function trackSkipPrev() {
    trackEvent('track_skip_prev');
  }

  /**
   * Called when the user submits a search query.
   * Uses the GA4 built-in `search` event name so the query shows up in the
   * standard "Site Search" report.
   *
   * @param {string} query
   */
  function trackSearch(query) {
    if (!query || !query.trim()) return;
    trackEvent('search', { search_term: query.trim() });
  }

  /**
   * Called when the user shares a track or album.
   * Uses the GA4 built-in `share` event name.
   *
   * @param {{ method?: string, content_type?: string, item_id?: string }} params
   */
  function trackShare(params) {
    trackEvent('share', {
      method:       (params && params.method)       || 'web_share',
      content_type: (params && params.content_type) || 'track',
      item_id:      (params && params.item_id)      || undefined
    });
  }

  // Expose on window so that other modules (loaded without ES module bundler)
  // can call these helpers directly.
  window.ResonateAnalytics = {
    trackEvent,
    trackPlay,
    trackPause,
    trackSkipNext,
    trackSkipPrev,
    trackSearch,
    trackShare
  };
})();
