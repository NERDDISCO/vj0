#!/usr/bin/env python3
"""Generate an isolated live worker for alternating compute experiments.

Uses the production loop and protocol. An additional benchmark-only state field
selects baseline or constant reuse plus CUDA-event stage timing between trials.
No production default or image is modified.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--source', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--queue-timing', action='store_true', help='Record reader-enqueue to GPU-thread dequeue time')
a = p.parse_args()
if a.output.exists():
    p.error('Refusing to overwrite an existing generated worker')
source = a.source.read_text()
generated = source


def replace(before, after):
    global generated
    if generated.count(before) != 1:
        p.error('Expected one source fragment: ' + before[:90])
    generated = generated.replace(before, after)


replace('    prompt_cache = PromptCache(pipe)', '''    prompt_cache = PromptCache(pipe)
    # The benchmark helper is pinned and hashed alongside this generated file.
    import types
    from compute import install_constant_cache, install_vae_constant_cache
    cached_functions = types.SimpleNamespace()
    install_constant_cache(cached_functions, torch, np)
    install_vae_constant_cache(cached_functions, torch, np)
    stage_events = [torch.cuda.Event(enable_timing=True) for _ in range(3)]''')
replace('            if "prompt" in data:', '''            if "benchmarkVariant" in data:
                variant = data["benchmarkVariant"]
                if variant not in ("baseline", "events", "combined", "all-constants"):
                    raise ValueError("Unknown benchmark compute variant")
                state["benchmark_variant"] = variant
            if "prompt" in data:''')
replace('''                torch.cuda.synchronize()
                t0 = time.perf_counter()
                lat = encode_image_to_latents(pipe, input_img, frame_state["width"], frame_state["height"])
                torch.cuda.synchronize()
                t_vae_encode = time.perf_counter()

                out = generate(pipe, lat, embeds,
                               frame_state["alpha"], frame_state["n_steps"],
                               frame_state["height"], frame_state["width"], frame_state["seed"])
                torch.cuda.synchronize()
                t_transformer = time.perf_counter()''', '''                variant = frame_state.get("benchmark_variant", "baseline")
                use_events = variant != "baseline"
                encode_frame = cached_functions.encode_image_to_latents if variant == "all-constants" else encode_image_to_latents
                generate_frame = cached_functions.generate if variant in ("combined", "all-constants") else generate
                if not use_events:
                    torch.cuda.synchronize()
                t0 = time.perf_counter()
                if use_events:
                    stage_events[0].record()
                lat = encode_frame(pipe, input_img, frame_state["width"], frame_state["height"])
                if use_events:
                    stage_events[1].record()
                else:
                    torch.cuda.synchronize()
                t_vae_encode = time.perf_counter()

                out = generate_frame(pipe, lat, embeds,
                               frame_state["alpha"], frame_state["n_steps"],
                               frame_state["height"], frame_state["width"], frame_state["seed"])
                if use_events:
                    stage_events[2].record()
                torch.cuda.synchronize()
                t_transformer = time.perf_counter()
                vae_stage_ms = stage_events[0].elapsed_time(stage_events[1]) if use_events else (t_vae_encode - t0) * 1000
                generation_stage_ms = stage_events[1].elapsed_time(stage_events[2]) if use_events else (t_transformer - t_vae_encode) * 1000''')
replace('"vae_encode_ms": round((t_vae_encode - t0) * 1000, 2),', '"vae_encode_ms": round(vae_stage_ms, 2),')
replace('"transformer_plus_decode_ms": round((t_transformer - t_vae_encode) * 1000, 2),', '"transformer_plus_decode_ms": round(generation_stage_ms, 2),\n                "stage_clock": "cuda-events" if use_events else "wall-clock",\n                "benchmark_variant": variant,')
if a.queue_timing:
    replace('                request_queue.put(data)',
        '                data["_bench_enqueued_at"] = time.perf_counter()\n                request_queue.put(data)')
    replace('            req = request_queue.get(timeout=0.05)',
        '            req = request_queue.get(timeout=0.05)\n            req["_bench_queue_ms"] = (time.perf_counter() - req["_bench_enqueued_at"]) * 1000')
    replace('            timing = {',
        '            timing = {\n                "queue_wait_ms": round(req["_bench_queue_ms"], 3),')
ast.parse(generated)
a.output.write_text(generated)
print(json.dumps({'source_sha256': hashlib.sha256(source.encode()).hexdigest(),
    'generated_sha256': hashlib.sha256(generated.encode()).hexdigest()}))
