/* ═══════════════════════════════════════════════════════════════════
   Pure Path — Blocking Manager Page
   Domains & keywords management with search, add, delete
   ═══════════════════════════════════════════════════════════════════ */

window.PurePathPages = window.PurePathPages || {};

window.PurePathPages.blocking = (function () {
  'use strict';

  const T = window.PurePathTransitions;

  /* ─── Mock Data ────────────────────────────────────────────────── */
  let domains = [
    'example-adult.com', 'nsfw-content.net', 'explicit-hub.org',
    'harmful-site.co', 'unsafe-page.io', 'blocked-domain.xyz',
    'restricted-content.com', 'filtered-site.net', 'adult-only.org',
    'danger-zone.co', 'bad-content.io', 'unclean-web.com',
  ];

  let keywords = [
    'explicit', 'nsfw', 'adult', 'xxx', 'porn', 'nude',
    'unfiltered', 'uncensored', 'inappropriate', 'harmful',
    'violent', 'graphic', 'obscene', 'profanity',
  ];

  /* ─── Helpers ──────────────────────────────────────────────────── */
  function shieldIcon() {
    return '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
  }

  function xIcon() {
    return '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  }

  function searchIcon() {
    return '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  }

  function renderDomainList(filter) {
    const filtered = filter
      ? domains.filter(d => d.toLowerCase().includes(filter.toLowerCase()))
      : domains;

    if (filtered.length === 0) {
      return `<div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <div class="empty-state-text">${filter ? 'No domains match your search' : 'No domains blocked yet'}</div>
      </div>`;
    }

    return filtered.map(d => `
      <div class="block-item" data-domain="${d}">
        <div class="block-item-left">
          <span class="block-item-shield">${shieldIcon()}</span>
          <span class="block-item-text">${d}</span>
        </div>
        <button class="block-item-delete" data-delete-domain="${d}" title="Remove">${xIcon()}</button>
      </div>
    `).join('');
  }

  function renderKeywordTags(filter) {
    const filtered = filter
      ? keywords.filter(k => k.toLowerCase().includes(filter.toLowerCase()))
      : keywords;

    if (filtered.length === 0) {
      return `<div class="empty-state">
        <div class="empty-state-icon">🏷️</div>
        <div class="empty-state-text">${filter ? 'No keywords match your search' : 'No keywords blocked yet'}</div>
      </div>`;
    }

    return filtered.map(k => `
      <span class="keyword-tag" data-keyword="${k}">
        ${k}
        <button class="keyword-tag-delete" data-delete-keyword="${k}" title="Remove">${xIcon()}</button>
      </span>
    `).join('');
  }

  /* ─── Modal HTML ───────────────────────────────────────────────── */
  function addModal(type) {
    const isDomain = type === 'domain';
    return `
      <div class="modal-overlay" id="block-modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">Block a ${isDomain ? 'Domain' : 'Keyword'}</h3>
            <button class="modal-close" id="modal-close-btn">×</button>
          </div>
          <div class="form-group">
            <label class="form-label" for="block-input">${isDomain ? 'Domain Name' : 'Keyword'}</label>
            <input type="text" id="block-input" class="form-input"
              placeholder="${isDomain ? 'example.com' : 'keyword'}" autocomplete="off">
            <p class="form-help">${isDomain ? 'Enter the domain without "www." or "http://"' : 'Enter a single keyword or phrase to block'}</p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" id="modal-cancel-btn">Cancel</button>
            <button class="btn btn-primary" id="modal-save-btn">Add ${isDomain ? 'Domain' : 'Keyword'}</button>
          </div>
        </div>
      </div>
    `;
  }

  /* ─── Render ───────────────────────────────────────────────────── */
  function render() {
    return `
      <div class="mb-24">
        <h1 class="page-title">Blocking Manager</h1>
        <p class="page-subtitle">Manage your boundaries. All rules are currently <span class="text-violet">active</span> and protecting you.</p>
      </div>

      <!-- Stats -->
      <div class="blocking-stats-row mb-24" id="block-stats">
        <div class="glass-card blocking-pill">
          <div class="blocking-pill-icon">🌐</div>
          <div>
            <div class="blocking-pill-value" id="block-domain-count">0</div>
            <div class="blocking-pill-label">Blocked Domains</div>
          </div>
        </div>
        <div class="glass-card blocking-pill">
          <div class="blocking-pill-icon">🏷️</div>
          <div>
            <div class="blocking-pill-value" id="block-keyword-count">0</div>
            <div class="blocking-pill-label">Blocked Keywords</div>
          </div>
        </div>
      </div>

      <!-- Panels Grid -->
      <div class="blocking-grid" id="block-panels">
        <!-- Domains Panel -->
        <div class="glass-card-static blocking-panel">
          <div class="panel-header">
            <div class="panel-title-group">
              <div class="panel-icon">🌐</div>
              <div>
                <div class="panel-title">Blocked Domains</div>
                <div class="panel-count" id="domain-panel-count">ACTIVE RULES</div>
              </div>
            </div>
            <button class="add-btn" id="add-domain-btn" title="Add Domain">+</button>
          </div>
          <div class="search-bar">
            <span class="search-bar-icon">${searchIcon()}</span>
            <input type="text" class="search-input" id="domain-search" placeholder="Search domains...">
          </div>
          <div class="block-list" id="domain-list">
            ${renderDomainList()}
          </div>
        </div>

        <!-- Keywords Panel -->
        <div class="glass-card-static blocking-panel">
          <div class="panel-header">
            <div class="panel-title-group">
              <div class="panel-icon">🏷️</div>
              <div>
                <div class="panel-title">Blocked Keywords</div>
                <div class="panel-count" id="keyword-panel-count">ACTIVE RULES</div>
              </div>
            </div>
            <button class="add-btn" id="add-keyword-btn" title="Add Keyword">+</button>
          </div>
          <div class="search-bar">
            <span class="search-bar-icon">${searchIcon()}</span>
            <input type="text" class="search-input" id="keyword-search" placeholder="Search keywords...">
          </div>
          <div class="keyword-tags" id="keyword-list">
            ${renderKeywordTags()}
          </div>
        </div>
      </div>
    `;
  }

  /* ─── Refresh Lists ────────────────────────────────────────────── */
  function refreshDomains(filter) {
    const el = document.getElementById('domain-list');
    if (el) el.innerHTML = renderDomainList(filter);
    updateCounts();
    bindDeleteHandlers();
  }

  function refreshKeywords(filter) {
    const el = document.getElementById('keyword-list');
    if (el) el.innerHTML = renderKeywordTags(filter);
    updateCounts();
    bindDeleteHandlers();
  }

  function updateCounts() {
    const dc = document.getElementById('block-domain-count');
    const kc = document.getElementById('block-keyword-count');
    const dpc = document.getElementById('domain-panel-count');
    const kpc = document.getElementById('keyword-panel-count');
    if (dc) dc.textContent = domains.length;
    if (kc) kc.textContent = keywords.length;
    if (dpc) dpc.textContent = `${domains.length} ACTIVE RULES`;
    if (kpc) kpc.textContent = `${keywords.length} ACTIVE RULES`;
  }

  /* ─── Delete Handlers ──────────────────────────────────────────── */
  function bindDeleteHandlers() {
    document.querySelectorAll('[data-delete-domain]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const d = btn.getAttribute('data-delete-domain');
        domains = domains.filter(x => x !== d);
        const item = btn.closest('.block-item');
        if (item) {
          gsap.to(item, {
            opacity: 0, x: -20, height: 0, padding: 0, margin: 0,
            duration: 0.3, ease: 'power2.in',
            onComplete: () => refreshDomains(document.getElementById('domain-search')?.value),
          });
        } else {
          refreshDomains();
        }
      });
    });

    document.querySelectorAll('[data-delete-keyword]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const k = btn.getAttribute('data-delete-keyword');
        keywords = keywords.filter(x => x !== k);
        const tag = btn.closest('.keyword-tag');
        if (tag) {
          gsap.to(tag, {
            opacity: 0, scale: 0.7,
            duration: 0.25, ease: 'power2.in',
            onComplete: () => refreshKeywords(document.getElementById('keyword-search')?.value),
          });
        } else {
          refreshKeywords();
        }
      });
    });
  }

  /* ─── Modal Logic ──────────────────────────────────────────────── */
  function openModal(type) {
    const root = document.getElementById('modal-root');
    if (!root) return;
    root.innerHTML = addModal(type);

    const overlay = document.getElementById('block-modal-overlay');
    requestAnimationFrame(() => T.showModal(overlay));

    const closeModal = () => {
      T.hideModal(overlay, () => { root.innerHTML = ''; });
    };

    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    const input = document.getElementById('block-input');
    input.focus();

    const save = () => {
      const val = input.value.trim().toLowerCase();
      if (!val) return;

      if (type === 'domain') {
        if (!domains.includes(val)) {
          domains.push(val);
          refreshDomains();
        }
      } else {
        if (!keywords.includes(val)) {
          keywords.push(val);
          refreshKeywords();
        }
      }
      closeModal();
    };

    document.getElementById('modal-save-btn').addEventListener('click', save);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  }

  /* ─── Init ─────────────────────────────────────────────────────── */
  function init() {
    // Animate counters
    T.animateCounter(document.getElementById('block-domain-count'), domains.length, 1.0);
    T.animateCounter(document.getElementById('block-keyword-count'), keywords.length, 1.0);

    updateCounts();

    // Stagger cards
    const cards = document.querySelectorAll('#page-blocking .glass-card, #page-blocking .glass-card-static');
    T.staggerCards(cards, 0.08);

    // Search
    document.getElementById('domain-search')?.addEventListener('input', (e) => {
      refreshDomains(e.target.value);
    });
    document.getElementById('keyword-search')?.addEventListener('input', (e) => {
      refreshKeywords(e.target.value);
    });

    // Add buttons
    document.getElementById('add-domain-btn')?.addEventListener('click', () => openModal('domain'));
    document.getElementById('add-keyword-btn')?.addEventListener('click', () => openModal('keyword'));

    // Delete handlers
    bindDeleteHandlers();
  }

  function destroy() {}

  return { render, init, destroy };
})();
