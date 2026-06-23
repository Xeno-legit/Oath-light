"""Benchmark NudeNet on the eval capture set (same harness as the SigLIP model).

Reads .playwright-mcp/eval/{nsfw,sfw}_*.jpg, runs the NudeNet detector, and
prints a policy scorecard vs the filename labels. Never displays imagery — only
detected class labels + scores.
"""
import glob, os, sys

from nudenet import NudeDetector

EVAL = os.path.join(os.path.dirname(__file__), "..", "..", ".playwright-mcp", "eval")

EXPLICIT = {
    "FEMALE_GENITALIA_EXPOSED", "MALE_GENITALIA_EXPOSED", "ANUS_EXPOSED",
    "FEMALE_BREAST_EXPOSED", "BUTTOCKS_EXPOSED",
}
COVERED = {
    "FEMALE_BREAST_COVERED", "BUTTOCKS_COVERED", "FEMALE_GENITALIA_COVERED",
    "ANUS_COVERED",
}
DRAWN_TOK = ("konachan", "yandere", "gelbooru", "rule34", "nhentai")

def is_drawn(name): return any(t in name for t in DRAWN_TOK)

def main():
    paths = sorted(glob.glob(os.path.join(EVAL, "nsfw_*.jpg"))) + \
            sorted(glob.glob(os.path.join(EVAL, "sfw_*.jpg")))
    if not paths:
        print("no eval images found at", EVAL); sys.exit(1)

    det = NudeDetector()  # downloads model on first run
    rows = []
    print(f"\n{'image':<44}{'lbl':>4}{'kind':>7}{'expl%':>7}{'cov%':>7}  top-detections")
    for p in paths:
        name = os.path.basename(p)
        pos = name.startswith("nsfw_")
        dets = det.detect(p)
        expl = max([d["score"] for d in dets if d["class"] in EXPLICIT], default=0.0)
        cov = max([d["score"] for d in dets if d["class"] in COVERED], default=0.0)
        top = sorted(dets, key=lambda d: -d["score"])[:3]
        tops = ", ".join(f"{d['class']}:{d['score']*100:.0f}" for d in top) or "(none)"
        kind = "drawn" if is_drawn(name) else "photo"
        print(f"{name:<44}{'N' if pos else 'S':>4}{kind:>7}{expl*100:>7.1f}{cov*100:>7.1f}  {tops}")
        rows.append(dict(name=name, pos=pos, kind=kind, expl=expl, cov=cov))

    n_pos = sum(r["pos"] for r in rows); n_neg = len(rows) - n_pos

    def card(label, pred):
        tp = sum(1 for r in rows if r["pos"] and pred(r))
        fn = sum(1 for r in rows if r["pos"] and not pred(r))
        fp = sum(1 for r in rows if not r["pos"] and pred(r))
        tn = sum(1 for r in rows if not r["pos"] and not pred(r))
        acc = (tp+tn)/len(rows)*100
        rec = tp/n_pos*100 if n_pos else 0
        fpr = fp/n_neg*100 if n_neg else 0
        prec = tp/(tp+fp)*100 if (tp+fp) else 0
        # recall split
        dpos = [r for r in rows if r["pos"] and r["kind"]=="drawn"]
        ppos = [r for r in rows if r["pos"] and r["kind"]=="photo"]
        drec = sum(1 for r in dpos if pred(r))/len(dpos)*100 if dpos else 0
        prec_photo = sum(1 for r in ppos if pred(r))/len(ppos)*100 if ppos else 0
        print(f"{label:<40} TP={tp:2} FN={fn:2} FP={fp:2} TN={tn:2} | acc={acc:5.1f}% rec={rec:5.1f}% "
              f"FPR={fpr:5.1f}% prec={prec:5.1f}% | drawn-rec={drec:5.1f}% photo-rec={prec_photo:5.1f}%")

    print(f"\n===== NUDENET SCORECARD ({n_pos} NSFW / {n_neg} SFW) =====")
    card("explicit>=0.50", lambda r: r["expl"] >= 0.50)
    card("explicit>=0.30", lambda r: r["expl"] >= 0.30)
    card("explicit>=0.20", lambda r: r["expl"] >= 0.20)
    card("explicit>=0.3 OR covered>=0.5", lambda r: r["expl"] >= 0.30 or r["cov"] >= 0.50)
    card("explicit>=0.3 OR covered>=0.3", lambda r: r["expl"] >= 0.30 or r["cov"] >= 0.30)

if __name__ == "__main__":
    main()
