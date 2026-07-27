// desktop-app/scripts/check-renderer-transpile.mjs — renderer syntax gate.
//
// The renderer has no build step: index.html loads each .jsx through
// babel-standalone in the browser at runtime. That's a deliberate choice (it
// keeps the app hackable and the toolchain at zero), but it has one sharp
// edge — a syntax error in any page file is invisible until that page is
// opened, in the app, by a human.
//
// This runs the SAME babel-standalone build the browser uses, with the same
// preset, over every renderer script, so a broken file fails CI in seconds
// instead of surfacing as a blank page later. It checks syntax only — it can't
// catch a bad prop or a missing global, which is what the browser pass is for.
//
// Run by .github/workflows/ci.yml; safe locally:
//   node desktop-app/scripts/check-renderer-transpile.mjs
'use strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(HERE, '..', 'src', 'renderer');
const require = createRequire(import.meta.url);

// babel-standalone attaches itself to the module exports when required in a
// CommonJS context, which is exactly what we want here.
const Babel = require(join(RENDERER, 'lib', 'babel.min.js'));

const failures = [];
let checked = 0;

// Every script index.html loads from js/, plus the two shared top-level copies.
const targets = [
  ...readdirSync(join(RENDERER, 'js'))
    .filter((f) => f.endsWith('.jsx') || f.endsWith('.js'))
    .map((f) => join('js', f)),
  'strings.js',
  'tokens.js',
];

for (const rel of targets) {
  const source = readFileSync(join(RENDERER, rel), 'utf8');
  checked++;
  try {
    Babel.transform(source, { presets: ['react'], filename: rel });
  } catch (e) {
    failures.push(`${rel}: ${String(e.message).split('\n')[0]}`);
  }
}

if (failures.length) {
  for (const f of failures) console.error(`✗ ${f}`);
  console.error(`\nrenderer transpile FAILED: ${failures.length} of ${checked} file(s)`);
  process.exit(1);
}

console.log(`renderer transpile OK — ${checked} files parsed with the shipped babel-standalone`);
process.exit(0);
