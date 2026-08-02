// extension/tests/test-content-script.cjs — first coverage of content.js.
//
// WHY THIS EXISTS
// ---------------
// content.js is the largest file in the extension and nothing loaded it. It
// carries the MAIN-world injection, the graylist stats/page-block relay, the
// DOM_LABEL_RULES page-level blocks (itch.io's adult browse, Twitch's hot-tub
// category, Steam's age gate) and the privacy-frontend detector. All of it was
// verified only by reading.
//
// These tests boot the real file against a minimal fake DOM (_content-sandbox.cjs)
// and assert the decisions, not the implementation: does an adult surface block,
// does an ordinary page stay untouched, does the interceptor get injected.
'use strict';
const { createRunner } = require('./_assert.cjs');
const { makeContentSandbox } = require('./_content-sandbox.cjs');

function run() {
  const t = createRunner('content-script');

  // ── MAIN-world injection ─────────────────────────────────────────────────
  {
    const ctx = makeContentSandbox('https://example.com/some/page');
    const scripts = ctx.__injected.filter((el) => el.tagName === 'script');
    t.equal(scripts.length, 1, 'interceptor is injected on an ordinary page');
    t.ok(/graylist-inject\.js$/.test(scripts[0] && scripts[0].src || ''),
      'injected script points at graylist-inject.js', String(scripts[0] && scripts[0].src));
    t.equal(scripts[0] && scripts[0].dataset.mode, 'standard', 'strictness is handed to the MAIN world');
  }

  // Extension and browser-internal pages must be left completely alone.
  for (const url of ['chrome-extension://abc/popup.html', 'about:blank']) {
    const ctx = makeContentSandbox(url);
    t.equal(ctx.__injected.length, 0, `no injection on ${url}`);
    t.equal(ctx.__sent.length, 0, `no messages from ${url}`);
  }

  // ── Graylist relay: stats ────────────────────────────────────────────────
  {
    const ctx = makeContentSandbox('https://www.reddit.com/');
    ctx.__emitMessage({ __oathLight: 'graylist-filter', site: 'reddit', count: 7 });
    const stat = ctx.__sent.find((m) => m.action === 'graylistFiltered');
    t.ok(stat, 'a filter report is relayed to the background worker');
    t.equal(stat && stat.count, 7, 'the stripped count is passed through');
    t.equal(stat && stat.site, 'reddit', 'the site id is passed through');
  }

  // Malformed relay traffic must not be forwarded — the MAIN world is the page's
  // realm, so anything on that channel is attacker-reachable.
  {
    const ctx = makeContentSandbox('https://www.reddit.com/');
    ctx.__emitMessage({ __oathLight: 'graylist-filter', site: 'reddit' });      // no count
    ctx.__emitMessage({ __oathLight: 'something-else', count: 3 });             // wrong type
    ctx.__emitMessage({ count: 3 });                                           // not ours
    t.equal(ctx.__sent.filter((m) => m.action === 'graylistFiltered').length, 0,
      'malformed filter messages are ignored');
  }

  // ── Graylist relay: channel-page block (Twitch/Kick) ─────────────────────
  {
    const ctx = makeContentSandbox('https://www.twitch.tv/somechannel');
    ctx.__emitMessage({ __oathLight: 'graylist-page-block', site: 'twitch', match: 'twitch adult-labelled channel (somechannel)' });
    const blocks = ctx.__blocks();
    t.equal(blocks.length, 1, 'a page-block message blocks the tab');
    t.equal(blocks[0].reason, 'graylist_page_label', 'block is reported with the graylist page reason');
    t.ok(/somechannel/.test(blocks[0].match || ''), 'the channel is named in the block record');
    t.ok(ctx.__hidden(), 'the page is hidden immediately, not left rendering behind the redirect');
  }

  // Only one block per page, however many times the SPA re-queries.
  {
    const ctx = makeContentSandbox('https://www.twitch.tv/somechannel');
    for (let i = 0; i < 5; i++) {
      ctx.__emitMessage({ __oathLight: 'graylist-page-block', site: 'twitch', match: 'x' });
    }
    t.equal(ctx.__blocks().length, 1, 'repeated page-block messages block exactly once');
  }

  // ── Page-level surface blocks (DOM_LABEL_RULES) ──────────────────────────
  // Twitch's hot-tub category: the streams in it carry no per-item label, so the
  // surface itself is the block.
  {
    const ctx = makeContentSandbox('https://www.twitch.tv/directory/category/pools-hot-tubs-and-beaches');
    t.equal(ctx.__blocks().length, 1, 'twitch hot-tub category blocks the page');
  }
  {
    const ctx = makeContentSandbox('https://www.twitch.tv/directory/category/pools-hot-tubs-and-beaches/clips');
    t.equal(ctx.__blocks().length, 1, 'twitch hot-tub sub-tab blocks too');
  }
  // The legacy /directory/game/<url-encoded name> form.
  {
    const ctx = makeContentSandbox('https://www.twitch.tv/directory/game/Pools%2C%20Hot%20Tubs%2C%20and%20Beaches');
    t.equal(ctx.__blocks().length, 1, 'twitch hot-tub legacy game URL blocks too');
  }
  for (const url of [
    'https://www.twitch.tv/directory/category/just-chatting',
    'https://www.twitch.tv/directory/category/minecraft',
    'https://www.twitch.tv/directory',
    'https://www.twitch.tv/somechannel'
  ]) {
    const ctx = makeContentSandbox(url);
    t.equal(ctx.__blocks().length, 0, `ordinary twitch page is untouched: ${new URL(url).pathname}`);
  }

  // itch.io's adult browse surfaces — an existing rule that had never been run.
  for (const url of [
    'https://itch.io/games/nsfw',
    'https://itch.io/games/tag-hentai',
    'https://itch.io/games/genre-eroge'
  ]) {
    const ctx = makeContentSandbox(url);
    t.equal(ctx.__blocks().length, 1, `itch.io adult browse blocks: ${new URL(url).pathname}`);
  }
  for (const url of ['https://itch.io/games', 'https://itch.io/games/tag-puzzle', 'https://itch.io/']) {
    const ctx = makeContentSandbox(url);
    t.equal(ctx.__blocks().length, 0, `itch.io ordinary browse is untouched: ${new URL(url).pathname}`);
  }

  // ScribbleHub adult genre browse — likewise previously unexercised.
  {
    const ctx = makeContentSandbox('https://www.scribblehub.com/genre/smut/');
    t.equal(ctx.__blocks().length, 1, 'scribblehub adult genre browse blocks');
  }
  {
    const ctx = makeContentSandbox('https://www.scribblehub.com/genre/fantasy/');
    t.equal(ctx.__blocks().length, 0, 'scribblehub ordinary genre browse is untouched');
  }

  return t.summary();
}

module.exports = { run };
