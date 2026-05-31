/*
   Pure Path — Account Page
   User profile and identity hub placeholder
   */

window.PurePathPages = window.PurePathPages || {};

window.PurePathPages.account = (function () {
  'use strict';

  const T = window.PurePathTransitions;

  /* Render */
  function render() {
    return `
      <div class="mb-24">
        <h1 class="page-title">Identity Hub</h1>
        <p class="page-subtitle">Manage your account, subscription, and persona.</p>
      </div>

      <div class="flex-col gap-24">
        <!-- Profile Card -->
        <div class="glass-card flex-col gap-16 account-card">
          <div class="section-title">User Profile</div>
          <div style="display: flex; align-items: center; gap: 20px;">
            <div style="width: 80px; height: 80px; border-radius: 50%; background: var(--violet-subtle); display: flex; align-items: center; justify-content: center; font-size: 32px; border: 2px solid var(--violet-glow);">
              👤
            </div>
            <div>
              <div style="font-size: 20px; font-weight: 700; color: var(--frost);">Seeker</div>
              <div style="font-size: 14px; color: var(--frost-muted); margin-top: 4px;">Free Tier</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* Init */
  function init() {
    // Stagger cards
    const cards = document.querySelectorAll('#page-account .account-card');
    T.staggerCards(cards, 0.1);
  }

  function destroy() { }

  return { render, init, destroy };
})();
