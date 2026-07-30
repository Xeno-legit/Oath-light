// scripts/ci/check-design-system-sync.mjs — design-system copy gate
// (UX Direction §5). The design system has no build step: `tokens.css` and
// `strings.js` are plain files copied verbatim into each surface, because the
// MV3 extension can't import across directories and the renderer has no
// bundler. That's the right call for shipping — but "copy" plus "no check" is
// how a design system silently forks into four slightly-different ones.
//
// This gate makes drift a build failure instead of a discovery six months
// later: every listed copy must be BYTE-identical to its source in
// design-system/. To change a token or a string, edit the source and run
// scripts/sync-design-system.mjs — never hand-edit a copy.
//
// The copy manifest itself lives in scripts/design-system-copies.mjs, shared
// with the sync script so the thing that performs the copy and the thing that
// polices it can never disagree about what gets copied where.
//
// Run by .github/workflows/ci.yml; safe locally:
//   node scripts/ci/check-design-system-sync.mjs
'use strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COPIES, SYNC_COMMAND } from '../design-system-copies.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

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
      errors.push(`${rel} has drifted from design-system/${sourceName} — run \`${SYNC_COMMAND}\` (do not hand-edit the copy)`);
    }
  }
}

if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  console.error(`\ndesign-system sync FAILED: ${errors.length} problem(s)`);
  console.error(`Fix: edit the source in design-system/, then run \`${SYNC_COMMAND}\`.`);
  process.exit(1);
}

console.log(`design-system sync OK — ${checked} surface copies byte-identical to their sources`);
process.exit(0);
