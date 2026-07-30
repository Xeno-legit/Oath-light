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
| Microsoft Edge Add-ons | **Required, not yet submitted** | The only way Edge can be force-installed — see below |
| Opera Add-ons | Optional, not submitted | Same Chromium zip if ever wanted |
| Safari | Ruled out | Cost/effort, and no `nativeMessaging` |

### Edge cannot be force-installed from the Chrome Web Store

This row used to read *"deliberately skipped — Edge users install from the Chrome
Web Store; force-install targets it too."* **The second half was false**, and it
is why the extension never appeared in Edge. Microsoft's own
[`ExtensionInstallForcelist` documentation](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/extensioninstallforcelist)
says it outright:

> For Windows instances not joined to a Microsoft Active Directory domain,
> forced installation is limited to apps and extensions listed in the Microsoft
> Edge Add-ons website.

Every Oath Light user is on an unjoined consumer PC, so Edge accepts our
forcelist entry as *policy* and then discards it. There is no error, no
`edge://extensions` entry, and nothing in any log the user can reach — verified
against Edge 150 with `--enable-logging --v=1`, where our ID never appears at
all while other force-installs in the same session fetch normally. No
combination of `ExtensionInstallSources`, `ExtensionInstallAllowlist` or
elevation changes this; the restriction is on the *store*, not on permissions.

Manual install from the Chrome Web Store still works in Edge (it prompts to
allow other stores), so Edge users are not locked out — they just cannot be
*locked in*, which for this app is the point.

#### The fallback that does work: auto-install, not force-install

The restriction is on **forced** installation only. Chromium's
external-extensions registry — a subkey named after the extension ID under
`HKCU\Software\Microsoft\Edge\Extensions` holding an `update_url` — is a
different mechanism, and Edge honours it for Chrome-Web-Store extensions on an
unmanaged machine. Verified end to end against Edge 150: it queries CWS with
`installedby=external`, downloads `OIGDPCDGMLDGJALFNLGEKCBKMNIPLNAD_3_5_0_0.crx`,
unpacks it, and registers Oath Light 3.5.0 in the profile. Third-party
installers (Acrobat, Grammarly) already use this path; it needs no admin.

It stops one step short of running. Chromium leaves an externally-registered
extension **disabled** until the user acknowledges the "new extension added"
prompt once — measured as `disable_reasons: 8192, location: 6`, **identical for
an unrelated control extension with no policy of ours anywhere near it**, so it
is the generic sideload protection and not something our configuration causes.
That acknowledgement lives in HMAC-signed `Secure Preferences`; it is a browser
security control and we do not forge it. The user can also remove the extension
afterwards and Chromium remembers that in `external_uninstalls`.

So Edge gets: automatic download, one click to enable, and no lock. Reported as
`needs_approval` → `auto_installed`, never as "locked". `enforce_external_install`
in `browsers.rs`. Publishing to Edge Add-ons remains the only way to make Edge a
real lock.

**To fix it: publish to Microsoft Edge Add-ons, then set
`EDGE_STORE_EXTENSION_ID` in `browsers.rs` to the item ID.** Nothing else needs
to change — `forcelist_target()` already prefers that ID and pairs it with
`EDGE_UPDATE_URL` (`https://edge.microsoft.com/extensionwebstorebase/v1/crx`).
Until then Edge reports `store_unavailable` and the UI offers a manual install
instead of claiming a lock it doesn't have. The store zip needs no changes;
Edge Add-ons takes the same Chromium package.

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

### Build them with the script

```
python scripts/build-extension-zips.py            # build, verify, print hashes
python scripts/build-extension-zips.py --check    # verify only, write nothing
```

Both zips are written only if both verify. There is nothing to sanity-check by
hand afterwards — the script re-opens each zip it just wrote and asserts the
things that have actually gone wrong before:

| Checked | Why it's checked |
| :-- | :-- |
| Every path uses `/` | **AMO requires forward slashes.** PowerShell's `Compress-Archive` writes backslashes and AMO rejects the upload with an unhelpful error. Never use it here. |
| `strings.js`, `voice-sync.js`, `background.js`, `manifest.json` present | The last hand-built zips predated `strings.js` and shipped without it. |
| No `tests/`, no `_metadata/` | `_metadata` is Chrome's generated ruleset index from loading unpacked — not source. |
| `service_worker` present in the Chrome manifest, absent in the Firefox one | The one real difference between the builds, and the easiest to put in the wrong file. |
| Every entry decompresses | Catches a truncated or corrupt write. |

### Reproducibility

The zips are byte-reproducible: fixed 1980-01-01 entry timestamps, fixed
permissions and `create_system`, sorted entry order, pinned deflate level, and
text files normalized to LF before packing. That last one matters because this
repo is developed on Windows with `core.autocrlf=true` — without normalizing,
the same commit would build differently here than on a Linux checkout.

Consequence: **the same commit always produces the same SHA-256, on any
machine.** `.github/workflows/reproducible-builds.yml` enforces it — it builds
twice on one runner and once each on Linux and Windows, and fails if any of the
four disagree. On a release it attaches `SHA256SUMS.txt` and both zips as
assets, so anyone can clone the tag, run the script, and confirm the zip they
built matches the one on the store listing without trusting us.

The Windows **installer** is not reproducible (NSIS embeds timestamps; the
cargo release profile is not bit-stable across runners). No hash claim is made
for it. The Rust toolchain is pinned in `ci.yml` regardless, so the compiler
is at least a tracked input.

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
4. `node scripts/ci/check-locales.mjs` — locale tables valid against the
   English base (placeholders intact, no orphan keys, both voices present)
5. `node desktop-app/scripts/check-renderer-transpile.mjs`
6. Command audit: `#[tauri::command]` count ⇔ `generate_handler!` count
7. **Audit README against reality** — every claim it makes must be true on this
   build. This is the step that stops doc drift returning.
8. Bump `manifest.json` `version`, then `python scripts/build-extension-zips.py`
   (§2). Record the printed SHA-256s in the release notes.
9. Update [../ROADMAP.md](../ROADMAP.md) — status changes land in the same PR

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
