/**
 * Battery Status Module
 * Deteccion automatica del modo ahorro de bateria del dispositivo
 * Integra Battery Status API con el sistema de temas de Resonate
 */

const Battery = (() => {
  let isBatterySaverMode = false;
  let batteryManager = null;

  /**
   * Inicializa el monitor de bateria
   * Solicita permiso y configura listeners
   */
  async function init() {
    // Verificar soporte de Battery Status API
    if (!navigator.getBattery && !navigator.battery) {
      console.info('Battery Status API no disponible en este navegador');
      return false;
    }

    try {
      // Intentar obtener el manager de bateria
      batteryManager = await navigator.getBattery?.() || navigator.battery;
      
      if (!batteryManager) {
        console.info('Battery Status API sin soporte');
        return false;
      }

      // Detectar estado inicial
      checkBatteryState();

      // Configurar listeners para cambios
      batteryManager.addEventListener('levelchange', checkBatteryState);
      batteryManager.addEventListener('chargingtimechange', checkBatteryState);
      batteryManager.addEventListener('dischargingtimechange', checkBatteryState);
      batteryManager.addEventListener('chargingchange', checkBatteryState);

      return true;
    } catch (error) {
      console.info('No se pudo inicializar Battery Status API:', error.message);
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
      if (themeManager?.getSavedTheme?.() !== 'energy-saver') {
        themeManager?.applyTheme?.('energy-saver');
        themeManager?.saveTheme?.('energy-saver');
        showBatteryNotification(level, true);
      }
    } else if (!isEcoMode && charging) {
      // Si estamos cargando nuevamente, volver al tema anterior
      const savedTheme = themeManager?.getSavedTheme?.();
      if (savedTheme === 'energy-saver') {
        // Volver al tema predeterminado (noche)
        themeManager?.applyTheme?.('night');
        themeManager?.saveTheme?.('night');
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
      ? `🔋 Batería baja (${percent}%). Activado modo ahorro de energía`
      : `⚡ Cargando. Desactivado modo ahorro de energía`;

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
    const status = charging ? 'Cargando' : 'Descargando';
    const timeRemaining = dischargingTime === Infinity 
      ? 'Desconocido' 
      : `${Math.round(dischargingTime / 3600)}h`;

    if (window.logger?.debug) {
      window.logger.debug(
        `Battery: ${percent}% | ${status} | Tiempo restante: ${timeRemaining}`,
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
