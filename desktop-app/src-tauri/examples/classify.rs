//! Dev CLI to test the NSFW classifier on any image.
//!
//!   cargo run --example classify -- <path-to-image> [more images...]
//!
//! Resolves the model the same way the app does (OATHLIGHT_MODEL env, then the
//! exe dir, then desktop-app/ml). Prints per-label probabilities + aggregates.

use std::path::Path;

use app_lib::nsfw::{self, NsfwClassifier};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("usage: cargo run --example classify -- <image> [image...]");
        std::process::exit(2);
    }

    let model = match nsfw::resolve_model_path() {
        Some(p) => p,
        None => {
            eprintln!("model not found — set OATHLIGHT_MODEL or place image-guard-2.0.onnx");
            std::process::exit(1);
        }
    };
    eprintln!("model: {}", model.display());

    let clf = NsfwClassifier::load(&model).expect("failed to load model");

    for path in &args {
        match clf.classify_path(Path::new(path)) {
            Ok(c) => {
                println!("\n=== {path} ===");
                for (label, score) in nsfw::LABELS.iter().zip(c.scores.iter()) {
                    println!("  {label:>22}: {:6.2}%", score * 100.0);
                }
                println!(
                    "  -> top={} ({:.2}%)  nsfw={:.2}%  sensitive={:.2}%",
                    c.top_label,
                    c.top_score * 100.0,
                    c.nsfw_score * 100.0,
                    c.sensitive_score * 100.0,
                );
            }
            Err(e) => eprintln!("\n=== {path} ===\n  ERROR: {e}"),
        }
    }
}
