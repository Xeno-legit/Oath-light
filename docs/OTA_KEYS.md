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

## The current keys are PRODUCTION keys

Swapped 2026-08-01. The dev pair and `scripts/ota/dev-keys.env` are gone.

| Step | State |
| :-- | :-- |
| 1. Production keypair generated (active + spare) | **done** |
| 2. Both public keys baked into `core/src/ota.rs` **and** `extension/bg/ota.js` | **done** — verified byte-identical |
| 3a. Active private seed → `OTA_SIGNING_KEY` repository secret | **owner — verify** |
| 3b. Spare private seed → offline only, never CI | **owner — verify** |
| 4. Delete `scripts/ota/dev-keys.env` | **done** |

**Only the public keys belong in this repository, and they are already here.**
There is nothing key-shaped left to upload: the public keys ship inside the
clients by design. What CI needs is the 32-byte **private seed**, which
`--gen-key` prints to **stderr** while the public key goes to stdout — so a
transcript that captured only stdout captured only the half that was never
secret.

### Confirm you still hold the active seed

Losing it is silent: nothing fails until the first release that needs signing,
and by then shipped clients trust a key nobody can sign for. Check before you
need it — the seed is never printed, only a verdict:

```
OTA_SIGNING_KEY=<64-hex seed> node scripts/ota/check-seed.mjs
```

`MATCH — ACTIVE` means set that value as the `OTA_SIGNING_KEY` repository secret
(GitHub → Settings → Secrets and variables → Actions → New repository secret, or
`gh secret set OTA_SIGNING_KEY < seedfile`, which reads stdin and never echoes).
`NO MATCH` on both means regenerate — see below. Cheap now, impossible after a
release.

### Regenerating the pair

If the active seed is lost, or you simply want a clean pair before the first
release, generate both at once:

```
node scripts/ota/new-keys.mjs
```

It prints four values, each labelled with the one place it belongs, and writes
**nothing** to disk. Use it in preference to running `--gen-key` twice: that
command puts the public key on stdout and the private seed on stderr, so in a
terminal both land in the same scrollback, same font, both 64 hex characters —
and the two mistakes that follow are silent. Pasting the *public* key into the
GitHub secret breaks signing in a way you discover at the first release; letting
a *private* seed reach a file or a commit hands anyone the ability to push a
blocklist update to every client.

`node scripts/ota/new-keys.mjs --check-only` prints the same layout with
placeholders instead of keys — safe to show on screen or paste into a chat.

**After regenerating, three things are easy to forget:**

1. Bake **both** public keys into `core/src/ota.rs` *and* `extension/bg/ota.js`.
   They must be byte-identical or a manifest one client accepts the other
   rejects.
2. **Rebuild the extension zips.** `bg/ota.js` changed, so the shipped artifacts
   are stale until `python scripts/build-extension-zips.py` runs.
3. Clear the terminal scrollback — both private seeds are in it.

Never commit a seed, never paste one into a file inside the repo, and never put
the **spare** into CI: the spare's whole purpose is to be the key that is still
trustworthy after the active one leaks.

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
