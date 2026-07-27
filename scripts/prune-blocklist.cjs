/*
 * prune-blocklist.cjs — compact the curated blocklist.
 *
 * Loads the REAL shouldBlockUrl() from extension/background.js (with the in-memory
 * blacklist empty), then for every domain in domains_part{1,2,3}.json:
 *   - if the logic (keyword layer / adult-TLD / native-IDN / bypass) ALREADY
 *     blocks it  -> remove it (redundant; the engine covers it + all subdomains)
 *   - otherwise -> keep it (only the list can catch it)
 * Whitelisted domains return blocked=false, so they are always kept.
 *
 * Dry run by default. Pass --apply to overwrite the JSON files.
 *
 *   node scripts/prune-blocklist.cjs            # report only
 *   node scripts/prune-blocklist.cjs --apply    # write pruned lists
 */
const fs = require('fs');
const path = require('path');
// Same sandbox the test suites use, so the pruner is judged by the REAL engine
// (bg/matching.js et al. in manifest load order) and can never drift from it.
const { buildSandbox } = require('../extension/tests/_harness.cjs');

const APPLY = process.argv.includes('--apply');
const ROOT = path.join(__dirname, '..');
const LIST_DIR = path.join(ROOT, 'extension', 'blocklists');
const FILES = ['domains_part1.json', 'domains_part2.json', 'domains_part3.json'];

// The sandbox starts with an EMPTY in-memory blacklist, which is exactly what
// this tool needs: every block it sees comes from the logic layers (keyword /
// adult-TLD / native-IDN / bypass), never from the list being pruned.
const { sandbox } = buildSandbox({ mode: 'firefox' });
const shouldBlockUrl = sandbox.shouldBlockUrl;

function caughtByLogic(domain) {
  try {
    const r = shouldBlockUrl('https://' + domain + '/');
    return !!(r && r.blocked) ? (r.reason || 'blocked') : null;
  } catch (e) { return null; }
}

// --- prune ------------------------------------------------------------------
let totalIn = 0, totalKept = 0, totalRemoved = 0;
const reasonCounts = {};
const samples = [];

for (const f of FILES) {
  const file = path.join(LIST_DIR, f);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const domains = Array.isArray(data.domains) ? data.domains : [];
  const kept = [];
  let removed = 0;
  for (const d of domains) {
    const reason = caughtByLogic(String(d).toLowerCase());
    if (reason) {
      removed++;
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      if (samples.length < 40) samples.push(d + '  →  ' + reason);
    } else {
      kept.push(d);
    }
  }
  totalIn += domains.length; totalKept += kept.length; totalRemoved += removed;
  console.log(`${f}: ${domains.length} -> ${kept.length}   (removed ${removed})`);
  if (APPLY) fs.writeFileSync(file, JSON.stringify({ domains: kept }, null, 2) + '\n');
}

const pct = totalIn ? (100 * totalRemoved / totalIn).toFixed(1) : '0';
console.log(`\nTOTAL: ${totalIn} -> ${totalKept}   (removed ${totalRemoved}, ${pct}% redundant)`);
console.log('\nremoved by reason:');
Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).forEach(([r, n]) => console.log(`  ${String(n).padStart(7)}  ${r}`));
console.log('\nsample removals:');
samples.forEach(s => console.log('  ' + s));
console.log(APPLY ? '\nAPPLIED — pruned lists written.' : '\nDRY RUN — re-run with --apply to write.');
process.exit(0);
