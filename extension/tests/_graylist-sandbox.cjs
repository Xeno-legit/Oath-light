// extension/tests/_graylist-sandbox.cjs — shared MAIN-world sandbox for the two
// graylist suites (test-graylist-inject.cjs, test-graylist-platforms.cjs).
// Not itself a test file (doesn't match the test-*.cjs glob run-all.cjs uses).
//
// graylist-inject.js is an IIFE that patches `window.fetch` in place and guards
// against double injection, so there is no export to call and every case needs a
// FRESH realm. This builds one: a `vm` context carrying the handful of browser
// globals the interceptor actually touches, with the REAL file evaluated into it.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT_ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(EXT_ROOT, 'graylist-inject.js'), 'utf8');

// Build a sandbox pinned to `href`. Returns the context; `ctx.fetch` is the
// PATCHED fetch, `ctx.__posted` collects postMessage traffic.
function makeSandbox(href) {
  const u = new URL(href);
  const posted = [];
  let nextBody = '{}';

  const ctx = {
    console,
    URL,
    Response,
    Headers,
    setTimeout,
    clearTimeout,
    location: { href, hostname: u.hostname, pathname: u.pathname },
    document: {
      currentScript: { dataset: { mode: 'standard' } },
      documentElement: { style: {} }
    },
    // The "network" — every request resolves to whatever the test last staged.
    fetch: () => Promise.resolve(new Response(nextBody, {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' }
    }))
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.postMessage = (m) => { posted.push(m); };
  ctx.__posted = posted;
  ctx.__stage = (obj) => { nextBody = JSON.stringify(obj); };

  // Minimal XHR whose prototype satisfies the interceptor's descriptor guard, so
  // the XHR branch is evaluated at load rather than skipped.
  function FakeXHR() {}
  FakeXHR.prototype.open = function () {};
  FakeXHR.prototype.send = function () {};
  Object.defineProperty(FakeXHR.prototype, 'responseText', { configurable: true, get() { return ''; } });
  Object.defineProperty(FakeXHR.prototype, 'response', { configurable: true, get() { return ''; } });
  ctx.XMLHttpRequest = FakeXHR;

  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'graylist-inject.js' });
  return ctx;
}

// Stage a payload, run it through the patched fetch for `url`, return the JSON
// the page would have received.
async function through(ctx, url, payload) {
  ctx.__stage(payload);
  const res = await ctx.fetch(url);
  return res.json();
}

// Page-block messages the interceptor emitted.
const blocks = (ctx) => ctx.__posted.filter((m) => m && m.__oathLight === 'graylist-page-block');

// Resolve a dotted path ('' = the root itself, 'body.creators' = nested).
function at(obj, dotted) {
  if (!dotted) return obj;
  return dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

module.exports = { makeSandbox, through, blocks, at };
