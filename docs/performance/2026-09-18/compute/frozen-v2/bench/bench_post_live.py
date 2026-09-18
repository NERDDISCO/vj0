#!/usr/bin/env python3
"""One-load production boot proof, paired compute test and untimed profiles.

Run only after the live worker has exited. This deliberately imports the current
production worker and its own runtime companion; it does not generate a worker
or install the terminal helper itself. Results include JPEG I/O, not transport.
"""
import argparse
from contextlib import contextmanager, nullcontext
from datetime import datetime, timezone
import gzip
import hashlib
import importlib.metadata
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import statistics
import subprocess
import time

from metrics import distribution
from bench_terminal_followup import cpu_snapshot, cpu_delta


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


@contextmanager
def module_range(module, label, record_function):
    """Profile an existing compiled callable without recompiling its body."""
    original = module.forward

    def wrapped(*args, **kwargs):
        with record_function(label):
            return original(*args, **kwargs)

    module.forward = wrapped
    try:
        yield
    finally:
        module.forward = original


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker-script", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--frames", type=int, default=100)
    parser.add_argument("--pairs", type=int, default=3)
    parser.add_argument("--profile-frames", type=int, default=20)
    parser.add_argument("--warmup", type=int, default=4)
    parser.add_argument("--expected-native-threads", type=int, default=128)
    parser.add_argument("--cast-pairs-1024", action="store_true",
                        help="Also isolate CPU/GPU conversion with terminal skipping fixed on")
    parser.add_argument("--skip-profiles", action="store_true")
    args = parser.parse_args()
    if min(args.frames, args.pairs, args.profile_frames, args.warmup) < 1:
        parser.error("All counts must be positive")
    if args.output.exists():
        parser.error("Refusing to reuse an output directory")
    # This command is a final coordination guard, before importing CUDA/PyTorch.
    active = subprocess.check_output([
        "nvidia-smi", "--query-compute-apps=pid,process_name,used_gpu_memory",
        "--format=csv,noheader"], text=True).strip()
    if active:
        raise RuntimeError("GPU has an active compute process; leave this probe queued")
    args.output.mkdir(parents=True)
    # Exercise the production default without selecting a new compiler thread
    # specialization. The current runtime default (zero) retains native threads.
    previous_thread_env = os.environ.pop("TORCH_NUM_THREADS", None)
    previous_terminal_env = os.environ.get("USE_TERMINAL_NOOP")
    previous_cast_env = os.environ.get("USE_GPU_OUTPUT_CAST")
    os.environ["USE_TERMINAL_NOOP"] = "1"
    os.environ["USE_GPU_OUTPUT_CAST"] = "1"
    import numpy as np
    import torch
    from PIL import Image, ImageDraw

    worker_path = args.worker_script.resolve()
    spec = importlib.util.spec_from_file_location("vj0_post_live_worker", worker_path)
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    records = []
    manifest = {
        "status": "running", "started_utc": datetime.now(timezone.utc).isoformat(),
        "arguments": {key: str(value) if isinstance(value, Path) else value
                      for key, value in vars(args).items()},
        "versions": {key: importlib.metadata.version(key)
                     for key in ("torch", "torchao", "diffusers", "numpy", "pillow")},
        "source_sha256": {
            "worker": sha(worker_path),
            "runtime": sha(worker_path.with_name("worker_runtime.py")),
            "terminal_helper": sha(worker_path.parent / "bench" / "terminal_noop.py"),
            "probe": sha(__file__),
            "gpu_cast_helper": sha(worker_path.parent / "bench" / "gpu_output_cast.py"),
            "cpu_diagnostics": sha(Path(__file__).with_name("bench_terminal_followup.py")),
        },
        "requested_runtime": {"TORCH_NUM_THREADS": "unset: exercise default",
                              "USE_TERMINAL_NOOP": "1", "USE_GPU_OUTPUT_CAST": "1"},
        "previous_runtime_env": {"TORCH_NUM_THREADS": previous_thread_env,
                                 "USE_TERMINAL_NOOP": previous_terminal_env,
                                 "USE_GPU_OUTPUT_CAST": previous_cast_env},
        "gpu": torch.cuda.get_device_name(0),
        "initial_torch_threads": torch.get_num_threads(),
        "jpeg_input_quality": 85,
        "jpeg_output_quality": 80,
        "records": records,
        "timing_boundary": "JPEG decode, VAE encode, worker.generate, JPEG encode, CUDA sync; excludes IPC/network/browser",
    }

    def save(record=None):
        if record is not None:
            records.append(record)
            with (args.output / "records.jsonl").open("a") as stream:
                stream.write(json.dumps(record) + "\n")
            print(json.dumps({key: value for key, value in record.items()
                              if key not in ("frame_ms", "output_cast_checks")}), flush=True)
        target = args.output / "result.json"
        temporary = args.output / "result.json.tmp"
        temporary.write_text(json.dumps(manifest, indent=2) + "\n")
        temporary.replace(target)

    def make_input(width, height, phase):
        image = Image.new("RGB", (width, height), (10, 10, 10))
        draw = ImageDraw.Draw(image)
        xs = np.arange(width)
        ys = height * (0.5 + 0.24 * np.sin(xs / width * 4 * np.pi + phase * 0.25)
                       + 0.07 * np.sin(xs / width * 19 * np.pi - phase * 0.17))
        draw.line(list(zip(xs.tolist(), ys.tolist())), fill="white",
                  width=max(2, width // 128))
        if phase % 3 == 2:
            draw.rectangle((width // 5, height // 5, width // 3, height // 3),
                           fill=(40, 200, 255))
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=85)
        return buffer.getvalue()

    save()
    try:
        # No benchmark-side install/set_num_threads: verify production setup.
        boot_logs = []
        original_log = worker.log

        def capture_log(message):
            boot_logs.append(message)
            original_log(message)

        worker.log = capture_log
        pipe = worker.setup_pipeline()
        assert torch.get_num_threads() == manifest["initial_torch_threads"], "Production default changed native threads"
        assert torch.get_num_threads() == args.expected_native_threads, "Unexpected host native thread count"
        assert pipe._vj0_skip_terminal_enabled is True, "Runtime opt-in failed"
        assert any("terminal_noop=enabled" in line for line in boot_logs)
        assert any("TORCH_NUM_THREADS=0" in line for line in boot_logs)
        assert any("fp8 applied to transformer" in line for line in boot_logs)
        assert not any("WARNING: fp8 quantization failed" in line for line in boot_logs)
        prompts = worker.PromptCache(pipe)
        embeds = prompts.get("colorful abstract art, vibrant neon lights, psychedelic patterns")
        processor = pipe.image_processor
        # Use the actual production opt-in callable. Quality comparisons use its
        # retained measured probe; timed runs never select a benchmark converter.
        cast = pipe._vj0_gpu_output_cast_probe
        original_cast = pipe._vj0_gpu_output_cast_original
        production_gpu_cast = pipe._vj0_gpu_output_cast_convert
        assert pipe._vj0_gpu_output_cast_enabled is True
        assert processor.pt_to_numpy is production_gpu_cast, "GPU cast opt-in did not install"
        assert cast.compare_enabled is False
        save({"status": "boot-proof", "torch_threads": torch.get_num_threads(),
              "torch_interop_threads": torch.get_num_interop_threads(),
              "terminal_noop_enabled": True, "gpu_output_cast_enabled": True,
              "boot_logs": boot_logs})
        processor.pt_to_numpy = original_cast
        profiling = False

        def region(label):
            return torch.profiler.record_function(label) if profiling else nullcontext()

        def select_cast(use_gpu, compare=False):
            cast.compare_enabled = compare
            processor.pt_to_numpy = production_gpu_cast if use_gpu else original_cast

        def run(raw, width, height, steps=2):
            before = pipe._vj0_terminal_skips
            with region("vj0/input_jpeg_decode"):
                image = worker.bytes_to_pil(raw, width, height)
            with region("vj0/vae_encode"):
                latents = worker.encode_image_to_latents(pipe, image, width, height)
            with region("vj0/generate_and_decode"):
                output = worker.generate(pipe, latents, embeds, 0.1, steps,
                                         height, width, 42)
            with region("vj0/output_jpeg_encode"):
                jpeg = worker.pil_to_jpeg_bytes(output, 80)
            with region("vj0/completion_sync"):
                torch.cuda.synchronize()
            return output, jpeg, pipe._vj0_terminal_skips - before

        sizes = [(512, 288), (768, 448), (1024, 576)]
        inputs = {size: [make_input(*size, phase)
                        for phase in range(max(args.frames, args.profile_frames, 3))]
                  for size in sizes}
        quality_reference_jpeg = {}
        with torch.no_grad():
            for width, height in sizes:
                start = time.perf_counter()
                for enabled in (False, True):
                    pipe._vj0_skip_terminal_enabled = enabled
                    for use_gpu in (False, True):
                        select_cast(use_gpu)
                        for _ in range(args.warmup):
                            run(inputs[width, height][0], width, height)
                save({"status": "warmup", "size": [width, height],
                      "seconds": time.perf_counter() - start})
                # Original worker.generate quality proof on actual production
                # setup; no callback reconstruction is used in this probe.
                for steps in (2, 3, 4):
                    for phase in range(3):
                        outputs = []
                        skips = []
                        rng_checks = []
                        comparisons_before = len(cast.comparisons)
                        for enabled, use_gpu in ((False, False), (True, False), (True, True), (False, True)):
                            pipe._vj0_skip_terminal_enabled = enabled
                            select_cast(use_gpu, compare=use_gpu)
                            cast.context = {"size": [width, height], "steps": steps,
                                            "phase": phase, "terminal_noop": enabled}
                            cpu_rng = torch.random.get_rng_state().clone()
                            cuda_rng = torch.cuda.get_rng_state().clone()
                            output, jpeg, skipped = run(inputs[width, height][phase],
                                                        width, height, steps)
                            pixels = np.asarray(output).copy()
                            outputs.append((pixels, jpeg))
                            if steps == 2 and (enabled, use_gpu) in ((False, False), (True, True)):
                                label = "optimized" if enabled else "baseline"
                                output.save(args.output / f"{width}x{height}-phase{phase}-{label}.png")
                            skips.append(skipped)
                            rng_checks.append(bool(torch.equal(cpu_rng, torch.random.get_rng_state())
                                                   and torch.equal(cuda_rng, torch.cuda.get_rng_state())))
                        exact = all(np.array_equal(outputs[0][0], item[0])
                                    and outputs[0][0].tobytes() == item[0].tobytes()
                                    and outputs[0][1] == item[1] for item in outputs[1:])
                        row = {"status": "quality", "size": [width, height],
                               "steps": steps, "phase": phase, "alpha": 0.1, "seed": 42,
                               "torch_threads": torch.get_num_threads(),
                               "original_terminal_and_gpu_cast_pixels_jpeg_exact": bool(exact),
                               "skip_counts": skips, "global_rng_unchanged": all(rng_checks),
                               "reference_pixel_sha256": hashlib.sha256(outputs[0][0].tobytes()).hexdigest(),
                               "reference_jpeg_sha256": hashlib.sha256(outputs[0][1]).hexdigest(),
                               "output_cast_checks": cast.comparisons[comparisons_before:]}
                        save(row)
                        assert exact and all(rng_checks) and skips == [0, 1, 1, 0], row
                        assert len(row["output_cast_checks"]) == 2
                        assert all(check["cpu_gpu_cast_exact"] and check["finite"]
                                   for check in row["output_cast_checks"])
                        if steps == 2:
                            quality_reference_jpeg[width, height, phase] = outputs[0][1]

            # One loaded pipeline, unchanged native thread budget, and actual
            # production callables. Alternate pair order to expose clock drift.
            def measure(width, height, enabled, use_gpu, status, pair):
                assert torch.get_num_threads() == args.expected_native_threads
                pipe._vj0_skip_terminal_enabled = enabled
                select_cast(use_gpu)
                for _ in range(args.warmup):
                    run(inputs[width, height][0], width, height)
                before_checks, before_calls = len(cast.comparisons), cast.unchecked_calls
                durations, total_skips = [], 0
                cpu_before = cpu_snapshot()
                start = time.perf_counter()
                for raw in inputs[width, height][:args.frames]:
                    frame_start = time.perf_counter()
                    _, _, skipped = run(raw, width, height)
                    durations.append((time.perf_counter() - frame_start) * 1000)
                    total_skips += skipped
                elapsed = time.perf_counter() - start
                cpu_after = cpu_snapshot()
                selected_calls = cast.unchecked_calls - before_calls
                assert len(cast.comparisons) == before_checks
                assert selected_calls == (args.frames if use_gpu else 0)
                assert total_skips == (args.frames if enabled else 0)
                save({"status": status, "size": [width, height], "steps": 2,
                      "pair": pair, "cast": "gpu" if use_gpu else "cpu",
                      "variant": "optimized" if enabled and use_gpu else "baseline" if not enabled else "terminal-cpu-cast",
                      "torch_threads": torch.get_num_threads(),
                      "frames": args.frames, "fps": args.frames / elapsed,
                      "wall_seconds": elapsed, "timing_ms": distribution(durations),
                      "cpu": cpu_delta(cpu_before, cpu_after, elapsed),
                      "frame_ms": durations, "terminal_skips": total_skips,
                      "timing_reference_checks": 0, "selected_gpu_cast_calls": selected_calls})

            for width, height in sizes:
                for pair in range(args.pairs):
                    for optimized in ((False, True) if pair % 2 == 0 else (True, False)):
                        measure(width, height, optimized, optimized, "compute-measured", pair)
            if args.cast_pairs_1024:
                for pair in range(args.pairs):
                    for use_gpu in ((False, True) if pair % 2 == 0 else (True, False)):
                        measure(1024, 576, True, use_gpu, "cast-measured", pair)

            # Trace the optimized production path only after all timed cells.
            # These traces are diagnostics, not throughput measurements.
            pipe._vj0_skip_terminal_enabled = True
            select_cast(True)
            profile_sizes = [] if args.skip_profiles else [(512, 288), (1024, 576)]
            for width, height in profile_sizes:
                for _ in range(args.warmup):
                    run(inputs[width, height][0], width, height)
                profiling = True
                def profiled_output_cast(images):
                    with torch.profiler.record_function("vj0/output_tensor_to_numpy"):
                        return production_gpu_cast(images)
                processor.pt_to_numpy = profiled_output_cast
                with module_range(pipe.transformer, "vj0/transformer", torch.profiler.record_function), \
                     module_range(pipe.vae.decoder, "vj0/vae_decoder", torch.profiler.record_function):
                    # Install every diagnostic wrapper before warming. If a
                    # compiled-call guard is affected, recapture outside trace.
                    wrapped_warmup_start = time.perf_counter()
                    wrapped_warmup_skips = []
                    for _ in range(args.warmup):
                        _, _, skipped = run(inputs[width, height][0], width, height)
                        wrapped_warmup_skips.append(skipped)
                        assert skipped == 1
                    wrapped_warmup_seconds = time.perf_counter() - wrapped_warmup_start
                    profile_quality_jpeg = []
                    with torch.profiler.profile(activities=[torch.profiler.ProfilerActivity.CPU,
                                                           torch.profiler.ProfilerActivity.CUDA],
                                                # Shape tracing retains tensors and can
                                                # perturb graph/memory lifetime decisions.
                                                record_shapes=False, profile_memory=False,
                                                with_stack=False) as profile:
                        for phase, raw in enumerate(inputs[width, height][:args.profile_frames]):
                            with torch.profiler.record_function("vj0/frame"):
                                _, jpeg, skipped = run(raw, width, height)
                            assert skipped == 1
                            if phase < 3:
                                profile_quality_jpeg.append(jpeg)
                            profile.step()
                profiling = False
                processor.pt_to_numpy = production_gpu_cast
                assert all(jpeg == quality_reference_jpeg[width, height, phase]
                           for phase, jpeg in enumerate(profile_quality_jpeg))
                prefix = args.output / f"profile-{width}x{height}"
                profile.export_chrome_trace(str(prefix) + ".json")
                with open(str(prefix) + ".json", "rb") as src, \
                     gzip.open(str(prefix) + ".json.gz", "wb") as dst:
                    shutil.copyfileobj(src, dst)
                Path(str(prefix) + ".json").unlink()
                averages = profile.key_averages()
                Path(str(prefix) + "-cuda.txt").write_text(averages.table(
                    sort_by="self_cuda_time_total", row_limit=100))
                Path(str(prefix) + "-cpu.txt").write_text(averages.table(
                    sort_by="self_cpu_time_total", row_limit=100))
                operator_rows = [{"key": item.key, "count": item.count,
                                  "self_cpu_time_total_us": item.self_cpu_time_total,
                                  "cpu_time_total_us": item.cpu_time_total,
                                  "self_device_time_total_us": item.self_device_time_total,
                                  "device_time_total_us": item.device_time_total}
                                 for item in averages]
                Path(str(prefix) + "-operators.json").write_text(json.dumps(operator_rows, indent=2) + "\n")
                save({"status": "profile", "size": [width, height], "steps": 2,
                      "frames": args.profile_frames, "torch_threads": torch.get_num_threads(),
                      "terminal_noop": True, "output_cast": "gpu",
                      "record_shapes": False, "with_stack": False,
                      "wrapped_warmup_seconds": wrapped_warmup_seconds,
                      "wrapped_warmup_skip_counts": wrapped_warmup_skips,
                      "profiled_quality_frames_exact": len(profile_quality_jpeg),
                      "trace": prefix.name + ".json.gz", "timing_claim": False})
        manifest["compute_summary"] = []
        for size in sizes:
            rows = [row for row in records if row["status"] == "compute-measured"
                    and row["size"] == list(size)]
            medians = {kind: statistics.median(row["fps"] for row in rows if row["variant"] == kind)
                       for kind in ("baseline", "optimized")}
            manifest["compute_summary"].append({
                "size": list(size), "same_process": True, "fps_medians": medians,
                "optimized_vs_baseline_pct": 100 * (medians["optimized"] / medians["baseline"] - 1)})
        if args.cast_pairs_1024:
            cast_rows = [row for row in records if row["status"] == "cast-measured"]
            medians = {kind: statistics.median(row["fps"] for row in cast_rows if row["cast"] == kind)
                       for kind in ("cpu", "gpu")}
            manifest["cast_summary"] = {"same_process": True, "fps_medians": medians,
                                        "gpu_vs_cpu_pct": 100 * (medians["gpu"] / medians["cpu"] - 1)}
        manifest["status"] = "complete"
    except Exception as error:
        manifest["status"] = "failed"
        manifest["error"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        manifest["finished_utc"] = datetime.now(timezone.utc).isoformat()
        save()


if __name__ == "__main__":
    main()
