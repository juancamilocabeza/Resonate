// Tracklist V2 - modular renderer for album tracks in search and resontes
(function() {
  function formatTime(seconds) {
    if (!seconds || !isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  function isResontesContext(container) {
    return !!container.closest('#resontes-list');
  }

  async function displayAlbumTracksV2(albumId, tracksContainer) {
    try {
      const message = tracksContainer.closest('.search-result') ? 'Searching...' : 'Loading...';
      tracksContainer.innerHTML = `<div class="search-loading"><div class="loader"></div><span class="loader-text">${message}</span></div>`;

      const isPlaybackPanel = !!(tracksContainer && tracksContainer.closest && tracksContainer.closest('#tracks-list-container'));

      const files = await (window.fetchOptimizedPlayableFiles || fetchOptimizedPlayableFiles)(albumId);

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

      const root = document.createElement('div');
      root.className = 'tlv2';

      const list = document.createElement('div');
      list.className = 'tlv2-list';
      if (isPlaybackPanel) {
        // The current-album tracks panel handles scrolling.
        list.style.maxHeight = 'none';
        list.style.overflowY = 'visible';
      } else {
        list.style.maxHeight = '340px';
        list.style.overflowY = 'auto';
      }

      const resonteContext = isResontesContext(tracksContainer);

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

      files.forEach((track, index) => {
          // Centrar verticalmente los botones
          const buttonStyle = 'display:flex;align-items:center;justify-content:center;height:100%;';
        // Asignar la mejor descripción disponible
        // Solo mostrar la descripción propia de la pista, no la del álbum
        track.description = (typeof track.description === 'string' && track.description.trim() !== '')
          ? track.description
          : '';
        // Propagar descripción al reproducir desde resontes
        track._albumDescription = albumDescription;

        // Actualizar la UI de descripción para cada track renderizado
        if (window.updateDescriptionUI && typeof window.updateDescriptionUI === 'function') {
          window.updateDescriptionUI(track);
        }

        // New layout: <share><resonte><#><title><duration>
        const row = document.createElement('div');
        row.className = 'tlv2-row';
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '40px 40px 40px 1fr 60px';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.padding = '6px 4px';
        row.style.borderRadius = '8px';
        row.style.height = '44px';

        // Share
        const shareBtn = document.createElement('button');
        shareBtn.className = 'tlv2-action tlv2-share';
        shareBtn.title = 'Share';
        shareBtn.textContent = '🔗';
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
        resonteBtn.innerHTML = nowResonte ? window.resonateLogoSVG : window.resonateLogoSVG;
        resonteBtn.title = nowResonte ? 'Remove from resonates' : 'Add to resonates';
        try { resonteBtn.setAttribute('aria-label', resonteBtn.title); } catch {}
        resonteBtn.style.display = 'flex';
        resonteBtn.style.alignItems = 'center';
        resonteBtn.style.justifyContent = 'center';
        resonteBtn.style.height = '100%';
        row.appendChild(resonteBtn);

        // Track number
        const num = document.createElement('span');
        num.className = 'tlv2-number';
        const tn = (track && typeof track.trackNumber === 'number' && isFinite(track.trackNumber) && track.trackNumber > 0)
          ? track.trackNumber
          : null;
        num.textContent = tn != null ? String(tn) : String(index + 1);
        num.style.textAlign = 'center';
        row.appendChild(num);

        // Left-aligned title
        const title = document.createElement('div');
        title.className = 'tlv2-title';
        title.textContent = track.title || 'Untitled';
        title.style.textAlign = 'left';
        row.appendChild(title);


        // Duración
        const duration = document.createElement('span');
        duration.className = 'tlv2-duration';
        duration.textContent = formatTime(track.duration);
        duration.style.textAlign = 'center';
        row.appendChild(duration);
        // Eliminado: left, info, right (layout simplificado)

        const playFromRow = () => {
          try {
            if (resonteContext) {
              const fn = (typeof window.playFromResontesQueue === 'function')
                ? window.playFromResontesQueue
                : ((typeof window.playFromFavoritesQueue === 'function')
                  ? window.playFromFavoritesQueue
                  : (typeof playFromFavoritesQueue === 'function' ? playFromFavoritesQueue : null));
              if (fn) {
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

        // Events
        resonteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          try {
            const toggle = (typeof window.toggleResonteTrack === 'function')
              ? window.toggleResonteTrack
              : (typeof window.toggleResonte === 'function' ? window.toggleResonte : null);
            if (!toggle) return;

            toggle(track);

              // Inline update for the clicked button (immediate feedback)
            let isResonteNow = false;
            try {
              if (typeof window.isTrackResonte === 'function') isResonteNow = !!window.isTrackResonte(track);
              else if (typeof window.isTrackFavorite === 'function') isResonteNow = !!window.isTrackFavorite(track);
            } catch {}
            resonteBtn.classList.toggle('active', isResonteNow);
            resonteBtn.innerHTML = window.resonateLogoSVG;
            resonteBtn.title = isResonteNow ? 'Remove from resonates' : 'Add to resonates';
            try { resonteBtn.setAttribute('aria-label', resonteBtn.title); } catch {}

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

        list.appendChild(row);
      });

      root.appendChild(list);
      tracksContainer.appendChild(root);
    } catch (error) {
      try {
        tracksContainer.innerHTML = '<div class="no-results">Error loading tracks</div>';
      } catch {}
    }
  }

  // Export
  window.displayAlbumTracksV2 = displayAlbumTracksV2;
})();
