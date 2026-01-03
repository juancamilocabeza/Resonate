const Loaders = (() => {
  const defaultStyles = {
    spinner: {
      border: "var(--loader-border-width, 4px) solid #f3f3f3",
      borderTop: "var(--loader-border-width, 4px) solid #6ee7b7aa",
      borderRadius: "50%",
      width: "var(--loader-size, 40px)",
      height: "var(--loader-size, 40px)",
      animation: "spin var(--loader-duration, 2s) linear infinite",
    },
    overlay: {
      position: "fixed",
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      zIndex: 9999,
    },
    container: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "12px",
      padding: "16px 20px",
      backgroundColor: "rgba(12, 12, 12, 0.65)",
      borderRadius: "12px",
      border: "1px solid rgba(110, 231, 183, 0.3)",
      boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)",
      minWidth: "140px",
    },
    progressText: {
      color: "#f8fafc",
      fontSize: "14px",
      fontWeight: "700",
      letterSpacing: "0.6px",
      textAlign: "center",
      textShadow: "0 2px 8px rgba(0, 0, 0, 0.4)",
      minWidth: "48px",
    },
    messageText: {
      color: "#d1d5db",
      fontSize: "12px",
      fontWeight: "400",
      textAlign: "center",
      lineHeight: "1.4",
      maxWidth: "280px",
      marginTop: "4px",
      opacity: "0.85",
    },
  };

  let activeLoader = null;

  function showLoader({ type = "spinner", target = document.body, progress = 0, showProgress = false } = {}) {
    if (activeLoader) hideLoader();

    const { overlay, progressEl, messageEl } = createLoaderElement(type);
    overlay._progressEl = progressEl;
    overlay._messageEl = messageEl;
    overlay._showProgress = showProgress;

    // Hide progress and message if showProgress is false
    if (!showProgress && progressEl) {
      progressEl.style.display = 'none';
    }
    if (!showProgress && messageEl) {
      messageEl.style.display = 'none';
    }

    target.appendChild(overlay);
    activeLoader = overlay;

    setProgress(progress);
  }

  function hideLoader() {
    if (activeLoader) {
      activeLoader.remove();
      activeLoader = null;
    }
  }

  function createLoaderElement(type) {
    const overlay = document.createElement("div");
    overlay.className = "loader-overlay";
    // Don't override CSS - overlay uses class for styles
    
    const container = document.createElement("div");
    container.className = "loader-container";
    // Don't override CSS - container uses class for styles

    const loader = document.createElement("div");
    loader.className = "loader-spinner";
    // Spinner uses CSS class for animation - no inline styles needed

    const progressEl = document.createElement("div");
    progressEl.className = "loader-progress";
    Object.assign(progressEl.style, defaultStyles.progressText);
    progressEl.textContent = "0%";

    const messageEl = document.createElement("div");
    messageEl.className = "loader-message";
    Object.assign(messageEl.style, defaultStyles.messageText);
    messageEl.textContent = "Resonate is ensuring audio quality for an offline experience";

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
    activeLoader._progressEl.textContent = `${clamped}%`;
  }

  function setLoaderStyles(styles) {
    Object.assign(defaultStyles, styles);
  }

  return {
    showLoader,
    hideLoader,
    setLoaderStyles,
    setProgress,
  };
})();

window.Loaders = Loaders;