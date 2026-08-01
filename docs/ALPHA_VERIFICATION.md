# Oath Light
Alpha verification session

▶ The one sitting that clears Phase 4. Everything here needs **a real machine** —
none of it can be reasoned about, which is why it is still open.
Written 2026-08-01, Phase 4.

Budget half a day. Six of these are the same activity — install the current build
and exercise it — so do them in one pass, in this order. This is a checklist to
run off the screen; tick as you go and write the date in the results table.

If an item here disagrees with [ROADMAP.md](../ROADMAP.md), ROADMAP is right.

---

## Read this before you start

**Do not test time-based features by moving the system clock.** Clock-tamper
immunity is a shipped feature, not a bug: rolling the clock forward freezes the
friction timer and logs an anomaly rather than crediting it. You would corrupt
friction state and misread every result after it. For grayscale hours and the
reminder card, **change the configured window to cover now** — never the clock.

**Have a DNS recovery move ready.** Station 2 rewrites adapter DNS. The
`dns.json` clobbering bug is fixed with six tests behind it, but this is the one
station that touches system state you would miss if it went wrong. Know how to
reset your adapter to DHCP/automatic by hand before you start.

**Skip the AI overlay's "this was wrong" button.** It is screen-monitor work and
gates nothing here.

**Order matters.** Stations are sequenced so that anything capable of
invalidating the rest fails first. Do not skip ahead; a pass at station 5 means
nothing if station 1 was limping.

---

## Station 0 — Desk work, before you install

No machine required. Ten minutes.

- [ ] **Confirm the OTA signing seed.** The public keys are baked and verified;
      what's outstanding is the private half. Run — it prints a verdict, never
      the seed:
      ```
      OTA_SIGNING_KEY=<64-hex seed> node scripts/ota/check-seed.mjs
      ```
      * `MATCH — ACTIVE` → set it as the `OTA_SIGNING_KEY` repository secret
        (GitHub → Settings → Secrets and variables → Actions).
      * `NO MATCH`, or no seed found → **stop and regenerate** per
        [OTA_KEYS.md](OTA_KEYS.md). Cheap now. Impossible after release, because
        shipped clients would trust a key nobody can sign for.
- [ ] **Build the installer** from the current tree.
- [ ] **Keep the previous build** to hand — station 7 needs an upgrade path.
- [ ] Confirm the machine has **Edge and Firefox installed**, and that the
      extension is **not** already installed in Edge. Station 3 is meaningless
      otherwise.

---

## Station 1 — Fresh install comes up

▶ **If this fails, stop.** Nothing below is meaningful on a limping install.

- [ ] Installer completes on a clean machine.
- [ ] Service is running, and the **guardian watchdog** process is alive
      alongside it.
- [ ] **Both** autostart entries are registered.
- [ ] Extension is force-installed into Chrome and shows as active.
- [ ] Native messaging bridge reports connected.

**Pass:** the app's own status agrees with Task Manager and the browser's
extensions page — not merely with itself. A green badge over a dead service is
the failure this station exists to catch.

---

## Station 2 — DNS adapter takeover

▶ The single runtime confirmation outstanding on a layer carrying 48 tests. Do it
early: it touches system state.

- [ ] Turn DNS filtering on.
- [ ] Resolver answers, and a blocked domain is actually blocked through it.
- [ ] An ordinary domain still resolves normally.
- [ ] Turn it off; adapter DNS returns to what it was before.

**Pass:** filtering applies and the adapter round-trips cleanly.

**On failure:** the three failure messages are distinguishable *on purpose*. Copy
the exact wording — it names which of the three things went wrong, and a vague
"DNS didn't work" throws that design away.

---

## Station 3 — Edge browser lock

▶ **The highest-value item in this session.** The largest deliberate design
decision in the app, and it has never run on real hardware. The 20 seconds stays
as it is; what needs proving is the loop around it.

- [ ] **Kill on sight.** Open Edge without the extension → Edge dies.
- [ ] **The way back exists.** The app offers a grace window and opens Edge
      straight at the page that fixes it.
- [ ] **The way back works.** Complete the install inside 20s → Edge stops dying.
- [ ] **The window is real friction.** Request a window and *deliberately let it
      lapse*. The kill must resume, and a second window must cost a second
      deliberate trip to the app.

**Pass:** all four. The fourth is the one to be unsentimental about — it is what
makes the first three friction rather than theatre. A lapsed window that silently
renews, or a second window granted without a fresh trip, is a **fail** even
though nothing crashed.

---

## Station 4 — Firefox force-install

- [ ] Policy is accepted by a real admin Firefox.
- [ ] Extension is present and enabled after restart.
- [ ] The user is not offered a prompt they can decline.

**Pass:** installed without user consent being solicited. Firefox honouring the
policy but leaving the extension disabled is a fail.

---

## Station 5 — Grayscale hours

- [ ] Set the configured grayscale window to cover **now** (not the clock — see
      the warning at the top).
- [ ] Screen goes grayscale within the window.
- [ ] It returns to normal outside the window.

---

## Station 6 — Desktop reminder card

▶ New in 0.5.0. The window maths is unit-tested and it compiles, but nobody has
watched one appear.

- [ ] Set vulnerable hours to cover now.
- [ ] Wait a minute. A card actually renders.
- [ ] It reads correctly — right copy, right layout, dismissible.

---

## Station 7 — Full pre-alpha pass

▶ Everything, once, at full scale, on the state the stations above left behind.

- [ ] Blocking works across all layers: extension, keyword engine, DNS.
- [ ] The graylist behaves on two or three real platforms.
- [ ] Friction: request a weakening, confirm the wait is enforced and the pending
      state survives a restart.
- [ ] **Upgrade path:** install over the previous build; policy, DNS and
      autostart survive.
- [ ] Uninstall gate: Settings → Apps refuses; in-app removal completes.

---

## Results

Fill this in as you go. An empty row is not a pass.

| Station | Result | Date | Notes / exact failure text |
| :-- | :--: | :-- | :-- |
| 0 — OTA seed + build | | | |
| 1 — Fresh install | | | |
| 2 — DNS takeover | | | |
| 3 — Edge lock | | | |
| 4 — Firefox force-install | | | |
| 5 — Grayscale hours | | | |
| 6 — Reminder card | | | |
| 7 — Full pass | | | |

**Where failures go:** a bypass or a hole → [BYPASSES.md](../BYPASSES.md). Broken
behaviour → [ROADMAP.md](../ROADMAP.md), under the bucket it belongs to. Do not
record either one only here; this file is a session record, not a tracker.

**Most likely to actually fail**, on the evidence: station 3's lapsed window,
station 2, and station 1's autostart/watchdog on a genuinely clean machine.
Everything else is confirmation of code that already has tests behind it.
