/**
 * Theme Manager for Resonate Player
 * Handles day, night, and energy-saver modes
 * All modes are optimized for energy efficiency
 */

(function() {
  'use strict';

  const THEME_KEY = 'resonate-theme';
  const DEFAULT_THEME = 'night'; // Por defecto, modo noche (ahorra energía)
  
  // Obtener el tema guardado o usar el predeterminado
  function getSavedTheme() {
    try {
      return localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
    } catch (e) {
      console.warn('No se pudo acceder a localStorage:', e);
      return DEFAULT_THEME;
    }
  }

  // Guardar el tema seleccionado
  function saveTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      console.warn('No se pudo guardar el tema:', e);
    }
  }

  // Aplicar el tema al documento
  function applyTheme(theme) {
    // Remover temas anteriores
    document.documentElement.removeAttribute('data-theme');
    
    // Aplicar nuevo tema si no es el predeterminado
    if (theme !== 'night') {
      document.documentElement.setAttribute('data-theme', theme);
    }
    
    // Actualizar el color del theme-color meta tag
    updateThemeColor(theme);
    
    // Log para debugging
    console.log(`Tema aplicado: ${theme}`);
  }

  // Actualizar el color del meta tag theme-color
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

  // Inicializar el gestor de temas
  function initThemeManager() {
    const themeSelector = document.getElementById('theme-selector');
    
    if (!themeSelector) {
      console.warn('No se encontró el selector de tema');
      return;
    }

    // Aplicar tema guardado al cargar
    const savedTheme = getSavedTheme();
    applyTheme(savedTheme);
    themeSelector.value = savedTheme;

    // Escuchar cambios en el selector
    themeSelector.addEventListener('change', function(e) {
      const selectedTheme = e.target.value;
      applyTheme(selectedTheme);
      saveTheme(selectedTheme);
      
      // Mostrar mensaje temporal (opcional)
      showThemeNotification(selectedTheme);
    });

    // Detectar preferencia del sistema (opcional)
    detectSystemPreference();
  }

  // Mostrar notificación de cambio de tema
  function showThemeNotification(theme) {
    const messages = {
      'day': 'Modo Día activado',
      'night': 'Modo Noche activado - Ahorra energía',
      'energy-saver': 'Modo Ahorro de Energía activado - Máximo ahorro'
    };

    const message = messages[theme] || 'Tema cambiado';
    
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

  // Detectar preferencia del sistema
  function detectSystemPreference() {
    // Detectar si el sistema prefiere modo oscuro
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      // Solo aplicar si no hay preferencia guardada
      if (!localStorage.getItem(THEME_KEY)) {
        applyTheme('night');
      }
    }

    // Escuchar cambios en la preferencia del sistema
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        // Solo aplicar si el usuario no ha seleccionado manualmente un tema
        if (!localStorage.getItem(THEME_KEY)) {
          const newTheme = e.matches ? 'night' : 'day';
          applyTheme(newTheme);
          const themeSelector = document.getElementById('theme-selector');
          if (themeSelector) {
            themeSelector.value = newTheme;
          }
        }
      });
    }
  }

  // Exponer funciones globales si es necesario
  window.resonateTheme = {
    applyTheme,
    getSavedTheme,
    saveTheme
  };

  // Inicializar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThemeManager);
  } else {
    initThemeManager();
  }

})();
