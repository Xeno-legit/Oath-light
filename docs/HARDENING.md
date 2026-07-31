# Tamper resistance — where it actually stands

An honest account of what stops removal today, what doesn't, and what would.
Written after an audit on 2026-07-31 that started from a real broken install and
ended with most of the enforcement model failing open.

This document exists because a protection you believe in but don't have is worse
than one you know you're missing. It started as the list of claims
[SECURITY.md](../SECURITY.md) was making that the code did not keep; that
particular gap is closed, and this is now the place the honest version lives.

---

## The constraint everything else follows from

**Every Oath Light process runs as the user it is protecting against.** The app,
the guardian, the native host — all of them run under the interactive user's
token, and the state they depend on (`HKCU\Software\Policies\...`, the Run key,
the app-data directory) is owned by that same user.

That is not a bug in any one function. It is the shape of the whole system, and
it means the operating system will faithfully help the user dismantle it. No
amount of mutex cleverness changes that: the dual-process watchdog is
well-built, and `taskkill /F /IM app.exe /IM oathlightguard.exe` — one command,
no elevation — ends it, because [watchdog.rs:27-29](../desktop-app/src-tauri/src/watchdog.rs#L27-L29)
correctly notes that a two-process scheme cannot survive both halves dying
inside one poll interval.

### What actually stops what, today

| Removal path | Needs admin? | Needs internals knowledge? | Stopped? |
| :-- | :-- | :-- | :-- |
| Settings → Apps → Uninstall | UAC only | none | **yes** (see below) |
| `taskkill` both processes in one command | **no** | process names, visible in Task Manager | no |
| Delete the HKCU Run value | **no** | none | no |
| Delete `HKCU\SOFTWARE\Policies\Google\Chrome` | **no** | none | no — all browser enforcement |
| Delete the install directory | yes | none | no |
| Safe Mode | no | none | no |
| Rebuild from source | no | yes | out of scope, deliberately ([BYPASSES.md](../BYPASSES.md)) |

Only the first row is closed. The knowledge barrier on the rest is effectively
zero and is not coming back — the repo is public by choice, the process names
are in Task Manager, and any competent assistant will produce a working recipe
on request. **Knowledge barriers are finished. Only privilege barriers work
now.**

---

## Fixed on 2026-07-31

### The uninstaller no longer walks around the friction system

The 24-hour cool-off guarded exactly one door — the in-app "Remove Oath Light"
button — while Settings → Apps → Uninstall went straight past it. Worse, it
half-succeeded, and the half it completed was the destructive half:

- `CheckIfAppIsRunning "${MAINBINARYNAME}.exe"` (generated `installer.nsi:751`)
  knows nothing about `oathlightguard.exe`. The uninstaller killed the app; the
  guardian resurrected it seconds later; the resurrected app re-registered its
  Run key and policies.
- NSIS `Delete` on the now-relocked executables failed **silently** — `Delete`
  only sets an error flag, which the template never checks.
- `Delete "$INSTDIR\uninstall.exe"` and the Add/Remove Programs `DeleteRegKey`
  had nothing holding them open, so those succeeded.

Net result: an install with no uninstaller, no Add/Remove Programs entry, and
every protection still running — **unremovable by any supported path.** Of the
three possible outcomes, this is the only one that serves nobody:

| Outcome | Verdict |
| :-- | :-- |
| Refuse, touch nothing | protection working as designed |
| Remove completely | the feature working as designed |
| Remove the uninstaller, keep the app | no supported removal path left |

The fix is `installer/hooks.nsh` plus [`cli.rs`](../desktop-app/src-tauri/src/cli.rs),
enforcing one rule: **the uninstaller is all-or-nothing.** `NSIS_HOOK_PREUNINSTALL`
is the first statement in `Section Uninstall`, before any `Delete`, so a refusal
genuinely changes nothing. The decision lives in Rust (`friction::FrictionStore`
stays the single source of truth); the installer only reads an exit code.

One deliberate trade-off is recorded in `Decision::Unknown`: an install with no
readable friction state resolves to **allow**. Refusing there would recreate the
unremovable install this work exists to eliminate — punishing the person whose
install broke, while barely inconveniencing anyone deliberately routing around
the timer.

### …and the gate then had to learn what an upgrade is

Closing the uninstaller closed upgrades with it. Installing a newer build over
an older one runs the *old* `uninstall.exe` first — `PageLeaveReinstall` →
`reinst_uninstall`, and it is the default-selected radio on the reinstall page.
To a gate that can only see "someone is uninstalling", that is indistinguishable
from Settings → Apps. A blocker nobody can patch is its own security bug.

The obvious fix is wrong. Honoring the installer's `/UPDATE` flag would make
`uninstall.exe /UPDATE` a one-word, no-elevation bypass of the entire cool-off —
precisely the kind of knowledge barrier this document says is finished. It also
would not have worked: `$UpdateMode` is only raised when the *parent installer*
was itself launched with `/UPDATE`, and in that case `PageLeaveReinstall` returns
at its own update check (`installer.nsi:310-312`) without ever running the old
uninstaller. The `/UPDATE` append two lines further down is unreachable on the
non-Wix path.

What authorizes an upgrade instead is an **active update window** — the existing
`update.json` mechanism, opened from inside the app behind the master password,
capped at fifteen minutes, re-validated on every read, written to the event log,
and backed by a recovery task that restarts the app if the update never happens.

This costs the user nothing they were not already paying. An upgrade *cannot*
complete without an update window, because both binaries are running and locked
until the watchdog stands down, and the window is the only thing that stands it
down. Anyone who could ever have finished an upgrade already had one open.

So the uninstaller now answers four ways, in three shapes:

| Exit | Meaning | Files | Machine state |
| :-- | :-- | :-- | :-- |
| `0` ALLOW | cool-off elapsed — a real removal | deleted | fully reversed |
| `1` BLOCK | refuse | untouched | untouched |
| `2` UNKNOWN | unreadable state on a broken install | deleted | fully reversed |
| `3` UPGRADE | update window open | deleted | **untouched** |

`Decision::Upgrade` is deliberately the one case where `may_proceed()` and
`tears_down()` disagree. On that path the hook skips the teardown *and* the
entire post-uninstall sweep, so browser policy, DNS, both autostart
registrations, the recovery task and the app's data all survive the gap between
the two installs — and it forces the uninstaller's "Delete app data" checkbox
off, which would otherwise let a mid-*update* confirmation page silently destroy
the settings, streak and hash-chained event log the user was trying to keep.

An elapsed removal request still outranks an open window: someone who asked to
remove, and waited, gets the removal they asked for rather than a files-only
upgrade that would strand policy and DNS on a machine with no app left to manage
them.

### A shell-var context left flipped, found while re-reading the hook

Reading the friction state requires `SetShellVarContext current` — a perMachine
uninstaller runs with the "all users" context, and `$APPDATA` under it names the
wrong profile entirely. The context is process-wide and sticky, and the first
version of the hook set it and never put it back.

Between the pre-uninstall hook and the template's own app-data cleanup sit the
shortcut deletes, which resolve `$SMPROGRAMS` and `$DESKTOP` against whatever
context is current. A perMachine install put those shortcuts in the all-users
locations, so they would have silently failed to match: a completed uninstall,
with a Start Menu and desktop still full of shortcuts to a deleted exe. Now
`OL_ResolveAppData` restores the context through the template's own `SetContext`
before returning.

### Autostart worked on zero machines

`schtasks.exe /create` refuses to create any task from an unelevated process. It
returns `ERROR: Access is denied` regardless of flags, including with an explicit
`/ru <current user> /it`. Verified empirically on Windows 11 26200, not inferred.

The app runs unelevated, so `register_logon_task` could only ever take its
failure branch. The 4.6 "double-registration" was a single registration on every
user's machine since it shipped, and the only backstop behind the watchdog was
an HKCU Run value deletable in four seconds.

Now uses `Register-ScheduledTask` (Task Scheduler COM), which succeeds
unelevated for a task scoped to the current user. Battery flags are set
deliberately — the defaults refuse to start on battery and stop the task when a
laptop unplugs, which would have made autostart conditional on the charger being
plugged in.

---

## What would actually raise the bar

Ranked by leverage per unit of work.

### 1. A standard (non-admin) user account — free, and the largest single gain

Every barrier below is one an administrator already holds the keys to. If the
protected account is a standard user, and a separate admin account exists whose
password the user does not hold (a partner sets it; it goes in a sealed
envelope), then a LocalSystem service becomes effectively absolute *for that
user*: no stopping services, no HKLM writes, no taking ownership, nothing
meaningful available in Safe Mode either.

This is the only measure that makes an AI-assisted bypass hit a wall. The
instructions still work — they just end at "enter the administrator password."

It is an onboarding decision, not a code change, and it belongs in setup.

### 2. A LocalSystem service

Installed once with admin (the installer is already `perMachine`, so elevation
is in hand). Moves three rows of the table above from "no admin" to "needs
admin": killing the processes, deleting the binaries, and — with HKLM policies
plus ACLs on the install directory — clearing the browser enforcement.

### 3. Safe Mode is closeable, contrary to the current comment

[watchdog.rs:533-538](../desktop-app/src-tauri/src/watchdog.rs#L533-L538) records
Safe Mode as an accepted permanent gap because covering it "would need a service
registered under the `SafeBoot` keys, which requires elevation." The elevation is
already there at install time. Writing the service under
`HKLM\SYSTEM\CurrentControlSet\Control\SafeBoot\Minimal\<service>` and
`...\Network\<service>` starts it in Safe Mode. This gap is documented as
permanent and is not.

### 4. Reconciliation, not just prevention

A SYSTEM-side loop that re-asserts policy, registry and autostart state within
seconds of it being cleared. This converts a successful bypass into a
*temporary* one, and it is the direct application of a principle the project
already holds: a protection that can fail needs a retry loop, not a toggle.

### 5. Tamper alerting — the actual state of the art

Removal cannot be made impossible. It can be made **witnessed**. The
trusted-contact infrastructure already exists; firing an alert the moment
protections come down is a small extension of it.

This is most of what Covenant Eyes and Accountable2You actually sell, and the
reason is sound: the thing that stops someone at 2am is not cryptography, it is
knowing that a specific person will find out. Combined with reconciliation,
tampering becomes temporary *and* reported, rather than permanent and private.

---

## Ruled out, and why

| Option | Verdict |
| :-- | :-- |
| **Protected Process Light** — even SYSTEM cannot terminate it | Requires an ELAM anti-malware certificate from Microsoft, which requires being a registered AV vendor. Not available. |
| **Kernel minifilter driver** — deny deletion and process termination in-kernel | Technically real. Costs an EV certificate plus attestation signing, and brings BSOD risk, a large new security surface, and AV vendors flagging the behaviour as malware-like. Not worth it for this product. |
| **Signed WDAC policy in UEFI** | Genuinely survives a local admin. Also capable of bricking machines and blocking unrelated software. Wrong tool for a consumer app. |
| **MDM enrollment** | A local admin can generally unenroll on Windows. Far weaker than macOS supervision. |
| **Full-disk encryption to prevent offline registry edits** | Does not stop the machine's own owner, who can boot it normally. |

---

## The honest ceiling

**Nothing survives a determined local administrator forever.** Safe Mode, an
offline registry edit, a USB boot, or a rebuild from source all win eventually,
and the last of those is explicitly out of scope by choice.

That was always the wrong win condition. The right one:

> Removal must be slow, deliberate, visible, and — if it is to hold — not solely
> your own decision at the moment you most want it gone.

A standard account, a SYSTEM service, reconciliation, and tamper alerts reach
that. It is not a consolation prize for failing to be unbreakable; it is the
design.

---

## Open items

- [x] **Upgrade path regression (blocking).** Fixed — see "…and the gate then
      had to learn what an upgrade is" above. Note that the fix originally
      proposed here (skip the gate when `$UpdateMode = 1`) was the wrong one on
      both counts: it would have made `/UPDATE` a bypass, and that flag is not
      set on the path that actually runs the old uninstaller.
- [x] **The MSI bundle is ungated.** Fixed by dropping the target:
      `bundle.targets` is now `["nsis"]`. `installerHooks` is NSIS-only, so an
      MSI-installed copy removed with no friction at all via `msiexec /x` or
      Settings — a second, completely unguarded front door shipped alongside the
      guarded one. Nothing consumed the MSI (no CI job, no download link, no
      docs), so there was no reason to keep it and gate it with a WiX custom
      action. **Delete the stale `target/release/bundle/msi/*.msi` artifacts
      before the next release** — they are unguarded builds sitting in a
      directory a release script could pick up.
- [x] **SECURITY.md line 16-19 overclaimed.** Fixed. "No off switch at all"
      is now "no off switch anywhere in the app", and a new section says plainly
      what the tamper resistance does and does not hold against — including that
      declining the setup elevation prompt puts browser policy in the user's own
      hive, where it comes off without a prompt.
- [ ] Register the browser policies under HKLM rather than HKCU (depends on the
      service). Partially there already: `enforce_policy` tries HKLM first and
      only falls back to HKCU when it is refused, so what is actually missing is
      making the elevated path the *reliable* one rather than a lucky outcome of
      the setup prompt.
- [ ] ACL the install directory to deny delete to the interactive user.
- [ ] **Verify the gate on a real machine.** Everything above is verified as far
      as static checking goes — the hooks assemble under `makensis`, the Rust
      decision table is unit-tested — but the end-to-end paths (Settings → Apps
      refuses and changes nothing; an in-app removal still completes; a genuine
      upgrade with a window open keeps policy, DNS and autostart) have not been
      run against an installed build. Do that before shipping 0.5.0.
