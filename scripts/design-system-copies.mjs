// scripts/design-system-copies.mjs — the copy manifest for the design system.
//
// The design system has no build step: `tokens.css`, `strings.js` and the
// locale tables are plain files copied verbatim into each surface, because the
// MV3 extension can't import across directories and the renderer has no
// bundler. This file is the single list of where each source lands.
//
// Two consumers, deliberately sharing one list so they can never disagree:
//   * scripts/sync-design-system.mjs   — performs the copy (edit source, run it)
//   * scripts/ci/check-design-system-sync.mjs — fails the build if a copy drifted
'use strict';

// source (relative to design-system/) -> every surface copy that must match it.
export const COPIES = {
  'tokens.css': [
    'desktop-app/src/renderer/tokens.css',
    'extension/popup_assets/tokens.css',
    'extension/blocklist_assets/tokens.css',
  ],
  'strings.js': [
    'desktop-app/src/renderer/strings.js',
    'extension/strings.js',
  ],
  // Locale tables. Same copy-verbatim rule as strings.js — they load as
  // plain sibling scripts because the MV3 service worker can only take
  // them via importScripts (no build step, no modules). Their *contents*
  // are checked separately by check-locales.mjs.
  'locales/ar.js': [
    'desktop-app/src/renderer/locales/ar.js',
    'extension/locales/ar.js',
  ],
  // The token METADATA manifest (names/groups/control types, no values). The
  // renderer's Themes page builds its custom-color editor from it, so it must
  // describe exactly the same tokens the shipped tokens.css declares.
  'tokens.js': [
    'desktop-app/src/renderer/tokens.js',
  ],
};

// The command a human should run when a copy has drifted. Quoted in the CI
// gate's failure output so the fix is never a guess.
export const SYNC_COMMAND = 'node scripts/sync-design-system.mjs';
