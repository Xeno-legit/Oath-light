/* ═══════════════════════════════════════════════════════════════════
   Pure Path — App Router & Sidebar Controller
   Orchestrates page routing, sidebar animations, window controls
   ═══════════════════════════════════════════════════════════════════ */

window.PurePathApp = (function () {
  'use strict';

  const T = window.PurePathTransitions;
  const pages = window.PurePathPages;

  let currentPage = 'overview';
  let isTransitioning = false;

  /* ─── DOM References ───────────────────────────────────────────── */
  const sidebar = document.getElementById('sidebar');
  const labels = document.querySelectorAll('.sidebar-item-label');
  const navItems = document.querySelectorAll('.sidebar-item');

  /* ─── Window Controls ──────────────────────────────────────────── */
  (function initWindowControls() {
    const btnMin = document.getElementById('btn-minimize');
    const btnMax = document.getElementById('btn-maximize');
    const btnClose = document.getElementById('btn-close');

    // Setup Tauri Window controls (Works in v1 and v2 withGlobalTauri)
    if (window.__TAURI__) {
      const invoke = window.__TAURI__.core ? window.__TAURI__.core.invoke : window.__TAURI__.invoke;
      let isFullscreen = false;
      if (btnMin)   btnMin.addEventListener('click', () => invoke('plugin:window|minimize'));
      if (btnMax)   btnMax.addEventListener('click', () => {
        isFullscreen = !isFullscreen;
        invoke('plugin:window|set_fullscreen', { fullscreen: isFullscreen });
      });
      if (btnClose) btnClose.addEventListener('click', () => invoke('plugin:window|close'));
    }
  })();

  /* ─── Sidebar Expand / Collapse ────────────────────────────────── */
  (function initSidebar() {
    let hoverTimeout;

    sidebar.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(() => {
        T.sidebarExpand(sidebar, labels);
      }, 150);
    });

    sidebar.addEventListener('mouseleave', () => {
      clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(() => {
        T.sidebarCollapse(sidebar, labels);
      }, 100);
    });
  })();

  /* ─── Page Rendering ───────────────────────────────────────────── */
  function renderPage(pageId) {
    const container = document.getElementById('page-' + pageId);
    const pageModule = pages[pageId];
    if (!container || !pageModule) return;

    container.innerHTML = pageModule.render();
  }

  function initPage(pageId) {
    const pageModule = pages[pageId];
    if (pageModule && pageModule.init) {
      pageModule.init();
    }
  }

  function destroyPage(pageId) {
    const pageModule = pages[pageId];
    if (pageModule && pageModule.destroy) {
      pageModule.destroy();
    }
  }

  /* ─── Navigation ───────────────────────────────────────────────── */
  function navigateTo(pageId) {
    if (pageId === currentPage || isTransitioning) return;
    if (!pages[pageId]) return;

    isTransitioning = true;

    const oldContainer = document.getElementById('page-' + currentPage);
    const newContainer = document.getElementById('page-' + pageId);

    // Update sidebar active state
    navItems.forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-page') === pageId);
    });

    // Transition out old page
    T.pageExit(oldContainer, () => {
      oldContainer.classList.remove('active');
      oldContainer.style.opacity = '0';
      destroyPage(currentPage);

      // Render and show new page
      renderPage(pageId);
      newContainer.classList.add('active');
      currentPage = pageId;

      T.pageEnter(newContainer, () => {
        isTransitioning = false;
      });

      initPage(pageId);
    });
  }

  /* ─── Bind Navigation Items ────────────────────────────────────── */
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.getAttribute('data-page');
      if (target) navigateTo(target);
    });
  });

  /* ─── Initial Render ───────────────────────────────────────────── */
  (function boot() {
    // Render the overview page immediately
    renderPage('overview');
    const overviewEl = document.getElementById('page-overview');
    if (overviewEl) {
      overviewEl.style.opacity = '1';
    }

    // Short delay for the initial page entrance feel
    requestAnimationFrame(() => {
      T.pageEnter(overviewEl);
      initPage('overview');
    });
  })();

  /* ─── Public API ───────────────────────────────────────────────── */
  return {
    navigateTo,
    getCurrentPage: () => currentPage,
  };

})();
