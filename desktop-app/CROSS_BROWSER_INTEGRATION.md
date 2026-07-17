# Oath Light — Cross-Browser Integration & Watchdog

> How the desktop app connects to the extension, monitors every **running**
> browser, and (post-release) keeps the extension installed.
> Last updated: 2026-06-11

This is the Phase 3 "cross-browser issues + desktop-as-monitor" work. It feeds
the Phase 4 watchdog (the desktop app guarding the extension is the first half
of that system).

---

## 1. Architecture

```
 ┌──────────────┐  connectNative   ┌────────────────┐  TCP 127.0.0.1:17243  ┌──────────────┐
 │  extension   │ ───────────────► │  native host   │ ───────────────────► │  desktop app │
 │ background.js│ ◄─────────────── │ oath-light-host │ ◄─────────────────── │  (Tauri/Rust)│
 └──────────────┘  stdin/stdout    └────────────────┘   length-prefixed JSON└──────────────┘
        (one host process per running browser)                                      │
                                                                          monitor loop (sysinfo)
```

- Each **running** browser that has the extension spawns its **own** native host
  process → its **own** TCP connection to the desktop app.
- The native host detects the **parent browser process** (walks the parent PID
  chain) and sends a `host_hello { browser, extOrigin }` as its first TCP
  message, so the desktop app tracks each browser independently.
- The desktop app keeps a `connections: HashMap<browserKey, ConnState>` and a
  **monitor loop** (`start_monitor`, every 3s) that reconciles *what's running*
  (via `sysinfo`) against *what's connected* (heartbeats).

### Per-browser states (emitted as the `browsers-status` event)

| state | meaning |
|---|---|
| `not_installed` | browser not detected on the machine |
| `idle` | installed but not currently running |
| `connecting` | running, within the 45s grace window, extension not yet talking |
| `running_connected` | running + a fresh heartbeat (≤40s) — protected |
| `extension_missing` | running for >45s with no live extension — disabled/removed |

The frontend (`tauri-bridge.jsx` → `useBrowsers()`, rendered by
`BrowserProtectionCard` in `pages-overview.jsx`) shows only the **live**
browsers (running or connected).

---

## 2. The stable extension ID (important)

The Chromium extension ID is derived from the public `key` pinned in
`extension/manifest.json`, so it is **identical in unpacked dev and packed
builds**. Without this the dev ID is path-derived and would never match the
host manifest's `allowed_origins`, so native messaging silently fails.

- ID: `lknpaoecooklfjgenmjpkdkahgoofank` — the single source of truth is
  `EXTENSION_ID` in `src-tauri/src/browsers.rs`.
- The private key is `desktop-app/oathlight-extension-key.pem` (gitignored —
  `*.pem`). **Keep it safe**: it's needed to self-host a CRX with this ID. The
  Chrome Web Store re-signs and manages its own key, but pinning `key` keeps the
  ID stable everywhere else.
- If you ever change the `key`, recompute the ID: `sha256(SPKI DER)`, take the
  first 16 bytes, map each nibble `0..f` → `a..p`.

---

## 3. Browser support

`BROWSERS` in `browsers.rs` is the one table driving detection, registration,
and enforcement: **Chrome, Edge, Brave, Opera, Vivaldi, Chromium (Chromium
engine) and Firefox (Gecko)**. Native-host manifests come in two flavors:

- Chromium → `com.oathlight.companion.json` with `allowed_origins`
  (`chrome-extension://<id>/`).
- Gecko → `com.oathlight.companion.firefox.json` with `allowed_extensions`
  (`oathlight@xeno-legit.github.io`).

Host registration is written broadly to every vendor's `NativeMessagingHosts`
key on startup (a stray key for an absent browser is harmless). Monitoring and
enforcement target only **running** browsers.

---

## 4. "Re-add the extension if removed" — force-install (gated until release)

An external app **cannot** install a browser extension through any normal API.
The only real mechanism is the enterprise **force-install policy**, which
reinstalls a removed extension on the browser's next launch and greys out the
Remove button:

- Chromium: `…\Policies\<Vendor>\<Browser>\ExtensionInstallForcelist` →
  `<extID>;<updateURL>`
- Firefox: `…\Policies\Mozilla\Firefox\ExtensionSettings\<id>` →
  `installation_mode=force_installed`, `install_url=<xpi>`

This requires the extension to be **published / self-hosted with an update URL**.
It is therefore **DORMANT** today: `enforce_policy()` is a no-op while
`CHROMIUM_UPDATE_URL` / `FIREFOX_XPI_URL` in `browsers.rs` are empty. Detection
and monitoring run fully now; auto-reinstall switches on the moment those URLs
are filled in. The desktop app prefers `HKLM` (machine-wide hard lock; it runs
elevated) and falls back to `HKCU`.

> Real-time caveat: a removed extension reappears on the **next browser launch /
> policy refresh**, not instantly. The UI reflects this ("restoring on restart").

### Go-live checklist (when the extension is published)

1. **Chrome Web Store**: publish; confirm the listing ID matches
   `EXTENSION_ID`. Set `CHROMIUM_UPDATE_URL =
   "https://clients2.google.com/service/update2/crx"`.
   - (Self-host alternative: host `updates.xml` + signed `.crx` built with
     `oathlight-extension-key.pem`, and point `CHROMIUM_UPDATE_URL` at it.)
2. **Edge Add-ons / Brave / Opera / Vivaldi**: all honor the Chromium
   force-list with the Web Store update URL (Edge also has its own store if you
   want a native listing).
3. **Firefox**: sign the XPI on AMO (or self-distribute a signed XPI), then set
   `FIREFOX_XPI_URL` to its download URL.
4. Flip nothing else — the monitor already calls `enforce_policy` for any
   `extension_missing` browser once the guard is on.
5. Re-test: load the extension, remove it while a browser is open, confirm the
   policy is written and it returns on relaunch.

---

## 5. Backend command / event surface

Tauri commands (`invoke`): `get_extension_stats`, `get_extension_blocklists`,
`get_browsers_status`, `set_guard_enabled`, `set_extension_theme`,
`set_blocking_settings`, `set_app_streak`, `enforce_extension`, `request_sync`,
`update_blocklist_domains`, `update_blocklist_keywords`.

Events (`listen`): `browsers-status` (per-browser array, every 3s),
`extension-stats`, `extension-blocklist`.

Messages pushed app→extension over the bridge: `request_sync`, `set_theme`,
`set_app_data` (streak + global blocks), `set_blocking` (the "Redirect link"
target + focus-schedule reminder config — cached as `ext_blocking` and re-sent
on each `host_hello`), `update_blocklist`. The extension acts on `set_blocking`
by redirecting blocked navigations to the configured URL and firing in-page
reminder pop-ups (a `chrome.alarms` loop, every 30 min, gated to the vulnerable-
hours window) via the content script.

---

## 6. Building

```
# native host (must exist for registration to find it)
cd desktop-app/native-host && cargo build --release

# desktop app
cd desktop-app && npm run tauri dev      # or: npm run tauri build
```

`resolve_host_binary()` finds the host next to the Tauri exe (production) or in
`native-host/target/{debug,release}` (dev).
