/* ═══════════════════════════════════════════════════════════════════
   Pure Path — Themes Page
   Interface for future theme management
   ═══════════════════════════════════════════════════════════════════ */

window.PurePathPages = window.PurePathPages || {};

window.PurePathPages.themes = (function () {
  'use strict';

  const T = window.PurePathTransitions;

  /* ─── Available Themes ─────────────────────────────────────────── */
  const themesList = [
    {
      id: 'electric-ether',
      name: 'Electric Ether',
      description: 'Deep midnight blue meets ethereal violet.',
      active: true,
      colors: ['#0A0E17', '#8B5CF6']
    },
    {
      id: 'midnight-void',
      name: 'Midnight Void',
      description: 'Deep black with a hint of blue.',
      active: false,
      colors: ['#000000', '#3B82F6']
    },
    {
      id: 'frost-light',
      name: 'Frost Light',
      description: 'High-visibility light theme for bright environments, Creator favorite.',
      active: false,
      colors: ['#F1F5F9', '#7C3AED']
    }
  ];

  /* ─── Render ───────────────────────────────────────────────────── */
  function render() {
    const activeThemeId = window.PurePathThemeManager ? window.PurePathThemeManager.getActiveTheme() : 'electric-ether';

    return `
      <div class="mb-24">
        <h1 class="page-title">Appearance & Themes</h1>
        <p class="page-subtitle">Customize the look and feel of your Sanctuary.</p>
      </div>

      <div class="stats-row" id="themes-grid">
        ${themesList.map(t => {
      const isActive = t.id === activeThemeId;
      return `
            <div class="glass-card flex-col gap-16 theme-card" data-theme-id="${t.id}" style="cursor: pointer; position: relative; border-color: ${isActive ? 'var(--violet)' : 'var(--glass-border)'}">
              ${isActive ? `
                <div style="position: absolute; top: 16px; right: 16px; width: 22px; height: 22px; font-size: 11px; font-weight: bold; background: var(--violet); color: white; border-radius: 50%; z-index: 10; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px var(--violet-glow); border: 2px solid var(--bg-surface);">
                  ✔
                </div>
              ` : ''}
              
              <div style="height: 100px; border-radius: 12px; border: 1px solid var(--glass-border); background: linear-gradient(135deg, ${t.colors[0]}, ${t.colors[1]}); margin-bottom: 8px;"></div>
              
              <div class="section-title">${t.name}</div>
              <p class="text-muted" style="font-size: 13px; line-height: 1.5;">${t.description}</p>
            </div>
          `;
    }).join('')}
      </div>

      <div class="glass-card mt-24">
        <div class="section-title mb-20">Animation Settings</div>
        <div class="form-group" style="display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-size: 14px; font-weight: 600; color: var(--frost);">Fluid Background</div>
            <div style="font-size: 13px; color: var(--frost-muted); margin-top: 4px;">Enable the interactive WebGL fluid background.</div>
          </div>
          <label class="toggle">
            <input type="checkbox" id="fluid-anim-toggle" ${localStorage.getItem('purepath_fluid_enabled') !== 'false' ? 'checked' : ''}>
            <div class="toggle-slider"></div>
          </label>
        </div>
      </div>
    `;
  }

  /* ─── Init ─────────────────────────────────────────────────────── */
  function init() {
    // Stagger cards
    const cards = document.querySelectorAll('#page-themes .glass-card');
    T.staggerCards(cards, 0.1);

    // Apply theme logic
    document.querySelectorAll('.theme-card').forEach(card => {
      card.addEventListener('click', () => {
        const themeId = card.getAttribute('data-theme-id');
        if (window.PurePathThemeManager) {
          window.PurePathThemeManager.setTheme(themeId).then(() => {
            // Re-render local block after storage is definitely updated
            const container = document.getElementById('page-themes');
            if (container) {
              container.innerHTML = render();
              init();
            }
          });
        }
        T.scalePop(card);
      });
    });

    // Animation Toggle
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
