// Playlist UI Module - Panel rendering, picker popup, and event wiring
// Extracted from ui.js to improve code organization and maintainability

(function initPlaylistsUI() {
  'use strict';

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Escape HTML special characters to prevent XSS
   * @param {string} str - Input string
   * @returns {string} - Escaped string
   */
  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Format seconds into mm:ss display string
   * @param {number} secs - Duration in seconds
   * @returns {string} - Formatted duration string
   */
  function formatDuration(secs) {
    if (!secs || !isFinite(secs) || secs < 0) return '';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /**
   * Get the PlaylistManager instance
   * @returns {Object|null} - PlaylistManager or null
   */
  function getPlaylistManager() {
    return window.PlaylistManager || null;
  }

  // ── Panel Visibility ────────────────────────────────────────────────────────

  /**
   * Show the playlists panel
   */
  function showPlaylistsPanel() {
    try {
      const panel = document.getElementById('playlists-list');
      if (!panel) return;

      panel.classList.add('active');

      const btn = document.getElementById('playlists-toggle');
      if (btn) btn.setAttribute('aria-expanded', 'true');

      // Close other panels for better UX
      try {
        if (typeof hideSearchResults === 'function') hideSearchResults();
      } catch { /* best-effort */ }
      try {
        if (typeof hideResontesList === 'function') hideResontesList();
      } catch { /* best-effort */ }

      renderPlaylistsPanel();
    } catch { /* ignore errors */ }
  }

  /**
   * Hide the playlists panel
   */
  function hidePlaylistsPanel() {
    try {
      const panel = document.getElementById('playlists-list');
      if (!panel) return;

      panel.classList.remove('active');

      const btn = document.getElementById('playlists-toggle');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    } catch { /* ignore errors */ }
  }

  /**
   * Toggle the playlists panel visibility
   */
  function togglePlaylistsPanel() {
    const panel = document.getElementById('playlists-list');
    if (!panel) return;

    if (panel.classList.contains('active')) {
      hidePlaylistsPanel();
    } else {
      showPlaylistsPanel();
    }
  }

  // Export panel visibility functions
  window.showPlaylistsPanel = showPlaylistsPanel;
  window.hidePlaylistsPanel = hidePlaylistsPanel;
  window.togglePlaylistsPanel = togglePlaylistsPanel;

  // ── Panel Rendering ─────────────────────────────────────────────────────────

  /**
   * Render the main playlists panel with all playlists
   */
  function renderPlaylistsPanel() {
    const body = document.getElementById('playlists-panel-body');
    if (!body) return;

    const mgr = getPlaylistManager();
    const playlists = mgr ? mgr.getAll() : [];

    // Update header count badge
    const countBadge = document.getElementById('playlists-count');
    if (countBadge) {
      countBadge.textContent = playlists.length > 0 ? String(playlists.length) : '';
    }

    // Show empty state message if no playlists
    if (playlists.length === 0) {
      body.innerHTML = '<p class="playlists-empty-msg">No playlists yet.<br>Create one with <strong>+ New</strong> or import a Grayjay JSON file.</p>';
      return;
    }

    // Render playlist cards
    body.innerHTML = '';
    playlists.forEach(pl => {
      const card = createPlaylistCard(pl);
      body.appendChild(card);
    });
  }

  /**
   * Create a playlist card element
   * @param {Object} pl - Playlist object
   * @returns {HTMLElement} - Card element
   */
  function createPlaylistCard(pl) {
    const card = document.createElement('div');
    card.className = 'pl-card';
    card.setAttribute('role', 'listitem');

    const trackCount = Array.isArray(pl.tracks) ? pl.tracks.length : 0;

    card.innerHTML = `
      <div class="pl-card-header" tabindex="0" role="button" aria-expanded="false" aria-label="${escHtml(pl.name)}, ${trackCount} tracks">
        <div class="pl-card-info">
          <div class="pl-card-name">${escHtml(pl.name)}</div>
          <div class="pl-card-meta">${trackCount} track${trackCount !== 1 ? 's' : ''}</div>
        </div>
        <div class="pl-card-btns">
          <button class="pl-card-btn pl-card-btn--play" type="button" title="Play playlist" aria-label="Play ${escHtml(pl.name)}">
            <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="16" height="16" aria-hidden="true" focusable="false"><polygon points="5,3 19,12 5,21"/></svg>
          </button>
          <button class="pl-card-btn pl-card-btn--rename" type="button" title="Rename playlist" aria-label="Rename ${escHtml(pl.name)}">✏️</button>
          <button class="pl-card-btn pl-card-btn--export" type="button" title="Export to Grayjay JSON" aria-label="Export ${escHtml(pl.name)}">📤</button>
          <button class="pl-card-btn pl-card-btn--danger pl-card-btn--delete" type="button" title="Delete playlist" aria-label="Delete ${escHtml(pl.name)}">🗑</button>
        </div>
      </div>
      <div class="pl-tracks-list" aria-label="Tracks in ${escHtml(pl.name)}"></div>
    `;

    const header = card.querySelector('.pl-card-header');
    const tracksList = card.querySelector('.pl-tracks-list');

    // Toggle track list on header click
    header.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const isOpen = tracksList.classList.toggle('open');
      header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (isOpen) renderPlaylistTracks(tracksList, pl);
    });

    // Keyboard support for accessibility
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        header.click();
      }
    });

    // Play button
    card.querySelector('.pl-card-btn--play').addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        if (typeof window.playFromPlaylist === 'function') {
          window.playFromPlaylist(pl, 0);
        }
      } catch { /* ignore errors */ }
    });

    // Rename button
    card.querySelector('.pl-card-btn--rename').addEventListener('click', (e) => {
      e.stopPropagation();
      const newName = window.prompt('Rename playlist:', pl.name);
      if (!newName || !newName.trim()) return;
      try {
        const mgr = getPlaylistManager();
        if (mgr) mgr.renamePlaylist(pl.id, newName.trim());
      } catch { /* ignore errors */ }
      renderPlaylistsPanel();
    });

    // Export button
    card.querySelector('.pl-card-btn--export').addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        const mgr = getPlaylistManager();
        if (mgr) mgr.exportToGrayjay(pl.id);
      } catch { /* ignore errors */ }
    });

    // Delete button
    card.querySelector('.pl-card-btn--delete').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!window.confirm(`Delete playlist "${pl.name}"?`)) return;
      try {
        const mgr = getPlaylistManager();
        if (mgr) mgr.deletePlaylist(pl.id);
      } catch { /* ignore errors */ }
      renderPlaylistsPanel();
    });

    return card;
  }

  /**
   * Render tracks inside a playlist card
   * @param {HTMLElement} container - Container element for tracks
   * @param {Object} pl - Playlist object
   */
  function renderPlaylistTracks(container, pl) {
    container.innerHTML = '';
    const tracks = Array.isArray(pl.tracks) ? pl.tracks : [];

    if (tracks.length === 0) {
      container.innerHTML = '<div class="pl-tracks-empty-msg">No tracks yet.</div>';
      return;
    }

    const currentUrl = window.state && window.state.currentTrack ? window.state.currentTrack.url : null;

    tracks.forEach((track, idx) => {
      const row = createTrackRow(track, idx, pl, container, currentUrl);
      container.appendChild(row);
    });
  }

  /**
   * Create a track row element
   * @param {Object} track - Track object
   * @param {number} idx - Track index
   * @param {Object} pl - Parent playlist
   * @param {HTMLElement} container - Container element
   * @param {string|null} currentUrl - Currently playing track URL
   * @returns {HTMLElement} - Track row element
   */
  function createTrackRow(track, idx, pl, container, currentUrl) {
    const row = document.createElement('div');
    row.className = 'pl-track-row' + (currentUrl && track.url === currentUrl ? ' pl-track-row--playing' : '');
    row.setAttribute('role', 'listitem');

    const trackDuration = track.duration ? formatDuration(track.duration) : '';

    row.innerHTML = `
      <div style="min-width:0">
        <div class="pl-track-title">${escHtml(track.title || 'Untitled')}</div>
        <div class="pl-track-creator">${escHtml(track.creator || '')}${trackDuration ? ' · ' + escHtml(trackDuration) : ''}</div>
      </div>
      <button class="pl-track-remove-btn" type="button" title="Remove from playlist" aria-label="Remove ${escHtml(track.title || 'Untitled')} from playlist">&#x2715;</button>
    `;

    // Play track on row click
    row.addEventListener('click', (e) => {
      if (e.target.closest('.pl-track-remove-btn')) return;
      try {
        if (typeof window.playFromPlaylist === 'function') {
          window.playFromPlaylist(pl, idx);
        }
      } catch { /* ignore errors */ }
    });

    // Remove track button
    row.querySelector('.pl-track-remove-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const mgr = getPlaylistManager();
      try {
        if (mgr) mgr.removeTrack(pl.id, track.url);
      } catch { /* ignore errors */ }

      // Re-fetch the updated playlist and re-render
      const updated = mgr ? mgr.getById(pl.id) : null;
      if (updated) {
        pl.tracks = updated.tracks;
        renderPlaylistTracks(container, pl);
      } else {
        renderPlaylistsPanel();
      }
    });

    return row;
  }

  // Export render function
  window.renderPlaylistsPanel = renderPlaylistsPanel;

  // ── Add-to-Playlist Picker Popup ────────────────────────────────────────────

  let _pickerBackdrop = null;

  /**
   * Close the playlist picker popup
   */
  function closePlaylistPicker() {
    try {
      if (_pickerBackdrop && _pickerBackdrop.parentNode) {
        _pickerBackdrop.parentNode.removeChild(_pickerBackdrop);
      }
    } catch { /* ignore errors */ }
    _pickerBackdrop = null;
  }

  /**
   * Show the playlist picker popup for adding a track to a playlist
   * @param {Object} track - Track to add
   * @param {HTMLElement} anchorEl - Element to anchor the popup to
   */
  function showPlaylistPicker(track, anchorEl) {
    closePlaylistPicker();

    const mgr = getPlaylistManager();
    const playlists = mgr ? mgr.getAll() : [];

    // Create backdrop for click-away dismiss
    _pickerBackdrop = document.createElement('div');
    _pickerBackdrop.className = 'pl-picker-backdrop';
    _pickerBackdrop.addEventListener('click', closePlaylistPicker);
    document.body.appendChild(_pickerBackdrop);

    // Create popup
    const picker = document.createElement('div');
    picker.className = 'pl-picker';
    picker.setAttribute('role', 'menu');
    picker.innerHTML = `<div class="pl-picker-header">Add to playlist</div><div class="pl-picker-list"></div>`;
    const list = picker.querySelector('.pl-picker-list');

    // Add existing playlists as options
    playlists.forEach(pl => {
      const btn = createPickerItem(pl.name, () => {
        try {
          const added = mgr.addTrack(pl.id, track);
          if (typeof window.showStatus === 'function') {
            window.showStatus(added ? `Added to "${pl.name}"` : `Already in "${pl.name}"`, 'info', 2000);
          }
        } catch { /* ignore errors */ }
        closePlaylistPicker();
      });
      list.appendChild(btn);
    });

    // Add "New playlist" option
    const newBtn = createPickerItem('+ New playlist', () => {
      closePlaylistPicker();
      const name = window.prompt('New playlist name:');
      if (!name || !name.trim()) return;
      try {
        if (!mgr) return;
        const pl = mgr.createPlaylist(name.trim());
        mgr.addTrack(pl.id, track);
        if (typeof window.showStatus === 'function') {
          window.showStatus(`Added to "${pl.name}"`, 'info', 2000);
        }
      } catch { /* ignore errors */ }
    }, true);
    list.appendChild(newBtn);

    document.body.appendChild(picker);

    // Position popup near anchor element
    positionPicker(picker, anchorEl);
  }

  /**
   * Create a picker item button
   * @param {string} text - Button text
   * @param {Function} onClick - Click handler
   * @param {boolean} isNew - Whether this is the "new playlist" option
   * @returns {HTMLElement} - Button element
   */
  function createPickerItem(text, onClick, isNew = false) {
    const btn = document.createElement('button');
    btn.className = 'pl-picker-item' + (isNew ? ' pl-picker-item--new' : '');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  /**
   * Position the picker popup near the anchor element
   * @param {HTMLElement} picker - Picker element
   * @param {HTMLElement} anchorEl - Anchor element
   */
  function positionPicker(picker, anchorEl) {
    try {
      const rect = anchorEl ? anchorEl.getBoundingClientRect() : null;
      const vpW = window.innerWidth || 320;
      const vpH = window.innerHeight || 568;

      if (rect) {
        let top = rect.bottom + 4;
        let left = rect.left;
        const pickerW = 240;

        // Adjust horizontal position to stay within viewport
        if (left + pickerW > vpW - 8) left = vpW - pickerW - 8;
        if (left < 8) left = 8;

        // Adjust vertical position if not enough space below
        if (top + 280 > vpH) top = rect.top - 280;
        if (top < 8) top = 8;

        picker.style.top = top + 'px';
        picker.style.left = left + 'px';
      } else {
        // Center in viewport if no anchor
        picker.style.top = '50%';
        picker.style.left = '50%';
        picker.style.transform = 'translate(-50%, -50%)';
      }
    } catch { /* ignore positioning errors */ }
  }

  // Export picker function
  window.showPlaylistPicker = showPlaylistPicker;

  // ── Event Wiring ────────────────────────────────────────────────────────────

  /**
   * Wire up all playlist-related button event listeners
   */
  function wirePlaylists() {
    // Toggle button in app menu sheet
    const toggleBtn = document.getElementById('playlists-toggle');
    if (toggleBtn && !toggleBtn.dataset.playlistBound) {
      toggleBtn.dataset.playlistBound = '1';
      toggleBtn.addEventListener('click', (e) => {
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch { /* ignore errors */ }
        togglePlaylistsPanel();
      });
    }

    // Close button
    const closeBtn = document.getElementById('playlists-close-btn');
    if (closeBtn && !closeBtn.dataset.playlistBound) {
      closeBtn.dataset.playlistBound = '1';
      closeBtn.addEventListener('click', hidePlaylistsPanel);
    }

    // New playlist button
    const newBtn = document.getElementById('playlists-new-btn');
    if (newBtn && !newBtn.dataset.playlistBound) {
      newBtn.dataset.playlistBound = '1';
      newBtn.addEventListener('click', () => {
        const name = window.prompt('New playlist name:');
        if (!name || !name.trim()) return;
        try {
          const mgr = getPlaylistManager();
          if (mgr) mgr.createPlaylist(name.trim());
        } catch { /* ignore errors */ }
        renderPlaylistsPanel();
      });
    }

    // Import button
    const importBtn = document.getElementById('playlists-import-btn');
    const importInput = document.getElementById('playlist-import-input');
    if (importBtn && importInput && !importBtn.dataset.playlistBound) {
      importBtn.dataset.playlistBound = '1';
      importBtn.addEventListener('click', () => {
        importInput.value = '';
        importInput.click();
      });
      importInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const mgr = getPlaylistManager();
          if (!mgr) return;
          const pl = await mgr.importFromGrayjay(file);
          if (typeof window.showStatus === 'function') {
            window.showStatus(`Imported "${pl.name}" (${pl.tracks.length} tracks)`, 'info', 3000);
          }
          renderPlaylistsPanel();
        } catch (err) {
          if (typeof window.showStatus === 'function') {
            window.showStatus('Could not import playlist. Check the file format.', 'error', 4000);
          }
        }
      });
    }
  }

  // ── Initialize ──────────────────────────────────────────────────────────────

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    wirePlaylists();
  } else {
    window.addEventListener('DOMContentLoaded', wirePlaylists);
  }
})();
