# OTA signing keys (plan item 3.5)

Over-the-air blocklist updates are trusted by a **raw Ed25519** signature over
the `lists-manifest.json` bytes (RFC 8032, no prehash — deliberately *not*
minisign, whose Blake2b prehash the vendored single-file `@noble/ed25519` in the
extension can't verify). One signature, three verifiers that must never drift:

| Component | Verifier | Key source |
| --- | --- | --- |
| Desktop app | `ed25519-dalek` (`src-tauri/src/ota.rs`) | baked `OTA_PUBKEY_*_HEX` in `core/src/ota.rs` |
| Extension (no desktop) | vendored noble (`bg/ota.js`) | `OTA_PUBKEYS_HEX` in `bg/ota.js` |
| Publisher (CI) | vendored noble (`scripts/ota/sign-manifest.mjs`) | `OTA_SIGNING_KEY` secret |

**Two** public keys are baked (active + spare) so the active key can be rotated
after a loss/compromise without stranding already-deployed clients: a signature
from *either* baked key verifies.

## The current keys are DEV keys

The keys baked in `core/src/ota.rs` and `bg/ota.js` today are **development**
keys, generated locally for testing the pipeline end-to-end. Their private seeds
are stored, gitignored, in `scripts/ota/dev-keys.env` for local signing
experiments — they are **not** secret and **must not** be used to sign a real
release. Before the first production release:

1. Generate a fresh production keypair on an offline/trusted machine:
   ```
   node scripts/ota/sign-manifest.mjs --gen-key
   ```
   The 32-byte **public** key prints to stdout; the **private** seed prints to
   stderr. Do this twice (active + spare).
2. Bake the two public keys into **both** `desktop-app/core/src/ota.rs`
   (`OTA_PUBKEY_ACTIVE_HEX` / `OTA_PUBKEY_SPARE_HEX`) and
   `extension/bg/ota.js` (`OTA_PUBKEYS_HEX`) — they must match byte-for-byte.
3. Store the **active** private seed as the `OTA_SIGNING_KEY` GitHub Actions
   repository secret. Store the **spare** private seed only offline (paper /
   hardware / a separate password manager) — it never touches CI until a
   rotation.
4. Delete `scripts/ota/dev-keys.env`.

## Publishing an update

`.github/workflows/release-lists.yml` runs on a published Release: it validates
the list shape, builds + signs `lists-manifest.json`, and attaches the manifest,
its `.sig`, and the list files to the release. Consumers fetch them from
`https://github.com/<owner>/<repo>/releases/latest/download/<asset>`.

`version` must be a **monotonically increasing integer** — consumers reject any
manifest whose version is `<=` the one they already have (anti-rollback). The
release workflow derives it from the run number by default, or takes an explicit
`--version` on manual dispatch.

## Rotating the active key

If the active private key is lost or exposed:

1. Promote the spare: in a **signed** release (signed with the spare, which is
   still baked and therefore still trusted), ship a client update that bakes a
   brand-new spare alongside the now-active former-spare.
2. Move the former-spare seed into `OTA_SIGNING_KEY`; generate and offline-store
   a fresh spare seed.
3. From then on, sign with the promoted key.

Because both keys are trusted simultaneously, there is never a window where
deployed clients can't verify a legitimately-signed update.

## Safety floor

No key ceremony can make a bad list safe, so the consumers also enforce, on
every update, independent of the signature:

- **Version monotonicity** — never apply an older/equal version.
- **Whitelist floor** — reject the whole update if any of its domains would
  block a domain on `matching::WHITELIST_DOMAINS` (exact or by parent walk).
- **Built-ins are never deleted** — a corrupt/rejected update simply leaves the
  bundled lists in place; OTA can only ever *add* freshness, never brick
  browsing.
