#!/usr/bin/env python3
"""Offline encode-callback timing for already selected, archived input windows."""
import argparse
import hashlib
import json
from pathlib import Path
import statistics
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from metrics import distribution
from summarize import json_path, read_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reports', type=Path, nargs='+', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = {
        'source_reports': {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in args.reports},
        'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'meaning': 'Encode duration is canvas.toBlob invocation to its callback. It includes scheduling/readback/encoding/callback delay, not isolated JPEG CPU time. Only events in each common measured window enter distributions. No samples are winsorized or removed for being slow. Stage FPS is WebGL submission, not physical monitor presentation.',
        'comparisons': {},
    }
    for report_path in args.reports:
        report = read_json(report_path)
        for key, group in report['comparisons'].items():
            if key in result['comparisons']:
                raise ValueError('Duplicate comparison: ' + key)
            rows = []
            for trial in group['trials']:
                source = Path(trial['source_summary'])
                summary = read_json(source)
                raw_path = json_path(source.parent / 'main-raw.json')
                raw = read_json(raw_path)
                start, end = summary['window_start'], summary['window_end']
                done = [r for r in raw['rows'] if r['kind'] == 'encode-done' and start <= r['at'] <= end]
                starts = [r['at'] for r in raw['rows'] if r['kind'] == 'encode-start' and start <= r['at'] <= end]
                durations = [r['ms'] for r in done]
                config = summary['config']
                rows.append({
                    'name': trial['name'], 'role': trial['role'], 'pair': trial['pair'],
                    'status': trial['status'], 'source_raw': str(raw_path),
                    'raw_sha256': hashlib.sha256(raw_path.read_bytes()).hexdigest(),
                    'requested_fps': config['sendFps'], 'threshold_bytes': config['thresholdBytes'],
                    'send_fps': trial['send_fps'], 'stage_fps': trial['stage_fps'],
                    'encode_done_ms': distribution(durations),
                    'encode_start_interval_ms': distribution([b-a for a,b in zip(starts, starts[1:])]),
                    'fraction_encode_done_over_16_667ms': sum(ms > 1000/60 for ms in durations)/len(durations) if durations else None,
                    'admission_checks': trial['admission_checks'],
                })
            medians = {}
            for role in ('control', 'candidate'):
                members = [r for r in rows if r['role'] == role]
                medians[role] = {
                    'requested_fps': sorted({r['requested_fps'] for r in members}),
                    'send_fps': statistics.median(r['send_fps'] for r in members),
                    'stage_fps': statistics.median(r['stage_fps'] for r in members),
                    'encode_done_p50_ms': statistics.median(r['encode_done_ms']['p50'] for r in members),
                    'encode_done_p95_ms': statistics.median(r['encode_done_ms']['p95'] for r in members),
                    'fraction_encode_done_over_16_667ms': statistics.median(r['fraction_encode_done_over_16_667ms'] for r in members),
                }
            result['comparisons'][key] = {'trials': rows, 'median_trials': medians, 'decision': group['decision']}
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: value['median_trials'] for key, value in result['comparisons'].items()}, indent=2))


if __name__ == '__main__':
    main()
