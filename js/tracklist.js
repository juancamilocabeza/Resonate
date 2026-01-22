// Tracklist V2 - modular renderer for album tracks in search and favorites
(function() {
  function formatTime(seconds) {
    if (!seconds || !isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  function isFavoritesContext(container) {
    return !!container.closest('#favorites-list');
  }

  async function displayAlbumTracksV2(albumId, tracksContainer) {
    try {
      const message = tracksContainer.closest('.search-result') ? 'Searching...' : 'Loading...';
      tracksContainer.innerHTML = `<div class="search-loading"><div class="loader"></div><span class="loader-text">${message}</span></div>`;

      const files = await (window.fetchOptimizedPlayableFiles || fetchOptimizedPlayableFiles)(albumId);

      tracksContainer.innerHTML = '';

      if (!Array.isArray(files) || files.length === 0) {
        tracksContainer.innerHTML = '<div class="no-results">No tracks found</div>';
        return;
      }

      const root = document.createElement('div');
      root.className = 'tlv2';

      const list = document.createElement('div');
      list.className = 'tlv2-list';
      list.style.maxHeight = '340px';
      list.style.overflowY = 'auto';

      const favContext = isFavoritesContext(tracksContainer);

      // INTEGRACIÓN: Precachear favoritas o resultados según contexto
      if (typeof window.audioCache === 'object' && window.audioCache) {
        if (favContext) {
          // Precarga favoritas (mínimo 10)
          window.audioCache.preloadFavorites(files);
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
        // Asignar la mejor descripción disponible
        // Solo mostrar la descripción propia de la pista, no la del álbum
        track.description = (typeof track.description === 'string' && track.description.trim() !== '')
          ? track.description
          : '';
        // Propagar descripción al reproducir desde favoritos
        track._albumDescription = albumDescription;

        // Actualizar la UI de descripción para cada track renderizado
        if (window.updateDescriptionUI && typeof window.updateDescriptionUI === 'function') {
          window.updateDescriptionUI(track);
        }

        // Nuevo layout: <compartir><corazon><#><titulo><duracion>
        const row = document.createElement('div');
        row.className = 'tlv2-row';
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '40px 40px 40px 1fr 60px';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.padding = '6px 4px';
        row.style.borderRadius = '8px';

        // Compartir
        const shareBtn = document.createElement('button');
        shareBtn.className = 'tlv2-action tlv2-share';
        shareBtn.title = 'Share';
        shareBtn.textContent = '🔗';
        row.appendChild(shareBtn);

        // Favorito
        const favBtn = document.createElement('button');
        favBtn.className = 'tlv2-action tlv2-fav';
        const nowFav = typeof window.isTrackFavorite === 'function' ? window.isTrackFavorite(track) : false;
        favBtn.classList.toggle('active', nowFav);
        favBtn.textContent = nowFav ? '❤️' : '🩶';
        favBtn.title = nowFav ? 'Remove from favorites' : 'Add to favorites';
        row.appendChild(favBtn);

        // Número de pista
        const num = document.createElement('span');
        num.className = 'tlv2-number';
        num.textContent = typeof track.trackNumber === 'number' ? String(track.trackNumber) : String(index + 1);
        num.style.textAlign = 'center';
        row.appendChild(num);

        // Título justificado a la izquierda
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
            if (favContext) {
              if (typeof window.playFromFavoritesQueue === 'function') {
                window.playFromFavoritesQueue(track);
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
        favBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          try {
            if (typeof window.toggleFavorite === 'function') {
              window.toggleFavorite(track);
              const isFav = typeof window.isTrackFavorite === 'function' ? window.isTrackFavorite(track) : false;
              favBtn.classList.toggle('active', isFav);
              favBtn.textContent = isFav ? '❤️' : '🩶';
              favBtn.title = isFav ? 'Remove from favorites' : 'Add to favorites';
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
