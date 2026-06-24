// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // Guardian mode: the same binary relaunched with `--watchdog` by the main app.
  // It only keeps the main app alive (no Tauri window). See watchdog.rs.
  if std::env::args().skip(1).any(|a| a == "--watchdog") {
    app_lib::run_guardian();
    return;
  }
  app_lib::run();
}
// Forced rebuild to apply new icon
