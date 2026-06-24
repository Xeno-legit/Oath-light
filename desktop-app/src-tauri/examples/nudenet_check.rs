//! Verify the Rust NudeNet port matches the Python reference scores.
//!   cargo run --example nudenet_check -- <img> [img...]
use std::path::Path;
use app_lib::nudenet::{self, NudeNetDetector};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let model = nudenet::resolve_model_path().expect("nudenet model not found");
    eprintln!("model: {}", model.display());
    let det = NudeNetDetector::load(&model).expect("load");
    println!("{:<44}{:>10}{:>10}", "image", "explicit%", "covered%");
    for p in &args {
        let img = match image::open(p) { Ok(i) => i, Err(e) => { eprintln!("skip {p}: {e}"); continue; } };
        match det.detect_image(&img) {
            Ok(r) => println!("{:<44}{:>9.1}{:>10.1}", Path::new(p).file_name().unwrap().to_string_lossy(), r.explicit*100.0, r.covered*100.0),
            Err(e) => eprintln!("{p}: {e}"),
        }
    }
}
