# Oath Light — Release & Store Guide

> Everything needed to ship: where it's published, how the zips are built, the
> gotchas that have burned us, and the copy-paste answers the stores ask for.
>
> Key handling for signed list updates is in [OTA_KEYS.md](OTA_KEYS.md).

---

## 1. Where it's published

| Store | State | ID / link |
| :-- | :-- | :-- |
| Chrome Web Store | **Live** (submitted 2026-07-19, approved 2026-07-22) | `oigdpcdgmldgjalfnlgekcbkmniplnad` — [listing](https://chromewebstore.google.com/detail/oigdpcdgmldgjalfnlgekcbkmniplnad) |
| Firefox AMO | **Live** | [oath-light-content-filter](https://addons.mozilla.org/en-GB/firefox/addon/oath-light-content-filter/) |
| Microsoft Edge Add-ons | **Deliberately skipped** | Edge users install from the Chrome Web Store; force-install targets it too |
| Opera Add-ons | Optional, not submitted | Same Chromium zip if ever wanted |
| Safari | Ruled out | Cost/effort, and no `nativeMessaging` |

### The extension-ID trap (cost us a broken release once)

**The Chrome Web Store ignores the manifest `key` and assigns its own item ID.**
The desktop app originally only knew the unpacked/dev ID derived from that key
(`lknpaoec…`), so every store install broke the native-messaging bridge, profile
detection and force-install at once.

The store ID `oigdpcd…` is now hardcoded as `STORE_EXTENSION_ID` in
`browsers.rs` and consumed by `profiles.rs` and `lib.rs`. **If the listing is
ever recreated, that constant changes** — and force-install, the bridge and the
"is the extension installed?" check all break together.

Force-install targets the CWS update URL
`https://clients2.google.com/service/update2/crx`, which — unlike a self-hosted
URL — is honoured on unmanaged consumer machines. Firefox force-installs from
AMO via the `ExtensionSettings` policy: **one `REG_MULTI_SZ` value holding the
whole JSON**, merged collision-safe — not per-key subkeys. Both paths need
elevation (`request_elevated_setup` / `--elevated-setup`).

The old self-hosted update server (port 17244) and `scripts/pack-extension.mjs`
CRX packing were **deleted**. Don't go looking for them.

---

## 2. Building the store zips

Two zips from the one `extension/` tree:

| Zip | Target | Difference |
| :-- | :-- | :-- |
| `oathlight-extension-store.zip` | Chrome / Chromium (also Edge, Brave, Opera) | The manifest as committed |
| `oathlight-extension-firefox.zip` | Firefox AMO | Manifest with `background.service_worker` removed (Gecko uses `background.scripts`) |

### The AMO path gotcha

**AMO requires forward-slash paths inside the zip.** PowerShell's
`Compress-Archive` writes backslashes and AMO rejects the result with an
unhelpful error. Build with Python's `zipfile` or 7-Zip:

```python
# from the repo root
import zipfile, pathlib, json
src = pathlib.Path("extension")
skip = {"tests", "_metadata", "__pycache__"}

def pack(out, manifest_text):
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(src.rglob("*")):
            if p.is_dir() or any(part in skip for part in p.parts):
                continue
            arc = p.relative_to(src).as_posix()          # forward slashes
            z.writestr(arc, manifest_text) if arc == "manifest.json" else z.write(p, arc)

chrome = (src / "manifest.json").read_text(encoding="utf-8")
m = json.loads(chrome)
m["background"].pop("service_worker", None)             # Firefox build
pack("oathlight-extension-store.zip", chrome)
pack("oathlight-extension-firefox.zip", json.dumps(m, indent=2))
```

Sanity-check before uploading: `unzip -l` (or `7z l`) and confirm every path
uses `/`, `strings.js` and `voice-sync.js` are present, and `tests/` is not.

### Firefox-specific manifest notes

- `browser_specific_settings.gecko.data_collection_permissions` is
  `{ required: ["none"] }`. **If the extension ever starts transmitting user
  data, this must be updated** — it is a signed statement to Mozilla.
- "Do you need to submit source code?" → **No.** There is no build tooling; the
  shipped JS is the source.
- Name the third-party libraries with versions in the reviewer notes:
  `gsap.min.js` and `bg/noble-ed25519.js`.

---

## 3. Pre-release checklist

1. `cargo test --workspace` · `cargo clippy --workspace -- -D warnings`
2. `node extension/tests/run-all.cjs`
3. `node scripts/ci/check-design-system-sync.mjs` — every copy byte-identical
4. `node desktop-app/scripts/check-renderer-transpile.mjs`
5. Command audit: `#[tauri::command]` count ⇔ `generate_handler!` count
6. **Audit README against reality** — every claim it makes must be true on this
   build. This is the step that stops doc drift returning.
7. Bump `manifest.json` `version`, rebuild **both** zips (§2)
8. Update [../ROADMAP.md](../ROADMAP.md) — status changes land in the same PR

**Build gotcha:** if `cargo` fails with `tauri-build … lib.rs:80
PermissionDenied`, that line is `fs::remove_file` on a *staged sidecar* in
`target/debug/`. A stale `oathlightguard.exe` or `oath-light-host.exe` left
there by a killed build wedges every subsequent build. Delete those two files —
it is not a code problem.

---

## 4. Publishing a blocklist update (OTA)

`.github/workflows/release-lists.yml` runs on a published Release: validates the
list shape, builds and signs `lists-manifest.json`, and attaches the manifest,
its `.sig` and the list files. Clients fetch from
`releases/latest/download/<asset>`.

`version` must be a **monotonically increasing integer** — clients reject any
manifest whose version is `<=` what they already have.

Clients enforce three things independent of the signature: version
monotonicity, the whitelist floor (reject the entire update if any domain would
block an allowlisted one), and never deleting the bundled lists. A bad list can
degrade freshness; it can never brick browsing.

---

## 5. Chrome Web Store — privacy practices answers

Copy-paste for the dashboard's "Privacy practices" tab.

### Single purpose

> Oath Light is a content filter that blocks pornographic and other NSFW
> material. It blocks requests to known adult domains, detects adult keywords in
> hostnames, enforces SafeSearch on search engines, and hides items that
> platforms themselves label NSFW (e.g. Reddit, X, Pixiv). All filtering is
> deterministic and performed locally on the device; no browsing data is
> collected or transmitted.

### Permission justifications

| Permission | Justification |
| :-- | :-- |
| `alarms` | Schedules periodic local tasks: checking for signed blocklist data updates and triggering optional local focus/reminder notifications. No data leaves the device. |
| `cookies` | Sets content-safety preference cookies on supported platforms (e.g. Reddit's "over 18" preference to off) so the sites themselves hide adult content. Cookies are not read, collected or transmitted for any other purpose. |
| `declarativeNetRequest` | Core blocking mechanism. Static rulesets enforce SafeSearch and optionally YouTube Restricted Mode by redirecting/modifying requests locally — the standard privacy-preserving MV3 way to filter without reading page traffic. |
| `<all_urls>` | Adult content can appear on any domain, so the filter must evaluate the hostname of every navigation against a local 385,000+ domain blocklist and keyword engine, and its content script must run on all pages to hide platform-labeled NSFW items. Matching is hostname-based and entirely local; page content is never collected or transmitted. |
| `nativeMessaging` | Communicates with the optional Oath Light desktop companion app (installed by the user) for tamper resistance — verifying the filter is running and preventing trivial circumvention. Messages are local status/heartbeat data between the extension and the companion on the same machine; nothing is sent to remote servers. |
| `storage` | Stores the user's settings (filter options, graylist platform toggles, accountability settings) and cached blocklist data locally. |
| `tabs` | Redirects a tab to the local block page when it navigates to a blocked site, and closes/updates tabs that hit blocked content. Tab URLs are checked locally and never recorded or transmitted. |
| `unlimitedStorage` | The bundled and updated domain blocklists (385,000+ entries across multiple JSON shards) exceed the default quota. |
| `webNavigation` | Observes navigation events before commit so blocked hostnames are intercepted and redirected before the page loads, including in frames. Only the hostname is evaluated, locally. |

### Remote code

> The extension does not execute remotely hosted code. All JavaScript is
> packaged in the extension. Over-the-air updates deliver only cryptographically
> signed **data** (JSON domain blocklists), verified with a pinned Ed25519 public
> key before use and never executed as code.

### Data-usage checkboxes

Does **not** collect or transmit user data; all processing is local. Certify:
does not sell data, does not use data for unrelated purposes, does not use data
for creditworthiness or lending.
