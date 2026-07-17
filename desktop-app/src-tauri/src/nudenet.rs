//! NudeNet photographic-nudity detector (Phase 4 AI ensemble, second model).
//!
//! A tiny (~12 MB) YOLOv8-style ONNX detector that localizes exposed body parts.
//! It is the precise complement to the SigLIP `image-guard` classifier: NudeNet
//! catches *photographic* nudity (with near-zero false positives, and it reads
//! bikinis/swimwear as `*_COVERED` rather than exposed), while SigLIP owns the
//! *drawn / hentai* content NudeNet can't parse. The monitor ORs the two.
//!
//! We only need a block decision, not boxes — so we skip NMS entirely and take
//! the max class score across anchors (NMS only dedupes overlapping boxes; it
//! never changes the per-class maximum).
//!
//! Preprocessing replicates NudeNet's `_read_image` exactly:
//!   RGB -> pad to a square on the right/bottom with black -> resize 320x320
//!   (bilinear) -> rescale 1/255 -> CHW, channel order RGB.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use image::imageops::FilterType;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use serde::Serialize;

/// Detector input side length (NudeNet `320n.onnx`).
const INPUT: usize = 320;

/// Output is `[1, 4 + 18, N]` (4 box coords then 18 class scores), channel-major;
/// class label index `L` (0..17, order from NudeNet's `__labels`) is channel
/// `4 + L`. A row "detects" its per-anchor argmax class if that score ≥ `CONF`
/// (matching NudeNet's `_postprocess`); NMS is unneeded since we only reduce to
/// per-bucket maxima.
const CHANNELS: usize = 4 + 18;
const CONF: f32 = 0.20;

/// EXPLICIT (hard block): BUTTOCKS_EXPOSED(2), FEMALE_BREAST_EXPOSED(3),
/// FEMALE_GENITALIA_EXPOSED(4), ANUS_EXPOSED(6), MALE_GENITALIA_EXPOSED(14).
const EXPLICIT_LBL: [usize; 5] = [2, 3, 4, 6, 14];
/// COVERED intimates (bikini/lingerie — optional stricter tier):
/// FEMALE_GENITALIA_COVERED(0), ANUS_COVERED(15), FEMALE_BREAST_COVERED(16),
/// BUTTOCKS_COVERED(17).
const COVERED_LBL: [usize; 4] = [0, 15, 16, 17];

/// Result of one NudeNet pass: the strongest exposed and covered detections.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct NudeResult {
    /// Max score over EXPLICIT exposed classes (0..1) — the hard-block signal.
    pub explicit: f32,
    /// Max score over COVERED intimate classes (0..1) — bikini/lingerie tier.
    pub covered: f32,
}

/// A loaded NudeNet detector + its (mutex-guarded) inference session.
pub struct NudeNetDetector {
    session: Mutex<Session>,
}

impl NudeNetDetector {
    pub fn load(model_path: &Path) -> Result<Self, String> {
        let session = Session::builder()
            .map_err(|e| format!("session builder: {e}"))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| format!("opt level: {e}"))?
            .with_intra_threads(2)
            .map_err(|e| format!("threads: {e}"))?
            .commit_from_file(model_path)
            .map_err(|e| format!("load {}: {e}", model_path.display()))?;
        Ok(Self { session: Mutex::new(session) })
    }

    /// Pad to a black square (right/bottom), resize to 320, /255, CHW (RGB).
    fn preprocess(img: &image::DynamicImage) -> Vec<f32> {
        let rgb = img.to_rgb8();
        let side = rgb.width().max(rgb.height()).max(1);
        let mut square = image::RgbImage::from_pixel(side, side, image::Rgb([0, 0, 0]));
        for (x, y, px) in rgb.enumerate_pixels() {
            square.put_pixel(x, y, *px);
        }
        let resized = image::imageops::resize(&square, INPUT as u32, INPUT as u32, FilterType::Triangle);
        let n = INPUT * INPUT;
        let mut buf = vec![0f32; 3 * n];
        for (i, px) in resized.pixels().enumerate() {
            buf[i] = px[0] as f32 / 255.0;
            buf[n + i] = px[1] as f32 / 255.0;
            buf[2 * n + i] = px[2] as f32 / 255.0;
        }
        buf
    }

    /// Run the detector and reduce to max exposed/covered scores.
    pub fn detect_image(&self, img: &image::DynamicImage) -> Result<NudeResult, String> {
        let pixels = Self::preprocess(img);
        let input = Tensor::from_array(([1usize, 3, INPUT, INPUT], pixels))
            .map_err(|e| format!("tensor: {e}"))?;
        let mut session = self.session.lock().map_err(|e| format!("lock: {e}"))?;
        let outputs = session
            .run(ort::inputs!["images" => input])
            .map_err(|e| format!("run: {e}"))?;
        let (_shape, data) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("extract: {e}"))?;

        // data is [1, CHANNELS, N] row-major => value(channel c, anchor a) = c*N + a.
        if data.len() < CHANNELS || data.len() % CHANNELS != 0 {
            return Err(format!("unexpected output len {}", data.len()));
        }
        let n = data.len() / CHANNELS;
        let (mut explicit, mut covered) = (0f32, 0f32);
        for a in 0..n {
            // Per-anchor argmax over the 18 class channels (4..CHANNELS).
            let mut best_lbl = 0usize;
            let mut best = data[4 * n + a];
            for lbl in 1..18 {
                let v = data[(4 + lbl) * n + a];
                if v > best {
                    best = v;
                    best_lbl = lbl;
                }
            }
            if best < CONF {
                continue;
            }
            if EXPLICIT_LBL.contains(&best_lbl) {
                explicit = explicit.max(best);
            } else if COVERED_LBL.contains(&best_lbl) {
                covered = covered.max(best);
            }
        }
        Ok(NudeResult { explicit, covered })
    }
}

/// Locate the NudeNet model: `OATHLIGHT_NUDENET` env override, then alongside the
/// exe, then walking up the dev tree to `desktop-app/ml` — same scheme as the
/// SigLIP model in [`crate::nsfw::resolve_model_path`].
pub fn resolve_model_path() -> Option<PathBuf> {
    const NAME: &str = "nudenet-320n.onnx";

    if let Ok(p) = std::env::var("OATHLIGHT_NUDENET") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        candidates.push(dir.join("models").join(NAME));
        candidates.push(dir.join(NAME));
        let mut cur = dir;
        for _ in 0..6 {
            candidates.push(cur.join("ml").join(NAME));
            candidates.push(cur.join("desktop-app").join("ml").join(NAME));
            if !cur.pop() {
                break;
            }
        }
    }
    candidates.push(PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../ml/", "nudenet-320n.onnx")));

    candidates.into_iter().find(|p| p.exists())
}
