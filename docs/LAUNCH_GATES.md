# Oath Light
Launch gates

▶ What stands between today and each launch, and **who can clear it**.
Written 2026-07-31, Phase 4. Revised the same day to fold in three owner
decisions: no Edge Add-ons listing, no 90-day course, and the Edge browser lock
stays exactly as it is.

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
| ~~Commit the working tree~~ | owner | **done** — `b15e816` |
| ~~Verify the uninstall/upgrade gate on a real install~~ | — | **done 2026-07-31** — the newest and least-proven code in the release, now exercised |
| Verify the Edge browser lock (kill + 20s grace window) | anyone, at a machine | *the* enforcement path on Edge, not a stopgap — see below |
| Test grayscale hours on a real machine | anyone, at a machine | |
| Smoke-test Firefox force-install against a real admin Firefox | anyone, at a machine | |
| See the desktop reminder card render | anyone, at a machine | new in 0.5.0; unit-tested and compiling, never watched |
| Test the AI overlay's "this was wrong" button on a live detection | anyone, at a machine | overlay only; the extension's blocked page has no such button |
| Pre-Alpha launch test, full scale | anyone, at a machine | |
| Swap OTA dev keys for production keys | **owner only** | needs the private key — [OTA_KEYS.md](OTA_KEYS.md) |
| Arabic draft read by a fluent speaker → `reviewed: true` | **a fluent speaker** | cannot be faked or machine-checked |

Six of those are the *same activity* — install the current build on a machine
and exercise it. Budget one focused session, not six.

The uninstall gate coming off this list matters more than one row suggests: it
was the only item here that had never run at all, and the one most likely to
have been quietly broken.

The last two are not work items at all. No amount of engineering time clears
them, and one of them gates real user-facing behaviour:

* **Until the OTA keys are production keys**, shipped builds trust a development
  signing key.
* **Until a fluent speaker reads it**, Arabic ships as a draft and the picker
  says so.

### The Edge lock is permanent, and it is the thing to verify

Oath Light is **not** being published to Microsoft Edge Add-ons — owner's call,
2026-07-31, already recorded in `browsers.rs`. That closes the only route to
force-installing on Edge: Microsoft honors forced installation solely from its
own store on a machine that isn't domain-joined, so a Chrome Web Store entry
written as Edge policy is accepted and silently discarded.

So `browser_lock.rs` is not a placeholder waiting on a listing. It is how Edge
is enforced, permanently: **while the extension isn't running in Edge, Edge
isn't running either.** The way back is a 20-second grace window requested from
the app, which never extends and never exempts — not even when Edge is the only
browser on the machine. That is the largest deliberate design decision in the
app that has never been exercised on real hardware, which is what makes it the
highest-value item in the session above.

**The 20 seconds stays as it is.** What needs verifying is the loop around it:

1. Edge without the extension dies on sight.
2. The app offers a window, and opens Edge straight at the page that fixes it.
3. The install completes inside 20s, and Edge stops dying.
4. A lapsed window resumes the kill, and a second window costs a second
   deliberate trip to the app.

Step 4 is the one worth being unsentimental about — it is the step that makes
the other three friction rather than theatre.

### Deliberately not gating alpha

Parked in other ROADMAP buckets, and none of it blocks the launch:

* The remaining platforms — Instagram, TikTok, YouTube Shorts, Twitch, Kick,
  Telegram Web, WhatsApp previews, Discord embeds. *(needs the sites open)*
* Model quantization, DirectML/NPU, the real 200-400 image eval set, in-page
  image scoring, the strictness knob. *(needs a GPU)*
* Translation **extraction** — only ~94 keys exist and most UI copy is still
  hardcoded English. *(needs writing)*
* Reproducible installer builds. The zip half is done and proven in CI; the
  NSIS half isn't, so no hash claim is made for the installer. *(needs CI)*

Two things that used to sit on this list are now **not happening at all**, and
have moved to ROADMAP's "Not doing" so they stop being re-planned: publishing to
Edge Add-ons, and the 90-day recovery course. Both are owner's calls made
2026-07-31.

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
