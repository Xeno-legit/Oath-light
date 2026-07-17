// extension/tests/test-lockdown.cjs
// Coverage of Lockdown Mode (plan item 4.4) enforcement in shouldBlockUrl:
// when a lockdown is active only the whitelist + user allowlist get through,
// everything else blocks with the dedicated `lockdown` reason; when it's
// inactive the normal blocking pipeline is completely unchanged.
//
// Lockdown state reaches the matcher via the global `blockingSettings.lockdown`
// object (pushed by the desktop app over the native bridge in the real
// extension). `blockingSettings` is a top-level `let` in bg/blocklists.js —
// a lexical binding in the shared vm context, not a property of the sandbox
// object — so the tests set it by running a tiny assignment script in the same
// context rather than poking `sandbox.blockingSettings` directly.
'use strict';
const vm = require('vm');
const { buildSandbox } = require('./_harness.cjs');
const { createRunner } = require('./_assert.cjs');

function setLockdown(sandbox, ld) {
  // Assignment (not declaration) resolves to the existing `blockingSettings`
  // lexical binding in the context and updates it in place.
  vm.runInContext(
    'blockingSettings = ' + JSON.stringify(ld === null ? null : { lockdown: ld }) + ';',
    sandbox
  );
}

function run() {
  const { sandbox } = buildSandbox({ mode: 'firefox' });
  const { shouldBlockUrl } = sandbox;
  const runner = createRunner('test-lockdown');

  // ── Lockdown ACTIVE ────────────────────────────────────────────────────────
  setLockdown(sandbox, { active: true, frozen: false, ends_at_hint: 0, allow: ['mybank.example', 'work-sso.example'] });

  {
    const r = shouldBlockUrl('https://news.ycombinator.com/');
    runner.ok(r && r.blocked === true && r.reason === 'lockdown',
      'random non-whitelisted site is blocked with the lockdown reason while active', JSON.stringify(r));
  }
  {
    const r = shouldBlockUrl('https://en.wikipedia.org/wiki/Cat');
    runner.ok(r && r.blocked === false && r.tier === 'lockdown_allow',
      'a whitelist domain (wikipedia.org) is allowed during lockdown', JSON.stringify(r));
  }
  {
    const r = shouldBlockUrl('https://github.com/some/repo');
    runner.ok(r && r.blocked === false,
      'another whitelist domain (github.com) is allowed during lockdown', JSON.stringify(r));
  }
  {
    const r = shouldBlockUrl('https://mybank.example/login');
    runner.ok(r && r.blocked === false && r.tier === 'lockdown_allow',
      'a user-allowlisted domain is allowed during lockdown', JSON.stringify(r));
  }
  {
    const r = shouldBlockUrl('https://portal.work-sso.example/auth');
    runner.ok(r && r.blocked === false,
      'a SUBDOMAIN of a user-allowlisted domain is allowed during lockdown', JSON.stringify(r));
  }
  {
    // Even a normally-innocent site is walled off — allowlist-only means exactly that.
    const r = shouldBlockUrl('https://example.com/');
    runner.ok(r && r.blocked === true && r.reason === 'lockdown',
      'an otherwise-innocent, non-allowlisted site is still blocked during lockdown', JSON.stringify(r));
  }
  {
    // A porn domain is of course blocked too — but crucially as `lockdown`,
    // proving the lockdown check runs FIRST (before the blacklist/keyword layers).
    const r = shouldBlockUrl('https://pornhub.com/');
    runner.ok(r && r.blocked === true && r.reason === 'lockdown',
      'lockdown check runs first — even a porn domain reports the lockdown reason', JSON.stringify(r));
  }

  // ── Self-expiry hint is IGNORED while connected (desktop is authority) ───────
  {
    // ends_at_hint in the past, but the desktop is "connected" in the harness
    // (connectNative is stubbed and NativeMessagingBridge.connect ran at load),
    // so a stale hint must NOT end the lockdown — the desktop owns the clock.
    setLockdown(sandbox, { active: true, frozen: true, ends_at_hint: 1, allow: [] });
    const r = shouldBlockUrl('https://example.com/');
    runner.ok(r && r.blocked === true && r.reason === 'lockdown',
      'a past ends_at_hint does NOT end a lockdown while the desktop is connected', JSON.stringify(r));
  }

  // ── Lockdown INACTIVE → the normal pipeline is unchanged ─────────────────────
  setLockdown(sandbox, { active: false, frozen: false, ends_at_hint: 0, allow: [] });

  {
    const r = shouldBlockUrl('https://example.com/');
    runner.ok(r && !r.blocked,
      'with lockdown inactive, an innocent site is NOT blocked (normal pipeline)', JSON.stringify(r));
  }
  {
    const r = shouldBlockUrl('https://en.wikipedia.org/wiki/Cat');
    runner.ok(r && !r.blocked && r.tier === 'whitelist',
      'with lockdown inactive, wikipedia resolves via the normal whitelist path, not lockdown_allow', JSON.stringify(r));
  }
  {
    const r = shouldBlockUrl('https://sex4arabs.com/');
    runner.ok(r && r.blocked === true && r.reason === 'domain_keyword',
      'with lockdown inactive, the domain-keyword layer still fires normally', JSON.stringify(r));
  }

  // ── No lockdown object at all (older desktop / never pushed) → no-op ──────────
  setLockdown(sandbox, null);
  {
    const r = shouldBlockUrl('https://example.com/');
    runner.ok(r && !r.blocked,
      'with no blockingSettings at all, nothing is treated as locked down (safe default)', JSON.stringify(r));
  }

  return runner.summary();
}

module.exports = { run };
