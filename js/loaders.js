const Loaders = (() => {
  let activeLoader = null;
  let activeLoaderShownAt = 0;
  let hideTimer = null;
  const MIN_VISIBLE_MS = 220;

  // Loader explanations by context
  const loaderExplanations = {
    search: "Loading results, your multimedia experience is on the way.",
    playback: "Preparing your track for optimal playback.",
    buffering: "Buffering to keep playback smooth.",
    album: "Loading your album for seamless listening.",
    favorite: "Loading your resonates for reliable playback.",
    resontes: "Loading your resonates for reliable playback.",
    default: "Resonate is ensuring audio quality for an offline experience."
  };

  function showLoader({ type = "spinner", target = document.body, progress = 0, showProgress = false, context = "default" } = {}) {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    activeLoaderShownAt = Date.now();

    // If a loader is already active in the same target, reuse it to avoid flicker.
    if (activeLoader && activeLoader.parentElement === target) {
      try {
        activeLoader._showProgress = showProgress;
        const progressEl = activeLoader._progressEl;
        const messageEl = activeLoader._messageEl;

        if (progressEl) progressEl.style.display = showProgress ? '' : 'none';
        if (messageEl) {
          const explanation = loaderExplanations[context] || loaderExplanations.default;
          messageEl.textContent = explanation;
        }
      } catch {
        // best-effort
      }

      setProgress(progress);
      return;
    }

    if (activeLoader) hideLoader();

    const { overlay, progressEl, messageEl } = createLoaderElement(type, context);
    overlay._progressEl = progressEl;
    overlay._messageEl = messageEl;
    overlay._showProgress = showProgress;
    overlay._context = context;
    overlay._displayedProgress = 0;

    if (!showProgress && progressEl) {
      progressEl.style.display = 'none';
    }

    target.appendChild(overlay);
    activeLoader = overlay;

    setProgress(progress);
  }

  function _removeWithFade(el) {
    if (!el) return;
    el.classList.add('loader-overlay--hiding');
    // Fallback: remove after animation duration in case animationend doesn't fire
    const fallback = setTimeout(() => {
      try { el.remove(); } catch { /* best-effort */ }
    }, 300);
    el.addEventListener('animationend', () => {
      clearTimeout(fallback);
      try { el.remove(); } catch { /* best-effort */ }
    }, { once: true });
  }

  function hideLoader() {
    if (!activeLoader) return;
    const elapsed = Date.now() - activeLoaderShownAt;
    const el = activeLoader;
    activeLoader = null;
    if (elapsed < MIN_VISIBLE_MS) {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        hideTimer = null;
        _removeWithFade(el);
      }, MIN_VISIBLE_MS - elapsed);
      return;
    }
    _removeWithFade(el);
  }

  function createLoaderElement(type, context) {
    const overlay = document.createElement("div");
    overlay.className = "loader-overlay";

    const container = document.createElement("div");
    container.className = "loader-container";

    const loader = document.createElement("div");
    loader.className = "loader-spinner";

    const progressEl = document.createElement("div");
    progressEl.className = "loader-progress";
    progressEl.textContent = "0%";

    const messageEl = document.createElement("div");
    messageEl.className = "loader-message";
    messageEl.setAttribute("role", "status");
    messageEl.setAttribute("aria-live", "polite");
    const explanation = loaderExplanations[context] || loaderExplanations.default;
    messageEl.textContent = explanation;

    container.appendChild(loader);
    container.appendChild(progressEl);
    container.appendChild(messageEl);
    overlay.appendChild(container);

    return { overlay, progressEl, messageEl };
  }

  function setProgress(value) {
    if (!activeLoader || !activeLoader._progressEl) return;
    if (!activeLoader._showProgress) return; // Don't update if progress display is disabled
    const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
    const clamped = Math.max(0, Math.min(100, Math.round(numeric)));
    // Monotonic: never regress progress within a single loading cycle
    if (typeof activeLoader._displayedProgress === 'number' && clamped < activeLoader._displayedProgress) return;
    activeLoader._displayedProgress = clamped;
    activeLoader._progressEl.textContent = `${clamped}%`;
  }

  return {
    showLoader,
    hideLoader,
    setProgress,
  };
})();

window.Loaders = Loaders;