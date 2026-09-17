#!/usr/bin/env python3
"""Offline compression study on archived outputs; does not measure live FPS."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import platform
import statistics


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--qualities", default="95,85,80,70,60,50")
    p.add_argument("--samples", type=Path, help="Optional directory for actual compressed samples")
    p.add_argument("inputs", type=Path, nargs="*")
    a = p.parse_args()
    import numpy as np
    import PIL
    from PIL import Image

    root = Path(__file__).resolve().parent.parent
    inputs = a.inputs or (sorted((root / "max-v3").glob("*.png")) +
        [root / "unrelated" / f"{name}_wave1_s070.png" for name in ("dog", "castle", "ramen", "city", "beach")])
    qualities = [int(q) for q in a.qualities.split(",")]
    if 80 not in qualities or any(not 10 <= q <= 100 for q in qualities):
        p.error("Qualities must include baseline 80 and be between 10 and 100")
    if not inputs:
        p.error("No input images")
    rows = []
    if a.samples:
        a.samples.mkdir(parents=True, exist_ok=True)
    for path in inputs:
        original = Image.open(path).convert("RGB")
        reference = np.asarray(original, dtype=np.float32) / 255
        encoded = {}
        for q in qualities:
            buffer = io.BytesIO()
            # Match the worker's Pillow JPEG options exactly, aside from quality.
            original.save(buffer, format="JPEG", quality=q)
            data = buffer.getvalue()
            reconstructed = Image.open(io.BytesIO(data)).convert("RGB")
            if reconstructed.size != original.size:
                raise ValueError("JPEG dimensions changed")
            mse = float(np.mean((reference - np.asarray(reconstructed, dtype=np.float32) / 255) ** 2))
            encoded[q] = {"bytes": len(data), "mse": mse,
                "psnr_db": float(-10 * np.log10(mse)) if mse else None}
            if a.samples:
                (a.samples / f"{path.parent.name}-{path.stem}-q{q}.jpg").write_bytes(data)
        for q in qualities:
            encoded[q]["bytes_relative_to_q80"] = encoded[q]["bytes"] / encoded[80]["bytes"]
        rows.append({"input": str(path.relative_to(root)) if path.is_relative_to(root) else str(path),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "dimensions": original.size, "qualities": encoded})
    summary = {}
    for q in qualities:
        measures = [r["qualities"][q] for r in rows]
        summary[q] = {"images": len(rows),
            "median_bytes": statistics.median(v["bytes"] for v in measures),
            "median_bytes_relative_to_q80": statistics.median(v["bytes_relative_to_q80"] for v in measures),
            "median_psnr_db": statistics.median(v["psnr_db"] for v in measures if v["psnr_db"] is not None)}
    result = {"kind": "offline JPEG compression; archived generated outputs; no live FPS measurement",
        "python": platform.python_version(), "pillow": PIL.__version__, "numpy": np.__version__,
        "platform": platform.platform(), "summary": summary, "images": rows}
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
