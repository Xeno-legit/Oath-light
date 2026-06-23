//! NSFW image classification — Phase 4 "optional AI monitoring".
//!
//! Runs the Image-Guard-2.0 model (SigLIP2-base, 5-class) exported to FP32 ONNX
//! by `desktop-app/ml/export_onnx.py`. Inference is native via ONNX Runtime
//! (`ort`). This is a *probabilistic, opt-in* safety net layered AFTER the
//! deterministic domain/graylist blocking — never a replacement for it.
//!
//! Preprocessing mirrors SigLIP exactly (see meta.json `preprocessor`):
//!   resize 224x224 (bilinear) -> rescale 1/255 -> normalize mean/std 0.5 -> CHW.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use image::imageops::FilterType;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use serde::Serialize;

/// Model input side length (SigLIP2-base-patch16-224).
const INPUT: usize = 224;

/// Label order MUST match the model's id2label (meta.json):
/// 0 Anime-SFW, 1 Hentai, 2 Normal-SFW, 3 Pornography, 4 Enticing or Sensual.
pub const LABELS: [&str; 5] = [
    "Anime-SFW",
    "Hentai",
    "Normal-SFW",
    "Pornography",
    "Enticing or Sensual",
];

const IDX_HENTAI: usize = 1;
const IDX_PORN: usize = 3;
const IDX_ENTICING: usize = 4;

/// One classification result, serialized to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct Classification {
    /// Per-label probabilities (softmax of logits), same order as `LABELS`.
    pub scores: Vec<f32>,
    /// Highest-probability label and its probability.
    pub top_label: String,
    pub top_score: f32,
    /// Hard-NSFW probability = P(Hentai) + P(Pornography). The threshold the
    /// blocking policy keys off of.
    pub nsfw_score: f32,
    /// Broader sensitive probability = nsfw_score + P(Enticing or Sensual), for
    /// a stricter optional tier.
    pub sensitive_score: f32,
}

/// A loaded model + its (mutex-guarded) inference session.
pub struct NsfwClassifier {
    session: Mutex<Session>,
}

impl NsfwClassifier {
    /// Load a model from an ONNX file.
    pub fn load(model_path: &Path) -> Result<Self, String> {
        let session = Session::builder()
            .map_err(|e| format!("session builder: {e}"))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| format!("opt level: {e}"))?
            .with_intra_threads(4)
            .map_err(|e| format!("threads: {e}"))?
            .commit_from_file(model_path)
            .map_err(|e| format!("load {}: {e}", model_path.display()))?;
        Ok(Self { session: Mutex::new(session) })
    }

    /// SigLIP preprocessing -> flat CHW buffer of length 3*224*224.
    fn preprocess(img: &image::DynamicImage) -> Vec<f32> {
        let rgb = img.to_rgb8();
        let resized = if rgb.width() as usize == INPUT && rgb.height() as usize == INPUT {
            rgb
        } else {
            // SigLIP uses PIL bilinear (resample=2); Triangle is the bilinear filter.
            image::imageops::resize(&rgb, INPUT as u32, INPUT as u32, FilterType::Triangle)
        };
        let n = INPUT * INPUT;
        let mut buf = vec![0f32; 3 * n];
        for (i, px) in resized.pixels().enumerate() {
            // CHW planar layout: [R plane][G plane][B plane]. rescale + normalize.
            buf[i] = (px[0] as f32 / 255.0 - 0.5) / 0.5;
            buf[n + i] = (px[1] as f32 / 255.0 - 0.5) / 0.5;
            buf[2 * n + i] = (px[2] as f32 / 255.0 - 0.5) / 0.5;
        }
        buf
    }

    /// Raw model logits for an image (length 5). Exposed for validation.
    pub fn logits(&self, img: &image::DynamicImage) -> Result<Vec<f32>, String> {
        let pixels = Self::preprocess(img);
        let input = Tensor::from_array(([1usize, 3, INPUT, INPUT], pixels))
            .map_err(|e| format!("tensor: {e}"))?;
        let mut session = self.session.lock().map_err(|e| format!("lock: {e}"))?;
        let outputs = session
            .run(ort::inputs!["pixel_values" => input])
            .map_err(|e| format!("run: {e}"))?;
        let (_shape, data) = outputs["logits"]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("extract: {e}"))?;
        Ok(data.to_vec())
    }

    /// Classify a decoded image into per-label probabilities + aggregates.
    pub fn classify_image(&self, img: &image::DynamicImage) -> Result<Classification, String> {
        let logits = self.logits(img)?;
        Ok(Self::postprocess(&logits))
    }

    /// Classify an image file on disk.
    pub fn classify_path(&self, path: &Path) -> Result<Classification, String> {
        let img = image::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
        self.classify_image(&img)
    }

    fn softmax(logits: &[f32]) -> Vec<f32> {
        let max = logits.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        let exps: Vec<f32> = logits.iter().map(|x| (x - max).exp()).collect();
        let sum: f32 = exps.iter().sum();
        exps.iter().map(|x| x / sum).collect()
    }

    fn postprocess(logits: &[f32]) -> Classification {
        let scores = Self::softmax(logits);
        let (top_idx, top_score) = scores
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(i, s)| (i, *s))
            .unwrap_or((0, 0.0));
        let nsfw_score = scores[IDX_HENTAI] + scores[IDX_PORN];
        let sensitive_score = nsfw_score + scores[IDX_ENTICING];
        Classification {
            scores,
            top_label: LABELS[top_idx].to_string(),
            top_score,
            nsfw_score,
            sensitive_score,
        }
    }
}

/// Locate the ONNX model: `PUREPATH_MODEL` env override, then alongside the exe
/// (`models/` or next to it), then walking up the dev tree to `desktop-app/ml`.
pub fn resolve_model_path() -> Option<PathBuf> {
    const NAME: &str = "image-guard-2.0.onnx";

    if let Ok(p) = std::env::var("PUREPATH_MODEL") {
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
    candidates.push(PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../ml/", "image-guard-2.0.onnx")));

    candidates.into_iter().find(|p| p.exists())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The Rust pipeline must reproduce the Python onnxruntime logits for the
    /// deterministic 224x224 test image (within float tolerance).
    #[test]
    fn matches_reference_logits() {
        let model = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../ml/image-guard-2.0.onnx"));
        let img_path = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../ml/test_224.png"));
        if !model.exists() || !img_path.exists() {
            eprintln!("skipping: artifacts missing ({})", model.display());
            return;
        }
        // From meta.json validation.onnx_logits.
        let expected = [
            -0.5427414178848267f32,
            -2.263718366622925,
            5.576085090637207,
            -3.821108818054199,
            -1.4703426361083984,
        ];
        let clf = NsfwClassifier::load(&model).expect("load model");
        let img = image::open(&img_path).expect("open test image");
        let got = clf.logits(&img).expect("inference");
        assert_eq!(got.len(), 5);
        let max_abs = got.iter().zip(expected.iter()).map(|(a, b)| (a - b).abs()).fold(0f32, f32::max);
        assert!(max_abs < 1e-2, "logits diverged: got {got:?} expected {expected:?} (max|d|={max_abs})");
    }
}
