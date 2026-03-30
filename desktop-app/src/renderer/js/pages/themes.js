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
      description: 'The default state. Deep midnight blue meets ethereal violet.',
      active: true,
      colors: ['#0A0E17', '#8B5CF6']
    },
    {
      id: 'midnight-void',
      name: 'Midnight Void',
      description: 'Pure OLED black base for maximum contrast and battery saving.',
      active: false,
      colors: ['#000000', '#3B82F6']
    },
    {
      id: 'frost-light',
      name: 'Frost Light',
      description: 'A clean, high-visibility light theme for bright environments.',
      active: false,
      colors: ['#F1F5F9', '#7C3AED']
    }
  ];

  /* ─── Render ───────────────────────────────────────────────────── */
  function render() {
    return `
      <div class="mb-24">
        <h1 class="page-title">Appearance & Themes</h1>
        <p class="page-subtitle">Customize the look and feel of your Sanctuary.</p>
      </div>

      <div class="stats-row" id="themes-grid">
        ${themesList.map(t => `
          <div class="glass-card flex-col gap-16 theme-card" style="cursor: pointer; position: relative;">
            ${t.active ? `
              <div style="position: absolute; top: 12px; right: 12px; font-size: 11px; background: rgba(139, 92, 246, 0.2); color: var(--violet-light); padding: 4px 8px; border-radius: 12px; border: 1px solid var(--violet-glow);">
                ACTIVE
              </div>
            ` : ''}
            
            <div style="height: 100px; border-radius: 12px; border: 1px solid var(--glass-border); background: linear-gradient(135deg, ${t.colors[0]}, ${t.colors[1]}); margin-bottom: 8px;"></div>
            
            <div class="section-title">${t.name}</div>
            <p class="text-muted" style="font-size: 13px; line-height: 1.5;">${t.description}</p>
          </div>
        `).join('')}
      </div>

      <div class="glass-card mt-24">
        <div class="section-title mb-20">Animation Settings</div>
        <div class="form-group" style="display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-size: 14px; font-weight: 600; color: var(--frost);">Fluid Background</div>
            <div style="font-size: 13px; color: var(--frost-muted); margin-top: 4px;">Enable the interactive WebGL fluid background.</div>
          </div>
          <label class="toggle">
            <input type="checkbox" checked>
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

    // Placeholder interactivity
    document.querySelectorAll('.theme-card').forEach(card => {
      card.addEventListener('click', () => {
         // Future: apply theme logic here
         T.scalePop(card);
      });
    });
  }

  function destroy() {}

  return { render, init, destroy };
})();
