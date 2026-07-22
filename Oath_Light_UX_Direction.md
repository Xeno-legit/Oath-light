# Oath Light — UX Direction & Serious Mode Plan

Recorded 2026-07-18, from the owner's UI/UX review. This document is the source of
truth for the product's voice, the serious-mode feature, and the design-system work.
It supersedes any softer framing in older planning docs where they conflict.

## Positioning

Oath Light is an **anti-addiction tool**, not a casual blocker with extras. The core
user is someone who seriously wants to end their addiction — the person who installs
it furious and wants it over entirely. Every UX decision is made for that user.

The corollary: the furious person who installs it and the cooled-off person three
weeks later are the same person. The app's job is to make commitments made in the
strong moment binding in the weak moment — "past-you outranks present-you." That is
what the friction architecture already does; the UX must match it.

## Review verdict

Overall experience: okay, not what was targeted. Specific problems:

1. **Tone is too soft across everything.** A harder register must exist.
2. **The app advertises its own weak spots.** Explaining where protection is thin
   inside the app is "showing a child where the poison is."
3. **Exercises are generic.** Acceptable but not useful.
4. **The UI looks old and is not uniform or organized.**
5. **Massive design gap between the website and the app** — no strict, uniform
   design system exists.

## Decisions

### 1. Serious mode

A single toggle that flips the app's entire behavior and personality to the
strictest configuration. **It covers everything — no per-feature exceptions** —
otherwise users negotiate with it piecemeal.

When ON:

- Strictest settings across the board: graylist, keyword engine, forced SafeSearch,
  lockdown escalation on.
- **A serious tone across everything** — every string, every screen, every
  notification switches to the hard voice ("be gentle with yourself" → "Get Up").
  Not just a banner; the whole app's register changes.
- Reduced-detail UI: no weak-spot information visible anywhere (see §3).

Toggle mechanics:

- **ON is one click, instant.**
- **OFF is not easy.** Disabling files a pending change through the generalized
  friction system (`friction.rs`, same pattern that gates `lockdown.cancel`):
  a 24–48h delay during which the mode stays *fully* active, and a trusted-contact
  notification fires if one is configured. Reuse the existing
  `set_lockdown_escalation` ON-instant / OFF-friction-gated pattern.

### 2. Voice system (tone)

Tone is a **user-selectable voice chosen at onboarding** (e.g. Companion vs. Drill
Sergeant) — not tied to gender or any demographic. All copy flows through a single
strings layer so the voice can swap wholesale. Serious mode forces the hard voice
and overrides the onboarding choice while active.

### 3. Vulnerability transparency

- **In-app:** only honest, *actionable* status — "Protection active",
  "Extension missing — fix". Never architectural explanation, never what a setting
  defends against, never enumerated bypass surface. Status yes, map no.
- **Out of app:** the full threat model — what each layer covers, known
  limitations, bypass surface — lives in a developer-facing document on GitHub
  (`SECURITY.md` / architecture doc), optionally linked from the installer, for
  developers and auditors who are curious how it works. It never ships inside the
  app UI.

This keeps the open-source auditability moat without putting the map in front of
the person the app is protecting at 2am.

### 4. Exercises

Do not invest in better canned exercises. Tie exercises to real user data instead:
the urge log / trigger analytics (Frontier Plan 5.4) and the panic button (5.1).
An exercise that references the user's own logged triggers and the current moment
beats any generic breathing card.

### 5. Uniform design system

One design system across all four surfaces: extension (popup, blocked page,
options), desktop renderer, website, and store assets.

- Shared **CSS custom-property tokens** (color, spacing, type, radii) in one file,
  copied/referenced across surfaces — compatible with the extension's
  no-build-step constraint.
- A single **strings/voice layer** feeding the voice system (§2) and serious
  mode (§1).
- This is the prerequisite for everything else. Serious mode's full-personality
  flip only works if visuals and copy all flow from one token + strings layer.

### 6. Full UI rebuild

The current UI is not salvageable by patching — nothing in it is uniform or built
properly. **The UI will be rebuilt from scratch on top of the design system**, not
incrementally restyled. The visual direction itself is an open question and may go
a different way entirely; that decision is made *when the design system is
configured*, not before. Until then, no effort goes into polishing existing
screens — existing UI is treated as a functional placeholder.

### 7. Themes: Noir-only + fully custom (added 2026-07-19)

**Noir is the only built-in theme and the default.** The old multi-palette
variants (aurora/lagoon/dawn/midnight/forest/ember and any preset directions)
are gone entirely — the owner will not maintain multiple curated themes.
Instead, themes become **fully user-custom**: the Themes menu is rebuilt as a
color editor where the user can set any color they want, applied as runtime
overrides of the design system's color tokens on top of the Noir defaults.
Dark and light modes are both part of Noir, not separate themes.

### 8. AI mentor (bring-your-own API key)

Re-add the AI mentor, powered by a user-supplied API key.

- **This does not break the zero-telemetry promise**: the project never sees,
  stores, or relays chats. The user sends their own data directly to their own
  chosen provider under their own key.
- Wording requirement only: keep "we collect nothing, ever" absolute, and add one
  plain paragraph that the optional, off-by-default mentor talks directly to the
  user's chosen provider. Stated openly, it strengthens the trust story.
- System-prompt guardrails: the mentor never negotiates about disabling
  protections, and hands off to crisis resources when appropriate.

## Sequencing

1. **Configure the design system** (tokens + strings layer) — and decide the
   visual direction here, including whether to go a different way entirely.
2. **Rebuild the UI** on the design system, across all four surfaces.
3. **Serious mode** — preset + friction-gated disable, reusing existing friction
   and lockdown-escalation code; built into the new UI from the start.
4. **Move weak-spot copy out of the app** — actionable status only in-app; write
   the developer-facing threat-model doc for GitHub/installer.
5. **AI mentor** — BYO key, off by default, direct-to-provider, honest README
   paragraph.
