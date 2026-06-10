# Pure Path
Master plan  

 Pure path is an anti-addiction software that is designed specifically for fighting Pornography and the fast spreading virus of such disgusting and shameful acts regardless. The app should go under 4-7 stages of development.

The First 3 stages are beta stages, then the rest is Alpha stages

Until every stage is complete or before it by one stage.

## Phase 1: (Complete)

▶ Phase 1 was about the extension we got it working, but it had a ton of false positives.

* Extension skeleton.
* Domain and keyword blocking.
* only 1,104 domains were blocked. (There was most likely a ton of dead sites)

## Phase 2: (Complete)

▶ Phase 2 was about the desktop app. due to false positives with P.1 The entire Blocking logic had to be remastered.

* Removed keyword Blocking except on some sites (like Reddit)
* 500k+ active domains blocked
* Desktop app skeleton
* Domain blocking logic (for Desktop) remaster.
* Domain-name keyword layer (catches unlisted sites like sex4arabs.com)
  (Deterministic, NOT score-based. Matches strong stems — sex, porn, xxx, etc. — only against the
   registrable domain label/eTLD+1, never paths/queries/page content, so no Scunthorpe false positives.
   Runs only after the exact list misses; guarded by a small collision-exception list — essex, analytics, etc.)
* Bypass-vector blocking (anti-bypass)
  (Blocks content-bypass routes: web proxies/unblockers (proxysite, 12ft.io), translate & archive
   wrappers, raw-IP navigation. Principle "unwrap then re-check" — pull the real target out of the
   wrapper and run it through the normal pipeline, so legit translation/archiving survives but a
   blocked site viewed through them is still caught. Private IP ranges exempt. DNS/DoH bypass
   deferred — not doing DNS yet.)

## Phase 3: (In Progress)

▶ Phase 3 should focus more on the vibe and establishing proper cross browser integration.

* Theme unison (almost done)
* Desktop app UI, UX remake (done)
* Fixing cross browser issues.
* Blocking speed optimization.
* Useful advices and protocols
* Graylist V2 — API/network-layer interception (replaces fragile CSS UI-hiding)
  (Instead of hiding each site's filter UI, intercept the JSON the site fetches and strip the items
   the SITE ITSELF already labelled NSFW — reddit over_18, X possibly_sensitive, pixiv xRestrict,
   mastodon sensitive, bluesky labels, booru rating, etc. Ground-truth, not a heuristic; survives UI
   redesigns because API fields stay stable. Needs a MAIN-world injected script to patch fetch/XHR.
   Sites with no per-item label — file hosts, chat, video-chat, shorteners — get whole-site block instead.)

## Phase 4:

▶ Phase 4 is undeniably the most important, Because it focuses more on The Friction systems and the watchdog system.

* 48-hour uninstall request
  (After the 48 hours you can: Reset the timer, Cancel, Remove completely)
* Watchdog system (a secondary app will be present and it will monitor the main app, making sure the app stays working and the main app will be monitoring it).
* extension monitoring
* optional Ai monitoring

## Phase 5:

▶ Phase 5 will focus on phones, Pure path will come to android only with an integrated Ai to see and monitor the user screen.

* Phone support
* built-in ai scanner
* Access to permissions to prevent app deletion at weak moments
* Pre-Alpha launch test. (Testing everything again at full scale, pushing the app to its absolute limits.)
* Alpha launch.

## Phase 6:

▶ Phase 6 will now be compatable with multiple languages, going from most popular and least complex languages to less popular languages.

* Domains expansion
* Multi-language support
* Pure path unique website.
* Donation booth

## Phase 7:

▶ Phase 7 is just a constant bug monitoring and app improvement stage.

- However there are plans for pure path Plus (islamic sections added)
                                         (Also not Paid)
