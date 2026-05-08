/**
 * Theme Manager for Resonate Player
 * Handles day, night, and energy-saver modes
 * All modes are optimized for energy efficiency
 * 
 * @module ThemeManager
 */

(function() {
  'use strict';

  // ============================================
  // CONFIGURATION
  // ============================================
  
  /**
   * Theme configuration constants
   * @constant {Object}
   */
  const CONFIG = Object.freeze({
    STORAGE_KEY: 'resonate-theme',
    DEFAULT_THEME: 'night',
    SPRITE_URL: '/icons/sprite.svg?v=2',
    DAY_START_HOUR: 6,      // 6:00 AM - day theme begins
    NIGHT_START_HOUR: 20,   // 8:00 PM - night theme begins
    AUTO_CHECK_INTERVAL: 60 * 1000  // Check time-based theme every minute
  });

  /**
   * Available themes
   * @constant {string[]}
   */
  const THEMES = Object.freeze(['day', 'night', 'energy-saver']);

  /**
   * Theme display labels
   * @constant {Object<string, string>}
   */
  const THEME_LABELS = Object.freeze({
    'day': 'Day',
    'night': 'Night',
    'energy-saver': 'Eco'
  });

  /**
   * Theme icon IDs for SVG sprite
   * @constant {Object<string, string>}
   */
  const THEME_ICONS = Object.freeze({
    'day': 'theme-sun',
    'night': 'theme-moon',
    'energy-saver': 'theme-leaf'
  });

  /**
   * Theme colors for meta tag
   * @constant {Object<string, string>}
   */
  const THEME_COLORS = Object.freeze({
    'day': '#10b981',
    'night': '#3da9ff',
    'energy-saver': '#7aa7b8'
  });

  // ============================================
  // STATE
  // ============================================
  
  let themeToggleEl = null;
  let autoThemeIntervalId = null;
  let autoThemeVisibilityListenerAdded = false;

  // ============================================
  // VALIDATION
  // ============================================

  /**
   * Validates if a theme name is valid
   * @param {string} theme - Theme name to validate
   * @returns {boolean} True if valid theme
   */
  function isValidTheme(theme) {
    return typeof theme === 'string' && THEMES.includes(theme);
  }

  /**
   * Ensures a theme value is valid, returns default if not
   * @param {string} theme - Theme to validate
   * @returns {string} Valid theme name
   */
  function ensureValidTheme(theme) {
    return isValidTheme(theme) ? theme : CONFIG.DEFAULT_THEME;
  }

  // ============================================
  // STORAGE
  // ============================================

  /**
   * Gets saved theme from localStorage
   * @returns {string|null} Saved theme or null if not set
   */
  function getSavedTheme() {
    try {
      const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
      return saved !== null ? ensureValidTheme(saved) : null;
    } catch (e) {
      console.warn('[ThemeManager] Could not access localStorage:', e);
      return null;
    }
  }

  /**
   * Gets the current theme (saved or default)
   * @returns {string} Current theme name
   */
  function getCurrentTheme() {
    return getSavedTheme() ?? CONFIG.DEFAULT_THEME;
  }

  /**
   * Saves theme to localStorage
   * @param {string} theme - Theme to save
   * @returns {boolean} True if save was successful
   */
  function saveTheme(theme) {
    if (!isValidTheme(theme)) {
      console.warn('[ThemeManager] Invalid theme:', theme);
      return false;
    }
    try {
      localStorage.setItem(CONFIG.STORAGE_KEY, theme);
      return true;
    } catch (e) {
      console.warn('[ThemeManager] Could not save theme:', e);
      return false;
    }
  }

  /**
   * Clears saved theme preference
   * @returns {boolean} True if clear was successful
   */
  function clearSavedTheme() {
    try {
      localStorage.removeItem(CONFIG.STORAGE_KEY);
      return true;
    } catch (e) {
      console.warn('[ThemeManager] Could not clear theme:', e);
      return false;
    }
  }

  /**
   * Returns true when the user has explicitly saved a theme preference
   * @returns {boolean} True if user has a saved preference
   */
  function hasUserThemePreference() {
    try {
      return localStorage.getItem(CONFIG.STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  }

  // ============================================
  // THEME APPLICATION
  // ============================================

  /**
   * Applies a theme to the document
   * @param {string} theme - Theme to apply
   */
  function applyTheme(theme) {
    const validTheme = ensureValidTheme(theme);
    
    // Apply theme to document
    document.documentElement.setAttribute('data-theme', validTheme);
    
    // Update theme-color meta tag
    updateThemeColor(validTheme);

    // Keep toggle label in sync
    updateToggleLabel(validTheme);

    // Re-evaluate title ticker measurements (fonts/colors can change width)
    notifyTitleTicker();
    
    console.log(`[ThemeManager] Theme applied: ${validTheme}`);
  }

  /**
   * Updates the theme-color meta tag
   * @param {string} theme - Current theme
   */
  function updateThemeColor(theme) {
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (!themeColorMeta) return;

    // Prefer the computed CSS variable so meta theme-color always matches the palette
    try {
      const cssPrimary = getComputedStyle(document.documentElement)
        .getPropertyValue('--primary')
        .trim();

      if (cssPrimary && (cssPrimary.startsWith('#') || cssPrimary.startsWith('rgb'))) {
        themeColorMeta.setAttribute('content', cssPrimary);
        return;
      }
    } catch { /* fallback to static colors */ }

    themeColorMeta.setAttribute('content', THEME_COLORS[theme] ?? THEME_COLORS[CONFIG.DEFAULT_THEME]);
  }

  /**
   * Notifies the title ticker to recalculate measurements
   */
  function notifyTitleTicker() {
    try {
      if (typeof window.updateTitleTicker === 'function') {
        const titleEl = document.getElementById('title');
        const titleText = titleEl ? (titleEl.textContent || '') : '';
        window.updateTitleTicker(titleText);
      }
    } catch { /* ignore ticker errors */ }
  }

  // ============================================
  // TOGGLE UI
  // ============================================

  /**
   * Updates the theme toggle button label and icon
   * @param {string} theme - Current theme
   */
  function updateToggleLabel(theme) {
    if (!themeToggleEl) return;
    
    const validTheme = ensureValidTheme(theme);
    const label = THEME_LABELS[validTheme];
    
    themeToggleEl.dataset.theme = validTheme;

    // Update or create icon element
    updateToggleIcon(validTheme);

    // Update or create label element
    updateToggleLabelText(label);

    // Update accessibility attributes
    themeToggleEl.setAttribute('aria-label', `Theme: ${label}. Press to cycle through themes.`);
    themeToggleEl.setAttribute('aria-current', 'page');
  }

  /**
   * Updates the toggle button icon
   * @param {string} theme - Current theme
   */
  function updateToggleIcon(theme) {
    let iconEl = themeToggleEl.querySelector('.theme-icon');
    if (!iconEl) {
      iconEl = document.createElement('span');
      iconEl.className = 'theme-icon';
      iconEl.setAttribute('aria-hidden', 'true');
      themeToggleEl.appendChild(iconEl);
    }

    let svgEl = iconEl.querySelector('svg');
    if (!svgEl) {
      svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svgEl.setAttribute('viewBox', '0 0 24 24');
      svgEl.setAttribute('aria-hidden', 'true');
      svgEl.setAttribute('focusable', 'false');
      svgEl.classList.add('theme-svg');
      const useEl = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      svgEl.appendChild(useEl);
      iconEl.appendChild(svgEl);
    }

    const useEl = svgEl.querySelector('use');
    if (useEl) {
      const iconId = THEME_ICONS[theme] ?? THEME_ICONS[CONFIG.DEFAULT_THEME];
      useEl.setAttribute('href', `${CONFIG.SPRITE_URL}#${iconId}`);
    }
  }

  /**
   * Updates the toggle button label text
   * @param {string} label - Label text to display
   */
  function updateToggleLabelText(label) {
    let labelEl = themeToggleEl.querySelector('.theme-label');
    if (!labelEl) {
      labelEl = document.createElement('span');
      labelEl.className = 'theme-label';
      themeToggleEl.appendChild(labelEl);
    }
    labelEl.textContent = label;
  }

  // ============================================
  // THEME CYCLING
  // ============================================

  /**
   * Gets the next theme in the cycle
   * @param {string} current - Current theme
   * @returns {string} Next theme in cycle
   */
  function getNextTheme(current) {
    const idx = THEMES.indexOf(current);
    if (idx === -1) return CONFIG.DEFAULT_THEME;
    return THEMES[(idx + 1) % THEMES.length];
  }

  /**
   * Cycles to the next theme (user action)
   */
  function cycleTheme() {
    const current = getCurrentTheme();
    const next = getNextTheme(current);
    applyTheme(next);
    saveTheme(next);
  }

  // ============================================
  // TIME-BASED THEMES
  // ============================================

  /**
   * Returns 'day' or 'night' based on the current device time
   * @returns {string} Time-appropriate theme
   */
  function getThemeByTime() {
    const hour = new Date().getHours();
    return (hour >= CONFIG.DAY_START_HOUR && hour < CONFIG.NIGHT_START_HOUR) ? 'day' : 'night';
  }

  /**
   * Applies the time-appropriate theme unless eco battery mode or a user preference is active
   */
  function applyTimeBasedTheme() {
    // Respect eco battery override
    try {
      if (localStorage.getItem('resonate-eco-battery-active') === '1') return;
    } catch { /* ignore */ }
    
    // Respect explicit user theme preference
    if (hasUserThemePreference()) return;

    const theme = getThemeByTime();
    const current = document.documentElement.getAttribute('data-theme');
    if (current !== theme) {
      applyTheme(theme);
    }
  }

  /**
   * Sets up periodic time-based theme switching
   */
  function initTimeBasedTheme() {
    if (autoThemeIntervalId === null) {
      autoThemeIntervalId = setInterval(applyTimeBasedTheme, CONFIG.AUTO_CHECK_INTERVAL);
    }

    // Re-evaluate when the page becomes visible again (e.g. returning from background)
    if (!autoThemeVisibilityListenerAdded) {
      autoThemeVisibilityListenerAdded = true;
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
          applyTimeBasedTheme();
        }
      });
    }
  }

  // ============================================
  // SYSTEM PREFERENCE DETECTION
  // ============================================

  /**
   * Detects and responds to system color scheme preference
   */
  function detectSystemPreference() {
    if (!window.matchMedia) return;

    const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    // Apply system preference only if no saved preference exists
    if (!hasUserThemePreference()) {
      const systemTheme = darkMediaQuery.matches ? 'night' : 'day';
      applyTheme(systemTheme);
    }

    // Listen for system preference changes
    // BUG FIX: Don't save theme on system change - only apply it temporarily
    darkMediaQuery.addEventListener('change', (e) => {
      if (!hasUserThemePreference()) {
        const newTheme = e.matches ? 'night' : 'day';
        applyTheme(newTheme);
        // Note: We intentionally don't save here to keep it as "automatic"
      }
    });
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  /**
   * Initializes the theme manager
   */
  function initThemeManager() {
    themeToggleEl = document.getElementById('theme-toggle');
    
    if (!themeToggleEl) {
      console.warn('[ThemeManager] Theme toggle element not found');
      return;
    }

    // Determine initial theme
    const savedTheme = getSavedTheme();
    const initialTheme = savedTheme ?? getThemeByTime();
    
    applyTheme(initialTheme);

    // Set up click handler for cycling themes
    themeToggleEl.addEventListener('click', cycleTheme);

    // Support keyboard activation (Enter/Space)
    themeToggleEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        cycleTheme();
      }
    });

    // Detect and respond to system preference
    detectSystemPreference();

    // Start time-based automatic day/night switching
    initTimeBasedTheme();
  }

  // ============================================
  // PUBLIC API
  // ============================================

  /**
   * Public API for resonateTheme
   */
  window.resonateTheme = {
    applyTheme,
    getSavedTheme,
    getCurrentTheme,
    saveTheme
  };

  /**
   * Public API for ThemeManager (used by Battery module)
   */
  window.ThemeManager = {
    applyTheme,
    getSavedTheme,
    getCurrentTheme,
    saveTheme,
    applyTimeBasedTheme,
    getThemeByTime,
    hasUserThemePreference,
    clearSavedTheme,
    isValidTheme,
    getNextTheme,
    cycleTheme
  };

  // ============================================
  // AUTO-INIT
  // ============================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThemeManager);
  } else {
    initThemeManager();
  }

})();
