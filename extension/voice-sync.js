/* voice-sync.js — keeps an extension page's VOICE in lockstep with the desktop
 * app, exactly the way theme-sync.js does for the palette (UX Direction §2).
 *
 * Where the two values come from:
 *   voice   — the user's onboarding choice ('companion' | 'serious'). The
 *             renderer owns it and pushes it inside the blocking-settings
 *             object (`ppBlocking.voice`), same channel as the redirect target.
 *   serious — Serious Mode (UX Direction §1). NOT a presentation preference:
 *             the desktop backend owns it (settings.rs), because turning it
 *             OFF is a friction-gated weakening. It arrives on the same push
 *             as `ppBlocking.serious` and, when on, forces the hard voice
 *             regardless of `voice` — that override lives in strings.js's
 *             `t()`, not here, so every surface gets it identically.
 *
 * Declarative binding: any element with `data-ol-str="some.key"` has its text
 * replaced with the active-voice string, and `data-ol-str-attr="placeholder"`
 * (or title/aria-label) targets an attribute instead. That means a voice flip
 * repaints the whole page with no per-page code — which is what makes Serious
 * Mode's "the whole app's register changes" requirement actually hold.
 * Interpolation params come from `data-ol-str-params` (a JSON object).
 *
 * Load AFTER strings.js and before the page's own script. Pages that build
 * markup dynamically call `OLVoice.paint(root)` after inserting it.
 */
(function () {
  'use strict';

  const S = typeof globalThis !== 'undefined' ? globalThis.OL_STRINGS : null;

  // Apply one string binding to one element. Missing keys fall back to the key
  // itself (strings.js's `t` contract), which makes a typo visible instead of
  // blanking real UI copy.
  function bind(el) {
    if (!S) return;
    const key = el.getAttribute('data-ol-str');
    if (!key) return;
    let params = null;
    const raw = el.getAttribute('data-ol-str-params');
    if (raw) { try { params = JSON.parse(raw); } catch (e) { params = null; } }
    const value = S.t(key, params);
    const attr = el.getAttribute('data-ol-str-attr');
    if (attr) el.setAttribute(attr, value);
    else el.textContent = value;
  }

  // Repaint every bound element under `root` (default: the whole document).
  function paint(root) {
    const scope = root || document;
    if (!scope || !scope.querySelectorAll) return;
    scope.querySelectorAll('[data-ol-str]').forEach(bind);
  }

  // The visual half of the flip: tokens.css keys its Serious Mode overrides off
  // a bare `[data-serious]` attribute on the root element.
  function applySeriousAttr(on) {
    try {
      const el = document.documentElement;
      if (on) el.setAttribute('data-serious', '');
      else el.removeAttribute('data-serious');
    } catch (e) { /* no DOM (shouldn't happen on a page) — ignore */ }
  }

  function apply(cfg) {
    if (!S) return;
    const c = cfg || {};
    S.setVoice(c.voice || S.defaultVoice);
    S.setSeriousMode(!!c.serious);
    applySeriousAttr(!!c.serious);
    paint();
  }

  function read(cb) {
    if (typeof chrome === 'undefined' || !chrome.storage) { cb({}); return; }
    chrome.storage.local.get(['ppBlocking'], (r) => {
      const b = r && r.ppBlocking && typeof r.ppBlocking === 'object' ? r.ppBlocking : {};
      cb({ voice: b.voice, serious: !!b.serious });
    });
  }

  read(apply);

  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !('ppBlocking' in changes)) return;
      read(apply);
    });
  }

  // `t` is re-exported so page scripts don't each reach for the global and
  // guard it; `paint` is for markup built after this file ran.
  window.OLVoice = {
    paint,
    t: (key, params) => (S ? S.t(key, params) : key),
    isSerious: () => !!(S && S.seriousMode),
  };
})();
