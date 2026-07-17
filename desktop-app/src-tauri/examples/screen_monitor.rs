//! Live screen monitor: classify the screen whenever it changes meaningfully.
//!
//!   cargo run --release --example screen_monitor          # run until Ctrl+C
//!   cargo run --release --example screen_monitor -- 20    # run for 20 seconds
//!
//! Prints per-scan timing (capture + inference) and the classification so you
//! can judge real-world performance. The first frame always scans; after that a
//! scan fires only when the frame fingerprint changes past CHANGE_THRESH.

use std::time::{Duration, Instant};

use app_lib::nsfw::{self, NsfwClassifier};
use app_lib::screen;

const POLL: Duration = Duration::from_millis(500);
const FP_SIZE: u32 = 32;
const CHANGE_THRESH: f32 = 6.0; // mean abs luma diff (0..255)
const MIN_SCAN_GAP: Duration = Duration::from_millis(800);

fn main() {
    let max_secs: Option<u64> = std::env::args().nth(1).and_then(|s| s.parse().ok());

    let model = nsfw::resolve_model_path().expect("model not found (set OATHLIGHT_MODEL)");
    eprintln!("model: {}", model.display());
    let load_t = Instant::now();
    let clf = NsfwClassifier::load(&model).expect("load model");
    eprintln!("model loaded in {:.1}s", load_t.elapsed().as_secs_f64());

    let start = Instant::now();
    let mut prev_fp: Vec<u8> = Vec::new();
    let mut last_scan = Instant::now()
        .checked_sub(MIN_SCAN_GAP)
        .unwrap_or_else(Instant::now);
    let (mut scans, mut cap_sum, mut inf_sum) = (0u32, 0f64, 0f64);

    println!(
        "watching screen — poll {}ms, change>{:.0}; {}",
        POLL.as_millis(),
        CHANGE_THRESH,
        max_secs.map_or("Ctrl+C to stop".to_string(), |s| format!("running {s}s"))
    );

    loop {
        if let Some(limit) = max_secs {
            if start.elapsed().as_secs() >= limit {
                break;
            }
        }

        let t_cap = Instant::now();
        let frame = match screen::capture_primary() {
            Ok(f) => f,
            Err(e) => {
                eprintln!("capture error: {e}");
                std::thread::sleep(POLL);
                continue;
            }
        };
        let cap_ms = t_cap.elapsed().as_secs_f64() * 1000.0;

        let fp = screen::fingerprint(&frame, FP_SIZE);
        let change = screen::change_score(&fp, &prev_fp);
        prev_fp = fp;

        if change >= CHANGE_THRESH && last_scan.elapsed() >= MIN_SCAN_GAP {
            let dynimg = image::DynamicImage::ImageRgba8(frame);
            let t_inf = Instant::now();
            match clf.classify_image(&dynimg) {
                Ok(c) => {
                    let inf_ms = t_inf.elapsed().as_secs_f64() * 1000.0;
                    scans += 1;
                    cap_sum += cap_ms;
                    inf_sum += inf_ms;
                    let flag = if c.nsfw_score >= 0.5 { " *** NSFW ***" } else { "" };
                    println!(
                        "[{:6.1}s] d{:5.1}  cap {:5.1}ms  infer {:6.1}ms | {:>20} {:5.1}%  nsfw {:5.1}%  sens {:5.1}%{}",
                        start.elapsed().as_secs_f64(),
                        change,
                        cap_ms,
                        inf_ms,
                        c.top_label,
                        c.top_score * 100.0,
                        c.nsfw_score * 100.0,
                        c.sensitive_score * 100.0,
                        flag,
                    );
                    last_scan = Instant::now();
                }
                Err(e) => eprintln!("classify error: {e}"),
            }
        }

        std::thread::sleep(POLL);
    }

    if scans > 0 {
        println!(
            "\nsummary: {scans} scans | avg capture {:.1}ms | avg inference {:.1}ms",
            cap_sum / scans as f64,
            inf_sum / scans as f64
        );
    } else {
        println!("\nno scans triggered");
    }
}
