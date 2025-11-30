// Simple offline detection - only handles online/offline events
// Main offline logic is now handled in initialization.js after audioCache is ready

// Listen for online/offline events to hide/show fallback
window.addEventListener('online', function() {
  const fallback = document.getElementById('offline-fallback');
  const app = document.getElementById('app');

  if (fallback && app) {
    fallback.style.display = 'none';
    app.style.display = 'block';
    document.body.style.overflow = 'auto';
  }

  // Hide offline music section when coming back online
  const offlineSection = document.getElementById('offline-music-section');
  if (offlineSection) {
    offlineSection.style.display = 'none';
  }
});

// offline indicator initialization
document.addEventListener('DOMContentLoaded', function() {
  // Override the initial check to not show indicator on load
  setTimeout(function() {
    // Find the offline indicator
    const indicator = document.getElementById('offline-indicator');
    if (indicator) {
      // Ensure it's hidden initially regardless of navigator.onLine
      indicator.classList.remove('active');
      indicator.classList.add('hidden');
      document.body.classList.remove('offline-mode');

      console.log('Offline indicator fixed - hidden on load');
    }
  }, 100);
});

// Listen for actual offline/online events
window.addEventListener('offline', function() {
  const indicator = document.getElementById('offline-indicator');
  if (indicator) {
    indicator.classList.remove('hidden');
    indicator.classList.add('active');
    indicator.querySelector('.offline-text').textContent = 'Sin conexión';
    document.body.classList.add('offline-mode');
  }
});

window.addEventListener('online', function() {
  const indicator = document.getElementById('offline-indicator');
  if (indicator) {
    indicator.classList.remove('active');
    indicator.classList.add('hidden');
    document.body.classList.remove('offline-mode');
  }
});

// Function to show offline music section when we have cached music but no favorites
async function showOfflineMusicSection() {
  try {
    if (typeof audioCache === 'undefined' || !audioCache || typeof audioCache.getAllMetadata !== 'function') {
      return;
    }

    const cachedMetadata = await audioCache.getAllMetadata();
    if (!cachedMetadata || cachedMetadata.length === 0) {
      return;
    }

    // Create offline music section if it doesn't exist
    let offlineSection = document.getElementById('offline-music-section');
    if (!offlineSection) {
      offlineSection = document.createElement('div');
      offlineSection.id = 'offline-music-section';
      offlineSection.className = 'offline-music-section';
      offlineSection.innerHTML = `
        <div class="offline-music-header">
          <h3>🎵 Música Offline</h3>
          <p>Tienes ${cachedMetadata.length} pista(s) disponible(s) sin conexión</p>
        </div>
        <div id="offline-music-list" class="offline-music-list"></div>
      `;

      // Insert after search section
      const searchSection = document.querySelector('.discovery-section');
      if (searchSection) {
        searchSection.appendChild(offlineSection);
      }
    }

    // Populate the list
    const listContainer = document.getElementById('offline-music-list');
    if (listContainer) {
      listContainer.innerHTML = '';

      cachedMetadata.forEach((metadata, index) => {
        const item = document.createElement('div');
        item.className = 'offline-music-item';
        item.innerHTML = `
          <div class="offline-music-info">
            <div class="offline-music-title">${metadata.title || 'Sin título'}</div>
            <div class="offline-music-creator">${metadata.creator || 'Desconocido'}</div>
            <div class="offline-music-size">${formatBytes(metadata.size || 0)}</div>
          </div>
          <button class="offline-play-btn" data-url="${metadata.url}" data-index="${index}">
            ▶
          </button>
        `;

        // Add click handler
        const playBtn = item.querySelector('.offline-play-btn');
        playBtn.addEventListener('click', () => {
          playOfflineTrack(metadata);
        });

        listContainer.appendChild(item);
      });
    }

    // Show the section
    offlineSection.style.display = 'block';

  } catch (error) {
    console.warn('Error showing offline music section:', error);
  }
}

// Function to play an offline track
async function playOfflineTrack(metadata) {
  try {
    const track = {
      url: metadata.url,
      title: metadata.title || 'Sin título',
      creator: metadata.creator || 'Desconocido',
      id: metadata.url, // Use URL as ID for offline tracks
      isOffline: true
    };

    // Use existing playback function
    if (typeof playAudioTrackOptimized === 'function') {
      await playAudioTrackOptimized(track, track.id);
    }

  } catch (error) {
    console.error('Error playing offline track:', error);
    showStatus('Error reproduciendo pista offline', 'error');
  }
}

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

console.log('Offline fix loaded');
