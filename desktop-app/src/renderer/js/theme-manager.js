/*
   Pure Path — Theme Manager
   Responsible for applying CSS variable overrides and dispatching
   events for WebGL shader updates.
   */

window.PurePathThemeManager = (function () {
  'use strict';

  const THEME_STORAGE_KEY = 'purepath_active_theme';
  const DEFAULT_THEME = 'midnight-void';

  /**
   * Loads a theme configuration and applies it globally
   */
  async function setTheme(themeId) {
    try {
      // Fetch the theme JSON natively from the local directory
      const response = await fetch(`themes/${themeId}.json`);
      if (!response.ok) throw new Error(`Theme ${themeId} not found`);

      const themeConfig = await response.json();

      // 1. Apply CSS Tokens
      if (themeConfig.css) {
        const root = document.documentElement;
        for (const [property, value] of Object.entries(themeConfig.css)) {
          root.style.setProperty(property, value);
        }
      }

      // 2. Dispatch WebGL uniform event
      if (themeConfig.webgl) {
        const event = new CustomEvent('themeChanged', {
          detail: { webgl: themeConfig.webgl }
        });
        window.dispatchEvent(event);
      }

      // 3. Save state
      localStorage.setItem(THEME_STORAGE_KEY, themeId);

      // Add light/dark indicator to body for potential specific overrides
      if (themeConfig.type) {
        document.body.setAttribute('data-theme', themeConfig.type);
      }

    } catch (err) {
      console.error('[ThemeManager] Failed to apply theme:', err);
    }
  }

  /**
   * Initializes the theme from localStorage on boot
   */
  function init() {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME;
    // Apply synchronously if possible, or trigger async
    setTheme(savedTheme);
  }

  /**
   * Get the currently active theme string
   */
  function getActiveTheme() {
    return localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME;
  }

  // Auto-init early boot
  init();

  return { setTheme, getActiveTheme };
})();
