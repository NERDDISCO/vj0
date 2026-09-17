#!/usr/bin/env python3
"""Benchmark the actual image's Python pipeline without starting another server.

Stop its inference workers first to avoid GPU contention. The source is imported
from --worker-script (default /app/inference_server.py), not copied/reimplemented.
JSONL is appended after every completed cell; a failure produces a failure record.
GPU dependencies are loaded only after CLI argument validation.
"""
import argparse
import hashlib
import importlib.metadata
import importlib.util
import io
import json
import os
from pathlib import Path
import platform
import subprocess
import time
from datetime import datetime, timezone

from metrics import distribution, parse_sizes, throughput


def arguments():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--worker-script", type=Path, default=Path("/app/inference_server.py"))
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--sizes", type=parse_sizes, default=parse_sizes("512x288,768x448,1024x576"))
    p.add_argument("--steps", default="2,3,4")
    p.add_argument("--frames", type=int, default=100)
    p.add_argument("--warmup", type=int, default=8)
    p.add_argument("--repeats", type=int, default=3)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--alpha", type=float, default=0.10)
    p.add_argument("--input-quality", type=int, default=85)
    p.add_argument("--output-quality", type=int, default=80)
    p.add_argument("--scene", choices=["waveform", "detailed", "noise"], default="waveform")
    p.add_argument("--prompt", default="colorful abstract art, vibrant neon lights, psychedelic patterns")
    p.add_argument("--compile-mode", choices=["reduce-overhead", "default", "max-autotune"], default="reduce-overhead")
    p.add_argument("--vae-fp8", choices=["0", "1"], default="1")
    p.add_argument("--variant", choices=["baseline", "constants", "no-stage-sync", "inference-mode", "combined"], default="baseline")
    p.add_argument("--image-digest", default="unknown")
    a = p.parse_args()
    a.steps = [int(s) for s in a.steps.split(",")]
    if min(a.frames, a.warmup, a.repeats) < 1 or any(s not in (1, 2, 3, 4) for s in a.steps):
        p.error("Positive counts and 1–4 steps required")
    if not 0 <= a.alpha <= 0.5 or not all(10 <= q <= 100 for q in (a.input_quality, a.output_quality)):
        p.error("Alpha must be 0..0.5 and JPEG quality 10..100")
    return a


def install_constant_cache(worker, torch, np):
    """Experimental fixed-seed noise/schedule reuse; never modifies model weights."""
    cache = {}

    def generate(pipe, image_latents, prompt_embeds, alpha, n_steps, height, width, seed):
        key = (tuple(image_latents.shape), image_latents.dtype, image_latents.device, seed, alpha, n_steps)
        if key not in cache:
            # Bounded: benchmarks switch resolution; don't accumulate all noise tensors.
            cache.clear()
            gen = torch.Generator(device="cuda").manual_seed(seed)
            cache[key] = (
                torch.randn(image_latents.shape, generator=gen, dtype=image_latents.dtype, device="cuda"),
                np.linspace(1 - alpha, 0.0, n_steps).tolist(),
            )
        noise, sigmas = cache[key]
        noisy = alpha * image_latents + (1 - alpha) * noise
        return pipe(
            image=None, prompt=None, prompt_embeds=prompt_embeds, latents=noisy,
            sigmas=list(sigmas), height=height, width=width, num_inference_steps=n_steps,
            generator=torch.Generator(device="cuda").manual_seed(seed),
        ).images[0]

    worker.generate = generate


def main():
    a = arguments()
    os.environ["COMPILE_MODE"] = a.compile_mode
    os.environ["USE_VAE_FP8"] = a.vae_fp8
    import numpy as np
    import torch
    from PIL import Image, ImageDraw

    if not torch.cuda.is_available():
        raise RuntimeError("This benchmark requires a CUDA GPU; CPU/MPS results are not comparable")
    a.output.mkdir(parents=True, exist_ok=True)
    source = a.worker_script.read_bytes()
    spec = importlib.util.spec_from_file_location("image_worker", a.worker_script)
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    versions = {}
    for name in ("torch", "torchao", "diffusers", "transformers", "pillow", "numpy"):
        versions[name] = importlib.metadata.version(name)
    environment = {
        "time_utc": datetime.now(timezone.utc).isoformat(), "versions": versions,
        "python": platform.python_version(), "cuda": torch.version.cuda,
        "gpu": torch.cuda.get_device_name(0), "gpu_capability": torch.cuda.get_device_capability(0),
        "visible_devices": os.environ.get("CUDA_VISIBLE_DEVICES"),
        "driver": subprocess.check_output(["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"], text=True).strip(),
        "worker_sha256": hashlib.sha256(source).hexdigest(), "image_digest": a.image_digest,
        "arguments": {k: str(v) if isinstance(v, Path) else v for k, v in vars(a).items()},
    }
    (a.output / "environment.json").write_text(json.dumps(environment, indent=2) + "\n")
    # setup_pipeline has its own FP8 fallback logging: retain stdout with tee.
    pipe = worker.setup_pipeline()
    hf_home = Path(os.environ.get("HF_HOME", Path.home() / ".cache/huggingface"))
    environment["model_cache_main_refs"] = {}
    for repo in (worker.KLEIN_REPO, worker.DECODER_REPO):
        ref = hf_home / "hub" / ("models--" + repo.replace("/", "--")) / "refs/main"
        environment["model_cache_main_refs"][repo] = ref.read_text().strip() if ref.exists() else None
    (a.output / "environment.json").write_text(json.dumps(environment, indent=2) + "\n")
    prompts = worker.PromptCache(pipe)
    baseline_generate = worker.generate
    if a.variant in ("constants", "combined"):
        install_constant_cache(worker, torch, np)
    stage_sync = a.variant not in ("no-stage-sync", "combined")
    context = torch.inference_mode if a.variant == "inference-mode" else torch.no_grad

    def make_input(w, h, phase, blank=False):
        if a.scene == "noise" and not blank:
            arr = np.random.default_rng(a.seed + phase).integers(0, 256, (h, w, 3), dtype=np.uint8)
        else:
            arr = np.full((h, w, 3), 10, dtype=np.uint8)
            if a.scene == "detailed" and not blank:
                yy, xx = np.indices((h, w))
                arr[:, :, 0] = (xx * 3 + yy) % 128
                arr[:, :, 1] = (xx + yy * 5) % 128
                arr[:, :, 2] = ((xx // 12 ^ yy // 12) % 2) * 100
        img = Image.fromarray(arr)
        if not blank and a.scene != "noise":
            draw = ImageDraw.Draw(img)
            x = np.arange(w)
            y = h * (0.5 + 0.24 * np.sin(x / w * 4 * np.pi + phase * 0.25)
                     + 0.07 * np.sin(x / w * 19 * np.pi - phase * 0.17))
            draw.line(list(zip(x.tolist(), y.tolist())), fill="white", width=max(2, w // 128))
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=a.input_quality)
        return buffer.getvalue()

    def frame(raw, w, h, steps, embeds):
        start = time.perf_counter()
        img = worker.bytes_to_pil(raw, w, h)
        decoded = time.perf_counter()
        # Keep the baseline's stage synchronization, and remove it only in the
        # named experiment. Final sync remains for valid wall-clock attribution.
        if stage_sync:
            torch.cuda.synchronize()
        lat = worker.encode_image_to_latents(pipe, img, w, h)
        if stage_sync:
            torch.cuda.synchronize()
        encoded = time.perf_counter()
        out = worker.generate(pipe, lat, embeds, a.alpha, steps, h, w, a.seed)
        torch.cuda.synchronize()
        generated = time.perf_counter()
        jpeg = worker.pil_to_jpeg_bytes(out, a.output_quality)
        end = time.perf_counter()
        return out, jpeg, {
            "total_ms": (end - start) * 1000,
            "decode_input_ms": (decoded - start) * 1000,
            "vae_encode_ms": (encoded - decoded) * 1000 if stage_sync else None,
            "generate_decode_ms": (generated - encoded) * 1000 if stage_sync else None,
            "jpeg_ms": (end - generated) * 1000,
        }

    with (a.output / "results.jsonl").open("a", buffering=1) as results:
        for w, h in a.sizes:
            inputs = [make_input(w, h, i) for i in range(32)]
            Image.open(io.BytesIO(inputs[0])).save(a.output / f"input-{w}x{h}.png")
            for steps in a.steps:
                cell = {"size": [w, h], "steps": steps, "variant": a.variant}
                try:
                    with context():
                        embeds = prompts.get(a.prompt)
                        warm_started = time.perf_counter()
                        for i in range(a.warmup):
                            frame(inputs[i % len(inputs)], w, h, steps, embeds)
                        warm_seconds = time.perf_counter() - warm_started
                        for repeat in range(a.repeats):
                            torch.cuda.reset_peak_memory_stats()
                            torch.cuda.synchronize()
                            rows, sizes = [], []
                            started = time.perf_counter()
                            for i in range(a.frames):
                                out, jpeg, timing = frame(inputs[i % len(inputs)], w, h, steps, embeds)
                                rows.append(timing)
                                sizes.append(len(jpeg))
                            torch.cuda.synchronize()
                            seconds = time.perf_counter() - started
                            record = {
                                **cell, "status": "measured", "repeat": repeat,
                                "frames": len(rows), "wall_seconds": seconds,
                                "fps": throughput(len(rows), seconds), "warmup_seconds": warm_seconds,
                                "timing_ms": {k: distribution([r[k] for r in rows if r[k] is not None]) for k in rows[0]},
                                "jpeg_bytes": distribution(sizes),
                                "peak_allocated_bytes": torch.cuda.max_memory_allocated(),
                                "peak_reserved_bytes": torch.cuda.max_memory_reserved(),
                            }
                            results.write(json.dumps(record) + "\n")
                            print(json.dumps(record), flush=True)
                        # Samples/correctness outside the timed region.
                        samples, originals, compression = {}, {}, {}
                        for label, raw in [("a", inputs[0]), ("b", inputs[8]), ("blank", make_input(w, h, 0, True))]:
                            output, jpeg, _ = frame(raw, w, h, steps, embeds)
                            prefix = a.output / f"{w}x{h}-{steps}step-{label}"
                            output.save(str(prefix) + "-uncompressed.png")
                            Path(str(prefix) + ".jpg").write_bytes(jpeg)
                            decoded = Image.open(io.BytesIO(jpeg)).convert("RGB")
                            if decoded.size != (w, h) or output.size != (w, h):
                                raise ValueError(f"Incorrect output dimensions: {decoded.size}, expected {(w, h)}")
                            originals[label] = np.asarray(output, dtype=np.float32) / 255
                            samples[label] = np.asarray(decoded, dtype=np.float32) / 255
                            if not np.isfinite(samples[label]).all():
                                raise ValueError("Non-finite decoded image")
                            mse = float(np.mean((originals[label] - samples[label]) ** 2))
                            compression[label] = {"bytes": len(jpeg), "mse": mse,
                                "psnr_db": float(-10 * np.log10(mse)) if mse > 0 else None}
                        errors = {label: float(np.mean((samples["a"] - samples[label]) ** 2)) for label in ("b", "blank")}
                        check = {**cell, "status": "correctness", "input_difference_mse": errors,
                                 "jpeg_compression": compression,
                                 "input_influence_observed": all(v > 0 for v in errors.values())}
                        if a.variant in ("constants", "combined"):
                            patched = worker.generate
                            worker.generate = baseline_generate
                            reference, _, _ = frame(inputs[0], w, h, steps, embeds)
                            worker.generate = patched
                            check["baseline_reference_mse"] = float(np.mean((originals["a"] - np.asarray(reference, dtype=np.float32) / 255) ** 2))
                        results.write(json.dumps(check) + "\n")
                except Exception as exc:
                    results.write(json.dumps({**cell, "status": "failed", "error": repr(exc)}) + "\n")
                    raise


if __name__ == "__main__":
    main()
