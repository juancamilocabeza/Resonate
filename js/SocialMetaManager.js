(function (window) {
  'use strict';

  function normalizeString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function getDurationSeconds(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return String(Math.floor(value));
    }

    const duration = normalizeString(value);
    if (!duration) return '';
    if (/^\d+(?:\.\d+)?$/.test(duration)) return String(Math.floor(Number(duration)));

    const parts = duration.split(':').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      return String(Math.floor(parts[0] * 3600 + parts[1] * 60 + parts[2]));
    }
    if (parts.length === 2 && parts.every(Number.isFinite)) {
      return String(Math.floor(parts[0] * 60 + parts[1]));
    }
    return '';
  }

  function getAudioType(track, audioUrl) {
    const declaredType = normalizeString(track.mimeType || track.encodingFormat || track.type).toLowerCase();
    if (declaredType === 'audio/opus' || declaredType.includes('opus')) return 'audio/opus';

    try {
      if (/\.opus(?:$|[?#])/i.test(new URL(audioUrl).pathname)) return 'audio/opus';
    } catch {}
    return 'audio/mpeg';
  }

  function getImageUrl(track, identifier) {
    const artwork = track.artwork || track.coverArt || track.coverUrl || track.cover || track.image || track.thumbnail;
    if (typeof artwork === 'string' && artwork.trim()) return artwork.trim();
    if (Array.isArray(artwork)) {
      const image = artwork.find(item => item && typeof item.src === 'string' && item.src.trim());
      if (image) return image.src.trim();
    }
    if (artwork && typeof artwork.src === 'string' && artwork.src.trim()) return artwork.src.trim();

    if (window.CoverManager && typeof window.CoverManager.getCoverUrl === 'function' && identifier) {
      return window.CoverManager.getCoverUrl(identifier) || '';
    }
    return identifier ? `https://archive.org/services/img/${encodeURIComponent(identifier)}` : '';
  }

  class SocialMetaManager {
    setMeta(attribute, key, content) {
      if (!window.document || !window.document.head) return;

      let meta = window.document.querySelector(`meta[${attribute}="${key}"]`);
      if (!content) {
        if (meta && meta.parentNode) meta.parentNode.removeChild(meta);
        return;
      }
      if (!meta) {
        meta = window.document.createElement('meta');
        meta.setAttribute(attribute, key);
        window.document.head.appendChild(meta);
      }
      meta.setAttribute('content', content);
    }

    updateOpenGraph(track) {
      if (!track || !window.document || !window.document.head) return;

      const title = normalizeString(track.title || track.name) || 'Track';
      const artist = normalizeString(track.creator || track.artist);
      const displayTitle = artist ? `${title} - ${artist}` : title;
      const albumDescription = normalizeString(track.albumDescription || track.description || track.artistDescription);
      const description = albumDescription || (artist
        ? `Listen to "${title}" by ${artist} on Resonate Player.`
        : `Listen to "${title}" on Resonate Player.`);
      const identifier = normalizeString(track.albumId || track.id || track.identifier);
      const image = getImageUrl(track, identifier);
      const audioUrl = normalizeString(track.url || track.audioUrl);
      const duration = getDurationSeconds(track.duration || track.length || track.trackDuration);

      this.setMeta('property', 'og:title', displayTitle);
      this.setMeta('property', 'og:description', description);
      this.setMeta('property', 'og:type', 'music.song');
      this.setMeta('property', 'og:image', image);
      this.setMeta('property', 'og:image:alt', `${displayTitle} album cover`);
      this.setMeta('property', 'og:image:width', '1200');
      this.setMeta('property', 'og:image:height', '630');
      this.setMeta('property', 'og:audio', audioUrl);
      this.setMeta('property', 'og:audio:type', audioUrl ? getAudioType(track, audioUrl) : '');
      this.setMeta('property', 'music:duration', duration);
      this.setMeta('property', 'twitter:card', 'summary_large_image');
      this.setMeta('property', 'twitter:title', displayTitle);
      this.setMeta('property', 'twitter:description', description);
      this.setMeta('property', 'twitter:image', image);
    }
  }

  window.SocialMetaManager = new SocialMetaManager();
})(window);
