// Playlist Manager – persistent user playlists with Grayjay export/import
(function () {
  'use strict';

  var STORAGE_KEY = 'resonate_playlists';
  var STORAGE_WARN_BYTES = 4.5 * 1024 * 1024;
  var SAVE_DEBOUNCE_MS = 120;
  var _cache = null;
  var _saveTimer = null;

  // ── Persistence ──────────────────────────────────────────────────────────

  function safeClone(value) {
    try {
      if (typeof structuredClone === 'function') return structuredClone(value);
    } catch {}
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  function normalizeText(value) {
    return String(value || '').trim();
  }

  function normalizeTrackIndex(value) {
    var num = Number(value);
    if (!Number.isFinite(num)) return null;
    var intValue = Math.floor(num);
    return intValue >= 0 ? intValue : null;
  }

  function normalizeDuration(value) {
    var duration = Number(value);
    return Number.isFinite(duration) && duration >= 0 ? duration : null;
  }

  function normalizeUrl(rawUrl) {
    var input = normalizeText(rawUrl);
    if (!input) return '';
    try {
      var url = new URL(input, window.location && window.location.origin ? window.location.origin : undefined);
      url.hash = '';
      // Drop common tracking params while preserving content identity params.
      var dropParams = {
        utm_source: true, utm_medium: true, utm_campaign: true, utm_term: true, utm_content: true,
        fbclid: true, gclid: true, mc_cid: true, mc_eid: true
      };
      var keptParams = [];
      url.searchParams.forEach(function (value, key) {
        var k = String(key || '').toLowerCase();
        if (!dropParams[k]) keptParams.push([key, value]);
      });
      keptParams.sort(function (a, b) {
        var keyCmp = String(a[0]).localeCompare(String(b[0]));
        if (keyCmp !== 0) return keyCmp;
        return String(a[1]).localeCompare(String(b[1]));
      });
      url.search = '';
      keptParams.forEach(function (entry) { url.searchParams.append(entry[0], entry[1]); });
      return url.toString();
    } catch {
      return input.replace(/#.*$/, '');
    }
  }

  function sanitizeTrack(track) {
    if (!track || typeof track !== 'object') return null;
    var url = normalizeUrl(track.url);
    if (!url) return null;
    return {
      url: url,
      title: normalizeText(track.title),
      creator: normalizeText(track.creator || track.author),
      album: normalizeText(track.album),
      albumId: normalizeText(track.albumId || track.id),
      duration: normalizeDuration(track.duration != null ? track.duration : track.length),
      trackIndex: normalizeTrackIndex(track.trackIndex)
    };
  }

  function sanitizePlaylist(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var id = normalizeText(raw.id);
    if (!id) return null;
    var name = normalizeText(raw.name) || 'Playlist';
    var createdAt = Number(raw.createdAt);
    var updatedAt = Number(raw.updatedAt);
    var tracksInput = Array.isArray(raw.tracks) ? raw.tracks : [];
    var seen = Object.create(null);
    var tracks = [];
    tracksInput.forEach(function (item) {
      var sanitized = sanitizeTrack(item);
      if (!sanitized) return;
      if (seen[sanitized.url]) return;
      seen[sanitized.url] = true;
      tracks.push(sanitized);
    });
    return {
      id: id,
      name: name,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
      tracks: tracks
    };
  }

  function readFromStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      var sanitized = [];
      parsed.forEach(function (item) {
        var playlist = sanitizePlaylist(item);
        if (playlist) sanitized.push(playlist);
      });
      return sanitized;
    } catch {
      // Ignore parse/storage errors; return empty list as safe default.
      return [];
    }
  }

  function ensureCache() {
    if (!_cache) _cache = readFromStorage();
    return _cache;
  }

  function flushSaveNow() {
    if (!_cache) return;
    if (_saveTimer) {
      clearTimeout(_saveTimer);
      _saveTimer = null;
    }
    try {
      var json = JSON.stringify(_cache);
      if (json.length > STORAGE_WARN_BYTES) {
        try {
          if (typeof window.showStatus === 'function') {
            window.showStatus('Playlist storage is getting full. Consider removing old playlists.', 'warning', 4000);
          }
        } catch { /* best-effort UI notification */ }
      }
      localStorage.setItem(STORAGE_KEY, json);
    } catch {
      // Storage may be full or blocked; notify user best-effort.
      try {
        if (typeof window.showStatus === 'function') {
          window.showStatus('Could not save playlist: storage is full', 'error', 4000);
        }
      } catch { /* ignore */ }
    }
  }

  function scheduleSave(immediate) {
    if (immediate) {
      flushSaveNow();
      return;
    }
    if (_saveTimer) return;
    _saveTimer = setTimeout(function () {
      _saveTimer = null;
      flushSaveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  function load() {
    return ensureCache();
  }

  function findPlaylist(playlists, id) {
    return playlists.find(function (p) { return p.id === String(id); }) || null;
  }

  function generateId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return 'pl_' + window.crypto.randomUUID();
      }
    } catch {}
    return 'pl_' + Date.now() + '_' + Math.floor(Math.random() * 9999);
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  function createPlaylist(name, options) {
    var opts = options || {};
    var playlists = load();
    var playlist = {
      id: generateId(),
      name: normalizeText(name || 'Playlist') || 'Playlist',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tracks: []
    };
    playlists.push(playlist);
    scheduleSave(!!opts.immediateSave);
    return safeClone(playlist);
  }

  function getAll() {
    return safeClone(load());
  }

  function getById(id) {
    var pl = findPlaylist(load(), id);
    return pl ? safeClone(pl) : null;
  }

  function renamePlaylist(id, newName) {
    var playlists = load();
    var pl = findPlaylist(playlists, id);
    if (!pl) return false;
    pl.name = normalizeText(newName) || pl.name;
    pl.updatedAt = Date.now();
    scheduleSave(false);
    return true;
  }

  function deletePlaylist(id) {
    var playlists = load();
    var idx = playlists.findIndex(function (p) { return p.id === String(id); });
    if (idx < 0) return false;
    playlists.splice(idx, 1);
    scheduleSave(false);
    return true;
  }

  function addTrackToPlaylist(pl, track) {
    var sanitized = sanitizeTrack(track);
    if (!sanitized) return false;
    var normalizedUrl = sanitized.url;
    // Avoid duplicates by normalized URL.
    if (pl.tracks.some(function (t) { return normalizeUrl(t && t.url) === normalizedUrl; })) return false;
    pl.tracks.push(sanitized);
    pl.updatedAt = Date.now();
    return true;
  }

  function addTrack(playlistId, track, options) {
    var opts = options || {};
    var playlists = load();
    var pl = findPlaylist(playlists, playlistId);
    if (!pl) return false;
    if (!addTrackToPlaylist(pl, track)) return false;
    scheduleSave(!!opts.immediateSave);
    return true;
  }

  function removeTrack(playlistId, trackUrl) {
    var normalizedTarget = normalizeUrl(trackUrl);
    if (!normalizedTarget) return false;
    var playlists = load();
    var pl = findPlaylist(playlists, playlistId);
    if (!pl) return false;
    var before = pl.tracks.length;
    pl.tracks = pl.tracks.filter(function (t) { return normalizeUrl(t && t.url) !== normalizedTarget; });
    if (pl.tracks.length === before) return false;
    pl.updatedAt = Date.now();
    scheduleSave(false);
    return true;
  }

  // ── Grayjay Export ───────────────────────────────────────────────────────

  function exportToGrayjay(playlistId) {
    var pl = getById(playlistId);
    if (!pl) return;
    var data = {
      version: 1,
      app: 'Resonate',
      name: pl.name,
      exportedAt: new Date().toISOString(),
      items: pl.tracks.map(function (t) {
        return {
          url: t.url,
          name: t.title,
          author: t.creator,
          album: t.album,
          duration: t.duration
        };
      })
    };
    var json = JSON.stringify(data, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = pl.name.replace(/[^a-z0-9_\-. ]/gi, '_') + '_grayjay.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { document.body.removeChild(a); } catch {}
      try { URL.revokeObjectURL(url); } catch {}
    }, 1000);
  }

  // ── Grayjay Import ───────────────────────────────────────────────────────

  function importFromGrayjay(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error('No file provided')); return; }
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var data = JSON.parse(e.target.result);
          var rawName = data.name || data.title || file.name || 'Imported Playlist';
          var name = normalizeText(rawName).replace(/\.json$/i, '') || 'Imported Playlist';
          var playlist = {
            id: generateId(),
            name: name,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            tracks: []
          };
          var items = Array.isArray(data.items) ? data.items
            : (Array.isArray(data.tracks) ? data.tracks : []);
          var seen = Object.create(null);
          items.forEach(function (item) {
            var sanitized = sanitizeTrack({
              url: item && item.url,
              title: item && (item.name || item.title),
              creator: item && (item.author || item.creator),
              album: item && item.album,
              albumId: item && (item.albumId || item.id),
              duration: item && item.duration,
              trackIndex: item && item.trackIndex
            });
            if (!sanitized) return;
            if (seen[sanitized.url]) return;
            seen[sanitized.url] = true;
            playlist.tracks.push(sanitized);
          });
          var playlists = load();
          playlists.push(playlist);
          scheduleSave(true); // One transactional write for the full import.
          resolve(safeClone(playlist));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = function () { reject(new Error('Failed to read file')); };
      reader.readAsText(file);
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────

  window.PlaylistManager = {
    createPlaylist: createPlaylist,
    getAll: getAll,
    getById: getById,
    renamePlaylist: renamePlaylist,
    deletePlaylist: deletePlaylist,
    addTrack: addTrack,
    removeTrack: removeTrack,
    exportToGrayjay: exportToGrayjay,
    importFromGrayjay: importFromGrayjay
  };
})();
