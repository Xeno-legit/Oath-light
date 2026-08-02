/* theme-sync.js — keeps an extension page's light/dark side in lockstep with
 * the desktop app's selection. The desktop pushes the chosen display into
 * chrome.storage.local (key `display`, mirrored to individual keys) via native
 * messaging; this reads it and sets `data-theme`.
 *
 * Shared by popup, blocklists and user_blocklist. (blocked.js has its own copy
 * because it also drives the animated background.)
 *
 * There is no palette axis any more. `data-style` used to carry one of seven
 * palette names and every stylesheet keyed its colours off it; Noir has been
 * the only built-in theme since 2026-07-19, the six others were deleted from
 * the stylesheets, and what remained here was validation logic for values
 * nothing wrote against selectors nothing had. The `style` key is not even
 * read from storage now — leaving it read-but-unused is how it would creep
 * back.
 */
(function () {
  const THEMES = ['light', 'dark'];
  const DEFAULT_THEME = 'dark';

  function apply(d) {
    d = d || {};
    const theme = THEMES.includes(d.theme) ? d.theme : DEFAULT_THEME;
    document.documentElement.setAttribute('data-theme', theme);
  }

  function read(cb) {
    if (typeof chrome === 'undefined' || !chrome.storage) { cb({}); return; }
    chrome.storage.local.get(['display', 'theme'], (r) => {
      const d = r && r.display && typeof r.display === 'object' ? r.display : (r || {});
      cb({ theme: d.theme });
    });
  }

  read(apply);

  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (['display', 'theme'].some((k) => k in changes)) read(apply);
    });
  }
})();
