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

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const CREATOR_NOISE_WORDS = new Set([
    'a',
    'an',
    'and',
    'by',
    'feat',
    'featuring',
    'ft',
    'music',
    'official',
    'records',
    'the',
    'topic'
  ]);

  function tokenizeCreatorMatch(value) {
    return normalizeString(value)
      .split(/[\s._\-–—:|/()[\]{}&+,!]+/)
      .map(token => token.replace(/^["'`]+|["'`]+$/g, ''))
      .filter(Boolean);
  }

  function buildFlexibleCreatorPattern(value) {
    const tokens = tokenizeCreatorMatch(value);
    if (!tokens.length) return escapeRegExp(normalizeString(value));
    return tokens.map(token => escapeRegExp(token)).join("[\\s._'’/-]*");
  }

  function segmentMatchesCreator(segment, creator) {
    const normalizedSegment = normalizeString(segment);
    const normalizedCreator = normalizeString(creator);
    if (!normalizedSegment || !normalizedCreator) return false;

    return getCreatorMatchVariants(normalizedCreator).some((variant) => {
      const creatorPattern = buildFlexibleCreatorPattern(variant);
      return new RegExp(`^${creatorPattern}$`, 'i').test(normalizedSegment);
    });
  }

  function getCreatorMatchVariants(creator) {
    const normalizedCreator = normalizeString(creator);
    if (!normalizedCreator) return [];

    const tokens = tokenizeCreatorMatch(normalizedCreator);
    const significantTokens = tokens.filter(token => !CREATOR_NOISE_WORDS.has(token.toLowerCase()));
    const variants = [];
    const seen = new Set();

    const addVariant = (value) => {
      const variant = normalizeString(value);
      if (!variant) return;
      const key = variant.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      variants.push(variant);
    };

    addVariant(normalizedCreator);

    if (significantTokens.length > 0) {
      addVariant(significantTokens.join(' '));
    }

    if (significantTokens.length >= 3) {
      addVariant(significantTokens.slice(0, significantTokens.length - 1).join(' '));
      addVariant(significantTokens.slice(1).join(' '));
    }

    if (significantTokens.length === 1 && significantTokens[0].length >= 4) {
      addVariant(significantTokens[0]);
    }

    return variants;
  }

  function cleanupTrackTitle(value) {
    return normalizeString(value)
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([)\]])/g, '$1')
      .replace(/([([])\s+/g, '$1')
      .replace(/^\s*[-–—:|/]\s*/g, '')
      .replace(/\s*[-–—:|/]\s*$/g, '')
      .trim();
  }

  function stripCreatorFromTitle(title, creator) {
    const normalizedTitle = normalizeString(title);
    const normalizedCreator = normalizeString(creator);
    if (!normalizedTitle || !normalizedCreator) return normalizedTitle;

    const patterns = getCreatorMatchVariants(normalizedCreator).flatMap((variant) => {
      const creatorPattern = buildFlexibleCreatorPattern(variant);
      return [
        new RegExp(`^\\s*${creatorPattern}\\s*[-–—:|/]+\\s*`, 'i'),
        new RegExp(`\\s*[-–—:|/]+\\s*${creatorPattern}\\s*$`, 'i'),
        new RegExp(`^\\s*[([]\\s*(?:by\\s+)?${creatorPattern}\\s*[)]]\\s*`, 'i'),
        new RegExp(`\\s*[([]\\s*(?:by\\s+)?${creatorPattern}\\s*[)]]\\s*$`, 'i'),
        new RegExp(`\\s+by\\s+${creatorPattern}\\s*$`, 'i')
      ];
    });

    let cleanedTitle = normalizedTitle;
    let previousTitle = '';

    while (cleanedTitle && cleanedTitle !== previousTitle) {
      previousTitle = cleanedTitle;
      patterns.forEach((pattern) => {
        cleanedTitle = cleanedTitle.replace(pattern, ' ');
      });
      cleanedTitle = cleanupTrackTitle(cleanedTitle);
    }

    return cleanedTitle || normalizedTitle;
  }

  function stripCreatorSegmentFromAlbumTitle(title, creator) {
    const normalizedTitle = normalizeString(title);
    const normalizedCreator = normalizeString(creator);
    if (!normalizedTitle || !normalizedCreator) return normalizedTitle;

    const separator = normalizedTitle.includes(' — ') ? ' — ' : ' - ';
    const segments = normalizedTitle
      .split(/\s+[—-]\s+/)
      .map(segment => normalizeString(segment))
      .filter(Boolean);

    if (segments.length < 2) return normalizedTitle;

    const filteredSegments = segments.filter(segment => !segmentMatchesCreator(segment, normalizedCreator));
    if (!filteredSegments.length || filteredSegments.length === segments.length) return normalizedTitle;

    return cleanupTrackTitle(filteredSegments.join(separator));
  }

  function normalizeCreatorDisplay(value) {
    return normalizeString(value).replace(/\s*\([^)]*\)\s*$/g, '').trim();
  }

  function sanitizeDisplayTitle(title, creator, albumTitle) {
    const normalizedTitle = normalizeString(title);
    const normalizedAlbumTitle = normalizeString(albumTitle);
    const normalizedCreator = normalizeCreatorDisplay(creator);
    if (!normalizedTitle) return '';

    if (normalizedAlbumTitle) {
      const lowerTitle = normalizedTitle.toLowerCase();
      const albumPrefixes = [
        `${normalizedAlbumTitle} — `,
        `${normalizedAlbumTitle} - `
      ];
      const matchedPrefix = albumPrefixes.find(prefix => lowerTitle.startsWith(prefix.toLowerCase()));
      if (matchedPrefix) {
        const leftPart = normalizedTitle.slice(0, normalizedAlbumTitle.length).trim();
        const rightPart = normalizedTitle.slice(matchedPrefix.length).trim();
        const cleanedLeftPart = stripCreatorSegmentFromAlbumTitle(leftPart, normalizedCreator);
        const cleanedRightPart = stripCreatorFromTitle(rightPart, normalizedCreator);
        const resolvedLeftPart = cleanedLeftPart || leftPart;
        return cleanedRightPart ? `${resolvedLeftPart} — ${cleanedRightPart}` : resolvedLeftPart;
      }
    }

    return stripCreatorFromTitle(normalizedTitle, normalizedCreator);
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
    if (normalized.title) normalized.title = stripCreatorFromTitle(normalized.title, creator);

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
      : (normalized.length !== undefined && normalized.length !== null)
        ? normalized.length
        : (normalized.trackDuration !== undefined && normalized.trackDuration !== null)
          ? normalized.trackDuration
          : (normalized.track_duration !== undefined && normalized.track_duration !== null)
            ? normalized.track_duration
            : (normalized.runtime !== undefined && normalized.runtime !== null)
              ? normalized.runtime
              : (normalized.time !== undefined && normalized.time !== null)
                ? normalized.time
                : (normalized.playtime !== undefined && normalized.playtime !== null)
                  ? normalized.playtime
                  : null;
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
    getTrackKey,
    stripCreatorFromTitle,
    sanitizeDisplayTitle
  };
})(window);
