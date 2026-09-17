#!/usr/bin/env python3
"""Check the real warmup function's grad boundary from a fresh Python thread.

Run in the worker environment. Replaces GPU work with tiny CPU operations, so
this checks thread-local grad semantics without running another CUDA workload.
The frozen baseline must fail; the corrected worker must pass. Real multi-shape
startup still needs a separate GPU validation.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import threading


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker-script", type=Path, required=True)
    args = parser.parse_args()
    import torch

    spec = importlib.util.spec_from_file_location("tested_worker", args.worker_script)
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    operations = []
    report = {}
    weight = torch.ones(1, requires_grad=True)

    def operation(*args, **kwargs):
        result = weight * 2
        operations.append({"grad_enabled": torch.is_grad_enabled(),
                           "result_requires_grad": result.requires_grad})
        return result

    class Prompts:
        get = staticmethod(operation)

    worker.encode_image_to_latents = operation
    worker.generate = operation
    worker.emit = lambda **kwargs: None
    worker.log = lambda *args: None
    original_sync = torch.cuda.synchronize
    torch.cuda.synchronize = lambda: None

    def background():
        report["thread_grad_before"] = torch.is_grad_enabled()
        try:
            worker.warmup(None, Prompts(), 512, 288, 0.10, 4)
        except Exception as error:
            report["error"] = repr(error)
        report["thread_grad_after"] = torch.is_grad_enabled()

    try:
        with torch.no_grad():
            thread = threading.Thread(target=background)
            thread.start()
            thread.join(timeout=10)
            if thread.is_alive():
                raise RuntimeError("Warmup regression thread did not finish")
            report["parent_grad_after"] = torch.is_grad_enabled()
    finally:
        torch.cuda.synchronize = original_sync
    report["operations"] = operations
    report["passed"] = ("error" not in report and report["thread_grad_before"]
        and report["thread_grad_after"] and not report["parent_grad_after"]
        and len(operations) == worker.WARMUP_ITERS + 2
        and all(not op["grad_enabled"] and not op["result_requires_grad"] for op in operations))
    print(json.dumps(report))
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
