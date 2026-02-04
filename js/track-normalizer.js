(function(window) {
  'use strict';

  function canonicalizeUrl(value) {
    if (!value) return '';
    try {
      return new URL(String(value), window.location.href).href;
    } catch {
      return String(value);
    }
  }

  function normalizeString(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  function toNumber(value) {
    if (value === null || value === undefined) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function resolveTrackId(track, albumId) {
    if (!track || typeof track !== 'object') return '';
    if (track.trackId) return normalizeString(track.trackId);

    const albumKey = normalizeString(albumId || track.albumId || track.id || track.album_id);
    const fileName = normalizeString(track.fileName || track.filename || track.file || '');
    if (albumKey && fileName) return `${albumKey}:${fileName}`;

    const trackNumber = toNumber(track.trackNumber);
    if (albumKey && trackNumber !== null && trackNumber > 0) {
      return `${albumKey}:#${trackNumber}`;
    }

    const url = normalizeString(track.url);
    if (url) return `url:${canonicalizeUrl(url)}`;

    const title = normalizeString(track.title);
    if (albumKey && title) return `${albumKey}:${title}`;

    return normalizeString(track.id || '');
  }

  function normalizeTrack(track, opts = {}) {
    if (!track || typeof track !== 'object') return track;

    const normalized = { ...track };
    const albumId = normalizeString(opts.albumId || normalized.albumId || normalized.id || normalized.album_id);
    const albumTitle = normalizeString(opts.albumTitle || normalized.album || normalized.albumTitle || '');
    const creator = normalizeString(opts.creator || normalized.creator || normalized.artist || '');

    const parseDurationSeconds = (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      const raw = String(value).trim();
      if (!raw) return null;
      if (/^\d+(\.\d+)?$/.test(raw)) {
        const num = Number(raw);
        return Number.isFinite(num) ? num : null;
      }
      const parts = raw.split(':').map(p => Number(p));
      if (!parts.length || parts.some(p => !Number.isFinite(p))) return null;
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return null;
    };

    if (!normalized.albumId && albumId) normalized.albumId = albumId;
    if (!normalized.id && albumId) normalized.id = albumId;
    if (!normalized.album && albumTitle) normalized.album = albumTitle;
    if (!normalized.albumTitle && albumTitle) normalized.albumTitle = albumTitle;
    if (!normalized.creator && creator) normalized.creator = creator;

    if (normalized.trackIndex === null || normalized.trackIndex === undefined) {
      if (typeof opts.trackIndex === 'number' && Number.isFinite(opts.trackIndex)) {
        normalized.trackIndex = opts.trackIndex;
      }
    }

    if (normalized.totalTracks === null || normalized.totalTracks === undefined) {
      if (typeof opts.totalTracks === 'number' && Number.isFinite(opts.totalTracks)) {
        normalized.totalTracks = opts.totalTracks;
      }
    }

    if (typeof normalized.isAlbumTrack !== 'boolean') {
      const total = typeof normalized.totalTracks === 'number' ? normalized.totalTracks : null;
      normalized.isAlbumTrack = !!(total && total > 1);
    }

    if (!normalized.trackId) {
      normalized.trackId = resolveTrackId(normalized, albumId);
    }

    const durationRaw = (normalized.duration !== undefined && normalized.duration !== null)
      ? normalized.duration
      : (normalized.length !== undefined && normalized.length !== null ? normalized.length : null);
    const durationSeconds = parseDurationSeconds(durationRaw);
    if (durationSeconds !== null) {
      normalized.duration = durationSeconds;
    }

    return normalized;
  }

  function normalizeTrackList(tracks, opts = {}) {
    if (!Array.isArray(tracks)) return [];
    const total = Number.isFinite(opts.totalTracks) ? opts.totalTracks : tracks.length;
    return tracks
      .map((track, index) => normalizeTrack(track, {
        ...opts,
        trackIndex: (track && (track.trackIndex !== null && track.trackIndex !== undefined)) ? track.trackIndex : index,
        totalTracks: (track && (track.totalTracks !== null && track.totalTracks !== undefined)) ? track.totalTracks : total
      }))
      .filter(track => track && track.url);
  }

  function getTrackKey(track) {
    if (!track || typeof track !== 'object') return '';
    return normalizeString(track.trackId || track.url || track.id || '');
  }

  window.TrackNormalizer = {
    canonicalizeUrl,
    normalizeTrack,
    normalizeTrackList,
    getTrackKey
  };
})(window);
