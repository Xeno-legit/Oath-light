#!/usr/bin/env python3
"""
One-time ONNX export for Oath Light's NSFW AI layer.

Model: prithivMLmods/Image-Guard-2.0-Post0.1  (SigLIP2-base, 5-class, Apache-2.0)

This script processes ZERO NSFW images. It only:
  - downloads the model weights,
  - traces the graph with a *dummy random tensor* -> image-guard-2.0.onnx (FP32),
  - prints the exact preprocessing config + id2label (for the Rust side),
  - prints reference logits for a fixed-seed input so the Rust `ort` port can be
    numerically validated against the reference implementation.

Because no explicit imagery is involved, it is safe to run on Colab/Kaggle too.

Local (ephemeral, no permanent Python install) with uv:
    uv run --with "transformers" --with "torch" --with "onnx" --with "pillow" \
        desktop-app/ml/export_onnx.py

Colab / Kaggle:
    !pip install -q transformers torch onnx pillow
    %run export_onnx.py
"""

import json
import torch
from transformers import AutoModelForImageClassification
from huggingface_hub import hf_hub_download

REPO = "prithivMLmods/Image-Guard-2.0-Post0.1"
OUT = "image-guard-2.0.onnx"
OPSET = 17

def main() -> None:
    print(f"[1/5] loading {REPO} ...")
    model = AutoModelForImageClassification.from_pretrained(REPO, torch_dtype=torch.float32)
    model.eval()
    # Read preprocessing values straight from preprocessor_config.json (avoids
    # instantiating AutoImageProcessor, which drags in torchvision).
    pp_path = hf_hub_download(REPO, "preprocessor_config.json")
    with open(pp_path, "r", encoding="utf-8") as fh:
        preprocessor = json.load(fh)

    # ---- Emit everything the Rust side must replicate exactly --------------
    print("\n===== ID2LABEL (index -> class) =====")
    print(json.dumps(model.config.id2label, indent=2))

    print("\n===== PREPROCESSOR CONFIG (replicate in Rust) =====")
    print(json.dumps(preprocessor, indent=2, default=str))

    # ---- Export (dummy tensor -> no image data touched) -------------------
    print(f"\n[2/5] exporting -> {OUT} (opset {OPSET}, fp32) ...")
    dummy = torch.randn(1, 3, 224, 224, dtype=torch.float32)
    torch.onnx.export(
        model,
        (dummy,),
        OUT,
        input_names=["pixel_values"],
        output_names=["logits"],
        dynamic_axes={"pixel_values": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=OPSET,
        do_constant_folding=True,
        dynamo=False,  # stable TorchScript exporter -> predictable io names + dynamic batch
    )

    # ---- Reference logits for numerical validation of the Rust port -------
    print("[3/5] computing reference logits for a fixed-seed input ...")
    torch.manual_seed(0)
    ref_in = torch.randn(1, 3, 224, 224, dtype=torch.float32)
    with torch.no_grad():
        ref_logits = model(ref_in).logits[0].tolist()

    print("\n===== REFERENCE VECTORS (for Rust validation) =====")
    # A few summary stats so the exact dummy tensor can be reconstructed/checked.
    print("REF_INPUT_SEED = 0  (torch.randn(1,3,224,224))")
    print("REF_INPUT_SUM  =", float(ref_in.sum()))
    print("REF_INPUT_MEAN =", float(ref_in.mean()))
    print("REF_LOGITS     =", json.dumps(ref_logits))

    # ---- Optional ONNXRuntime self-check (if onnxruntime is present) ------
    print("\n[4/5] optional onnxruntime cross-check ...")
    onnx_logits = None
    max_abs = None
    try:
        import onnxruntime as ort  # noqa
        sess = ort.InferenceSession(OUT, providers=["CPUExecutionProvider"])
        onnx_logits = sess.run(["logits"], {"pixel_values": ref_in.numpy()})[0][0].tolist()
        print("ONNX_LOGITS    =", json.dumps(onnx_logits))
        max_abs = max(abs(a - b) for a, b in zip(ref_logits, onnx_logits))
        print(f"MAX|torch-onnx| = {max_abs:.3e}  (should be ~1e-4 or smaller)")
    except Exception as e:  # onnxruntime not installed -> skip, not fatal
        print("  (skipped onnxruntime check:", e, ")")

    # ---- Deterministic test image -> validation logits for the Rust port ---
    # A fixed 224x224 RGB pattern (already model size, so no resize) lets the Rust
    # side reproduce the exact preprocessing (rescale 1/255 -> normalize 0.5/0.5
    # -> CHW) and assert its ort logits match. Validates plumbing + rescale +
    # normalize + channel order, independent of the resize algorithm.
    print("\n[4b/5] building deterministic test image + validation logits ...")
    val_logits = None
    try:
        import numpy as np
        from PIL import Image
        yy, xx = np.mgrid[0:224, 0:224]
        rgb = np.stack([(xx % 256), (yy % 256), ((xx + yy) % 256)], axis=-1).astype(np.uint8)
        Image.fromarray(rgb, "RGB").save("test_224.png")
        arr = np.asarray(Image.open("test_224.png").convert("RGB"), dtype=np.float32) / 255.0
        arr = (arr - 0.5) / 0.5
        chw = np.transpose(arr, (2, 0, 1))[None].astype(np.float32)
        import onnxruntime as ort2
        sess2 = ort2.InferenceSession(OUT, providers=["CPUExecutionProvider"])
        val_logits = sess2.run(["logits"], {"pixel_values": chw})[0][0].tolist()
        print("VAL_IMAGE   = test_224.png (224x224 deterministic)")
        print("VAL_LOGITS  =", json.dumps(val_logits))
    except Exception as e:
        print("  (skipped validation image:", e, ")")

    # ---- Durable sidecar so the Rust side never depends on console capture -
    meta = {
        "repo": REPO,
        "onnx_file": OUT,
        "opset": OPSET,
        "id2label": model.config.id2label,
        "preprocessor": preprocessor,
        "reference": {
            "input_seed": 0,
            "input_shape": [1, 3, 224, 224],
            "input_sum": float(ref_in.sum()),
            "input_mean": float(ref_in.mean()),
            "torch_logits": ref_logits,
            "onnx_logits": onnx_logits,
            "max_abs_torch_onnx": max_abs,
        },
        "validation": {
            "image": "test_224.png",
            "preprocess": "rgb /255 -> (x-0.5)/0.5 -> CHW [1,3,224,224]",
            "onnx_logits": val_logits,
        },
    }
    with open("image-guard-2.0.meta.json", "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2, default=str)
    print("\nwrote image-guard-2.0.meta.json")

    print("\n[5/5] done. Ship", OUT, "with the app and feed the values above to the Rust side.")


if __name__ == "__main__":
    main()
