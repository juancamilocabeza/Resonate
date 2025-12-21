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

      files.forEach((track, index) => {
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

        const right = document.createElement('div');
        right.className = 'tlv2-right';

        const duration = document.createElement('span');
        duration.className = 'tlv2-duration';
        duration.textContent = formatTime(track.duration);

        const playBtn = document.createElement('button');
        playBtn.className = 'tlv2-action tlv2-play';
        playBtn.title = 'Play';
        playBtn.textContent = '▶';

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

        right.appendChild(duration);
        right.appendChild(playBtn);
        right.appendChild(favBtn);
        right.appendChild(shareBtn);

        row.appendChild(left);
        row.appendChild(info);
        row.appendChild(right);

        // Events
        playBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          try {
            if (favContext) {
              // In favorites, use queue-based playback
              if (typeof window.playFromFavoritesQueue === 'function') {
                window.playFromFavoritesQueue(track);
              }
            } else {
              // In search results, use specific track playback
              if (typeof window.playSpecificSearchTrack === 'function') {
                window.playSpecificSearchTrack(track, albumId, index, files.length);
              }
            }
          } catch {}
        });

        info.addEventListener('click', (e) => {
          e.stopPropagation();
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
        });

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

        shareBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          try {
            if (typeof window.shareTrack === 'function') {
              window.shareTrack(track.id || albumId, track.title);
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
