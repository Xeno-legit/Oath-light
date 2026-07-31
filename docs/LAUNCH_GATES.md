# Oath Light
Launch gates

▶ What stands between today and each launch, and **who can clear it**.
Written 2026-07-31, Phase 4.

This is a *view*, not a source. [ROADMAP.md](../ROADMAP.md) remains the only list
of unfinished work and [MASTER_PLAN.md](MASTER_PLAN.md) the only list of phases —
nothing is tracked here that isn't tracked there. What this file adds is the one
thing neither of them says: which remaining items are **work** and which are
**credentials**, because those fail in completely different ways. Work slips.
Credentials block, however many hours you throw at them.

If an item here disagrees with ROADMAP, ROADMAP is right and this file is stale.

---

## There are two finish lines, and they are nowhere near each other

| Launch | Where it sits | What's left |
| :-- | :-- | :-- |
| **Desktop Alpha** | first item of Phase 5 | close out Phase 4 — two lines |
| **Full launch** | last item of Phase 6 | all of Phase 5 + all of Phase 6 |

That gap is the single most important thing on this page. "Alpha" is within
reach. "Full" is behind an Android app and a translation project.

---

## Before Desktop Alpha

Phase 4 has exactly two lines outstanding; every other item on it is Done.

* **Pre-Alpha launch test** — everything again, at full scale.
* **Finishing what's left** → the Before Alpha list in ROADMAP.

### Split by who can actually do it

| Item | Who | Note |
| :-- | :-- | :-- |
| Commit the working tree | owner | |
| Verify the uninstall/upgrade gate on a real install | anyone, at a machine | never tested end to end — see [HARDENING.md](HARDENING.md) |
| Test the overlay's "this was wrong" button on a live detection | anyone, at a machine | |
| Test grayscale hours on a real machine | anyone, at a machine | |
| Smoke-test Firefox force-install against a real admin Firefox | anyone, at a machine | |
| Pre-Alpha launch test, full scale | anyone, at a machine | |
| Swap OTA dev keys for production keys | **owner only** | needs the private key — [OTA_KEYS.md](OTA_KEYS.md) |
| Publish to Microsoft Edge Add-ons, set `EDGE_STORE_EXTENSION_ID` | **owner only** | needs the Partner Center account |
| Arabic draft read by a fluent speaker → `reviewed: true` | **a fluent speaker** | cannot be faked or machine-checked |

Five of those nine are the *same activity* — install the current build on a
machine and exercise it. Budget one focused session, not five.

The last three are not work items at all. No amount of engineering time clears
them, and two of them gate real user-facing behaviour:

* **Until the Edge Add-ons listing exists**, Edge can only *auto-install* the
  extension (the user clicks once to enable) rather than force-install it.
  Microsoft limits forced installation to its own store on any machine that
  isn't domain-joined, so the Chrome Web Store entry written as policy is
  accepted and silently discarded. The code is already wired for both paths.
* **Until the OTA keys are production keys**, shipped builds trust a development
  signing key.

### Deliberately not gating alpha

Parked in other ROADMAP buckets, and none of it blocks the launch:

* The remaining platforms — Instagram, TikTok, YouTube Shorts, Twitch, Kick,
  Telegram Web, WhatsApp previews, Discord embeds. *(needs the sites open)*
* Model quantization, DirectML/NPU, the real 200-400 image eval set, in-page
  image scoring, the strictness knob. *(needs a GPU)*
* The 90-day recovery course, and translation **extraction** — only ~94 keys
  exist and most UI copy is still hardcoded English. *(needs writing)*
* Reproducible installer builds. The zip half is done and proven in CI; the
  NSIS half isn't, so no hash claim is made for the installer. *(needs CI)*

One item on that list deserves a second look before you commit to it:

> **Finishing the UI rebuild.** Blocking, Blocklist and Monitor are still the
> old screens, and this sits under "Later" rather than Before Alpha. Shipping an
> alpha means shipping three screens visibly out of step with the rest of the
> app. That may well be the right trade for getting it out — but it is the most
> user-visible thing on the not-gating list, and it should be a decision rather
> than an oversight.

---

## Before Full launch

Everything above, then two complete phases.

**Phase 5** — Desktop Alpha launch → phone support → built-in AI scanner on
phone → permissions to prevent app deletion in weak moments → Phone Alpha
launch.

The phone half of that is not started and nothing is scaffolded (`src-tauri/gen/`
holds schemas only). ROADMAP gates Android behind the quantized model, which is
itself waiting on a GPU bench run. The design leans on the two most heavily
restricted APIs on the platform — `VpnService` for DNS filtering and
`AccessibilityService` for screen capture — both of which need a Play policy
declaration and human review measured in days to weeks. Content-monitoring uses
of the accessibility API are a routine rejection. None of the desktop tamper
resistance transfers: there is no Android equivalent of the two-process
watchdog.

The one genuinely portable piece is `oathlight-core` — the blocklist and
matching engine is already factored out for exactly this.

**Phase 6** — domains expansion → multi-language support → the Oath Light
website → donation booth → **Full launch**.

---

## Loose ends to settle at alpha, not after

* **The installer still calls this an open beta.**
  [installer/POLICY.md](../desktop-app/installer/POLICY.md) and
  [installer/EULA.rtf](../desktop-app/installer/EULA.rtf) both open with
  *"Version 0.1.0 (Open Beta) — 2026-07-05"* and a section headed "This is an
  open beta", while the app badge reads ALPHA and the build is 0.5.0. Users
  would be agreeing to a document describing a different stage of a different
  version. MASTER_PLAN cancelled the Open Beta back in Phase 3 ("straight to
  Alpha instead"), so this framing is stale by a whole phase — not just a
  version number.

* **The uninstall gate has never run on a real install.** The NSIS assembles and
  the decision table is unit-tested, but Settings → Apps refusing, an in-app
  removal completing, and an upgrade preserving policy/DNS/autostart have not
  been exercised against an installed build. This is the newest and least-proven
  code in the release.
