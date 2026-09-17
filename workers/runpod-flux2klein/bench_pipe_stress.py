#!/usr/bin/env python3
"""
Stress-test inference_server.py at high resolution WITHOUT WebRTC.

Drives the worker directly via stdin/stdout subprocess. Pumps N frames
at the target resolution and reports:
  - per-frame timing (from the worker's own timing dict)
  - emit latency (time between worker finishing GPU work and us receiving the result)
  - any frame that takes >HANG_TIMEOUT_S to produce (= probable hang)
  - total throughput

Usage (on the pod):
    python3 bench_pipe_stress.py --width 768 --height 448 --frames 2000
    python3 bench_pipe_stress.py --width 448 --height 768 --frames 2000

If the worker hangs, the script prints the last frame number and exits with code 1.
This isolates whether the hang is in inference (CUDA/compile) or in the
WebRTC/Node pipe layer.
"""
import argparse
import base64
import json
import os
import signal
import subprocess
import sys
import time
from io import BytesIO

import numpy as np
from PIL import Image


HANG_TIMEOUT_S = 60  # if a frame takes longer than this, it's hung


def make_synthetic_frame(width, height):
    """Generate a random RGB image and return as base64 raw bytes."""
    arr = np.random.randint(0, 255, (height, width, 3), dtype=np.uint8)
    return base64.b64encode(arr.tobytes()).decode("ascii")


def main():
    parser = argparse.ArgumentParser(description="Stress test inference_server.py")
    parser.add_argument("--width", type=int, default=768)
    parser.add_argument("--height", type=int, default=448)
    parser.add_argument("--frames", type=int, default=20000)
    parser.add_argument("--alpha", type=float, default=0.10)
    parser.add_argument("--n-steps", type=int, default=4)
    parser.add_argument("--script", type=str, default="./inference_server.py")
    parser.add_argument("--gpu", type=int, default=0)
    args = parser.parse_args()

    print(f"=== Pipe stress test: {args.width}x{args.height}, {args.frames} frames, GPU {args.gpu} ===")
    print(f"    compile_mode={os.environ.get('COMPILE_MODE', 'reduce-overhead')}")
    print(f"    hang timeout={HANG_TIMEOUT_S}s")
    print()

    env = {**os.environ, "CUDA_VISIBLE_DEVICES": str(args.gpu), "WORKER_ID": str(args.gpu)}
    proc = subprocess.Popen(
        ["python3", args.script],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr,
        env=env,
    )

    def send(msg):
        line = json.dumps(msg) + "\n"
        proc.stdin.write(line.encode())
        proc.stdin.flush()

    def recv(timeout_s=HANG_TIMEOUT_S):
        """Read lines until we get a frame or error. Returns parsed JSON or None on timeout."""
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            # Use a short select-style poll
            import select
            ready, _, _ = select.select([proc.stdout], [], [], 1.0)
            if not ready:
                continue
            line = proc.stdout.readline()
            if not line:
                return None  # EOF — worker crashed
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                # raw log line, skip
                print(f"  [worker log] {line.decode().strip()}")
                continue
            if msg.get("log"):
                print(f"  [worker] {msg['log']}")
                continue
            if msg.get("status") in ("phase", "compiling", "compiling_progress", "warmed"):
                print(f"  [worker] {msg.get('status')}: {msg.get('stage', '')} {msg.get('width','?')}x{msg.get('height','?')}")
                continue
            if msg.get("status") == "ready":
                print(f"  [worker] READY")
                return msg
            if msg.get("status") == "error":
                print(f"  [worker ERROR] {msg.get('message')}")
                continue
            return msg
        return None  # timeout

    # Wait for worker to be ready
    print("Waiting for worker to become ready...")
    ready_msg = recv(timeout_s=600)  # up to 10 min for cold compile
    while ready_msg and ready_msg.get("status") != "ready":
        ready_msg = recv(timeout_s=600)
    if not ready_msg:
        print("FATAL: worker never became ready")
        proc.kill()
        sys.exit(1)
    print(f"Worker ready. Starting stress test...\n")

    # Send initial settings
    send({
        "prompt": "vibrant neon cyberpunk city street at night, rain, reflections",
        "width": args.width,
        "height": args.height,
        "captureWidth": args.width,
        "captureHeight": args.height,
        "alpha": args.alpha,
        "n_steps": args.n_steps,
        "seed": 42,
    })

    # Pre-generate a synthetic frame (reused for all requests)
    print(f"Generating synthetic input frame ({args.width}x{args.height})...")
    frame_b64 = make_synthetic_frame(args.width, args.height)
    print(f"  base64 size: {len(frame_b64)} chars ({len(frame_b64) / 1024:.0f} KB)")
    print()

    # Pump frames
    timings = []
    emit_latencies = []
    hung_at = None

    for i in range(1, args.frames + 1):
        t_send = time.perf_counter()
        send({"image_base64": frame_b64})

        result = recv(timeout_s=HANG_TIMEOUT_S)
        t_recv = time.perf_counter()

        if result is None:
            print(f"\n!!! HANG DETECTED at frame {i} — no response in {HANG_TIMEOUT_S}s !!!")
            hung_at = i
            break

        if result.get("status") != "frame":
            print(f"  unexpected response at frame {i}: {result.get('status')}")
            continue

        round_trip_ms = (t_recv - t_send) * 1000
        timing = result.get("timing", {})
        total_ms = timing.get("total_ms", 0)
        emit_latency = round_trip_ms - total_ms  # time spent in base64 encode + json.dumps + pipe write + pipe read + json.loads

        timings.append(timing)
        emit_latencies.append(emit_latency)

        if i <= 5 or i % 100 == 0:
            print(f"  frame {i:5d}: total={total_ms:.1f}ms  roundtrip={round_trip_ms:.1f}ms  pipe_overhead={emit_latency:.1f}ms  vae={timing.get('vae_encode_ms',0):.1f}ms  transformer={timing.get('transformer_plus_decode_ms',0):.1f}ms")

    # Summary
    print(f"\n{'='*60}")
    if hung_at:
        print(f"RESULT: HUNG at frame {hung_at}/{args.frames}")
        print(f"  The inference process hangs — this is NOT a WebRTC/pipe issue.")
        print(f"  Root cause is likely CUDA graph stall (reduce-overhead mode).")
    else:
        print(f"RESULT: All {args.frames} frames completed successfully")

    if timings:
        total_vals = [t["total_ms"] for t in timings]
        vae_vals = [t.get("vae_encode_ms", 0) for t in timings]
        xformer_vals = [t.get("transformer_plus_decode_ms", 0) for t in timings]

        print(f"\n  Inference timing (ms):")
        print(f"    total:       mean={sum(total_vals)/len(total_vals):.1f}  min={min(total_vals):.1f}  max={max(total_vals):.1f}")
        print(f"    vae_encode:  mean={sum(vae_vals)/len(vae_vals):.1f}  min={min(vae_vals):.1f}  max={max(vae_vals):.1f}")
        print(f"    transformer: mean={sum(xformer_vals)/len(xformer_vals):.1f}  min={min(xformer_vals):.1f}  max={max(xformer_vals):.1f}")

        print(f"\n  Pipe overhead (ms):  mean={sum(emit_latencies)/len(emit_latencies):.1f}  min={min(emit_latencies):.1f}  max={max(emit_latencies):.1f}")

        fps = 1000 / (sum(total_vals) / len(total_vals))
        print(f"\n  Throughput: {fps:.1f} fps (single GPU)")
        print(f"  Frames completed: {len(timings)}/{args.frames}")

    # Cleanup
    try:
        send({"command": "shutdown"})
        proc.wait(timeout=5)
    except Exception:
        proc.kill()

    sys.exit(1 if hung_at else 0)


if __name__ == "__main__":
    main()
