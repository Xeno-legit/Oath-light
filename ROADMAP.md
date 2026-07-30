# Oath Light
What's left

▶ The only list of unfinished work. If it isn't here, it's either done or we're not doing it.
Updated 2026-07-27. Phase 4, branch `pre-alpha/release`.

Almost everything that can be finished by writing code is finished. What's left
mostly needs something else — the real sites open, a GPU, someone writing
content, or the owner's own keys. Three code exceptions are called out where
they sit: the installer half of reproducible builds, the string extraction
behind translations, and the 90-day course.

## Before Alpha

▶ Small stuff that's in the way of everything else.

* Commit the working tree.
* Get the Arabic draft read by a fluent speaker, then flip `reviewed: true`
  in `design-system/locales/ar.js`. Until then the picker calls it a draft.
* Swap the OTA dev keys for production keys. (owner only — [docs/OTA_KEYS.md](docs/OTA_KEYS.md))
* **Publish to Microsoft Edge Add-ons, then set `EDGE_STORE_EXTENSION_ID` in
  `browsers.rs`.** This is the *only* way Edge can be force-**installed**:
  Microsoft limits forced installation to its own store on any PC that isn't
  domain-joined, so the Chrome Web Store entry we write is accepted as policy and
  silently discarded. Until then Edge falls back to auto-install via the
  external-extensions registry — the extension downloads itself and needs one
  click to enable, which works but is not a lock. Owner-only (needs the Partner
  Center account); the code is already wired for both.
  Details in [docs/RELEASE.md](docs/RELEASE.md#1-where-its-published).
* Smoke-test the Firefox force-install against a real admin Firefox.
* Test the overlay's "this was wrong" button on a live detection.
* Test grayscale hours on a real machine.
* Pre-Alpha launch test — everything, full scale.

## Needs the sites actually open

▶ Written blind these would look right and quietly do nothing. Do them in a session where the pages can be loaded and checked.

* Instagram, TikTok, YouTube Shorts, Twitch, Kick.
  * YouTube and Twitch have real labels — strip per item.
  * Instagram and TikTok don't — hide the feed, keep search and DMs.
* Telegram Web, WhatsApp link previews, Discord embed media.
  * Discord media should wait for image scoring below.

## Needs a GPU

▶ Bench runs, not typing.

* Quantize the model. (INT8/FP16 — accept the smallest within 0.5pt of FP32, FP16 is the safe fallback)
* DirectML/NPU support with CPU fallback.
* Faster scanning when a fullscreen video is in front.
* Build a real eval set — 200-400 images. (today's numbers come from 30, which is not enough to quote)
* In-page image scoring in the extension. (batch 6 thumbs per message max — native messaging caps at 1MB)
* Text classification on unknown sites. (gate it behind Strict — a wrong call here blocks a whole page)
* Strictness knob for the AI + a warn tier. (the covered/bikini score is already calculated, just not exposed)
* Route detections by which window is in front, and only scan when the front app warrants it.

## Needs writing

▶ Content is the work here, not code. Ship 5 good ones over 30 thin ones.

* The AI mentor is **done** — `desktop-app/src-tauri/src/mentor.rs`, off by
  default, the user's own Anthropic key, kept separate from the scripted
  exercises so their "nothing leaves this device" promise still holds. The
  "never negotiates about disabling protections" rule is enforced in four
  layers, only one of which is the prompt: no tools at all (it has no route to
  any protection command), a Rust pre-filter that answers weakening requests
  before the network, and an output guard that runs every reply through the
  real blocklist + keyword engine. Seven tests cover the three code layers.

* 90-day recovery course. (one JSON per day, the existing flow runner already plays it)
* Translations — the remaining work is **extraction**, not the layer.
  * The layer is done: `strings.js` resolves key → locale → voice, locales
    register from `design-system/locales/<code>.js`, direction comes off the
    locale (never set by hand), and `scripts/ci/check-locales.mjs` fails the
    build on a translated `{placeholder}`. RTL is wired end to end — logical
    properties throughout, `dir`/`lang` on `<html>`, picker in Settings.
  * Arabic ships as an **unreviewed draft** (`reviewed: false`, all 94 keys).
    A fluent speaker needs to read it in context before that flips — the
    Companion/Coach split does not survive literal translation.
  * What's left: only ~94 keys exist, and most UI copy is still hardcoded
    English in the JSX. Extracting it is mechanical (`data-ol-str` on the
    extension pages, `PP.t()` in the renderer) but it is the bulk of the job.
    Adding es/pt/hi/id is a file each once that's done.

## Needs CI

* Reproducible installer builds. NSIS embeds a timestamp and a compiler
  fingerprint, and the cargo release profile isn't bit-stable across runners.
  No hash claim is made for the installer until this is solved.
  * The zip half is **done** — `scripts/build-extension-zips.py` is
    byte-reproducible and `.github/workflows/reproducible-builds.yml` proves
    it twice on one runner and across Linux and Windows, then publishes the
    hashes. Rust is pinned to 1.96.0 in `ci.yml`.

## Later

▶ Phase 5 and beyond. Not started, and shouldn't be yet.

* Finish the UI rebuild — Blocking, Blocklist and Monitor are still the old ones.
* Android. (VPN DNS filter + accessibility capture — needs the quantized model first)
* iOS. (Safari rules + DNS profile is the realistic ceiling)
* Cross-device streak sync, end-to-end encrypted.
* Per-connection filtering. (prototype with WinDivert first — do NOT write a signed kernel driver)
* Move profile data behind SettingsV1. (the streak already moved)

## Not doing

▶ So it stops getting re-suggested.

* Safari. (no native messaging, so the desktop bridge can't exist)
* A phone version of the browser extension. (phones get the AI scanner instead)
* Score-based blocking in the filter. (unpredictable, undebuggable)
* A scraped multi-million domain list. (that's how Phase 1 broke)
* More built-in themes.
* Cash bounties.

Opera is the only store left worth doing, and only if someone asks. Same zip as Chrome.
