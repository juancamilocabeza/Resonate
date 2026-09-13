// Player Repeat Control
// UI-layer only: cycles repeat mode OFF -> ALL -> ONE -> OFF and keeps the
// button visuals in sync with the state layer (PlaybackStateManager), which
// persists the mode via localStorage ('playbackConfig').

(function () {
  'use strict';

  const RepeatModeRef = (typeof window !== 'undefined' && window.RepeatMode)
    ? window.RepeatMode
    : { OFF: 'off', ALL: 'all', ONE: 'one' };

  const CYCLE = ['off', 'all', 'one']; // RepeatMode.OFF, ALL, ONE

  function getRepeatBtn() {
    return (window.elements && window.elements.repeatBtn) || document.getElementById('repeat-btn');
  }

  function getStateManager() {
    return (window.playbackStateManager ||
            (window.playbackManager && window.playbackManager.stateManager)) || null;
  }

  function currentRepeatMode() {
    const sm = getStateManager();
    if (sm && typeof sm.getRepeatMode === 'function') {
      const mode = sm.getRepeatMode();
      if (mode === 'one') return 'one';
      if (mode === 'all') return 'all';
    }
    return 'all'; // legacy default is continuous repeat
  }

  function applyModeVisual(mode) {
    const btn = getRepeatBtn();
    if (!btn) return;

    btn.classList.remove('repeat-off', 'repeat-all', 'repeat-one');
    btn.classList.add(mode === 'one' ? 'repeat-one' : mode === 'all' ? 'repeat-all' : 'repeat-off');

    if (mode === 'one') {
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      btn.setAttribute('aria-label', 'Repeat one');
      btn.title = 'Repeat one';
    } else if (mode === 'all') {
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      btn.setAttribute('aria-label', 'Repeat all');
      btn.title = 'Repeat all';
    } else {
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', 'Repeat off');
      btn.title = 'Repeat';
    }

    const oneLabel = btn.querySelector('.repeat-one-label');
    if (oneLabel) oneLabel.style.display = mode === 'one' ? 'block' : 'none';
  }

  function setMode(mode) {
    const sm = getStateManager();
    if (sm && typeof sm.setRepeatMode === 'function') {
      sm.setRepeatMode(mode);
    }
    // Keep the module-level state var used by legacy code in sync.
    if (window.state && typeof window.state === 'object') {
      try { window.state.repeatMode = mode; } catch (e) {}
      if (window.state.playbackStateManager && window.state.playbackStateManager.state &&
          window.state.playbackStateManager.state.modes) {
        try { window.state.playbackStateManager.state.modes.repeat = mode; } catch (e) {}
      }
    }
    applyModeVisual(mode);
  }

  function cycleRepeat() {
    const current = currentRepeatMode();
    const idx = CYCLE.indexOf(current);
    const next = CYCLE[(idx + 1) % CYCLE.length];
    setMode(next);

    if (window.logger && typeof window.logger.info === 'function') {
      window.logger.info(`Repeat mode -> ${next}`, 'PLAYER');
    }

    const msg = next === 'one' ? 'Repeat one' : next === 'all' ? 'Repeat all' : 'Repeat off';
    if (typeof window.showStatus === 'function') {
      try { window.showStatus(msg, 'info', 1500); } catch (e) {}
    }
  }

  function setup() {
    const btn = getRepeatBtn();
    if (!btn) return;
    if (btn.dataset.resonateRepeatBound === 'true') return;
    btn.dataset.resonateRepeatBound = 'true';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cycleRepeat();
    });

    applyModeVisual(currentRepeatMode());
  }

  // Wait for DOM + elements cache
  function boot() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setup);
    } else {
      setup();
    }
  }

  // Re-sync when another component updates the mode (e.g. state restore).
  window.addEventListener('resonate:repeat-change', () => {
    applyModeVisual(currentRepeatMode());
  });

  window.PlayerRepeat = { cycle: cycleRepeat, setMode, current: currentRepeatMode };
  boot();
}());