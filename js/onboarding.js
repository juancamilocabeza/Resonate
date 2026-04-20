/**
 * onboarding.js — Resonate App Onboarding Tour
 *
 * Displays a 5-step coach-mark tour for new users so they learn
 * the core features (search, play, resonate, app menu) quickly.
 *
 * Features:
 *  - Auto-shows once for new users (localStorage flag)
 *  - Can be replayed from the app menu
 *  - Spotlight technique highlights real UI elements
 *  - Keyboard support: Escape = skip, Tab-navigable buttons
 *  - Accessible: ARIA roles, live region, focus management
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'resonate_onboarding_v1';

  // Timing constants
  var AUTO_START_DELAY_MS  = 900;  // wait for app to fully render before showing tour
  var SHEET_CLOSE_DELAY_MS = 300;  // wait for app-menu sheet to finish closing
  var FOCUS_DELAY_MS       = 60;   // short delay before moving focus to the next button
  var CARD_FADE_MS         = 200;  // card fade-out duration before updating content

  var STEPS = [
    {
      icon: '🎵',
      title: 'Welcome to Resonate',
      body: 'Discover and play millions of free tracks from the Internet Archive. Let us show you around in 5 quick steps.',
      target: null,
    },
    {
      icon: '🔍',
      title: 'Search any music',
      body: 'Type a song, artist, album, or podcast. Resonate searches a huge free library for you instantly.',
      target: '#search-input',
    },
    {
      icon: '▶',
      title: 'Play instantly',
      body: 'Tap Play to start listening. No sign-up, no subscription — just hit play and enjoy.',
      target: '#play-btn',
    },
    {
      icon: '💙',
      title: 'Save what you love',
      body: 'Tap the Resonate button to save favourite tracks. Access them any time, even offline.',
      target: '#favorite-btn',
    },
    {
      icon: '🚀',
      title: "You're all set!",
      body: 'Search, play, and resonate with your favourite music. Have fun exploring!',
      target: null,
    },
  ];

  var currentStep = 0;
  var active = false;
  var overlayEl = null;
  var spotlightEl = null;
  var cardEl = null;
  var fadeTimer = null;

  /* ------------------------------------------------------------------ */
  /* Persistence helpers                                                  */
  /* ------------------------------------------------------------------ */

  function isCompleted() {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'done';
    } catch (e) {
      return true; // If localStorage is unavailable, don't show
    }
  }

  function markCompleted() {
    try {
      localStorage.setItem(STORAGE_KEY, 'done');
    } catch (e) {
      // ignore
    }
  }

  /* ------------------------------------------------------------------ */
  /* DOM construction (lazy, built once)                                  */
  /* ------------------------------------------------------------------ */

  function buildDom() {
    if (overlayEl) return;

    overlayEl = document.createElement('div');
    overlayEl.id = 'onboarding-overlay';
    overlayEl.className = 'onboarding-overlay';
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('aria-modal', 'true');
    overlayEl.setAttribute('aria-label', 'Resonate welcome tour');
    overlayEl.setAttribute('hidden', '');

    spotlightEl = document.createElement('div');
    spotlightEl.className = 'onboarding-spotlight';
    spotlightEl.setAttribute('aria-hidden', 'true');
    overlayEl.appendChild(spotlightEl);

    cardEl = document.createElement('div');
    cardEl.className = 'onboarding-card';
    cardEl.setAttribute('role', 'document');
    cardEl.innerHTML =
      '<div class="onboarding-card-top">' +
        '<div class="onboarding-progress" id="ob-progress" aria-hidden="true"></div>' +
        '<button class="onboarding-skip-btn" id="ob-skip-btn" type="button" aria-label="Skip tour">Skip</button>' +
      '</div>' +
      '<div class="onboarding-icon" id="ob-icon" aria-hidden="true"></div>' +
      '<h2 class="onboarding-title" id="ob-title"></h2>' +
      '<p class="onboarding-body" id="ob-body"></p>' +
      '<div class="onboarding-actions">' +
        '<button class="onboarding-next-btn" id="ob-next-btn" type="button">Next →</button>' +
      '</div>';
    overlayEl.appendChild(cardEl);

    document.body.appendChild(overlayEl);

    document.getElementById('ob-skip-btn').addEventListener('click', finish);
    document.getElementById('ob-next-btn').addEventListener('click', nextStep);
    document.addEventListener('keydown', handleKeyDown, true);
  }

  /* ------------------------------------------------------------------ */
  /* Keyboard handler                                                     */
  /* ------------------------------------------------------------------ */

  function handleKeyDown(e) {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Step rendering                                                       */
  /* ------------------------------------------------------------------ */

  function updateProgressDots() {
    var container = document.getElementById('ob-progress');
    if (!container) return;
    container.innerHTML = '';
    for (var i = 0; i < STEPS.length; i++) {
      var dot = document.createElement('span');
      dot.className = 'onboarding-dot' + (i === currentStep ? ' onboarding-dot-active' : '');
      container.appendChild(dot);
    }
  }

  function positionSpotlight(targetEl) {
    if (!targetEl) {
      spotlightEl.style.display = 'none';
      overlayEl.classList.add('onboarding-full-backdrop');
      return;
    }

    overlayEl.classList.remove('onboarding-full-backdrop');
    var rect = targetEl.getBoundingClientRect();
    var pad = 10;
    spotlightEl.style.display = 'block';
    spotlightEl.style.top    = (rect.top    - pad) + 'px';
    spotlightEl.style.left   = (rect.left   - pad) + 'px';
    spotlightEl.style.width  = (rect.width  + pad * 2) + 'px';
    spotlightEl.style.height = (rect.height + pad * 2) + 'px';
    spotlightEl.style.boxShadow =
      '0 0 0 9999px rgba(0,0,0,0.78), ' +
      '0 0 0 3px var(--primary, #3da9ff), ' +
      '0 0 18px rgba(61,169,255,0.38)';
  }

  function positionCard(targetEl) {
    var CARD_W = 300;
    var CARD_H = 230; // rough estimate
    var PAD    = 16;
    var ARROW  = 14;
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    if (!targetEl) {
      // Centered card
      cardEl.style.position  = 'fixed';
      cardEl.style.top       = '50%';
      cardEl.style.left      = '50%';
      cardEl.style.transform = 'translate(-50%, -50%)';
      cardEl.style.bottom    = 'auto';
      cardEl.style.right     = 'auto';
      return;
    }

    var rect = targetEl.getBoundingClientRect();
    var top, left;

    // Prefer placing card below the target; fall back to above
    if (rect.bottom + ARROW + CARD_H + PAD <= vh) {
      top = rect.bottom + ARROW;
    } else {
      top = rect.top - ARROW - CARD_H;
    }

    // Horizontally centre on target, clamped within viewport
    left = rect.left + rect.width / 2 - CARD_W / 2;
    left = Math.max(PAD, Math.min(left, vw - CARD_W - PAD));
    top  = Math.max(PAD, top);

    cardEl.style.position  = 'fixed';
    cardEl.style.top       = top + 'px';
    cardEl.style.left      = left + 'px';
    cardEl.style.transform = 'none';
    cardEl.style.bottom    = 'auto';
    cardEl.style.right     = 'auto';
  }

  function renderStep(index) {
    var step = STEPS[index];
    if (!step) { finish(); return; }

    var nextBtn = document.getElementById('ob-next-btn');

    document.getElementById('ob-icon').textContent  = step.icon;
    document.getElementById('ob-title').textContent = step.title;
    document.getElementById('ob-body').textContent  = step.body;

    var isLast = (index === STEPS.length - 1);
    nextBtn.textContent = isLast ? 'Start listening 🎶' : 'Next →';

    var skipBtn = document.getElementById('ob-skip-btn');
    skipBtn.style.visibility = isLast ? 'hidden' : 'visible';

    updateProgressDots();

    var targetEl = step.target ? document.querySelector(step.target) : null;
    positionSpotlight(targetEl);
    positionCard(targetEl);

    void nextBtn.offsetWidth;
  }

  /* ------------------------------------------------------------------ */
  /* Step transitions — fade card out, update content, fade back in      */
  /* ------------------------------------------------------------------ */

  function showStep(index) {
    currentStep = index;

    if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }

    // Fade out
    cardEl.classList.remove('onboarding-card-visible');

    fadeTimer = setTimeout(function () {
      renderStep(index);
      // Short RAF ensures the card has repositioned before fading in
      requestAnimationFrame(function () {
        cardEl.classList.add('onboarding-card-visible');
        // Focus next button for keyboard users
        setTimeout(function () {
          var btn = document.getElementById('ob-next-btn');
          if (btn) { try { btn.focus(); } catch (e) {} }
        }, FOCUS_DELAY_MS);
      });
    }, CARD_FADE_MS);
  }

  /* ------------------------------------------------------------------ */
  /* Public controls                                                      */
  /* ------------------------------------------------------------------ */

  function nextStep() {
    if (currentStep < STEPS.length - 1) {
      showStep(currentStep + 1);
    } else {
      finish();
    }
  }

  function finish() {
    markCompleted();
    hide();
  }

  function show() {
    buildDom();
    active      = true;
    currentStep = 0;

    overlayEl.removeAttribute('hidden');
    overlayEl.classList.add('onboarding-initial-show');
    document.body.classList.add('onboarding-active');

    renderStep(0);
    requestAnimationFrame(function () {
      cardEl.classList.add('onboarding-card-visible');
      setTimeout(function () {
        var btn = document.getElementById('ob-next-btn');
        if (btn) { try { btn.focus(); } catch (e) {} }
        // Remove initial-show class after animation completes
        setTimeout(function () {
          if (overlayEl) overlayEl.classList.remove('onboarding-initial-show');
        }, 450);
      }, FOCUS_DELAY_MS);
    });
  }

  function hide() {
    active = false;
    if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }

    if (cardEl)   cardEl.classList.remove('onboarding-card-visible');
    document.body.classList.remove('onboarding-active');

    setTimeout(function () {
      if (overlayEl) overlayEl.setAttribute('hidden', '');
    }, 280);
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                           */
  /* ------------------------------------------------------------------ */

  window.resonateOnboarding = {
    /** Start or replay the tour */
    start: function () { show(); },
    /** Check whether the user has already completed the tour */
    isCompleted: isCompleted,
    /** Reset completion flag (for testing) */
    reset: function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    },
  };

  /* ------------------------------------------------------------------ */
  /* Wire "How to use Resonate" button in app menu                        */
  /* ------------------------------------------------------------------ */

  function wireTourButton() {
    var btn = document.getElementById('tour-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        // Small delay so the sheet finishes closing before the tour opens
        setTimeout(show, SHEET_CLOSE_DELAY_MS);
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Auto-start for first-time visitors                                   */
  /* ------------------------------------------------------------------ */

  function maybeAutoStart() {
    wireTourButton();
    if (isCompleted()) return;
    // Give the app AUTO_START_DELAY_MS to fully render before showing the tour
    setTimeout(show, AUTO_START_DELAY_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeAutoStart);
  } else {
    maybeAutoStart();
  }
})();
