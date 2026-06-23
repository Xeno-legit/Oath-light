# Pure Path — On-Device NSFW Detection: Evaluation & Architecture Plan

**Status:** Evaluation complete (Phase 4 AI layer). Architecture decision recorded below.
**Date:** 2026-06-23
**Scope:** The optional, opt-in AI image-monitoring layer — desktop now, phone next. This
sits **after** the deterministic domain/keyword/graylist blocking, never instead of it.

---

## 1. TL;DR / Decision

A single whole-screen image classifier is **not enough** for real-time NSFW blocking. The
fix is a **two-model ensemble layered after the domain blocklist**:

```
1. Domain / keyword / graylist blocklist      ← primary, deterministic (existing strength)
2. AI residual (only what slips past layer 1):
     • NudeNet            → photographic nudity (localized detector, ~0 false positives)
     • SigLIP Image-Guard → drawn / hentai (existing 5-class classifier)
   BLOCK if (NudeNet explicit ≥ T_nn)  OR  (SigLIP nsfw_score ≥ T_sg)
```

Measured on a 15-NSFW / 15-SFW real-screenshot set:

| Policy | Accuracy | Recall | FPR | Precision |
|---|---|---|---|---|
| SigLIP whole-frame only (current) | 73.3% | 53% | 6.7% | 89% |
| SigLIP **tiled** (max-pool) | 76.7% | 100% | **46.7%** | 68% |
| NudeNet only | 76.7% | 53% | **0%** | **100%** |
| **SigLIP + NudeNet ensemble** | **86.7%** | 80% | 6.7% | 92% |
| **Ensemble on the residual after domain blocklist** | **95.8%** | **100%** | 6.7% | 90% |

**Why it works:** the two models are mirror images. NudeNet catches the *photographic*
nudity SigLIP misses; SigLIP catches the *drawn/hentai* NudeNet misses. OR-ing them gains
recall at almost no precision cost. The handful the ensemble still misses are known
porn-tube domains the deterministic blocklist already blocks — never the AI's job.

---

## 2. The model under test: Image-Guard-2.0

- SigLIP2-base (patch16-224), exported to FP32 ONNX (`image-guard-2.0.onnx`, ~343 MB) by
  [export_onnx.py](export_onnx.py). Inference is native via ONNX Runtime (`ort`) in
  [src-tauri/src/nsfw.rs](../src-tauri/src/nsfw.rs).
- Preprocessing mirrors SigLIP: resize 224×224 (bilinear) → /255 → normalize (mean/std 0.5) → CHW.
- **5 classes** (index order): `Anime-SFW`, `Hentai`, `Normal-SFW`, `Pornography`, `Enticing or Sensual`.
- Aggregates the policy keys off:
  - `nsfw_score = P(Hentai) + P(Pornography)` — hard-block signal.
  - `sensitive_score = nsfw_score + P(Enticing or Sensual)` — broader/suggestive tier.

---

## 3. Evaluation methodology

- **Set:** 15 NSFW + 15 SFW real screenshots, captured with Playwright from the site
  categories Pure Path actually targets, balanced **drawn vs photographic** and including
  **borderline-but-clean** SFW (swimwear, fitness, clothed anime) to measure false-positive risk.
- **Drawn NSFW (7):** booru posts (rule34, gelbooru, konachan, yandere), nhentai reader pages.
- **Photographic NSFW (8):** tube landing/video pages (xvideos, pornhub), reddit NSFW, redgifs, a gif.
- **SFW (15):** safe-rated booru art, reddit (EarthPorn/pics), wikipedia, youtube, pexels
  (bikini, swimwear, fitness, portraits, food, dog) — i.e. the same kinds of sites, plus FP traps.
- **Handling rules honored:** captures live only in gitignored `.playwright-mcp/eval/`, never
  staged/committed; the classifier reads them **by file path** — the imagery was never opened or
  rendered by a human or by the agent, only the numeric scores were read.
- **Note on capture realism:** the on-device monitor downscales the *whole screen* to 224×224, so
  small thumbnails wash out. The photographic captures are mostly real web *pages* (chrome + small
  media) — exactly the hard case — which is why they expose the dilution problem so clearly.

**Tooling (all in this folder / src-tauri):**
- [src-tauri/examples/classify.rs](../src-tauri/examples/classify.rs) — per-image SigLIP scores.
- [src-tauri/examples/classify_tiled.rs](../src-tauri/examples/classify_tiled.rs) — whole + 2×2 + 3×3 tiling, max-pool, policy scorecard.
- [bench_nudenet.py](bench_nudenet.py) — NudeNet detector + scorecard (`pip install nudenet`).
- [bench_combined.py](bench_combined.py) — combines the three measured signals into ensemble policies.

---

## 4. Results

### 4.1 Per-image scores (master table)

`SG` = SigLIP whole-frame `nsfw_score` (%); `SEN` = SigLIP `sensitive_score` (%);
`TILED` = SigLIP tiled max-pool `nsfw_score` (%); `NN` = NudeNet max EXPLICIT-exposed (%).

| ID | type | SG | SEN | TILED | NN | NudeNet top detection |
|---|---|---|---|---|---|---|
| nsfw_01 rule34 grid | drawn | 65.6 | 67.6 | 84.2 | 0 | (none) |
| nsfw_02 rule34 | drawn | 67.5 | 67.6 | 99.9 | 0 | (none) |
| nsfw_03 gelbooru | drawn | 99.9 | 99.9 | 99.9 | 79.6 | FEMALE_BREAST_EXPOSED |
| nsfw_04 rule34 | drawn | 75.9 | 76.1 | 89.2 | 0 | (none) |
| nsfw_05 nhentai | drawn | 99.3 | 99.3 | 99.3 | 64.4 | FEMALE_BREAST_EXPOSED |
| nsfw_06 xvideos landing | photo | 1.1 | 1.2 | 50.7 | 0 | (none) |
| nsfw_07 xvideos video | photo | 1.6 | 2.2 | 69.6 | 0 | (none) |
| nsfw_08 pornhub landing | photo | 7.3 | 9.1 | 92.0 | 32.3 | BUTTOCKS_EXPOSED |
| nsfw_09 reddit nsfw | photo | 0.6 | 0.6 | 89.7 | 61.0 | BREAST/GENITALIA_EXPOSED |
| nsfw_10 konachan | drawn | 100.0 | 100.0 | 100.0 | 0 | (none) |
| nsfw_11 pornhub video | photo | 1.1 | 8.5 | 56.2 | 0 | FACE_FEMALE only |
| nsfw_12 redgifs | photo | 0.8 | 9.3 | 80.6 | 62.0 | BUTTOCKS_EXPOSED |
| nsfw_13 pornhub video | photo | 56.0 | 72.8 | 83.8 | 75.6 | FEMALE_BREAST_EXPOSED |
| nsfw_14 pornhub gif | photo | 20.0 | 83.1 | 80.2 | 31.9 | BUTTOCKS_EXPOSED |
| nsfw_15 yandere | drawn | 100.0 | 100.0 | 100.0 | 78.6 | FEMALE_BREAST_EXPOSED |
| sfw_01 konachan "safe" | drawn | 95.4 | 95.4 | 99.0 | 0 | FEMALE_BREAST_COVERED:42 |
| sfw_02 yandere "safe" | drawn | 46.1 | 46.1 | 98.3 | 0 | FEET/FACE only |
| sfw_03 konachan bikini | drawn | 4.9 | 4.9 | 99.9 | 0 | FEMALE_BREAST_COVERED:60 |
| sfw_04 reddit landscape | photo | 0.3 | 0.3 | 0.4 | 0 | (none) |
| sfw_05 pexels bikini | photo | 0.4 | 0.5 | 98.9 | 0 | FACE only |
| sfw_06 pexels swimwear | photo | 4.3 | 26.4 | 62.6 | 0 | FACE only |
| sfw_07 pexels fitness | photo | 2.9 | 3.1 | 45.5 | 0 | (none) |
| sfw_08 reddit pics | photo | 1.7 | 1.7 | 1.7 | 0 | (none) |
| sfw_09 konachan "safe" | drawn | 1.4 | 1.6 | 76.8 | 0 | (none) |
| sfw_10 pexels dog | photo | 0.5 | 1.4 | 3.7 | 0 | FEET only |
| sfw_11 wikipedia | photo | 1.5 | 1.6 | 1.5 | 0 | (none) |
| sfw_12 youtube | photo | 0.2 | 0.3 | 5.1 | 0 | (none) |
| sfw_13 pexels portraits | photo | 0.6 | 0.7 | 29.0 | 0 | FACE only |
| sfw_14 pexels food | photo | 0.6 | 1.2 | 28.5 | 0 | (none) |
| sfw_15 gelbooru clothed | drawn | 1.1 | 1.1 | 81.6 | 0 | FACE only |

### 4.2 SigLIP whole-frame (the current approach)

| Threshold | TP | FN | FP | TN | Accuracy | Precision | Recall | FPR |
|---|---|---|---|---|---|---|---|---|
| nsfw ≥ 0.30 | 8 | 7 | 2 | 13 | 70.0% | 80.0% | 53.3% | 13.3% |
| **nsfw ≥ 0.50** | 8 | 7 | 1 | 14 | 73.3% | 88.9% | 53.3% | 6.7% |
| nsfw ≥ 0.70 | 5 | 10 | 1 | 14 | 63.3% | 83.3% | 33.3% | 6.7% |

**Recall split @0.50:** drawn **100% (7/7)**, photographic **12.5% (1/8)**.

**Diagnosis:** threshold tuning can't help — the photographic misses score 1–9%, far below any
usable cutoff. The true-positive cluster sits at 56–100% and SFW sits ≤46% (lone outlier
sfw_01 at 95), so 0.50 is well-placed *for what this model can see*. The problem is that
explicit content occupying a small fraction of the screen is averaged into gray mush by the
224px downscale, so the model never gets a clean look.

### 4.3 Tiling experiment (multi-scale max-pool)

Scored whole + 2×2 + 3×3 = 14 views per image and max-pooled `nsfw_score`.

| Policy | TP | FN | FP | TN | Accuracy | Recall | FPR | Precision |
|---|---|---|---|---|---|---|---|---|
| tiled nsfw ≥ 0.50 | 15 | 0 | 7 | 8 | 76.7% | **100%** | **46.7%** | 68% |
| tiled nsfw ≥ 0.70 | 12 | 3 | 6 | 9 | 70.0% | 80% | 40% | 67% |
| tiled nsfw ≥ 0.90 | 6 | 9 | 4 | 11 | 56.7% | 40% | 26.7% | 60% |

**Result:** tiling **fixes recall completely (53% → 100%)** — proving the model *can* see every
piece of content. But max-pool is trigger-happy: a cropped bikini region (sfw_05: 0.4% → 99%) or
even a crop of **clothed** anime art (sfw_15 school uniform: 1% → 82%) surfaces one sub-tile that
looks explicit, so FPR explodes to 47%. The 7 flagged SFW were sfw_01/02/03/05/06/09/15.

Of those: bikinis/swimwear (03/05/06) are acceptable over-blocks for an anti-addiction product;
the real cost is over-blocking **clothed anime art** (02/09/15) — i.e. normal anime browsing.
Net: tiling alone trades FN for FP and does **not** reach high accuracy.

### 4.4 NudeNet (localization detector)

`pip install nudenet` → `NudeDetector().detect(path)` returns body-part boxes + scores
(`FEMALE_BREAST_EXPOSED`, `…GENITALIA_EXPOSED`, `BUTTOCKS_EXPOSED`, …, plus `_COVERED` variants).
Block decision = max score over EXPLICIT-exposed classes.

| Policy | TP | FN | FP | TN | Accuracy | Recall | FPR | Precision | drawn-rec | photo-rec |
|---|---|---|---|---|---|---|---|---|---|---|
| explicit ≥ 0.50 | 6 | 9 | 0 | 15 | 70.0% | 40% | 0% | 100% | 43% | 38% |
| **explicit ≥ 0.30** | 8 | 7 | 0 | 15 | 76.7% | 53% | **0%** | **100%** | 43% | 62.5% |
| explicit ≥ 0.3 OR covered ≥ 0.5 | 8 | 7 | 1 | 14 | 73.3% | 53% | 6.7% | 89% | — | — |

**Result:** **0 false positives, 100% precision.** Critically, it read every bikini/swimwear as
`COVERED`, not `EXPOSED` (sfw_03/05/06 explicit = 0%) — exactly the precision a frame classifier
can't give. Its misses are (a) stylized drawn art it can't parse (rule34/konachan → nothing) and
(b) the same diluted tube web pages (06/07/11). It is the precise complement of SigLIP.

### 4.5 Ensemble + residual

| Policy | TP | FN | FP | TN | Accuracy | Recall | FPR | Precision |
|---|---|---|---|---|---|---|---|---|
| SigLIP whole ≥ 0.50 | 8 | 7 | 1 | 14 | 73.3% | 53% | 6.7% | 89% |
| NudeNet explicit ≥ 0.30 | 8 | 7 | 0 | 15 | 76.7% | 53% | 0% | 100% |
| **ENSEMBLE: whole ≥ 0.50 OR NudeNet ≥ 0.30** | 12 | 3 | 1 | 14 | **86.7%** | 80% | 6.7% | 92% |
| ENSEMBLE on residual (drop domain-blocked tube pages) | 9 | 0 | 1 | 14 | **95.8%** | **100%** | 6.7% | 90% |

The 3 the ensemble misses on the full set (nsfw_06/07/11) are pornhub/xvideos pages — already
hard-blocked by the domain list. Removing them (they are not the AI layer's responsibility)
lands the AI layer at **95.8% accuracy / 100% recall / 90% precision** on its true residual.
The single ensemble false positive (sfw_01) is a konachan "safe" image SigLIP scores Hentai 95% —
quite possibly genuinely risqué; if so, real precision is higher.

---

## 5. Diagnosis: whose "fault" is the bad accuracy?

Neither the model nor "AI can't do this." It is a **task–architecture mismatch**:

- A **single-label image classifier** answers "does this whole rectangle look porny?" That's the
  wrong question for a *screen*, which is a composite of UI + text + many images. Downscaling the
  composite to 224px dilutes any small explicit region (→ false negatives), and tiling to fix that
  makes the same classifier fire on innocuous crops (→ false positives).
- A **localization detector** (NudeNet) answers "is there exposed anatomy, and where?" — which is
  the right question, and why it holds 100% precision while still seeing photographic nudity.
- The two model classes have **complementary blind spots** (drawn vs photographic), so the
  ensemble is strong where either alone is weak.

---

## 6. Industry context (what serious blockers use)

**Consumer parental/accountability apps (our peers):**
- **Apple "Communication Safety" / Sensitive Content Warning** — on-device nudity classifier on
  the Neural Engine, run **per image at the OS image pipeline** (no whole-screen compositing).
- **Canopy** — real-time on-device explicit-image filtering, per-image interception.
- **Covenant Eyes / Accountable2You** — *do* use screenshot-the-screen + ML, but ship it as
  **"detect → report to a human partner,"** not autonomous real-time block — because whole-screen
  precision isn't good enough to block on its own. (Same wall we measured.)
- **Bark / Net Nanny / Qustodio** — ML content scoring, largely server-side, alert-based.

**Underlying model tech:**
- Open classifiers (same family as Image-Guard): NSFWJS (MobileNet), Falconsai/AdamCodd ViT,
  Yahoo open_nsfw (ResNet-50), Bumble Private Detector (EfficientNet). All share our limitation.
- **Detectors / localizers:** NudeNet (open-source), and commercial **Hive**, **Sightengine**,
  **AWS Rekognition Content Moderation**, **Google SafeSearch**, **Azure Content Safety** —
  these return hierarchical, *localized* results, not a single frame label.

**Takeaway:** the good ones either intercept individual images or use a detector. Our model isn't
unusually weak — the whole-screen single-classifier *approach* is what caps accuracy.

---

## 7. Recommended architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1 — Deterministic (primary)                           │
│   domain blocklist + keywords + graylist                    │
│   → blocks known porn domains outright (pornhub, xvideos…)   │
├─────────────────────────────────────────────────────────────┤
│ Layer 2 — AI residual (unknown sites only)                  │
│   NudeNet   → photographic nudity   (localized, ~0 FP)       │
│   SigLIP    → drawn / hentai        (existing classifier)    │
│   BLOCK if  NudeNet.explicit ≥ T_nn  OR  SigLIP.nsfw ≥ T_sg  │
│   (optional) WARN if SigLIP.sensitive ≥ 0.50                 │
└─────────────────────────────────────────────────────────────┘
```

**Roles:** SigLIP owns drawn/hentai (≈100% there); NudeNet owns photographic nudity with 0-FP
precision; the blocklist owns known domains so the AI only sees the residual.

### Strictness knob (anti-addiction stance)
NudeNet exposes `EXPOSED` vs `COVERED` classes, so the bikini policy is a **config setting**, not
a model change:
- **Standard:** block on `EXPOSED` classes only → bikinis/swimwear allowed, 0 FP.
- **Strict (anti-addiction default candidate):** also block on `COVERED` intimate classes
  (`FEMALE_BREAST_COVERED`, `BUTTOCKS_COVERED`, …) above a threshold → blocks bikinis/lingerie too,
  with a controllable threshold instead of tiling's all-or-nothing.

### Recommended default thresholds (from this set; re-tune on a larger set)
- `T_nn` (NudeNet explicit) = **0.30**
- `T_sg` (SigLIP nsfw_score) = **0.50**
- Optional WARN tier: `sensitive_score ≥ 0.50` (no SFW image here exceeded 46% sensitive).

---

## 8. Phone plan

- **Both models are ONNX → on-device.** NudeNet is tiny (~a few MB, YOLO-class) → trivial on a
  phone. SigLIP-base is **343 MB → too heavy for mobile as-is**; quantize (int8) or swap the
  drawn-detector for a distilled/lighter classifier before shipping on phone.
- **Acceleration:** NNAPI / Core ML / GPU delegate; run at 1–2 fps and only on screen change.
- **Capture strategy, best → worst:**
  1. **Per-image at the decode/WebView boundary** (our own browser) — kills both dilution (FN) and
     tiling false-positives (FP) at once. Preferred where we control the pipeline.
  2. **Screenshot + ML** (Android MediaProjection / iOS broadcast ext.) — the diluted whole-screen
     case; frame as "warn/blur + log," not perfect autonomous block.
- **Platform reality:** true cross-app per-image interception needs root/hooks on Android, hence
  accountability apps fall back to screenshot + ML + human review there. iOS leans on Apple's own
  Communication Safety + a Network Extension for URLs. **Do not anchor the phone product's promise
  to a single-classifier whole-screen accuracy number.**

---

## 9. Caveats & limitations

- **30 images is directional, not production-grade.** These numbers justify the *architecture*
  decision; they do not certify a shipping accuracy. Build a few-hundred-image labelled set before
  committing the phone build, and re-run the same harness.
- **Unknown photo-porn sites with heavy page chrome** (not domain-blocked, content diluted) still
  weaken *both* models — that's the only place per-image interception or tiling still earns its keep.
- **sfw_01** (konachan "safe") is the lone ensemble FP and may be genuinely racy — verify visually.
- Tiling is kept only as a documented fallback; it is **not** recommended as a primary policy due to
  its 47% FPR.

---

## 10. Roadmap / next steps

1. Build a larger labelled eval set (~200–400 imgs, same capture discipline) and re-bench.
2. Integrate NudeNet's ONNX detector into the Rust `ort` pipeline (YOLO letterbox preprocess + NMS
   postprocess) so the AI layer is a single native ensemble — no Python at runtime.
3. Quantize / distill the SigLIP drawn-classifier for mobile (target < ~50 MB int8) or replace with
   a lighter anime/hentai classifier.
4. Implement the strictness config (EXPOSED-only vs +COVERED) and the optional WARN tier.
5. Prototype per-image WebView interception for the desktop/own-browser path; measure vs screenshot.
6. Wire the AI layer strictly **after** the deterministic blocklist (it only scores the residual).

---

## 11. Artifacts

- Eval captures: `.playwright-mcp/eval/{nsfw,sfw}_*.jpg` — **gitignored, never committed** (and prone
  to being pruned by Defender / sync on this drive; the scores in this doc are the durable record).
- Scripts: [classify.rs](../src-tauri/examples/classify.rs),
  [classify_tiled.rs](../src-tauri/examples/classify_tiled.rs),
  [bench_nudenet.py](bench_nudenet.py), [bench_combined.py](bench_combined.py).
- Model: `image-guard-2.0.onnx` (+ `.meta.json`), gitignored; see [export_onnx.py](export_onnx.py).
- NudeNet: `pip install nudenet` (3.4.2; bundles its detector ONNX).
