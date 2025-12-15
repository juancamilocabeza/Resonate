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

  shouldLog(level, category = 'SYSTEM') {
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
      return JSON.stringify(message);
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
    const timestamp = this.config.timestamps ? `[${new Date().toISOString()}]` : '';
    const normalizedCategory = this._normalizeCategory(category);
    const prefix = normalizedCategory ? `[${normalizedCategory}]` : '';
    const formattedMessage = this._formatMessage(message);
    const formatted = `${timestamp}${prefix} ${formattedMessage}`;

    // Output basado en el nivel
    switch (level) {
      case 'DEBUG':
        console.debug(formatted);
        break;
      case 'INFO':
        console.log(formatted);
        break;
      case 'WARN':
        console.warn(formatted);
        break;
      case 'ERROR':
        console.error(formatted);
        break;
    }
  }
}

// Factory function para crear logger con configuración basada en entorno
function createLogger() {
  // Determinar entorno para configuración de logging
  const isDevelopment =
    window.location.protocol === 'file:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.includes('dev.') ||
    window.location.port === '3000' ||
    window.location.port === '8080' ||
    window.location.search.includes('debug=true') ||
    window.location.hash.includes('#dev');

  const config = {
    level: isDevelopment ? 'DEBUG' : 'INFO', // DEBUG for development, INFO for production
    environment: isDevelopment ? 'development' : 'production',
    verbose: isDevelopment,
    timestamps: isDevelopment,
    categories: ['ALL']
  };

  // Permitir override via URL params
  const urlParams = new URLSearchParams(window.location.search);
  const logLevel = urlParams.get('log');
  if (logLevel && ['DEBUG', 'INFO', 'WARN', 'ERROR', 'NONE'].includes(logLevel.toUpperCase())) {
    config.level = logLevel.toUpperCase();
  }

  // Permitir override via localStorage
  const storedLevel = localStorage.getItem('resonate_log_level');
  if (storedLevel) {
    const upper = storedLevel.toUpperCase();
    if (upper in LOGGER_LEVELS) {
      config.level = upper;
    }
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