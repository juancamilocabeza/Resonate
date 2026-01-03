/**
 * Theme Manager for Resonate Player
 * Handles day, night, and energy-saver modes
 * All modes are optimized for energy efficiency
 */

(function() {
  'use strict';

  const THEME_KEY = 'resonate-theme';
  const DEFAULT_THEME = 'night'; // Default to night for energy savings
  const THEMES = ['day', 'night', 'energy-saver'];
  const THEME_LABELS = {
    'day': 'Day',
    'night': 'Night',
    'energy-saver': 'Eco'
  };
  let themeToggleEl = null;
  
  // Get saved theme or use default
  function getSavedTheme() {
    try {
      return localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
    } catch (e) {
      console.warn('Could not access localStorage:', e);
      return DEFAULT_THEME;
    }
  }

  // Save selected theme
  function saveTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      console.warn('Could not save theme:', e);
    }
  }

  // Apply theme to document
  function applyTheme(theme) {
    // Remove previous themes
    document.documentElement.removeAttribute('data-theme');
    
    // Apply new theme if not default
    if (theme !== 'night') {
      document.documentElement.setAttribute('data-theme', theme);
    }
    
    // Update theme-color meta tag
    updateThemeColor(theme);
    
    // Log for debugging
    console.log(`Theme applied: ${theme}`);
  }

  // Update theme-color meta tag
  function updateThemeColor(theme) {
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (!themeColorMeta) return;

    const colors = {
      'day': '#f5f5f5',
      'night': '#000000',
      'energy-saver': '#000000'
    };

    themeColorMeta.setAttribute('content', colors[theme] || colors['night']);
  }

  function setToggleLabel(theme) {
    if (!themeToggleEl) return;
    const label = THEME_LABELS[theme] || 'Theme';
    themeToggleEl.textContent = label;
    themeToggleEl.setAttribute('aria-label', `Theme: ${label}`);
    themeToggleEl.setAttribute('title', `Switch theme (current: ${label})`);
  }

  function getNextTheme(current) {
    const idx = THEMES.indexOf(current);
    if (idx === -1) return DEFAULT_THEME;
    return THEMES[(idx + 1) % THEMES.length];
  }

  // Initialize theme manager
  function initThemeManager() {
    themeToggleEl = document.getElementById('theme-toggle');
    
    if (!themeToggleEl) {
      console.warn('Theme toggle not found');
      return;
    }

    // Apply saved theme on load
    const savedTheme = getSavedTheme();
    applyTheme(savedTheme);
    setToggleLabel(savedTheme);

    // Cycle themes on click
    themeToggleEl.addEventListener('click', function() {
      const current = getSavedTheme();
      const next = getNextTheme(current);
      applyTheme(next);
      saveTheme(next);
      setToggleLabel(next);
      showThemeNotification(next);
    });

    // Support keyboard activation (Enter/Space)
    themeToggleEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        themeToggleEl.click();
      }
    });

    // Detect system preference (optional)
    detectSystemPreference();
  }

  // Mostrar notificación de cambio de tema
  function showThemeNotification(theme) {
    const messages = {
      'day': 'Day mode enabled',
      'night': 'Night mode enabled - Battery saver',
      'energy-saver': 'Eco mode enabled - Maximum battery saving'
    };

    const message = messages[theme] || 'Theme changed';
    
    // Buscar el contenedor de mensajes de estado
    const statusMessages = document.getElementById('status-messages');
    if (statusMessages) {
      const notification = document.createElement('div');
      notification.className = 'theme-notification';
      notification.textContent = message;
      notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--card);
        color: var(--fg);
        padding: 12px 24px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        opacity: 0;
        transition: opacity 0.3s ease;
      `;
      
      statusMessages.appendChild(notification);
      
      // Animar entrada
      setTimeout(() => {
        notification.style.opacity = '1';
      }, 10);
      
      // Remover después de 2 segundos
      setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
          notification.remove();
        }, 300);
      }, 2000);
    }
  }

  // Detect system preference
  function detectSystemPreference() {
    // Detect if system prefers dark mode
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      // Only apply if no saved preference
      if (!localStorage.getItem(THEME_KEY)) {
        applyTheme('night');
        setToggleLabel('night');
      }
    }

    // Listen for system preference changes
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        // Only apply if user hasn't manually selected a theme
        if (!localStorage.getItem(THEME_KEY)) {
          const newTheme = e.matches ? 'night' : 'day';
          applyTheme(newTheme);
          saveTheme(newTheme);
          setToggleLabel(newTheme);
        }
      });
    }
  }

  // Expose global functions if needed
  window.resonateTheme = {
    applyTheme,
    getSavedTheme,
    saveTheme
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThemeManager);
  } else {
    initThemeManager();
  }

})();
