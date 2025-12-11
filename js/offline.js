// Simple offline detection - handles connectivity indicators only
// Main offline logic is handled in initialization.js to ensure app always shows

// Listen for online/offline events for indicators only
window.addEventListener('online', function() {
  console.log('Network: Online event detected');

  // Show online indicator but don't change app visibility
  if (typeof showStatus === 'function') {
    showStatus('Connection restored', 'info', 2000);
  }

  // Update offline indicator
  const indicator = document.getElementById('offline-indicator');
  if (indicator) {
    indicator.classList.remove('active');
    indicator.classList.add('hidden');
    document.body.classList.remove('offline-mode');
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
    indicator.querySelector('.offline-text').textContent = 'No connection';
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
