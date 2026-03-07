// Simple offline detection - handles connectivity indicators only
// Main offline logic is handled elsewhere; this file only keeps the indicator stable.

(function () {
  if (window.__resonateOfflineIndicatorFixLoaded) return;
  window.__resonateOfflineIndicatorFixLoaded = true;

  let listenersAttached = false;

  function getIndicator() {
    return document.getElementById('offline-indicator');
  }

  function ensureIndicator() {
    let indicator = getIndicator();
    if (indicator || !document.body) return indicator;

    const host = document.querySelector('.header-controls') || document.querySelector('header') || document.body;
    if (!host) return null;

    indicator = document.createElement('div');
    indicator.id = 'offline-indicator';
    indicator.className = 'offline-indicator';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    indicator.hidden = true;
    host.appendChild(indicator);
    return indicator;
  }

  function getIsOnline() {
    if (window.state && typeof window.state.networkOnline === 'boolean') {
      return window.state.networkOnline;
    }

    return navigator.onLine !== false;
  }

  function syncNetworkState() {
    if (!window.state || typeof window.state !== 'object') return;
    window.state.networkOnline = navigator.onLine !== false;
  }

  function updateOfflineIndicator() {
    const indicator = ensureIndicator();
    if (!indicator) return;

    const isOnline = getIsOnline();
    indicator.hidden = isOnline;
    indicator.textContent = isOnline ? '' : 'Offline';
    indicator.setAttribute('aria-hidden', isOnline ? 'true' : 'false');

    if (isOnline) {
      indicator.removeAttribute('data-offline');
    } else {
      indicator.setAttribute('data-offline', 'true');
    }
  }

  function handleConnectivityChange() {
    syncNetworkState();
    updateOfflineIndicator();
  }

  function setupOfflineFunctionality() {
    if (!listenersAttached) {
      listenersAttached = true;
      window.addEventListener('online', handleConnectivityChange, { passive: true });
      window.addEventListener('offline', handleConnectivityChange, { passive: true });
    }

    handleConnectivityChange();
  }

  window.updateOfflineIndicator = updateOfflineIndicator;
  window.setupOfflineFunctionality = setupOfflineFunctionality;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateOfflineIndicator, { once: true });
  } else {
    updateOfflineIndicator();
  }
})();



