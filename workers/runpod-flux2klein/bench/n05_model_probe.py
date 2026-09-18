#!/usr/bin/env python3
"""N05 bounded selective-quality and paired full-frame compute experiment.

Requires a separately passed native-kernel manifest. Saves changed images for
visual review; it never promotes a configuration. No live app/WebRTC claim.
"""
import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import importlib.metadata
import io
import json
import math
import os
from pathlib import Path
import statistics
import subprocess
import time
import traceback

from n05_nvfp4 import (CONFIGS, fixture, import_worker, prepare_native,
                       replace_layers, retain_original_weights, selected, sha)

PROMPTS = (
    "vibrant neon cyberpunk city street at night, rain, reflections, wide angle",
    "colorful abstract art, vibrant neon lights, psychedelic patterns",
    "iridescent organic sculpture, flowing glass ribbons, intricate surface texture, dramatic studio lighting",
)
SIZES = ((512, 288), (768, 448), (1024, 576))
SEEDS = (42, 123)
TEMPORAL_PHASES = (0, 0, 1, 1, 2, 2, 3, 0, 4, 4, 2, 0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker-script", type=Path, required=True)
    parser.add_argument("--kernel-gate", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--frames", type=int, default=100)
    parser.add_argument("--pairs", type=int, default=3)
    parser.add_argument("--expected-native-threads", type=int, default=128)
    args = parser.parse_args()
    gate = json.loads(args.kernel_gate.read_text())
    assert gate["status"] == "kernel-gate-passed"
    assert len([r for r in gate["records"] if r.get("phase") == "kernel"]) == 6
    if args.output.exists():
        parser.error("Refusing to overwrite existing evidence")
    if min(args.frames, args.pairs) < 1:
        parser.error("Positive timing counts required")
    active = subprocess.check_output([
        "nvidia-smi", "--query-compute-apps=pid,process_name,used_gpu_memory",
        "--format=csv,noheader"], text=True).strip()
    if active:
        raise RuntimeError("GPU has active compute; leave N05 queued")
    args.output.mkdir(parents=True)
    manifest = {"status": "running", "started_utc": datetime.now(timezone.utc).isoformat(),
                "records": [], "acceptance": "not accepted; non-exact results require explicit visual review",
                "kernel_gate_sha256": sha(args.kernel_gate), "prompts": PROMPTS, "seeds": SEEDS,
                "steps": 2, "alpha": .1, "input_jpeg_quality": 85, "output_jpeg_quality": 80,
                "temporal_phases": TEMPORAL_PHASES,
                "timing_boundary": "JPEG input decode + VAE encode + generate + output JPEG80 + CUDA completion; no text encoding/IPC/network/browser"}

    def save(record=None):
        if record:
            manifest["records"].append(record)
            with (args.output / "records.jsonl").open("a") as stream:
                stream.write(json.dumps(record) + "\n")
            print(json.dumps({k: v for k, v in record.items() if k != "frame_ms"}), flush=True)
        temp = args.output / "result.tmp.json"
        temp.write_text(json.dumps(manifest, indent=2) + "\n")
        temp.replace(args.output / "result.json")

    save()
    try:
        os.environ.pop("TORCH_NUM_THREADS", None)
        os.environ["USE_TERMINAL_NOOP"] = "1"
        os.environ["USE_GPU_OUTPUT_CAST"] = "1"
        import numpy as np
        import torch
        from PIL import Image
        torch.set_grad_enabled(False)
        # Three variants × three sizes must not fall into an eager recompile
        # fallback simply because the default cache limit is smaller.
        torch._dynamo.config.recompile_limit = 64
        NativeLinear, native_identity = prepare_native()
        assert native_identity == gate["native"], "Kernel package/source differs from passed gate"
        worker = import_worker(args.worker_script.resolve())
        assert sha(args.worker_script) == gate["source_sha256"]["worker"]
        assert sha(args.worker_script.with_name("worker_runtime.py")) == gate["source_sha256"]["runtime"]
        assert sha(Path(__file__).with_name("n05_nvfp4.py")) == gate["source_sha256"]["helper"]
        assert all(importlib.metadata.version(name) == gate["versions"][name]
                   for name in ("torch", "torchao", "diffusers", "flashinfer-python", "nvidia-cutlass-dsl"))
        boot = []
        real_log = worker.log

        def log(message):
            boot.append(message)
            real_log(message)

        worker.log = log
        with retain_original_weights(worker) as bf16:
            pipe = worker.setup_pipeline()
        assert torch.get_num_threads() == args.expected_native_threads
        assert pipe._vj0_skip_terminal_enabled and pipe._vj0_gpu_output_cast_enabled
        assert len(bf16) == 10
        assert any("fp8 applied to transformer" in line for line in boot)
        assert not any("WARNING: fp8 quantization failed" in line for line in boot)
        root = getattr(pipe.transformer, "_orig_mod", pipe.transformer)
        fp8 = {name: root.get_submodule(name) for name in bf16}
        native = {name: NativeLinear(layer) for name, layer in bf16.items()}
        assert all(type(layer.weight).__name__ != "Parameter" for layer in fp8.values())
        # FlashInfer retains this scratch allocation globally. Its first creation
        # must occur before any compiled CUDA-graph frame, outside the graph pool.
        # The native operator, quantization and graph correctness checks stay intact.
        import flashinfer.utils as flashinfer_utils
        from flashinfer.gemm import gemm_base
        assert sha(flashinfer_utils.__file__) == "6cb8ebcc25eb65521808bf40a8aaf0c5a868827283955867ae382ad7ec773815"
        assert gemm_base.DEFAULT_WORKSPACE_SIZE == 32 * 1024 * 1024
        native_device = next(iter(native.values())).packed_weight.device
        assert all(layer.packed_weight.device == native_device for layer in native.values())
        assert not torch.cuda.is_current_stream_capturing()
        workspace_key = ("mm_fp4_workspace", native_device)
        workspace_existed = workspace_key in flashinfer_utils._cache_buf
        workspace = flashinfer_utils._get_cache_buf(
            "mm_fp4_workspace", gemm_base.DEFAULT_WORKSPACE_SIZE, native_device)
        assert workspace.device == native_device and workspace.dtype == torch.uint8
        assert workspace.numel() >= gemm_base.DEFAULT_WORKSPACE_SIZE
        assert flashinfer_utils._get_cache_buf(
            "mm_fp4_workspace", gemm_base.DEFAULT_WORKSPACE_SIZE, native_device) is workspace
        torch.cuda.synchronize()
        save({"phase": "native-workspace-preinit", "device": str(native_device),
              "bytes": workspace.numel(), "already_existed": workspace_existed,
              "outside_stream_capture": True, "allocation_data_ptr": workspace.data_ptr(),
              "utils_source_sha256": sha(flashinfer_utils.__file__),
              "scope": "Setup-only global scratch allocation shared by every arm; native kernels and graph checks unchanged"})
        manifest.update({"native": native_identity, "boot_logs": boot,
                         "torch_dynamo_recompile_limit": torch._dynamo.config.recompile_limit,
                         "compile_limit_scope": "64 for every paired control/candidate; not comparable directly to production-default8 measurements",
                         "torch_threads": torch.get_num_threads(), "gpu": torch.cuda.get_device_name(),
                         "versions": {n: importlib.metadata.version(n) for n in
                                      ("torch", "torchao", "diffusers", "numpy", "pillow", "flashinfer-python")},
                         "source_sha256": {"probe": sha(__file__), "helper": sha(Path(__file__).with_name("n05_nvfp4.py")),
                                           "worker": sha(args.worker_script)},
                         "variants": {config: [name for name in native if selected(name, config)] for config in CONFIGS}})
        cache = worker.PromptCache(pipe)
        embeddings = [cache.get(prompt) for prompt in PROMPTS]
        current = None

        def select(config):
            nonlocal current
            if current == config:
                return
            torch.cuda.synchronize()
            replace_layers(pipe.transformer, fp8)
            if config != "fp8":
                replace_layers(pipe.transformer, {n: m for n, m in native.items() if selected(n, config)})
            current = config

        def frame(jpeg, width, height, prompt_index, seed, verify_tensor=False):
            image = Image.open(io.BytesIO(jpeg)).convert("RGB")
            latents = worker.encode_image_to_latents(pipe, image, width, height)
            converter = pipe.image_processor.pt_to_numpy
            decoder = pipe.vae.decode
            checks = []
            decode_checks = []

            def checked_decoder(*positional, **keywords):
                output = decoder(*positional, **keywords)
                tensor = output[0] if isinstance(output, tuple) else output.sample
                assert torch.isfinite(tensor).all().item(), "Nonfinite raw VAE decode output before denormalization/clamp"
                decode_checks.append(True)
                return output

            def checked_converter(tensor):
                assert torch.isfinite(tensor).all().item(), "Nonfinite decoded tensor before image conversion"
                checks.append(True)
                return converter(tensor)

            if verify_tensor:
                assert torch.isfinite(latents).all().item(), "Nonfinite encoded input"
                pipe.image_processor.pt_to_numpy = checked_converter
                pipe.vae.decode = checked_decoder
            try:
                result = worker.generate(pipe, latents, embeddings[prompt_index], .1, 2, height, width, seed)
            finally:
                if verify_tensor:
                    pipe.image_processor.pt_to_numpy = converter
                    pipe.vae.decode = decoder
            if verify_tensor:
                assert checks and decode_checks, "Float tensor quality guard was bypassed"
            stream = io.BytesIO()
            result.save(stream, format="JPEG", quality=80)
            torch.cuda.synchronize()
            return result, stream.getvalue()

        def quality(a, b):
            delta = a.astype(np.float64) - b.astype(np.float64)
            mse = float(np.mean(delta * delta))
            return {"pixels_equal": bool(np.array_equal(a, b)), "mse": mse,
                    "psnr_db": None if mse == 0 else 10 * math.log10(255.0 ** 2 / mse),
                    "changed_value_fraction": float(np.mean(a != b)),
                    "max_absolute_error": int(np.abs(delta).max())}

        references = {}
        # Warm the exact size and each configuration before quality or timing.
        for width, height in SIZES:
            inputs = {phase: fixture(width, height, phase) for phase in range(5)}
            for phase, jpeg in inputs.items():
                (args.output / f"input-{width}x{height}-phase{phase}.jpg").write_bytes(jpeg)
            for config in ("fp8", *CONFIGS):
                select(config)
                start = time.monotonic()
                for _ in range(5):
                    frame(inputs[2], width, height, 0, 42)
                save({"phase": "warmup", "variant": config, "resolution": [width, height],
                      "seconds": time.monotonic() - start,
                      "memory_scope": "comparison process with retained FP8 and NVFP4 alternatives; not deployment footprint",
                      "memory_allocated_bytes": torch.cuda.memory_allocated(),
                      "memory_reserved_bytes": torch.cuda.memory_reserved()})
                # Prove the warmed compiled model actually executes the selected
                # low-bit layers. CUDA graph replay may have zero CPU custom-op
                # events, so actual GPU launches are the decisive count.
                skips_before = pipe._vj0_terminal_skips
                with torch.profiler.profile(activities=[torch.profiler.ProfilerActivity.CPU,
                                                        torch.profiler.ProfilerActivity.CUDA]) as prof:
                    frame(inputs[2], width, height, 0, 42)
                assert pipe._vj0_terminal_skips - skips_before == 1
                trace = args.output / f"profile-{width}x{height}-{config}.json"
                prof.export_chrome_trace(str(trace))
                events = json.loads(trace.read_text())["traceEvents"]
                native_events = [event for event in events if event.get("cat") == "kernel"
                                 and "dense_blockscaled_gemm_sm120_b12x" in event.get("name", "")
                                 and "f4E2M1FN" in event.get("name", "")]
                custom_op_events = [event for event in events if event.get("name") == "vj0_n05::linear_b12x"]
                expected_native = 0 if config == "fp8" else len(manifest["variants"][config])
                with gzip.open(str(trace) + ".gz", "wb") as zipped:
                    zipped.write(trace.read_bytes())
                trace.unlink()
                save({"phase": "compiled-native-proof", "variant": config,
                      "resolution": [width, height], "native_gpu_launches": len(native_events),
                      "expected_native_gpu_launches": expected_native,
                      "cpu_custom_op_events": len(custom_op_events),
                      "cpu_event_note": "May be zero on valid CUDA graph replay",
                      "native_kernel_names": sorted({event["name"] for event in native_events}),
                      "trace": trace.name + ".gz"})
                assert len(native_events) == expected_native, "Compiled variant did not execute expected native FP4 layers"
                for prompt_index in range(len(PROMPTS)):
                    for seed in SEEDS:
                        # Three distinct input states per prompt/seed extend the
                        # minimum18-case matrix to54 paired quality fixtures.
                        for phase in (0, 2, 4):
                            before_cpu = torch.get_rng_state().clone()
                            before_cuda = torch.cuda.get_rng_state().clone()
                            result, jpg = frame(inputs[phase], width, height, prompt_index, seed, verify_tensor=True)
                            rng_unchanged = (torch.equal(before_cpu, torch.get_rng_state()) and
                                             torch.equal(before_cuda, torch.cuda.get_rng_state()))
                            assert rng_unchanged
                            pixels = np.asarray(result).copy()
                            key = f"{width}x{height}-prompt{prompt_index}-seed{seed}-phase{phase}"
                            result.save(args.output / f"{key}-{config}.png")
                            if config == "fp8":
                                references[key] = (pixels, jpg)
                                comparison = {"control": True}
                            else:
                                reference, ref_jpg = references[key]
                                comparison = quality(pixels, reference)
                                comparison["jpeg_equal"] = jpg == ref_jpg
                            save({"phase": "quality", "variant": config, "fixture": key,
                                  "comparison": comparison, "global_rng_unchanged": rng_unchanged,
                                  "encoded_and_decoded_tensors_finite": True,
                                  "pixel_sha256": hashlib.sha256(pixels.tobytes()).hexdigest()})
                clip_dir = args.output / f"clip-{width}x{height}-{config}"
                clip_dir.mkdir()
                clip_frames = []
                for index, phase in enumerate(TEMPORAL_PHASES):
                    result, _ = frame(inputs[phase], width, height, 1, 42, verify_tensor=True)
                    result.save(clip_dir / f"{index:03d}.png")
                    clip_frames.append(result)
                # PNGs are full RGB evidence. GIF is only a convenient preview
                # and its palette is never used for numerical comparisons.
                clip_frames[0].save(clip_dir / "preview.gif", save_all=True,
                                    append_images=clip_frames[1:], duration=100, loop=0)
                save({"phase": "temporal", "variant": config, "resolution": [width, height],
                      "frames": len(clip_frames), "directory": clip_dir.name})

            # Alternating order, real full-frame compute; no profile/PNG/RNG
            # snapshots inside timing. Warmup on every switch is outside timing.
            for config in CONFIGS:
                for pair in range(args.pairs):
                    order = ("fp8", config) if pair % 2 == 0 else (config, "fp8")
                    for variant in order:
                        select(variant)
                        for _ in range(4):
                            frame(inputs[2], width, height, 1, 42)
                        times = []
                        skips_before = pipe._vj0_terminal_skips
                        wall_start = time.perf_counter()
                        for i in range(args.frames):
                            start = time.perf_counter()
                            frame(inputs[i % 5], width, height, 1, 42)
                            times.append((time.perf_counter() - start) * 1000)
                        wall_elapsed_ms = (time.perf_counter() - wall_start) * 1000
                        assert pipe._vj0_terminal_skips - skips_before == args.frames
                        save({"phase": "timing", "variant": variant, "candidate_pair": config,
                              "pair": pair, "resolution": [width, height], "frames": args.frames,
                              "fps": args.frames * 1000 / wall_elapsed_ms,
                              "wall_elapsed_ms": wall_elapsed_ms, "frame_ms": times,
                              "median_ms": statistics.median(times), "p95_ms": float(np.percentile(times, 95)),
                              "maximum_ms": max(times)})
            # Return to control after both candidates and assert repeated
            # output is exact, catching accidental mutation of shared weights.
            select("fp8")
            for _ in range(4):
                frame(inputs[2], width, height, 0, 42)
            result, jpg = frame(inputs[2], width, height, 0, 42)
            original_pixels, original_jpg = references[f"{width}x{height}-prompt0-seed42-phase2"]
            assert np.array_equal(np.asarray(result), original_pixels) and jpg == original_jpg
            save({"phase": "control-return", "resolution": [width, height], "pixels_equal": True, "jpeg_equal": True})
        manifest["status"] = "compute-and-images-complete"
        manifest["remaining"] = "Offline LPIPS/temporal metrics and independent visual review; no acceptance or promotion"
    except Exception as exc:
        manifest["status"] = "stopped"
        manifest["error"] = f"{type(exc).__name__}: {exc}"
        manifest["traceback"] = traceback.format_exc()
        raise
    finally:
        manifest["ended_utc"] = datetime.now(timezone.utc).isoformat()
        save()


if __name__ == "__main__":
    main()
