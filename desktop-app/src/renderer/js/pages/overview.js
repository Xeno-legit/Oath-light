/*
   Pure Path — Overview Page
   Main dashboard: status, stats, activity, quote, quick actions
   Connected to extension via Native Messaging (Tauri commands + events)
   */

window.PurePathPages = window.PurePathPages || {};

window.PurePathPages.overview = (function () {
  'use strict';

  const T = window.PurePathTransitions;

  /* Data State (populated from extension via Native Messaging) */
  let liveData = {
    sitesBlocked: 0,
    daysProtected: 0,
    keywordsActive: 0,
    threatsToday: 0,
    weeklyActivity: [0, 0, 0, 0, 0, 0, 0],
    weekDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    extensionConnected: false,
    extensionVersion: '',
  };

  // Event unlisten handles
  let unlistenStats = null;
  let unlistenStatus = null;
  let unlistenBlocklist = null;

  const quotes = [
    { text: '"Discipline is choosing between what you want now and what you want most."', author: 'Abraham Lincoln' },
    { text: '"The secret of getting ahead is getting started."', author: 'Mark Twain' },
    { text: '"Focus on being productive instead of busy."', author: 'Tim Ferriss' },
    { text: '"It does not matter how slowly you go as long as you do not stop."', author: 'Confucius' },
    { text: '"Your future self is watching you right now through memories."', author: 'Aubrey de Grey' },
    { text: '"Success is not final, failure is not fatal: it is the courage to continue that counts."', author: 'Winston Churchill' },
  ];

  function getRandomQuote() {
    return quotes[Math.floor(Math.random() * quotes.length)];
  }

  /* Tauri Interop Helpers */
  function invoke(cmd, args) {
    if (window.__TAURI__ && window.__TAURI__.core) {
      return window.__TAURI__.core.invoke(cmd, args);
    }
    return Promise.resolve(null);
  }

  function listen(event, handler) {
    if (window.__TAURI__ && window.__TAURI__.event) {
      return window.__TAURI__.event.listen(event, handler);
    }
    return Promise.resolve(() => {});
  }

  /* Update UI Elements */
  function updateStatsUI() {
    const sitesEl = document.getElementById('stat-sites');
    const daysEl = document.getElementById('stat-days');
    const keywordsEl = document.getElementById('stat-keywords');

    if (sitesEl) sitesEl.textContent = liveData.sitesBlocked.toLocaleString();
    if (daysEl) daysEl.textContent = liveData.daysProtected.toLocaleString();
    if (keywordsEl) keywordsEl.textContent = liveData.keywordsActive.toLocaleString();
  }

  function updateStatusUI() {
    const badgeLabel = document.getElementById('overview-badge-label');
    const statusTitle = document.getElementById('overview-status-title');
    const statusSubtitle = document.getElementById('overview-status-subtitle');
    const pulseDot = document.querySelector('#overview-banner .pulse-dot-inner');

    if (liveData.extensionConnected) {
      if (badgeLabel) badgeLabel.textContent = 'System Secure';
      if (statusTitle) statusTitle.textContent = 'Protection Active';
      if (statusSubtitle) statusSubtitle.textContent = `Extension v${liveData.extensionVersion || '?'} connected · All shields operational`;
      if (pulseDot) pulseDot.style.background = 'var(--color-success, #22c55e)';
    } else {
      if (badgeLabel) badgeLabel.textContent = 'Extension Offline';
      if (statusTitle) statusTitle.textContent = 'Waiting for Extension';
      if (statusSubtitle) statusSubtitle.textContent = 'Open Chrome with Pure Path extension to sync';
      if (pulseDot) pulseDot.style.background = 'var(--color-warning, #f59e0b)';
    }
  }

  /* Fetch initial data from Tauri backend */
  async function fetchInitialData() {
    try {
      // Get stats
      const stats = await invoke('get_extension_stats');
      if (stats) {
        liveData.sitesBlocked = stats.total_blocks || 0;
        liveData.daysProtected = stats.days_protected || 0;
      }

      // Get blocklists (for keyword count)
      const blocklists = await invoke('get_extension_blocklists');
      if (blocklists) {
        liveData.keywordsActive = blocklists.keyword_count || 0;
      }

      // Get connection status
      const status = await invoke('get_extension_status');
      if (status) {
        liveData.extensionConnected = status.connected || false;
        liveData.extensionVersion = status.extension_version || '';
      }

      updateStatsUI();
      updateStatusUI();
    } catch (err) {
      console.log('Overview: Could not fetch initial data:', err);
    }
  }

  /* Subscribe to real-time events */
  async function subscribeToEvents() {
    // Stats updates (after each block)
    unlistenStats = await listen('extension-stats', (event) => {
      const stats = event.payload;
      if (stats) {
        liveData.sitesBlocked = stats.total_blocks || 0;
        liveData.daysProtected = stats.days_protected || 0;
        updateStatsUI();
      }
    });

    // Connection status changes
    unlistenStatus = await listen('extension-status', (event) => {
      const status = event.payload;
      if (status) {
        liveData.extensionConnected = status.connected || false;
        liveData.extensionVersion = status.extension_version || '';
        updateStatusUI();
      }
    });

    // Blocklist updates (for keyword count)
    unlistenBlocklist = await listen('extension-blocklist', (event) => {
      const bl = event.payload;
      if (bl) {
        liveData.keywordsActive = bl.keyword_count || 0;
        updateStatsUI();
      }
    });
  }

  /* Render */
  function render() {
    const q = getRandomQuote();
    const maxActivity = Math.max(...liveData.weeklyActivity, 1);

    return `
      <!-- Status Banner -->
      <div class="glass-card status-banner" id="overview-banner">
        <div class="status-badge">
          <div class="pulse-dot">
            <div class="pulse-dot-ring"></div>
            <div class="pulse-dot-inner"></div>
          </div>
          <span class="status-badge-label" id="overview-badge-label">Connecting…</span>
        </div>
        <h2 class="status-title" id="overview-status-title">Initializing</h2>
        <p class="status-subtitle" id="overview-status-subtitle">Connecting to extension…</p>
      </div>

      <!-- Stats -->
      <div class="stats-row mt-24" id="overview-stats">
        <div class="glass-card stat-card">
          <div class="stat-icon-wrapper">
            <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <div class="stat-value" id="stat-sites">0</div>
          <div class="stat-label">Sites Blocked</div>
        </div>
        <div class="glass-card stat-card">
          <div class="stat-icon-wrapper success">
            <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <div class="stat-value" id="stat-days">0</div>
          <div class="stat-label">Days Protected</div>
        </div>
        <div class="glass-card stat-card">
          <div class="stat-icon-wrapper blue">
            <svg viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
          </div>
          <div class="stat-value" id="stat-keywords">0</div>
          <div class="stat-label">Keywords Active</div>
        </div>
      </div>

      <!-- Activity Chart -->
      <div class="glass-card mt-24" id="overview-activity">
        <div class="section-title" style="margin-bottom: 4px;">Weekly Activity</div>
        <p class="text-muted" style="font-size: 13px; margin-bottom: 8px;">Blocked attempts this week</p>
        <div class="activity-chart">
          ${liveData.weeklyActivity.map((val, i) =>
            `<div class="activity-bar" style="height: ${(val / maxActivity) * 100}%;" title="${liveData.weekDays[i]}: ${val} blocked"></div>`
          ).join('')}
        </div>
        <div class="activity-labels">
          ${liveData.weekDays.map(d => `<span class="activity-label">${d}</span>`).join('')}
        </div>
      </div>

      <!-- Quote -->
      <div class="glass-card quote-card mt-24" id="overview-quote">
        <div class="quote-icon-wrapper">
          <svg viewBox="0 0 24 24"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>
        </div>
        <div>
          <p class="quote-text" id="overview-quote-text">${q.text}</p>
          <p class="quote-author">${q.author}</p>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="flex-col gap-16 mt-24" id="overview-actions">
        <button class="quick-action-btn" data-action="goto-blocking">
          <div class="quick-action-left">
            <div class="quick-action-icon">
              <svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </div>
            Manage Blocklists
          </div>
          <div class="quick-action-arrow">
            <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </button>
        <button class="quick-action-btn" data-action="goto-settings">
          <div class="quick-action-left">
            <div class="quick-action-icon">
              <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
            Security Settings
          </div>
          <div class="quick-action-arrow">
            <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </button>
      </div>
    `;
  }

  /* Init (called after render) */
  function init() {
    // Animate counters from 0 (they'll update when data arrives)
    T.animateCounter(document.getElementById('stat-sites'), 0, 0.5);
    T.animateCounter(document.getElementById('stat-days'), 0, 0.5);
    T.animateCounter(document.getElementById('stat-keywords'), 0, 0.5);

    // Stagger cards entrance
    const cards = document.querySelectorAll('#page-overview .glass-card, #page-overview .quick-action-btn');
    T.staggerCards(cards, 0.1);

    // Quick action navigation
    document.querySelectorAll('[data-action="goto-blocking"]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.PurePathApp) window.PurePathApp.navigateTo('blocking');
      });
    });
    document.querySelectorAll('[data-action="goto-settings"]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.PurePathApp) window.PurePathApp.navigateTo('settings');
      });
    });

    // Fetch data from Tauri backend and subscribe to events
    fetchInitialData();
    subscribeToEvents();
  }

  function destroy() {
    // Cleanup event listeners
    if (unlistenStats) { unlistenStats(); unlistenStats = null; }
    if (unlistenStatus) { unlistenStatus(); unlistenStatus = null; }
    if (unlistenBlocklist) { unlistenBlocklist(); unlistenBlocklist = null; }
  }

  return { render, init, destroy };
})();
