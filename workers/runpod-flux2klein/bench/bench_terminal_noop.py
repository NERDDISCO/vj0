#!/usr/bin/env python3
"""Same-process quality and timing test of the redundant terminal prediction.

Uses the real worker functions and same original schedule for both variants.
Benchmarks include input JPEG decode, VAE encode, generation/decode, JPEG encode,
and final CUDA sync. Network, IPC, browser and display are excluded.
"""
import argparse
import hashlib
import importlib.metadata
import importlib.util
import io
import json
import os
from pathlib import Path
import time
from datetime import datetime, timezone

from metrics import distribution, parse_sizes
from terminal_noop import install, PIPELINE_SHA256, SCHEDULER_SHA256


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--worker-script", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--sizes", type=parse_sizes, default=parse_sizes("512x288,768x448,1024x576"))
    p.add_argument("--steps", default="2,3,4")
    p.add_argument("--alphas", default="0.05,0.10,0.18")
    p.add_argument("--seeds", default="42,123")
    p.add_argument("--frames", type=int, default=100)
    p.add_argument("--repeats", type=int, default=3)
    p.add_argument("--warmup", type=int, default=4)
    p.add_argument("--quality-phases", type=int, default=3)
    a = p.parse_args()
    steps = [int(x) for x in a.steps.split(",")]
    alphas = [float(x) for x in a.alphas.split(",")]
    seeds = [int(x) for x in a.seeds.split(",")]
    if not all(1 <= x <= 4 for x in steps) or not all(0 <= x <= 0.5 for x in alphas):
        p.error("Steps 1..4 and alpha 0..0.5 required")
    if min(a.frames, a.repeats, a.warmup, a.quality_phases) < 1:
        p.error("Positive counts required")
    a.output.mkdir(parents=True, exist_ok=True)
    import numpy as np
    import torch
    from PIL import Image, ImageDraw
    spec = importlib.util.spec_from_file_location("vj0_terminal_worker", a.worker_script)
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    records = []
    manifest = {
        "started_utc": datetime.now(timezone.utc).isoformat(),
        "arguments": {k: str(v) if isinstance(v, Path) else v for k, v in vars(a).items()},
        "versions": {k: importlib.metadata.version(k) for k in ("torch", "torchao", "diffusers", "numpy", "pillow")},
        "gpu": torch.cuda.get_device_name(0),
        "worker_sha256": hashlib.sha256(a.worker_script.read_bytes()).hexdigest(),
        "pipeline_sha256": PIPELINE_SHA256,
        "scheduler_sha256": SCHEDULER_SHA256,
        "benchmark_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "helper_sha256": hashlib.sha256(Path(__file__).with_name("terminal_noop.py").read_bytes()).hexdigest(),
        "records": records,
        "status": "running",
    }

    def save(record):
        records.append(record)
        with (a.output / "records.jsonl").open("a") as f:
            f.write(json.dumps(record) + "\n")
        (a.output / "result.json").write_text(json.dumps(manifest, indent=2) + "\n")
        print(json.dumps(record), flush=True)

    pipe = worker.setup_pipeline()
    install(pipe)
    prompts = worker.PromptCache(pipe)
    prompt = "colorful abstract art, vibrant neon lights, psychedelic patterns"
    embeds = prompts.get(prompt)
    manifest["scheduler_config"] = dict(pipe.scheduler.config)

    def make_input(w, h, phase):
        img = Image.new("RGB", (w, h), (10, 10, 10))
        draw = ImageDraw.Draw(img)
        xs = np.arange(w)
        ys = h * (0.5 + 0.24 * np.sin(xs / w * 4 * np.pi + phase * 0.25)
                  + 0.07 * np.sin(xs / w * 19 * np.pi - phase * 0.17))
        draw.line(list(zip(xs.tolist(), ys.tolist())), fill="white", width=max(2, w // 128))
        if phase % 3 == 2:
            draw.rectangle((w // 5, h // 5, w // 3, h // 3), fill=(40, 200, 255))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return buf.getvalue()

    def run(raw, w, h, n, alpha, seed, enabled, trace=False):
        pipe._vj0_skip_terminal_enabled = enabled
        before = pipe._vj0_terminal_skips
        img = worker.bytes_to_pil(raw, w, h)
        lat = worker.encode_image_to_latents(pipe, img, w, h)
        trace_rows = []
        if trace:
            gen = torch.Generator(device="cuda").manual_seed(seed)
            noise = torch.randn(lat.shape, generator=gen, dtype=lat.dtype, device="cuda")

            def callback(_pipe, index, timestep, kwargs):
                tensor = kwargs["latents"].detach().float().cpu().numpy().copy()
                trace_rows.append((index, float(timestep), tensor))
                return kwargs

            out = pipe(image=None, prompt=None, prompt_embeds=embeds,
                latents=alpha * lat + (1-alpha) * noise,
                sigmas=np.linspace(1-alpha, 0.0, n).tolist(),
                height=h, width=w, num_inference_steps=n,
                generator=torch.Generator(device="cuda").manual_seed(seed),
                callback_on_step_end=callback, callback_on_step_end_tensor_inputs=["latents"]).images[0]
        else:
            out = worker.generate(pipe, lat, embeds, alpha, n, h, w, seed)
        jpg = worker.pil_to_jpeg_bytes(out, 80)
        torch.cuda.synchronize()
        return out, jpg, pipe._vj0_terminal_skips-before, trace_rows

    def quality_run(raw, w, h, n, alpha, seed, enabled, trace):
        # Per-call explicit CUDA generators must leave both global RNGs alone.
        cpu_before = torch.random.get_rng_state().clone()
        cuda_before = torch.cuda.get_rng_state().clone()
        value = run(raw,w,h,n,alpha,seed,enabled,trace=trace)
        unchanged = (torch.equal(cpu_before,torch.random.get_rng_state()) and
                     torch.equal(cuda_before,torch.cuda.get_rng_state()))
        return value, bool(unchanged)

    try:
        with torch.no_grad():
            for w, h in a.sizes:
                inputs = [make_input(w, h, i) for i in range(max(a.frames, a.quality_phases))]
                for n in steps:
                    t0 = time.perf_counter()
                    for enabled in (False, True):
                        for _ in range(a.warmup):
                            run(inputs[0], w, h, n, 0.1, 42, enabled)
                    save({"status": "warmup", "size": [w,h], "steps": n,
                          "seconds": time.perf_counter()-t0})
                    for alpha in alphas:
                        for seed in seeds:
                            for phase in range(a.quality_phases):
                                # Alternate order across quality cases as well.
                                values = {}
                                rng_unchanged = []
                                for enabled in ((False,True) if phase % 2 == 0 else (True,False)):
                                    values[enabled], rng_ok = quality_run(inputs[phase],w,h,n,alpha,seed,enabled,trace=True)
                                    rng_unchanged.append(rng_ok)
                                ref, ref_jpg, _, ref_trace = values[False]
                                new, new_jpg, skips, new_trace = values[True]
                                ref_arr, new_arr = np.asarray(ref), np.asarray(new)
                                trace_equal = len(ref_trace) == len(new_trace) == n and all(
                                    ai == bi and at == bt and np.array_equal(aa,ba)
                                    for (ai,at,aa),(bi,bt,ba) in zip(ref_trace,new_trace))
                                finite = all(np.isfinite(row[2]).all() for row in ref_trace + new_trace)
                                equal = np.array_equal(ref_arr,new_arr)
                                # Reference last scheduler update must leave the
                                # prior latents exactly unchanged (when n > 1).
                                ref_terminal_equal = n > 1 and np.array_equal(ref_trace[-2][2],ref_trace[-1][2])
                                # Validate the actual worker.generate path used
                                # by timing, without step callbacks/CPU syncs.
                                untraced = {}
                                for enabled in ((True,False) if phase % 2 == 0 else (False,True)):
                                    untraced[enabled], rng_ok = quality_run(inputs[phase],w,h,n,alpha,seed,enabled,trace=False)
                                    rng_unchanged.append(rng_ok)
                                uref, uref_jpg, uref_skips, _ = untraced[False]
                                unew, unew_jpg, unew_skips, _ = untraced[True]
                                actual_equal = np.array_equal(np.asarray(uref),np.asarray(unew))
                                trace_path_equal = (ref_jpg == uref_jpg and new_jpg == unew_jpg)
                                record = {"status": "quality", "size": [w,h], "steps": n,
                                    "alpha": alpha, "seed": seed, "phase": phase,
                                    "pixels_equal": bool(equal), "jpeg_equal": ref_jpg == new_jpg,
                                    "callback_latents_equal": bool(trace_equal), "latents_finite": bool(finite),
                                    "reference_terminal_latents_equal": bool(ref_terminal_equal),
                                    "actual_generate_pixels_equal": bool(actual_equal),
                                    "actual_generate_jpeg_equal": uref_jpg == unew_jpg,
                                    "traced_and_actual_generate_equal": bool(trace_path_equal),
                                    "global_rng_unchanged": all(rng_unchanged),
                                    "global_rng_checks": rng_unchanged,
                                    "actual_reference_skips": uref_skips,
                                    "actual_candidate_skips": unew_skips,
                                    "terminal_skips": skips,
                                    "sigmas": pipe.scheduler.sigmas.detach().cpu().tolist(),
                                    "pixel_mse": float(np.mean((ref_arr.astype(float)-new_arr.astype(float))**2))}
                                save(record)
                                if phase == 0 and seed == seeds[0] and alpha == alphas[0]:
                                    ref.save(a.output / f"{w}x{h}-{n}step-reference.png")
                                    new.save(a.output / f"{w}x{h}-{n}step-terminal-noop.png")
                                if not (equal and ref_jpg == new_jpg and trace_equal and finite and
                                        actual_equal and uref_jpg == unew_jpg and trace_path_equal and
                                        all(rng_unchanged) and uref_skips == 0 and unew_skips == skips and
                                        skips == (1 if n > 1 else 0) and (ref_terminal_equal or n == 1)):
                                    raise RuntimeError("Quality or skip-count guard failed; see last quality record")
                    for repeat in range(a.repeats):
                        for enabled in ((False, True) if repeat % 2 == 0 else (True, False)):
                            durations = []
                            skips = 0
                            start = time.perf_counter()
                            for raw in inputs[:a.frames]:
                                frame_start = time.perf_counter()
                                _, _, skipped, _ = run(raw,w,h,n,0.1,42,enabled)
                                durations.append((time.perf_counter()-frame_start)*1000)
                                skips += skipped
                            seconds = time.perf_counter()-start
                            save({"status":"measured", "size":[w,h], "steps":n,
                                "variant":"terminal-noop" if enabled else "baseline",
                                "repeat":repeat, "frames":a.frames, "wall_seconds":seconds,
                                "fps":a.frames/seconds, "timing_ms":distribution(durations),
                                "terminal_skips":skips})
        manifest["status"] = "complete"
    except Exception as e:
        manifest["status"] = "failed"
        save({"status":"failure", "error":str(e), "type":type(e).__name__})
        raise
    finally:
        manifest["finished_utc"] = datetime.now(timezone.utc).isoformat()
        (a.output / "result.json").write_text(json.dumps(manifest,indent=2)+"\n")


if __name__ == "__main__":
    main()
