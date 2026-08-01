# Oath Light
What's left

▶ The only list of unfinished work. If it isn't here, it's either done or we're not doing it.
Updated 2026-07-31. Phase 4, branch `pre-alpha/release`.

Almost everything that can be finished by writing code is finished. What's left
mostly needs something else — the real sites open, a GPU, someone writing
content, or the owner's own keys. Two code exceptions are called out where they
sit: the installer half of reproducible builds, and the string extraction behind
translations.

## Before Alpha

▶ Small stuff that's in the way of everything else.

* Commit the working tree.
* Get the Arabic draft read by a fluent speaker, then flip `reviewed: true`
  in `design-system/locales/ar.js`. Until then the picker calls it a draft.
* ~~Swap the OTA dev keys for production keys.~~ **Done 2026-08-01** — the
  production pair is baked and verified byte-identical in `core/src/ota.rs` and
  `extension/bg/ota.js`; `dev-keys.env` is gone; the release base matches the
  real remote (`Xeno-legit/Oath-light`). **What's left is not a code change:**
  confirm the active private seed is set as the `OTA_SIGNING_KEY` repository
  secret and that the spare is stored offline. Public keys are already in the
  repo by design — there is nothing key-shaped left to upload. Verify a held
  seed with `OTA_SIGNING_KEY=… node scripts/ota/check-seed.mjs` (prints a
  verdict, never the seed). (owner only — [docs/OTA_KEYS.md](docs/OTA_KEYS.md))
* Smoke-test the Firefox force-install against a real admin Firefox.
* **Verify the Edge browser lock on a real machine** — `browser_lock.rs` kills
  Edge on sight while the extension isn't running in it, and the only way back
  is a 20-second grace window requested from the app. This is not a stopgap
  waiting on an Edge Add-ons listing; it is *the* enforcement mechanism on Edge,
  permanently (see "Not doing"). Verify the loop end to end: Edge dies, the app
  offers the window, the window opens Edge at the install page, the install
  completes inside 20s, and Edge stops dying. Then check the failure path — let
  a window lapse and confirm the kill resumes and a second window costs a second
  trip to the app. **Keep the 20s as is.**
* ~~Verify the uninstall/upgrade gate on a real install.~~ **Done 2026-07-31** —
  exercised end to end on a real install at a temporary 10s timer, then all
  three friction constants restored to 24h in one commit.
* Test the AI overlay's "this was wrong" button on a live detection. (overlay
  only — it reports a *screen-monitor* false positive and re-derives the dwell.
  The extension's blocked page has no equivalent and isn't getting one.)
* Test grayscale hours on a real machine.
* See the desktop reminder card actually render (5.0). The window math is
  unit-tested and it compiles, but no one has watched one appear — set
  vulnerable hours to cover now and wait a minute.
* Pre-Alpha launch test — everything, full scale.

▶ The machine-bound items above are one sitting, written out station by station
in [docs/ALPHA_VERIFICATION.md](docs/ALPHA_VERIFICATION.md) — ordered to fail
fastest, with pass/fail lines and a results table.

## Needs the sites actually open

▶ Written blind these would look right and quietly do nothing. Do them in a session where the pages can be loaded and checked.

* ~~Twitch, Kick.~~ **Done 2026-08-01** — both label their own streams and serve
  those labels as ordinary JSON, so the existing per-item stripper covers them.
  Twitch: `contentClassificationLabels[].id`, matching **only** `SexualThemes` —
  a live 30-stream pull carried `MatureGame` ("Mature-rated game" — Rust,
  Rainbow Six), `DebatedSocialIssuesAndPolitics` and `ProfanityVulgarity`, and
  stripping those would gut ordinary gaming Twitch for no NSFW gain. Kick:
  `is_mature`, its only signal, so gambling streams go with it. A labelled
  channel opened directly can't be stripped (the flag isn't in an array), so it
  hard-blocks the tab instead — off the same label, no DOM selectors. Both are
  also wired into the keyword search filter (Twitch `?term=`, Kick's web route
  `?query=`) as the backstop for the unlabelled tail, and Twitch's "Pools, Hot
  Tubs, and Beaches" category is blocked as a whole surface, since the streams
  in it are understood by category rather than labelled. Covered by
  `tests/test-graylist-inject.cjs` and `test-path-keywords.cjs` against
  live-captured fixtures. Residual: Kick doesn't flag per-channel VODs or clips
  at all (Twitch labels all three types), mitigated by the channel-page block.
* ~~Instagram, TikTok, YouTube Shorts.~~ **Done 2026-08-01.** Confirmed by
  capture, not assumption: a live TikTok feed item carries 38 fields and not one
  maturity flag, so there is nothing to strip on either platform. They join the
  **enforce** tier instead — explicit hashtag and search surfaces blocked, feeds,
  profiles and DMs untouched. Instagram needed two routes, both verified live and
  neither guessable: `/explore/tags/<t>/` now 302s to `/popular/<t>/`, and search
  is `/explore/search/keyword/?q=`. Shorts rides the forced Restricted Mode
  already in place — no new code, and the comments trade-off is unchanged.
  * Residual, and it is not closable by label reading: an **unlabelled** video in
    a feed. That is on-screen-AI work, tracked under "Needs a GPU".
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

## Needs someone who didn't write it

* **A proper red team.** Someone who did not write this code sitting down and
  genuinely trying to get past it, then writing down what worked. Read
  [docs/HARDENING.md](docs/HARDENING.md) first so the attack lands on the real
  thing rather than the version you assume exists; report holes in
  [BYPASSES.md](BYPASSES.md). The priority target is an administrator account —
  that is the known-weakest surface, stated plainly in SECURITY.md rather than
  papered over. Not gating alpha, but it should happen before this is
  recommended to anyone who is depending on it.

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

* **Publishing to Microsoft Edge Add-ons.** (owner's call, 2026-07-31) The
  listing's verification requirements aren't worth it for a store that won't
  meaningfully distribute the extension anyway. The consequence is deliberate
  and permanent, not a gap: Microsoft only force-installs from its own store on
  a PC that isn't domain-joined, so Edge can never be force-installed here.
  `EDGE_STORE_EXTENSION_ID` stays empty, Edge stays `StoreUnavailable`, and the
  browser lock is what enforces Edge instead. The machinery for the other
  outcome is left intact and costs nothing — an item ID in `browsers.rs` is the
  only change needed if this is ever revisited.
* **The 90-day recovery course.** (owner's call, 2026-07-31) The flow runner
  that would play it stays; there is no 90-day content coming.
* Safari. (no native messaging, so the desktop bridge can't exist)
* A phone version of the browser extension. (phones get the AI scanner instead)
* Score-based blocking in the filter. (unpredictable, undebuggable)
* A scraped multi-million domain list. (that's how Phase 1 broke)
* More built-in themes.
* Cash bounties.

Opera is the only store left worth doing, and only if someone asks. Same zip as Chrome.
