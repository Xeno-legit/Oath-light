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
* Holds protections on: turning one off waits out a cool-off period.
* Keeps itself installed and running through a watchdog and browser policy.

## What it installs and runs

Everything below is on your machine. Nothing is hosted anywhere.

| What | Where | Why |
| :-- | :-- | :-- |
| Desktop app + guardian process | Program folder, autostart | Runs the protections and keeps them running |
| Native messaging host | Registered per browser | Lets the extension and the app talk locally |
| Browser policy keys | Windows registry | Keeps the extension installed and SafeSearch on |
| Local DNS resolver | 127.0.0.1, opt-in | System-wide domain filtering |
| Settings and logs | App data folder | Your settings, streak, and event history |

Some of this needs administrator rights once, at setup. That is used to write
browser policy and register autostart — nothing else.

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

## Scope

Oath Light protects the machine it is installed on, for the person who chose to
install it. It is not a parental-control suite and not a substitute for one
where a non-consenting subject is involved.

## Reporting a security issue

If you find something that could make Oath Light damage a system, expose data,
or escalate privileges, email the maintainer rather than filing publicly, and
expect a fix before disclosure.

For a filtering miss or a false positive, see [BYPASSES.md](BYPASSES.md).
