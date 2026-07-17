# Chrome Web Store — Privacy Practices Justifications

Copy-paste answers for the "Privacy practices" tab of the Chrome Web Store developer dashboard for **Oath Light – Content Filter**.

---

## Single purpose description

> Oath Light is a content filter that blocks pornographic and other NSFW material. It blocks requests to known adult domains, detects adult keywords in hostnames, enforces SafeSearch on search engines, and hides items that platforms themselves label NSFW (e.g. Reddit, X, Pixiv). All filtering is deterministic and performed locally on the device; no browsing data is collected or transmitted.

---

## Permission justifications

### alarms
> Used to schedule periodic local tasks: checking for signed blocklist data updates and triggering optional local focus/reminder notifications. No data leaves the device.

### cookies
> Used solely to set content-safety preference cookies on supported platforms (for example, setting Reddit's "over 18" preference to off) so that the sites themselves hide adult content. The extension does not read, collect, or transmit cookies for any other purpose.

### declarativeNetRequest
> Core blocking mechanism. Static rulesets enforce SafeSearch on search engines and (optionally) YouTube Restricted Mode by redirecting/modifying requests locally. This is the standard privacy-preserving MV3 way to filter requests without reading page traffic.

### Host permission use (`<all_urls>`)
> Adult content can appear on any domain, so the filter must be able to evaluate the hostname of every navigation against its local blocklist of 385,000+ domains and its keyword engine, and its content script must run on all pages to hide platform-labeled NSFW items. Matching is hostname-based and entirely local; page content is never collected or transmitted.

### nativeMessaging
> Communicates with the optional Oath Light desktop companion app (installed by the user) to provide tamper resistance — e.g. verifying the filter is running and preventing trivial circumvention. Messages are local status/heartbeat data between the extension and the companion app on the same machine; nothing is sent to remote servers.

### Remote code use
> The extension does not execute remotely hosted code. All JavaScript is packaged in the extension. Over-the-air updates deliver only cryptographically signed **data** (JSON domain blocklists), which is verified with a pinned Ed25519 public key before use and is never executed as code.

### storage
> Stores the user's settings (filter options, graylist platform toggles, accountability settings) and cached blocklist data locally on the device.

### tabs
> Used to redirect a tab to the local "blocked" page when it navigates to a blocked site, and to close/update tabs that hit blocked content. Tab URLs are checked locally against the blocklist and are never recorded or transmitted.

### unlimitedStorage
> The bundled and updated domain blocklists (385,000+ entries across multiple JSON shards) exceed the default storage quota, so unlimited storage is required to cache them locally.

### webNavigation
> Used to observe navigation events early (before commit) so blocked hostnames can be intercepted and redirected to the block page before the page loads, including navigations inside frames. Only the hostname is evaluated, locally.

---

## Data usage disclosures (for the checkboxes)

- The extension does **not** collect or transmit user data. All processing is local.
- Certify: does not sell data, does not use data for unrelated purposes, does not use data for creditworthiness/lending.
