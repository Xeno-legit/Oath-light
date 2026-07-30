// Builds Oath Light's companion executables and stages them as Tauri "sidecars"
// so the installer ships them next to OathLight.exe:
//
//   * oathlightguard  — the watchdog guardian   (desktop-app/guardian)
//   * oath-light-host — the native-messaging host (desktop-app/native-host)
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
import {
  mkdirSync,
  copyFileSync,
  existsSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
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
  { dir: 'guardian', bin: 'oathlightguard' },
  { dir: 'native-host', bin: 'oath-light-host' },
];

for (const { dir, bin } of crates) {
  const manifest = join(root, dir, 'Cargo.toml');
  console.log(`[sidecars] building ${bin} for ${triple}`);
  execFileSync(
    'cargo',
    ['build', '--release', '--manifest-path', manifest, '--target', triple],
    { stdio: 'inherit' },
  );

  // A.1: guardian/native-host are now workspace members (desktop-app/Cargo.toml),
  // so `cargo build --manifest-path <dir>/Cargo.toml` resolves the workspace and
  // places output under the WORKSPACE root's target dir, not <dir>/target —
  // even though the command is invoked with a per-crate --manifest-path. The
  // per-crate `<dir>/target` dirs from before the workspace move are now stale.
  const src = join(root, 'target', triple, 'release', bin + ext);
  if (!existsSync(src)) throw new Error(`[sidecars] built binary missing: ${src}`);

  const dst = join(outDir, `${bin}-${triple}${ext}`);
  copyFileSync(src, dst);
  console.log(`[sidecars] staged ${dst}`);

  unblockCopyTargets(bin);
}

// tauri-build copies each sidecar from `binaries/` next to the app executable
// (`target/<profile>/<bin><ext>`) and does so with a bare
// `fs::remove_file(dest).unwrap()` — so a *running* guardian / native-messaging
// host makes the whole build fail with `Os { code: 5, PermissionDenied }`.
//
// The host is respawned by the browser and the guardian by the app, so both can
// be live whenever a build starts. We can't always kill them (they may run
// elevated), but Windows does allow renaming a running executable, which is
// enough: with the path free, tauri-build's remove+copy succeeds and the old
// process keeps running off its renamed image until it exits on its own.
function unblockCopyTargets(bin) {
  for (const dir of copyTargetDirs()) {
    sweepStale(dir, bin);

    const dest = join(dir, bin + ext);
    if (!existsSync(dest)) continue;

    try {
      rmSync(dest);
      continue;
    } catch {
      // in use — fall through to the rename
    }

    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const aside = `${dest}.locked-${stamp}`;
    try {
      renameSync(dest, aside);
      console.log(`[sidecars] ${bin}${ext} is running; moved aside to ${aside}`);
    } catch (err) {
      throw new Error(
        `[sidecars] ${dest} is locked and could not be moved aside (${err.code ?? err.message}). ` +
          `Close Oath Light and any running ${bin}${ext} process, then rebuild.`,
      );
    }
  }
}

// Where tauri-build may land the sidecars: plain and --target-qualified target
// dirs, both profiles. Missing ones are skipped by the caller.
function copyTargetDirs() {
  const target = join(root, 'target');
  return [
    join(target, 'debug'),
    join(target, 'release'),
    join(target, triple, 'debug'),
    join(target, triple, 'release'),
  ].filter((d) => existsSync(d));
}

// Drop `.locked-*` leftovers from earlier builds once their process is gone,
// so target/ doesn't accumulate a copy per build.
function sweepStale(dir, bin) {
  const prefix = `${bin}${ext}.locked-`;
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix)) continue;
    try {
      rmSync(join(dir, name));
    } catch {
      // still running — leave it for a later build
    }
  }
}

function hostTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const m = out.match(/^host:\s*(.+)$/m);
  if (!m) throw new Error('[sidecars] could not read host triple from `rustc -vV`');
  return m[1].trim();
}
