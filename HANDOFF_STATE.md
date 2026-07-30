# Handoff — Polishing pass (Polishing.md)

Updated 2026-07-30. Branch `pre-alpha/release`.

Five sessions have worked through [`../Polishing.md`](../Polishing.md) — the
owner's review notes covering the extension, desktop app, features and website.
**Every numbered item in that file is now done.** This file says what changed,
what is still only *claimed* to work, and the parts that need a real machine
rather than more code.

---

## Session 5 (2026-07-30) — verification pass

Sessions 3 and 4 were re-checked rather than extended. Most of it held up, and
three things were confirmed against this machine's actual state rather than
against the code that was supposed to produce it:

* **Chrome force-install works.** `HKCU` carries the store-id forcelist entry,
  and Chrome's Secure Preferences show the extension in five profiles at
  `manifest.version 3.5.0`, `location: 7` (external policy download), no
  `disable_reasons` — which is exactly what `profiles::read_profile_ext` needs
  to report `installed`.
* **The `ensure_policy_key` regression was real**, and there is live proof: this
  machine still has all three Brave list-policy subkeys present with zero
  numbered values — the "policy set to an empty list" state. `prune_empty_list_
  policy_keys` clears it on the next startup.
* **The Edge diagnosis was right.** An older build's Chrome-Web-Store forcelist
  entry is still sitting in `HKCU\…\Policies\Microsoft\Edge`, and Edge's two
  profiles hold 26 and 23 extension entries with **ours in neither** — not even
  the settings stub. Edge discarded it in silence, precisely as documented.
  `dsregcmd /status` was also run against `is_domain_managed`'s parser: the field
  names match and this machine reads unjoined, so Edge correctly takes the
  external-install fallback.

Three fixes came out of it (the Edge one below is **not** among them — see
"Known, not fixed"):

1. **The enforcement memo was write-once, and that made it a claim.** The monitor
   remembered each browser's `EnforceOutcome` so it wouldn't re-run `reg` every
   3s, but nothing ever re-read it — so "we wrote the policy" silently became
   "the policy is there" for the rest of the session. Delete the `HKCU` forcelist
   value (no prompt needed; it is the user's own hive, and the fallback most
   unelevated installs land on) and the row went on reporting a lock that no
   longer existed and never re-asserted it. The browsers' own self-heal cannot
   cover this: it reinstalls an extension removed *while the policy stands*, and
   does nothing about the policy itself being removed. `browsers::enforcement_
   still_present` now re-reads on the same ~30s deep cadence as the DNS drift
   check and drops the memo for anything gone **or weakened** (an
   `EnforcedMachine` memo that now only finds `HKCU` is not still true), so the
   next tick re-writes and re-reports honestly. Outcomes that wrote nothing cost
   no registry reads. This is Polishing.md's "the app should constantly make sure
   the extension is installed regardless if it was before", for the policy layer.
2. **The Edge auto-install registration gained the same check** (`external_
   install_present`). It is the only thing standing behind Edge today and it
   lives in a plain `HKCU` key with no ACL, so leaving it as the one path that
   couldn't notice its own deletion would have been an odd half-fix.
3. **`dns/src/lib.rs`'s stale `cargo` claim is gone** — see the note under
   session 4.

### The browser lock — Edge doesn't get to run unprotected

Added this session, and it is the answer to the thing session 3 could only
report: Edge is the one browser where staying protected is *voluntary*, because
Microsoft won't force-install from the Chrome Web Store on a consumer PC. The
external-registry path gets the extension installed there but explicitly cannot
pin it — the user approves it, and the user can remove it again.

So: **a browser that cannot be force-installed does not get to run without the
extension.** `enforce_browser_lock` (monitor tick) kills it on sight, and the way
back is `request_browser_restore` — re-assert the registration, launch the
browser at its own extensions page, and suspend the kill for 20 seconds.

Design decisions worth not re-litigating:

* **Keyed on `browsers::requires_manual_install`, never on `"edge"`.** The day an
  Edge Add-ons id is published, `forcelist_target` returns a real pair, that
  helper goes false, and Edge stops being kill-on-sight with nobody having to
  remember. A browser we *can* pin must never be locked out — killing it would
  prevent the very launch during which its policy reinstalls the extension.
* **The bar is every profile, not `installed`.** `installed` is "at least one
  profile", and a second profile without the extension is a fully usable
  unprotected browser — exactly what this exists to stop.
* **Unreadable prefs never kill.** `BrowserFacts::ground_truth` is false when the
  profile scan fails, and that path always allows. A locked file must not be able
  to brick a browser.
* **The 20s window is hard and never extends.** An earlier draft extended it
  while the extension was downloaded-but-unapproved, on the reasoning that a
  cold start plus a Web Store round trip can eat the window before the user is
  shown anything to click. That was cut on the owner's call, and the reasoning
  is sound: a window long enough to be comfortable is a window long enough to
  browse in. Needing more time means asking again, which costs another
  deliberate trip to the app — and that friction is the feature.
* **Restore is deliberately NOT friction-gated**, unlike every other control
  here. It grants seconds, not access, and the only thing it enables is
  installing the extension. A 24-hour cool-off in front of the one action that
  ends the lockout would make the lockout unrecoverable rather than strict.
* **One exemption: a machine with no other browser** (`sole_browser`). Bricking
  the only browser on a computer doesn't produce a protected user, it produces
  someone who cannot reach anything — including the page they'd need to install
  a second browser, or this app's own help. `browsers::has_alternative_browser`
  requires the alternative to be one we can actually pin, so two mutually-locked
  browsers can never exempt each other.
* Off by default; on is instant, off is a `browser_lock.disable` weakening.

**The exemption's cost, stated plainly:** uninstalling every other browser
un-bricks Edge. That is inherent to the rule, not an oversight. It is a bad
trade for the user (they give up every browser we *can* pin to get one we
can't), but it is a real path. It is deliberately **not** surfaced in the UI —
"your only browser is exempt" on screen is the recipe, not a status (VOICE.md,
"status yes, map no") — and instead writes a `browser_lock_exempt` event on each
transition, so protection history records it without advertising it.

**Not verified on a real machine.** The state machine is unit-tested, but the
things that need an actual run are: that killing `msedge.exe` really does keep
Edge shut (startup boost and background mode respawn it, which is why the event
emit is throttled to 60s), that a hard 20s is actually enough to complete the
approval on a cold start — if it repeatedly isn't, `GRACE_WINDOW` is one
constant — and that launching Edge at `edge://extensions` inside the window
behaves. Turn it on and try to get back in.

> **Build note for whoever picks this up:** `cargo` in this repo intermittently
> fails or hangs in `tauri-build` with `PermissionDenied` on
> `target/debug/oath-light-host.exe`. That is not a code problem — the HKCU
> native-messaging manifest points at the dev-build path, so any browser running
> the extension respawns that binary within milliseconds of it being killed, and
> the build script cannot replace a running exe. `npm run free-sidecars` only
> wins the race sometimes. The reliable workaround is to build with a separate
> `CARGO_TARGET_DIR`, which has no locked file to replace.

### Known, not fixed

**The stale Edge forcelist entry is never cleaned up.** `prune_empty_list_policy_
keys` skips it (it holds a real numbered value) and `enforce_policy`'s Edge
branch returns before touching the forcelist, so only a sanctioned uninstall
removes it. It is inert — Edge ignores it, and if an Edge Add-ons id is ever
published `pick_forcelist_value` reuses the same ordinal and overwrites it
cleanly — but until then every upgrading user keeps a "managed by your
organization" banner backed by a policy that does nothing. The fix is to delete
our own entries in the `forcelist_target == None` branch before falling back.

---

## Read this first: what still needs a real machine

**The DNS fixes are untested at runtime.** They compile, they pass clippy, and
the logic that can be unit-tested is — but adapter DNS is Windows *system
behaviour* and nothing here can prove it works on a real install. Turn the
filter on: it should either take over cleanly or say something specific and true
about why not. The **four** status messages are distinguishable on purpose — see
"System DNS" below for the first three, and session 4 for `exposure_warning`,
which is the one that means "working, but no longer in the DNS path". Session 4
also lists the VPN scenarios that specifically need a live test.

**Force-install was diagnosed on a real machine in session 3 and is no longer
guesswork** — see that section below. The one remaining piece is not code: Edge
needs a Microsoft Edge Add-ons listing before it can be force-installed at all.

> **The E: drive failed during the previous session** (NTFS transaction-log
> flush failures, volume dropped off the bus, came back clean after a reboot).
> Nothing was permanently lost, but a handful of edits were silently rolled
> back and had to be re-applied. If anything in this repo looks half-applied,
> that is the likely cause — check against this file rather than assuming it
> was never written. Back the repo up off that drive.

---

## Session 4 (2026-07-30) — the DNS layer and VPNs

Started as a question — *is the DNS filter compatible with VPNs, or can one crash
the resolver?* Neither, exactly. Nothing a VPN does can crash the resolver (a
port-53 conflict at enable time is already reported cleanly, and transient socket
errors never kill a worker), but two things were genuinely wrong, and they pull in
opposite directions.

**1. A routing change under a live filter caused a permanent DNS outage.**
Upstreams were chosen once, in `enable`, from the adapters up at that moment, and
never re-examined. Enable on a LAN (upstream `192.168.1.1`), then bring up a
full-tunnel VPN: the LAN resolver is unreachable through the tunnel, so every
clean query burned both upstream timeouts and was dropped, while blocked names
kept answering NXDOMAIN instantly. It never recovered, and — correctly — the
fail-open failsafe could not see it, because the health probe is local-only by
design (session 2, item 1).

That was the gap: session 2 split "the resolver is dead" from "an upstream is
unreachable" and gave the second one a *report*, not a handler. A third state was
hiding inside it — the upstream is **gone**, not slow, and waiting never fixes it.
`server::Shared` now counts consecutive forwards where neither upstream answered
(`forward_failures`); `dns_filter::tick_recheck_upstreams` reads that on every 3s
tick behind an uncontended lock and one atomic load and, past
`FORWARD_FAILURE_LIMIT` (4) with a 30s cooldown, re-enumerates and re-picks from
the adapters that exist *now* (with no lock held). The new
`DnsServer::set_upstreams` swaps the pair live, without restarting listeners.
Nice side effect: in the full-tunnel case DNS starts working again *through* the
filter, which is strictly better than the alternative below.

**2. The filter could be sidelined silently, and the card still said green.**
`reassert` only ever touches adapters recorded in `dns.json` — deliberately, so a
blocker never breaks a work VPN or a captive portal. The cost is that a tunnel
adapter appearing *after* takeover keeps its own DNS, and Windows prefers the
interface with the lower metric, so the resolver is simply never consulted. An
NRPT rule for the root namespace does the same thing and outranks adapter DNS
settings entirely — no `Set-DnsClientServerAddress` write can win against it.

Still not fought (that stays a Lockdown Mode decision, plan 4.4 — see
`enforce_processes`' note that VPN detection is out of scope until then). What
changed is honesty: `takeover::detect_exposure` runs on the same throttled ~30s
cadence as the drift check, one read-only PowerShell round trip for both halves,
and `DnsStatus::exposure_warning` degrades the status line to
`blocking.dns_status_reduced` — "Running, but not covering every app right now" —
instead of continuing to claim every app on the computer. Transitions write a
`dns_exposure` event (counts and flags only, never adapter names).

> **The metric comparison is the whole reason this is shippable.** A check that
> flagged every foreign adapter with DNS configured would fire permanently on any
> machine with Hyper-V, WSL, VMware or VirtualBox — all of which keep up adapters
> with real DNS servers that never answer for the host. `exposure_from` only
> counts an adapter Windows prefers at least as much as the best one we hold.
> Per BYPASSES.md, a false positive is not cosmetic: an alarm people learn to
> ignore protects nobody.

**3. `tick_revert_drift` finally writes its event.** It returns the reverted count
instead of only logging, and the caller appends `dns_changed` — closing the
`TODO(4.5)` that had been sitting in `dns_filter.rs` waiting for the event log to
exist. It does now.

### Still needs a real machine

Everything above compiles, passes clippy `-D warnings`, and is unit-tested where
the logic is pure (10 new tests across `takeover`, `server` and `dns_filter`).
The exposure script itself was run read-only on the owner's machine and returned
the exact shape the parser expects. What is **not** verified is the behaviour it
exists for: connect a real VPN with the filter on and confirm (a) the status line
degrades within ~30s and the detail sentence names the right connection, (b) it
clears again on disconnect, and (c) in a DNS-less tunnel config, clean lookups
recover within ~30s instead of failing forever.

> **Done in session 5:** `dns/src/lib.rs` used to claim `cargo` hangs in this
> dev environment and that nothing here can be compile-checked. That was stale —
> `cargo check`, `cargo test` and `cargo clippy` all run fine (14s cold for the
> dns crate, 30s for the workspace) — and it was being read as permission to skip
> verification, so the sentence is gone and the comment now says the opposite in
> as many words. The *decision* it used to justify (no hickory-dns, hand-rolled
> `std::net`) is untouched and now rests on the reasons that actually hold.

---

## Session 3 (2026-07-30) — force-install, diagnosed on the machine

The previous two sessions fixed force-install by reasoning about it. This one
measured it: registry dumps, per-profile extension inventories, and Edge run
with `--enable-logging --v=1` against an isolated profile. Three separate causes,
only one of which had been guessed correctly.

### 1. Edge: the Chrome Web Store is not a legal source, and never was

Microsoft's `ExtensionInstallForcelist` documentation:

> For Windows instances not joined to a Microsoft Active Directory domain, forced
> installation is limited to apps and extensions listed in the Microsoft Edge
> Add-ons website.

Every user of this app is on an unjoined consumer PC. Edge takes the policy,
writes a bare `extensions.settings.<id>: {}` stub into Secure Preferences, and
**never issues an update request for the ID at all** — confirmed in the verbose
log, where other force-installs in the same session fetch normally and ours is
absent entirely. No error surfaces anywhere.

Session 1 had diagnosed this as Edge distrusting the CWS *source* and added
`ExtensionInstallSources` + `ExtensionInstallAllowlist` to fix it. Those are
real policies and worth keeping under a restrictive blocklist, but they do not
and cannot address this: the restriction is on the store, not on permissions.
Elevation does not help either.

`forcelist_target()` now picks the store per browser. Edge prefers an Edge
Add-ons ID, falls back to the Web Store only when `dsregcmd` reports the machine
domain/Entra-joined (where the restriction lifts), and otherwise returns the new
`EnforceOutcome::StoreUnavailable` — which the UI renders as "Edge won't
auto-install this — add it yourself" with a link, instead of a permanent
"pending" that never resolves.

**To finish this: publish to Edge Add-ons and set `EDGE_STORE_EXTENSION_ID`.**
That constant is the only change needed.

#### …but Edge is no longer unprotected in the meantime

The restriction is on *forced* installation only. Chromium's **external-
extensions registry** (`HKCU\Software\Microsoft\Edge\Extensions\<id>` holding an
`update_url`) is a different mechanism, needs no admin, and Edge honours it for
Chrome-Web-Store extensions on an unmanaged machine. Verified end to end: Edge
queries CWS with `installedby=external`, downloads
`OIGDPCDGMLDGJALFNLGEKCBKMNIPLNAD_3_5_0_0.crx`, unpacks it and registers 3.5.0.
`enforce_external_install` writes it whenever `forcelist_target` comes back
`None`.

It is **auto-install, not a lock**, and it stops one step short of running:
Chromium disables an externally-registered extension until the user
acknowledges the "new extension added" prompt once (`disable_reasons: 8192,
location: 6`). That was measured against an unrelated control extension with no
policy of ours anywhere near it and came back identical, so it is the generic
sideload protection, not a side effect of our configuration. The acknowledgement
lives in HMAC-signed Secure Preferences — a browser security control, not
forged. The user can also remove the extension afterwards and Chromium remembers
it in `external_uninstalls`.

Reported honestly as `needs_approval` → `auto_installed` (never "locked"), with
a **Turn it on** button that opens `edge://extensions` via `open_extensions_page`
— a user who dismissed the prompt otherwise has no way back to the toggle.

### 2. Chrome: `ensure_policy_key` was force-*uninstalling* the extension

This is the "recent versions broke Chrome too" report, and it was self-inflicted.

Session 1 added `ensure_policy_key()` to pre-create policy keys so a running
browser would notice a later write. It created not just the vendor key but the
three list-policy subkeys, in **both hives**, for all seven browsers, on every
startup. A Chromium list policy is encoded as a subkey whose values are named
`1`, `2`, … — so **a subkey with no numbered values is not "no policy", it is the
policy set to an empty list.** Machine scope outranks user scope in Chromium's
policy merge, and Chrome's own docs say an extension removed from
`ExtensionInstallForcelist` is uninstalled. So on any machine where the app ran
elevated — which the `OathLightElevated` logon task does, `/RL HIGHEST` — an
empty `HKLM` forcelist overrode the working `HKCU` entry and pulled the
extension back out.

`ensure_policy_key` now creates only the vendor key (enough: Chromium's watch is
registered with `bWatchSubtree`, so subkeys created later are still seen), and
`prune_empty_list_policy_keys` deletes empty list keys in both hives on every
startup — this has to *repair* machines already in that state, not merely stop
creating new ones. It never touches a key holding a real entry;
`pruning_removes_only_the_empty_list_keys` proves that against the live registry.

### 3. The policy was skipped for exactly the browsers that needed it

The monitor gated enforcement on `if !(st.installed || st.running)`. For a
Chromium browser whose profiles we can read, `build_status` sets `installed` to
*the extension is present in some profile* — while the fallback branch (Firefox,
unknown browsers) sets the same field to *the browser is present on the
machine*. The gate was written against the second meaning. Net effect: a browser
that had never had the extension — the only case force-install exists for — was
skipped unless it happened to be running at that moment. Now gated on
`st.running || st.installed || is_installed_cached(def)` (60s cache; the uncached
probe is two `reg query` spawns per browser per 3s tick).

### 4. The button that did nothing

`enforce_policy` returned early whenever any policy already existed, so the
"Restore" button re-applied nothing, in every state it could appear in. And
"Grant admin & lock" was gated on `enforcement === 'failed'`, which never
happens on a machine where the HKCU fallback succeeds — so on those machines the
only button ever shown was the dead one.

`enforce_policy` now always writes. That is also *how* restore works: the write
bumps the key's last-write time, which fires the registry change notification
both Chromium and Firefox watch, which reloads policy and reinstalls a missing
extension without a browser restart. It reports the strongest scope true
afterwards, so an unelevated re-apply on an HKLM-locked machine still says
"enforced" rather than downgrading itself to "enforced_user".

The UI now offers one action per row, chosen by what can actually fix that state:
"Grant admin & lock" for `failed`/`enforced_user`/`pending_user`, "Restore" only
where the machine-wide lock already exists and the extension is missing, "Add it
yourself" for `store_unavailable`, and nothing at all when nothing would help.
`pending` split into `pending`/`pending_user` because the two want different
buttons.

### Firefox

Not broken. The `ExtensionSettings` REG_MULTI_SZ write was suspected (JSON with
embedded quotes through `reg add`) and cleared: verified that Rust's `Command`
escaping round-trips the JSON through `reg.exe` intact, and that the AMO
`latest.xpi` endpoint resolves (302 → `oath_light_content_filter-3.5.0.xpi`).
What was broken for Firefox was only the UI — the missing "Grant admin & lock"
button described above, which is what the owner remembered working.

---

## Session 2 (2026-07-28)

### System DNS — the resolver "started but isn't answering" (Polishing.md ▸ Overall)

Three separate bugs. The reported symptom was caused by the first.

**1. The health probe required a working upstream, and had a smaller time
budget than one.** `health_check` asked the resolver for `example.com`, which
is *forwarded*: `UPSTREAM_TIMEOUT` is 3s per upstream (6s for the pair) against
a 2s probe budget. So any unreachable upstream — a Hyper-V/WSL virtual gateway
picked as primary, a network that blocks port 53 to public resolvers, a slow
link — made the probe time out, and the app reported *"the resolver started but
isn't answering on 127.0.0.1:53"*. **That message was false.** The resolver was
answering fine; the upstream was not.

The probe now asks for a reserved name (`health-probe.oathlight.invalid`,
RFC 6761 §6.4) that `process_query` answers locally before `decide` and before
any chance of forwarding. It measures exactly one thing: are the listener
threads serving on 127.0.0.1:53.

> **This separation is load-bearing, not tidiness.** The probe also drives the
> fail-open failsafe on the 3s monitor tick, whose remedy is *restore the real
> upstreams*. Firing that because an upstream is unreachable disables the
> user's protection in order to restore DNS that was already broken. Keep the
> probe local-only.

**2. Upstreams were chosen by enumeration order, never checked.** `resolve_
upstreams` took the first captured IPv4 address across all "Up" adapters. On
any machine with Hyper-V, WSL, VMware or VirtualBox installed, several of those
adapters are up with a DNS server that never answers the host. `enable` now
probes candidates (`probe_upstream`, 900ms each, first two that reply win) and
falls back to the public resolvers only if none answer — reporting that in a
new, **non-fatal** `DnsStatus::upstream_warning` the Blocking page renders
separately from the filter's own status. `upstream_candidates()` also rejects
loopback (all of 127/8, not just `127.0.0.1`), `0.0.0.0`, link-local and
multicast.

**3. `dns.json` could be overwritten with our own takeover — bricking DNS.**
`takeover()` rewrites the restore point every run. If the resolver was already
active (app killed without a clean disable, or the user just re-enabled), what
enumeration reports is *our* `127.0.0.1` / `::1` — and saving that destroys the
only record of the machine's real DNS. `restore` would then set every adapter
to 127.0.0.1 and leave it there, **including on uninstall**. `capture_for` now
strips loopback and, for an adapter that had servers and lost *all* of them to
that strip, keeps its earlier real capture. Six unit tests pin the behaviour,
including the "had none to begin with" case that must NOT resurrect a stale
file.

Files: `dns/src/{server,upstream,takeover,lib}.rs`, `src-tauri/src/dns_filter.rs`,
`js/pages-blocking.jsx`. 29 tests in `oathlight-dns`, 2 in `dns_filter`.

### Settings — rebuilt

Now follows the same rule Blocking Settings does: one `<Setting>` row per
control, one short line of description, everything longer in an `InfoDot`.
1363 → ~1000 lines. Ten cards became nine `SectionCard`s in a deliberate order
(profile → Serious Mode → voice → notifications → mentor → contact → password →
records → pending → the exits), so nothing is ever reachable before the thing
that governs it. Voice and Language merged into one card; blocklist updates,
protection history and the eval log merged into "What Oath Light keeps".

**"Drill Sergeant" → "Coach".** Label only — the `voice: 'serious'` id is
unchanged everywhere. Arabic already said this (`المدرّب الصارم`, "the strict
coach"); English was the outlier. Renamed in `design-system/strings.js` (+ its
two copies), `VOICE.md`, both READMEs, `ARCHITECTURE.md`, `ROADMAP.md`.

**Do the notifications work? Yes — and the page now says what they actually
are.** The two check-in reminders are real: `alerts` rides the `setBlocking`
payload to the extension, where a persistent `chrome.alarms` alarm
(`bg/reminders.js`) evaluates the vulnerable-hours window every 30 minutes and
has `content.js` draw an in-page nudge. **In-page, not an OS toast** — the app
has no notification plugin at all — so that is how it is described.

**The three "Coming soon · not built yet" rows were wrong about two of three:**

| Row | Verdict |
|---|---|
| Daily intention | **Already built** — Overview renders one every day (`DAILY_MESSAGES`) |
| Milestone celebrations | **Already built** — Overview celebrates 7/30/90/… once each, guarded by the persisted `lastMilestone` |
| Weekly recap | **Genuinely missing — built this session** (`WeeklyRecapCard` on Overview) |

The recap is a rolling seven days, not "every Sunday" (a recap you can only
read one day a week is one you mostly can't read). It reports only logged urges
and logged slips, and never infers anything from their absence beyond "nothing
was logged".

**Dead store fields removed:** `profile.partner`, `profile.member`, and the
whole `notif: { daily, milestone, partner, urge, weekly }` block — written by
the old page, read by nothing. Same audit as the `blocking.*` fields last
session.

### Themes — rebuilt, and the `style` plumbing finally cut

The old page listed all seventeen colour tokens in one flat list labelled with
raw `--ol-*` names, with no way to see what a change did. That is a token
inspector, not a theme picker. Now: colours grouped by **role** (Accent, Text,
Surfaces, Status), each group collapsed until opened, a **live preview** above
them showing a real button/card/text in the current values, and the raw token
name moved into an InfoDot. Any manifest colour token not claimed by a group
falls into a visible "Other" group rather than becoming silently uneditable.

**`display.style` is gone from every surface** — the last item the previous
session flagged. It was a palette name with one legal value that nothing read,
still being written by `app.jsx`, `store.js`, `theme-sync.js`, `blocked.js` and
`native-bridge.js`, with `data-style="aurora"` still hard-coded in
`user_blocklist.html` (missed last session). The hub card's stat chip now shows
Light/Dark instead.

### Tips & Questions — rebuilt

* **The cards were `<div onClick>`.** No Tab stop, no Enter/Space, no
  `aria-expanded` — the whole page was unreachable without a mouse and opaque
  to a screen reader. They are real `<button>`s now.
* **Search**, matching title *and* body across both sections. Fifteen
  accordions with no filter is a list you scroll past.
* **The magic `maxHeight: 250`** (which clips the longest entry in a narrow
  window) is now `grid-template-rows: 0fr → 1fr` — same effect, no number to
  be wrong.
* **RTL fix:** the body copy indented with a physical `padding-left: 54px`,
  which detaches it from its title in Arabic. Now `padding-inline-start`.
* Per-card colour rotated through three accents by array position, encoding
  nothing. Now one colour per *list* — tips vs. questions, a real distinction.
* The two full-width gradient hero panels are one row.

### Extension code review (Polishing.md ▸ Extension)

**Broken / shipping-wrong:**

1. **`gsap.min.js` — 71 KB of unreferenced third-party code**, in both store
   zips (verified with `zipfile`). Not in the manifest, not in any `<script>`.
   Deleted; the packer sweeps `extension/`, so no build-script change needed.
2. **`blocklists.html` loaded Inter from Google Fonts** and declared its own
   palette in literal hex — the retired indigo/sky "aurora" set — plus
   `[data-theme="lavender"|"forest"|"midnight"]` blocks. **Nothing could ever
   select those three**: `theme-sync.js` only ever writes `light` or `dark`, so
   `:root` won every time and **the blocklist manager rendered light even with
   the app in dark mode**. Its local names now map onto `var(--ol-*)`, so it
   follows the app for free. Also a third-party network request from a page in
   an extension that declares `data_collection_permissions: none`.
3. **`PP_TESTING` in `background.js`** — a constant hard-coded to `false` that,
   when flipped, routed every block to `about:blank` and suppressed the
   redirect link with it. One word away from a silent no-op blocker, in shipped
   store builds. Removed.
4. **Light mode was still aurora-era violet in all three stylesheets.** Each
   had *three* `[data-theme]` rules per side written at three different times,
   each overriding the last — and what survived was not what anyone chose:
   violet shadows (nothing overrode them) and `--glass-brd:
   rgba(255,255,255,.7)`, a **white hairline on a `#fafafa` page**. The
   light-mode twin of the white-on-white text bug. Consolidated to one block
   per side, aliased to tokens.css.

**Over-complicated:**

5. `blocklist_assets/desktop.css` was a wholesale copy of the desktop app's
   stylesheet: window frame, titlebar, window controls, sidebar, nav, hub menu,
   mentor chat, protocols, themes page — none of which any extension page can
   render. **205 lines removed** (652 → 447); the remaining dead selectors are
   listed below.

**Verified clean:** all 15 extension JS files parse; the 634-test suite passes;
no leftover TEMP/FIXME switches.

### Shared UI primitives

`Choice` / `Choices` join `InfoDot` / `Setting` / `SectionCard` in `ui.jsx`.
The "pick exactly one" idea had three implementations — a card grid on
Blocking, a different card grid on Themes, and Choose/Selected buttons in
Settings — so *which one is selected* looked different on each page. All four
pickers (strictness, voice, language, atmosphere) render through it now.
`.strict-choice*` → `.choice*`; `.style-card`/`.style-swatch`/`.style-check`/
`.bg-card*`/`.ut-ico`/`.protocol-num` deleted.

**Use these primitives.** Four pages each inventing their own spacing is how
this got messy in the first place.

---

## Session 1 (2026-07-27) — summary

Full detail is in the git log (`56903f8`…`79c31a9`); the short version:

* **Contrast.** Noir's dark accent *is* `#ffffff` and every accent-filled
  surface hardcoded `color:#fff`. New `--ol-accent-ink` token, wired through
  all three stylesheets. Literal `#fff` now survives only where the background
  is a fixed colour (danger red, warn amber). **Take accent foregrounds from
  `var(--accent-ink)`, never a literal.**
* **Shell.** `BETA` → `ALPHA`; sidebar flattened (no Main/Support headings, AI
  Monitor no longer a top-level destination, `SOS — I need help` → `I need
  help`).
* **Blocking Settings rebuilt.** Strict is the floor; `gentle`/`balanced`/
  `standard` migrate *up*. 10 dead `store.blocking` fields removed — including
  the two block-screen switches Polishing.md asked about, which **were dead**.
  Two "Coming soon" rows were lies (incognito blocking and the settings lock
  are both fully implemented in Rust). AI monitor moved here behind an explicit
  pre-enable consent panel.
* **Force-install — three bugs** (⚠ untested): Edge got only
  `ExtensionInstallForcelist` and silently declined; Chromium watches its
  policy key from *launch*, so a first write on a machine with no prior managed
  browser went unseen until relaunch (`ensure_policy_key()` pre-creates it);
  and `enforce_policy` returned early on *any* existing policy, so an HKCU
  fallback could never be upgraded to HKLM.
* **AI mentor is no longer Anthropic-only.** Seven providers over two wire
  formats, plus Custom/local (no key leaves the machine). **All four safety
  layers are provider-independent and must stay that way** — keep
  `layer_two_short_circuits_for_every_provider` passing when adding a provider.
* **One unified font.** Instrument Serif removed completely; the website
  (separate repo) also lost Space Grotesk and all 48 Google Fonts links.
* **Six dead palettes stripped** (219 lines) — and the real bug behind them:
  extension pages defaulted to `data-style="aurora"` and rendered violet until
  `theme-sync.js` ran.
* **Recovery Program page:** description cut to one line; the warning that
  announced "No AI, no persona, no chatbot" directly above an AI mentor now
  says what is actually true (it is about the *exercises*).

---

## Left to do

Nothing from Polishing.md. Still open from ROADMAP's "Before Alpha":

| # | Item |
|---|---|
| 1 | **Publish to Microsoft Edge Add-ons, then set `EDGE_STORE_EXTENSION_ID`** — the only thing still blocking Edge force-install (session 3) |
| 2 | **Runtime-verify the DNS filter** (see the top of this file) |
| 3 | Arabic review — `locales/ar.js` is a 100%-complete **unreviewed machine draft**; the Companion/Coach split does not survive literal translation |
| 4 | OTA production keys |
| 5 | Pre-Alpha full-scale test |

### Known-dead, deliberately left

25 selectors remain declared-but-unused in `blocklist_assets/desktop.css`
(`chart-line divider ext-* force-ltr ico-back ico-forward pp-range redirect-*
scroll stagger switch time-*`). They are scattered through live sections rather
than sitting in their own blocks, so removing them is a per-rule edit with no
test to catch a mistake. Worth doing next time that file is opened for another
reason.

---

## Working in this repo

**Gates — run all five before committing:**

```sh
node desktop-app/scripts/check-renderer-transpile.mjs   # renderer has no build step
node scripts/ci/check-design-system-sync.mjs            # byte-identical surface copies
node scripts/ci/check-locales.mjs
node extension/tests/run-all.cjs                        # 634 tests, 9 suites
cargo test --manifest-path desktop-app/Cargo.toml --workspace
cargo clippy --manifest-path desktop-app/Cargo.toml --workspace --all-targets -- -D warnings
```

**Design-system edits** must be made in `design-system/` and copied to all three
surfaces, or the sync gate fails. `tokens.css` → renderer + both extension asset
dirs; `strings.js` and `locales/ar.js` → renderer + extension; `tokens.js` →
renderer.

**Two build traps on Windows:**

* `cargo` fails with `PermissionDenied` in `tauri-build` when
  `target/debug/oath-light-host.exe` is locked. It is the **native messaging
  host** — a running browser respawns it the instant you kill it, so
  `npm run free-sidecars` loses the race. Fix: **rename** the running exe
  (allowed on Windows, unlike deleting) and re-run. A bare `cargo test` retry
  often works too, since the lock is transient.
* Source files are a **mix of CRLF and LF**. A patch script matching on `\n`
  silently finds nothing in half of them — detect the file's own ending first
  (`'\r\n' in text`) and build the search string to match.

**If you script an edit, write atomically** — temp file, fsync, `os.replace`.
Opening a source file with mode `"w"` truncates it *before* the write can fail,
which is how `lib.rs` briefly became 0 bytes in session 1.
