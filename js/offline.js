// Simple offline detection - handles connectivity indicators only
// Main offline logic is handled elsewhere; this file only keeps the indicator stable.

(function () {
  if (window.__resonateOfflineIndicatorFixLoaded) return;
  window.__resonateOfflineIndicatorFixLoaded = true;

  function getIndicator() {
    return document.getElementById('offline-indicator');
  }

  function setIndicatorOffline(isOffline) {
    const indicator = getIndicator();
    if (!indicator) return;

    if (isOffline) {
      indicator.classList.remove('hidden');
      indicator.classList.add('active');
      const textEl = indicator.querySelector('.offline-text');
      if (textEl) textEl.textContent = 'Offline';
      document.body.classList.add('offline-mode');
      return;
    }

    indicator.classList.remove('active');
    indicator.classList.add('hidden');
    document.body.classList.remove('offline-mode');
  }

  function initFallbackIndicator() {
    if (window.__resonateConnectivityStatusHandled) return;

    const updateNow = () => {
      const isOffline = typeof navigator !== 'undefined' && navigator && navigator.onLine === false;
      setIndicatorOffline(isOffline);
      if (getIndicator()) {
        console.log('Offline indicator initialized');
      }
    };

    updateNow();

    // Listen for online/offline events for indicators only
    window.addEventListener('online', function () {
      setIndicatorOffline(false);
    });

    window.addEventListener('offline', function () {
      setIndicatorOffline(true);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(initFallbackIndicator, 100);
    });
  } else {
    setTimeout(initFallbackIndicator, 0);
  }

  console.log('Offline fix loaded');
})();
