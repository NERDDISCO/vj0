#!/usr/bin/env python3
"""Exercise the real worker loop with fake model work and a scripted stdin.

Both startup shapes and a subsequently supplied frame must run on one thread.
No CUDA workload is executed. Run in the worker's Python environment.
"""
import argparse
import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import threading
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker-script", type=Path, required=True)
    parser.add_argument("--scenario", choices=("ownership", "idle-grace", "shutdown", "failure"), default="ownership")
    args = parser.parse_args()
    import torch
    from PIL import Image

    spec = importlib.util.spec_from_file_location("tested_worker", args.worker_script)
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    calls, events = [], []
    all_warm = threading.Event()
    frame_done = threading.Event()
    owner = threading.get_ident()
    optional_started, frame_finished = [], []

    def warmup(pipe, cache, width, height, *unused):
        calls.append({"kind": "warmup", "shape": [width, height],
                      "on_owner_thread": threading.get_ident() == owner})
        if len([c for c in calls if c["kind"] == "warmup"]) == 2:
            optional_started.append(time.monotonic())
            all_warm.set()
            if args.scenario == "failure":
                raise RuntimeError("intentional warmup failure")

    def encode(*args):
        calls.append({"kind": "encode", "on_owner_thread": threading.get_ident() == owner})

    def generate(pipe, latents, embeds, alpha, steps, height, width, seed):
        calls.append({"kind": "generate", "on_owner_thread": threading.get_ident() == owner})
        if args.scenario == "idle-grace":
            time.sleep(1.1)
        return Image.new("RGB", (width, height), "white")

    def emit(**event):
        events.append(event["status"])
        if event["status"] in ("frame", "error"):
            frame_finished.append(time.monotonic())
            frame_done.set()
        if event["status"] == "compile_failed":
            frame_done.set()

    image = io.BytesIO()
    Image.new("RGB", (16, 16), "black").save(image, format="JPEG")

    class Input:
        def __iter__(self):
            if args.scenario == "shutdown":
                yield '{"command":"shutdown"}\n'
                return
            if args.scenario == "idle-grace":
                yield json.dumps({"image_base64": base64.b64encode(image.getvalue()).decode(),
                    "width": 16, "height": 16, "captureWidth": 16, "captureHeight": 16}) + "\n"
                all_warm.wait(timeout=5)
                yield '{"command":"shutdown"}\n'
                return
            if args.scenario == "failure":
                frame_done.wait(timeout=5)
                yield '{"command":"shutdown"}\n'
                return
            if all_warm.wait(timeout=5):
                yield json.dumps({"image_base64": base64.b64encode(image.getvalue()).decode(),
                    "width": 16, "height": 16, "captureWidth": 16, "captureHeight": 16}) + "\n"
                frame_done.wait(timeout=5)
            yield '{"command":"shutdown"}\n'

    worker.setup_pipeline = lambda: None
    worker.PromptCache = lambda pipe: type("Cache", (), {"get": lambda self, prompt: None})()
    worker.warmup = warmup
    worker.encode_image_to_latents = encode
    worker.generate = generate
    worker.emit = emit
    worker.log = lambda *args: None
    original_input, original_sync = sys.stdin, torch.cuda.synchronize
    previous_shapes = os.environ.get("WARMUP_SHAPES")
    try:
        os.environ["WARMUP_SHAPES"] = "16x16,32x16"
        sys.stdin = Input()
        torch.cuda.synchronize = lambda: None
        worker.main()
    finally:
        sys.stdin, torch.cuda.synchronize = original_input, original_sync
        if previous_shapes is None:
            os.environ.pop("WARMUP_SHAPES", None)
        else:
            os.environ["WARMUP_SHAPES"] = previous_shapes
    passed = (len(calls) == 4 and all(c["on_owner_thread"] for c in calls)
              and events.count("frame") == 1 and "error" not in events
              and "compile_failed" not in events)
    idle_seconds = optional_started[0] - frame_finished[0] if optional_started and frame_finished else None
    if args.scenario == "idle-grace":
        passed = passed and idle_seconds is not None and idle_seconds >= 1.0
        passed = passed and [c["kind"] for c in calls] == ["warmup", "encode", "generate", "warmup"]
    elif args.scenario == "shutdown":
        passed = len(calls) == 1 and events == ["ready", "shutdown"]
    elif args.scenario == "failure":
        passed = len(calls) == 2 and events == ["ready", "compile_failed", "shutdown"]
    print(json.dumps({"scenario": args.scenario, "calls": calls, "events": events,
                      "idle_seconds_after_frame": idle_seconds, "passed": passed}))
    raise SystemExit(0 if passed else 1)


if __name__ == "__main__":
    main()
