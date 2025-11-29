// Simple offline detection for fallback page
window.addEventListener('load', function() {
  // Check if we're offline and no favorites are available
  if (!navigator.onLine) {
    // Small delay to allow initialization to potentially load favorites
    setTimeout(function() {
      const favoritesCount = localStorage.getItem('resonate_favorites');
      let hasFavorites = false;

      try {
        if (favoritesCount) {
          const favorites = JSON.parse(favoritesCount);
          hasFavorites = favorites && favorites.length > 0;
        }
      } catch (e) {
        hasFavorites = false;
      }

      // Show offline fallback if no favorites and offline
      if (!hasFavorites) {
        const fallback = document.getElementById('offline-fallback');
        const app = document.getElementById('app');

        if (fallback && app) {
          app.style.display = 'none';
          fallback.style.display = 'flex';
          document.body.style.overflow = 'hidden';
        }
      }
    }, 2000); // Wait 2 seconds for app initialization
  }

  // Listen for online/offline events to hide/show fallback
  window.addEventListener('online', function() {
    const fallback = document.getElementById('offline-fallback');
    const app = document.getElementById('app');

    if (fallback && app) {
      fallback.style.display = 'none';
      app.style.display = 'block';
      document.body.style.overflow = 'auto';
    }
  });
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

console.log('Offline fix loaded');
