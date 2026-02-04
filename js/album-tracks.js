(function(window) {
  'use strict';

  const TRACKS_CACHE = new Map();
  const IN_FLIGHT = new Map();
  const DEFAULT_TTL_MS = 10 * 60 * 1000;

  function nowMs() {
    return Date.now();
  }

  function getTrackKey(track) {
    try {
      if (window.TrackNormalizer && typeof window.TrackNormalizer.getTrackKey === 'function') {
        return window.TrackNormalizer.getTrackKey(track);
      }
    } catch {}
    if (!track || typeof track !== 'object') return '';
    return String(track.trackId || track.url || track.id || '');
  }

  function normalizeAlbumTracks(albumId, tracks, opts = {}) {
    if (!Array.isArray(tracks)) return [];
    let list = tracks.slice();

    try {
      if (window.TrackNormalizer && typeof window.TrackNormalizer.normalizeTrackList === 'function') {
        const albumTitle = opts.albumTitle || (list[0] && list[0].album) || '';
        list = window.TrackNormalizer.normalizeTrackList(list, {
          albumId,
          albumTitle,
          totalTracks: list.length
        });
      }
    } catch {}

    const seen = new Set();
    const unique = [];
    for (const track of list) {
      const key = getTrackKey(track);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(track);
    }

    unique.sort((a, b) => {
      const an = Number.isFinite(a && a.trackNumber) ? a.trackNumber : null;
      const bn = Number.isFinite(b && b.trackNumber) ? b.trackNumber : null;
      if (an !== null && bn !== null) return an - bn;
      const ai = Number.isFinite(a && a.trackIndex) ? a.trackIndex : null;
      const bi = Number.isFinite(b && b.trackIndex) ? b.trackIndex : null;
      if (ai !== null && bi !== null) return ai - bi;
      return String(a && a.title ? a.title : '').localeCompare(String(b && b.title ? b.title : ''));
    });

    return unique;
  }

  function setCache(albumId, tracks, { source = 'fetch' } = {}) {
    if (!albumId) return;
    TRACKS_CACHE.set(String(albumId), {
      tracks,
      source,
      updatedAt: nowMs()
    });
  }

  function getCache(albumId, { maxAgeMs = DEFAULT_TTL_MS } = {}) {
    if (!albumId) return null;
    const entry = TRACKS_CACHE.get(String(albumId));
    if (!entry) return null;
    if (typeof maxAgeMs === 'number' && maxAgeMs > 0) {
      if (nowMs() - entry.updatedAt > maxAgeMs) return null;
    }
    return entry;
  }

  async function fetchAlbumTracks(albumId, options = {}) {
    if (!albumId) return [];

    if (IN_FLIGHT.has(albumId)) {
      return IN_FLIGHT.get(albumId);
    }

    const promise = (async () => {
      if (typeof window.fetchOptimizedPlayableFiles !== 'function') return [];
      const files = await window.fetchOptimizedPlayableFiles(albumId, options);
      const normalized = normalizeAlbumTracks(albumId, files, {
        albumTitle: options.albumTitle || (files && files[0] && files[0].album) || ''
      });
      setCache(albumId, normalized, { source: 'fetch' });
      return normalized;
    })();

    IN_FLIGHT.set(albumId, promise);
    try {
      return await promise;
    } finally {
      IN_FLIGHT.delete(albumId);
    }
  }

  async function getTracks(albumId, options = {}) {
    if (!albumId) return [];

    const preferCache = options.preferCache !== false;
    const allowFetch = options.allowFetch !== false;
    const preferFullAlbum = options.preferFullAlbum !== false;
    const sourceTracks = Array.isArray(options.sourceTracks) ? options.sourceTracks : null;
    const albumTitle = options.albumTitle || '';

    if (sourceTracks && sourceTracks.length > 0) {
      const normalized = normalizeAlbumTracks(albumId, sourceTracks, { albumTitle });
      if (normalized.length > 0) {
        setCache(albumId, normalized, { source: options.source || 'seed' });
        if (!preferFullAlbum) return normalized;

        const cached = preferCache ? getCache(albumId, { maxAgeMs: options.maxAgeMs }) : null;
        if (cached && Array.isArray(cached.tracks) && cached.tracks.length > normalized.length) {
          return cached.tracks;
        }

        if (allowFetch) {
          const fetched = await fetchAlbumTracks(albumId, options);
          if (Array.isArray(fetched) && fetched.length > normalized.length) {
            return fetched;
          }
        }

        return normalized;
      }
    }

    if (preferCache) {
      const entry = getCache(albumId, { maxAgeMs: options.maxAgeMs });
      if (entry && Array.isArray(entry.tracks) && entry.tracks.length > 0) {
        return entry.tracks;
      }
    }

    if (!allowFetch) return [];
    return fetchAlbumTracks(albumId, options);
  }

  function seedAlbumTracks(albumId, tracks, options = {}) {
    if (!albumId || !Array.isArray(tracks)) return [];
    const normalized = normalizeAlbumTracks(albumId, tracks, { albumTitle: options.albumTitle });
    if (normalized.length > 0) {
      setCache(albumId, normalized, { source: options.source || 'seed' });
    }
    return normalized;
  }

  function clearAlbumTracks(albumId = null) {
    if (!albumId) {
      TRACKS_CACHE.clear();
      return;
    }
    TRACKS_CACHE.delete(String(albumId));
  }

  window.AlbumTracks = {
    getTracks,
    seedAlbumTracks,
    normalizeAlbumTracks,
    clearAlbumTracks
  };
})(window);
