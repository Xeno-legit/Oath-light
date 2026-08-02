// extension/tests/_content-sandbox.cjs — loads the REAL content.js into a `vm`
// context with a minimal fake DOM. Not itself a test file.
//
// content.js had no test coverage of any kind. It is an IIFE with no exports
// that runs at document_start and wires itself to the DOM, so the only way to
// exercise it is to give it a DOM to wire to. This is deliberately the smallest
// stub that lets the file boot: enough document/chrome/observer surface for
// initContentScript() to complete, plus hooks to drive it afterwards
// (`__emitMessage`, `__fireDOMContentLoaded`) and to see what it did
// (`__sent`, `__injected`, `__hidden`).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

// A DOM element stub that records what matters and swallows the rest.
function makeEl(tagName) {
  const el = {
    tagName,
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    children: [],
    textContent: '',
    className: '',
    appendChild(c) { el.children.push(c); return c; },
    removeChild() {},
    remove() {},
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener() {},
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains() { return false; }
  };
  return el;
}

/**
 * @param href     page URL the script should think it is on
 * @param opts.query  map of CSS selector -> array of element stubs, for the rules
 *                    that read the DOM. Anything unmatched returns empty.
 */
function makeContentSandbox(href, opts = {}) {
  const u = new URL(href);
  const sent = [];
  const injected = [];
  const messageHandlers = [];
  const domReadyHandlers = [];
  const query = opts.query || {};

  const documentElement = makeEl('html');
  const head = makeEl('head');
  const body = makeEl('body');

  const doc = {
    readyState: opts.readyState || 'complete',
    documentElement,
    head,
    body,
    createElement: (tag) => makeEl(tag),
    getElementById: () => null,
    querySelector: (sel) => (query[sel] && query[sel][0]) || null,
    querySelectorAll: (sel) => query[sel] || [],
    addEventListener: (ev, fn) => { if (ev === 'DOMContentLoaded') domReadyHandlers.push(fn); },
    removeEventListener: () => {}
  };

  const ctx = {
    console: { log() {}, warn() {}, error() {}, debug() {} },
    URL,
    JSON,
    setTimeout: (fn) => { try { fn(); } catch (_) {} return 0; },
    clearTimeout: () => {},
    // Never actually spin: the frontend-detector polls on an interval and the
    // observer debounces; tests drive those paths directly instead.
    setInterval: () => 0,
    clearInterval: () => {},
    location: {
      href: u.href,
      hostname: u.hostname,
      pathname: u.pathname,
      search: u.search,
      protocol: u.protocol
    },
    document: doc,
    // SPA monitoring patches these; it only needs them to exist and be callable.
    history: { pushState() {}, replaceState() {}, back() {}, forward() {} },
    MutationObserver: function () { return { observe() {}, disconnect() {} }; },
    chrome: {
      runtime: {
        id: 'test-extension',
        getURL: (p) => 'chrome-extension://test/' + p,
        sendMessage: (msg, cb) => {
          sent.push(msg);
          if (typeof cb === 'function') { try { cb({ blocked: false }); } catch (_) {} }
          return Promise.resolve({ blocked: false });
        },
        onMessage: { addListener() {} }
      },
      storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } }
    }
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.addEventListener = (ev, fn) => { if (ev === 'message') messageHandlers.push(fn); };
  ctx.removeEventListener = () => {};
  ctx.postMessage = () => {};

  // Watch what gets appended to head/documentElement so injection is observable.
  const watch = (el) => {
    const orig = el.appendChild;
    el.appendChild = (c) => { injected.push(c); return orig.call(el, c); };
  };
  watch(head);
  watch(documentElement);

  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'content.js' });

  ctx.__sent = sent;
  ctx.__injected = injected;
  ctx.__hidden = () => documentElement.style.display === 'none';
  // The relay's first guard is `if (e.source !== window) return;` — its defence
  // against a hostile frame posting into the page. `window` inside a vm context
  // is the context's own global proxy, NOT the sandbox object we hold out here,
  // so an event built out here is correctly rejected. Build the dispatcher
  // INSIDE the realm so `source` is the same `window` the script compares to.
  ctx.__emitMessage = vm.runInContext(
    '(function (handlers) { return function (data) {' +
    '  for (var i = 0; i < handlers.length; i++) handlers[i]({ source: window, data: data });' +
    '}; })',
    ctx
  )(messageHandlers);
  ctx.__fireDOMContentLoaded = () => {
    for (const h of domReadyHandlers.slice()) { try { h(); } catch (_) {} }
  };
  ctx.__blocks = () => sent.filter((m) => m && m.action === 'notifyBlock');
  return ctx;
}

module.exports = { makeContentSandbox, makeEl };
