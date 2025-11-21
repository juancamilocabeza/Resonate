// Logger.js - Sistema de logging centralizado para Resonate
class Logger {
  constructor(config = {}) {
    this.config = {
      level: config.level || 'INFO', // DEBUG, INFO, WARN, ERROR, NONE
      environment: config.environment || 'development',
      verbose: config.verbose !== false,
      timestamps: config.timestamps !== false,
      categories: config.categories || ['ALL']
    };

    // Definir niveles de logging
    this.LEVELS = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3,
      NONE: 4
    };

    // Categorías disponibles
    this.CATEGORIES = {
      ALL: ['CACHE', 'PLAYBACK', 'NETWORK', 'WASM', 'UI', 'SYSTEM'],
      CACHE: ['CACHE'],
      PLAYBACK: ['PLAYBACK'],
      NETWORK: ['NETWORK'],
      WASM: ['WASM'],
      UI: ['UI'],
      SYSTEM: ['SYSTEM']
    };
  }

  setConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  setLevel(level) {
    this.config.level = level.toUpperCase();
  }

  shouldLog(level, category = 'SYSTEM') {
    // Verificar si el nivel está habilitado
    if (this.LEVELS[this.config.level] > this.LEVELS[level.toUpperCase()]) {
      return false;
    }

    // Verificar si la categoría está habilitada
    const enabledCategories = [];
    this.config.categories.forEach(cat => {
      if (this.CATEGORIES[cat]) {
        enabledCategories.push(...this.CATEGORIES[cat]);
      }
    });

    if (this.config.categories.includes('ALL') || enabledCategories.includes(category)) {
      return true;
    }

    return false;
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

  _output(level, message, category) {
    const timestamp = this.config.timestamps ? `[${new Date().toISOString()}]` : '';
    const prefix = category ? `[${category}]` : '';
    const formatted = `${timestamp}${prefix} ${message}`;

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
    level: 'DEBUG', // Always use DEBUG level to show errors in console in production too
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
    config.level = storedLevel;
  }

  return new Logger(config);
}

// Exportar logger global
window.logger = createLogger();

// Methods for backward compatibility and convenience
window.logger.cache = function (message, level = 'info') {
  window.logger[level](message, 'CACHE');
};

window.logger.playback = function (message, level = 'info') {
  window.logger[level](message, 'PLAYBACK');
};

window.logger.network = function (message, level = 'info') {
  window.logger[level](message, 'NETWORK');
};

window.logger.wasm = function (message, level = 'info') {
  window.logger[level](message, 'WASM');
};

window.logger.ui = function (message, level = 'info') {
  window.logger[level](message, 'UI');
};

window.logger.system = function (message, level = 'info') {
  window.logger[level](message, 'SYSTEM');
};
