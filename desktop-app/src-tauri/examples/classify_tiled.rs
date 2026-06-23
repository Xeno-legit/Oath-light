//! Tiling experiment: can region inference recover photographic NSFW WITHOUT
//! wrecking precision on borderline content?
//!
//!   cargo run --example classify_tiled -- <img> [img...]
//!
//! Scores whole + 2x2 + 3x3 = 14 views per image and gathers richer per-tile
//! stats so we can compare aggregation policies (naive max-pool vs. multi-tile
//! voting vs. whole-frame-for-drawn + multi-tile-porn-for-photo).
//!
//! True label from filename prefix (`nsfw_` positive, `sfw_` negative).

use std::path::Path;

use app_lib::nsfw::{self, NsfwClassifier};

const IDX_HENTAI: usize = 1;
const IDX_PORN: usize = 3;

struct Row {
    pos: bool,
    base_nsfw: f32,
    max_nsfw: f32,
    // counts over the 13 sub-tiles (exclude the whole frame)
    n_nsfw70: u32,
    n_nsfw90: u32,
    max_porn: f32,
    n_porn70: u32,
    n_porn90: u32,
}

fn sub_tiles(img: &image::DynamicImage) -> Vec<image::DynamicImage> {
    let (w, h) = (img.width(), img.height());
    let mut out = Vec::new();
    for &n in &[2u32, 3u32] {
        let (cw, ch) = (w / n, h / n);
        if cw == 0 || ch == 0 {
            continue;
        }
        for r in 0..n {
            for c in 0..n {
                let x = c * cw;
                let y = r * ch;
                let tw = if c == n - 1 { w - x } else { cw };
                let th = if r == n - 1 { h - y } else { ch };
                out.push(img.crop_imm(x, y, tw, th));
            }
        }
    }
    out
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("usage: cargo run --example classify_tiled -- <image> [image...]");
        std::process::exit(2);
    }
    let model = nsfw::resolve_model_path().expect("model not found");
    eprintln!("model: {}", model.display());
    let clf = NsfwClassifier::load(&model).expect("load model");

    let mut rows: Vec<Row> = Vec::new();
    println!(
        "\n{:<42}{:>9}{:>9}{:>8}{:>9}{:>8}",
        "image", "base", "maxNSFW", "n70", "maxPorn", "nP70"
    );
    for path in &args {
        let img = match image::open(path) {
            Ok(i) => i,
            Err(e) => {
                eprintln!("skip {path}: {e}");
                continue;
            }
        };
        let base = clf.classify_image(&img).expect("classify");
        let mut max_nsfw = base.nsfw_score;
        let mut max_porn = base.scores[IDX_PORN] + base.scores[IDX_HENTAI] * 0.0; // porn only
        let mut max_porn_only = base.scores[IDX_PORN];
        let (mut n_nsfw70, mut n_nsfw90, mut n_porn70, mut n_porn90) = (0u32, 0, 0, 0);
        for v in sub_tiles(&img) {
            let c = clf.classify_image(&v).expect("classify tile");
            max_nsfw = max_nsfw.max(c.nsfw_score);
            let porn = c.scores[IDX_PORN];
            max_porn_only = max_porn_only.max(porn);
            if c.nsfw_score >= 0.70 {
                n_nsfw70 += 1;
            }
            if c.nsfw_score >= 0.90 {
                n_nsfw90 += 1;
            }
            if porn >= 0.70 {
                n_porn70 += 1;
            }
            if porn >= 0.90 {
                n_porn90 += 1;
            }
        }
        let _ = max_porn;
        max_porn = max_porn_only;
        let name = Path::new(path).file_name().unwrap().to_string_lossy().to_string();
        let pos = name.starts_with("nsfw_");
        println!(
            "{:<42}{:>8.1}%{:>8.1}%{:>8}{:>8.1}%{:>8}",
            name,
            base.nsfw_score * 100.0,
            max_nsfw * 100.0,
            n_nsfw70,
            max_porn * 100.0,
            n_porn70
        );
        rows.push(Row { pos, base_nsfw: base.nsfw_score, max_nsfw, n_nsfw70, n_nsfw90, max_porn, n_porn70, n_porn90 });
    }

    let n_pos = rows.iter().filter(|r| r.pos).count();
    let n_neg = rows.len() - n_pos;

    let card = |label: &str, pred: &dyn Fn(&Row) -> bool| {
        let (mut tp, mut fn_, mut fp, mut tn) = (0, 0, 0, 0);
        for r in &rows {
            match (r.pos, pred(r)) {
                (true, true) => tp += 1,
                (true, false) => fn_ += 1,
                (false, true) => fp += 1,
                (false, false) => tn += 1,
            }
        }
        let acc = (tp + tn) as f32 / rows.len() as f32 * 100.0;
        let recall = tp as f32 / n_pos as f32 * 100.0;
        let fpr = fp as f32 / n_neg as f32 * 100.0;
        let prec = if tp + fp > 0 { tp as f32 / (tp + fp) as f32 * 100.0 } else { 0.0 };
        println!(
            "{:<46} TP={:2} FN={:2} FP={:2} TN={:2} | acc={:5.1}% recall={:5.1}% FPR={:5.1}% prec={:5.1}%",
            label, tp, fn_, fp, tn, acc, recall, fpr, prec
        );
    };

    println!("\n===== POLICY SCORECARD ({n_pos} NSFW / {n_neg} SFW) =====");
    card("A baseline  whole nsfw>=0.50", &|r| r.base_nsfw >= 0.50);
    card("B naive max tiled nsfw>=0.50", &|r| r.max_nsfw >= 0.50);
    card("C vote  >=2 tiles nsfw>=0.70", &|r| r.n_nsfw70 >= 2);
    card("D vote  >=3 tiles nsfw>=0.70", &|r| r.n_nsfw70 >= 3);
    card("E vote  >=2 tiles nsfw>=0.90", &|r| r.n_nsfw90 >= 2);
    card("F whole>=0.5 OR >=2 tiles porn>=0.70", &|r| r.base_nsfw >= 0.50 || r.n_porn70 >= 2);
    card("G whole>=0.5 OR >=3 tiles porn>=0.70", &|r| r.base_nsfw >= 0.50 || r.n_porn70 >= 3);
    card("H whole>=0.5 OR >=2 tiles porn>=0.90", &|r| r.base_nsfw >= 0.50 || r.n_porn90 >= 2);
    card("I whole>=0.5 OR maxPorn>=0.90", &|r| r.base_nsfw >= 0.50 || r.max_porn >= 0.90);
}
