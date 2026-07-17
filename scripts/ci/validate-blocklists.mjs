// scripts/ci/validate-blocklists.mjs — blocklist JSON shape gate (plan A.4 /
// seed of the 3.6 community pipeline). Fails (exit 1) if any list file isn't
// valid JSON, has the wrong shape, or contains a non-lowercase / whitespace /
// obviously-malformed domain. Run by .github/workflows/ci.yml and safe to run
// locally: `node scripts/ci/validate-blocklists.mjs`.
'use strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LISTS_DIR = join(REPO_ROOT, 'extension', 'blocklists');

const errors = [];
function check(cond, msg) {
  if (!cond) errors.push(msg);
}

// A domain entry: lowercase ASCII, at least one dot, and only the characters
// that legitimately appear in the curated list — letters, digits, dot, hyphen,
// and underscore (real crawled subdomains use `_`, e.g.
// `free_hardcore_bilder.domainhimmel.de`; IDN labels appear pre-encoded as
// lowercase `xn--…`). No leading/trailing dot. This is a SHAPE gate (catch
// uppercase, whitespace, and pasted `http://…/path` URLs), deliberately NOT an
// RFC-1035 hostname validator — the blocklist is matched as strings, so
// over-strict hostname rules would reject valid existing entries.
const DOMAIN_RE = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/;

let totalDomains = 0;
let totalKeywords = 0;

for (const name of readdirSync(LISTS_DIR).sort()) {
  if (!name.endsWith('.json')) continue;
  const raw = readFileSync(join(LISTS_DIR, name), 'utf8');
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    errors.push(`${name}: invalid JSON — ${e.message}`);
    continue;
  }

  if (name === 'keywords.json') {
    check(Array.isArray(json.keywords), `${name}: must have a "keywords" array`);
    for (const k of json.keywords || []) {
      // Keywords are matched as substrings and are legitimately multi-word
      // phrases ("2 girls 1 cup", "alabama hot pocket", …), so interior spaces
      // are fine — only require a non-empty, lowercase, non-space-padded string.
      const okKeyword = typeof k === 'string' && k.length > 0 && k === k.toLowerCase() && k === k.trim();
      check(okKeyword, `${name}: bad keyword ${JSON.stringify(k)}`);
      totalKeywords++;
    }
    continue;
  }

  // domains_part*.json and domains_ai.json both carry a "domains" array (the AI
  // file additionally has a "category" string).
  check(Array.isArray(json.domains), `${name}: must have a "domains" array`);
  if (name.startsWith('domains_ai')) {
    check(typeof json.category === 'string' && json.category.length > 0, `${name}: AI list must carry a non-empty "category"`);
  }
  const seen = new Set();
  for (const d of json.domains || []) {
    if (typeof d !== 'string') {
      errors.push(`${name}: non-string domain ${JSON.stringify(d)}`);
      continue;
    }
    if (d !== d.toLowerCase()) errors.push(`${name}: domain not lowercase: ${JSON.stringify(d)}`);
    if (/\s/.test(d)) errors.push(`${name}: domain contains whitespace: ${JSON.stringify(d)}`);
    if (!DOMAIN_RE.test(d)) errors.push(`${name}: malformed domain: ${JSON.stringify(d)}`);
    if (seen.has(d)) errors.push(`${name}: duplicate domain: ${JSON.stringify(d)}`);
    seen.add(d);
    totalDomains++;
  }
}

if (errors.length) {
  // Cap the noise — the first 40 are enough to fix a bad PR.
  for (const e of errors.slice(0, 40)) console.error(`✗ ${e}`);
  if (errors.length > 40) console.error(`… and ${errors.length - 40} more`);
  console.error(`\nblocklist validation FAILED: ${errors.length} problem(s)`);
  process.exit(1);
}

console.log(`blocklist validation OK — ${totalDomains} domains, ${totalKeywords} keywords across all list files`);
process.exit(0);
