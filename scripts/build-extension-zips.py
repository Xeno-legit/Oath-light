#!/usr/bin/env python3
"""Build the two store zips from the one extension/ tree — byte-reproducibly.

    python scripts/build-extension-zips.py            # build + verify + hash
    python scripts/build-extension-zips.py --check    # verify only, don't write

Two zips come out of `extension/`:

  oathlight-extension-store.zip     Chrome/Chromium (also Edge, Brave, Opera).
                                    The manifest exactly as committed.
  oathlight-extension-firefox.zip   Firefox AMO. Same tree, but with
                                    `background.service_worker` removed —
                                    Gecko runs `background.scripts`.

Why this exists as a script rather than the snippet it replaces in
docs/RELEASE.md: the zips have twice been rebuilt by hand and twice gone out
wrong. The three rules that matter are all easy to get wrong by hand and are
all asserted here, after the write, against the actual zip:

  * Forward-slash paths. PowerShell's Compress-Archive writes backslashes and
    AMO rejects the upload with an unhelpful error.
  * tests/ and _metadata/ stay out. _metadata is a Chrome artifact from
    loading unpacked, not source.
  * strings.js and voice-sync.js go in. They are newer than the last hand-built
    zips, which is exactly how those shipped broken.

Reproducibility (ROADMAP: "Reproducible builds"): every entry is written with
a fixed 1980-01-01 timestamp, fixed Unix permissions, fixed create_system and
a fixed deflate level, in sorted path order. Two checkouts of the same commit
therefore produce byte-identical zips with identical SHA-256s on any OS. This
is the zip half of reproducible builds — the NSIS installer half is not done.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys
import zipfile

REPO = pathlib.Path(__file__).resolve().parent.parent
SRC = REPO / "extension"

# Directory names excluded anywhere in the path. `tests` is the JS suite (CI
# runs it from the repo, it has no business in a store upload); `_metadata` is
# Chrome's generated ruleset index, regenerated on install.
SKIP_DIRS = {"tests", "_metadata", "__pycache__", ".git"}

# Files that must never end up in a store zip regardless of where they sit.
SKIP_FILES = {".DS_Store", "Thumbs.db", "desktop.ini"}

# Files whose absence has previously shipped a broken extension. Asserted
# present in both zips before either is declared good.
REQUIRED = ("manifest.json", "strings.js", "voice-sync.js", "background.js")

# Extensions whose bytes are normalized to LF before packing. The repo is
# developed on Windows with core.autocrlf=true, so these files sit in the
# working tree as CRLF here and as LF on a Linux checkout — the same commit
# would otherwise produce two different zips with two different hashes, which
# is precisely what reproducible builds must rule out. Normalizing in the
# packer (rather than via .gitattributes) makes the zip independent of every
# developer's git config, not just of CI's. Anything not listed here is
# copied byte-for-byte: woff2 and png must never be touched.
TEXT_SUFFIXES = {".js", ".json", ".css", ".html", ".txt", ".md", ".svg"}

# Fixed zip entry metadata. 1980-01-01 00:00:00 is the earliest the zip format
# can represent, so it is the conventional "no timestamp" value.
FIXED_DATE = (1980, 1, 1, 0, 0, 0)
FIXED_MODE = 0o644 << 16  # -rw-r--r--, shifted into the high half of external_attr
UNIX = 3  # ZipInfo.create_system — pin it so Windows and Linux agree


# Design-system files the extension carries as verbatim copies:
# design-system/<source> -> extension/<copy>. The authoritative list for ALL
# surfaces is scripts/design-system-copies.mjs; only the extension's rows are
# repeated here so a store build can assert them without shelling out to node.
# A stale copy here means shipping last month's copy to users — exactly the
# class of "newer in the repo than in the zip" bug this script exists to stop.
DESIGN_SYSTEM_COPIES = [
    ("strings.js", "strings.js"),
    ("locales/ar.js", "locales/ar.js"),
    ("tokens.css", "popup_assets/tokens.css"),
    ("tokens.css", "blocklist_assets/tokens.css"),
]


def stale_design_system_copies() -> list[str]:
    """Extension copies that differ from their design-system source."""
    stale = []
    for source_rel, copy_rel in DESIGN_SYSTEM_COPIES:
        source = REPO / "design-system" / source_rel
        copy = SRC / copy_rel
        if not source.is_file():
            continue  # the node-side gate owns "source is missing"
        if not copy.is_file() or copy.read_bytes() != source.read_bytes():
            stale.append(f"extension/{copy_rel}")
    return stale


def included_files() -> list[pathlib.Path]:
    """Every file that belongs in a zip, in a stable sorted order."""
    out = []
    for p in SRC.rglob("*"):
        if p.is_dir():
            continue
        rel = p.relative_to(SRC)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        if p.name in SKIP_FILES:
            continue
        out.append(p)
    # Sort on the archive name, not the OS path, so separator differences
    # can't reorder entries between platforms.
    return sorted(out, key=lambda p: p.relative_to(SRC).as_posix())


def entry_bytes(p: pathlib.Path, arc: str, manifest_text: str) -> bytes:
    """The exact bytes that go into the zip for one file."""
    # The manifest is substituted rather than read, so the Firefox build never
    # needs a second tree on disk.
    if arc == "manifest.json":
        return manifest_text.encode("utf-8")
    data = p.read_bytes()
    if p.suffix.lower() in TEXT_SUFFIXES:
        data = data.replace(b"\r\n", b"\n")
    return data


def pack(out_path: pathlib.Path, manifest_text: str, files: list[pathlib.Path]) -> None:
    """Write one zip. Entry order, metadata and bytes are fully determined."""
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in files:
            arc = p.relative_to(SRC).as_posix()
            info = zipfile.ZipInfo(arc, date_time=FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = UNIX
            info.external_attr = FIXED_MODE
            z.writestr(info, entry_bytes(p, arc, manifest_text))


def verify(path: pathlib.Path, *, expect_service_worker: bool) -> list[str]:
    """Re-open a written zip and check it against the rules. Returns problems."""
    problems: list[str] = []
    with zipfile.ZipFile(path) as z:
        names = z.namelist()

        if bad := [n for n in names if "\\" in n]:
            problems.append(f"backslash paths (AMO rejects these): {bad[:5]}")

        if leaked := [n for n in names if any(part in SKIP_DIRS for part in n.split("/"))]:
            problems.append(f"excluded directory leaked in: {leaked[:5]}")

        if missing := [r for r in REQUIRED if r not in names]:
            problems.append(f"required file missing: {missing}")

        if bad := z.testzip():
            problems.append(f"corrupt entry: {bad}")

        # The one real difference between the two builds — assert it rather
        # than trust that the right manifest went to the right file.
        manifest = json.loads(z.read("manifest.json"))
        has_sw = "service_worker" in manifest.get("background", {})
        if has_sw != expect_service_worker:
            problems.append(
                f"background.service_worker is {'present' if has_sw else 'absent'}, expected the opposite"
            )
        if "scripts" not in manifest.get("background", {}):
            problems.append("background.scripts missing — Firefox has no entry point")

    return problems


def sha256(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument(
        "--check",
        action="store_true",
        help="build and verify, but leave the existing zips alone",
    )
    ap.add_argument(
        "--sums",
        metavar="PATH",
        help="also write a sha256sum-format manifest to PATH (used by CI to "
        "prove two builds agree)",
    )
    args = ap.parse_args()

    if not SRC.is_dir():
        print(f"error: no extension/ directory at {SRC}", file=sys.stderr)
        return 1

    stale = stale_design_system_copies()
    if stale:
        print("error: extension copies of the design system are stale:", file=sys.stderr)
        for rel in stale:
            print(f"       - {rel}", file=sys.stderr)
        print(
            "       run `node scripts/sync-design-system.mjs` and rebuild "
            "(edit design-system/, never the copy)",
            file=sys.stderr,
        )
        return 1

    chrome_manifest = (SRC / "manifest.json").read_text(encoding="utf-8")
    m = json.loads(chrome_manifest)
    version = m.get("version", "?")

    # Firefox: drop service_worker, keep everything else identical.
    firefox = json.loads(chrome_manifest)
    firefox["background"].pop("service_worker", None)
    firefox_manifest = json.dumps(firefox, indent=2) + "\n"

    files = included_files()
    builds = [
        ("oathlight-extension-store.zip", chrome_manifest, True),
        ("oathlight-extension-firefox.zip", firefox_manifest, False),
    ]

    print(f"extension version {version} — {len(files)} files")

    failed = False
    sums: list[tuple[str, str]] = []
    for name, manifest_text, expect_sw in builds:
        final = REPO / name
        # Always write to a temp path first: a verification failure must never
        # leave a half-built zip sitting where a release would pick it up.
        tmp = REPO / (name + ".tmp")
        pack(tmp, manifest_text, files)

        problems = verify(tmp, expect_service_worker=expect_sw)
        if problems:
            tmp.unlink(missing_ok=True)
            failed = True
            print(f"  FAIL {name}")
            for p in problems:
                print(f"       - {p}")
            continue

        digest = sha256(tmp)
        size = tmp.stat().st_size
        sums.append((digest, name))

        if args.check:
            tmp.unlink()
            print(f"  ok   {name}  {size:>9,} bytes  sha256:{digest}  (not written)")
        else:
            tmp.replace(final)
            print(f"  ok   {name}  {size:>9,} bytes  sha256:{digest}")

    if failed:
        print("\nzips NOT updated — fix the problems above", file=sys.stderr)
        return 1

    if args.sums:
        # sha256sum(1) format, sorted by filename, LF endings — so a plain
        # `diff` between two runs is a meaningful reproducibility check and
        # Windows vs. Linux line endings can't create a false mismatch.
        body = "".join(f"{d}  {n}\n" for d, n in sorted(sums, key=lambda t: t[1]))
        pathlib.Path(args.sums).write_text(body, encoding="utf-8", newline="\n")
        print(f"\nwrote {args.sums}")

    print("\nBoth zips verified: forward-slash paths, no tests/ or _metadata/,")
    print("strings.js and voice-sync.js present, manifests correct per target.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
