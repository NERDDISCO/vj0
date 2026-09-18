#!/usr/bin/env python3
"""Gate N05 on real Klein FFN inputs and explicit native SM120 NVFP4 kernels.

No model quality claim or production change is made by a successful kernel gate.
Run only in a parent-assigned exclusive GPU slot. No package installation here.
"""
import argparse
from datetime import datetime, timezone
import gzip
import importlib.metadata
import io
import json
import os
from pathlib import Path
import statistics
import subprocess
import traceback

from n05_nvfp4 import fixture, import_worker, prepare_native, retain_original_weights, sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--worker-script", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--iterations", type=int, default=100)
    p.add_argument("--expected-native-threads", type=int, default=128)
    args = p.parse_args()
    if args.output.exists():
        p.error("Refusing to overwrite an output directory")
    active = subprocess.check_output([
        "nvidia-smi", "--query-compute-apps=pid,process_name,used_gpu_memory",
        "--format=csv,noheader"], text=True).strip()
    if active:
        raise RuntimeError("GPU has active compute; leave N05 queued")
    args.output.mkdir(parents=True)
    manifest = {"status": "running", "started_utc": datetime.now(timezone.utc).isoformat(),
                "records": [], "scope": "kernel correctness/latency only; no visual acceptance"}

    def save(record=None):
        if record:
            manifest["records"].append(record)
            print(json.dumps(record), flush=True)
        temp = args.output / "result.tmp.json"
        temp.write_text(json.dumps(manifest, indent=2) + "\n")
        temp.replace(args.output / "result.json")

    save()
    try:
        os.environ.pop("TORCH_NUM_THREADS", None)
        os.environ["USE_TERMINAL_NOOP"] = "1"
        os.environ["USE_GPU_OUTPUT_CAST"] = "1"
        import torch
        import torch.nn.functional as F
        from PIL import Image
        from flashinfer import SfLayout, nvfp4_quantize
        from flashinfer.quantization import e2m1_and_ufp8sf_scale_to_float
        torch.set_grad_enabled(False)
        Nvfp4Linear, identity = prepare_native()
        manifest.update({"native": identity, "gpu": torch.cuda.get_device_name(),
                         "versions": {n: importlib.metadata.version(n) for n in
                                      ("torch", "torchao", "diffusers", "flashinfer-python", "nvidia-cutlass-dsl")},
                         "source_sha256": {"probe": sha(__file__),
                                           "helper": sha(Path(__file__).with_name("n05_nvfp4.py")),
                                           "worker": sha(args.worker_script),
                                           "runtime": sha(args.worker_script.with_name("worker_runtime.py"))}})
        worker = import_worker(args.worker_script.resolve())
        logs = []
        orig_log = worker.log

        def log(message):
            logs.append(message)
            orig_log(message)

        worker.log = log
        with retain_original_weights(worker, capture_only=True) as originals:
            pipe = worker.setup_pipeline()
        assert torch.get_num_threads() == args.expected_native_threads
        assert len(originals) == 10, "Unexpected Klein image FFN family"
        assert any("fp8 applied to transformer" in x for x in logs)
        assert not any("WARNING: fp8 quantization failed" in x for x in logs)
        assert pipe._vj0_skip_terminal_enabled and pipe._vj0_gpu_output_cast_enabled
        root = pipe.transformer
        layers = {n: root.get_submodule(n) for n in originals}
        assert all(type(x.weight).__name__ != "Parameter" for x in layers.values()), "FP8 tensor subclass missing"
        manifest["capture_mode"] = "Untimed eager FP8 transformer, production compiled FP8 VAE; actual worker latent-noise conditioning"
        manifest["layer_inventory"] = {n: list(m.weight.shape) for n, m in originals.items()}
        manifest["boot_logs"] = logs
        save()
        prompt = worker.PromptCache(pipe).get("colorful abstract art, vibrant neon lights, psychedelic patterns")
        representatives = ("transformer_blocks.2.ff.linear_in", "transformer_blocks.2.ff.linear_out")
        captured = {}

        def cosine(a, b):
            return F.cosine_similarity(a.float().flatten(), b.float().flatten(), dim=0).item()

        def metrics(a, b):
            delta = a.float() - b.float()
            return {"cosine": cosine(a, b), "mse": delta.square().mean().item(),
                    "normalized_rmse": (delta.square().mean().sqrt() /
                                        b.float().square().mean().sqrt().clamp_min(1e-30)).item(),
                    "maximum_absolute_error": delta.abs().max().item()}

        def dequant(packed, scale, global_scale):
            return e2m1_and_ufp8sf_scale_to_float(
                packed.cpu(), scale.cpu().view(torch.uint8).reshape(-1),
                (1.0 / global_scale).cpu(), 16, 1, True).to("cuda")

        # Each side includes its dynamic activation quantization, excluding input
        # preparation and weight quantization. CUDA graphs remove Python launch
        # skew equally; this is still a microbenchmark, not full-frame FPS.
        def capture_graph(fn, x):
            for _ in range(4):
                fn(x)
            torch.cuda.synchronize()
            stream = torch.cuda.Stream()
            stream.wait_stream(torch.cuda.current_stream())
            with torch.cuda.stream(stream):
                for _ in range(3):
                    fn(x)
            stream.synchronize()
            graph = torch.cuda.CUDAGraph()
            with torch.cuda.graph(graph, stream=stream):
                y = fn(x)
            torch.cuda.current_stream().wait_stream(stream)
            return graph, y

        def paired_graph_times(control, candidate, x):
            graphs = {"fp8": capture_graph(control, x), "nvfp4": capture_graph(candidate, x)}
            values = {"fp8": [], "nvfp4": []}
            for pair in range(5):
                order = ("fp8", "nvfp4") if pair % 2 == 0 else ("nvfp4", "fp8")
                for variant in order:
                    graph, _ = graphs[variant]
                    start, end = torch.cuda.Event(enable_timing=True), torch.cuda.Event(enable_timing=True)
                    start.record()
                    for _ in range(args.iterations):
                        graph.replay()
                    end.record()
                    end.synchronize()
                    values[variant].append(start.elapsed_time(end) / args.iterations)
            return values["fp8"], values["nvfp4"]

        for width, height in ((512, 288), (768, 448), (1024, 576)):
            handles = []
            for name in representatives:
                def hook(_module, inputs, name=name):
                    captured[name] = inputs[0].detach().clone()
                handles.append(layers[name].register_forward_pre_hook(hook))
            jpeg = fixture(width, height, 2)
            image = Image.open(io.BytesIO(jpeg)).convert("RGB")
            latents = worker.encode_image_to_latents(pipe, image, width, height)
            worker.generate(pipe, latents, prompt, .1, 2, height, width, 42)
            torch.cuda.synchronize()
            for handle in handles:
                handle.remove()
            for name in representatives:
                x = captured[name]
                assert torch.isfinite(x).all().item() and x.abs().max().item() > 0
                layer = layers[name]
                candidate = Nvfp4Linear(originals[name])
                assert candidate.packed_weight.element_size() == 1
                assert candidate.packed_weight.shape[1] * 2 == x.shape[-1]
                torch.cuda.synchronize()
                memory_before_native = torch.cuda.memory_allocated()
                torch.cuda.reset_peak_memory_stats()
                got = candidate(x)
                torch.cuda.synchronize()
                native_peak_delta = torch.cuda.max_memory_allocated() - memory_before_native
                finite = bool(torch.isfinite(got).all().item())
                nonzero = bool(torch.count_nonzero(got).item())
                if not finite or not nonzero:
                    raise RuntimeError(f"Native NVFP4 invalid output at {name}/{width}: finite={finite}, nonzero={nonzero}")
                control = layer(x)
                a = x.reshape(-1, x.shape[-1]).contiguous()
                global_a = 2688.0 / a.float().abs().amax().clamp_min(1e-30)
                packed_a, sf_a = nvfp4_quantize(a, global_a, sfLayout=SfLayout.layout_128x4,
                                              do_shuffle=False, backend="cuda")
                # This untimed oracle explicitly dequantizes packed buffers. It
                # never participates in the measured/native inference path.
                da = dequant(packed_a, sf_a, global_a)
                db = dequant(candidate.packed_weight, candidate.weight_scale, candidate.weight_global)
                old_tf32 = torch.backends.cuda.matmul.allow_tf32
                torch.backends.cuda.matmul.allow_tf32 = False
                oracle = (da @ db.T).to(torch.bfloat16).reshape(got.shape)
                torch.backends.cuda.matmul.allow_tf32 = old_tf32
                oracle_metrics = metrics(got, oracle)
                assert oracle_metrics["cosine"] > .9999 and oracle_metrics["normalized_rmse"] < .005, oracle_metrics
                error_vs_fp8 = metrics(got, control)
                assert error_vs_fp8["cosine"] > .97, "Catastrophic layer approximation; stop pilot"
                trace = args.output / f"{width}x{height}-{name}-native.json"
                with torch.profiler.profile(activities=[torch.profiler.ProfilerActivity.CPU,
                                                        torch.profiler.ProfilerActivity.CUDA]) as prof:
                    for _ in range(3):
                        candidate(x)
                    torch.cuda.synchronize()
                prof.export_chrome_trace(str(trace))
                data = json.loads(trace.read_text())
                kernel_names = sorted({e.get("name", "") for e in data["traceEvents"] if e.get("cat") == "kernel"})
                # Native kernel identity is reviewable alongside the pinned
                # b12x implementation's MmaMXF4NVF4Op. Don't count quantizers as GEMM.
                native_names = [n for n in kernel_names if "Sm120B12x" in n]
                with gzip.open(str(trace) + ".gz", "wb") as zipped:
                    zipped.write(trace.read_bytes())
                trace.unlink()
                if not native_names:
                    save({"phase": "unresolved-native-trace", "layer": name,
                          "resolution": [width, height], "kernel_names": kernel_names})
                    raise RuntimeError("Native GEMM trace identity needs review; no auto-pass")
                diagnostic_high_water = torch.cuda.max_memory_allocated()
                del got, control, da, db, oracle, packed_a, sf_a
                fp8_ms, nvfp4_ms = paired_graph_times(layer, candidate, x)
                save({"phase": "kernel", "layer": name, "resolution": [width, height],
                      "input_shape": list(x.shape), "weight_shape": list(originals[name].weight.shape),
                      "finite": finite, "nonzero": nonzero, "oracle": oracle_metrics,
                      "versus_fp8": error_vs_fp8, "native_kernel_names": native_names,
                      "kernel_names": kernel_names, "graph_fp8_ms": fp8_ms,
                      "graph_nvfp4_ms": nvfp4_ms,
                      "micro_speed_ratio": statistics.median(fp8_ms) / statistics.median(nvfp4_ms),
                      "memory_allocated_before_native_bytes": memory_before_native,
                      "native_call_peak_delta_bytes": native_peak_delta,
                      "diagnostic_high_water_including_oracle_bytes": diagnostic_high_water,
                      "packed_weight_bytes": candidate.packed_weight.numel() * candidate.packed_weight.element_size(),
                      "block_scale_bytes": candidate.weight_scale.numel() * candidate.weight_scale.element_size()})
                del candidate
        manifest["status"] = "kernel-gate-passed"
        manifest["model_quality"] = "not tested; requires separate matrix and human visual acceptance"
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
