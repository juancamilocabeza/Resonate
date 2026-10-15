/**
 * Theme Manager for Resonate Player
 *
 * @module ThemeManager
 */

(function() {
  'use strict';

  const CONFIG = Object.freeze({
    STORAGE_KEY: 'resonate-theme',
    DEFAULT_THEME: 'night',
    SPRITE_URL: '/icons/sprite.svg?v=2',
    DAY_START_HOUR: 6,
    NIGHT_START_HOUR: 20,
    AUTO_CHECK_INTERVAL: 60 * 1000,
    ECO_OVERRIDE_KEY: 'resonate-eco-battery-active'
  });

  const THEMES = Object.freeze({
    day: Object.freeze({ label: 'Day', icon: 'theme-sun', color: '#10b981' }),
    night: Object.freeze({ label: 'Night', icon: 'theme-moon', color: '#3da9ff' }),
    'energy-saver': Object.freeze({ label: 'Eco', icon: 'theme-leaf', color: '#7aa7b8' })
  });
  const THEME_NAMES = Object.freeze(Object.keys(THEMES));

  let activeTheme = null;
  let themeToggleEl = null;
  let autoThemeIntervalId = null;
  let autoThemeVisibilityListenerAdded = false;

  function isValidTheme(theme) {
    return typeof theme === 'string' && Object.prototype.hasOwnProperty.call(THEMES, theme);
  }

  function ensureValidTheme(theme) {
    return isValidTheme(theme) ? theme : CONFIG.DEFAULT_THEME;
  }

  function getSavedTheme() {
    try {
      const savedTheme = localStorage.getItem(CONFIG.STORAGE_KEY);
      return savedTheme === null ? null : ensureValidTheme(savedTheme);
    } catch (error) {
      console.warn('[ThemeManager] Could not access localStorage:', error);
      return null;
    }
  }

  function getCurrentTheme() {
    return activeTheme ?? getSavedTheme() ?? CONFIG.DEFAULT_THEME;
  }

  function saveTheme(theme) {
    if (!isValidTheme(theme)) {
      console.warn('[ThemeManager] Invalid theme:', theme);
      return false;
    }

    try {
      localStorage.setItem(CONFIG.STORAGE_KEY, theme);
      return true;
    } catch (error) {
      console.warn('[ThemeManager] Could not save theme:', error);
      return false;
    }
  }

  function clearSavedTheme() {
    try {
      localStorage.removeItem(CONFIG.STORAGE_KEY);
      return true;
    } catch (error) {
      console.warn('[ThemeManager] Could not clear theme:', error);
      return false;
    }
  }

  function hasUserThemePreference() {
    try {
      return localStorage.getItem(CONFIG.STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  }

  function updateThemeColor(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;

    try {
      const primary = getComputedStyle(document.documentElement)
        .getPropertyValue('--primary')
        .trim();
      if (primary && (primary.startsWith('#') || primary.startsWith('rgb'))) {
        meta.setAttribute('content', primary);
        return;
      }
    } catch {
      // Use the configured color if computed styles are unavailable.
    }

    meta.setAttribute('content', THEMES[theme].color);
  }

  function updateTitleTicker() {
    if (typeof window.updateTitleTicker !== 'function') return;

    try {
      const title = document.getElementById('title');
      window.updateTitleTicker(title ? title.textContent || '' : '');
    } catch (error) {
      console.warn('[ThemeManager] Could not update title ticker:', error);
    }
  }

  function updateToggleIcon(theme) {
    let icon = themeToggleEl.querySelector('.theme-icon');
    if (!icon) {
      icon = document.createElement('span');
      icon.className = 'theme-icon';
      icon.setAttribute('aria-hidden', 'true');
      themeToggleEl.appendChild(icon);
    }

    let svg = icon.querySelector('svg');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      svg.classList.add('theme-svg');

      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      svg.appendChild(use);
      icon.appendChild(svg);
    }

    const use = svg.querySelector('use');
    if (use) use.setAttribute('href', `${CONFIG.SPRITE_URL}#${THEMES[theme].icon}`);
  }

  function updateToggle(theme) {
    if (!themeToggleEl) return;

    const { label } = THEMES[theme];
    themeToggleEl.dataset.theme = theme;
    updateToggleIcon(theme);

    let labelEl = themeToggleEl.querySelector('.theme-label');
    if (!labelEl) {
      labelEl = document.createElement('span');
      labelEl.className = 'theme-label';
      themeToggleEl.appendChild(labelEl);
    }
    labelEl.textContent = label;

    themeToggleEl.setAttribute('aria-label', `Theme: ${label}. Press to cycle through themes.`);
    themeToggleEl.setAttribute('aria-current', 'page');
  }

  function applyTheme(theme) {
    activeTheme = ensureValidTheme(theme);
    document.documentElement.setAttribute('data-theme', activeTheme);
    updateThemeColor(activeTheme);
    updateToggle(activeTheme);
    updateTitleTicker();
    console.log(`[ThemeManager] Theme applied: ${activeTheme}`);
  }

  function getNextTheme(current) {
    const index = THEME_NAMES.indexOf(current);
    if (index === -1) return CONFIG.DEFAULT_THEME;
    return THEME_NAMES[(index + 1) % THEME_NAMES.length];
  }

  function cycleTheme() {
    const nextTheme = getNextTheme(getCurrentTheme());
    applyTheme(nextTheme);
    saveTheme(nextTheme);
  }

  function getThemeByTime() {
    const hour = new Date().getHours();
    return hour >= CONFIG.DAY_START_HOUR && hour < CONFIG.NIGHT_START_HOUR
      ? 'day'
      : 'night';
  }

  function applyTimeBasedTheme() {
    try {
      if (localStorage.getItem(CONFIG.ECO_OVERRIDE_KEY) === '1') return;
    } catch {
      // Continue with automatic theme selection when storage is unavailable.
    }

    if (hasUserThemePreference()) return;

    const theme = getThemeByTime();
    if (activeTheme !== theme) applyTheme(theme);
  }

  function initTimeBasedTheme() {
    if (autoThemeIntervalId === null) {
      autoThemeIntervalId = setInterval(applyTimeBasedTheme, CONFIG.AUTO_CHECK_INTERVAL);
    }

    if (!autoThemeVisibilityListenerAdded) {
      autoThemeVisibilityListenerAdded = true;
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') applyTimeBasedTheme();
      });
    }
  }

  function initThemeManager() {
    themeToggleEl = document.getElementById('theme-toggle');
    const initialTheme = getSavedTheme() ?? getThemeByTime();
    applyTheme(initialTheme);

    if (themeToggleEl) {
      themeToggleEl.addEventListener('click', cycleTheme);
    }

    initTimeBasedTheme();
  }

  window.resonateTheme = {
    applyTheme,
    getSavedTheme,
    getCurrentTheme,
    saveTheme
  };

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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThemeManager);
  } else {
    initThemeManager();
  }
})();
