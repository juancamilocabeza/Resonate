// Logger.js - Sistema de logging centralizado para Resonate

const LOGGER_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4
};

const LOGGER_CATEGORIES = {
  ALL: ['CACHE', 'PLAYBACK', 'NETWORK', 'UI', 'SYSTEM', 'INIT'],
  CACHE: ['CACHE'],
  PLAYBACK: ['PLAYBACK'],
  NETWORK: ['NETWORK'],
  UI: ['UI'],
  SYSTEM: ['SYSTEM'],
  INIT: ['INIT']
};

class Logger {
  constructor(config = {}) {
    this.LEVELS = LOGGER_LEVELS;
    this.CATEGORIES = LOGGER_CATEGORIES;

    this.config = {
      enabled: config.enabled !== false,
      level: this._normalizeLevel(config.level || 'DEBUG'),
      environment: config.environment || 'development',
      verbose: config.verbose !== false,
      timestamps: config.timestamps !== false,
      categories: Array.isArray(config.categories) ? config.categories.map(this._normalizeCategory) : ['ALL']
    };

    this._refreshCategoryCache();
  }

  setConfig(newConfig) {
    const merged = { ...this.config, ...(newConfig || {}) };
    merged.enabled = merged.enabled !== false;
    merged.level = this._normalizeLevel(merged.level);
    merged.categories = Array.isArray(merged.categories)
      ? merged.categories.map(this._normalizeCategory)
      : this.config.categories;

    this.config = merged;
    this._refreshCategoryCache();
  }

  setLevel(level) {
    this.config.level = this._normalizeLevel(level);
  }

  enable(level) {
    this.config.enabled = true;
    if (level) this.setLevel(level);
  }

  disable() {
    this.config.enabled = false;
  }

  shouldLog(level, category = 'SYSTEM') {
    if (!this.config.enabled) return false;

    const normalizedLevel = this._normalizeLevel(level);
    const normalizedCategory = this._normalizeCategory(category);

    // Verificar si el nivel está habilitado
    if (this.LEVELS[this.config.level] > this.LEVELS[normalizedLevel]) {
      return false;
    }

    // Verificar si la categoría está habilitada
    if (this._allCategoriesEnabled) return true;
    return this._enabledCategoriesSet.has(normalizedCategory);
  }

  debug(message, category = 'SYSTEM') {
    if (this.shouldLog('DEBUG', category)) {
      this._output('DEBUG', message, category);
    }
  }

  log(message, category = 'SYSTEM') {
    this.info(message, category);
  }

  info(message, category = 'SYSTEM') {
    if (this.shouldLog('INFO', category)) {
      this._output('INFO', message, category);
    }
  }

  warn(message, category = 'SYSTEM') {
    if (this.shouldLog('WARN', category)) {
      this._output('WARN', message, category);
    }
  }

  error(message, category = 'SYSTEM') {
    if (this.shouldLog('ERROR', category)) {
      this._output('ERROR', message, category);
    }
  }

  _normalizeLevel(level) {
    const upper = String(level || '').toUpperCase();
    if (upper in this.LEVELS) return upper;
    // Allow lowercase method-like levels for convenience
    const methodMap = { debug: 'DEBUG', info: 'INFO', warn: 'WARN', error: 'ERROR', none: 'NONE', log: 'INFO' };
    const mapped = methodMap[String(level || '').toLowerCase()];
    return mapped || 'INFO';
  }

  _normalizeCategory(category) {
    const c = String(category || 'SYSTEM').trim();
    return c ? c.toUpperCase() : 'SYSTEM';
  }

  _refreshCategoryCache() {
    const categories = Array.isArray(this.config.categories) ? this.config.categories : ['ALL'];
    this._allCategoriesEnabled = categories.includes('ALL');
    this._enabledCategoriesSet = new Set();

    for (const cat of categories) {
      const normalized = this._normalizeCategory(cat);
      const list = this.CATEGORIES[normalized];
      if (Array.isArray(list)) {
        for (const leaf of list) this._enabledCategoriesSet.add(this._normalizeCategory(leaf));
      }
    }
  }

  _formatMessage(message) {
    try {
      if (message instanceof Error) {
        return message.stack || message.message || String(message);
      }
      if (typeof message === 'string') return message;
      if (message === null || message === undefined) return String(message);
      const seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
      const replacer = (_key, value) => {
        try {
          if (value instanceof Error) {
            return {
              name: value.name,
              message: value.message,
              stack: value.stack
            };
          }

          if (seen && value && typeof value === 'object') {
            if (seen.has(value)) return '[circular]';
            seen.add(value);
          }
        } catch {
          // ignore
        }
        return value;
      };

      return JSON.stringify(message, replacer);
    } catch {
      try {
        return String(message);
      } catch {
        return '[unprintable]';
      }
    }
  }

  _call(level, message, category) {
    const normalizedLevel = this._normalizeLevel(level);
    const normalizedCategory = this._normalizeCategory(category);
    switch (normalizedLevel) {
      case 'DEBUG':
        this.debug(message, normalizedCategory);
        break;
      case 'INFO':
        this.info(message, normalizedCategory);
        break;
      case 'WARN':
        this.warn(message, normalizedCategory);
        break;
      case 'ERROR':
        this.error(message, normalizedCategory);
        break;
      default:
        this.info(message, normalizedCategory);
        break;
    }
  }

  _output(level, message, category) {
    if (!this.config.enabled) return;

    const timestamp = this.config.timestamps ? `[${new Date().toISOString()}]` : '';
    const normalizedCategory = this._normalizeCategory(category);
    const prefix = normalizedCategory ? `[${normalizedCategory}]` : '';
    const formattedMessage = this._formatMessage(message);
    const formatted = `${timestamp}${prefix} ${formattedMessage}`;

    // Output basado en el nivel
    const c = Logger._console || console;
    switch (level) {
      case 'DEBUG':
        try { c.debug(formatted); } catch {}
        break;
      case 'INFO':
        try { c.log(formatted); } catch {}
        break;
      case 'WARN':
        try { c.warn(formatted); } catch {}
        break;
      case 'ERROR':
        try { c.error(formatted); } catch {}
        break;
    }
  }
}

// Capture a stable reference to the original console early.
// This allows us to silence global console in production while still
// having a safe target when debug is explicitly enabled.
Logger._console = (() => {
  try {
    if (!globalThis) return null;
    const c = globalThis.__resonate_original_console__ || globalThis.console;
    if (!c) return null;
    return {
      debug: typeof c.debug === 'function' ? c.debug.bind(c) : (typeof c.log === 'function' ? c.log.bind(c) : () => {}),
      log: typeof c.log === 'function' ? c.log.bind(c) : () => {},
      info: typeof c.info === 'function' ? c.info.bind(c) : (typeof c.log === 'function' ? c.log.bind(c) : () => {}),
      warn: typeof c.warn === 'function' ? c.warn.bind(c) : (typeof c.log === 'function' ? c.log.bind(c) : () => {}),
      error: typeof c.error === 'function' ? c.error.bind(c) : (typeof c.log === 'function' ? c.log.bind(c) : () => {})
    };
  } catch {
    return null;
  }
})();

function safeGetLocalStorageItem(key) {
  try {
    return globalThis.localStorage ? globalThis.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function isTruthy(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function silenceConsole() {
  try {
    const c = globalThis.console;
    if (!c) return;
    const noop = () => {};
    // Keep a reference in case someone wants to restore manually from DevTools.
    if (!globalThis.__resonate_original_console__) {
      globalThis.__resonate_original_console__ = {
        debug: typeof c.debug === 'function' ? c.debug.bind(c) : (typeof c.log === 'function' ? c.log.bind(c) : () => {}),
        log: typeof c.log === 'function' ? c.log.bind(c) : () => {},
        info: typeof c.info === 'function' ? c.info.bind(c) : (typeof c.log === 'function' ? c.log.bind(c) : () => {}),
        warn: typeof c.warn === 'function' ? c.warn.bind(c) : (typeof c.log === 'function' ? c.log.bind(c) : () => {}),
        error: typeof c.error === 'function' ? c.error.bind(c) : (typeof c.log === 'function' ? c.log.bind(c) : () => {})
      };
    }
    c.debug = noop;
    c.log = noop;
    c.info = noop;
    c.warn = noop;
    c.error = noop;
  } catch {
    // ignore
  }
}

// Factory function para crear logger con configuración basada en entorno
function createLogger() {
  // Determinar entorno para configuración de logging
  const loc = window.location;
  const isDevelopment =
    loc.protocol === 'file:' ||
    loc.hostname === 'localhost' ||
    loc.hostname === '127.0.0.1' ||
    loc.hostname.includes('dev.') ||
    loc.port === '3000' ||
    loc.port === '8080' ||
    loc.hash.includes('#dev');

  const urlParams = (() => {
    try {
      return new URLSearchParams(loc.search);
    } catch {
      return new URLSearchParams();
    }
  })();

  const debugParam = urlParams.get('debug');
  const logLevelParam = urlParams.get('log');
  const storedDebug = safeGetLocalStorageItem('resonate_debug');
  const storedLevel = safeGetLocalStorageItem('resonate_log_level');
  const debugExplicitlyEnabled =
    isTruthy(debugParam) ||
    isTruthy(storedDebug) ||
    (typeof logLevelParam === 'string' && logLevelParam.length > 0) ||
    (typeof storedLevel === 'string' && storedLevel.length > 0 && storedLevel.toUpperCase() !== 'NONE');

  const config = {
    // In production we default to fully silent; enable logs only with explicit debug flags.
    enabled: isDevelopment || debugExplicitlyEnabled,
    level: isDevelopment ? 'DEBUG' : 'NONE',
    environment: isDevelopment ? 'development' : 'production',
    verbose: isDevelopment,
    timestamps: isDevelopment,
    categories: ['ALL']
  };

  // Explicit overrides (only take effect if provided)
  if (logLevelParam && ['DEBUG', 'INFO', 'WARN', 'ERROR', 'NONE'].includes(logLevelParam.toUpperCase())) {
    config.level = logLevelParam.toUpperCase();
    // If user asked for a log level in prod, enable logging.
    if (!isDevelopment) config.enabled = config.level !== 'NONE';
  }

  if (storedLevel) {
    const upper = storedLevel.toUpperCase();
    if (upper in LOGGER_LEVELS) {
      config.level = upper;
      if (!isDevelopment) config.enabled = upper !== 'NONE';
    }
  }

  // Hard guarantee: in production, silence the global console unless debug is explicitly enabled.
  if (!isDevelopment && !debugExplicitlyEnabled) {
    silenceConsole();
  }

  return new Logger(config);
}

// Exportar logger global
window.logger = createLogger();

// Methods for backward compatibility and convenience
window.logger.cache = function (message, level = 'info') {
  window.logger._call(level, message, 'CACHE');
};

window.logger.playback = function (message, level = 'info') {
  window.logger._call(level, message, 'PLAYBACK');
};

window.logger.network = function (message, level = 'info') {
  window.logger._call(level, message, 'NETWORK');
};

window.logger.ui = function (message, level = 'info') {
  window.logger._call(level, message, 'UI');
};

window.logger.system = function (message, level = 'info') {
  window.logger._call(level, message, 'SYSTEM');
};