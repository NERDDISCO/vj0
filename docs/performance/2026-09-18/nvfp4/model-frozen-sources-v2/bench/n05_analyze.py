#!/usr/bin/env python3
"""Untimed N05 image/temporal assessment; never decides visual acceptance.

Requires lpips==0.1.4 with its SqueezeNet backbone (small official weights).
Run after all timed trials in an assigned GPU slot, or explicitly --device cpu.
"""
import argparse
import importlib.metadata
import json
import math
from pathlib import Path
import statistics

from n05_nvfp4 import CONFIGS, sha
from n05_model_probe import SIZES, TEMPORAL_PHASES


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    args = parser.parse_args()
    manifest = json.loads((args.results / "result.json").read_text())
    assert manifest["status"] == "compute-and-images-complete"
    assert importlib.metadata.version("lpips") == "0.1.4"
    target = args.results / "assessment.json"
    if target.exists():
        parser.error("Refusing to overwrite assessment")
    import numpy as np
    import torch
    import lpips
    from PIL import Image
    torch.set_grad_enabled(False)
    metric = lpips.LPIPS(net="squeeze").to(args.device).eval()

    def pixels(path):
        return np.asarray(Image.open(path).convert("RGB")).copy()

    def tensor(array):
        return torch.from_numpy(array).permute(2, 0, 1).unsqueeze(0).to(args.device, torch.float32) / 127.5 - 1

    def distance(a, b):
        value = float(metric(tensor(a), tensor(b)).item())
        if not math.isfinite(value):
            raise RuntimeError("Nonfinite LPIPS result")
        return value

    report = {"source_sha256": sha(__file__), "model_result_sha256": sha(args.results / "result.json"),
              "metric": "LPIPS0.1.4 SqueezeNet, RGB[-1,1], full resolution; no resizing",
              "device": args.device, "visual_acceptance": "pending independent human decision; metrics cannot certify artistic equivalence",
              "quality": [], "temporal": [], "timing": []}
    for row in manifest["records"]:
        if row["phase"] == "quality" and row["variant"] in CONFIGS:
            key, variant = row["fixture"], row["variant"]
            control = pixels(args.results / f"{key}-fp8.png")
            candidate = pixels(args.results / f"{key}-{variant}.png")
            report["quality"].append({"fixture": key, "variant": variant,
                                      **row["comparison"], "lpips": distance(control, candidate)})
    assert len(report["quality"]) == 108
    for width, height in SIZES:
        for variant in CONFIGS:
            a_dir = args.results / f"clip-{width}x{height}-fp8"
            b_dir = args.results / f"clip-{width}x{height}-{variant}"
            controls = [pixels(a_dir / f"{i:03d}.png") for i in range(len(TEMPORAL_PHASES))]
            candidates = [pixels(b_dir / f"{i:03d}.png") for i in range(len(TEMPORAL_PHASES))]
            paired = []
            temporal = []
            previous_a = previous_b = None
            for i, (a, b) in enumerate(zip(controls, candidates)):
                paired.append(Image.fromarray(np.concatenate((a, b), axis=1)))
                row = {"index": i, "input_phase": TEMPORAL_PHASES[i], "lpips_to_control": distance(a, b)}
                if previous_a is not None:
                    da = a.astype(np.float64) - previous_a.astype(np.float64)
                    db = b.astype(np.float64) - previous_b.astype(np.float64)
                    row.update({"control_frame_delta_rms": float(np.sqrt(np.mean(da * da))),
                                "candidate_frame_delta_rms": float(np.sqrt(np.mean(db * db))),
                                "delta_error_rms": float(np.sqrt(np.mean((da - db) ** 2)))})
                temporal.append(row)
                previous_a, previous_b = a, b
            # Lossless WebP preserves true RGB differences in a portable preview.
            preview = args.results / f"paired-{width}x{height}-{variant}.webp"
            paired[0].save(preview, format="WEBP", save_all=True, append_images=paired[1:],
                           duration=100, loop=0, lossless=True)
            report["temporal"].append({"resolution": [width, height], "variant": variant,
                                       "preview": preview.name, "layout": "FP8 left, NVFP4 right", "frames": temporal})
            rows = [r for r in manifest["records"] if r["phase"] == "timing"
                    and r["resolution"] == [width, height] and r["candidate_pair"] == variant]
            keyed = {}
            for row in rows:
                key = (row["pair"], row["variant"])
                assert key not in keyed, "Duplicate timing pair/variant"
                assert row["variant"] in ("fp8", variant)
                assert len(row["frame_ms"]) == row["frames"] == 100
                assert all(math.isfinite(t) and t > 0 for t in row["frame_ms"])
                assert math.isfinite(row["wall_elapsed_ms"]) and row["wall_elapsed_ms"] > 0
                assert sum(row["frame_ms"]) <= row["wall_elapsed_ms"] + .05
                assert math.isclose(row["fps"], row["frames"] * 1000 / row["wall_elapsed_ms"], rel_tol=1e-12)
                keyed[key] = row
            assert set(keyed) == {(i, v) for i in range(3) for v in ("fp8", variant)}
            controls_fps = [keyed[(i, "fp8")]["fps"] for i in range(3)]
            candidates_fps = [keyed[(i, variant)]["fps"] for i in range(3)]
            assert len(controls_fps) == len(candidates_fps) == 3
            a, b = statistics.median(controls_fps), statistics.median(candidates_fps)
            ratios = [candidate / control for control, candidate in zip(controls_fps, candidates_fps)]
            deltas = [candidate - control for control, candidate in zip(controls_fps, candidates_fps)]
            report["timing"].append({"resolution": [width, height], "variant": variant,
                                     "fp8_trial_fps": controls_fps, "nvfp4_trial_fps": candidates_fps,
                                     "fp8_median_fps": a, "nvfp4_median_fps": b,
                                     "ratio_of_arm_medians": b / a,
                                     "matched_pair_speed_ratios": ratios,
                                     "matched_pair_fps_deltas": deltas,
                                     "median_matched_pair_gain_percent": 100 * (statistics.median(ratios) - 1),
                                     "matched_pair_ratio_range": [min(ratios), max(ratios)],
                                     "median_matched_pair_fps_delta": statistics.median(deltas),
                                     "matched_pair_fps_delta_range": [min(deltas), max(deltas)]})
    target.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"quality_pairs": len(report["quality"]), "temporal_pairs": len(report["temporal"]),
                      "assessment": str(target), "visual_acceptance": report["visual_acceptance"]}))


if __name__ == "__main__":
    main()
