const Loaders = (() => {
  const defaultStyles = {
    spinner: {
      border: "4px solid #f3f3f3",
      borderTop: "4px solid #3498db",
      borderRadius: "50%",
      width: "40px",
      height: "40px",
      animation: "spin 2s linear infinite",
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
  };

  let activeLoader = null;

  function showLoader({ type = "spinner", target = document.body } = {}) {
    if (activeLoader) hideLoader();

    const loaderElement = createLoaderElement(type);
    const overlay = document.createElement("div");
    Object.assign(overlay.style, defaultStyles.overlay);
    overlay.appendChild(loaderElement);

    target.appendChild(overlay);
    activeLoader = overlay;
  }

  function hideLoader() {
    if (activeLoader) {
      activeLoader.remove();
      activeLoader = null;
    }
  }

  function createLoaderElement(type) {
    const loader = document.createElement("div");
    Object.assign(loader.style, defaultStyles[type]);

    return loader;
  }

  function setLoaderStyles(styles) {
    Object.assign(defaultStyles, styles);
  }

  return {
    showLoader,
    hideLoader,
    setLoaderStyles,
  };
})();

window.Loaders = Loaders;