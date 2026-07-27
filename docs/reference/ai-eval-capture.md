# Oath Light — Phase 4 AI Classifier Evaluation Task (agent handoff)

**Goal:** Build a real labelled test set and score the on-device NSFW classifier
(Image-Guard-2.0) on it. Produce an accuracy / false-positive / false-negative /
recall scorecard and recommend an `nsfw_score` threshold.

This is the [[visual-test-nsfw-leaks]] discipline applied to the AI layer: we
judge the model on real screenshots of the sites Oath Light actually deals with,
not on synthetic or hand-picked images.

---

## Hard handling constraints (do not violate)

1. **NSFW captures live ONLY in a gitignored dir.** Save everything under
   `.playwright-mcp/eval/` (the whole `.playwright-mcp/` tree is gitignored at the
   repo root). Never move them elsewhere, never `git add` them.
2. **Never commit captures or this list of sites.** Do not stage, do not push.
3. **Do NOT open/render the NSFW screenshots yourself** (no Read tool on them, no
   inlining). The classifier reads them *by file path*. You only ever see and
   report the numeric scores — never the imagery.
4. **Oath Light must be OFF during capture** (the user disables it so the sites
   load). Confirm with the user it's off before you start; remind them to turn it
   back on when done.
5. The HF token at `desktop-app/ml/.hf_token` must never be printed/echoed.
   (You won't need it for this task — the model is already exported.)

---

## Pre-conditions (already done — just verify)

- Model exported: `desktop-app/ml/image-guard-2.0.onnx` (~343MB, gitignored) plus
  `image-guard-2.0.meta.json`. If missing, see
  [desktop-app/ml/export_onnx.py](../desktop-app/ml/export_onnx.py).
- Rust inference engine + CLI are built and tested
  ([desktop-app/src-tauri/src/nsfw.rs](../desktop-app/src-tauri/src/nsfw.rs),
  example `classify`).
- Playwright MCP browser is logged into the user's accounts (e.g. Xenolegit on
  HuggingFace) — use it for capture.

---

## The model: labels & aggregate scores

5-class SigLIP2 classifier. Labels (index order):

| idx | label                | meaning                                  |
|-----|----------------------|------------------------------------------|
| 0   | Anime-SFW            | safe anime/illustration                  |
| 1   | Hentai               | explicit anime/drawn                     |
| 2   | Normal-SFW           | safe photo / real-life                   |
| 3   | Pornography          | explicit real                            |
| 4   | Enticing or Sensual  | suggestive but not explicit              |

Aggregates the CLI reports:
- `nsfw_score = P(Hentai) + P(Pornography)`  → the primary block signal.
- `sensitive_score = nsfw_score + P(Enticing or Sensual)` → broader/suggestive.

---

## Step 1 — Capture ~20 NSFW screenshots

Save as `.playwright-mcp/eval/nsfw_01_<site>.jpg`, `nsfw_02_…`, etc. Pull from the
categories Oath Light targets so the test is representative:

- **Boorus (explicit rating):** rule34.xxx, gelbooru, e621 — use random-post or a
  search on an explicit tag; capture the full post view (the big image), not just
  thumbnail grids.
- **Hentai galleries:** nhentai gallery/reader pages.
- **Blacklisted tube sites:** the hard-blacklisted domains in the extension's
  blocklists (a real porn-tube landing/video page).
- **Newgrounds (adult filter on):** an adult-rated art/animation page.
- **Graylist sites showing NSFW:** if logged in, a NSFW pixiv/reddit/etc. page —
  the graylist exists precisely because these can leak NSFW.

Aim for a mix of **photographic** and **drawn/anime** NSFW (the model splits them).

## Step 2 — Capture ~20 SFW screenshots

Save as `.playwright-mcp/eval/sfw_01_<site>.jpg`, etc. **From the same kinds of
sites** so the test measures real false-positive risk, not easy wins:

- Safe-rating booru posts (`rating:safe`), SFW pixiv/reddit, newgrounds games/art
  (non-adult), normal SFW pages, ordinary article/landing pages.
- Include some "borderline-but-clean" cases (swimwear, anime characters, fan-art)
  — that's where false positives bite.

## Capture mechanics (Playwright MCP)

- Use `browser_navigate` then `browser_take_screenshot` with the target filename.
- **Screenshots frequently time out (5000ms) on the first try — retry once.** The
  retry almost always succeeds. If a page hangs, `browser_wait_for` a couple
  seconds then retry.
- Random-post URLs (e.g. `…page=post&s=random`) redirect to a specific post —
  fine; just name the file by site.

**Known limitation to design around:** the in-app monitor downscales the *whole
screen* to 224×224, so small thumbnails wash out. For this eval, capture pages
where the NSFW/SFW content fills most of the frame (post/reader/video views,
zoomed in), which matches the "dominant content" case the model should catch.

---

## Step 3 — Classify everything

From `desktop-app/src-tauri/`:

```
cargo run --example classify -- ../../.playwright-mcp/eval/nsfw_01_*.jpg ../../.playwright-mcp/eval/nsfw_02_*.jpg ...
```

You can pass all 40 paths in one invocation (it loads the model once). Easiest:
glob all `nsfw_*.jpg` and `sfw_*.jpg`. Per image it prints each label's %, the top
label, `nsfw=` and `sensitive=`.

> The first build may take ~1 min. Release build (`--release`) is much faster at
> inference if you care about timing, but debug is fine for scoring accuracy.

---

## Step 4 — Scorecard

Tabulate, treating each image's true label (nsfw vs sfw, from its filename) against
the model:

- Pick a candidate threshold on `nsfw_score` (start at 0.5).
- Count TP / FP / TN / FN. Compute **accuracy, precision, recall, false-positive
  rate**.
- Sweep the threshold (e.g. 0.3 / 0.5 / 0.7) and show how FP vs FN trade off.
- Note any systematic misses (e.g. drawn NSFW under-scored, swimwear false
  positives) — those drive the label-weighting policy.
- **Recommend a threshold** for the app's block/warn decision, and say whether
  `sensitive_score` should drive a softer "warn" tier above the hard block.

Report the scorecard as a table in your final message. Do **not** include the
images. Remind the user to re-enable Oath Light.
