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
      if (textEl) textEl.textContent = 'No connection';
      document.body.classList.add('offline-mode');
      return;
    }

    indicator.classList.remove('active');
    indicator.classList.add('hidden');
    document.body.classList.remove('offline-mode');
  }

  // Override the initial check to not show indicator on load
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      setIndicatorOffline(false);
      if (getIndicator()) {
        console.log('Offline indicator fixed - hidden on load');
      }
    }, 100);
  });

  // Listen for online/offline events for indicators only
  window.addEventListener('online', function () {
    console.log('Network: Online event detected');

    // Avoid duplicate toasts if UI layer handles connectivity status
    if (!window.__resonateConnectivityStatusHandled && typeof showStatus === 'function') {
      showStatus('Your connection is back online', 'info', 2000);
    }

    setIndicatorOffline(false);
  });

  window.addEventListener('offline', function () {
    setIndicatorOffline(true);
  });

  console.log('Offline fix loaded');
})();
