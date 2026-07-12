//! purepath-core — shared logic for every Pure Path binary (desktop app,
//! guardian, native-host today; the DNS resolver and mobile bindings later —
//! plan Part A / Part H). Kept dependency-light and framework-agnostic on
//! purpose: no tauri types, no windows-only APIs.

pub mod eventlog;
pub mod lists;
pub mod matching;
