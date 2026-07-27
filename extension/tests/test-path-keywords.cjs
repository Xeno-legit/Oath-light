// extension/tests/test-path-keywords.cjs
// Coverage of the URL path/query keyword layer (plan item 3.7).
//
// This is the highest-false-positive layer in the matcher, so most of what is
// asserted here is what it must NOT do: it must stay completely inert under
// the default preset, it must never fire on a whitelisted or already-decided
// host, it must not Scunthorpe an innocent path, and one ambiguous word must
// never be enough on its own.
//
// Arming works through `blockingSettings.strictness` / `.serious` — the same
// pushed-settings object lockdown state arrives on, so it's set the same way
// test-lockdown.cjs sets lockdown (an assignment run inside the vm context, to
// reach the lexical `let` binding rather than a sandbox property).
'use strict';
const vm = require('vm');
const { buildSandbox } = require('./_harness.cjs');
const { createRunner } = require('./_assert.cjs');

function setSettings(sandbox, settings) {
  vm.runInContext(
    'blockingSettings = ' + JSON.stringify(settings === null ? null : settings) + ';',
    sandbox
  );
}

function run() {
  const { sandbox } = buildSandbox({ mode: 'firefox' });
  const { shouldBlockUrl } = sandbox;
  const runner = createRunner('test-path-keywords');

  // An unlisted host — nothing else in the pipeline has an opinion about it,
  // so whatever happens here is this layer's doing and nothing else's.
  const HOST = 'https://unlisted-example-site.test';

  // ── DISARMED: the default preset ─────────────────────────────────────────
  setSettings(sandbox, { strictness: 'standard' });
  {
    const r = shouldBlockUrl(HOST + '/hentai/gallery');
    runner.ok(r && r.blocked === false && r.tier === 'unknown',
      'standard preset: an obvious adult path is NOT blocked by this layer', JSON.stringify(r));
  }
  setSettings(sandbox, null);
  {
    const r = shouldBlockUrl(HOST + '/hentai/gallery');
    runner.ok(r && r.blocked === false,
      'no settings pushed at all: layer stays inert (never blocks before the desktop connects)', JSON.stringify(r));
  }

  // ── ARMED via the Strict preset ──────────────────────────────────────────
  setSettings(sandbox, { strictness: 'strict' });
  {
    const r = shouldBlockUrl(HOST + '/hentai/gallery');
    runner.ok(r && r.blocked === true && r.reason === 'keyword_path' && r.match === 'hentai',
      'strict preset: a hard keyword as a whole path segment blocks', JSON.stringify(r));
  }
  {
    const r = shouldBlockUrl(HOST + '/browse?tag=hentai');
    runner.ok(r && r.blocked === true && r.reason === 'keyword_path',
      'strict preset: a hard keyword in a QUERY VALUE blocks', JSON.stringify(r));
  }
  {
    const r = shouldBlockUrl(HOST + '/%68entai/gallery');
    runner.ok(r && r.blocked === true && r.reason === 'keyword_path',
      'percent-encoded path is decoded before tokenizing', JSON.stringify(r));
  }

  // ── ARMED via the Lockdown preset and via Serious Mode ───────────────────
  setSettings(sandbox, { strictness: 'lockdown' });
  {
    const r = shouldBlockUrl(HOST + '/hentai/');
    runner.ok(r && r.blocked === true, 'lockdown preset also arms the layer', JSON.stringify(r));
  }
  setSettings(sandbox, { strictness: 'standard', serious: true });
  {
    const r = shouldBlockUrl(HOST + '/hentai/');
    runner.ok(r && r.blocked === true,
      'Serious Mode arms the layer even on the standard preset', JSON.stringify(r));
  }

  // ── WHOLE-TOKEN discipline: the anti-Scunthorpe guarantee ────────────────
  setSettings(sandbox, { strictness: 'strict' });
  const INNOCENT = [
    ['/therapeutics/overview', 'therapeutics does not match "rape"'],
    ['/products/glasses', 'glasses does not match "ass"'],
    ['/classic-cocktails', 'classic does not match "ass"'],
    ['/essex/news', 'essex does not match "sex"'],
    ['/middlesex-county/records', 'middlesex does not match "sex"'],
    ['/scunthorpe/timetable', 'the canonical case still passes'],
    ['/cocktail/recipes', 'cocktail does not match "cock"'],
    ['/analysis/2026', 'analysis does not match "anal"'],
    ['/shitake-mushrooms', 'a compound word never matches a substring'],
  ];
  for (const [path, label] of INNOCENT) {
    const r = shouldBlockUrl(HOST + path);
    runner.ok(r && r.blocked === false, `innocent path stays reachable — ${label}`, path + ' → ' + JSON.stringify(r));
  }

  // ── SOFT keywords: one is noise, two is a pattern ────────────────────────
  {
    const r = shouldBlockUrl(HOST + '/topics/sex');
    runner.ok(r && r.blocked === false,
      'a single ambiguous soft keyword is NOT enough on its own', JSON.stringify(r));
  }
  {
    const r = shouldBlockUrl(HOST + '/nude/sexy/gallery');
    runner.ok(r && r.blocked === true && r.reason === 'keyword_context',
      'two distinct soft keywords in one URL block as keyword_context', JSON.stringify(r));
  }

  // ── Educational / medical exemption ──────────────────────────────────────
  {
    const r = shouldBlockUrl(HOST + '/health/sex-education/nude-body-image');
    runner.ok(r && r.blocked === false,
      'an exempt segment (health/education) disarms the layer for that URL', JSON.stringify(r));
  }
  {
    const r = shouldBlockUrl(HOST + '/wiki/nude/sexy');
    runner.ok(r && r.blocked === false,
      'a wiki path is exempt even with two soft hits', JSON.stringify(r));
  }

  // ── Ordering: this layer can only ADD blocks, never override an allow ────
  {
    const r = shouldBlockUrl('https://en.wikipedia.org/wiki/Sex');
    runner.ok(r && r.blocked === false,
      'a whitelisted host is decided long before this layer runs', JSON.stringify(r));
  }
  {
    // A blacklisted host must keep ITS reason, not be relabelled by this layer.
    const r = shouldBlockUrl('https://pornhub.com/hentai');
    runner.ok(r && r.blocked === true && r.reason !== 'keyword_path',
      'an already-blacklisted host keeps its own block reason', JSON.stringify(r));
  }

  // ── Mainstream AI platforms are GRAYLISTED, not blocked (plan 3.3) ───────
  // Separate layer from 3.7 above, but the same principle and worth pinning
  // here: the platform stays usable, only the adult search dies. Asserted with
  // the path layer DISARMED so these can only be the graylist rule firing.
  setSettings(sandbox, { strictness: 'standard' });
  const AI_GRAYLIST = [
    ['https://character.ai/search?q=hentai', true, 'character.ai NSFW search is blocked'],
    ['https://character.ai/chat/some-normal-character', false, 'character.ai ordinary use is untouched'],
    ['https://poe.com/search?q=nsfw', true, 'poe.com NSFW search is blocked'],
    ['https://poe.com/ChatGPT', false, 'poe.com ordinary bot use is untouched'],
    ['https://huggingface.co/models?search=hentai', true, 'huggingface NSFW model search is blocked'],
    ['https://huggingface.co/models?search=llama', false, 'huggingface ordinary model search is untouched'],
  ];
  for (const [url, expectBlocked, label] of AI_GRAYLIST) {
    const r = shouldBlockUrl(url);
    runner.ok(r && r.blocked === expectBlocked, label, url + ' → ' + JSON.stringify(r));
  }

  // Leave the shared sandbox as we found it for any later suite.
  setSettings(sandbox, null);
  return runner.summary();
}

module.exports = { run };
