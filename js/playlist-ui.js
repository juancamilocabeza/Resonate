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
   * Format total duration including hours if needed
   * @param {number} secs - Duration in seconds
   * @returns {string} - Formatted duration string
   */
  function formatTotalDuration(secs) {
    if (!secs || !isFinite(secs) || secs < 0) return '';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}h ${m}m`;
    }
    return `${m}m ${s}s`;
  }

  /**
   * Calculate total duration of a playlist
   * @param {Object} playlist - Playlist object
   * @returns {number} - Total duration in seconds
   */
  function calculatePlaylistDuration(playlist) {
    if (!playlist || !Array.isArray(playlist.tracks)) return 0;
    return playlist.tracks.reduce((sum, track) => {
      const d = track.duration;
      return sum + (d && isFinite(d) && d > 0 ? d : 0);
    }, 0);
  }

  function syncPlaylistRowPlayingState(row, isPlaying) {
    if (!row) return;
    row.classList.toggle('pl-track-row--playing', !!isPlaying);
    row.setAttribute('aria-current', isPlaying ? 'true' : 'false');
    const baseLabel = row.dataset.baseAriaLabel || row.getAttribute('aria-label') || '';
    if (!baseLabel) return;
    row.setAttribute('aria-label', isPlaying ? `${baseLabel}, currently playing` : baseLabel);
  }

  function createPlaylistTrackSummary(pl) {
    const summary = document.createElement('div');
    summary.className = 'pl-tracks-summary';

    const primary = document.createElement('div');
    primary.className = 'pl-tracks-summary-primary';

    const totalTracks = Array.isArray(pl && pl.tracks) ? pl.tracks.length : 0;
    const count = document.createElement('span');
    count.className = 'pl-tracks-summary-count';
    count.textContent = `${totalTracks} track${totalTracks === 1 ? '' : 's'}`;
    primary.appendChild(count);

    const totalDuration = calculatePlaylistDuration(pl);
    if (totalDuration > 0) {
      const duration = document.createElement('span');
      duration.className = 'pl-tracks-summary-duration';
      duration.textContent = formatTotalDuration(totalDuration);
      primary.appendChild(duration);
    }

    const hint = document.createElement('p');
    hint.className = 'pl-tracks-summary-hint';
    hint.textContent = 'Tap a track to play it in order from this playlist.';

    summary.appendChild(primary);
    summary.appendChild(hint);
    return summary;
  }

  // ── SVG Icons ──────────────────────────────────────────────────────────────

  const CHEVRON_DOWN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true" focusable="false"><polyline points="6 9 12 15 18 9"/></svg>';
  const SHUFFLE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true" focusable="false"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>';
  const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="16" height="16" aria-hidden="true" focusable="false"><polygon points="5,3 19,12 5,21"/></svg>';
  const EDIT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true" focusable="false"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  const EXPORT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true" focusable="false"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
  const DELETE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true" focusable="false"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

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
      body.innerHTML = `
        <div class="playlists-empty-state">
          <div class="playlists-empty-icon">🎵</div>
          <h3 class="playlists-empty-title">No playlists yet</h3>
          <p class="playlists-empty-text">Create your first playlist to organize your favorite tracks</p>
          <div class="playlists-empty-actions">
            <button type="button" class="playlists-empty-cta" id="playlists-empty-new-btn">
              <span>+ Create Playlist</span>
            </button>
            <button type="button" class="playlists-empty-secondary" id="playlists-empty-import-btn">
              <span>Import from file</span>
            </button>
          </div>
        </div>
      `;
      // Wire up empty state buttons
      const emptyNewBtn = document.getElementById('playlists-empty-new-btn');
      const emptyImportBtn = document.getElementById('playlists-empty-import-btn');
      if (emptyNewBtn) {
        emptyNewBtn.addEventListener('click', () => showCreatePlaylistModal());
      }
      if (emptyImportBtn) {
        emptyImportBtn.addEventListener('click', () => {
          const importInput = document.getElementById('playlist-import-input');
          if (importInput) {
            importInput.value = '';
            importInput.click();
          }
        });
      }
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
    card.dataset.playlistId = pl.id;

    const trackCount = Array.isArray(pl.tracks) ? pl.tracks.length : 0;
    const totalDuration = calculatePlaylistDuration(pl);
    const durationStr = totalDuration > 0 ? formatTotalDuration(totalDuration) : '';
    const metaStr = `${trackCount} track${trackCount !== 1 ? 's' : ''}${durationStr ? ' · ' + durationStr : ''}`;

    card.innerHTML = `
      <div class="pl-card-header" tabindex="0" role="button" aria-expanded="false" aria-label="${escHtml(pl.name)}, ${trackCount} tracks">
        <div class="pl-card-expand-indicator">${CHEVRON_DOWN_SVG}</div>
        <div class="pl-card-info">
          <div class="pl-card-name-container">
            <span class="pl-card-name">${escHtml(pl.name)}</span>
            <input type="text" class="pl-card-name-input" value="${escHtml(pl.name)}" aria-label="Playlist name" />
          </div>
          <div class="pl-card-meta">${metaStr}</div>
        </div>
        <div class="pl-card-btns">
          <button class="pl-card-btn pl-card-btn--play" type="button" title="Play playlist" aria-label="Play ${escHtml(pl.name)}">
            ${PLAY_SVG}
          </button>
          <button class="pl-card-btn pl-card-btn--shuffle" type="button" title="Shuffle play" aria-label="Shuffle play ${escHtml(pl.name)}">
            ${SHUFFLE_SVG}
          </button>
          <button class="pl-card-btn pl-card-btn--rename" type="button" title="Rename playlist" aria-label="Rename ${escHtml(pl.name)}">
            ${EDIT_SVG}
          </button>
          <button class="pl-card-btn pl-card-btn--export" type="button" title="Export to Grayjay JSON" aria-label="Export ${escHtml(pl.name)}">
            ${EXPORT_SVG}
          </button>
          <button class="pl-card-btn pl-card-btn--danger pl-card-btn--delete" type="button" title="Delete playlist" aria-label="Delete ${escHtml(pl.name)}">
            ${DELETE_SVG}
          </button>
        </div>
      </div>
      <div class="pl-tracks-list" aria-label="Tracks in ${escHtml(pl.name)}"></div>
    `;

    const header = card.querySelector('.pl-card-header');
    const tracksList = card.querySelector('.pl-tracks-list');
    const expandIndicator = card.querySelector('.pl-card-expand-indicator');
    const nameSpan = card.querySelector('.pl-card-name');
    const nameInput = card.querySelector('.pl-card-name-input');

    // Toggle track list on header click
    header.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('.pl-card-name-input')) return;
      const isOpen = tracksList.classList.toggle('open');
      header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      card.classList.toggle('pl-card--expanded', isOpen);
      if (isOpen) renderPlaylistTracks(tracksList, pl);
    });

    // Keyboard support for accessibility
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target.closest('.pl-card-name-input')) return;
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

    // Shuffle play button
    card.querySelector('.pl-card-btn--shuffle').addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        if (typeof window.playFromPlaylist === 'function' && Array.isArray(pl.tracks) && pl.tracks.length > 0) {
          // Pick a random starting track
          const randomIdx = Math.floor(Math.random() * pl.tracks.length);
          window.playFromPlaylist(pl, randomIdx);
          if (typeof window.showStatus === 'function') {
            window.showStatus(`Shuffling: ${pl.name}`, 'info', 2000);
          }
        }
      } catch { /* ignore errors */ }
    });

    // Inline rename functionality
    const startRename = () => {
      card.classList.add('pl-card--editing');
      nameInput.value = pl.name;
      nameInput.focus();
      nameInput.select();
    };

    const finishRename = (save = true) => {
      card.classList.remove('pl-card--editing');
      if (save) {
        const newName = nameInput.value.trim();
        if (newName && newName !== pl.name) {
          try {
            const mgr = getPlaylistManager();
            if (mgr) {
              mgr.renamePlaylist(pl.id, newName);
              nameSpan.textContent = newName;
              pl.name = newName;
              if (typeof window.showStatus === 'function') {
                window.showStatus(`Renamed to "${newName}"`, 'info', 2000);
              }
            }
          } catch { /* ignore errors */ }
        }
      }
    };

    nameInput.addEventListener('blur', () => finishRename(true));
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishRename(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finishRename(false);
      }
    });
    nameInput.addEventListener('click', (e) => e.stopPropagation());

    // Rename button
    card.querySelector('.pl-card-btn--rename').addEventListener('click', (e) => {
      e.stopPropagation();
      startRename();
    });

    // Export button
    card.querySelector('.pl-card-btn--export').addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        const mgr = getPlaylistManager();
        if (mgr) {
          mgr.exportToGrayjay(pl.id);
          if (typeof window.showStatus === 'function') {
            window.showStatus(`Exported "${pl.name}"`, 'info', 2000);
          }
        }
      } catch { /* ignore errors */ }
    });

    // Delete button - use custom confirmation modal
    card.querySelector('.pl-card-btn--delete').addEventListener('click', (e) => {
      e.stopPropagation();
      showDeleteConfirmModal(pl, () => {
        try {
          const mgr = getPlaylistManager();
          if (mgr) mgr.deletePlaylist(pl.id);
        } catch { /* ignore errors */ }
        renderPlaylistsPanel();
        if (typeof window.showStatus === 'function') {
          window.showStatus(`Deleted "${pl.name}"`, 'info', 2000);
        }
      });
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
      container.innerHTML = `
        <div class="pl-tracks-empty">
          <p class="pl-tracks-empty-msg">No tracks yet</p>
          <p class="pl-tracks-empty-hint">Browse music and use the + button to add tracks</p>
        </div>
      `;
      return;
    }

    const currentUrl = window.state && window.state.currentTrack ? window.state.currentTrack.url : null;
    container.appendChild(createPlaylistTrackSummary(pl));

    tracks.forEach((track, idx) => {
      const row = createTrackRow(track, idx, pl, container, currentUrl);
      container.appendChild(row);
    });

    try {
      const audioEl = document.getElementById('audio') || (window.elements && window.elements.audio);
      if (audioEl) {
        if (typeof container.__playlistPlayingStateHandler === 'function') {
          audioEl.removeEventListener('play', container.__playlistPlayingStateHandler);
        }

        const updatePlayingRows = () => {
          if (!container.isConnected) {
            audioEl.removeEventListener('play', updatePlayingRows);
            if (container.__playlistPlayingStateHandler === updatePlayingRows) {
              delete container.__playlistPlayingStateHandler;
            }
            return;
          }

          const playingUrl = window.state && window.state.currentTrack ? window.state.currentTrack.url : null;
          container.querySelectorAll('.pl-track-row').forEach((rowEl) => {
            syncPlaylistRowPlayingState(rowEl, !!(playingUrl && rowEl.dataset.trackUrl === playingUrl));
          });
        };

        container.__playlistPlayingStateHandler = updatePlayingRows;
        audioEl.addEventListener('play', updatePlayingRows);
      }
    } catch { /* ignore errors */ }
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
    row.className = 'pl-track-row';
    row.setAttribute('role', 'listitem');
    row.setAttribute('tabindex', '0');
    const isPlaying = !!(currentUrl && track.url === currentUrl);
    syncPlaylistRowPlayingState(row, isPlaying);

    const trackDuration = track.duration ? formatDuration(track.duration) : '';
    const trackTitle = track && track.title ? String(track.title) : 'Untitled';
    const creator = track && track.creator ? String(track.creator) : '';

    const rowLabelParts = [`${idx + 1}. ${trackTitle}`];
    if (creator) rowLabelParts.push(creator);
    if (trackDuration) rowLabelParts.push(trackDuration);
    row.dataset.baseAriaLabel = rowLabelParts.join(', ');
    row.setAttribute('aria-label', row.dataset.baseAriaLabel);

    const number = document.createElement('span');
    number.className = 'pl-track-number';
    number.textContent = String(idx + 1);
    row.appendChild(number);
    if (track && track.url) row.dataset.trackUrl = String(track.url);

    const main = document.createElement('div');
    main.className = 'pl-track-main';

    const info = document.createElement('div');
    info.className = 'pl-track-info';

    const title = document.createElement('div');
    title.className = 'pl-track-title';
    title.textContent = trackTitle;
    info.appendChild(title);

    if (creator) {
      const meta = document.createElement('div');
      meta.className = 'pl-track-meta';
      meta.textContent = creator;
      meta.title = creator;
      info.appendChild(meta);
    }

    main.appendChild(info);

    const duration = document.createElement('span');
    duration.className = 'pl-track-duration';
    duration.textContent = trackDuration;
    duration.setAttribute('aria-hidden', trackDuration ? 'false' : 'true');
    main.appendChild(duration);

    row.appendChild(main);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'pl-track-remove-btn';
    removeBtn.type = 'button';
    removeBtn.title = 'Remove from playlist';
    removeBtn.setAttribute('aria-label', `Remove ${trackTitle} from playlist`);
    removeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true" focusable="false"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    row.appendChild(removeBtn);

    // Play track on row click
    row.addEventListener('click', (e) => {
      if (e.target.closest('.pl-track-remove-btn')) return;
      try {
        if (typeof window.playFromPlaylist === 'function') {
          window.playFromPlaylist(pl, idx);
        }
      } catch { /* ignore errors */ }
    });

    // Keyboard support for accessibility
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target.closest('.pl-track-remove-btn')) return;
        e.preventDefault();
        row.click();
      }
    });

    // Remove track button with animation
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Add remove animation
      row.classList.add('pl-track-row--removing');
      
      setTimeout(() => {
        const mgr = getPlaylistManager();
        try {
          if (mgr) mgr.removeTrack(pl.id, track.url);
        } catch { /* ignore errors */ }

        // Re-fetch the updated playlist and re-render
        const updated = mgr ? mgr.getById(pl.id) : null;
        if (updated) {
          pl.tracks = updated.tracks;
          renderPlaylistTracks(container, pl);
          // Update the card metadata
          const card = container.closest('.pl-card');
          if (card) {
            const meta = card.querySelector('.pl-card-meta');
            if (meta) {
              const newCount = updated.tracks.length;
              const newDuration = calculatePlaylistDuration(updated);
              const durationStr = newDuration > 0 ? formatTotalDuration(newDuration) : '';
              meta.textContent = `${newCount} track${newCount !== 1 ? 's' : ''}${durationStr ? ' · ' + durationStr : ''}`;
            }
          }
        } else {
          renderPlaylistsPanel();
        }
      }, 200);
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
      const existingPicker = document.querySelector('.pl-picker');
      if (existingPicker && existingPicker.parentNode) {
        existingPicker.parentNode.removeChild(existingPicker);
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
    
    // Show search only if there are 5 or more playlists
    const showSearch = playlists.length >= 5;
    
    picker.innerHTML = `
      <div class="pl-picker-header">
        <span>Add to playlist</span>
        <button class="pl-picker-close" type="button" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true" focusable="false"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      ${showSearch ? '<div class="pl-picker-search-container"><input type="text" class="pl-picker-search" placeholder="Search playlists..." aria-label="Search playlists" /></div>' : ''}
      <div class="pl-picker-list"></div>
    `;
    
    const list = picker.querySelector('.pl-picker-list');
    const searchInput = picker.querySelector('.pl-picker-search');
    const closeBtn = picker.querySelector('.pl-picker-close');

    // Close button handler
    closeBtn.addEventListener('click', closePlaylistPicker);

    // Function to render playlist items
    const renderPlaylistItems = (filter = '') => {
      list.innerHTML = '';
      const filterLower = filter.toLowerCase();
      const filteredPlaylists = filter 
        ? playlists.filter(pl => pl.name.toLowerCase().includes(filterLower))
        : playlists;

      if (filteredPlaylists.length === 0 && filter) {
        const noResults = document.createElement('div');
        noResults.className = 'pl-picker-no-results';
        noResults.textContent = 'No playlists found';
        list.appendChild(noResults);
      } else {
        filteredPlaylists.forEach(pl => {
          const trackCount = Array.isArray(pl.tracks) ? pl.tracks.length : 0;
          const btn = createPickerItem(pl.name, `${trackCount} track${trackCount !== 1 ? 's' : ''}`, () => {
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
      }

      // Add "New playlist" option at the end
      const newBtn = createPickerItem('+ New playlist', '', () => {
        closePlaylistPicker();
        showCreatePlaylistModal((newPlaylist) => {
          if (newPlaylist && mgr) {
            mgr.addTrack(newPlaylist.id, track);
            if (typeof window.showStatus === 'function') {
              window.showStatus(`Added to "${newPlaylist.name}"`, 'info', 2000);
            }
          }
        });
      }, true);
      list.appendChild(newBtn);
    };

    // Initial render
    renderPlaylistItems();

    // Search functionality
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        renderPlaylistItems(e.target.value);
      });
      // Focus search input
      setTimeout(() => searchInput.focus(), 100);
    }

    // Close on Escape key
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        closePlaylistPicker();
        document.removeEventListener('keydown', handleKeydown);
      }
    };
    document.addEventListener('keydown', handleKeydown);

    document.body.appendChild(picker);

    // Position popup near anchor element
    positionPicker(picker, anchorEl);
  }

  /**
   * Create a picker item button
   * @param {string} text - Button text
   * @param {string} subtitle - Subtitle text
   * @param {Function} onClick - Click handler
   * @param {boolean} isNew - Whether this is the "new playlist" option
   * @returns {HTMLElement} - Button element
   */
  function createPickerItem(text, subtitle, onClick, isNew = false) {
    const btn = document.createElement('button');
    btn.className = 'pl-picker-item' + (isNew ? ' pl-picker-item--new' : '');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    if (isNew) {
      btn.innerHTML = `<span class="pl-picker-item-name">${escHtml(text)}</span>`;
    } else {
      btn.innerHTML = `
        <span class="pl-picker-item-name">${escHtml(text)}</span>
        ${subtitle ? `<span class="pl-picker-item-meta">${escHtml(subtitle)}</span>` : ''}
      `;
    }
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

  // ── Custom Modal Components ─────────────────────────────────────────────────

  let _modalBackdrop = null;

  /**
   * Close any open modal
   */
  function closeModal() {
    try {
      if (_modalBackdrop && _modalBackdrop.parentNode) {
        _modalBackdrop.parentNode.removeChild(_modalBackdrop);
      }
      const existingModal = document.querySelector('.pl-modal');
      if (existingModal && existingModal.parentNode) {
        existingModal.parentNode.removeChild(existingModal);
      }
    } catch { /* ignore errors */ }
    _modalBackdrop = null;
  }

  /**
   * Show delete confirmation modal
   * @param {Object} playlist - Playlist to delete
   * @param {Function} onConfirm - Callback on confirmation
   */
  function showDeleteConfirmModal(playlist, onConfirm) {
    closeModal();

    const trackCount = Array.isArray(playlist.tracks) ? playlist.tracks.length : 0;

    // Create backdrop
    _modalBackdrop = document.createElement('div');
    _modalBackdrop.className = 'pl-modal-backdrop';
    _modalBackdrop.addEventListener('click', closeModal);
    document.body.appendChild(_modalBackdrop);

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'pl-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'pl-modal-title');
    modal.innerHTML = `
      <div class="pl-modal-header">
        <h2 id="pl-modal-title" class="pl-modal-title">Delete Playlist?</h2>
      </div>
      <div class="pl-modal-body">
        <p class="pl-modal-message">
          Are you sure you want to delete <strong>"${escHtml(playlist.name)}"</strong>?
        </p>
        <p class="pl-modal-submessage">
          ${trackCount > 0 ? `This will remove ${trackCount} track${trackCount !== 1 ? 's' : ''} from your playlist.` : 'This playlist is empty.'}
        </p>
      </div>
      <div class="pl-modal-actions">
        <button type="button" class="pl-modal-btn pl-modal-btn--cancel">Cancel</button>
        <button type="button" class="pl-modal-btn pl-modal-btn--danger">Delete</button>
      </div>
    `;

    const cancelBtn = modal.querySelector('.pl-modal-btn--cancel');
    const deleteBtn = modal.querySelector('.pl-modal-btn--danger');

    cancelBtn.addEventListener('click', closeModal);
    deleteBtn.addEventListener('click', () => {
      closeModal();
      if (typeof onConfirm === 'function') onConfirm();
    });

    // Close on Escape key
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', handleKeydown);
      }
    };
    document.addEventListener('keydown', handleKeydown);

    document.body.appendChild(modal);

    // Focus the cancel button for better UX
    cancelBtn.focus();
  }

  /**
   * Show create playlist modal
   * @param {Function} onSuccess - Callback with new playlist on success
   */
  function showCreatePlaylistModal(onSuccess = null) {
    closeModal();

    // Create backdrop
    _modalBackdrop = document.createElement('div');
    _modalBackdrop.className = 'pl-modal-backdrop';
    _modalBackdrop.addEventListener('click', closeModal);
    document.body.appendChild(_modalBackdrop);

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'pl-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'pl-modal-title');
    modal.innerHTML = `
      <div class="pl-modal-header">
        <h2 id="pl-modal-title" class="pl-modal-title">New Playlist</h2>
      </div>
      <div class="pl-modal-body">
        <label class="pl-modal-label" for="pl-new-name">Playlist name</label>
        <input type="text" id="pl-new-name" class="pl-modal-input" placeholder="My Playlist" autocomplete="off" />
      </div>
      <div class="pl-modal-actions">
        <button type="button" class="pl-modal-btn pl-modal-btn--cancel">Cancel</button>
        <button type="button" class="pl-modal-btn pl-modal-btn--primary">Create</button>
      </div>
    `;

    const nameInput = modal.querySelector('#pl-new-name');
    const cancelBtn = modal.querySelector('.pl-modal-btn--cancel');
    const createBtn = modal.querySelector('.pl-modal-btn--primary');

    const doCreate = () => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      try {
        const mgr = getPlaylistManager();
        if (mgr) {
          const newPlaylist = mgr.createPlaylist(name);
          closeModal();
          renderPlaylistsPanel();
          if (typeof window.showStatus === 'function') {
            window.showStatus(`Created "${name}"`, 'info', 2000);
          }
          if (typeof onSuccess === 'function') {
            onSuccess(newPlaylist);
          }
        }
      } catch { /* ignore errors */ }
    };

    cancelBtn.addEventListener('click', closeModal);
    createBtn.addEventListener('click', doCreate);
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doCreate();
      } else if (e.key === 'Escape') {
        closeModal();
      }
    });

    // Close on Escape key
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', handleKeydown);
      }
    };
    document.addEventListener('keydown', handleKeydown);

    document.body.appendChild(modal);

    // Focus the input
    setTimeout(() => nameInput.focus(), 100);
  }

  // Export modal function
  window.showCreatePlaylistModal = showCreatePlaylistModal;

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

    // New playlist button - now uses modal
    const newBtn = document.getElementById('playlists-new-btn');
    if (newBtn && !newBtn.dataset.playlistBound) {
      newBtn.dataset.playlistBound = '1';
      newBtn.addEventListener('click', () => {
        showCreatePlaylistModal();
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
