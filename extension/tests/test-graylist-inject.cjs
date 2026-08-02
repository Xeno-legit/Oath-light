// extension/tests/test-graylist-inject.cjs — the first test that actually loads
// graylist-inject.js.
//
// WHY THIS EXISTS
// ---------------
// The per-item stripper is the most differentiated thing in the product and had
// zero coverage: nothing in this directory loaded the file, and none of the label
// field names appeared anywhere in the suite. The risk was never "it's broken
// today" — it's that a platform renames a JSON field and the filter goes SILENTLY
// dead, still installed, still reporting nothing wrong, on the one feature no
// competitor has.
//
// So these tests drive the REAL interceptor over payloads captured live from the
// real platforms (fixtures/graylist-twitch.json, fixtures/graylist-kick.json).
// If Twitch renames `contentClassificationLabels` or Kick renames `is_mature`,
// a test fails instead of a user quietly seeing unfiltered streams.
//
// The sandbox lives in _graylist-sandbox.cjs and is shared with
// test-graylist-platforms.cjs, which runs the same interceptor over live captures
// from the rest of the API tier. This suite is the Twitch/Kick one specifically,
// because those two also exercise the channel-page block.
'use strict';
const fs = require('fs');
const path = require('path');
const { createRunner } = require('./_assert.cjs');
const { makeSandbox, through, blocks } = require('./_graylist-sandbox.cjs');

const FIX = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const TWITCH = FIX('graylist-twitch.json');
const KICK = FIX('graylist-kick.json');

const GQL = 'https://gql.twitch.tv/gql';
const logins = (out) => out.data.streams.edges.map((e) => e.node.broadcaster.login);

async function run() {
  const t = createRunner('graylist-inject');

  // ── Field canaries ────────────────────────────────────────────────────────
  // If a fixture is ever "refreshed" into a shape that no longer carries the
  // fields the signals read, every behavioural test below would pass vacuously.
  t.ok(JSON.stringify(TWITCH.captured).includes('contentClassificationLabels'),
    'fixture canary: Twitch capture still carries contentClassificationLabels');
  t.ok(JSON.stringify(TWITCH.captured).includes('"MatureGame"'),
    'fixture canary: Twitch capture still contains a non-sexual label to be spared');
  t.ok(JSON.stringify(KICK.featured).includes('is_mature'),
    'fixture canary: Kick capture still carries is_mature');

  // ── Twitch: precision ─────────────────────────────────────────────────────
  // The live capture contains MatureGame ("Mature-rated game" — Rust, Rainbow
  // Six), DebatedSocialIssuesAndPolitics and ProfanityVulgarity. None is sexual
  // content, and stripping them would gut ordinary gaming Twitch. Nothing may be
  // removed from this payload.
  {
    const ctx = makeSandbox('https://www.twitch.tv/directory');
    const out = await through(ctx, GQL, TWITCH.captured);
    t.equal(out.data.streams.edges.length, 6, 'twitch: real directory pull passes through untouched');
    t.ok(logins(out).includes('jynxzi'), 'twitch: MatureGame stream (Rainbow Six) survives');
    t.ok(logins(out).includes('theburntpeanut'), 'twitch: MatureGame stream (Rust) survives');
    t.ok(logins(out).includes('hasanabi') || logins(out).includes('zackrawrr'),
      'twitch: politics-labelled stream survives');
    t.equal(blocks(ctx).length, 0, 'twitch: a directory page never page-blocks');
  }

  // ── Twitch: the sexual label IS stripped, and only it ─────────────────────
  {
    const ctx = makeSandbox('https://www.twitch.tv/directory');
    const out = await through(ctx, GQL, TWITCH.synthetic_sexual);
    t.equal(out.data.streams.edges.length, 1, 'twitch: SexualThemes edge removed');
    t.equal(logins(out)[0], 'safechannel', 'twitch: the unlabelled stream survives beside it');
  }

  // ── Twitch: labelled channel opened directly → tab block ─────────────────
  // The flag sits on a named child (data.user.stream), not an array element, so
  // stripping alone would leave the channel looking merely offline.
  //
  // Both payloads below are the REAL batched channel-page operation. Keying
  // ownership on `login` passed against an invented fixture and matched nothing
  // on the live page — the user in this operation only has `displayName`.
  t.ok(!JSON.stringify(TWITCH.captured_channel_page).includes('"login"'),
    'fixture canary: the real channel-page operation still carries no login');
  t.ok(JSON.stringify(TWITCH.captured_channel_page).includes('"displayName"'),
    'fixture canary: the real channel-page operation still identifies by displayName');

  {
    const ctx = makeSandbox('https://www.twitch.tv/jynxzi');
    await through(ctx, GQL, TWITCH.captured_channel_page_sexual.batch);
    t.equal(blocks(ctx).length, 1, 'twitch: labelled channel page hard-blocks the tab');
    t.ok(/jynxzi/.test(blocks(ctx)[0].match || ''), 'twitch: block names the channel');
  }

  // The same real payload with its real label (MatureGame) must NOT block.
  {
    const ctx = makeSandbox('https://www.twitch.tv/jynxzi');
    await through(ctx, GQL, TWITCH.captured_channel_page.batch);
    t.equal(blocks(ctx).length, 0, 'twitch: a MatureGame channel page is left alone');
  }

  // ── Ownership precision ───────────────────────────────────────────────────
  // A flagged item elsewhere in the payload (a sidebar/recommendation rail)
  // must NOT block the clean channel whose page this is.
  {
    const ctx = makeSandbox('https://www.twitch.tv/safechannel');
    await through(ctx, GQL, TWITCH.synthetic_sexual);
    t.equal(blocks(ctx).length, 0, 'twitch: another channel being labelled does not block this one');
  }

  // Reserved routes are not channels.
  {
    const ctx = makeSandbox('https://www.twitch.tv/directory');
    await through(ctx, GQL, TWITCH.captured_channel_page_sexual.batch);
    t.equal(blocks(ctx).length, 0, 'twitch: /directory is a reserved route, never a channel slug');
  }

  // A labelled channel is not the channel you are looking at.
  {
    const ctx = makeSandbox('https://www.twitch.tv/someoneelse');
    await through(ctx, GQL, TWITCH.captured_channel_page_sexual.batch);
    t.equal(blocks(ctx).length, 0, 'twitch: a labelled channel in the payload does not block a different channel page');
  }

  // ── Kick: feed stripping ──────────────────────────────────────────────────
  {
    const ctx = makeSandbox('https://kick.com/browse');
    const out = await through(ctx, 'https://web.kick.com/api/v1/livestreams/featured?language=en', KICK.featured);
    const slugs = out.data.livestreams.map((l) => l.channel.slug);
    t.equal(out.data.livestreams.length, 3, 'kick: both is_mature streams stripped from the featured feed');
    t.ok(!slugs.includes('cabrzy') && !slugs.includes('mascoobs'), 'kick: the mature slugs are gone');
    t.ok(slugs.includes('destiny') && slugs.includes('starladder'), 'kick: clean streams survive');
  }

  // ── Kick: mature channel opened directly → tab block ─────────────────────
  // Also the regression guard for ownerOf(): a Kick livestream names its SESSION
  // in `slug`, so a naive "nearest slug wins" would break the ownership chain
  // here and silently stop blocking.
  {
    const ctx = makeSandbox('https://kick.com/cabrzy');
    await through(ctx, 'https://kick.com/api/v2/channels/cabrzy', KICK.channel);
    t.equal(blocks(ctx).length, 1, 'kick: mature channel page hard-blocks the tab');
  }

  {
    const ctx = makeSandbox('https://kick.com/destiny');
    await through(ctx, 'https://web.kick.com/api/v1/livestreams/featured?language=en', KICK.featured);
    t.equal(blocks(ctx).length, 0, 'kick: a mature stream in the feed does not block a clean channel page');
  }

  // The live client appends a fragment to its GQL calls
  // (`https://gql.twitch.tv/gql#origin=twilight`, observed in the network log).
  {
    const ctx = makeSandbox('https://www.twitch.tv/directory');
    const out = await through(ctx, GQL + '#origin=twilight', TWITCH.synthetic_sexual);
    t.equal(out.data.streams.edges.length, 1, 'twitch: the real fragment-suffixed GQL URL still matches');
  }

  // ── Host matching ─────────────────────────────────────────────────────────
  // web.kick.com is a different host from kick.com and serves the browse feed;
  // an unrelated host must not be touched at all.
  {
    const ctx = makeSandbox('https://example.com/');
    const out = await through(ctx, 'https://example.com/api/feed', KICK.featured);
    t.equal(out.data.livestreams.length, 5, 'unrelated host: payload passes through untouched');
  }

  return t.summary();
}

module.exports = { run };
