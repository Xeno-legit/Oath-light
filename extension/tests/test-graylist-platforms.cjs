// extension/tests/test-graylist-platforms.cjs — the rename canary for the
// graylist's API tier.
//
// WHY THIS EXISTS
// ---------------
// Per-item label stripping is the feature no competitor has, and until now the
// only thing standing between it and silent death was that nobody had changed a
// field name yet. If Reddit renames `over_18`, or Mangadex `contentRating`, the
// stripper keeps running, keeps reporting nothing wrong, and quietly stops
// filtering — on the one surface users trust most.
//
// Every fixture in fixtures/platforms/ is a LIVE capture from that platform's
// public API. Each holds real clean items plus a flagged item, and this suite
// drives the REAL interceptor over it and asserts the flagged one is removed and
// the clean ones are byte-identical afterwards. A renamed field fails here.
//
// `flaggedAreDerived: true` in a fixture means the public endpoint would only
// serve SFW items, so the flagged one is a real item with ONLY the label field
// flipped. The rename canary still holds either way, because the field name is
// asserted present in the live clean capture — that assertion is what actually
// catches a rename.
//
// NOT COVERED HERE, and deliberately so:
//   • Reddit, Danbooru, Gelbooru — Cloudflare-blocked to non-browser clients from
//     this network; capturing them needs a browser session.
//   • X, Tumblr, Pixiv (R-18), Patreon, NexusMods, Imgur, Flickr, Vimeo, 500px,
//     Minds, Gumroad, Odysee, ArtStation — auth-walled or key-walled public APIs.
//   • The 10 DOM-tier platforms — they have no JSON feed at all; covering them
//     needs HTML fixtures through content.js, which is a different harness.
// Twitch and Kick have their own suite (test-graylist-inject.cjs) because they
// also exercise the channel-page block.
'use strict';
const fs = require('fs');
const path = require('path');
const { createRunner } = require('./_assert.cjs');
const { makeSandbox, through, at } = require('./_graylist-sandbox.cjs');

const FIX_DIR = path.join(__dirname, 'fixtures', 'platforms');

function loadFixtures() {
  if (!fs.existsSync(FIX_DIR)) return [];
  return fs.readdirSync(FIX_DIR)
    .filter((f) => /^graylist-.*\.json$/.test(f))
    .sort()
    .map((f) => ({ file: f, data: JSON.parse(fs.readFileSync(path.join(FIX_DIR, f), 'utf8')) }));
}

async function run() {
  const t = createRunner('graylist-platforms');
  const fixtures = loadFixtures();

  // An empty fixture directory must not read as a green suite — that is exactly
  // how this protection would rot back to nothing.
  t.ok(fixtures.length >= 10,
    `fixture set is present (${fixtures.length} platforms)`,
    'expected at least 10 platform fixtures in fixtures/platforms/');

  for (const { file, data } of fixtures) {
    const m = data._meta || {};
    const label = m.platform || file;

    // 1. Rename canary. The field the signal keys on must still appear in the
    //    live-captured payload. This is the assertion that actually catches a
    //    platform renaming its label out from under us.
    const raw = JSON.stringify(data.payload);
    t.ok(raw.includes(`"${m.field}"`),
      `${label}: live capture still carries "${m.field}"`,
      `field absent from ${file} — either the capture is stale or the platform renamed it`);

    // 2. The stripper removes the flagged items and leaves the clean ones alone.
    const ctx = makeSandbox('https://example.org/');
    const out = await through(ctx, m.url, data.payload);

    const before = at(data.payload, m.itemsPath);
    const after = at(out, m.itemsPath);

    t.ok(Array.isArray(after), `${label}: response shape survives scrubbing`, `itemsPath "${m.itemsPath}" did not resolve to an array`);
    if (!Array.isArray(after) || !Array.isArray(before)) continue;

    t.equal(after.length, data.expect.kept, `${label}: ${data.expect.removed} flagged item(s) stripped, ${data.expect.kept} kept`);

    // 3. The survivors must be the clean ones, untouched — not merely the right
    //    count. Fixtures are built clean-first, so the kept prefix is the answer.
    const expectKept = JSON.stringify(before.slice(0, data.expect.kept));
    t.equal(JSON.stringify(after), expectKept, `${label}: kept items are byte-identical to the clean capture`);
  }

  // Every fixture must declare the provenance of its flagged item, so "live" and
  // "derived" can never blur together as the set grows.
  for (const { file, data } of fixtures) {
    t.ok(typeof (data._meta || {}).flaggedAreDerived === 'boolean',
      `${(data._meta || {}).platform || file}: declares whether its flagged item is live or derived`);
  }

  return t.summary();
}

module.exports = { run };
