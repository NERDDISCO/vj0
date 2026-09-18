#!/usr/bin/env python3
"""Generate an isolated source-ordered worker with a terminal-noop experiment.

Composes the existing configurable_worker.py transformation with the pinned
terminal_noop helper. Does not alter either production defaults or those helpers.
The benchmarkVariant control accepts baseline/events/combined/terminal-noop;
terminal-noop uses combined constant caching/event timing plus the guarded skip.
benchmarkThreads changes CPU intra-op threads on the main execution thread,
before shape warmup and frame timing. Omission preserves the initial thread count.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--queue-timing", action="store_true")
    parser.add_argument("--gpu-output-cast", action="store_true",
                        help="Pair terminal skipping with GPU output conversion at native threads")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Refusing to overwrite an existing generated worker")
    base_helper = Path(__file__).with_name("configurable_worker.py")
    with tempfile.TemporaryDirectory(prefix="vj0-terminal-live-") as directory:
        intermediate = Path(directory) / "configurable_worker.py"
        command = [sys.executable, str(base_helper), "--source", str(args.source),
                   "--output", str(intermediate)]
        if args.queue_timing:
            command.append("--queue-timing")
        result = subprocess.run(command, check=True, capture_output=True, text=True)
        base_manifest = json.loads(result.stdout)
        generated = intermediate.read_text()

    def replace(before, after):
        nonlocal generated
        if generated.count(before) != 1:
            parser.error("Expected one source fragment: " + before[:100])
        generated = generated.replace(before, after)

    # Install once after model setup, before any warmup. Disabled initially;
    # the unchanged startup warmup uses the original pipeline path.
    replace("    pipe = setup_pipeline()\n    prompt_cache = PromptCache(pipe)",
            "    pipe = setup_pipeline()\n    from terminal_noop import install as install_terminal_noop\n"
            "    install_terminal_noop(pipe)\n"
            "    benchmark_threads_applied = torch.get_num_threads()\n"
            "    prompt_cache = PromptCache(pipe)")
    replace("    from compute import install_constant_cache, install_vae_constant_cache",
            "    from compute import install_constant_cache")
    replace("    install_vae_constant_cache(cached_functions, torch, np)\n", "")
    replace('if variant not in ("baseline", "events", "combined", "all-constants"):',
            'if variant not in ("baseline", "events", "combined", "terminal-noop"):')
    replace('    state = {\n',
            '    state = {\n        "benchmark_threads": benchmark_threads_applied,\n')
    replace('            if "benchmarkVariant" in data:',
            '            if "benchmarkThreads" in data:\n'
            '                threads = data["benchmarkThreads"]\n'
            '                if type(threads) is not int or not 1 <= threads <= 256:\n'
            '                    raise ValueError("benchmarkThreads must be an integer from 1 to 256")\n'
            '                state["benchmark_threads"] = threads\n'
            '            if "benchmarkVariant" in data:')

    # The flag follows the same atomic per-frame settings snapshot as size,
    # seed, alpha and steps, including any shape warmup for that frame.
    replace('            frame_state = state.copy()\n',
            '            frame_state = state.copy()\n'
            '        requested_threads = frame_state["benchmark_threads"]\n'
            '        if requested_threads != benchmark_threads_applied:\n'
            '            torch.set_num_threads(requested_threads)\n'
            '            benchmark_threads_applied = torch.get_num_threads()\n'
            '        pipe._vj0_skip_terminal_enabled = (\n'
            '            frame_state.get("benchmark_variant", "baseline") == "terminal-noop"\n'
            '        )\n')
    replace('encode_frame = cached_functions.encode_image_to_latents if variant == "all-constants" else encode_image_to_latents',
            'encode_frame = encode_image_to_latents')
    replace('generate_frame = cached_functions.generate if variant in ("combined", "all-constants") else generate',
            'generate_frame = cached_functions.generate if variant in ("combined", "terminal-noop") else generate')
    replace('                out = generate_frame(pipe, lat, embeds,',
            '                terminal_skips_before = pipe._vj0_terminal_skips\n'
            '                out = generate_frame(pipe, lat, embeds,')
    replace('                "benchmark_variant": variant,',
            '                "benchmark_variant": variant,\n'
            '                "torch_threads": benchmark_threads_applied,\n'
            '                "terminal_skips": pipe._vj0_terminal_skips - terminal_skips_before,')

    if args.gpu_output_cast:
        replace('    install_terminal_noop(pipe)\n',
                '    install_terminal_noop(pipe)\n'
                '    from gpu_output_cast import GPUOutputCastProbe\n'
                '    output_cast_probe = GPUOutputCastProbe(pipe.image_processor, np)\n'
                '    original_output_cast = output_cast_probe.original\n'
                '    pipe.image_processor.pt_to_numpy = original_output_cast\n')
        replace('        requested_threads = frame_state["benchmark_threads"]\n',
                '        pipe.image_processor.pt_to_numpy = (output_cast_probe.convert\n'
                '            if frame_state.get("benchmark_variant") == "terminal-noop" else original_output_cast)\n'
                '        requested_threads = frame_state["benchmark_threads"]\n')
        replace('                "torch_threads": benchmark_threads_applied,',
                '                "output_cast": "gpu" if variant == "terminal-noop" else "cpu",\n'
                '                "torch_threads": benchmark_threads_applied,')

    # The supplied source must be the current corrected worker, not the old
    # baked baseline. Preserve source identity and settings snapshot behavior.
    required = ['source_seq=req.get("source_seq"),', 'frame_state = state.copy()',
                'remaining_shapes = list(dict.fromkeys(shapes[1:]))',
                'with gpu_lock:', 'stage_events[0].record()',
                '"benchmark_variant": variant,', '"terminal_skips":',
                '"torch_threads": benchmark_threads_applied,',
                'if requested_threads != benchmark_threads_applied:',
                'if type(threads) is not int or not 1 <= threads <= 256:']
    if args.queue_timing:
        required += ['data["_bench_enqueued_at"] = time.perf_counter()',
                     '"queue_wait_ms": round(req["_bench_queue_ms"], 3),']
    for fragment in required:
        if fragment not in generated:
            parser.error("Generated worker is missing required behavior: " + fragment)
    if "all-constants" in generated:
        parser.error("Unexpected obsolete experiment choice in generated worker")
    ast.parse(generated)
    args.output.write_text(generated)
    helpers = [base_helper, Path(__file__).with_name("compute.py"),
               Path(__file__).with_name("terminal_noop.py")]
    print(json.dumps({
        "source_sha256": hashlib.sha256(args.source.read_bytes()).hexdigest(),
        "generated_sha256": hashlib.sha256(generated.encode()).hexdigest(),
        "generator_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "configurable_transform": base_manifest,
        "helper_sha256": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in helpers},
        "queue_timing": args.queue_timing,
        "gpu_output_cast": args.gpu_output_cast,
        "variants": ["baseline", "events", "combined", "terminal-noop"],
        "thread_control": {"field": "benchmarkThreads", "range": [1, 256],
                           "default": "torch.get_num_threads() after setup"},
    }))


if __name__ == "__main__":
    main()
