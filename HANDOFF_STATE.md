# Handoff — Polishing pass (Polishing.md)

Written 2026-07-27. Branch `pre-alpha/release`.

This session worked through [`../Polishing.md`](../Polishing.md) — the owner's
review notes covering the extension, desktop app, features and website. Roughly
half is done. This file says what changed, what's left, and the two things that
need a real machine rather than more code.

---

## Read this first: two things that need a real machine

**1. The force-install fixes are untested.** They compile and pass clippy, but
they are Windows *registry behaviour* — nothing here can prove they work. Test:
install fresh, confirm the extension appears in **Edge** (it never did before)
and in **Chrome without restarting it**.

**2. The E: drive failed mid-session.** NTFS logged ~35 s of "failed to flush
data to the transaction log", the volume went `Scan Needed`, then it dropped off
the bus entirely and came back clean after a reboot. Nothing was permanently
lost (verified: `git fsck` clean, no zero-byte sources, all gates pass), but a
handful of edits were silently rolled back and had to be re-applied. **If
anything in this repo looks half-applied, that is the likely cause — check
against this file rather than assuming it was never written.** Back the repo up
off that drive.

---

## Done

### Contrast — the bug behind "text on white buttons is invisible"

Noir's dark accent **is** `#ffffff`, and every accent-filled surface hardcoded
`color:#fff` — primary buttons, avatar initials, chat bubbles, the popup's
protection pill. All white-on-white.

Fixed with a new `--ol-accent-ink` design token (dark → near-black, light →
near-white, serious → white), wired through all three stylesheets. Literal
`#fff` now survives **only** where the background is a fixed colour (danger red,
warn amber). If you add an accent-filled surface, take its foreground from
`var(--accent-ink)` — never a literal.

### Shell

* `BETA` → `ALPHA` in badge and banner. Classes renamed `beta-*` → `stage-*` so
  the markup stops lying at the next stage change.
* Sidebar flattened: no more Main/Support headings, AI Monitor gone as a
  top-level destination, and `SOS — I need help` → `I need help` (matches the
  tray item, the hotkey and the block page, which all already said that).

### Blocking Settings — rebuilt

* **Strict is now the floor.** The weaker "Standard" tier is gone; older
  `gentle`/`balanced`/`standard` values migrate **up** on load. Migrating
  upward is a strengthening, which this codebase always allows instantly — the
  reverse would need friction, which is exactly why it never runs that way.
* **New shared primitives** in `js/ui.jsx` — `InfoDot`, `Setting`, `SectionCard`.
  Rows are one line; anything longer goes in a hover/focus `InfoDot`. **Use
  these on the pages still to be rebuilt** rather than hand-rolling `.setting`
  markup — four pages each inventing their own spacing is how this got messy.
* **AI monitor moved here** from its own page, behind an explicit pre-enable
  consent panel. It is the one protection that reads the screen; that consent is
  collected once, in plain words, before it ever starts.
* **10 dead `store.blocking` fields removed** — written by the UI, read by
  nothing. Including two block-screen switches ("offline video", "background
  audio") that were never wired to any backend command or extension payload.

  > **Answering Polishing.md's "check if the other two options actually work":
  > they did not.** They were dead switches. Also note `sensitivity`, `lock`,
  > `safeSearch`, `blockApps`, `incognitoBlock` and `breakRequest` were all
  > equally dead — the real versions live where they're enforced (SafeSearch and
  > incognito/guest blocking are unconditional; app blocking is the backend's
  > `blocked_processes`).

* **Two "Coming soon" rows were lies.** Incognito blocking and Settings lock are
  both fully implemented in Rust. Incognito/guest blocking rides on the
  uninstall-guard toggle (`enforce_incognito_guest_policy`); the master password
  *is* the settings lock and lives in Settings. Both now shown truthfully.

### Force-install — three separate bugs (⚠ untested)

Symptom reported: *Chrome installed only after a restart; Edge never did.*

1. **Edge never installs.** Edge was treated as plain Chromium and got only
   `ExtensionInstallForcelist`. Edge does not trust the Chrome Web Store by
   default — it accepts the policy, then declines the install, silently. Now
   also writes `ExtensionInstallSources` and `ExtensionInstallAllowlist` into
   the same hive. Both are additive allow-rules and no-ops on Chrome.
2. **The restart requirement.** Chromium registers a registry change-watch on
   its policy key **at launch**. On a machine with no prior managed browser that
   key doesn't exist, so nothing is watched and the first write goes unseen
   until relaunch. `ensure_policy_key()` now pre-creates the empty key tree on
   app startup (called from `register_native_host`).
3. **HKCU permanently blocked the HKLM upgrade.** `enforce_policy` returned
   early on *any* existing policy, so a profile that once took the weak HKCU
   fallback could never be upgraded to the machine-wide lock — no matter how
   often admin was granted. It now short-circuits only on `EnforcedMachine`.

### AI mentor — no longer Anthropic-only

Answering *"why is the Api key just for anthropic???"*: it was hardwired from
the settings field name down to the request builder.

* `mentor::PROVIDERS` now offers **Anthropic, OpenAI, Google, OpenRouter, Groq,
  Mistral, and Custom/local**. Two wire formats cover all of them
  (`Wire::Anthropic`, `Wire::OpenAi`); Custom takes a user-supplied base URL and
  needs no key, so a local Ollama/LM Studio/vLLM sends nothing off the machine.
* **All four safety layers are provider-independent** and must stay that way.
  Layer 1 (no tools) is structural, layer 2 (`weakening_intent`) runs before any
  network call, layer 3 (`guard_reply`) runs on returned text whatever produced
  it, layer 4 is the prompt. A test (`layer_two_short_circuits_for_every_provider`)
  asserts every provider still refuses locally — **keep it passing when adding a
  provider.**
* Switching provider clears the stored model, since a model name from one
  provider is meaningless to another.
* Settings exposes a picker built from the Rust catalog, so the UI can't offer a
  provider the request path can't talk to.

### Recovery Program page

* Description cut from a paragraph to one line.
* **The contradictory warning is fixed.** It announced "No AI, no persona, no
  chatbot" as a property of the *page* — with an AI mentor sitting directly
  underneath it. The promise is real but narrower than it was stated: it's about
  the *exercises*, not the page. Now says exactly that, and survives having the
  mentor below it.

---

## Left to do

In Polishing.md order. Nothing below has been started.

| # | Task | Notes |
|---|---|---|
| 1 | **Tips & Questions** UI rebuild | Use the new `SectionCard`/`Setting`/`InfoDot` primitives |
| 2 | **Themes** UI rebuild | Also **strip the 6 dead palette variants** — `aurora`/`lagoon`/`dawn`/`midnight`/`forest`/`ember` are still in all three stylesheets but Noir is the only built-in theme (owner decision 2026-07-19) and `index.html` pins `data-style="noir"`. That's ~90 dead lines × 3 files. Custom colours are runtime `--ol-*` token overrides, already wired in `app.jsx` |
| 3 | **Settings** UI rebuild | Info icons; **rename "Drill Sergeant"** (owner: *"seems like something a child would name it"*) — it's the `serious` voice in `strings.js`/`VOICE.md`, so rename the *label*, not the `voice: 'serious'` id; **verify notifications actually work**; audit remaining "not built yet" rows the way the Blocking ones were audited — at least two were already built |
| 4 | **System DNS** | *"resolver started but isn't answering on 127.0.0.1:53"*. Not investigated at all. Start at `desktop-app/dns/` and `dns_filter.rs`'s health-check/failsafe path |
| 5 | **Extension code review** | Broken code + over-complicated structures. Not started |
| 6 | **Website** | Remove the display font — **one unified font** (owner explicitly wants the "fancy font" gone from the design system); match the design system. `tokens.css` still ships `--ol-font-display: 'Instrument Serif'` and the repo carries its woff2 subsets. Note: removing it is a design-system change, so re-run the sync gate |

Also still open from ROADMAP's "Before Alpha": Arabic review, OTA production
keys, and the pre-Alpha full-scale test.

---

## Working in this repo

**Gates — run all four before committing:**

```sh
node desktop-app/scripts/check-renderer-transpile.mjs   # renderer has no build step
node scripts/ci/check-design-system-sync.mjs            # byte-identical surface copies
node scripts/ci/check-locales.mjs
cargo test --manifest-path desktop-app/Cargo.toml --workspace
cargo clippy --manifest-path desktop-app/Cargo.toml --workspace -- -D warnings
```

**Design-system edits** must be made in `design-system/` and copied to all three
surfaces, or the sync gate fails. `tokens.css` → renderer + both extension asset
dirs; `strings.js` → renderer + extension.

**Two build traps on Windows:**

* `cargo` fails with `PermissionDenied` in `tauri-build` when
  `target/debug/oath-light-host.exe` is locked. It is the **native messaging
  host** — a running browser respawns it the instant you kill it, so
  `npm run free-sidecars` loses the race. Fix: **rename** the running exe
  (allowed on Windows, unlike deleting) and re-run.
* Source files are **CRLF**. A patch script matching on `\n` silently finds
  nothing.

**If you script an edit, write atomically** — temp file, fsync, `os.replace`.
Opening a source file with mode `"w"` truncates it *before* the write can fail,
which is how `lib.rs` briefly became 0 bytes this session.
