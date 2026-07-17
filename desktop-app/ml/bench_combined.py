"""Combine the three measured signals on the 30-image eval set and score policies.

Values are taken directly from the prior runs:
  sg   = SigLIP whole-frame nsfw_score (%)         [classify]
  sgt  = SigLIP tiled max-pool nsfw_score (%)      [classify_tiled]
  nn   = NudeNet max EXPLICIT-exposed score (%)    [bench_nudenet]
Label from the nsfw_/sfw_ key prefix.
"""

# name: (label 'N'/'S', kind 'd'/'p', sg, sgt, nn)
D = {
 "nsfw_01": ("N","d",65.64,84.15, 0.0),
 "nsfw_02": ("N","d",67.54,99.90, 0.0),
 "nsfw_03": ("N","d",99.91,99.91,79.6),
 "nsfw_04": ("N","d",75.94,89.20, 0.0),
 "nsfw_05": ("N","d",99.25,99.33,64.4),
 "nsfw_06": ("N","p", 1.12,50.65, 0.0),
 "nsfw_07": ("N","p", 1.63,69.56, 0.0),
 "nsfw_08": ("N","p", 7.32,92.00,32.3),
 "nsfw_09": ("N","p", 0.57,89.65,61.0),
 "nsfw_10": ("N","d",99.98,99.98, 0.0),
 "nsfw_11": ("N","p", 1.12,56.24, 0.0),
 "nsfw_12": ("N","p", 0.81,80.64,62.0),
 "nsfw_13": ("N","p",56.03,83.76,75.6),
 "nsfw_14": ("N","p",19.96,80.15,31.9),
 "nsfw_15": ("N","d",99.99,99.99,78.6),
 "sfw_01":  ("S","d",95.41,99.04, 0.0),
 "sfw_02":  ("S","d",46.07,98.28, 0.0),
 "sfw_03":  ("S","d", 4.91,99.89, 0.0),  # anime bikini
 "sfw_04":  ("S","p", 0.28, 0.41, 0.0),
 "sfw_05":  ("S","p", 0.43,98.94, 0.0),  # photo bikini
 "sfw_06":  ("S","p", 4.26,62.57, 0.0),  # photo swimwear
 "sfw_07":  ("S","p", 2.90,45.50, 0.0),  # photo fitness
 "sfw_08":  ("S","p", 1.65, 1.65, 0.0),
 "sfw_09":  ("S","d", 1.37,76.79, 0.0),  # clothed anime
 "sfw_10":  ("S","p", 0.54, 3.72, 0.0),
 "sfw_11":  ("S","p", 1.53, 1.53, 0.0),
 "sfw_12":  ("S","p", 0.24, 5.10, 0.0),
 "sfw_13":  ("S","p", 0.63,28.97, 0.0),
 "sfw_14":  ("S","p", 0.56,28.54, 0.0),
 "sfw_15":  ("S","d", 1.11,81.55, 0.0),  # clothed anime (school uniform)
}

rows = [(k, v[0]=="N", v[1], v[2], v[3], v[4]) for k, v in D.items()]
n_pos = sum(r[1] for r in rows); n_neg = len(rows)-n_pos

def card(label, pred):
    tp = sum(1 for r in rows if r[1] and pred(r))
    fn = sum(1 for r in rows if r[1] and not pred(r))
    fp = sum(1 for r in rows if not r[1] and pred(r))
    tn = sum(1 for r in rows if not r[1] and not pred(r))
    acc=(tp+tn)/len(rows)*100; rec=tp/n_pos*100; fpr=fp/n_neg*100
    prec=tp/(tp+fp)*100 if tp+fp else 0
    # which SFW were flagged, tagged bikini-ok vs anime-overblock
    flagged=[r[0] for r in rows if not r[1] and pred(r)]
    print(f"{label:<46} TP={tp:2} FN={fn:2} FP={fp:2} TN={tn:2} | acc={acc:5.1f}% rec={rec:5.1f}% FPR={fpr:5.1f}% prec={prec:5.1f}%")
    if flagged: print(f"{'':>4}flagged-SFW: {', '.join(flagged)}")

# r = (name, pos, kind, sg, sgt, nn)
print(f"\n===== POLICY COMPARISON ({n_pos} NSFW / {n_neg} SFW) =====")
card("1 SigLIP whole nsfw>=50",            lambda r: r[3]>=50)
card("2 SigLIP TILED nsfw>=50",            lambda r: r[4]>=50)
card("3 NudeNet explicit>=30",            lambda r: r[5]>=30)
card("4 ENSEMBLE  whole>=50 OR NudeNet>=30", lambda r: r[3]>=50 or r[5]>=30)
card("5 ENSEMBLE  TILED>=50 OR NudeNet>=30", lambda r: r[4]>=50 or r[5]>=30)

print("\n-- residual after domain blocklist (drop known tube domains 06/07/08/11/13/14) --")
TUBE = {"nsfw_06","nsfw_07","nsfw_08","nsfw_11","nsfw_13","nsfw_14"}
rows2 = [r for r in rows if r[0] not in TUBE]
def card2(label, pred):
    tp=sum(1 for r in rows2 if r[1] and pred(r)); fn=sum(1 for r in rows2 if r[1] and not pred(r))
    fp=sum(1 for r in rows2 if not r[1] and pred(r)); tn=sum(1 for r in rows2 if not r[1] and not pred(r))
    npos=sum(r[1] for r in rows2); nneg=len(rows2)-npos
    acc=(tp+tn)/len(rows2)*100; rec=tp/npos*100 if npos else 0; fpr=fp/nneg*100 if nneg else 0
    prec=tp/(tp+fp)*100 if tp+fp else 0
    print(f"{label:<46} TP={tp:2} FN={fn:2} FP={fp:2} TN={tn:2} | acc={acc:5.1f}% rec={rec:5.1f}% FPR={fpr:5.1f}% prec={prec:5.1f}%")
card2("ENSEMBLE whole>=50 OR NudeNet>=30 (residual)", lambda r: r[3]>=50 or r[5]>=30)

if __name__=="__main__": pass
