(function(window) {
  'use strict';

  const TRACKS_CACHE = new Map();
  const IN_FLIGHT = new Map();
  const DEFAULT_TTL_MS = 10 * 60 * 1000;
  const UNAVAILABLE_METADATA_KEY = 'resonate_archive_metadata_unavailable_v1';
  const UNAVAILABLE_METADATA_TTL_MS = 24 * 60 * 60 * 1000;

  function nowMs() {
    return Date.now();
  }

  function loadUnavailableMetadataMap() {
    try {
      const raw = localStorage.getItem(UNAVAILABLE_METADATA_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};

      const next = {};
      const cutoff = nowMs() - UNAVAILABLE_METADATA_TTL_MS;
      for (const [albumId, ts] of Object.entries(parsed)) {
        const numericTs = Number(ts);
        if (Number.isFinite(numericTs) && numericTs >= cutoff) {
          next[String(albumId)] = numericTs;
        }
      }

      if (Object.keys(next).length !== Object.keys(parsed).length) {
        try {
          localStorage.setItem(UNAVAILABLE_METADATA_KEY, JSON.stringify(next));
        } catch {}
      }

      return next;
    } catch {
      return {};
    }
  }

  function saveUnavailableMetadataMap(map) {
    try {
      const entries = Object.entries(map || {});
      if (!entries.length) {
        localStorage.removeItem(UNAVAILABLE_METADATA_KEY);
        return;
      }
      localStorage.setItem(UNAVAILABLE_METADATA_KEY, JSON.stringify(map));
    } catch {}
  }

  function isMetadataUnavailable(albumId) {
    if (!albumId) return false;
    const map = loadUnavailableMetadataMap();
    const ts = Number(map[String(albumId)]);
    return Number.isFinite(ts) && (nowMs() - ts) < UNAVAILABLE_METADATA_TTL_MS;
  }

  function markMetadataUnavailable(albumId) {
    if (!albumId) return;
    const map = loadUnavailableMetadataMap();
    map[String(albumId)] = nowMs();
    saveUnavailableMetadataMap(map);
  }

  function clearMetadataUnavailable(albumId) {
    if (!albumId) return;
    const map = loadUnavailableMetadataMap();
    if (!(String(albumId) in map)) return;
    delete map[String(albumId)];
    saveUnavailableMetadataMap(map);
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

    const albumKey = String(albumId);
    if (isMetadataUnavailable(albumKey)) {
      return [];
    }
    if (IN_FLIGHT.has(albumKey)) {
      return IN_FLIGHT.get(albumKey);
    }

    const promise = (async () => {
      if (typeof window.fetchOptimizedPlayableFiles !== 'function') return [];
      try {
        const files = await window.fetchOptimizedPlayableFiles(albumId, options);
        clearMetadataUnavailable(albumKey);
        const normalized = normalizeAlbumTracks(albumId, files, {
          albumTitle: options.albumTitle || (files && files[0] && files[0].album) || ''
        });
        setCache(albumId, normalized, { source: 'fetch' });
        return normalized;
      } catch (error) {
        const status = Number(error && (error.status || error.httpStatus));
        if (status === 404) {
          markMetadataUnavailable(albumKey);
          return [];
        }
        throw error;
      }
    })();

    IN_FLIGHT.set(albumKey, promise);
    try {
      return await promise;
    } finally {
      IN_FLIGHT.delete(albumKey);
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
          try {
            const fetched = await fetchAlbumTracks(albumId, options);
            if (Array.isArray(fetched) && fetched.length > normalized.length) {
              return fetched;
            }
          } catch {
            // Network or API failure: fall back to the already-normalized seed tracks.
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
    try {
      return await fetchAlbumTracks(albumId, options);
    } catch {
      return [];
    }
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
