// scripts/ci/check-list-pr.mjs — the community blocklist pipeline's gate
// (plan item 3.6).
//
// `validate-blocklists.mjs` checks that the list FILES are well-formed. This
// checks that a specific CHANGE to them is safe to merge — which is a
// different and much more interesting question, and the one that decides
// whether outside contributions are viable at all.
//
// The bet 3.6 makes is that community-driven list freshness beats any vendor's
// internal team (it is how uBlock Origin won its category). The thing that
// makes that bet safe rather than reckless is this file: a stranger's PR can
// add domains, and the worst they can do is get told no by a script.
//
// What it enforces on EVERY newly-added domain:
//   1. Shape — same rules as the file validator, applied per-entry.
//   2. The allowlist floor — nothing that would block a mainstream domain the
//      matcher explicitly protects. This is the single most damaging thing a
//      bad or malicious list PR could do, so it is checked first and hardest.
//   3. No duplicates, and no entry already covered by a parent domain that is
//      in the list — redundancy is how a curated list rots into an unreviewable
//      one.
//   4. Not a bare public suffix (`com`, `co.uk`) or a hosting root that would
//      take out every subdomain on a shared host.
//
// Removals are reported but never blocked: taking a false positive OUT is the
// other half of a healthy list, and gating it behind the same scrutiny as an
// addition would discourage exactly the reports we most want.
//
// Usage:
//   node scripts/ci/check-list-pr.mjs                 # diff against origin/main
//   node scripts/ci/check-list-pr.mjs --base <ref>    # diff against a ref
//   node scripts/ci/check-list-pr.mjs --summary-only  # no failure, just report
//
// Writes a markdown summary to stdout (the workflow posts it as a PR comment)
// and exits non-zero if anything is rejected.
'use strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LISTS_REL = 'extension/blocklists';

const args = process.argv.slice(2);
const baseIdx = args.indexOf('--base');
const BASE = baseIdx !== -1 ? args[baseIdx + 1] : 'origin/main';
const SUMMARY_ONLY = args.includes('--summary-only');

// Same shape rule as validate-blocklists.mjs — kept identical on purpose.
const DOMAIN_RE = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/;

// Bare suffixes nobody may ever add: blocking one takes out an entire TLD or
// a whole shared-hosting namespace. Not exhaustive, and doesn't need to be —
// it catches the catastrophic typo (`com`) and the naive over-block
// (`blogspot.com`), which is what this is for.
const FORBIDDEN_ROOTS = new Set([
  'com', 'net', 'org', 'io', 'co', 'me', 'tv', 'cc', 'xyz', 'info', 'biz',
  'co.uk', 'com.au', 'com.br', 'co.jp',
  'blogspot.com', 'wordpress.com', 'tumblr.com', 'github.io', 'pages.dev',
  'weebly.com', 'wixsite.com', 'neocities.org', 'herokuapp.com', 'vercel.app',
  'netlify.app', 'appspot.com', 'cloudfront.net', 'amazonaws.com', 'r2.dev',
  'googleusercontent.com', 'firebaseapp.com', 'web.app', 'onrender.com',
]);

/** Pull `WHITELIST_DOMAINS` out of bg/matching.js without loading the whole
 *  extension: evaluate just that one array literal in a bare context. The
 *  file is the single source of truth for the allowlist floor, so reading it
 *  directly is what keeps this check honest as the list evolves. */
function readWhitelist() {
  const src = readFileSync(join(REPO_ROOT, 'extension', 'bg', 'matching.js'), 'utf8');
  const m = src.match(/const\s+WHITELIST_DOMAINS\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) throw new Error('could not locate WHITELIST_DOMAINS in extension/bg/matching.js');
  return new Set(vm.runInNewContext(m[1]));
}

/** Every domain currently in the lists, keyed by the file it came from. */
function readLists(revision) {
  const out = new Map(); // domain -> file
  const files = ['domains_part1.json', 'domains_part2.json', 'domains_part3.json', 'domains_ai.json'];
  for (const f of files) {
    const rel = `${LISTS_REL}/${f}`;
    let text = null;
    if (revision === null) {
      const abs = join(REPO_ROOT, rel);
      if (existsSync(abs)) text = readFileSync(abs, 'utf8');
    } else {
      try {
        text = execFileSync('git', ['show', `${revision}:${rel}`], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          // The curated lists are multi-MB. execFileSync's default maxBuffer
          // is 1MB, and blowing it throws — which, caught below, would look
          // exactly like "the file didn't exist at that revision" and make
          // every existing domain read as newly added. 256MB is far past any
          // plausible list size.
          maxBuffer: 256 * 1024 * 1024,
        });
      } catch { text = null; } // file didn't exist at that revision — fine
    }
    if (!text) continue;
    let json;
    try { json = JSON.parse(text); } catch { continue; }
    for (const d of json.domains || []) {
      if (typeof d === 'string' && !out.has(d)) out.set(d, f);
    }
  }
  return out;
}

/** Is `domain` the allowlisted domain itself, or a subdomain of one? */
function whitelistHit(domain, whitelist) {
  if (whitelist.has(domain)) return domain;
  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    if (whitelist.has(parent)) return parent;
  }
  return null;
}

/** Is `domain` already covered by a parent domain present in `existing`?
 *  The matcher walks exact-and-parent, so `sub.example.com` is redundant when
 *  `example.com` is already listed. */
function coveredByParent(domain, existing) {
  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    if (existing.has(parent)) return parent;
  }
  return null;
}

// ── diff ────────────────────────────────────────────────────────────────────
let before;
try {
  before = readLists(BASE);
} catch (e) {
  console.error(`Could not read the base revision '${BASE}': ${e.message}`);
  console.error('Pass --base <ref>, or fetch the base branch (actions/checkout needs fetch-depth: 0).');
  process.exit(2);
}
const after = readLists(null);

const added = [...after.keys()].filter((d) => !before.has(d));
const removed = [...before.keys()].filter((d) => !after.has(d));

if (added.length === 0 && removed.length === 0) {
  console.log('### Blocklist review\n\nNo domain changes in this PR.');
  process.exit(0);
}

// ── checks, on additions only ───────────────────────────────────────────────
const whitelist = readWhitelist();
const rejections = [];
const warnings = [];
const seen = new Set();

for (const d of added) {
  if (d !== d.toLowerCase() || /\s/.test(d)) {
    rejections.push([d, 'not lowercase, or contains whitespace']);
    continue;
  }
  if (!DOMAIN_RE.test(d)) {
    rejections.push([d, 'malformed — expected a bare domain like `example.com`, not a URL or path']);
    continue;
  }
  if (FORBIDDEN_ROOTS.has(d)) {
    rejections.push([d, 'a public suffix or shared-hosting root — this would block every site under it']);
    continue;
  }
  const wl = whitelistHit(d, whitelist);
  if (wl) {
    rejections.push([d, `collides with the allowlist floor (\`${wl}\`) — the matcher protects this domain, so the entry would be dead AND is a sign the list is drifting`]);
    continue;
  }
  if (seen.has(d)) {
    rejections.push([d, 'listed twice in this PR']);
    continue;
  }
  seen.add(d);

  const parent = coveredByParent(d, after);
  if (parent) {
    warnings.push([d, `already covered by \`${parent}\` (the matcher walks parent domains) — redundant, safe to drop`]);
  }
}

// ── summary ─────────────────────────────────────────────────────────────────
const lines = [];
lines.push('### Blocklist review');
lines.push('');
lines.push(`**+${added.length} added · −${removed.length} removed** (against \`${BASE}\`)`);
lines.push('');

if (added.length) {
  lines.push('<details><summary>Added domains</summary>');
  lines.push('');
  for (const d of added.slice(0, 200)) lines.push(`- \`${d}\``);
  if (added.length > 200) lines.push(`- …and ${added.length - 200} more`);
  lines.push('');
  lines.push('</details>');
  lines.push('');
}
if (removed.length) {
  lines.push('<details><summary>Removed domains</summary>');
  lines.push('');
  for (const d of removed.slice(0, 200)) lines.push(`- \`${d}\``);
  if (removed.length > 200) lines.push(`- …and ${removed.length - 200} more`);
  lines.push('');
  lines.push('</details>');
  lines.push('');
  lines.push('_Removals are reported, never blocked — taking a false positive out is as valuable as adding a miss._');
  lines.push('');
}

if (warnings.length) {
  lines.push('#### ⚠️ Warnings (not blocking)');
  for (const [d, why] of warnings) lines.push(`- \`${d}\` — ${why}`);
  lines.push('');
}

if (rejections.length) {
  lines.push('#### ❌ Rejected');
  for (const [d, why] of rejections) lines.push(`- \`${d}\` — ${why}`);
  lines.push('');
  lines.push('Fix these and push again. See [CONTRIBUTING.md](../blob/main/CONTRIBUTING.md#adding-domains-to-the-blocklist).');
} else {
  lines.push('#### ✅ All additions pass');
  lines.push('');
  lines.push('Shape, allowlist floor, duplicates and over-broad roots all checked.');
}

console.log(lines.join('\n'));

if (rejections.length && !SUMMARY_ONLY) process.exit(1);
process.exit(0);
