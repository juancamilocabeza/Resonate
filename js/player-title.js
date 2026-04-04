// Player Title Component
// Manages the current-track title display with optional scrolling ticker animation.

(function () {
  'use strict';

  let titleTickerTimeout = null;
  let tickerToken = 0;

  function getActiveTheme() {
    return document.documentElement.getAttribute('data-theme') || 'night';
  }

  function isEnergySaverMode() {
    return getActiveTheme() === 'energy-saver';
  }

  function calculateTickerDuration(textLength) {
    // UX-optimized speeds for readability:
    // - Normal modes (day/night): ~1.5 chars/second (comfortable reading speed)
    // - Energy-saver: ~0.8 chars/second (slower to save energy, click to toggle)

    if (isEnergySaverMode()) {
      // Energy-saver: slower for battery saving, user can click to toggle
      const duration = Math.ceil(textLength * 1.2); // ~0.83 chars/sec
      return Math.max(20, duration); // Minimum 20s
    }

    // Normal modes: comfortable reading speed
    const duration = Math.ceil(textLength * 0.65); // ~1.54 chars/sec
    return Math.max(10, duration); // Minimum 10s
  }

  function getTitleElement() {
    return (window.elements && window.elements.title) || document.getElementById('title');
  }

  function clearTitleTicker() {
    const titleEl = getTitleElement();
    if (!titleEl) return;

    titleEl.classList.remove('ticker');
    titleEl.style.removeProperty('--title-overflow');

    if (titleTickerTimeout) {
      clearTimeout(titleTickerTimeout);
      titleTickerTimeout = null;
    }
  }

  function sanitizeTitleTickerText(titleText) {
    const normalizedTitleText = titleText === null || titleText === undefined
      ? ''
      : String(titleText);
    if (!normalizedTitleText) return '';

    const currentTrack = window.state && typeof window.state.currentTrack === 'object'
      ? window.state.currentTrack
      : null;
    const elements = window.elements || {};
    const creatorText = currentTrack
      ? (currentTrack.creator || currentTrack.artist || '')
      : (elements.creator ? String(elements.creator.textContent || '') : '');
    const albumTitle = currentTrack
      ? (currentTrack.albumTitle || currentTrack.album || '')
      : '';

    if (window.TrackNormalizer && typeof window.TrackNormalizer.sanitizeDisplayTitle === 'function') {
      return window.TrackNormalizer.sanitizeDisplayTitle(normalizedTitleText, creatorText, albumTitle);
    }

    return normalizedTitleText;
  }

  function updateTitleTicker(titleText) {
    const titleEl = getTitleElement();
    if (!titleEl) return;

    clearTitleTicker();

    const safeTitleText = sanitizeTitleTickerText(titleText);
    const currentToken = ++tickerToken;

    if (!safeTitleText) {
      titleEl.textContent = '';
      return;
    }

    // Create or get span wrapper
    let span = titleEl.querySelector('.title-text');
    if (!span) {
      span = document.createElement('span');
      span.className = 'title-text';

      while (titleEl.firstChild) {
        span.appendChild(titleEl.firstChild);
      }
      titleEl.appendChild(span);
    }

    span.textContent = safeTitleText;
    span.style.removeProperty('animation-duration');

    // Simple character-based check (more reliable than measuring)
    // Typical container is ~320-1100px, at 24px font ~50 chars fit in 1000px
    const charThreshold = 45; // Conservative threshold for overflow detection

    if (safeTitleText.length > charThreshold) {
      // Estimate overflow based on character count
      const estimatedWidth = safeTitleText.length * 15; // ~15px per char at 24px font
      const containerWidth = titleEl.clientWidth || 1000;
      const overflowPx = Math.max(0, estimatedWidth - containerWidth);
      const duration = calculateTickerDuration(safeTitleText.length);

      if (overflowPx > 0) {
        titleEl.style.setProperty('--title-overflow', `${overflowPx}px`);
        span.style.setProperty(
          'animation-duration',
          `${duration}s`,
          isEnergySaverMode() ? 'important' : ''
        );

        // Start ticker automatically in all modes (including energy-saver)
        // Energy-saver is slower but still auto-starts for mobile readability
        setTimeout(() => {
          const el = getTitleElement();
          if (currentToken !== tickerToken || !el) return;
          const liveSpan = el.querySelector('.title-text');
          if (liveSpan) {
            void liveSpan.offsetWidth;
            el.classList.add('ticker');
          }
        }, isEnergySaverMode() ? 1500 : 1000); // Slight delay in eco mode
      }
    }
  }

  // Energy-saver mode: click to pause/resume ticker
  function setupTitleClickHandler() {
    const titleEl = getTitleElement();
    if (!titleEl) return;

    titleEl.addEventListener('click', () => {
      const el = getTitleElement();
      if (!isEnergySaverMode() || !el) return;

      const overflowPx = parseFloat(el.style.getPropertyValue('--title-overflow') || '0');
      if (overflowPx <= 0) return;

      const span = el.querySelector('.title-text');
      if (!span) return;

      if (el.classList.contains('ticker')) {
        el.classList.remove('ticker');
      } else {
        const duration = span.style.getPropertyValue('animation-duration');
        if (duration) {
          span.style.setProperty('animation-duration', duration, 'important');
        }
        void span.offsetWidth;
        el.classList.add('ticker');
      }
    });
  }

  // Initialise click handler after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupTitleClickHandler);
  } else {
    setupTitleClickHandler();
  }

  window.updateTitleTicker = updateTitleTicker;
  window.clearTitleTicker = clearTitleTicker;
}());
