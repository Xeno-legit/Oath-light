# Oath Light — Security & Privacy

What the app does, what it touches on your machine, and what it never does.

---

## What Oath Light does

* Blocks known adult domains from a curated list of 385,597 entries.
* Blocks unlisted adult domains by reading the domain name itself, in 41 languages.
* Strips NSFW items out of mixed platforms (Reddit, X, Pixiv and 32 more) using each platform's own labels.
* Forces SafeSearch on and blocks explicit searches.
* Unwraps proxies, translators and archive viewers, then checks the real destination.
* Filters at the system DNS level, so it covers every app, not only browsers.
* Watches the screen with on-device AI and covers what it finds.
* Holds its core protections on — the uninstall guard, SafeSearch, YouTube
  Restricted Mode, the extension requirement and the system DNS filter have no
  off switch anywhere in the app. Settings that *are* choices wait out a
  cool-off before they weaken.
* Keeps itself installed and running through a watchdog and browser policy.
  Removal goes through the app and its cool-off; Windows' own Uninstall entry
  refuses. What that is **not** is unremovable — see below.

## What it installs and runs

Everything below is on your machine. Nothing is hosted anywhere.

| What | Where | Why |
| :-- | :-- | :-- |
| Desktop app + guardian process | Program folder, autostart | Runs the protections and keeps them running |
| Native messaging host | Registered per browser | Lets the extension and the app talk locally |
| Browser policy keys | Windows registry | Keeps the extension installed and SafeSearch on |
| Local DNS resolver | 127.0.0.1, always on | System-wide domain filtering |
| Settings and logs | App data folder | Your settings, streak, and event history |

Some of this needs administrator rights once, at setup. That is used to write
browser policy, point this machine's DNS at the local resolver, and register
autostart — nothing else. Decline it and the app still runs: the browser stays
protected, and the DNS layer keeps asking until you allow it.

## Permissions, and what they are for

| Browser permission | Used for | Never used for |
| :-- | :-- | :-- |
| `<all_urls>` | Checking the hostname of a page against the local blocklist | Reading, storing or sending page content |
| `webNavigation` | Catching a navigation before the page loads | Recording where you went |
| `tabs` | Sending a blocked tab to the block page | Building browsing history |
| `cookies` | Setting a site's own "no adult content" preference | Reading cookies for anything else |
| `declarativeNetRequest` | Enforcing SafeSearch and Restricted Mode | Inspecting your traffic |
| `storage` / `unlimitedStorage` | Holding your settings and the blocklists | Anything leaving the device |
| `nativeMessaging` | Talking to the desktop app on the same machine | Any remote connection |
| `alarms` | Blocklist update checks and reminders | Tracking |

## What it never does

* **No telemetry.** No analytics, no crash reports, no usage data. No code path
  in this repository sends anything about you anywhere on its own. The only
  outbound traffic is the three things listed below, and each needs either a
  release to exist or a setting you turned on yourself.
* **No accounts. No server.** Nothing to sign into, nothing stored off-device.
* **The AI never sends a picture anywhere.** Frames are scored in memory and
  discarded. They are never uploaded and never written to disk.
* **The event log records that something happened, never what you looked at.**
  No URLs, no page content, no screenshots.
* **Trusted-contact alerts carry an event and your name. Nothing else.** Not
  history, not screenshots, not scores.
* **Blocklist updates are a plain download.** A signed file is fetched from
  GitHub and checked against a key built into the app. The request sends nothing
  about you.
* **The optional AI mentor talks to your provider, under your key.** The project
  never sees, stores or relays a message. It is off until you add a key, the
  conversation is never written to disk, and it is a separate surface from the
  guided exercises — those stay entirely on-device, as they always were.
* **The mentor cannot weaken anything, by construction.** It has no tools and no
  route to any protection command, so it could not disable the filter even if it
  were talked into trying. On top of that, a request to turn protection off is
  answered locally and never reaches the API, and any reply naming a blocked
  site is discarded before you see it.

## How the enforcement is built

* Every protection is enforced in the Rust backend. The interface only displays
  what the backend decides — it cannot grant itself anything.
* Turning a protection **on** is instant. Turning one **off** files a request
  and waits out the cool-off, and the app stays fully protective the whole time.
* Cool-offs are counted against the system's own uptime counter, not the clock,
  so the clock is not part of the equation.
* Protective events are written to a hash-chained local log, so the history is
  verifiable and cannot be quietly rewritten.
* The AI has no irreversible action available to it. It can cover the screen and
  open your redirect. That is all it can do.

## What the tamper resistance actually holds against

Straight, because a protection you believe in but don't have is worse than one
you know you're missing.

**It holds** the doors an ordinary moment of wanting it gone goes through:
Settings → Apps → Uninstall is refused outright, closing the app doesn't stop
it (two processes watch each other), and every weakening setting waits out a
cool-off with protection fully on the whole time.

**It does not hold** against an administrator on this machine who sets out to
remove it. Every Oath Light process runs as the user it is protecting, so the
operating system will help. In particular: if you decline the one-time
administrator prompt at setup, browser policy is written to your own user hive,
where it comes off without a prompt — accepting that prompt writes it
machine-wide instead, which is the stronger of the two.

[docs/HARDENING.md](docs/HARDENING.md) is the unvarnished version: what stops
what today, what doesn't, and what is being built next. If you want the strong
form of this, the single biggest step is making the protected account a
standard (non-admin) user, with the administrator password held by someone else.

## This has never been red-teamed, and it needs to be

**No independent adversarial security review has been done on Oath Light. Not a
partial one, not an informal one. Zero.** Version 1.0.0 is the first public
build, and the app still carries an *Early release* badge for exactly this
reason.

Everything on this page describing what the tamper resistance holds against is
the authors' own assessment of their own code. That is the weakest possible
form of evidence about a system whose entire job is resisting a motivated
attacker — and the motivated attacker here is unusually well-placed: they own
the machine, they have all the time they want, they can read this source, and on
a bad night they are strongly motivated. Self-assessment is precisely the thing
that misses what someone like that finds in an afternoon.

Concretely, this is what a red team is needed on:

* The friction and cool-off engine (`friction.rs`, `uninstall.rs`) — the clock
  handling, the on-disk state, and every way to make a timer credit time it
  should not.
* The two-process watchdog (`watchdog.rs`, `guardian/`) — the resurrection
  protocol, the update/uninstall stand-down windows, and the sentinel files
  that authorize them.
* The master password and session tokens (`auth.rs`).
* Browser enforcement (`browsers.rs`, `browser_lock.rs`) and the profile
  surgery in `profiles.rs`, which writes to browser preference files.
* The OTA blocklist channel (`ota.rs`, `core/src/ota.rs`) — signature
  verification, rollback and monotonicity.
* The uninstall gate in the NSIS hooks (`desktop-app/installer/hooks.nsh`).

Until that work happens, treat every strength claim here as **unverified by
anyone but us**, and treat the app as one layer among several rather than the
thing standing between you and a relapse. If you have the skills to do this
review, it is the single most valuable contribution the project can receive
right now — see *Reporting a security issue* below.

## Scope

Oath Light protects the machine it is installed on, for the person who chose to
install it. It is not a parental-control suite and not a substitute for one
where a non-consenting subject is involved.

## Reporting a security issue

If you find something that could make Oath Light damage a system, expose data,
or escalate privileges, email the maintainer rather than filing publicly, and
expect a fix before disclosure.

For a filtering miss or a false positive, see [BYPASSES.md](BYPASSES.md).
