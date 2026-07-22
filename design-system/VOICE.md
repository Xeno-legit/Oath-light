# Oath Light — Voice System

Source of truth for the string/voice layer (`strings.js`) in this directory. Read
`Oath_Light_UX_Direction.md` (repo root) §1–3 first — this doc is the working
reference for anyone writing or reviewing copy day to day.

## The two voices

Tone is a **user-selectable voice**, chosen once at onboarding, not tied to
gender or any demographic. Every string in the app has both versions. Serious
Mode overrides the choice while it's on (see below) — it does not delete it.

### Companion

Warm, steady, plain language. Never saccharine. Second person. This is
essentially the current app's voice, cleaned up: it already trends this way,
so most `companion` entries are the real existing copy with the explanatory/
map-revealing bits removed (see Hard Content Rules below).

### Serious ("Drill Sergeant")

Short, imperative, commanding. Direct address. No cushioning, no
exclamation-point cheerleading, no insults. This is **not** a meaner version
of Companion — it's a different register entirely: the voice of a hard coach
who is completely on the user's side. It is never abusive, never shaming,
never hopeless.

On slips/relapses it stays hard but forward-pointing. "Log it. Get up. Back
in the fight." is the model. "You failed again," "pathetic," "you always do
this" — anything that reads as contempt or hopelessness — is **banned**, in
both voices, permanently.

### Example pairs

| Moment | Companion | Serious |
|---|---|---|
| Overview hero, mid-streak | "You're on a {days}-day streak. Every clear choice is a vote for the person you're becoming." | "{days} days in. Hold the line. That is the whole job today." |
| Just slipped | "A slip is not a collapse — it's a single moment, not your identity." | "A slip is one moment, not a verdict. Log it straight, no spin." |
| Post-slip, gentle-mode hero | "Be gentle / with yourself today" | "Get up. / Back in the fight. Today." |
| Blocked-page headline | "Take a deep breath" | "Stand down." |
| Panic flow exit | "Well done. Truly." | "You held. Good." |

Notice the panic-flow row: it's warm in Companion and firm-but-still-warm in
Serious — not harsh. See the Panic exception below.

## Key-naming conventions

- Flat, dot-namespaced keys: `namespace.key_name`, all lowercase, `snake_case`
  after the dot. No nesting beyond one dot.
- Namespace = the product surface/moment, not the literal file it lives in
  today (`blocked.*`, `popup.*`, `status.*`, `friction.*`, `lockdown.*`,
  `panic.*`, `streak.*`, `notify.*`, `serious.*`, `onboarding.*`, `app.*`).
- Suffix conventions used throughout: `_title` / `_headline` (the big line),
  `_sub` / `_body` (the supporting line), `_label` (a short UI chip/pill),
  `_button` / `_cta` (button text), `_subject` / `_body` for notify emails.
- A handful of keys are load-bearing for `preview.html` (built by a sibling
  agent) and for this contract in general — **do not rename**:
  `blocked.headline`, `blocked.body`, `blocked.cta_leave`, `status.protected`,
  `status.ext_missing`, `friction.pending_label`, `friction.keep`.

## Interpolation format

`{token}` placeholders, replaced from the `params` object passed to `t()`:

```js
OL_STRINGS.t('app.streak_line', { days: 42 });
// -> "Day 42" (companion) or "Day 42. Keep going." (serious)
```

A missing param leaves the literal `{token}` in the output rather than
silently dropping it — a broken call is visible immediately in the UI instead
of producing a corrupted sentence.

## Hard content rules (enforced in every string, both voices)

Straight from UX Direction §3 — **status yes, map no**:

- Never explain *where* protection is thin, *what* a setting defends
  against, enumerate bypass surface, or describe architectural/mechanism
  detail. In-app copy is honest and actionable, never a map.
- Status strings are actionable ("Extension missing — fix"), never
  explanatory ("Extension missing because the browser reset your profile
  and policy enforcement requires a managed device").
- The full threat model (what each layer covers, known limitations, bypass
  surface) belongs in a developer-facing `SECURITY.md`/architecture doc on
  GitHub — never inside app UI strings.

### What got rewritten out of the seed copy to comply

The real current copy (`blocked.js`, `extension`/`desktop-app`) mostly holds
this line already, but a few things did not make it into the catalog, or were
rewritten, specifically because they violate it:

- **The granular block-reason map** (`blocked.js`'s `reasonMap`: `domain`,
  `keyword_domain`, `keyword_path`, `keyword_context`, `search_query`,
  `search_images`, `keyword_content`, `blacklist_domain`, `explicit_domain`,
  `graylist_explicit`, `safesearch_bypass`, etc.) was **not** carried into
  `strings.js`. Enumerating exactly which detection layer fired, on which
  pattern, is a literal bypass map handed to the person it's meant to stop.
  The catalog only has one generic `blocked.headline` / `blocked.body` pair
  for "this page is blocked" — no reason taxonomy.
- **The lockdown blocked-page footnote** ("...If a site you genuinely need
  is blocked, you can add it from Oath Light (it takes effect after a short
  pause)") was cut down to `blocked.reason_lockdown`, a flat status line.
  The original told the user, on the wall itself, exactly how to route
  around it and roughly how long that takes — a workaround map, even though
  it's phrased kindly.
- **Enforcement-detail status notes** from `pages-overview.jsx`'s
  `enforcementNote()` (`"can't lock — needs the Web Store or a managed
  device"`, `"needs admin to lock"`, `"policy set — waiting for the browser
  to install it"`) were deliberately **not** seeded into `status.*`. These
  explain exactly why/how the tamper-lock can be defeated on a given
  machine — real bypass-surface detail, not a status. `status.*` here stays
  to flat, actionable states (`protected`, `ext_missing`, `ext_partial`,
  `connecting`, `not_installed`) with no mechanism attached.

If new copy is added later, run it through this checklist before it ships:
*does this string tell the user anything about how, where, or why the
protection could fail or be gotten around?* If yes, cut it down to the bare
status and move the explanation to the developer-facing doc instead.

### Panic exception

`panic.*` is the one place both voices stay soft: supportive and
de-escalating in both Companion and Serious. Serious gets **firmer**, not
harsher, there — shorter sentences, same warmth, no drill-sergeant edge. A
person mid-panic is not the moment for a hard voice to prove a point.

## Serious Mode vs. voice choice

Serious Mode (UX Direction §1) is a separate toggle from the onboarding
voice choice, and it wins:

- `activeVoice` is the user's onboarding pick (`'companion'` or `'serious'`)
  and can be changed any time Serious Mode is off.
- `seriousMode` is the global override. While `true`, `t()` **always**
  returns the `serious` string for every key, regardless of `activeVoice` —
  a Companion-voice user who turns on Serious Mode gets the hard voice
  everywhere, no per-string exceptions.
- Turning Serious Mode ON is instant. Turning it OFF is friction-gated (a
  24–48h pending change during which the mode stays fully active) — see
  `serious.disable_request_warning` / `serious.disable_pending`. Both are
  string-only concerns here; the actual gating lives in the friction system
  (`friction.rs`).
- Nothing about `activeVoice` is lost when Serious Mode is on — it's just
  not consulted. Turning Serious Mode off later restores whatever voice was
  chosen before, unchanged.

## How each surface consumes `strings.js`

The file is a plain script with zero build step and zero dependencies. It
assigns one global, `OL_STRINGS`, via `globalThis`, so it loads identically
everywhere:

- **MV3 extension service worker** (`background.js` or similar):
  ```js
  importScripts('../design-system/strings.js');
  // OL_STRINGS is now available; no DOM, no chrome.* was touched to get it.
  ```
- **Extension pages** (`popup.html`, `blocked.html`, options page):
  ```html
  <script src="../design-system/strings.js"></script>
  <script src="popup.js"></script> <!-- popup.js can now call OL_STRINGS.t(...) -->
  ```
- **Tauri desktop renderer** (`index.html`, matching the existing plain
  `<script src>` pattern already used for `store.js`, `shell.jsx`, etc. —
  no bundler):
  ```html
  <script src="../../design-system/strings.js"></script>
  <script type="text/babel" data-presets="react" src="js/shell.jsx"></script>
  ```
- **Static website**: same as an extension page — one `<script src>` tag
  before any script that calls `OL_STRINGS.t(...)`.

In every case, the caller owns:
- **Persistence** — reading the saved voice choice (`chrome.storage`,
  Tauri's store, localStorage, cookies — whatever fits the surface) and
  calling `OL_STRINGS.setVoice(...)` / `OL_STRINGS.setSeriousMode(...)` once
  on startup. `strings.js` itself never touches storage.
- **Re-render** — calling `t()` again (or re-rendering) after `setVoice`/
  `setSeriousMode` changes; the module has no reactivity/observer system,
  it is pure in-memory state plus a lookup function.

Typical boot sequence on any surface:

```js
OL_STRINGS.setVoice(loadSavedVoice());       // e.g. 'serious'
OL_STRINGS.setSeriousMode(loadSeriousMode()); // e.g. false
renderHeadline(OL_STRINGS.t('blocked.headline'));
```
