//! Build script — Tauri codegen, plus embedding the two companion binaries.
//!
//! ## Why the sidecars get baked into the app binary
//!
//! `oathlightguard.exe` and `oath-light-host.exe` ship as Tauri "sidecars":
//! `bundle-sidecars.mjs` stages them under `binaries/`, and the bundler copies
//! them next to `OathLight.exe` at install time. That works for a *fresh*
//! install and is unreliable for an upgrade, because both of them are usually
//! **running** when the new installer arrives — the guardian resurrects itself
//! by design, and the native host is respawned by any browser that talks to the
//! extension. Windows will not let an installer overwrite a locked file, and an
//! installer that quietly skips two files leaves a new app driving two old
//! companions, with nothing on screen to say so.
//!
//! So the app carries its own copies and repairs them itself at startup (see
//! `src/sidecars.rs`). The main executable is the one file an installer can
//! always replace — it is what the installer closes first — so anything
//! reachable from inside it is, by construction, as fresh as the app is.
//!
//! ## What this script emits
//!
//! `OL_GUARDIAN_BIN` and `OL_HOST_BIN`, each an absolute path that
//! `include_bytes!` can read. When a staged sidecar is missing — `cargo check`,
//! a test run, any build that hasn't run `bundle-sidecars.mjs` — the variable
//! points at an empty placeholder in `OUT_DIR` instead of failing the build.
//! `sidecars.rs` treats an empty payload as "nothing embedded, do nothing",
//! which keeps `cargo check`/`cargo test` working with no sidecars staged and
//! makes a bundle-less dev build behave exactly as it did before.

use std::path::{Path, PathBuf};

fn main() {
    embed_sidecars();
    tauri_build::build()
}

/// Point `OL_GUARDIAN_BIN` / `OL_HOST_BIN` at a readable file, always.
fn embed_sidecars() {
    // `TARGET` is set for every cargo build; `bundle-sidecars.mjs` names its
    // output with the same triple (that naming is Tauri's own sidecar
    // convention, not ours to choose).
    let triple = std::env::var("TARGET").unwrap_or_default();
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default());
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap_or_default());
    let ext = if triple.contains("windows") { ".exe" } else { "" };

    for (var, bin) in [("OL_GUARDIAN_BIN", "oathlightguard"), ("OL_HOST_BIN", "oath-light-host")] {
        let staged = manifest.join("binaries").join(format!("{bin}-{triple}{ext}"));
        // Re-run when the staged binary changes, so re-staging a rebuilt
        // sidecar actually re-embeds it instead of reusing a cached build.
        println!("cargo:rerun-if-changed={}", staged.display());

        let path = if staged.is_file() {
            staged
        } else {
            let placeholder = out_dir.join(format!("{bin}.absent"));
            // Only write when missing: rewriting on every build would churn the
            // mtime and re-trigger this script's own rerun-if-changed.
            if !placeholder.exists() {
                let _ = std::fs::write(&placeholder, []);
            }
            placeholder
        };
        emit(var, &path);
    }
}

fn emit(var: &str, path: &Path) {
    println!("cargo:rustc-env={var}={}", path.display());
}
