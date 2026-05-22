/* ═══════════════════════════════════════════════════════════════════
   Pure Path — Theme Manager (Simplified)
   Single unified theme — no theme switching, no JSON loading.
   ═══════════════════════════════════════════════════════════════════ */

window.PurePathThemeManager = (function () {
  'use strict';

  // Single theme — tokens are defined in CSS :root.
  // This module exists only for backward compatibility with
  // any code that references PurePathThemeManager.

  function setTheme() {
    // No-op — single theme applied via CSS :root
    return Promise.resolve();
  }

  function getActiveTheme() {
    return 'purepath';
  }

  return { setTheme, getActiveTheme };
})();
