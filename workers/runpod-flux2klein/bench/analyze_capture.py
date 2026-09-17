#!/usr/bin/env python3
"""Revisit capture/queue costs in the preserved, corrected real-app trials.

This does not infer why an uninstrumented capture attempt was skipped. Browser
and worker durations use separate clocks; no cross-clock subtraction is done.
"""
import argparse
import gzip
import json
from pathlib import Path

from metrics import distribution


def read(path):
    if path.exists():
        return json.loads(path.read_text())
    return json.loads(gzip.decompress(path.with_suffix(path.suffix + '.gz').read_bytes()))


def analyze(folder):
    summary = read(folder / 'summary.json')
    raw = read(folder / 'main-raw.json')
    start, end = summary['window_start'], summary['window_end']
    rows = [r for r in raw['rows'] if start <= r['at'] <= end]
    groups = {kind: [r for r in rows if r['kind'] == kind] for kind in
              ['encode-start', 'encode-done', 'sent', 'received', 'worker-stats']}
    result = {'seconds': (end-start)/1000, 'browser': {}, 'worker_delivered_frames': {}}
    for kind, selected in groups.items():
        if kind == 'worker-stats':
            continue
        result['browser'][kind] = {
            'count': len(selected), 'fps': len(selected)/result['seconds'],
            'interval_ms': distribution([b['at']-a['at'] for a,b in zip(selected, selected[1:])]),
        }
    result['browser']['encode_duration_ms'] = distribution([r['ms'] for r in groups['encode-done']])
    result['browser']['send_buffer_bytes_after_send'] = distribution([r['buffered'] for r in groups['sent']])
    stages = ['queue_wait_ms', 'decode_in_ms', 'prompt_ms', 'vae_encode_ms',
              'transformer_plus_decode_ms', 'jpeg_ms', 'total_ms']
    for stage in stages:
        result['worker_delivered_frames'][stage] = distribution([
            r['timing'][stage] for r in groups['worker-stats'] if stage in r['timing']])
    # Pair lifecycle events from the full raw window before filtering to avoid
    # accidentally matching an encode that straddles the common-window start.
    pending, completed = [], []
    for row in raw['rows']:
        if row['kind'] == 'encode-start':
            pending.append(row)
        elif row['kind'] == 'encode-done' and pending:
            began = pending.pop(0)
            if start <= began['at'] <= row['at'] <= end:
                completed.append((began['at'], row['at']))
    result['browser']['observed_encode_pending_fraction'] = sum(b-a for a,b in completed)/(end-start)
    result['limits'] = [
        'No rAF-attempt, deadline-skip, pending-skip or pre-send buffer samples in these old logs.',
        'Encode pending fraction excludes Blob.arrayBuffer and callback completion.',
        'Worker queue/stage timing describes delivered frames; discarded results are not represented.',
        'Independent duration percentiles cannot be added to reconstruct latency percentiles.',
        'This is analysis of existing trials, not a new FPS or causal optimization benchmark.',
    ]
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    results = {p.name: analyze(p) for p in sorted(args.root.glob('source-order-*')) if p.is_dir()}
    if not results:
        raise SystemExit('No corrected app trials found')
    args.output.write_text(json.dumps(results, indent=2) + '\n')
