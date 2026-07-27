// scripts/ci/check-locales.mjs — locale table gate.
//
// check-design-system-sync.mjs proves the locale files are copied verbatim
// to every surface. This one proves their *contents* are usable, which is a
// different failure mode: a locale can be perfectly in sync everywhere and
// still be broken.
//
// The three things it catches, in the order they actually bite:
//
//   1. A translated {placeholder}. `{days}` is not a word — translating it
//      to `{أيام}` prints the literal braces to a person mid-relapse
//      instead of a number. This is the failure this script exists for.
//   2. A key that no longer exists in the English base. Renaming a key and
//      updating only strings.js leaves dead weight in every locale, and the
//      surface silently falls back to English forever with nothing to
//      indicate why.
//   3. A missing voice. A key with no `serious` falls back to `companion`,
//      so serious mode quietly reverts to the soft voice — defeating the
//      point of serious mode without ever erroring.
//
// Missing keys are reported but are NOT a failure: a locale being partway
// translated is a normal state, and the resolver falls back to English per
// key. Failing the build on it would just discourage landing translations
// incrementally.
//
// Run by .github/workflows/ci.yml; safe locally:
//   node scripts/ci/check-locales.mjs
'use strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DS = join(REPO_ROOT, 'design-system');
const LOCALE_DIR = join(DS, 'locales');

const errors = [];
const warnings = [];

// strings.js and the locale files are plain scripts that assign onto the
// global — there is no module to import. Evaluate them in order, exactly
// the way a page or the service worker does, and read the result off the
// global afterwards.
function load() {
  const stringsPath = join(DS, 'strings.js');
  if (!existsSync(stringsPath)) {
    errors.push('design-system/strings.js is missing — it is the base every locale falls back to');
    return null;
  }
  // eslint-disable-next-line no-eval
  (0, eval)(readFileSync(stringsPath, 'utf8'));
  const S = globalThis.OL_STRINGS;
  if (!S || typeof S.registerLocale !== 'function') {
    errors.push('design-system/strings.js loaded but did not expose OL_STRINGS.registerLocale');
    return null;
  }
  if (existsSync(LOCALE_DIR)) {
    for (const f of readdirSync(LOCALE_DIR).filter((n) => n.endsWith('.js')).sort()) {
      try {
        // eslint-disable-next-line no-eval
        (0, eval)(readFileSync(join(LOCALE_DIR, f), 'utf8'));
      } catch (e) {
        errors.push(`locales/${f} threw while loading: ${e.message}`);
      }
    }
  }
  return S;
}

const placeholders = (s) =>
  (String(s).match(/\{[a-zA-Z0-9_]+\}/g) || []).sort().join(',');

const S = load();

if (S) {
  const base = S.strings;
  const baseKeys = Object.keys(base);
  const locales = S.locales().filter((l) => l.code !== 'en');

  if (!baseKeys.length) errors.push('the English base table is empty');

  for (const loc of locales) {
    const keys = Object.keys(loc.strings);
    const label = `locales/${loc.code}.js`;

    if (loc.dir !== 'ltr' && loc.dir !== 'rtl') {
      errors.push(`${label}: dir must be 'ltr' or 'rtl' (got ${JSON.stringify(loc.dir)})`);
    }
    if (!loc.nativeName) {
      errors.push(`${label}: nativeName is required — the picker shows each language in its own script`);
    }

    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(base, key)) {
        errors.push(`${label}: key "${key}" does not exist in the English base (renamed or removed?)`);
        continue;
      }
      for (const voice of ['companion', 'serious']) {
        const translated = loc.strings[key][voice];
        if (translated == null) {
          errors.push(`${label}: "${key}" has no ${voice} voice — serious mode would silently fall back`);
          continue;
        }
        const want = placeholders(base[key][voice]);
        const got = placeholders(translated);
        if (want !== got) {
          errors.push(
            `${label}: "${key}"/${voice} placeholder mismatch — English has [${want || 'none'}], ` +
              `translation has [${got || 'none'}]. Copy {placeholders} verbatim; they are not words.`,
          );
        }
      }
    }

    const missing = baseKeys.filter((k) => !Object.prototype.hasOwnProperty.call(loc.strings, k));
    const done = keys.length - missing.length;
    const pct = baseKeys.length ? Math.round((done / baseKeys.length) * 100) : 0;
    const state = loc.reviewed ? 'reviewed' : 'UNREVIEWED DRAFT';
    console.log(
      `  ${loc.code} (${loc.nativeName}) — ${done}/${baseKeys.length} keys ${pct}%, ${loc.dir}, ${state}`,
    );
    if (missing.length) {
      warnings.push(
        `${label}: ${missing.length} key(s) not translated yet (falls back to English): ` +
          missing.slice(0, 8).join(', ') + (missing.length > 8 ? ', …' : ''),
      );
    }
  }

  if (!locales.length) console.log('  (no locales beyond the English base)');
}

for (const w of warnings) console.log(`  note: ${w}`);

if (errors.length) {
  console.error('\nlocale check FAILED:\n');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('locale check OK');
