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
        track.description = window.getBestDescription
          ? window.getBestDescription(track, albumDescription, resultDescription)
          : (track.description || albumDescription || resultDescription || '');
        // Propagar descripción al reproducir desde favoritos
        track._albumDescription = albumDescription;

        // Actualizar la UI de descripción para cada track renderizado
        if (window.updateDescriptionUI && typeof window.updateDescriptionUI === 'function') {
          window.updateDescriptionUI(track);
        }

        const row = document.createElement('div');
        row.className = 'tlv2-row';

        const left = document.createElement('div');
        left.className = 'tlv2-left';
        const num = document.createElement('span');
        num.className = 'tlv2-number';
        num.textContent = typeof track.trackNumber === 'number' ? String(track.trackNumber) : String(index + 1);
        left.appendChild(num);

        const info = document.createElement('div');
        info.className = 'tlv2-info';
        const title = document.createElement('div');
        title.className = 'tlv2-title';
        title.textContent = track.title || 'Untitled';
        const creator = document.createElement('div');
        creator.className = 'tlv2-creator';
        creator.textContent = track.creator || 'Unknown';
        info.appendChild(title);
        info.appendChild(creator);
        // Mostrar descripción si existe
        if (track.description) {
          const desc = document.createElement('div');
          desc.className = 'tlv2-description';
          desc.textContent = track.description;
          info.appendChild(desc);
        }

        const right = document.createElement('div');
        right.className = 'tlv2-right';

        const duration = document.createElement('span');
        duration.className = 'tlv2-duration';
        duration.textContent = formatTime(track.duration);

        const offlineBadge = document.createElement('span');
        offlineBadge.className = 'tlv2-offline';
        offlineBadge.textContent = '';

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'tlv2-action tlv2-download';
        downloadBtn.title = 'Download for offline';
        downloadBtn.textContent = '⬇';

        if (track.downloadOffline) {
          downloadBtn.textContent = '✔';
          offlineBadge.textContent = 'Offline';
        }

        const favBtn = document.createElement('button');
        favBtn.className = 'tlv2-action tlv2-fav';
        const nowFav = typeof window.isTrackFavorite === 'function' ? window.isTrackFavorite(track) : false;
        favBtn.classList.toggle('active', nowFav);
        favBtn.textContent = nowFav ? '❤️' : '🩶';
        favBtn.title = nowFav ? 'Remove from favorites' : 'Add to favorites';

        const shareBtn = document.createElement('button');
        shareBtn.className = 'tlv2-action tlv2-share';
        shareBtn.title = 'Share';
        shareBtn.textContent = '🔗';

        info.appendChild(offlineBadge);

        right.appendChild(duration);
        right.appendChild(favBtn);
        right.appendChild(downloadBtn);
        right.appendChild(shareBtn);

        row.appendChild(left);
        row.appendChild(info);
        row.appendChild(right);

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

        downloadBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            track.downloadOffline = !track.downloadOffline;
            downloadBtn.textContent = track.downloadOffline ? '✔' : '⬇';
            if (typeof window.toggleDownloadOffline === 'function') {
              await window.toggleDownloadOffline(track);
            }
            if (track.downloadOffline) {
              offlineBadge.textContent = 'Offline';
            } else {
              offlineBadge.textContent = '';
            }
          } catch {}
        });

        if (window.audioCache && typeof window.audioCache.isCached === 'function') {
          window.audioCache.isCached(track.url).then((isCached) => {
            if (isCached) {
              offlineBadge.textContent = 'Offline';
              downloadBtn.textContent = '✔';
            }
          }).catch(() => {});
        }

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
