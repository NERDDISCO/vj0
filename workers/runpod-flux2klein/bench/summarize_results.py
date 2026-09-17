#!/usr/bin/env python3
"""Build a compact index from saved measurements without mixing test settings.

Each compute cell retains its source artifact and repeat range. Stream summaries
exclude the explicitly cold first clip. Failed and partial artifacts stay visible.
This index is descriptive: it does not select winners or assert equal quality.
"""
import argparse
from collections import defaultdict
import json
import math
from pathlib import Path
import statistics


def spread(values):
    return {'count':len(values), 'median':statistics.median(values) if values else None,
        'min':min(values) if values else None, 'max':max(values) if values else None,
        'values':values}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = {'compute':[], 'stream':[], 'browser':[], 'app':[], 'excluded_partial_artifacts':[]}
    for path in sorted(args.root.glob('compute-*.json')):
        data = json.loads(path.read_text())
        rows = data.get('results', data.get('records', [])) if isinstance(data,dict) else []
        if not rows:
            continue
        if 'partial' in path.name or data.get('status') in ['running','partial']:
            result['excluded_partial_artifacts'].append(str(path.relative_to(args.root)))
            continue
        groups = defaultdict(list)
        for row in rows:
            if row.get('status') != 'measured':
                continue
            expected = row['frames']/row['wall_seconds']
            if not math.isclose(row['fps'],expected,rel_tol=1e-9):
                raise ValueError('FPS arithmetic mismatch: '+str(path))
            groups[(*row['size'],row['steps'],row['variant'])].append(row)
        for (width,height,steps,variant), measured in groups.items():
            result['compute'].append({'artifact':str(path.relative_to(args.root)),
                'artifact_status':data.get('status','record collection; see job manifest'),
                'width':width,'height':height,'steps':steps,'variant':variant,
                'fps':spread([r['fps'] for r in measured]),
                'frames_per_repeat':[r['frames'] for r in measured],
                'warmup_seconds_reported':sorted({r['warmup_seconds'] for r in measured}),
                'frame_ms_p95':spread([r['timing_ms']['total_ms']['p95'] for r in measured])})
    for folder in sorted(args.root.glob('stream*results')):
        for path in sorted(folder.glob('*.json')):
            data = json.loads(path.read_text())
            if 'runs' not in data:
                continue
            warm = [r for r in data['runs'] if not r['cold_first_pass']]
            for row in data['runs']:
                if not math.isclose(row['output_fps'],row['output_frames']/row['elapsed_seconds'],rel_tol=1e-9):
                    raise ValueError('Stream FPS arithmetic mismatch: '+str(path))
            result['stream'].append({'artifact':str(path.relative_to(args.root)),
                'status':data['status'],'error':data.get('error'),'config':data['config'],
                'resolved':data.get('resolved'),'load_seconds':data.get('load_seconds'),
                'warm_output_fps':spread([r['output_fps'] for r in warm]),
                'warm_output_frame_counts':[r['output_frames'] for r in warm],
                'warm_simulated_capture_age_p95_ms':spread([r['simulated_capture_to_decoded_ms']['p95']
                    for r in warm if r.get('simulated_capture_to_decoded_ms',{}).get('p95') is not None]),
                'cold_first_pass_seconds':[r['elapsed_seconds'] for r in data['runs'] if r['cold_first_pass']]})
    for folder in sorted(args.root.glob('browser-*')):
        if not folder.is_dir():
            continue
        for path in sorted(folder.glob('*.json')):
            data = json.loads(path.read_text())
            if not isinstance(data,dict) or 'receivedFps' not in data:
                continue
            result['browser'].append({'artifact':str(path.relative_to(args.root)),
                **{k:data.get(k) for k in ['status','config','receivedFps','decodedDrawnFps',
                    'elapsedSeconds','counts','invalidReasons','inboundMbps','outboundMbps']},
                'capture_to_draw_ms':data.get('distributions',{}).get('captureToDrawMs')})
    for path in sorted(args.root.glob('app-*/*/summary.json')):
        data = json.loads(path.read_text())
        result['app'].append({'artifact':str(path.relative_to(args.root)),**data})
    exclusions = args.root/'measurement-exclusions.json'
    if exclusions.exists():
        result['explicit_measurement_exclusions'] = json.loads(exclusions.read_text())
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({key:len(value) for key,value in result.items() if isinstance(value,list)}))


if __name__ == '__main__':
    main()
