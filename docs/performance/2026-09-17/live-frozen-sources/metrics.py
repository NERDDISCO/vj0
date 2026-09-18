"""Dependency-free benchmark statistics; never infer throughput from GPU timings."""
import math
import statistics


def percentile(values, percent):
    if not values:
        return None
    xs = sorted(values)
    position = (len(xs) - 1) * percent / 100
    lo, hi = math.floor(position), math.ceil(position)
    return xs[lo] + (xs[hi] - xs[lo]) * (position - lo)


def distribution(values):
    if any(not math.isfinite(v) or v < 0 for v in values):
        raise ValueError("Measurements must be finite and nonnegative")
    return {
        "count": len(values),
        "mean": statistics.fmean(values) if values else None,
        "p50": percentile(values, 50),
        "p95": percentile(values, 95),
        "p99": percentile(values, 99),
        "min": min(values) if values else None,
        "max": max(values) if values else None,
    }


def throughput(frames, seconds):
    if frames < 0 or not math.isfinite(seconds) or seconds <= 0:
        raise ValueError("Throughput requires a positive measured wall interval")
    return frames / seconds


def parse_sizes(text):
    result = []
    for token in text.split(","):
        w, h = map(int, token.lower().split("x"))
        if min(w, h) < 16 or max(w, h) > 4096 or w % 16 or h % 16:
            raise ValueError("Dimensions must be 16..4096 and divisible by 16")
        result.append((w, h))
    return result
