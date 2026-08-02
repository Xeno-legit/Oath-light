// scripts/sync-design-system.mjs — push the design system out to every surface.
//
// `design-system/` is the source of truth for copy (`strings.js`, `locales/*`)
// and visuals (`tokens.css`, `tokens.js`), but there is no build step, so each
// surface carries a verbatim copy. Editing the source and forgetting the copy
// is the whole failure mode this script removes: edit ONE file — always the one
// in design-system/ — then let this put it everywhere.
//
// Wired into the desktop app's `beforeDevCommand` / `beforeBuildCommand` and
// into the extension zip builder, so `tauri dev`, `tauri build` and a store
// build can't ship a stale copy. Run standalone any time:
//
//   node scripts/sync-design-system.mjs          # copy source -> surfaces
//   node scripts/sync-design-system.mjs --check  # report only, exit 1 on drift
//
// Never hand-edit a surface copy: the next run of this script overwrites it,
// and scripts/ci/check-design-system-sync.mjs fails the build in the meantime.
'use strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COPIES } from './design-system-copies.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

const updated = [];
const missing = [];
let inSync = 0;

for (const [sourceName, targets] of Object.entries(COPIES)) {
  const sourcePath = join(REPO_ROOT, 'design-system', sourceName);
  if (!existsSync(sourcePath)) {
    missing.push(`design-system/${sourceName} is missing — it is the source of truth for ${targets.length} copies`);
    continue;
  }
  const source = readFileSync(sourcePath);

  for (const rel of targets) {
    const target = join(REPO_ROOT, rel);

    // Byte comparison, not mtime: a copy that happens to be newer is still
    // wrong if its contents differ, and rewriting an identical file would
    // churn its timestamp and re-trigger every watcher downstream.
    if (existsSync(target) && source.equals(readFileSync(target))) {
      inSync++;
      continue;
    }

    if (checkOnly) {
      updated.push(rel);
      continue;
    }

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
    updated.push(rel);
    console.log(`[design-system] ${sourceName} -> ${rel}`);
  }
}

if (missing.length) {
  for (const m of missing) console.error(`✗ ${m}`);
  process.exit(1);
}

if (checkOnly) {
  if (updated.length) {
    console.error(`✗ ${updated.length} surface copy(ies) out of date: ${updated.join(', ')}`);
    process.exit(1);
  }
  console.log(`design-system in sync — ${inSync} copies match their source`);
  process.exit(0);
}

console.log(
  updated.length
    ? `[design-system] synced ${updated.length} copy(ies); ${inSync} already current`
    : `[design-system] all ${inSync} surface copies already current`,
);
