/**
 * player-ux.js — UX behaviour for the player (no frameworks).
 *
 *  - Expandable mobile mini-player (#player-expand-btn → #player-footer)
 *  - Rotating "vinyl" artwork while a track plays (is-playing class)
 *  - Adds body.has-track as soon as a real track is loaded so the expand
 *    affordance only appears when the player has something to show.
 */

(function () {
  'use strict';

  var footer = null;
  var expandBtn = null;

  function getState() {
    try {
      return window.state || null;
    } catch (e) {
      return null;
    }
  }

  function syncHasTrackClass() {
    var st = getState();
    var hasTrack = false;
    if (st) {
      hasTrack = !!(st.currentTrack && (st.currentTrack.url || st.currentTrack.id));
    }
    document.body.classList.toggle('has-track', hasTrack);
  }

  function syncArtworkPlayingClass() {
    var art = document.getElementById('art');
    if (!art) return;
    var audio = document.getElementById('audio');
    var st = window.state || null;
    var hasTrack = !!(st && st.currentTrack && (st.currentTrack.url || st.currentTrack.id));

    // "is-playing" persists for the whole loaded track so the vinyl stays
    // round; "paused" freezes the spin while playback is paused.
    var playing = !!(audio && !audio.paused && !audio.ended && audio.src);
    art.classList.toggle('is-playing', hasTrack);
    art.classList.toggle('paused', hasTrack && !playing);
  }

  function closeExpanded() {
    if (!footer) return;
    footer.classList.remove('player-expanded');
    if (expandBtn) {
      expandBtn.setAttribute('aria-expanded', 'false');
      expandBtn.setAttribute('aria-label', 'Expand player controls');
    }
    if (expandBtn && expandBtn.focus && document.activeElement === footer) {
      try { expandBtn.focus(); } catch (e) {}
    }
  }

  function openExpanded() {
    if (!footer) return;
    footer.classList.add('player-expanded');
    if (expandBtn) {
      expandBtn.setAttribute('aria-expanded', 'true');
      expandBtn.setAttribute('aria-label', 'Collapse player controls');
    }
  }

  function toggleExpanded() {
    if (footer && footer.classList.contains('player-expanded')) {
      closeExpanded();
    } else {
      openExpanded();
    }
  }

  function init() {
    footer = document.getElementById('player-footer');
    expandBtn = document.getElementById('player-expand-btn');

    if (footer) {
      // Tapping the mini-player body (not a control) expands the sheet.
      footer.addEventListener('click', function (ev) {
        if (footer.classList.contains('player-expanded')) return;
        var target = ev.target;
        // Don't hijack clicks on interactive elements (buttons, links, range inputs).
        if (target && target.closest && target.closest('button, a, input, [role="slider"]')) return;
        // Only in the mobile mini-player layout is this the "tap to expand" affordance.
        if (window.matchMedia('(max-width: 767px)').matches) {
          openExpanded();
        }
      });
    }

    if (expandBtn) {
      expandBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        toggleExpanded();
      });
    }

    // Escape collapses the expanded sheet.
    // (Capture phase so it wins over onboarding's capture handler when the
    // player is expanded.)
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && footer && footer.classList.contains('player-expanded')) {
        ev.preventDefault();
        ev.stopPropagation();
        closeExpanded();
        if (expandBtn) {
          try { expandBtn.focus(); } catch (e) {}
        }
      }
    }, true);

    // Keep the track/playback state in sync regardless of which module set it.
    var lastUrl = null;
    var lastPlaying = null;
    setInterval(function () {
      var st = getState();
      var url;
      try {
        url = st && st.currentTrack ? (st.currentTrack.url || st.currentTrack.id || null) : null;
      } catch (e) {
        url = null;
      }
      var audio = document.getElementById('audio');
      var playing = !!(audio && !audio.paused && !audio.ended && audio.src);
      if (url !== lastUrl || playing !== lastPlaying) {
        lastUrl = url;
        lastPlaying = playing;
        syncHasTrackClass();
        syncArtworkPlayingClass();
      }
    }, 500);

    syncHasTrackClass();
    syncArtworkPlayingClass();

    // Play/pause → artwork spin.
    var audio = document.getElementById('audio');
    if (audio) {
      audio.addEventListener('play', function () {
        syncArtworkPlayingClass();
      });
      audio.addEventListener('pause', function () {
        syncArtworkPlayingClass();
      });
      audio.addEventListener('ended', function () {
        syncArtworkPlayingClass();
      });
    }

    if (window.__resonateUxEnabled) return;
    window.__resonateUxEnabled = true;
    window.syncArtworkPlayingClass = syncArtworkPlayingClass;
    window.syncPlayerUX = syncHasTrackClass;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();