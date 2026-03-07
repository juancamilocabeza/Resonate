/**
 * player-bottom-sheet.js — Progressive Disclosure Bottom Sheet
 *
 * Manages open/close for the "More Options" bottom sheet in the player.
 * Does NOT interfere with existing playback logic or event handlers.
 *
 * Interactions supported:
 *   - Tap "⋯" button → open sheet
 *   - Tap overlay     → close sheet
 *   - Tap Cancel btn  → close sheet
 *   - Swipe down      → close sheet
 */

(function () {
  'use strict';

  /** Minimum px dragged down before the sheet dismisses on release. */
  var SWIPE_DISMISS_THRESHOLD = 80;

  var sheet = null;
  var overlay = null;
  var moreBtn = null;
  var cancelBtn = null;

  /** Touch-tracking state for swipe-to-dismiss. */
  var touch = { startY: 0, currentY: 0, isDragging: false };

  /* ------------------------------------------------------------------
     Open / Close helpers
  ------------------------------------------------------------------ */

  function openSheet() {
    if (!sheet || !overlay) return;
    sheet.classList.add('open');
    overlay.classList.add('open');
    document.body.classList.add('sheet-open');
    sheet.removeAttribute('aria-hidden');
    if (moreBtn) moreBtn.setAttribute('aria-expanded', 'true');
    // Move focus into the sheet for keyboard users
    var firstFocusable = sheet.querySelector('button, [tabindex="0"]');
    if (firstFocusable) {
      // Slight delay so the CSS transition doesn't fight focus scroll
      setTimeout(function () { firstFocusable.focus(); }, 50);
    }
  }

  function closeSheet() {
    if (!sheet || !overlay) return;
    sheet.classList.remove('open');
    overlay.classList.remove('open');
    document.body.classList.remove('sheet-open');
    sheet.setAttribute('aria-hidden', 'true');
    if (moreBtn) {
      moreBtn.setAttribute('aria-expanded', 'false');
      moreBtn.focus();
    }
    // Reset any inline transform applied during swipe
    sheet.style.transform = '';
  }

  /* ------------------------------------------------------------------
     Swipe-to-dismiss touch handlers (attached to the sheet)
  ------------------------------------------------------------------ */

  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    touch.startY = e.touches[0].clientY;
    touch.currentY = touch.startY;
    touch.isDragging = false;
  }

  function onTouchMove(e) {
    if (e.touches.length !== 1) return;
    touch.currentY = e.touches[0].clientY;
    var delta = touch.currentY - touch.startY;
    if (delta > 0) {
      touch.isDragging = true;
      // Translate the sheet downward as the user drags
      sheet.style.transform = 'translateY(' + delta + 'px)';
      // Prevent the page from scrolling while dragging the sheet
      e.preventDefault();
    }
  }

  function onTouchEnd() {
    var delta = touch.currentY - touch.startY;
    if (touch.isDragging && delta > SWIPE_DISMISS_THRESHOLD) {
      closeSheet();
    } else {
      // Snap back
      sheet.style.transform = '';
    }
    touch.isDragging = false;
  }

  /* ------------------------------------------------------------------
     Wire up "Track info" proxy button (delegates to existing handler)
  ------------------------------------------------------------------ */

  function wireTrackInfoProxy() {
    var proxyBtn = document.getElementById('sheet-track-info-btn');
    var originalBtn = document.getElementById('toggle-description-btn');
    if (proxyBtn && originalBtn) {
      proxyBtn.addEventListener('click', function () {
        closeSheet();
        // Delay matches the sheet's close transition (250ms) so the modal
        // does not open while the sheet is still animating away.
        setTimeout(function () { originalBtn.click(); }, 260);
      });
    }
  }

  /* ------------------------------------------------------------------
     Keyboard trap — keep focus inside the sheet while it is open
  ------------------------------------------------------------------ */

  function onKeyDown(e) {
    if (!sheet || !sheet.classList.contains('open')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSheet();
      return;
    }
    if (e.key !== 'Tab') return;
    var focusable = Array.prototype.slice.call(
      sheet.querySelectorAll('button, [tabindex="0"], [tabindex]:not([tabindex="-1"])')
    ).filter(function (el) { return !el.disabled && el.offsetParent !== null; });
    if (focusable.length === 0) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  /* ------------------------------------------------------------------
     Initialise once the DOM is ready
  ------------------------------------------------------------------ */

  function init() {
    sheet = document.getElementById('player-options-sheet');
    overlay = document.getElementById('bottom-sheet-overlay');
    moreBtn = document.getElementById('more-options-btn');
    cancelBtn = document.getElementById('sheet-cancel-btn');

    if (!sheet || !overlay || !moreBtn) return;

    // Open on "⋯" button click
    moreBtn.addEventListener('click', function () {
      if (sheet.classList.contains('open')) {
        closeSheet();
      } else {
        openSheet();
      }
    });

    // Close on overlay click
    overlay.addEventListener('click', closeSheet);

    // Close on Cancel button click
    if (cancelBtn) cancelBtn.addEventListener('click', closeSheet);

    // Swipe-to-dismiss
    sheet.addEventListener('touchstart', onTouchStart, { passive: true });
    sheet.addEventListener('touchmove', onTouchMove, { passive: false });
    sheet.addEventListener('touchend', onTouchEnd, { passive: true });

    // Keyboard: Escape closes, Tab traps focus
    document.addEventListener('keydown', onKeyDown);

    // Wire proxy buttons to existing handlers
    wireTrackInfoProxy();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
