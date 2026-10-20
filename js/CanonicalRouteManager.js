(function (window) {
  'use strict';

  const CANONICAL_ORIGIN = 'https://www.resonateplayer.com';

  class CanonicalRouteManager {
    constructor() {
      this.isHandlingPopState = false;
      window.addEventListener('popstate', event => {
        return this.handlePopState(event);
      });
    }

    createSlug(value) {
      return String(value || 'track')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'track';
    }

    setCanonicalUrl(trackSlug) {
      const track = window.state && window.state.currentTrack
        ? window.state.currentTrack
        : {};
      const trackTitle = String(track.title || track.name || trackSlug || 'Track').trim();
      const slug = this.createSlug(trackSlug || trackTitle);
      const canonicalUrl = new URL(`/track/${slug}`, CANONICAL_ORIGIN).href;
      const browserUrl = window.location.origin === CANONICAL_ORIGIN
        ? canonicalUrl
        : new URL(`/track/${slug}`, window.location.origin).href;

      let canonicalLink = window.document.querySelector('link[rel="canonical"]');
      if (!canonicalLink) {
        canonicalLink = window.document.createElement('link');
        canonicalLink.setAttribute('rel', 'canonical');
        window.document.head.appendChild(canonicalLink);
      }
      canonicalLink.setAttribute('href', canonicalUrl);

      const trackId = String(track.trackId || track.id || track.albumId || trackSlug || slug);
      const albumId = String(track.albumId || track.id || trackId);
      const trackIndex = Number.isInteger(track.trackIndex) ? track.trackIndex : null;
      const routeState = { trackId, albumId, trackIndex };

      if (this.isHandlingPopState) {
        window.history.replaceState(routeState, trackTitle, browserUrl);
      } else {
        window.history.pushState(routeState, trackTitle, browserUrl);
      }

      return canonicalUrl;
    }

    async handlePopState(event) {
      const routeState = event && event.state;
      if (!routeState || !routeState.trackId) return;

      this.isHandlingPopState = true;
      try {
        if (typeof window.playSharedContent !== 'function') {
          throw new Error('Cannot restore track: shared playback is unavailable');
        }
        await window.playSharedContent(
          routeState.albumId || routeState.trackId,
          Number.isInteger(routeState.trackIndex) ? routeState.trackIndex : null
        );
      } catch (error) {
        if (window.logger && typeof window.logger.error === 'function') {
          window.logger.error({ message: 'Could not restore track from browser history', error }, 'PLAYBACK');
        } else {
          console.error('Could not restore track from browser history:', error);
        }
      } finally {
        this.isHandlingPopState = false;
      }
    }
  }

  window.CanonicalRouteManager = new CanonicalRouteManager();
})(window);
