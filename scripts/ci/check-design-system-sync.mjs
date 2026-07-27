// scripts/ci/check-design-system-sync.mjs — design-system copy gate
// (UX Direction §5). The design system has no build step: `tokens.css` and
// `strings.js` are plain files copied verbatim into each surface, because the
// MV3 extension can't import across directories and the renderer has no
// bundler. That's the right call for shipping — but "copy" plus "no check" is
// how a design system silently forks into four slightly-different ones.
//
// This gate makes drift a build failure instead of a discovery six months
// later: every listed copy must be BYTE-identical to its source in
// design-system/. To change a token or a string, edit the source and re-copy.
//
// Run by .github/workflows/ci.yml; safe locally:
//   node scripts/ci/check-design-system-sync.mjs
'use strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// source (relative to design-system/) -> every surface copy that must match it.
const COPIES = {
  'tokens.css': [
    'desktop-app/src/renderer/tokens.css',
    'extension/popup_assets/tokens.css',
    'extension/blocklist_assets/tokens.css',
  ],
  'strings.js': [
    'desktop-app/src/renderer/strings.js',
    'extension/strings.js',
  ],
  // The token METADATA manifest (names/groups/control types, no values). The
  // renderer's Themes page builds its custom-color editor from it, so it must
  // describe exactly the same tokens the shipped tokens.css declares.
  'tokens.js': [
    'desktop-app/src/renderer/tokens.js',
  ],
};

const errors = [];
let checked = 0;

for (const [sourceName, targets] of Object.entries(COPIES)) {
  const sourcePath = join(REPO_ROOT, 'design-system', sourceName);
  if (!existsSync(sourcePath)) {
    errors.push(`design-system/${sourceName} is missing — it is the source of truth for ${targets.length} copies`);
    continue;
  }
  const source = readFileSync(sourcePath);
  for (const rel of targets) {
    const target = join(REPO_ROOT, rel);
    if (!existsSync(target)) {
      errors.push(`${rel} is missing (should be a copy of design-system/${sourceName})`);
      continue;
    }
    checked++;
    if (!source.equals(readFileSync(target))) {
      errors.push(`${rel} has drifted from design-system/${sourceName} — copy the source over it (do not hand-edit the copy)`);
    }
  }
}

if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  console.error(`\ndesign-system sync FAILED: ${errors.length} problem(s)`);
  process.exit(1);
}

console.log(`design-system sync OK — ${checked} surface copies byte-identical to their sources`);
process.exit(0);
