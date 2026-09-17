#!/usr/bin/env python3
"""CUDA toolkit comparison benchmark — single-GPU, configurable resolution.

Loads FLUX.2 Klein with fp8 PerTensor quantization + torch.compile,
runs N frames at the given resolution, and reports per-frame timings.

Usage:
  python bench_cu_compare.py --width 512 --height 288 --steps 4 --frames 30
  python bench_cu_compare.py --width 256 --height 256 --steps 4 --frames 30

Output: JSON summary to stdout + /workspace/bench-cu-compare/<W>x<H>/summary.json
"""
import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch


# ---- constants ----------------------------------------------------------- #
KLEIN_REPO = "black-forest-labs/FLUX.2-klein-4B"
DECODER_REPO = "black-forest-labs/FLUX.2-small-decoder"
WAVE_PATH = "/workspace/waveforms/waveform_1.png"
SEED = 42
ALPHA = 0.10
MAX_SEQ_LEN = 64
PROMPT = (
    "a bright white lightning bolt against a pitch black night sky, "
    "dramatic, photographic, high contrast"
)
WARMUP_ITERS = 5


def percentile(xs, p):
    xs = sorted(xs)
    k = (len(xs) - 1) * (p / 100)
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    return xs[lo] if lo == hi else xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def pil2t(img):
    a = np.asarray(img, dtype=np.float32) / 127.5 - 1.0
    return torch.from_numpy(a).permute(2, 0, 1).unsqueeze(0)


def fp8_filter(module, fqn):
    if not isinstance(module, torch.nn.Linear):
        return False
    if "transformer" not in fqn and "single_transformer_blocks" not in fqn:
        return False
    bad = ("pe_embedder", "norm_", "_norm", "embed", "out_proj")
    return not any(b in fqn.lower() for b in bad)


def fp8_filter_vae(module, fqn):
    if not isinstance(module, torch.nn.Linear):
        return False
    if "transformer" in fqn:
        return False
    bad = ("post_quant_conv", "bn", "norm_", "_norm")
    return not any(b in fqn.lower() for b in bad)


def main():
    parser = argparse.ArgumentParser(description="CUDA toolkit comparison bench")
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    parser.add_argument("--steps", type=int, default=4)
    parser.add_argument("--frames", type=int, default=30)
    args = parser.parse_args()

    W, H, N_STEPS, N_FRAMES = args.width, args.height, args.steps, args.frames

    device = "cuda:0"
    torch.set_grad_enabled(False)
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True

    # ---- GPU info -------------------------------------------------------- #
    gpu_name = torch.cuda.get_device_name(0)
    gpu_props = torch.cuda.get_device_properties(0)
    cuda_version = torch.version.cuda
    torch_version = torch.__version__
    driver_version = "unknown"
    try:
        import subprocess
        r = subprocess.run(
            ["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"],
            capture_output=True, text=True
        )
        driver_version = r.stdout.strip().split("\n")[0]
    except Exception:
        pass

    print(f"[info] GPU: {gpu_name}", flush=True)
    print(f"[info] Driver: {driver_version}  CUDA: {cuda_version}  torch: {torch_version}", flush=True)
    print(f"[info] VRAM: {gpu_props.total_memory / 1e9:.1f} GB", flush=True)
    print(f"[info] Resolution: {W}x{H}, steps={N_STEPS}, frames={N_FRAMES}", flush=True)

    # ---- load pipeline --------------------------------------------------- #
    print("[1/5] loading pipeline...", flush=True)
    t0 = time.perf_counter()
    from PIL import Image
    from diffusers import Flux2KleinKVPipeline, AutoencoderKLFlux2
    from diffusers.pipelines.flux2.pipeline_flux2 import retrieve_latents
    from torchao.quantization import quantize_, Float8DynamicActivationFloat8WeightConfig

    pipe = Flux2KleinKVPipeline.from_pretrained(KLEIN_REPO, torch_dtype=torch.bfloat16)
    pipe.vae = AutoencoderKLFlux2.from_pretrained(DECODER_REPO, torch_dtype=torch.bfloat16)
    pipe.to(device)
    pipe.set_progress_bar_config(disable=True)
    load_s = time.perf_counter() - t0
    print(f"      loaded in {load_s:.1f}s", flush=True)

    # ---- fp8 quantization ------------------------------------------------ #
    print("[2/5] applying fp8 PerTensor quantization...", flush=True)
    t0 = time.perf_counter()
    try:
        from torchao.quantization.granularity import PerTensor
        cfg = Float8DynamicActivationFloat8WeightConfig(granularity=PerTensor())
    except Exception:
        cfg = Float8DynamicActivationFloat8WeightConfig()

    quantize_(pipe.transformer, cfg, filter_fn=fp8_filter)

    # VAE fp8 (default on)
    use_vae_fp8 = os.environ.get("USE_VAE_FP8", "1") != "0"
    if use_vae_fp8:
        quantize_(pipe.vae, cfg, filter_fn=fp8_filter_vae)
    fp8_s = time.perf_counter() - t0
    print(f"      fp8 applied in {fp8_s:.1f}s (vae_fp8={use_vae_fp8})", flush=True)

    # ---- compile --------------------------------------------------------- #
    compile_mode = os.environ.get("COMPILE_MODE", "reduce-overhead")
    print(f"[3/5] torch.compile (mode={compile_mode})...", flush=True)
    t0 = time.perf_counter()
    pipe.transformer = torch.compile(pipe.transformer, mode=compile_mode, fullgraph=False, dynamic=False)
    pipe.vae.encoder = torch.compile(pipe.vae.encoder, mode=compile_mode, fullgraph=False, dynamic=False)
    pipe.vae.decoder = torch.compile(pipe.vae.decoder, mode=compile_mode, fullgraph=False, dynamic=False)
    compile_s = time.perf_counter() - t0
    print(f"      compile call in {compile_s:.1f}s", flush=True)

    # ---- prepare --------------------------------------------------------- #
    r = pipe.encode_prompt(prompt=PROMPT, device=device, num_images_per_prompt=1,
                           max_sequence_length=MAX_SEQ_LEN)
    prompt_embeds = r[0] if isinstance(r, tuple) else r

    # Create or load input image
    if os.path.exists(WAVE_PATH):
        wave_pil = Image.open(WAVE_PATH).convert("RGB").resize((W, H), Image.LANCZOS)
    else:
        # Generate a synthetic waveform image if no file exists
        print(f"      {WAVE_PATH} not found, generating synthetic input", flush=True)
        arr = np.random.RandomState(42).randint(0, 256, (H, W, 3), dtype=np.uint8)
        wave_pil = Image.fromarray(arr, "RGB")

    def encode_img():
        t = pil2t(wave_pil).to(device, dtype=torch.bfloat16)
        raw = retrieve_latents(pipe.vae.encode(t), sample_mode="argmax")
        patch = pipe._patchify_latents(raw)
        m = pipe.vae.bn.running_mean.view(1, -1, 1, 1).to(patch.device, patch.dtype)
        s = (pipe.vae.bn.running_var + pipe.vae.bn.eps).sqrt().view(1, -1, 1, 1).to(patch.device, patch.dtype)
        return (patch - m) / s

    def run_one(seed):
        lat = encode_img()
        gen = torch.Generator(device=device).manual_seed(seed)
        noise = torch.randn(lat.shape, generator=gen, dtype=lat.dtype, device=device)
        noisy = ALPHA * lat + (1 - ALPHA) * noise
        sigmas = np.linspace(1 - ALPHA, 0.0, N_STEPS).tolist()
        pipe(
            image=None, prompt=None, prompt_embeds=prompt_embeds,
            latents=noisy, sigmas=sigmas,
            height=H, width=W, num_inference_steps=N_STEPS,
            generator=torch.Generator(device=device).manual_seed(seed),
        ).images[0]

    # ---- warmup (triggers JIT compilation) ------------------------------- #
    print(f"[4/5] warmup ({WARMUP_ITERS} iters, includes JIT compile)...", flush=True)
    t0 = time.perf_counter()
    for i in range(WARMUP_ITERS):
        run_one(SEED + i)
        torch.cuda.synchronize(device)
        print(f"      warmup {i+1}/{WARMUP_ITERS} done", flush=True)
    warmup_s = time.perf_counter() - t0
    print(f"      warmup total: {warmup_s:.1f}s", flush=True)

    # ---- timed run ------------------------------------------------------- #
    print(f"[5/5] timed run ({N_FRAMES} frames)...", flush=True)
    per_frame_ms = []
    t_total = time.perf_counter()
    for i in range(N_FRAMES):
        t = time.perf_counter()
        run_one(SEED + 1000 + i)
        torch.cuda.synchronize(device)
        ms = (time.perf_counter() - t) * 1000
        per_frame_ms.append(round(ms, 2))
        if (i + 1) % 10 == 0 or i == 0:
            print(f"      frame {i+1}/{N_FRAMES}: {ms:.2f} ms", flush=True)
    wall_s = time.perf_counter() - t_total

    vram_gb = torch.cuda.memory_allocated() / 1e9
    vram_peak_gb = torch.cuda.max_memory_allocated() / 1e9

    # ---- stats ----------------------------------------------------------- #
    mean_ms = sum(per_frame_ms) / len(per_frame_ms)
    fps = 1000.0 / mean_ms
    p50 = percentile(per_frame_ms, 50)
    p95 = percentile(per_frame_ms, 95)
    p99 = percentile(per_frame_ms, 99)
    min_ms = min(per_frame_ms)
    max_ms = max(per_frame_ms)

    summary = {
        "gpu": gpu_name,
        "driver": driver_version,
        "cuda": cuda_version,
        "torch": torch_version,
        "resolution": f"{W}x{H}",
        "steps": N_STEPS,
        "frames": N_FRAMES,
        "compile_mode": compile_mode,
        "vae_fp8": use_vae_fp8,
        "fp8": "PerTensor",
        "mean_ms": round(mean_ms, 2),
        "fps": round(fps, 2),
        "p50_ms": round(p50, 2),
        "p95_ms": round(p95, 2),
        "p99_ms": round(p99, 2),
        "min_ms": round(min_ms, 2),
        "max_ms": round(max_ms, 2),
        "wall_s": round(wall_s, 2),
        "vram_gb": round(vram_gb, 2),
        "vram_peak_gb": round(vram_peak_gb, 2),
        "load_s": round(load_s, 1),
        "fp8_s": round(fp8_s, 1),
        "warmup_s": round(warmup_s, 1),
        "per_frame_ms": per_frame_ms,
    }

    # Save to disk
    out_dir = Path(f"/workspace/bench-cu-compare/{W}x{H}")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "summary.json"
    out_path.write_text(json.dumps(summary, indent=2))

    # Print summary
    print(f"\n{'='*70}", flush=True)
    print(f"RESULT: {gpu_name} | {driver_version} | CUDA {cuda_version} | torch {torch_version}", flush=True)
    print(f"  {W}x{H} / {N_STEPS}-step / {N_FRAMES} frames", flush=True)
    print(f"  mean={mean_ms:.2f}ms  fps={fps:.2f}  p50={p50:.2f}  p95={p95:.2f}  p99={p99:.2f}", flush=True)
    print(f"  min={min_ms:.2f}ms  max={max_ms:.2f}ms  wall={wall_s:.2f}s", flush=True)
    print(f"  vram={vram_gb:.2f}GB  peak={vram_peak_gb:.2f}GB", flush=True)
    print(f"  compile_mode={compile_mode}  vae_fp8={use_vae_fp8}", flush=True)
    print(f"{'='*70}", flush=True)
    print(f"JSON: {out_path}", flush=True)

    # Also dump JSON to stdout for easy parsing
    print(f"\n__JSON_START__", flush=True)
    print(json.dumps(summary), flush=True)
    print(f"__JSON_END__", flush=True)


if __name__ == "__main__":
    main()
