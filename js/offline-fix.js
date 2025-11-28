// Offline functionality fix for Resonate PWA
// This file contains fixes for the offline indicator issue

// Fix the offline indicator initialization
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
