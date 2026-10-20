(function (window) {
  'use strict';

  const MIME_TYPES = {
    aac: 'audio/aac',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    oga: 'audio/ogg',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
    wav: 'audio/wav',
    webm: 'audio/webm'
  };

  function normalizeString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function toIsoDuration(value) {
    const duration = normalizeString(value);
    if (!duration) return '';
    if (/^P(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/i.test(duration)) {
      return duration;
    }

    let seconds;
    if (/^\d+(?:\.\d+)?$/.test(duration)) {
      seconds = Number(duration);
    } else {
      const parts = duration.split(':').map(Number);
      if (parts.length === 3 && parts.every(Number.isFinite)) {
        seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
      } else if (parts.length === 2 && parts.every(Number.isFinite)) {
        seconds = parts[0] * 60 + parts[1];
      } else {
        return '';
      }
    }
    if (!Number.isFinite(seconds) || seconds < 0) return '';

    const wholeSeconds = Math.floor(seconds);
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const remainder = wholeSeconds % 60;
    const time = [hours ? `${hours}H` : '', minutes ? `${minutes}M` : '', remainder || (!hours && !minutes) ? `${remainder}S` : ''].join('');
    return `PT${time}`;
  }

  function getAudioFormat(track, audioUrl) {
    const declaredFormat = normalizeString(track.encodingFormat || track.mimeType || track.type || track.format);
    if (declaredFormat) {
      const normalizedFormat = declaredFormat.toLowerCase();
      const extension = normalizedFormat.match(/\b(mp3|aac|flac|m4a|oga|ogg|opus|wav|webm)\b/);
      if (extension) return MIME_TYPES[extension[1]];
      if (normalizedFormat.startsWith('audio/')) return declaredFormat;
    }

    try {
      const extension = new URL(audioUrl).pathname.match(/\.([^.]+)$/);
      return extension ? MIME_TYPES[extension[1].toLowerCase()] || '' : '';
    } catch {
      return '';
    }
  }

  function getImageUrl(track, albumId) {
    const artwork = track.artwork || track.coverArt || track.coverUrl || track.cover || track.image || track.thumbnail;
    if (typeof artwork === 'string' && artwork.trim()) return artwork.trim();
    if (artwork && typeof artwork.src === 'string' && artwork.src.trim()) return artwork.src.trim();

    if (window.CoverManager && typeof window.CoverManager.getCoverUrl === 'function' && albumId) {
      return window.CoverManager.getCoverUrl(albumId) || '';
    }
    return albumId ? `https://archive.org/services/img/${encodeURIComponent(albumId)}` : '';
  }

  function updateTrackSchema(trackData) {
    if (!window.document || !window.document.head) return;

    let script = window.document.getElementById('schema-jsonld');
    const title = normalizeString(trackData && (trackData.title || trackData.name));
    if (!title) {
      if (script && script.parentNode) script.parentNode.removeChild(script);
      return;
    }

    if (!script) {
      script = window.document.createElement('script');
      script.id = 'schema-jsonld';
      script.type = 'application/ld+json';
    }

    const audioUrl = normalizeString(trackData.url || trackData.audioUrl);
    const albumName = normalizeString(trackData.albumTitle || trackData.albumName || trackData.album);
    const albumId = normalizeString(trackData.albumId || trackData.id || trackData.identifier);
    const artistName = normalizeString(trackData.creator || trackData.artist);
    const artistType = trackData.artistType === 'Person' ? 'Person' : 'MusicGroup';
    const duration = toIsoDuration(trackData.duration || trackData.length || trackData.trackDuration);
    const image = getImageUrl(trackData, albumId);
    const recording = {
      '@context': 'https://schema.org',
      '@type': 'MusicRecording',
      name: title
    };

    if (artistName) recording.byArtist = { '@type': artistType, name: artistName };
    if (albumName) {
      recording.inAlbum = { '@type': 'MusicAlbum', name: albumName };
      if (image) recording.inAlbum.image = image;
    }
    if (duration) recording.duration = duration;
    if (audioUrl) {
      const audio = { '@type': 'AudioObject', contentUrl: audioUrl };
      const encodingFormat = getAudioFormat(trackData, audioUrl);
      if (encodingFormat) audio.encodingFormat = encodingFormat;
      recording.audio = audio;
    }

    script.textContent = JSON.stringify(recording).replace(/</g, '\\u003c');
    if (!script.parentNode) window.document.head.appendChild(script);
  }

  window.SEOStructuredData = { updateTrackSchema };
})(window);
