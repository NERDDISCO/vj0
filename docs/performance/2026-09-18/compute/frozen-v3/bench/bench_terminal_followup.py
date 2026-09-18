#!/usr/bin/env python3
"""Run the unchanged terminal benchmark with isolated CPU/graph diagnostics.

Adds --torch-threads N, --torch-interop-threads N, --threads-sweep default,1,4,8,16
and --mark-step-begin, plus an optional --gpu-output-cast experiment.
Marked/unmarked graph modes require separate processes:
the PyTorch explicit generation counter remains active after its first use.
All original quality/RNG gates remain; each thread budget warms independently.
"""
import hashlib
import os
from pathlib import Path
import resource


def cpu_snapshot():
    result = {"process_user_s": os.times().user, "process_system_s": os.times().system}
    usage = resource.getrusage(resource.RUSAGE_SELF)
    result.update(voluntary_switches=usage.ru_nvcsw, involuntary_switches=usage.ru_nivcsw)
    try:
        text = Path("/proc/self/status").read_text()
        result["process_threads"] = next(int(line.split()[1]) for line in text.splitlines()
                                         if line.startswith("Threads:"))
    except (OSError, StopIteration):
        result["process_threads"] = None
    candidates = [Path("/sys/fs/cgroup/cpu/cpu.stat"),
                  Path("/sys/fs/cgroup/cpu,cpuacct/cpu.stat"), Path("/sys/fs/cgroup/cpu.stat")]
    for path in candidates:
        try:
            result["cgroup_stat"] = {key: int(value) for key, value in
                                      (line.split() for line in path.read_text().splitlines())}
            result["cgroup_stat_path"] = str(path)
            break
        except (OSError, ValueError):
            continue
    return result


def cpu_delta(before, after, wall_seconds):
    keys = ["process_user_s", "process_system_s", "voluntary_switches", "involuntary_switches"]
    delta = {key: after[key] - before[key] for key in keys}
    delta["average_process_cpu_cores"] = (delta["process_user_s"] + delta["process_system_s"]) / wall_seconds
    if before.get("cgroup_stat_path") == after.get("cgroup_stat_path") and "cgroup_stat" in before:
        delta["cgroup_stat_path"] = before["cgroup_stat_path"]
        delta["cgroup_stat"] = {key: after["cgroup_stat"][key] - value
                                for key, value in before["cgroup_stat"].items()
                                if key in after["cgroup_stat"]}
        stat = delta["cgroup_stat"]
        if "throttled_time" in stat:
            delta["cgroup_throttled_seconds"] = stat["throttled_time"] / 1e9
        elif "throttled_usec" in stat:
            delta["cgroup_throttled_seconds"] = stat["throttled_usec"] / 1e6
        # This cgroup counter can aggregate multiple CPUs; it is not the
        # fraction of wall time this inference process was stalled.
        delta["cgroup_scope"] = "whole cgroup; throttled time may aggregate CPUs"
    return {"before": before, "after": after, "delta": delta}


def transformed_source(source):
    generated = source

    def replace(before, after):
        nonlocal generated
        if generated.count(before) != 1:
            raise RuntimeError("Expected one benchmark fragment: " + before[:100])
        generated = generated.replace(before, after)

    replace('    a = p.parse_args()', '''    p.add_argument("--torch-threads", type=int)
    p.add_argument("--torch-interop-threads", type=int)
    p.add_argument("--threads-sweep", help="Comma-separated positive counts or default")
    p.add_argument("--mark-step-begin", action="store_true")
    p.add_argument("--gpu-output-cast", action="store_true")
    a = p.parse_args()
    if a.torch_threads is not None and a.threads_sweep:
        p.error("Use either torch-threads or threads-sweep")
    if any(x is not None and x < 1 for x in (a.torch_threads, a.torch_interop_threads)):
        p.error("Thread counts must be positive")''')
    replace('    import torch\n', '''    import torch
    initial_torch_threads = torch.get_num_threads()
    if a.torch_threads is not None:
        torch.set_num_threads(a.torch_threads)
    if a.torch_interop_threads is not None:
        torch.set_num_interop_threads(a.torch_interop_threads)
    try:
        thread_budgets = ([initial_torch_threads if x.strip() == "default" else int(x)
                           for x in a.threads_sweep.split(",")] if a.threads_sweep
                          else [torch.get_num_threads()])
        if not thread_budgets or min(thread_budgets) < 1:
            raise ValueError("invalid count")
    except ValueError:
        p.error("threads-sweep requires positive integers or default")
    thread_budgets = list(dict.fromkeys(thread_budgets))
''')
    replace('        "started_utc": datetime.now(timezone.utc).isoformat(),', '''        "started_utc": datetime.now(timezone.utc).isoformat(),
        "followup_base_benchmark_sha256": _followup_base_sha,
        "followup_generated_sha256": _followup_generated_sha,
        "initial_torch_threads": initial_torch_threads,
        "thread_budgets": thread_budgets,
        "torch_interop_threads": torch.get_num_interop_threads(),
        "mark_step_begin": a.mark_step_begin,
        "gpu_output_cast": a.gpu_output_cast,
        "gpu_output_cast_helper_sha256": (hashlib.sha256(Path(__file__).with_name("gpu_output_cast.py").read_bytes()).hexdigest()
                                          if a.gpu_output_cast else None),
        "cpu_affinity_count": len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else None,''')
    replace('    def save(record):\n        records.append(record)', '''    def save(record):
        record["torch_threads"] = torch.get_num_threads()
        record["torch_interop_threads"] = torch.get_num_interop_threads()
        record["mark_step_begin"] = a.mark_step_begin
        record["gpu_output_cast"] = a.gpu_output_cast
        if record.get("status") == "quality" and output_cast_probe is not None:
            record["output_cast_checks"] = output_cast_probe.comparisons[-4:]
        records.append(record)''')
    replace('    install(pipe)\n', '''    install(pipe)
    output_cast_probe = None
    if a.gpu_output_cast:
        from gpu_output_cast import GPUOutputCastProbe
        output_cast_probe = GPUOutputCastProbe(pipe.image_processor, np)
''')
    replace('        value = run(raw,w,h,n,alpha,seed,enabled,trace=trace)', '''        if output_cast_probe is None:
            value = run(raw,w,h,n,alpha,seed,enabled,trace=trace)
        else:
            before_comparisons = len(output_cast_probe.comparisons)
            output_cast_probe.context = {"terminal_noop": enabled, "trace": trace,
                                         "alpha": alpha, "seed": seed, "steps": n}
            output_cast_probe.compare_enabled = True
            try:
                value = run(raw,w,h,n,alpha,seed,enabled,trace=trace)
            finally:
                output_cast_probe.compare_enabled = False
            if len(output_cast_probe.comparisons) != before_comparisons + 1:
                raise RuntimeError("Expected exactly one CPU/GPU cast comparison per generated image")''')
    replace('        lat = worker.encode_image_to_latents(pipe, img, w, h)', '''        if a.mark_step_begin:
            torch.compiler.cudagraph_mark_step_begin()
        lat = worker.encode_image_to_latents(pipe, img, w, h)''')
    replace('                            start = time.perf_counter()', '''                            cpu_before = _bench_cpu_snapshot()
                            frame_ends_ms = []
                            cast_checks_before = len(output_cast_probe.comparisons) if output_cast_probe else 0
                            cast_calls_before = output_cast_probe.unchecked_calls if output_cast_probe else 0
                            start = time.perf_counter()''')
    replace('                                skips += skipped', '''                                skips += skipped
                                frame_ends_ms.append((time.perf_counter()-start)*1000)''')
    replace('                            seconds = time.perf_counter()-start', '''                            seconds = time.perf_counter()-start
                            cpu_after = _bench_cpu_snapshot()
                            cast_checks_during_timing = (len(output_cast_probe.comparisons) - cast_checks_before
                                                         if output_cast_probe else 0)
                            cast_calls_during_timing = (output_cast_probe.unchecked_calls - cast_calls_before
                                                       if output_cast_probe else 0)
                            if cast_checks_during_timing or (output_cast_probe and cast_calls_during_timing != a.frames):
                                raise RuntimeError("Timed output cast must execute only one selected path per frame")''')
    replace('                                "terminal_skips":skips})', '''                                "terminal_skips":skips,
                                "frame_ms":durations, "frame_ends_ms":frame_ends_ms,
                                "output_cast_checks_during_timing":cast_checks_during_timing,
                                "output_cast_selected_calls_during_timing":cast_calls_during_timing,
                                "cpu":_bench_cpu_delta(cpu_before,cpu_after,seconds)})''')
    replace('        manifest["finished_utc"] = datetime.now(timezone.utc).isoformat()', '''        if output_cast_probe is not None:
            manifest["output_cast_validation"] = {
                "same_tensor_comparisons": len(output_cast_probe.comparisons),
                "unchecked_calls_including_warmup": output_cast_probe.unchecked_calls,
                "all_exact": all(row["cpu_gpu_cast_exact"] and row["finite"]
                                 for row in output_cast_probe.comparisons),
            }
        manifest["finished_utc"] = datetime.now(timezone.utc).isoformat()''')

    # Repeat the entire existing warmup/quality/timing cell per thread budget.
    start = generated.index('                for n in steps:\n')
    end = generated.index('        manifest["status"] = "complete"', start)
    original = generated[start:end]
    indented = "".join("    " + line if line.strip() else line for line in original.splitlines(keepends=True))
    generated = (generated[:start] + '                for torch_thread_budget in thread_budgets:\n'
                 '                    torch.set_num_threads(torch_thread_budget)\n' + indented + generated[end:])
    return generated


if __name__ == "__main__":
    base = Path(__file__).with_name("bench_terminal_noop.py").read_text()
    generated = transformed_source(base)
    namespace = {
        "__name__": "__main__", "__file__": __file__,
        "_followup_base_sha": hashlib.sha256(base.encode()).hexdigest(),
        "_followup_generated_sha": hashlib.sha256(generated.encode()).hexdigest(),
        "_bench_cpu_snapshot": cpu_snapshot, "_bench_cpu_delta": cpu_delta,
    }
    exec(compile(generated, str(Path(__file__)) + ":generated", "exec"), namespace)
