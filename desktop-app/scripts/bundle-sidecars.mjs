// Builds Pure Path's companion executables and stages them as Tauri "sidecars"
// so the installer ships them next to PurePath.exe:
//
//   * purepathguard  — the watchdog guardian   (desktop-app/guardian)
//   * pure-path-host — the native-messaging host (desktop-app/native-host)
//
// Tauri requires each sidecar to be named `<name>-<target-triple><ext>` under
// the path listed in `bundle.externalBin`; at bundle time it copies them next
// to the main executable as `<name><ext>`, which is exactly where
// resolve_guardian_binary / resolve_host_binary look first.
//
// Wired into `beforeDevCommand` / `beforeBuildCommand`, so `tauri dev` and
// `tauri build` always have fresh sidecars staged. Run standalone with:
//   node scripts/bundle-sidecars.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // desktop-app/scripts
const root = join(here, '..'); // desktop-app

// Tauri exports the resolved triple during its build hooks; otherwise ask rustc.
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple();
const ext = triple.includes('windows') ? '.exe' : '';

const outDir = join(root, 'src-tauri', 'binaries');
mkdirSync(outDir, { recursive: true });

const crates = [
  { dir: 'guardian', bin: 'purepathguard' },
  { dir: 'native-host', bin: 'pure-path-host' },
];

for (const { dir, bin } of crates) {
  const manifest = join(root, dir, 'Cargo.toml');
  console.log(`[sidecars] building ${bin} for ${triple}`);
  execFileSync(
    'cargo',
    ['build', '--release', '--manifest-path', manifest, '--target', triple],
    { stdio: 'inherit' },
  );

  const src = join(root, dir, 'target', triple, 'release', bin + ext);
  if (!existsSync(src)) throw new Error(`[sidecars] built binary missing: ${src}`);

  const dst = join(outDir, `${bin}-${triple}${ext}`);
  copyFileSync(src, dst);
  console.log(`[sidecars] staged ${dst}`);
}

function hostTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const m = out.match(/^host:\s*(.+)$/m);
  if (!m) throw new Error('[sidecars] could not read host triple from `rustc -vV`');
  return m[1].trim();
}
