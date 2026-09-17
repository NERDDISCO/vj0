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


def browser_exclusions(paths, root, exclusions):
    """Resolve exclusions to one artifact; never guess across duplicate trial names."""
    matched = defaultdict(list)
    unmatched = []
    for exclusion in exclusions:
        artifact = exclusion.get('artifact')
        candidates = [p for p in paths if
            str(p.relative_to(root)) == artifact] if artifact else [
                p for p in paths if p.stem == exclusion.get('trial')]
        if len(candidates) > 1:
            raise ValueError('Ambiguous browser exclusion; specify artifact: '+str(exclusion))
        if candidates:
            matched[candidates[0]].append(exclusion)
        else:
            unmatched.append(exclusion)
    return matched, unmatched


def validate_browser_rates(data, path):
    """Check only rates whose numerator and observed duration are provided."""
    counts = data.get('counts') or {}
    elapsed = data.get('elapsedSeconds')
    checked = []
    for field, count, scale in [('receivedFps','received',1),
            ('decodedDrawnFps','decodedDrawn',1),
            ('inboundMbps','bytesReceived',8/1e6),
            ('outboundMbps','bytesSent',8/1e6)]:
        value, numerator = data.get(field), counts.get(count)
        if value is None or numerator is None or elapsed is None:
            continue
        numbers = (value, numerator, elapsed)
        if (any(isinstance(n, bool) or not isinstance(n, (int,float)) or not math.isfinite(n)
                for n in numbers) or numerator < 0 or elapsed <= 0):
            raise ValueError('Invalid browser rate inputs for '+field+': '+str(path))
        if not math.isclose(value, numerator*scale/elapsed, rel_tol=1e-9, abs_tol=1e-12):
            raise ValueError('Browser arithmetic mismatch for '+field+': '+str(path))
        checked.append(field)
    return checked


def app_lifecycle(path, root, summary):
    """Keep steady measurements separate from an optional later stress trial."""
    lifecycle = {'steady_status':summary.get('status')}
    reports = {}
    for name in ['stress', 'stress-failure']:
        source = path.parent/(name+'.json')
        if source.exists():
            reports[name] = json.loads(source.read_text())
            lifecycle[name.replace('-', '_')] = {
                'artifact':str(source.relative_to(root)), 'result':reports[name]}
    progress_path = path.parent.parent/'progress.json'
    progress = {}
    if progress_path.exists():
        name = summary.get('config',{}).get('name',path.parent.name)
        progress = next((r for r in json.loads(progress_path.read_text()) if r.get('name') == name), {})
        if progress:
            lifecycle['batch_progress'] = {
                'artifact':str(progress_path.relative_to(root)), 'record':progress}
    statuses = [reports.get('stress',{}).get('status'), progress.get('stress_status')]
    requested = bool(summary.get('config',{}).get('stress') or reports or any(statuses))
    if 'stress-failure' in reports or 'failed' in statuses:
        stress_status = 'failed'
    elif 'passed' in statuses:
        stress_status = 'passed'
    elif any(statuses):
        stress_status = next(status for status in statuses if status)
    elif not requested:
        stress_status = 'not-requested'
    elif summary.get('status') != 'measured' or progress.get('status') in ['failed','invalid']:
        stress_status = 'not-run'
    else:
        stress_status = 'pending'
    lifecycle.update(stress_requested=requested, stress_status=stress_status)
    if stress_status == 'failed':
        lifecycle['status'] = 'failed'
    elif requested and stress_status != 'passed' and summary.get('status') == 'measured':
        lifecycle['status'] = 'incomplete'
    return lifecycle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = {'compute':[], 'stream':[], 'browser':[], 'app':[], 'excluded_partial_artifacts':[]}
    exclusions_path = args.root/'measurement-exclusions.json'
    exclusions = {}
    if exclusions_path.exists():
        exclusions = json.loads(exclusions_path.read_text())
        result['explicit_measurement_exclusions'] = exclusions
    for path in sorted(args.root.glob('compute-*.json')):
        data = json.loads(path.read_text())
        rows = data.get('results', data.get('records', [])) if isinstance(data,dict) else []
        if not rows:
            continue
        if 'partial' in path.name or data.get('status') in ['running','partial']:
            result['excluded_partial_artifacts'].append(str(path.relative_to(args.root)))
            continue
        environment = data.get('environment') or {}
        config = data.get('config', environment.get('arguments',{}))
        groups = defaultdict(list)
        for row in rows:
            if row.get('status') != 'measured':
                continue
            expected = row['frames']/row['wall_seconds']
            if not math.isclose(row['fps'],expected,rel_tol=1e-9):
                raise ValueError('FPS arithmetic mismatch: '+str(path))
            backend = row.get('attention_backend', (config or {}).get('attention_backend'))
            groups[(*row['size'],row['steps'],row['variant'],backend)].append(row)
        for (width,height,steps,variant,backend), measured in groups.items():
            result['compute'].append({'artifact':str(path.relative_to(args.root)),
                'artifact_status':data.get('status','record collection; see job manifest'),
                'width':width,'height':height,'steps':steps,'variant':variant,
                'attention_backend':backend, 'environment':environment, 'config':config,
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
    browser_paths = sorted(path for folder in args.root.glob('browser-*') if folder.is_dir()
        for path in folder.glob('*.json'))
    excluded, unmatched = browser_exclusions(browser_paths, args.root, exclusions.get('exclusions',[]))
    if unmatched:
        result['unmatched_measurement_exclusions'] = unmatched
    for path in browser_paths:
        data = json.loads(path.read_text())
        if not isinstance(data,dict) or 'receivedFps' not in data:
            continue
        entry = {'artifact':str(path.relative_to(args.root)),
            **{k:data.get(k) for k in ['status','config','receivedFps','decodedDrawnFps',
                'elapsedSeconds','counts','invalidReasons','inboundMbps','outboundMbps']},
            'capture_to_draw_ms':data.get('distributions',{}).get('captureToDrawMs'),
            'arithmetic_checked_fields':validate_browser_rates(data,path)}
        if path in excluded:
            entry.update(status='excluded', raw_status=data.get('status'), exclusions=excluded[path])
        result['browser'].append(entry)
    for path in sorted(args.root.glob('app-*/*/summary.json')):
        data = json.loads(path.read_text())
        result['app'].append({'artifact':str(path.relative_to(args.root)),**data,
            **app_lifecycle(path,args.root,data)})
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({key:len(value) for key,value in result.items() if isinstance(value,list)}))


if __name__ == '__main__':
    main()
