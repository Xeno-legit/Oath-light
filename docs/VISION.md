# Oath Light — Vision

> Why this exists, who it is for, and the product decisions that are settled.
> Status and remaining work live in [../ROADMAP.md](../ROADMAP.md); how it works
> lives in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. What it is

Oath Light is anti-addiction software built specifically to fight pornography
and the compulsive habits around it. Free, open source (GPLv3), zero telemetry,
no paid tier, forever.

**The core user is someone who seriously wants this over** — the person who
installs it furious. Every UX decision is made for that person, not for a casual
site blocker with extras.

The corollary is the whole architecture in one sentence: *the furious person who
installs it and the cooled-off person three weeks later are the same person.*
The app's job is to make commitments made in the strong moment binding in the
weak moment. **Past-you outranks present-you.**

---

## 2. The thesis

Every competitor wins on exactly one axis and neglects the rest.

| App | Wins on | Neglects |
| :-- | :-- | :-- |
| Covenant Eyes | Accountability | Privacy (cloud surveillance), cost, filtering depth |
| Canopy | In-page image filtering | Recovery support, tamper depth, cost |
| Cold Turkey | Lockdown friction | NSFW-specific filtering, recovery, mobile |
| BlockerX | Community + panic tools | Filtering quality, privacy |
| QUITTR / Fortify | Recovery science | Actual blocking (weak filters) |

Oath Light already wins on **filtering quality** (per-item graylist stripping,
41-language homoglyph/punycode keyword engine, 385k curated domains) and on
**trust** (GPLv3, free, zero telemetry). Nobody else has either.

To be *the* frontier blocker it has to win on all five axes at once:

1. **Containment** — nothing NSFW reaches the eyes, on any surface, in any app.
2. **Intelligence** — on-device AI that catches what lists can't, and *acts*.
3. **Humanity** — support in the weak moment, not just a wall.
4. **Tamper resistance** — the weak-moment self cannot outvote the strong-moment self.
5. **Trust** — verifiable, free, private. The only blocker you never have to trust blindly.

**Axis 5 is the moat. Axes 1–4 are the build plan.**

---

## 3. Settled product decisions

These are decided. Reopening one needs a reason, not a preference.

### 3.1 Solo-first accountability
Many users — a teenager, someone isolated, someone too ashamed to tell anyone —
have no partner to name, and the app must be **fully** effective for them.
Accountability is a ladder whose bottom rungs need no other human:

- **Tier 0 — the app holds you accountable (default, solo).** Friction, frozen
  lockdown and clock immunity mean the weak-moment self cannot outvote the
  strong-moment self. Pre-commitment, not willpower.
- **Tier 1 — accountable to your future self (solo).** The tamper-evident log:
  tomorrow-morning-you always sees what last-night-you tried, and nothing can be
  quietly deleted.
- **Tier 2 — a trusted human (optional).** A parent, sibling, friend or mentor —
  not necessarily a spouse. Notified only on discrete events (uninstall
  requested, extension removed and not restored, lockdown cancelled), never
  browsing history, never screenshots.

Tier 2 is an amplifier, never the foundation, and **the UI never nags a solo
user about it**.

> "Covenant-Eyes accountability, zero surveillance — and zero
> accountability-partner required." Nobody else can say either half.

### 3.2 Strengthening is instant; weakening waits
Reused for every protective downgrade, not just uninstall. **The asymmetry is
the product.** When it's unclear which side a change falls on, it's a weakening.

### 3.3 Serious Mode is all-or-nothing
One toggle flips the entire app to its strictest configuration and its hard
voice — every string, every screen, every notification. **No per-feature
exceptions**, because a mode you can negotiate with piecemeal is a mode you talk
yourself out of at 2am. ON is one click and instant; OFF files a friction-gated
request at double the ordinary delay, stays fully active throughout, and
notifies the trusted contact at request time.

### 3.4 Voice, not tone-of-the-week
Tone is a user-selectable voice chosen at onboarding (Companion / Drill
Sergeant), never tied to gender or demographic. Every string exists in both
voices, in one strings layer, so the whole app can flip at once. Serious Mode
forces the hard voice while it's on — it doesn't delete the choice.

### 3.5 Status yes, map no
In-app: only honest, *actionable* status ("Protection active", "Extension
missing — fix"). Never an architectural explanation, never what a setting
defends against, never an enumerated bypass surface. Explaining where protection
is thin, inside the app, is showing a child where the poison is.

Out of app: the **full** threat model — every layer, every known limitation —
lives in [../SECURITY.md](../SECURITY.md) on GitHub, for developers and
auditors. That's how the auditability moat survives without putting the map in
front of the person the app is protecting at 2am.

### 3.6 No false positives in the filter
A blocked legitimate site is worse than a missed porn site. Deterministic only,
hostname-scoped, every new stem collision-checked against a regression corpus
before it lands. See [ARCHITECTURE.md §2.2](ARCHITECTURE.md).

### 3.7 The AI gets no irreversible actuator
On-device, local, never uploading a frame. It escalates on *persistence across
frames*, never single-frame confidence, and its only actions are a dwell-gated
overlay and opening the user's own redirect. No killing processes, no shutdown,
nothing that can't be undone. Being wrong should cost the user time, never data
or access — and reporting a wrong call shortens the pause without ever making
the app catch less.

### 3.8 Nothing leaves the device by default
Any feature that transmits (OTA fetch, trusted-contact mail, the optional BYO-key
mentor) states exactly what it sends, in the UI and in the docs, and is
verifiable in source. The optional mentor talks directly to the user's own
provider under the user's own key — the project never sees, stores or relays a
chat. Stated openly, that strengthens the trust story rather than denting it.

### 3.9 Noir only, colours fully custom
One built-in theme (dark and light are both part of it), plus a colour editor
that overrides the design tokens at runtime. No curated palette presets to
maintain.

### 3.10 The UI is rebuilt, not patched
The old UI is a functional placeholder until it sits on the design system. No
effort goes into polishing a screen that is scheduled for rebuild.

---

## 4. The pitch, when it's all built

> **Oath Light** — the only blocker that filters *inside* the platforms you use,
> watches the screen with AI that never leaves your device, cannot be talked out
> of protecting you at 1 a.m., supports you like a coach instead of shaming you
> like a warden, and proves every one of those claims with open source code.
>
> Free forever. Private by architecture. Verifiable by anyone.

That sentence is impossible for Covenant Eyes (privacy), Canopy (cost,
recovery), Cold Turkey (filtering, humanity), BlockerX (privacy, depth) and
QUITTR (blocking) — and every clause maps to one of the five axes.
