/* ═══════════════════════════════════════════════════════════════════
   Pure Path — Settings & Account Page ("Identity Hub")
   Account card, toggle switches, settings groups
   ═══════════════════════════════════════════════════════════════════ */

window.PurePathPages = window.PurePathPages || {};

window.PurePathPages.settings = (function () {
  'use strict';

  const T = window.PurePathTransitions;

  /* ─── Settings State (mock) ────────────────────────────────────── */
  const settingsState = {
    maxProtection: true,
    notifications: true,
    frictionDelay: true,
    autoStart: true,
    safeSearch: true,
    analytics: false,
  };

  /* ─── Render ───────────────────────────────────────────────────── */
  function render() {
    return `
      <div class="settings-container">
        <div class="mb-24">
          <h1 class="page-title">Settings</h1>
          <p class="page-subtitle">Configure your sanctuary. Every option is designed for your wellbeing.</p>
        </div>

        <!-- Account Card -->
        <div class="glass-card account-card" id="settings-account">
          <div class="account-avatar">PP</div>
          <div class="account-info">
            <h3>Pure Path User</h3>
            <p>user@purepath.app · Premium Plan</p>
          </div>
        </div>

        <!-- Protection Settings -->
        <div class="glass-card-static" id="settings-protection">
          <div class="settings-group">
            <div class="settings-group-title">Protection</div>
            <div class="settings-list">
              <div class="settings-item">
                <div class="settings-item-left">
                  <div class="settings-item-icon">
                    <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  </div>
                  <div class="settings-item-text">
                    <h4>Maximum Protection</h4>
                    <p>Block all known NSFW content categories</p>
                  </div>
                </div>
                <label class="toggle">
                  <input type="checkbox" data-setting="maxProtection" ${settingsState.maxProtection ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="settings-item">
                <div class="settings-item-left">
                  <div class="settings-item-icon success">
                    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  </div>
                  <div class="settings-item-text">
                    <h4>Safe Search Enforcement</h4>
                    <p>Force safe search on all search engines</p>
                  </div>
                </div>
                <label class="toggle">
                  <input type="checkbox" data-setting="safeSearch" ${settingsState.safeSearch ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- Security Settings -->
        <div class="glass-card-static" id="settings-security">
          <div class="settings-group">
            <div class="settings-group-title">Security</div>
            <div class="settings-list">
              <div class="settings-item">
                <div class="settings-item-left">
                  <div class="settings-item-icon warning">
                    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  </div>
                  <div class="settings-item-text">
                    <h4>Friction Delay (48 hours)</h4>
                    <p>Require 48-hour waiting period before uninstallation</p>
                  </div>
                </div>
                <label class="toggle">
                  <input type="checkbox" data-setting="frictionDelay" ${settingsState.frictionDelay ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="settings-item">
                <div class="settings-item-left">
                  <div class="settings-item-icon">
                    <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                  </div>
                  <div class="settings-item-text">
                    <h4>Launch at Startup</h4>
                    <p>Start Pure Path automatically when your computer boots</p>
                  </div>
                </div>
                <label class="toggle">
                  <input type="checkbox" data-setting="autoStart" ${settingsState.autoStart ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- Notifications -->
        <div class="glass-card-static" id="settings-notifications">
          <div class="settings-group">
            <div class="settings-group-title">Notifications & Data</div>
            <div class="settings-list">
              <div class="settings-item">
                <div class="settings-item-left">
                  <div class="settings-item-icon">
                    <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  </div>
                  <div class="settings-item-text">
                    <h4>Notifications</h4>
                    <p>Receive alerts for blocking events and milestones</p>
                  </div>
                </div>
                <label class="toggle">
                  <input type="checkbox" data-setting="notifications" ${settingsState.notifications ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="settings-item">
                <div class="settings-item-left">
                  <div class="settings-item-icon">
                    <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  </div>
                  <div class="settings-item-text">
                    <h4>Usage Analytics</h4>
                    <p>Share anonymous usage data to improve Pure Path</p>
                  </div>
                </div>
                <label class="toggle">
                  <input type="checkbox" data-setting="analytics" ${settingsState.analytics ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- App Info -->
        <div class="glass-card-static" id="settings-info" style="text-align: center; padding: 24px;">
          <p class="text-muted" style="font-size: 13px;">Pure Path Desktop v1.0.0</p>
          <p class="text-muted" style="font-size: 12px; margin-top: 4px;">© 2026 Pure Path. Built with 💜 for your clarity.</p>
        </div>
      </div>
    `;
  }

  /* ─── Init ─────────────────────────────────────────────────────── */
  function init() {
    // Stagger entrance
    const cards = document.querySelectorAll('#page-settings .glass-card, #page-settings .glass-card-static');
    T.staggerCards(cards, 0.08);

    // Toggle handlers
    document.querySelectorAll('[data-setting]').forEach(input => {
      input.addEventListener('change', (e) => {
        const key = e.target.getAttribute('data-setting');
        settingsState[key] = e.target.checked;
        // In production: save via IPC to main process
        console.log(`Setting "${key}" changed to ${e.target.checked}`);
      });
    });
  }

  function destroy() {}

  return { render, init, destroy };
})();
