// desktop-app/scripts/check-renderer-transpile.mjs — renderer static gate.
//
// The renderer has no build step: index.html loads each .jsx through
// babel-standalone in the browser at runtime. That's a deliberate choice (it
// keeps the app hackable and the toolchain at zero), but it has one sharp
// edge — a broken file is invisible until that page is opened, in the app, by
// a human.
//
// Two passes, both using the SAME babel-standalone the browser loads:
//
//   1. SYNTAX — every renderer script is transpiled with the same preset, so a
//      parse error fails CI in seconds instead of surfacing as a blank page.
//
//   2. UNDEFINED GLOBALS — every identifier a file references without binding
//      it must be bound by SOME renderer script, or be a known runtime global.
//      This pass exists because pass 1 alone was not enough: `IconSmoke` was
//      deleted in a refactor while two files still referenced it, which parsed
//      perfectly and then threw at runtime the moment the Recovery Program page
//      was opened — taking the whole app down with it (React 18 unmounts the
//      entire tree on an uncaught render error). Every renderer script shares
//      one global scope, so "bound anywhere" is the correct rule here; the
//      per-file boundary that a bundler would enforce does not exist.
//
// Run by .github/workflows/ci.yml; safe locally:
//   node desktop-app/scripts/check-renderer-transpile.mjs
'use strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(HERE, '..', 'src', 'renderer');
const require = createRequire(import.meta.url);

// babel-standalone attaches itself to the module exports when required in a
// CommonJS context, which is exactly what we want here. `packages` exposes the
// same parser/traverse the browser build uses internally — so pass 2 reads the
// code with the identical parser that will run it.
const Babel = require(join(RENDERER, 'lib', 'babel.min.js'));
const parser = Babel.packages.parser;
const traverse = Babel.packages.traverse.default || Babel.packages.traverse;

// Runtime globals no renderer file declares but every renderer file may use.
// Kept explicit rather than pulled from a `globals` package — the toolchain is
// deliberately zero-dependency, and an over-broad list would defeat the pass.
const RUNTIME_GLOBALS = new Set([
  // Loaded by index.html before any renderer script.
  'React', 'ReactDOM',
  // Language builtins.
  'Array', 'ArrayBuffer', 'BigInt', 'Boolean', 'Date', 'Error', 'Function',
  'Infinity', 'Intl', 'JSON', 'Map', 'Math', 'NaN', 'Number', 'Object',
  'Promise', 'Proxy', 'Reflect', 'RegExp', 'Set', 'String', 'Symbol',
  'TypeError', 'Uint8Array', 'WeakMap', 'WeakSet', 'globalThis', 'undefined',
  'decodeURIComponent', 'encodeURIComponent', 'isFinite', 'isNaN',
  'parseFloat', 'parseInt', 'structuredClone',
  // DOM / BOM.
  'AbortController', 'Blob', 'CSS', 'CustomEvent', 'Event', 'File',
  'FileReader', 'FormData', 'Headers', 'Image', 'IntersectionObserver',
  'MutationObserver', 'Node', 'Request', 'Response', 'ResizeObserver',
  'TextDecoder', 'TextEncoder', 'URL', 'URLSearchParams', 'WebSocket',
  'alert', 'atob', 'btoa', 'cancelAnimationFrame', 'clearInterval',
  'clearTimeout', 'confirm', 'console', 'crypto', 'document', 'fetch',
  'getComputedStyle', 'history', 'localStorage', 'location', 'matchMedia',
  'navigator', 'performance', 'prompt', 'queueMicrotask',
  'requestAnimationFrame', 'screen', 'sessionStorage', 'setInterval',
  'setTimeout', 'window',
  // Injected by the Tauri webview itself (see tauri-bridge.jsx).
  '__TAURI__', '__TAURI_INTERNALS__',
]);

const failures = [];

// ---------------------------------------------------------------------------
// Targets: every script index.html loads, plus the locale tables (which
// register onto OL_STRINGS and are legitimate providers of globals).
// ---------------------------------------------------------------------------
const localesDir = join(RENDERER, 'locales');
const targets = [
  ...readdirSync(join(RENDERER, 'js'))
    .filter((f) => f.endsWith('.jsx') || f.endsWith('.js'))
    .map((f) => join('js', f)),
  'strings.js',
  'tokens.js',
  ...(existsSync(localesDir)
    ? readdirSync(localesDir).filter((f) => f.endsWith('.js')).map((f) => join('locales', f))
    : []),
];

// ---------------------------------------------------------------------------
// Pass 1 — syntax, via the shipped babel-standalone.
// ---------------------------------------------------------------------------
const sources = new Map();
for (const rel of targets) {
  const source = readFileSync(join(RENDERER, rel), 'utf8');
  sources.set(rel, source);
  try {
    Babel.transform(source, { presets: ['react'], filename: rel });
  } catch (e) {
    failures.push(`${rel}: ${String(e.message).split('\n')[0]}`);
  }
}

if (failures.length) {
  for (const f of failures) console.error(`✗ ${f}`);
  console.error(`\nrenderer transpile FAILED: ${failures.length} of ${targets.length} file(s)`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Pass 2 — undefined globals.
//
// For each file: the names it BINDS at the top level (which land in the shared
// global scope, since these are classic scripts, not modules) plus the names it
// publishes onto `window`, against the names it REFERENCES without binding.
// ---------------------------------------------------------------------------

/** Names a file publishes as `window.Foo = ...` or `Object.assign(window, {Foo})`. */
function windowExports(programPath) {
  const names = new Set();
  programPath.traverse({
    // window.Foo = ...
    AssignmentExpression(p) {
      const left = p.node.left;
      if (
        left.type === 'MemberExpression' && !left.computed &&
        left.object.type === 'Identifier' && left.object.name === 'window' &&
        left.property.type === 'Identifier'
      ) {
        names.add(left.property.name);
      }
    },
    // Object.assign(window, { Foo: expr })
    //
    // SHORTHAND properties are deliberately skipped. `{ Foo }` is a *reference*
    // to `Foo`, not a definition of it — if `Foo` is bound in this file it is
    // already counted via `scope.bindings`, and if it isn't, the shorthand is
    // itself the broken reference this pass is looking for. Counting shorthand
    // here is exactly what let the `IconSmoke` bug through: the name was still
    // listed in icons.jsx's export block long after its `const` was deleted, so
    // treating that block as authoritative made the file look like it provided
    // the very identifier it was crashing on.
    CallExpression(p) {
      const { callee, arguments: args } = p.node;
      const isObjectAssign =
        callee.type === 'MemberExpression' && !callee.computed &&
        callee.object.type === 'Identifier' && callee.object.name === 'Object' &&
        callee.property.type === 'Identifier' && callee.property.name === 'assign';
      if (!isObjectAssign || !args.length) return;
      if (!(args[0].type === 'Identifier' && args[0].name === 'window')) return;
      for (const arg of args.slice(1)) {
        if (arg.type !== 'ObjectExpression') continue;
        for (const prop of arg.properties) {
          if (prop.type === 'ObjectProperty' && !prop.computed && !prop.shorthand) {
            if (prop.key.type === 'Identifier') names.add(prop.key.name);
            else if (prop.key.type === 'StringLiteral') names.add(prop.key.value);
          }
        }
      }
    },
  });
  return names;
}

const provided = new Set(RUNTIME_GLOBALS);
const referenced = new Map(); // rel -> Map<name, line>

for (const rel of targets) {
  const ast = parser.parse(sources.get(rel), {
    sourceType: 'script',
    plugins: rel.endsWith('.jsx') ? ['jsx'] : [],
  });

  let programPath = null;
  traverse(ast, { Program(p) { programPath = p; p.stop(); } });
  if (!programPath) continue;

  for (const name of Object.keys(programPath.scope.bindings)) provided.add(name);
  for (const name of windowExports(programPath)) provided.add(name);

  // `scope.globals` is Babel's own record of every identifier referenced in
  // this file that nothing in it binds — exactly the question being asked.
  const seen = new Map();
  for (const [name, node] of Object.entries(programPath.scope.globals)) {
    seen.set(name, (node.loc && node.loc.start.line) || 0);
  }
  referenced.set(rel, seen);
}

const undefinedRefs = [];
for (const [rel, names] of referenced) {
  for (const [name, line] of names) {
    if (!provided.has(name)) undefinedRefs.push({ rel, name, line });
  }
}

if (undefinedRefs.length) {
  console.error('Undefined globals — referenced by a renderer script, bound by none:\n');
  for (const { rel, name, line } of undefinedRefs) {
    console.error(`✗ ${rel}:${line}  ${name}`);
  }
  console.error(
    `\nrenderer globals FAILED: ${undefinedRefs.length} undefined reference(s).\n` +
    'Each one throws at runtime the moment its file is evaluated or its page is\n' +
    'rendered. Define it, or add it to RUNTIME_GLOBALS if it is a real runtime global.'
  );
  process.exit(1);
}

console.log(
  `renderer OK — ${targets.length} files parsed with the shipped babel-standalone, ` +
  'no undefined globals'
);
process.exit(0);
