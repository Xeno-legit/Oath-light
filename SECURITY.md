# Oath Light — Threat Model & Security Policy

**Audience: developers, auditors, and contributors.** This document is
deliberately *outside* the application. The app itself only ever shows honest,
actionable status — "Protection active", "Extension missing — fix" — and never
an architectural explanation of what each layer defends against or where
coverage is thin (UX Direction §3).

That is not security through obscurity, and this document is the proof: every
limitation below is written down publicly, in full, for anyone who wants it.
It is a *placement* decision. The person Oath Light protects is often reading
the screen at 2am in the exact state of mind the app exists to help with, and a
list of known gaps rendered inside the product at that moment is a menu. Here,
it's documentation.

---

## What Oath Light is, in security terms

Oath Light is a **friction and containment** tool, not an access-control
system. It assumes the user is the legitimate administrator of the machine and
consents to being slowed down by their own earlier decisions. Its adversary is
not an attacker; it is the same person twelve hours later, with less resolve
and full physical access to the computer.

That framing decides everything else:

- **Anything can be defeated with enough determination.** That is expected.
  The goal is to move a relapse from a five-second impulse to a deliberate,
  effortful, *remembered* act.
- **We never claim otherwise.** Copy that overstates protection is a bug, and
  a serious one for a project whose pitch is auditability.
- **Nothing here is a substitute for an OS-level parental control** where a
  genuinely non-consenting subject is involved.

---

## Trust boundaries

| Boundary | Trusted? | Notes |
| :-- | :-- | :-- |
| Rust backend (`src-tauri`) | Yes | Owns all friction state, all settings enforcement, all timers. |
| The webview / renderer | **No** | Any decision that must hold is re-checked in Rust. The dwell timer, every weakening gate, and the uninstall phrase are all enforced backend-side; the UI only displays them. |
| Browser extension | Partly | Enforces filtering in-browser. Cannot be trusted to report its own presence (see "extension removal" below). |
| `app_data_dir` files | **No** | Plain user-writable JSON. See "known limitations". |
| Network | N/A | There is no server. No telemetry, no accounts, no remote config. |

The single most important rule in the codebase: **strengthening a protection is
instant; weakening one goes through `friction.rs`.** Every command that
weakens anything registers a pending change and only applies after the cool-off
elapses. A renderer-supplied value must never be able to shortcut that — which
is why, for example, Serious Mode's flag lives in `settings.rs` and is injected
into extension pushes by the backend rather than passed up from the UI.

---

## Layers, and what each one actually covers

1. **Extension filtering** (MV3, Chrome + Firefox) — the precision layer.
   Blacklist, 41-language hostname keyword engine, per-item graylist stripping,
   SafeSearch enforcement, lockdown allowlisting, and (Strict preset and above)
   the URL path/query keyword layer. Only covers browsers where it is
   installed and enabled.
2. **Force-install policy** (`browsers.rs`) — writes `ExtensionInstallForcelist`
   / Firefox `ExtensionSettings` so the extension cannot simply be toggled off.
   Requires the extension to exist in a store, which it now does.
3. **System DNS filter** (`dns/`) — a local filtering resolver, covering
   everything on the machine, not just browsers. Coarse by nature: it can
   answer "is this whole domain allowed", never "strip this one item".
4. **DoH/DoT defense** — browser policy keys disabling built-in DNS-over-HTTPS,
   plus resolver-level blocking of well-known DoH endpoints.
5. **Process blocking + unrecognised-browser detection** (`watchdog.rs`).
6. **On-device AI screen monitor** — SigLIP Image-Guard + NudeNet ensemble,
   escalating on persistence across frames, never a single frame. Its only
   actuators are a fullscreen overlay and opening the user's configured
   redirect. It has, by design, **no irreversible actuator**.
7. **Friction + tamper-evidence** — `friction.rs` (cool-offs, clock-tamper
   immunity), `auth.rs` (master password), `eventlog.rs` (hash-chained local
   log), lockdown, Serious Mode.

---

## Known limitations

Written plainly, because a limitation you know about is a design input and one
you don't is a liability.

### Clock and timer tampering
Friction credits elapsed time against a **monotonic** boot counter
(`GetTickCount64`), not the wall clock, so setting the system clock forward
does not advance a cool-off. Anomalous forward jumps are recorded as
`clock_anomaly` events in the tamper-evident log.

Residual: on non-Windows builds the monotonic anchor is process-lifetime only
(documented in `friction.rs`), so credited progress is lost across a restart
there. Oath Light is Windows-first.

### `uninstall.json` is user-writable
The watchdog and the separate `guardian` process independently verify the
uninstall cool-off by reading `uninstall.json` off disk. A user who understands
the internals can hand-edit or backdate `requested_at`. Accepted: this raises
the bar from "create one empty file" to "read the source and edit two files",
which is the intended level of friction, not a security guarantee.

### Safe Mode
Autostart is registered twice — an HKCU `Run` value **and** a logon Scheduled
Task (plan 4.6) — so deleting one leaves the other, and the next launch
re-asserts the missing one. Neither runs in Windows **Safe Mode**. Covering
Safe Mode would require a service registered under the `SafeBoot` keys, which
needs elevation and is not currently implemented. **This is a real gap.**

### Extension removal
A removed extension is detected by the desktop app and (if a trusted contact is
configured) reported after a debounce. But between removal and detection there
is a window where a browser is unfiltered, and the DNS layer — if enabled — is
what covers it. With DNS filtering off, that window is genuinely open.

### The AI monitor
95.8% residual accuracy means false positives and false negatives both happen.
Escalation requires persistence across frames, which suppresses most single-frame
noise. It samples on a poll, so brief content between polls can be missed
entirely. It is a backstop, never the primary filter.

### Everything below the app
Oath Light runs as a normal user program. A second OS account, a live USB, a
phone, or another computer are all completely outside its reach. Nothing in the
architecture pretends otherwise.

---

## Privacy

- **No telemetry. No accounts. No server.** There is no code path in this
  repository that uploads user data anywhere.
- The AI monitor's frames **never leave the machine** and are never written to
  disk. The false-positive eval log (2.4) stores scores and a non-reversible
  FNV digest of the frame, never the frame.
- The tamper-evident event log records *that* events happened, never browsing
  content, URLs, or screenshots.
- Trusted-contact notifications carry the event kind and the user's name.
  Nothing else — no history, no screenshots, no scores.
- OTA blocklist updates are fetched from GitHub release assets and verified
  against a baked Ed25519 public key. Fetching sends nothing but an HTTP GET.

---

## Reporting a vulnerability

Open a GitHub issue for anything that is not itself a working bypass recipe.
For a bypass, see **[BYPASSES.md](BYPASSES.md)** — bypasses are handled in the
open, on purpose.

For something genuinely sensitive (a way to make Oath Light damage a user's
system, exfiltrate data, or escalate privileges) email the maintainer rather
than filing publicly, and expect a fix before disclosure.
