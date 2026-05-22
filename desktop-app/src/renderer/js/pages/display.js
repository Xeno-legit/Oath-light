/* ═══════════════════════════════════════════════════════════════════
   Pure Path — Display Settings Page
   Animation toggle only — theme system removed.
   ═══════════════════════════════════════════════════════════════════ */

window.PurePathPages = window.PurePathPages || {};

window.PurePathPages.display = (function () {
  'use strict';

  const T = window.PurePathTransitions;

  /* ─── Render ───────────────────────────────────────────────────── */
  function render() {
    return `
      <div class="mb-24">
        <h1 class="page-title">Display Settings</h1>
        <p class="page-subtitle">Customize the visual behavior of your dashboard.</p>
      </div>

      <div class="glass-card">
        <div class="section-title mb-20">Animations</div>
        <div class="form-group" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0;">
          <div>
            <div style="font-size: 14px; font-weight: 600; color: var(--frost);">Fluid Background</div>
            <div style="font-size: 13px; color: var(--frost-muted); margin-top: 4px;">Enable the interactive WebGL fluid background effect.</div>
          </div>
          <label class="toggle">
            <input type="checkbox" id="fluid-anim-toggle" ${localStorage.getItem('purepath_fluid_enabled') !== 'false' ? 'checked' : ''}>
            <div class="toggle-slider"></div>
          </label>
        </div>
      </div>

      <div class="glass-card mt-24">
        <div class="section-title mb-20">About</div>
        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
          <img src="assets/Main_logo.png" alt="Logo" style="width: 48px; height: 48px; border-radius: 12px;">
          <div>
            <div style="font-size: 16px; font-weight: 700; color: var(--frost);">Pure Path</div>
            <div style="font-size: 13px; color: var(--frost-muted);">Unified theme \u00b7 Blue & Purple</div>
          </div>
        </div>
        <p class="text-muted" style="font-size: 13px; line-height: 1.6;">
          Your protection dashboard uses a single unified visual identity across the extension and desktop app.
        </p>
      </div>
    `;
  }

  /* ─── Init ─────────────────────────────────────────────────────── */
  function init() {
    const cards = document.querySelectorAll('#page-display .glass-card');
    T.staggerCards(cards, 0.1);

    const fluidToggle = document.getElementById('fluid-anim-toggle');
    if (fluidToggle) {
      fluidToggle.addEventListener('change', (e) => {
        window.dispatchEvent(new CustomEvent('fluidAnimationToggled', {
          detail: { enabled: e.target.checked }
        }));
      });
    }
  }

  function destroy() { }

  return { render, init, destroy };
})();
