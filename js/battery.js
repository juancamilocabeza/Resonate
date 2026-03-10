/**
 * Battery Status Module
 * Deteccion automatica del modo ahorro de bateria del dispositivo
 * Integra Battery Status API con el sistema de temas de Resonate
 */

const Battery = (() => {
  let isBatterySaverMode = false;
  let batteryManager = null;

  // Battery-driven eco mode should be temporary and must not overwrite user preference.
  const ECO_OVERRIDE_ACTIVE_KEY = 'resonate-eco-battery-active';
  const ECO_OVERRIDE_PREV_THEME_KEY = 'resonate-eco-battery-prev-theme';

  /**
   * Inicializa el monitor de bateria
   * Solicita permiso y configura listeners
   */
  async function init() {
    // Verificar soporte de Battery Status API
    if (!navigator.getBattery && !navigator.battery) {
      console.info('Battery Status API is not available in this browser');
      return false;
    }

    try {
      // Intentar obtener el manager de bateria
      batteryManager = await navigator.getBattery?.() || navigator.battery;
      
      if (!batteryManager) {
        console.info('Battery Status API is not supported');
        return false;
      }

      // Detectar estado inicial
      checkBatteryState();

      // Configurar listeners para cambios (fallbacks incluidos)
      if (typeof batteryManager.addEventListener === 'function') {
        batteryManager.addEventListener('levelchange', checkBatteryState);
        batteryManager.addEventListener('chargingtimechange', checkBatteryState);
        batteryManager.addEventListener('dischargingtimechange', checkBatteryState);
        batteryManager.addEventListener('chargingchange', checkBatteryState);
      } else {
        batteryManager.onlevelchange = checkBatteryState;
        batteryManager.onchargingtimechange = checkBatteryState;
        batteryManager.ondischargingtimechange = checkBatteryState;
        batteryManager.onchargingchange = checkBatteryState;
      }

      return true;
    } catch (error) {
      console.info('Failed to initialize Battery Status API:', error.message);
      return false;
    }
  }

  /**
   * Verifica el estado actual de la bateria
   * Activa eco mode si bateria baja y no esta cargando
   */
  function checkBatteryState() {
    if (!batteryManager) return;

    const level = batteryManager.level || 0;
    const charging = batteryManager.charging || false;
    const dischargingTime = batteryManager.dischargingTime || Infinity;

    // Activar eco mode si:
    // - Bateria bajo 20% AND no esta cargando
    // - O bateria bajo 10% (independiente de carga)
    const shouldEnableEcoMode = 
      (!charging && level < 0.2) || 
      (level < 0.1);

    const wasEcoMode = isBatterySaverMode;
    isBatterySaverMode = shouldEnableEcoMode;

    // Si cambio el estado, notificar
    if (wasEcoMode !== shouldEnableEcoMode) {
      handleBatteryModeChange(shouldEnableEcoMode, level, charging);
    }

    logBatteryStatus(level, charging, dischargingTime);
  }

  /**
   * Maneja cambios en el modo de ahorro de bateria
   */
  function handleBatteryModeChange(isEcoMode, level, charging) {
    const themeManager = window.ThemeManager;
    
    if (isEcoMode && !charging) {
      // Solo cambiar a eco si no estamos cargando
      const savedTheme = themeManager?.getSavedTheme?.();
      if (savedTheme !== 'energy-saver') {
        try {
          localStorage.setItem(ECO_OVERRIDE_PREV_THEME_KEY, savedTheme || 'night');
          localStorage.setItem(ECO_OVERRIDE_ACTIVE_KEY, '1');
        } catch {}

        themeManager?.applyTheme?.('energy-saver');
        showBatteryNotification(level, true);
      }
    } else if (!isEcoMode && charging) {
      // Si estamos cargando nuevamente, desactivar eco solo si fue activado por batería.
      let shouldRestore = false;
      let prevTheme = 'night';
      try {
        shouldRestore = localStorage.getItem(ECO_OVERRIDE_ACTIVE_KEY) === '1';
        prevTheme = localStorage.getItem(ECO_OVERRIDE_PREV_THEME_KEY) || prevTheme;
      } catch {}

      if (shouldRestore) {
        // Clear eco override keys before restoring so applyTimeBasedTheme can proceed
        try {
          localStorage.removeItem(ECO_OVERRIDE_ACTIVE_KEY);
          localStorage.removeItem(ECO_OVERRIDE_PREV_THEME_KEY);
        } catch {}

        // Restore to time-based theme if no user preference, otherwise restore previous theme
        const hasUserPreference = typeof themeManager?.hasUserThemePreference === 'function'
          ? themeManager.hasUserThemePreference()
          : (() => { try { return localStorage.getItem('resonate-theme') !== null; } catch { return false; } })();
        if (!hasUserPreference && typeof themeManager?.applyTimeBasedTheme === 'function') {
          themeManager.applyTimeBasedTheme();
        } else {
          themeManager?.applyTheme?.(prevTheme);
        }
        showBatteryNotification(level, false);
      }
    }
  }

  /**
   * Muestra notificacion sobre estado de bateria
   */
  function showBatteryNotification(level, isEcoMode) {
    const percent = Math.round(level * 100);
    const message = isEcoMode 
      ? `Low battery (${percent}%). Energy Saver enabled`
      : `Charging. Energy Saver disabled`;

    // Log para debugging
    window.logger?.info(message, 'Battery');

    // Mostrar notificacion si existe el sistema
    if (window.ThemeManager?.showThemeNotification) {
      window.ThemeManager.showThemeNotification('energy-saver');
    }
  }

  /**
   * Log del estado de bateria para debugging
   */
  function logBatteryStatus(level, charging, dischargingTime) {
    const percent = Math.round(level * 100);
    const status = charging ? 'Charging' : 'Discharging';
    const timeRemaining = dischargingTime === Infinity 
      ? 'Unknown' 
      : `${Math.round(dischargingTime / 3600)}h`;

    if (window.logger?.debug) {
      window.logger.debug(
        `Battery: ${percent}% | ${status} | Time remaining: ${timeRemaining}`,
        'Battery'
      );
    }
  }

  /**
   * Retorna estado actual del ahorro de bateria
   */
  function isBatterySavingMode() {
    return isBatterySaverMode;
  }

  /**
   * Obtiene nivel actual de bateria (0-1)
   */
  function getLevel() {
    return batteryManager?.level ?? null;
  }

  /**
   * Retorna si el dispositivo esta cargando
   */
  function isCharging() {
    return batteryManager?.charging ?? null;
  }

  return {
    init,
    isBatterySavingMode,
    getLevel,
    isCharging
  };
})();

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Battery.init());
} else {
  Battery.init();
}
