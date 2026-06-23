/* theme-sync.js — keeps an extension page's theme/palette in lockstep with the
 * desktop app's selection. The desktop pushes the chosen display into
 * chrome.storage.local (key `display`, mirrored to individual keys) via native
 * messaging; this reads it and applies the matching data-theme / data-style.
 *
 * The palette CSS (aurora/lagoon/dawn/midnight/forest/ember × light/dark) already
 * lives in each page's stylesheet, so this only flips the two attributes.
 * Shared by popup, blocklists and user_blocklist. (blocked.js has its own copy
 * because it also drives the animated background.)
 */
(function () {
  const THEMES = ['light', 'dark'];
  const STYLES = ['aurora', 'lagoon', 'dawn', 'midnight', 'forest', 'ember'];
  const DEFAULTS = { theme: 'dark', style: 'aurora' };

  const pick = (v, allowed, fb) => (allowed.includes(v) ? v : fb);

  function apply(d) {
    d = d || {};
    const el = document.documentElement;
    el.setAttribute('data-theme', pick(d.theme, THEMES, DEFAULTS.theme));
    el.setAttribute('data-style', pick(d.style, STYLES, DEFAULTS.style));
  }

  function read(cb) {
    if (typeof chrome === 'undefined' || !chrome.storage) { cb({}); return; }
    chrome.storage.local.get(['display', 'theme', 'style'], (r) => {
      const d = r && r.display && typeof r.display === 'object' ? r.display : (r || {});
      cb({ theme: d.theme, style: d.style });
    });
  }

  read(apply);

  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (['display', 'theme', 'style'].some((k) => k in changes)) read(apply);
    });
  }
})();
