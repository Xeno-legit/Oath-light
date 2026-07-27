# Break Oath Light — the standing bypass challenge

**Plan item 6.3.** Every blocker has bypasses. The difference is whether they
are discovered by the vendor, by the internet, or by the user at 2am — and
which of those three the project finds out about.

Oath Light is open source, so a bypass list is going to exist whether or not we
write one. This is the version we write: public, credited, and wired straight
into the test suite so a hole reported once stays closed forever.

---

## What counts

**In scope** — anything that makes Oath Light fail at its job:

- A URL, domain, or platform surface that reaches NSFW content without being
  blocked or filtered (the largest and most useful category by far).
- A way to disable, unload, or starve any protection **without** going through
  its friction delay.
- A way to make a cool-off elapse faster than real time.
- A way to make the extension look present when it isn't, or the app look
  protected when it isn't.
- A false positive that blocks something genuinely innocent — these matter just
  as much. A filter people have to turn off is a filter that protects nobody.

**Out of scope** — not bugs, by design (see [SECURITY.md](SECURITY.md)):

- "I used a different computer / phone / OS account." Yes. Nothing in the
  architecture claims otherwise.
- "I uninstalled it after waiting 24 hours." That is the feature working.
- "I edited the source and rebuilt it." You are the administrator of your
  machine; that was never in question.
- "Safe Mode." Already documented as a real, known gap — see SECURITY.md.
  Reports that *close* it are extremely welcome; reports that *observe* it are
  already known.

---

## How to report

Open a GitHub issue titled `bypass: <one line>`, with:

1. **The recipe.** Exact steps, exact URL shapes (a `example.com/<path>` shape
   is fine — no need to link the actual content).
2. **Which layer it defeats** — extension, DNS, friction, AI monitor, or the
   app itself.
3. **What you expected instead.**

Say so if you would rather not be credited by name. Otherwise contributors are
listed in the hall of fame below by GitHub handle.

There is no cash bounty. There is credit, a fixed hole, and a permanent
regression test with your name on the commit.

---

## What happens next

Every accepted report gets:

1. **A regression test first**, in `extension/tests/` (JS layers) or a Rust
   `#[test]` (backend layers) — failing, before any fix. The adversarial suite
   (`test-adversarial.cjs`) already exists precisely for this; new cases join
   it rather than living somewhere separate.
2. **The fix**, in the same PR as the test.
3. **A row in the table below**, kept even after the fix. A hall of fame that
   quietly deletes fixed entries teaches nobody anything.

---

## Hall of fame

| # | Reported by | Layer | Summary | Status | Regression test |
| :-- | :-- | :-- | :-- | :-- | :-- |
| — | — | — | *No community reports yet. Be the first.* | — | — |

### Found internally

The adversarial audit rounds that predate this file are not written up
separately — their findings are pinned permanently by the 600+ cases in
`extension/tests/`, which is the only record that can't go stale. Listed here
for completeness; the table above is for community reports.
