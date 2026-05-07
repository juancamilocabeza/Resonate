// Tracklist V2 - modular renderer for album tracks in search and resontes
(function() {
  function formatTime(seconds) {
    if (!seconds || !isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  function parseDurationSeconds(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && isFinite(value)) return value >= 0 ? value : null;

    const raw = String(value).trim();
    if (!raw) return null;

    if (/^\d+(\.\d+)?$/.test(raw)) {
      const numeric = Number(raw);
      return isFinite(numeric) ? numeric : null;
    }

    const parts = raw.split(':').map(part => Number(part));
    if (!parts.length || parts.some(part => !isFinite(part))) return null;
    if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    if (parts.length === 2) return (parts[0] * 60) + parts[1];
    return null;
  }

  function resolveTrackDurationSeconds(track) {
    if (!track || typeof track !== 'object') return null;

    const rawDuration = (track.duration !== undefined && track.duration !== null)
      ? track.duration
      : (track.length !== undefined && track.length !== null)
        ? track.length
        : (track.trackDuration !== undefined && track.trackDuration !== null)
          ? track.trackDuration
          : track.track_duration;

    return parseDurationSeconds(rawDuration);
  }

  function isResontesContext(container) {
    return !!container.closest('#resontes-list');
  }

  async function displayAlbumTracksV2(albumId, tracksContainer) {
    try {
      const message = tracksContainer.closest('.search-result') ? 'Searching...' : 'Loading...';
      tracksContainer.innerHTML = `<div class="search-loading"><div class="loader"></div><span class="loader-text">${message}</span></div>`;

      const isPlaybackPanel = !!(tracksContainer && tracksContainer.closest && tracksContainer.closest('#tracks-list-container'));
      const resonteContext = isResontesContext(tracksContainer);

      const seedTracks = tracksContainer && Array.isArray(tracksContainer.__albumTracks)
        ? tracksContainer.__albumTracks
        : null;

      let files = [];
      if (window.AlbumTracks && typeof window.AlbumTracks.getTracks === 'function') {
        files = await window.AlbumTracks.getTracks(albumId, {
          sourceTracks: seedTracks,
          preferCache: true,
          allowFetch: true,
          preferFullAlbum: !resonteContext
        });
      } else {
        if (typeof window.fetchOptimizedPlayableFiles === 'function') {
          try {
            const raw = await window.fetchOptimizedPlayableFiles(albumId);
            if (window.TrackNormalizer && typeof window.TrackNormalizer.normalizeTrackList === 'function') {
              const albumTitle = (raw && raw[0] && raw[0].album) ? raw[0].album : '';
              files = window.TrackNormalizer.normalizeTrackList(raw, {
                albumId,
                albumTitle,
                totalTracks: Array.isArray(raw) ? raw.length : 0
              });
            } else {
              files = Array.isArray(raw) ? raw : [];
            }
          } catch {
            files = [];
          }
        }
      }

      if (files.length > 0) {
        try { tracksContainer.__albumTracks = files; } catch {}
      }

      tracksContainer.innerHTML = '';

      if (!Array.isArray(files) || files.length === 0) {
        tracksContainer.innerHTML = '<div class="no-results">No tracks found</div>';
        return;
      }

      // Update Tracks header count when rendered inside the playback Tracks overlay.
      if (isPlaybackPanel) {
        try {
          const overlay = tracksContainer.closest('#tracks-list-container');
          const label = overlay ? overlay.querySelector('.tracks-overlay-count') : null;
          if (label) label.textContent = `Tracks (${files.length})`;
        } catch {}
      }

      try { tracksContainer.classList.add('tracklist'); } catch {}

      const root = document.createElement('div');
      root.className = 'tlv2 tracklist__body';

      const list = document.createElement('div');
      list.className = 'tlv2-list tracklist__list';

      // INTEGRACIÓN: Precachear favoritas o resultados según contexto
      if (typeof window.audioCache === 'object' && window.audioCache) {
        if (resonteContext) {
          // Precarga resontes (mínimo 10)
          window.audioCache.preloadResontes(files);
        } else if (tracksContainer.closest('.search-result')) {
          // Precarga resultados de búsqueda (mínimo 10)
          window.audioCache.preloadSearchResults(files);
        }
      }

      // Buscar descripción a nivel de álbum/resultado si falta en el track
      let albumDescription = '';
      let resultDescription = '';
      let albumTitleForShare = '';
      if (tracksContainer && tracksContainer.closest('.search-result')) {
        const resultData = tracksContainer.closest('.search-result').__resultData;
        if (resultData) {
          if (resultData.description) albumDescription = resultData.description;
          if (resultData.description) resultDescription = resultData.description;
          if (typeof resultData.title === 'string') albumTitleForShare = resultData.title;
        }
      }

      if (!albumTitleForShare) {
        const first = files[0];
        if (first && typeof first.album === 'string') albumTitleForShare = first.album;
      }

      // ...existing code...

      const currentTrackUrl = window.state?.currentTrack?.url ?? null;

      files.forEach((track, index) => {
        // Asignar la descripción del álbum al track para que el reproductor la use al reproducir
        track._albumDescription = albumDescription;

        // New layout: <share><resonte><#><title><duration>
        const row = document.createElement('div');
        row.className = 'tlv2-row track-row';

        // Staggered entrance animation index (capped to keep delays reasonable)
        row.style.setProperty('--row-i', String(Math.min(index, 19)));

        // Mark the row that is currently playing
        if (currentTrackUrl && track.url && track.url === currentTrackUrl) {
          row.classList.add('tlv2-row--playing');
        }

        // Share
        const shareBtn = document.createElement('button');
        shareBtn.className = 'tlv2-action tlv2-share';
        shareBtn.title = 'Share';
        if (typeof window.applyShareButtonState === 'function') {
          window.applyShareButtonState(shareBtn);
        } else {
          shareBtn.textContent = '🔗';
        }
        shareBtn.style.display = 'flex';
        shareBtn.style.alignItems = 'center';
        shareBtn.style.justifyContent = 'center';
        shareBtn.style.height = '100%';
        row.appendChild(shareBtn);

        // Resonte
        const resonteBtn = document.createElement('button');
        resonteBtn.className = 'tlv2-action tlv2-resonte track-resonte';
        try {
          resonteBtn.dataset.albumId = String(albumId);
          resonteBtn.dataset.trackIndex = String(index);
        } catch {}
        if (track && track.url) resonteBtn.dataset.url = String(track.url);
        const nowResonte = typeof window.isTrackResonte === 'function' ? window.isTrackResonte(track) : false;
        resonteBtn.classList.toggle('active', nowResonte);
        resonteBtn.innerHTML = window.resonateLogoSVG;
        resonteBtn.title = nowResonte ? 'Remove from resonates' : 'Add to resonates';
        try { resonteBtn.setAttribute('aria-label', resonteBtn.title); } catch {}
        resonteBtn.style.display = 'flex';
        resonteBtn.style.alignItems = 'center';
        resonteBtn.style.justifyContent = 'center';
        resonteBtn.style.height = '100%';
        row.appendChild(resonteBtn);

        // Add to playlist
        const playlistAddBtn = document.createElement('button');
        playlistAddBtn.className = 'tlv2-action tlv2-playlist-add';
        playlistAddBtn.title = 'Add to playlist';
        playlistAddBtn.setAttribute('aria-label', 'Add to playlist');
        playlistAddBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
        row.appendChild(playlistAddBtn);
        const num = document.createElement('span');
        num.className = 'tlv2-number';
        const tn = (track && typeof track.trackNumber === 'number' && isFinite(track.trackNumber) && track.trackNumber > 0)
          ? track.trackNumber
          : null;
        num.textContent = tn != null ? String(tn) : String(index + 1);
        num.style.textAlign = 'center';
        // Store URL for efficient real-time playing-state lookup
        if (track.url) row.dataset.trackUrl = track.url;
        row.appendChild(num);

        // Left-aligned title
        const title = document.createElement('div');
        title.className = 'tlv2-title track-row-title';
        title.textContent = track.title || 'Untitled';
        title.style.textAlign = 'left';
        row.appendChild(title);


        // Duración
  const durationSeconds = resolveTrackDurationSeconds(track);
        const duration = document.createElement('span');
        duration.className = 'tlv2-duration';
  duration.textContent = formatTime(durationSeconds);
        duration.style.textAlign = 'center';
        row.appendChild(duration);
        // Eliminado: left, info, right (layout simplificado)

        // Async: mark cached rows so users know which tracks are preloaded/available offline
        if (track.url && window.audioCache && typeof window.audioCache.isCached === 'function') {
          window.audioCache.isCached(track.url).then(cached => {
            if (cached) {
              row.classList.add('tlv2-row--cached');
              // Best-effort DOM attribute updates; failure doesn't affect playback
              duration.title = 'Available offline';
              duration.setAttribute('aria-label', `${formatTime(durationSeconds)}, available offline`);
            }
          }).catch(() => {});
        }

        const playFromRow = () => {
          try {
            if (resonteContext) {
              const fn = (typeof window.playFromResontesQueue === 'function')
                ? window.playFromResontesQueue
                : ((typeof window.playFromFavoritesQueue === 'function')
                  ? window.playFromFavoritesQueue
                  : (typeof playFromFavoritesQueue === 'function' ? playFromFavoritesQueue : null));
              if (fn) {
                window.preparePlaybackTransitionFromList?.({
                  closeSearch: true,
                  closeResontes: true,
                  closeTracksPanel: true,
                  collapseExpandedAlbums: true,
                  showLoader: true,
                  loaderContext: files.length > 1 ? 'album' : 'resontes',
                  showProgress: false
                });
                fn(track);
              } else {
                window.showStatus?.('Playback is not available yet', 'error', 2500);
              }
            } else {
              if (typeof window.playSpecificSearchTrack === 'function') {
                window.playSpecificSearchTrack(track, albumId, index, files.length);
              }
            }
          } catch {}
        };

        // Tap-to-play anywhere in the row except buttons
        row.addEventListener('click', (e) => {
          if (e.target && e.target.closest && e.target.closest('button')) return;
          e.stopPropagation();
          playFromRow();
        });

        // Keyboard navigation support for accessibility
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (e.target && e.target.closest && e.target.closest('button')) return;
            e.preventDefault();
            e.stopPropagation();
            playFromRow();
          }
        });

        // Events
        resonteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          try {
            const toggle = (typeof window.toggleResonteTrack === 'function')
              ? window.toggleResonteTrack
              : (typeof window.toggleResonte === 'function' ? window.toggleResonte : null);
            if (!toggle) return;

            toggle(track);

            // Inline update for the clicked button (immediate feedback with animation)
            let isResonteNow = false;
            try {
              if (typeof window.isTrackResonte === 'function') isResonteNow = !!window.isTrackResonte(track);
              else if (typeof window.isTrackFavorite === 'function') isResonteNow = !!window.isTrackFavorite(track);
            } catch {}
            if (typeof window.applyResonteButtonState === 'function') {
              window.applyResonteButtonState(resonteBtn, isResonteNow, { animate: true });
            } else {
              resonteBtn.classList.toggle('active', isResonteNow);
              resonteBtn.innerHTML = window.resonateLogoSVG;
              resonteBtn.title = isResonteNow ? 'Remove from resonates' : 'Add to resonates';
              try { resonteBtn.setAttribute('aria-label', resonteBtn.title); } catch {}
            }

            // Then sync any other surfaces
            if (typeof window.refreshAllResonteButtons === 'function') {
              window.refreshAllResonteButtons();
            }
          } catch {}
        });

        // downloadBtn eliminado

        // offlineBadge eliminado

        shareBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          try {
            if (typeof window.shareTrack === 'function') {
              const shareAlbumTitle = (track && typeof track.album === 'string' ? track.album : '') || albumTitleForShare;
              const shareTrackIndex = (track && typeof track.trackIndex === 'number') ? track.trackIndex : index;
              window.shareTrack(track.id || albumId, track.title, track.creator, shareAlbumTitle, 'track', shareTrackIndex);
            }
          } catch {}
        });

        playlistAddBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          try {
            if (typeof window.showPlaylistPicker === 'function') {
              window.showPlaylistPicker(track, playlistAddBtn);
            }
          } catch {}
        });

        list.appendChild(row);
      });

      root.appendChild(list);
      tracksContainer.appendChild(root);

      // Real-time playing state: update row highlights when the audio track changes.
      // The handler removes itself once the list leaves the DOM, avoiding leaks.
      try {
        const audioEl = document.getElementById('audio') || (window.elements && window.elements.audio);
        if (audioEl) {
          const updatePlayingRows = () => {
            if (!list.isConnected) {
              audioEl.removeEventListener('play', updatePlayingRows);
              return;
            }
            try {
              const url = window.state?.currentTrack?.url ?? null;
              list.querySelectorAll('.tlv2-row').forEach(r => {
                r.classList.toggle('tlv2-row--playing', !!(url && r.dataset.trackUrl && r.dataset.trackUrl === url));
              });
            } catch {}
          };
          audioEl.addEventListener('play', updatePlayingRows);
        }
      } catch {}
    } catch (error) {
      try {
        tracksContainer.innerHTML = '<div class="no-results">Error loading tracks</div>';
      } catch {}
    }
  }

  // Export
  window.displayAlbumTracksV2 = displayAlbumTracksV2;
})();
