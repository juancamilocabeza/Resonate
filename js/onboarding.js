/**
 * onboarding.js — Resonate Progressive Onboarding
 *
 * Replaces the blocking 5-step modal tour with a progressive,
 * contextual tip system. Each tip is a small non-blocking tooltip
 * card that appears at the right moment as the user explores the app.
 *
 * Tips and their triggers:
 *  0 — Welcome    : auto-shown 900 ms after first visit
 *  1 — Search     : first focus on #search-input
 *  2 — Play       : first time search results are rendered
 *  3 — Favourite  : first click on a result play button
 *
 * Features:
 *  - Non-blocking: the user can interact with the app underneath
 *  - Per-step localStorage flags so each tip is shown only once
 *  - Auto-dismisses after a configurable timeout
 *  - Dismiss (×) button on every tip
 *  - Keyboard: Escape closes the frontmost visible tip
 *  - Accessible: role="tooltip", aria-label on close button
 *  - Backwards-compatible window.resonateOnboarding public API
 */
(function () {
  'use strict';

  var STEP_STORAGE_PREFIX  = 'resonate_ob_s';   // + step index = per-step seen flag
  var LEGACY_STORAGE_KEY   = 'resonate_onboarding_v1';
  var AUTO_START_DELAY_MS  = 900;   // wait for app to fully render
  var SHEET_CLOSE_DELAY_MS = 300;   // wait for app-menu sheet to close before replaying
  var HIDE_ANIM_MS         = 250;   // duration of tip fade-out animation
  var PLAY_BTN_DELAY_MS    = 600;   // wait for player to load a track before showing favourite tip
  var MIN_VISIBLE_OPACITY  = 0.01;

  // ── Step definitions ────────────────────────────────────────────────
  // trigger values:
  //   'auto'   — shown automatically (handled by maybeAutoStart)
  //   'focus'  — shown on first focus of step.target element
  //   'event'  — shown when window event step.triggerEvent fires
  //   'click'  — shown after first click on step.triggerTarget element
  var STEPS = [
    {
      icon: '🎵',
      title: 'Welcome to Resonate',
      body: 'Discover and play millions of free tracks from the Internet Archive.',
      target: null,
      trigger: 'auto',
      autoDismissMs: 8000,
    },
    {
      icon: '🔍',
      title: 'Search any music',
      body: 'Type a song, artist, album, or podcast — Resonate searches a huge free library instantly.',
      target: '#search-input',
      trigger: 'focus',
      autoDismissMs: 0,   // dismissed when the user starts typing
    },
    {
      icon: '▶',
      title: 'Play instantly',
      body: 'Tap any play button to start listening. No sign-up, no subscription.',
      target: '#play-btn',
      trigger: 'event',
      triggerEvent: 'resonate:results-rendered',
      autoDismissMs: 6000,
    },
    {
      icon: '💙',
      title: 'Save what you love',
      body: 'Tap the Resonate button to save favourite tracks — available any time, even offline.',
      target: '#favorite-btn',
      trigger: 'click',
      triggerTarget: '.result-play-btn',
      autoDismissMs: 6000,
    },
  ];

  // Keyed by step index: the live tip DOM element (if showing)
  var activeTips = {};
  // Keyed by step index: cleanup function that removes event listeners
  var triggerCleanup = {};

  /* ------------------------------------------------------------------ */
  /* Persistence helpers                                                  */
  /* ------------------------------------------------------------------ */

  function isStepSeen(index) {
    try {
      return localStorage.getItem(STEP_STORAGE_PREFIX + index) === '1';
    } catch (e) {
      return true;
    }
  }

  function markStepSeen(index) {
    try {
      localStorage.setItem(STEP_STORAGE_PREFIX + index, '1');
    } catch (e) {}
  }

  function isCompleted() {
    // Legacy compatibility: honour old "done" flag
    try {
      if (localStorage.getItem(LEGACY_STORAGE_KEY) === 'done') return true;
    } catch (e) {}
    for (var i = 0; i < STEPS.length; i++) {
      if (!isStepSeen(i)) return false;
    }
    return true;
  }

  function resetAll() {
    for (var i = 0; i < STEPS.length; i++) {
      try { localStorage.removeItem(STEP_STORAGE_PREFIX + i); } catch (e) {}
    }
    try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch (e) {}
  }

  /* ------------------------------------------------------------------ */
  /* Visibility helpers                                                   */
  /* ------------------------------------------------------------------ */

  function isElementVisible(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return false;
    if (el.getClientRects().length === 0) return false;
    var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (!style) return true;
    var opacity = parseFloat(style.opacity);
    if (isNaN(opacity)) opacity = 1;
    return style.display !== 'none'
        && style.visibility !== 'hidden'
        && opacity > MIN_VISIBLE_OPACITY;
  }

  /* ------------------------------------------------------------------ */
  /* Tip DOM construction                                                 */
  /* ------------------------------------------------------------------ */

  function buildTip(index) {
    var step = STEPS[index];
    var tip = document.createElement('div');
    tip.className = 'ob-tip';
    tip.id = 'ob-tip-' + index;
    tip.setAttribute('role', 'tooltip');
    tip.innerHTML =
      '<button class="ob-tip-close" type="button" aria-label="Dismiss tip">' +
        '<span aria-hidden="true">×</span>' +
      '</button>' +
      '<div class="ob-tip-icon" aria-hidden="true">' + step.icon + '</div>' +
      '<div class="ob-tip-title">' + step.title + '</div>' +
      '<div class="ob-tip-body">' + step.body + '</div>';

    tip.querySelector('.ob-tip-close').addEventListener('click', function () {
      hideTip(index);
    });

    document.body.appendChild(tip);
    return tip;
  }

  /* ------------------------------------------------------------------ */
  /* Tip positioning                                                      */
  /* ------------------------------------------------------------------ */

  function positionTip(tip, targetEl) {
    var PAD   = 12;
    var ARROW = 10;
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    if (!targetEl || !isElementVisible(targetEl)) {
      // Float as a top-centre toast
      tip.style.position  = 'fixed';
      tip.style.top       = PAD + 'px';
      tip.style.left      = '50%';
      tip.style.transform = 'translateX(-50%)';
      tip.classList.add('ob-tip-center');
      return;
    }

    var rect = tip.getBoundingClientRect();
    var TW   = rect.width  || 280;
    var TH   = rect.height || 120;

    var targetRect = targetEl.getBoundingClientRect();
    var targetCX   = targetRect.left + targetRect.width / 2;

    var top, left, placement;

    if (targetRect.bottom + ARROW + TH + PAD <= vh) {
      top       = targetRect.bottom + ARROW;
      placement = 'below';
    } else {
      top       = targetRect.top - ARROW - TH;
      placement = 'above';
    }

    left = targetCX - TW / 2;
    left = Math.max(PAD, Math.min(left, vw - TW - PAD));
    top  = Math.max(PAD, Math.min(top, vh - TH - PAD));

    // Arrow offset: how far the arrow needs to shift from tip centre
    var tipCenterX  = left + TW / 2;
    var arrowOffset = targetCX - tipCenterX;
    // Clamp so the arrow stays within the tip bounds (with a small margin)
    var arrowMaxShift = TW / 2 - 20;
    arrowOffset = Math.max(-arrowMaxShift, Math.min(arrowOffset, arrowMaxShift));

    tip.style.position  = 'fixed';
    tip.style.top       = top + 'px';
    tip.style.left      = left + 'px';
    tip.style.transform = 'none';
    tip.style.setProperty('--ob-arrow-offset', arrowOffset + 'px');
    tip.classList.toggle('ob-tip-above', placement === 'above');
    tip.classList.toggle('ob-tip-below', placement === 'below');
  }

  /* ------------------------------------------------------------------ */
  /* Show / hide a single tip                                             */
  /* ------------------------------------------------------------------ */

  function showTip(index) {
    if (isStepSeen(index)) return;
    if (activeTips[index]) return;

    var step    = STEPS[index];
    var tip     = buildTip(index);
    activeTips[index] = tip;

    var targetEl = step.target ? document.querySelector(step.target) : null;

    // Two rAF passes: first lets the browser lay out the tip,
    // second starts the CSS entrance transition.
    requestAnimationFrame(function () {
      positionTip(tip, targetEl);
      requestAnimationFrame(function () {
        tip.classList.add('ob-tip-visible');
      });
    });

    if (step.autoDismissMs > 0) {
      setTimeout(function () { hideTip(index); }, step.autoDismissMs);
    }
  }

  function hideTip(index) {
    var tip = activeTips[index];
    if (!tip) return;

    markStepSeen(index);
    tip.classList.remove('ob-tip-visible');

    setTimeout(function () {
      if (tip.parentNode) tip.parentNode.removeChild(tip);
      delete activeTips[index];
    }, HIDE_ANIM_MS);

    if (triggerCleanup[index]) {
      triggerCleanup[index]();
      delete triggerCleanup[index];
    }
  }

  /* ------------------------------------------------------------------ */
  /* Keyboard: Escape closes the highest-index visible tip               */
  /* ------------------------------------------------------------------ */

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    // Find the highest step index currently visible (sort numerically)
    var keys = Object.keys(activeTips).sort(function (a, b) {
      return parseInt(a, 10) - parseInt(b, 10);
    });
    if (!keys.length) return;
    e.preventDefault();
    e.stopPropagation();
    hideTip(parseInt(keys[keys.length - 1], 10));
  }, true);

  /* ------------------------------------------------------------------ */
  /* Trigger wiring                                                       */
  /* ------------------------------------------------------------------ */

  function wireStep(index) {
    if (isStepSeen(index)) return;

    var step = STEPS[index];

    if (step.trigger === 'focus') {
      var focusEl = document.querySelector(step.target);
      if (!focusEl) return;

      function onFocus() {
        showTip(index);
        // Dismiss as soon as the user starts typing
        function onInput() {
          hideTip(index);
          focusEl.removeEventListener('input', onInput);
        }
        focusEl.addEventListener('input', onInput);
      }

      focusEl.addEventListener('focus', onFocus, { once: true });
      triggerCleanup[index] = function () {
        focusEl.removeEventListener('focus', onFocus);
      };
      return;
    }

    if (step.trigger === 'event') {
      function onWindowEvent() {
        window.removeEventListener(step.triggerEvent, onWindowEvent);
        delete triggerCleanup[index];
        showTip(index);
      }

      window.addEventListener(step.triggerEvent, onWindowEvent);
      triggerCleanup[index] = function () {
        window.removeEventListener(step.triggerEvent, onWindowEvent);
      };
      return;
    }

    if (step.trigger === 'click') {
      // Event-delegation on document for dynamically-added buttons
      function onDocClick(e) {
        var btn = e.target && (
          e.target.matches(step.triggerTarget) ||
          (typeof e.target.closest === 'function' && e.target.closest(step.triggerTarget))
        );
        if (!btn) return;
        document.removeEventListener('click', onDocClick, true);
        delete triggerCleanup[index];
        // Small delay so the player has time to load the track
        setTimeout(function () { showTip(index); }, PLAY_BTN_DELAY_MS);
      }

      document.addEventListener('click', onDocClick, true);
      triggerCleanup[index] = function () {
        document.removeEventListener('click', onDocClick, true);
      };
      return;
    }
  }

  function wireAllSteps() {
    for (var i = 1; i < STEPS.length; i++) {
      wireStep(i);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                           */
  /* ------------------------------------------------------------------ */

  window.resonateOnboarding = {
    /** Replay the progressive tips from the beginning */
    start: function () {
      resetAll();
      // Dismiss any still-visible tips before replaying
      var keys = Object.keys(activeTips);
      for (var k = 0; k < keys.length; k++) {
        hideTip(parseInt(keys[k], 10));
      }
      // Tear down existing trigger listeners
      var ckeys = Object.keys(triggerCleanup);
      for (var c = 0; c < ckeys.length; c++) {
        if (typeof triggerCleanup[ckeys[c]] === 'function') triggerCleanup[ckeys[c]]();
        delete triggerCleanup[ckeys[c]];
      }
      showTip(0);
      wireAllSteps();
    },

    /** Check whether the user has seen all tips */
    isCompleted: isCompleted,

    /** Reset all tip flags (useful for testing / debugging) */
    reset: resetAll,
  };

  /* ------------------------------------------------------------------ */
  /* Wire "How to use Resonate" replay button in app menu                 */
  /* ------------------------------------------------------------------ */

  function wireTourButton() {
    var btn = document.getElementById('tour-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        setTimeout(function () {
          window.resonateOnboarding.start();
        }, SHEET_CLOSE_DELAY_MS);
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Auto-start for first-time visitors                                   */
  /* ------------------------------------------------------------------ */

  function maybeAutoStart() {
    wireTourButton();
    if (!isStepSeen(0)) {
      setTimeout(function () { showTip(0); }, AUTO_START_DELAY_MS);
    }
    wireAllSteps();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeAutoStart);
  } else {
    maybeAutoStart();
  }
})();
