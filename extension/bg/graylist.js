// bg/graylist.js — Graylist ENFORCEMENT side effects (cookies + URL rewrites)
// for gray-area domains that have their own NSFW filter (Reddit over18,
// Pixiv R18, Twitter/X sensitive-content flag, YouTube Restricted Mode, AO3
// explicit-tag exclusion, Dailymotion family filter). Distinct from the pure
// graylist SEARCH matching in bg/matching.js: these functions call chrome.
// cookies / mutate a URL and are invoked from handleBlock() in background.js,
// not from shouldBlockUrl(). Relocated verbatim — no logic changes.

// GRAYLIST ENFORCEMENT — Cookies & URL rewrites for gray-area domains
// Forces maximum restriction on sites that have NSFW filters.

// Pre-built Map: base domain → array of cookie configs (O(1) lookup)
const GRAYLIST_COOKIE_MAP = new Map([
  ['reddit.com', [
    { domain: 'reddit.com',  name: 'over18', value: '0', path: '/' },
    { domain: '.reddit.com', name: 'over18', value: '0', path: '/' }
  ]],
  ['pixiv.net', [
    { domain: 'pixiv.net',  name: 'R18', value: '0', path: '/' },
    { domain: '.pixiv.net', name: 'R18', value: '0', path: '/' }
  ]],
  ['twitter.com', [
    { domain: 'twitter.com',  name: 'sensitive_content_flag', value: 'false', path: '/' },
    { domain: '.twitter.com', name: 'sensitive_content_flag', value: 'false', path: '/' }
  ]],
  ['x.com', [
    { domain: 'x.com',  name: 'sensitive_content_flag', value: 'false', path: '/' },
    { domain: '.x.com', name: 'sensitive_content_flag', value: 'false', path: '/' }
  ]],
  // YouTube Restricted Mode (report §1.4). PREF cookie field f2=8000000 is the
  // user-level Restricted Mode bit YouTube reads to filter mature/suggestive
  // videos. Set on both the bare and dot domain so www/m/music subdomains inherit.
  ['youtube.com', [
    { domain: 'youtube.com',  name: 'PREF', value: 'f2=8000000', path: '/' },
    { domain: '.youtube.com', name: 'PREF', value: 'f2=8000000', path: '/' }
  ]]
]);

// Pre-built Map: base domain → enforce(urlObj) function
const GRAYLIST_URL_REWRITE_MAP = new Map([
  ['archiveofourown.org', (urlObj) => {
    const p = urlObj.pathname;
    if (p.includes('/works') || p.includes('/tags') || p.includes('/search')) {
      let changed = false;
      const params = urlObj.searchParams;
      if (!params.getAll('work_search[excl_tag_names][]').includes('Explicit')) {
        params.append('work_search[excl_tag_names][]', 'Explicit');
        changed = true;
      }
      if (!params.getAll('work_search[excl_tag_names][]').includes('Mature')) {
        params.append('work_search[excl_tag_names][]', 'Mature');
        changed = true;
      }
      return changed ? urlObj.toString() : null;
    }
    return null;
  }],
  ['dailymotion.com', (urlObj) => {
    if (urlObj.searchParams.get('family_filter') !== 'true') {
      urlObj.searchParams.set('family_filter', 'true');
      return urlObj.toString();
    }
    return null;
  }]
]);

// Fast set of all graylist domains that need any enforcement
const GRAYLIST_ENFORCE_DOMAINS = new Set([
  ...GRAYLIST_COOKIE_MAP.keys(),
  ...GRAYLIST_URL_REWRITE_MAP.keys()
]);

// Match hostname to a graylist enforcement domain (or null)
function matchGraylistEnforceDomain(hostname) {
  if (GRAYLIST_ENFORCE_DOMAINS.has(hostname)) return hostname;
  const parts = hostname.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    if (GRAYLIST_ENFORCE_DOMAINS.has(parent)) return parent;
  }
  return null;
}

// Set restrictive cookies — only called for matching domains
async function enforceGraylistCookies(baseDomain) {
  const cookies = GRAYLIST_COOKIE_MAP.get(baseDomain);
  if (!cookies) return;
  for (const cookie of cookies) {
    const cleanDomain = cookie.domain.replace(/^\./, '');
    try {
      await chrome.cookies.set({
        url: `https://${cleanDomain}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: true,
        sameSite: 'lax'
      });
    } catch (e) {
      // chrome.cookies may not be available
    }
  }
}

// Rewrite URL with safe-mode params — only called for matching domains
function enforceGraylistUrlRewrite(url, baseDomain) {
  const enforce = GRAYLIST_URL_REWRITE_MAP.get(baseDomain);
  if (!enforce) return null;
  try {
    return enforce(new URL(url));
  } catch (_) {
    return null;
  }
}
