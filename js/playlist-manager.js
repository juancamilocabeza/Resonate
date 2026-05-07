// Playlist Manager – persistent user playlists with Grayjay export/import
(function () {
  'use strict';

  var STORAGE_KEY = 'resonate_playlists';
  var STORAGE_WARN_BYTES = 4.5 * 1024 * 1024;

  // ── Persistence ──────────────────────────────────────────────────────────

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function save(playlists) {
    try {
      var json = JSON.stringify(playlists);
      if (json.length > STORAGE_WARN_BYTES) {
        try {
          if (typeof window.showStatus === 'function') {
            window.showStatus('Playlist storage is getting full. Consider removing old playlists.', 'warning', 4000);
          }
        } catch {}
      }
      localStorage.setItem(STORAGE_KEY, json);
    } catch {
      try {
        if (typeof window.showStatus === 'function') {
          window.showStatus('Could not save playlist: storage is full', 'error', 4000);
        }
      } catch {}
    }
  }

  function generateId() {
    return 'pl_' + Date.now() + '_' + Math.floor(Math.random() * 9999);
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  function createPlaylist(name) {
    var playlists = load();
    var playlist = {
      id: generateId(),
      name: String(name || 'Playlist').trim() || 'Playlist',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tracks: []
    };
    playlists.push(playlist);
    save(playlists);
    return playlist;
  }

  function getAll() {
    return load();
  }

  function getById(id) {
    return load().find(function (p) { return p.id === String(id); }) || null;
  }

  function renamePlaylist(id, newName) {
    var playlists = load();
    var pl = playlists.find(function (p) { return p.id === String(id); });
    if (!pl) return false;
    pl.name = String(newName || '').trim() || pl.name;
    pl.updatedAt = Date.now();
    save(playlists);
    return true;
  }

  function deletePlaylist(id) {
    var playlists = load();
    var idx = playlists.findIndex(function (p) { return p.id === String(id); });
    if (idx < 0) return false;
    playlists.splice(idx, 1);
    save(playlists);
    return true;
  }

  function addTrack(playlistId, track) {
    if (!track || !track.url) return false;
    var playlists = load();
    var pl = playlists.find(function (p) { return p.id === String(playlistId); });
    if (!pl) return false;
    // Avoid duplicates by URL
    if (pl.tracks.some(function (t) { return t.url === track.url; })) return false;
    var dur = Number(track.duration != null ? track.duration : track.length);
    pl.tracks.push({
      url: String(track.url || ''),
      title: String(track.title || ''),
      creator: String(track.creator || ''),
      album: String(track.album || ''),
      albumId: String(track.albumId || track.id || ''),
      duration: Number.isFinite(dur) && dur >= 0 ? dur : null,
      trackIndex: Number.isFinite(Number(track.trackIndex)) ? Number(track.trackIndex) : null
    });
    pl.updatedAt = Date.now();
    save(playlists);
    return true;
  }

  function removeTrack(playlistId, trackUrl) {
    var playlists = load();
    var pl = playlists.find(function (p) { return p.id === String(playlistId); });
    if (!pl) return false;
    var before = pl.tracks.length;
    pl.tracks = pl.tracks.filter(function (t) { return t.url !== String(trackUrl); });
    if (pl.tracks.length === before) return false;
    pl.updatedAt = Date.now();
    save(playlists);
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
          var name = String(rawName).replace(/\.json$/i, '');
          var playlist = createPlaylist(name);
          var items = Array.isArray(data.items) ? data.items
            : (Array.isArray(data.tracks) ? data.tracks : []);
          items.forEach(function (item) {
            if (item && item.url) {
              addTrack(playlist.id, {
                url: item.url,
                title: item.name || item.title || '',
                creator: item.author || item.creator || '',
                album: item.album || '',
                duration: item.duration || null
              });
            }
          });
          resolve(getById(playlist.id));
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
