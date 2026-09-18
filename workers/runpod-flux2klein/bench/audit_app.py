#!/usr/bin/env python3
"""Audit saved app_batch artifacts, without browser, network or GPU access.

One invocation is one cohort; do not combine interrupted runs or separate soaks.
Accepts plain JSON and losslessly archived JSON.gz. --watch waits for identity,
parses completed trials only, and exits when cleanup.json appears. JSON output
and a readable sibling .md are written outside the input directory.
"""
import argparse
import collections
import datetime
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import statistics
import time


def locate(path):
    path = Path(path)
    return path if path.is_file() else Path(str(path) + '.gz') if Path(str(path) + '.gz').is_file() else None


def payload(path):
    found = locate(path)
    if found is None:
        raise FileNotFoundError(path)
    data = found.read_bytes()
    return gzip.decompress(data) if found.suffix == '.gz' else data


def read(path, optional=False):
    if optional and locate(path) is None:
        return None
    return json.loads(payload(path))


def binding(path):
    found = locate(path)
    if found is None:
        return None
    return {'file': found.name, 'stored_sha256': hashlib.sha256(found.read_bytes()).hexdigest(),
            'uncompressed_sha256': hashlib.sha256(payload(found)).hexdigest()}


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def distribution(values):
    x = sorted(values)
    if any(not finite(v) for v in x):
        raise ValueError('Nonfinite measurement')
    def quantile(q):
        if not x:
            return None
        pos = (len(x) - 1) * q / 100
        low, high = math.floor(pos), math.ceil(pos)
        return x[low] + (x[high] - x[low]) * (pos - low)
    return {'count': len(x), 'mean': statistics.fmean(x) if x else None,
            'p50': quantile(50), 'p95': quantile(95), 'p99': quantile(99),
            'min': x[0] if x else None, 'max': x[-1] if x else None}


def equivalent(a, b):
    if isinstance(a, dict):
        return isinstance(b, dict) and a.keys() == b.keys() and all(equivalent(a[k], b[k]) for k in a)
    if isinstance(a, (list, tuple)):
        return isinstance(b, (list, tuple)) and len(a) == len(b) and all(equivalent(x, y) for x, y in zip(a, b))
    if finite(a):
        return finite(b) and math.isclose(a, b, rel_tol=1e-10, abs_tol=1e-6)
    return a == b


def require(condition, errors, message):
    if not condition and message not in errors:
        errors.append(message)


def selected(rows, kind):
    return [r for r in rows if r['kind'] == kind]


def max_gap(times, start, end):
    times = [start] + times + [end]
    return max((b - a for a, b in zip(times, times[1:])), default=None)


def metrics(rows, start, end):
    ids = [r['id'] for r in rows if r.get('id') is not None]
    ages = [r['ageMs'] for r in rows if r.get('ageMs') is not None]
    seconds = (end - start) / 1000
    base = {'events': len(rows), 'unique_frames': len(set(ids)),
            'fps': len(set(ids)) / seconds if ids else None,
            'dimensions': [list(v) for v in sorted({(r['width'], r['height']) for r in rows if r.get('width') and r.get('height')})],
            'age_ms': distribution(ages),
            'duration_ms': distribution([r['ms'] for r in rows if r.get('ms') is not None])}
    return base


def order(rows):
    ids = [r['id'] for r in rows if isinstance(r.get('id'), int) and not isinstance(r.get('id'), bool) and r['id'] > 0]
    captures = [r['at'] - r['ageMs'] for r in rows if finite(r.get('ageMs'))]
    return {'frames': len(rows), 'missing_ids': len(rows) - len(ids),
            'reversals': sum(b < a for a, b in zip(ids, ids[1:])), 'duplicate_ids': len(ids) - len(set(ids)),
            'capture_timestamps': len(captures),
            'capture_reversals': sum(b < a - .001 for a, b in zip(captures, captures[1:])),
            'capture_duplicates': sum(abs(b - a) <= .001 for a, b in zip(captures, captures[1:])),
            'negative_ages': sum(r.get('ageMs', 0) < 0 for r in rows)}


def bad_order(value):
    return any(value[k] for k in ('missing_ids', 'reversals', 'duplicate_ids', 'capture_reversals', 'capture_duplicates', 'negative_ages'))


def boundary(rows, start, end):
    value = metrics(rows, start, end)
    ages = [r['ageMs'] for r in rows if finite(r.get('ageMs'))]
    value.update(max_event_gap_ms=max_gap([r['at'] for r in rows], start, end),
                 final_silence_ms=end - rows[-1]['at'] if rows else None,
                 age_over_ms={str(t): {'frames': sum(v > t for v in ages),
                                     'percent': 100 * sum(v > t for v in ages) / len(ages) if ages else None}
                              for t in (250, 500, 1000)})
    return value


def episodes(raw, start, end, threshold):
    """Pair consecutive binary/stat messages before clipping the common window.

    A leading stat and trailing image can straddle begin/end. An intervening
    second receipt breaks correspondence, so suppress timings on any ambiguity.
    This is an ordered-channel inference, not a server-side timestamp trace.
    """
    rows = raw['main']['rows']
    pairs, pending, errors = {}, None, []
    for r in rows:
        if r['kind'] == 'received':
            if pending is not None:
                errors.append('A receipt was not followed by worker stats before the next receipt')
            pending = r
        elif r['kind'] == 'worker-stats' and pending is not None:
            pairs[pending['id']] = r
            pending = None
    if errors:
        pairs = {}
    sends = {r['id']: r for r in selected(rows, 'sent')}
    renders = {r['id']: r for r in selected(raw['stage']['rows'], 'webgl-frame-submitted')}
    previews = {r['id']: r for r in selected(rows, 'preview-image-raf')}
    received = [r for r in selected(rows, 'received') if start <= r['at'] <= end]
    groups, group = [], []
    for r in received:
        if finite(r.get('ageMs')) and r['ageMs'] > threshold:
            group.append(r)
        elif group:
            groups.append(group)
            group = []
    if group:
        groups.append(group)
    def detail(r):
        i = r['id']; sent = sends.get(i); stat = pairs.get(i)
        return {'id': i, 'capture_relative_s': (r['at'] - r['ageMs'] - start) / 1000,
                'send_relative_s': (sent['at'] - start) / 1000 if sent else None,
                'receive_relative_s': (r['at'] - start) / 1000, 'age_ms': r['ageMs'],
                'buffered_bytes_at_send': sent.get('buffered') if sent else None,
                'encode_to_send_ms': sent['at'] - (r['at'] - r['ageMs']) if sent else None,
                'worker_timing': stat.get('timing') if stat else None,
                'worker_stat_after_receive_ms': stat['at'] - r['at'] if stat else None,
                'receive_to_stage_ms': renders[i]['at'] - r['at'] if i in renders else None,
                'receive_to_preview_raf_ms': previews[i]['at'] - r['at'] if i in previews else None}
    output = []
    for group in groups:
        details = [detail(r) for r in group]
        context_start = max(start, min(r['at'] - r['ageMs'] for r in group) - 1000)
        context_end = min(end, group[-1]['at'] + 1000)
        audio = [r for r in raw['main'].get('rms', []) if context_start <= r['at'] <= context_end]
        per_second = []
        for second in range(math.floor((context_start - start) / 1000), math.ceil((context_end - start) / 1000)):
            lo, hi = start + second * 1000, start + (second + 1) * 1000
            rr = [r for r in received if lo <= r['at'] < hi]
            ss = [r for r in sends.values() if max(lo, start) <= r['at'] < min(hi, end)]
            per_second.append({'relative_second': second, 'sent': len(ss), 'received': len(rr),
                               'max_receive_age_ms': max((r['ageMs'] for r in rr), default=None),
                               'max_buffered_bytes_at_send': max((r.get('buffered', 0) for r in ss), default=None)})
        output.append({'frames': len(group), 'first': details[0], 'peak': detail(max(group, key=lambda r: r['ageMs'])),
                       'last': details[-1], 'age_ms': distribution([r['ageMs'] for r in group]),
                       'worker_total_ms': distribution([d['worker_timing']['total_ms'] for d in details if d['worker_timing'] and finite(d['worker_timing'].get('total_ms'))]),
                       'worker_queue_ms': distribution([d['worker_timing']['queue_wait_ms'] for d in details if d['worker_timing'] and finite(d['worker_timing'].get('queue_wait_ms'))]),
                       'receive_to_stage_ms': distribution([d['receive_to_stage_ms'] for d in details if d['receive_to_stage_ms'] is not None]),
                       'audio_context_samples': len(audio),
                       'audio_context_max_gap_ms': max_gap([r['at'] for r in audio], context_start, context_end),
                       'context_window_relative_s': [(context_start - start) / 1000, (context_end - start) / 1000],
                       'per_second': per_second})
    return {'threshold_ms': threshold, 'frames_above_threshold': sum(len(g) for g in groups),
            'groups': output, 'worker_pairing_errors': sorted(set(errors)),
            'interpretation_limit': 'Timings paired by binary-then-stats order. Ages include uninstrumented transport and host/IPC intervals. No server arrival/send timestamps identify exact packet loss or upstream/downstream cause. Endpoint RTC snapshots do not measure episode RTT.'}


def audit_trial(folder, job, threshold):
    summary = read(folder / 'summary.json')
    raw = {t: read(folder / (t + '-raw.json')) for t in ('main', 'stage')}
    start, end = max(v['started'] for v in raw.values()), min(v['at'] for v in raw.values())
    seconds = (end - start) / 1000
    if not finite(seconds) or seconds <= 0:
        raise ValueError('Nonpositive or nonfinite common measurement window')
    arithmetic, gates = [], []
    require(equivalent([start, end, seconds], [summary['window_start'], summary['window_end'], summary['seconds']]), arithmetic, 'Common-window arithmetic differs')
    require(summary['config'] == job, gates, 'Manifest and summary config differ')
    require(seconds >= job['seconds'], gates, 'Observed interval shorter than requested')
    out = {'name': job['name'], 'config': job, 'raw_status': summary['status'], 'raw_problems': summary.get('problems', []),
           'window_start': start, 'window_end': end, 'elapsed_seconds': seconds, 'boundaries': {}, 'ordering': {},
           'arithmetic_errors': arithmetic, 'independent_gate_failures': gates, 'renderer': summary.get('renderer'),
           'bindings': {n: binding(folder / n) for n in ('summary.json', 'main-raw.json', 'stage-raw.json')}}
    clipped = {}
    for target, data in raw.items():
        rows = clipped[target] = [r for r in data['rows'] if start <= r['at'] <= end]
        kinds = {r['kind'] for r in rows}
        require(kinds == set(summary['targets'][target]), arithmetic, target + ': event kinds differ')
        require(not data.get('errors'), gates, target + ': probe errors')
        require(data.get('measuring') is False, gates, target + ': snapshot not frozen')
        out['ordering'][target] = {}
        require(all(a['at'] <= b['at'] for a, b in zip(data['rows'], data['rows'][1:])), gates, target + ': event timestamps reversed')
        for kind in sorted(kinds):
            rr = selected(rows, kind)
            require(equivalent(metrics(rr, start, end), summary['targets'][target].get(kind)), arithmetic, target + '/' + kind + ': metric arithmetic')
            if kind in ('sent', 'received', 'preview-image-raf', 'webgl-frame-submitted'):
                key = target + '/' + kind
                out['boundaries'][key] = boundary(rr, start, end)
                value = out['ordering'][target][kind] = order(rr)
                require(not bad_order(value), gates, key + ': ID/capture ordering')
                if kind != 'sent' and kind in summary.get('source_order', {}).get(target, {}):
                    published_order = {k: value[k] for k in ('frames', 'missing_ids', 'reversals', 'duplicate_ids')}
                    published_order['status'] = 'passed' if not any(published_order[k] for k in ('missing_ids', 'reversals', 'duplicate_ids')) else 'failed'
                    require(equivalent(published_order, summary['source_order'][target][kind]), arithmetic, key + ': published source-order arithmetic')
            if kind in ('preview-image-loaded', 'bitmap-decoded'):
                require(all((r.get('width'), r.get('height')) == (job.get('width', 512), job.get('height', 288)) for r in rr if r.get('id')), gates, target + ': decoded dimensions differ')
        for event in data.get('events', []):
            bad = event.get('type') == 'error' or event.get('status') in ('error', 'compile_failed') or (event.get('type') == 'compile' and event.get('status') != 'warmed') or (event.get('type') == 'connection' and event.get('state') in ('failed', 'disconnected', 'closed'))
            require(not bad, gates, target + ': error/compile/disconnection in frozen measurement')
        required = ['webgl-frame-submitted'] if target == 'stage' else ['received', 'preview-image-raf' if job['layout'] == 'vj-next' else 'webgl-frame-submitted']
        for kind in required:
            rr = selected(rows, kind)
            require(bool(rr) and end - rr[-1]['at'] <= 2000, gates, target + '/' + kind + ': absent or stale final output')
    out['final_channel_states'] = raw['main'].get('channelStates')
    require('open' in (out['final_channel_states'] or []), gates, 'No final open main channel')
    stats = selected(clipped['main'], 'worker-stats')
    variant = job.get('variant', 'baseline')
    require(bool(stats), gates, 'Missing worker stats')
    for r in stats:
        t = r['timing']
        require([r.get('width'), r.get('height')] == [job.get('width', 512), job.get('height', 288)], gates, 'Worker output dimensions differ')
        require(t.get('benchmark_variant') == variant and t.get('stage_clock') == ('wall-clock' if variant == 'baseline' else 'cuda-events'), gates, 'Worker variant/clock mismatch')
        for field, key in (('workerThreads', 'torch_threads'), ('outputCast', 'output_cast')):
            require(field not in job or t.get(key) == job[field], gates, 'Worker ' + key + ' mismatch')
        require(variant != 'terminal-noop' or t.get('terminal_skips') == 1, gates, 'Missing terminal prediction skip')
    out['worker_ids'] = sorted({r['worker'] for r in stats if r.get('worker') is not None})
    workers = list(range(job['activeWorkers'])) if 'activeWorkers' in job else out['worker_ids']
    require(out['worker_ids'] == workers, gates, 'Worker identity mismatch')
    out['worker_activity'] = {}
    for worker in workers:
        times = [r['at'] for r in stats if r.get('worker') == worker]
        value = out['worker_activity'][str(worker)] = {'frames': len(times), 'max_gap_ms': max_gap(times, start, end)}
        require(value['max_gap_ms'] <= 2000, gates, 'Worker ' + str(worker) + ': arrival gap over 2 seconds')
    if 'worker_activity' in summary:
        require(equivalent(out['worker_activity'], summary['worker_activity']), arithmetic, 'Worker activity arithmetic')
    out['worker_timings'] = {k: distribution([r['timing'][k] for r in stats if finite(r['timing'].get(k))]) for k in ('total_ms', 'queue_wait_ms')}
    audio = [r for r in raw['main'].get('rms', []) if start <= r['at'] <= end]
    out['audio_rms'] = {str(level): distribution([r['rms'] for r in audio if r['level'] == level]) for level in sorted({r['level'] for r in audio})}
    require(equivalent(out['audio_rms'], summary.get('audio_rms_by_fixture_level')), arithmetic, 'Audio RMS arithmetic')
    for level in ([0, .2, .6] if job.get('audioCycle') else [.2]):
        values = [r['rms'] for r in audio if r['level'] == level]
        require(bool(values) and (not level or max(values) >= .01), gates, 'Missing audio fixture level ' + str(level))
    if 'mailbox' in job:
        ack = out['mailbox_ack'] = read(folder / 'mailbox-config.json')
        require(ack.get('enabled') == job['mailbox'] and ack.get('effectiveMaxPending') == (1 if job['mailbox'] else job.get('maxPending', 3)) and ack.get('waitingCapacity') == (1 if job['mailbox'] else 0), gates, 'Mailbox admission ACK mismatch')
    rtc = read(folder / 'rtc-stats.json', optional=True)
    out['rtc_after_measurement'] = rtc
    require(bool(rtc) and any(p.get('type') == 'candidate-pair' and p.get('state') == 'succeeded' for peer in rtc for p in peer), gates, 'No succeeded post-window RTC candidate pair')
    before, after = (read(folder / n, optional=True) for n in ('debug-before.json', 'debug-after.json'))
    if before and after:
        out['server_bracketed_deltas'] = {k: after['stats'][k] - v for k, v in before.get('stats', {}).items() if finite(v) and finite(after.get('stats', {}).get(k))}
        out['server_counter_scope'] = 'Snapshots bracket the client common interval; counters are not counts over its exact boundaries.'
        out['final_server_workers'] = after.get('workers')
    for name in ('mailbox-config.json', 'rtc-stats.json', 'debug-before.json', 'debug-after.json', 'drain-before-switch.json', 'renderer.json'):
        if locate(folder / name):
            out['bindings'][name] = binding(folder / name)
    out['episodes'] = episodes(raw, start, end, threshold)
    out['audit_status'] = 'passed' if not arithmetic and not gates and summary['status'] == 'measured' and not summary.get('problems') else 'failed'
    return out


def audit_stress(folder, job):
    result = read(folder / 'stress.json', optional=True)
    failure = read(folder / 'stress-failure.json', optional=True)
    if result is None:
        return {'status': 'failed' if failure else 'pending', 'failure': failure} if job.get('stress') or failure else None
    raw = {t: read(folder / (t + '-stress-raw.json')) for t in ('main', 'stage')}
    errors, boundaries, orders = [], {}, {}
    actions = result.get('actions', [])
    counts = dict(collections.Counter(a['action'] for a in actions))
    require(counts == {'prompt': 3, 'resolution': 3, 'ten-rapid-prompts': 1, 'reconnect': 3}, errors, 'Stress action counts differ')
    intervals = [(a['disconnect_clicked_at'], a['new_capture_received_at']) for a in actions if a['action'] == 'reconnect']
    for target, data in raw.items():
        require(not data.get('errors'), errors, target + ': stress probe errors')
        for kind in (['received', 'preview-image-raf'] if target == 'main' else ['webgl-frame-submitted']):
            rr = selected(data['rows'], kind)
            key = target + '/' + kind
            boundaries[key] = boundary(rr, data['started'], data['at'])
            orders[key] = order(rr)
            require(not bad_order(orders[key]), errors, key + ': stress ID/capture ordering')
            require(bool(rr) and data['at'] - rr[-1]['at'] <= 2000, errors, key + ': stale final stress output')
        for e in data.get('events', []):
            bad = e.get('type') == 'error' or e.get('status') in ('error', 'compile_failed') or (e.get('type') == 'connection' and e.get('state') == 'failed')
            if e.get('type') == 'connection' and e.get('state') in ('closed', 'disconnected'):
                bad |= not any(lo <= e['at'] <= hi for lo, hi in intervals)
            require(not bad, errors, target + ': unexpected stress error/disconnection')
    require('open' in raw['main'].get('channelStates', []), errors, 'No open channel at stress end')
    receives = {r['id']: r for r in selected(raw['main']['rows'], 'received')}
    gl = selected(raw['stage']['rows'], 'webgl-frame-submitted')
    settings = [e for e in raw['main'].get('events', []) if e.get('type') == 'settings-sent']
    for a in actions:
        kind = a['action']; i = a.get('frame_id', a.get('subsequent_frame_id')); r = receives.get(i)
        require(r is not None, errors, kind + ': missing recorded receipt')
        if r is None:
            continue
        require(any(g['id'] >= i and g['at'] >= r['at'] for g in gl), errors, kind + ': no subsequent stage submission')
        capture = r['at'] - r['ageMs']
        if kind == 'prompt':
            require(any(e['at'] == a['settings_sent_at'] and e.get('data', {}).get('prompt') == a['prompt'] for e in settings), errors, 'Prompt settings event missing')
            require(capture >= a['settings_sent_at'] and equivalent(r['at'], a['first_subsequent_capture_received_at']) and equivalent(r['at'] - a['settings_sent_at'], a['settings_to_new_capture_receive_ms']), errors, 'Prompt response timestamp/arithmetic mismatch')
        elif kind == 'resolution':
            require(any(r['at'] == a['matching_worker_output_at'] and [r.get('width'), r.get('height')] == [a['width'], a['height']] for r in selected(raw['main']['rows'], 'worker-stats')), errors, 'Resolution worker event missing')
            require(capture >= a['matching_worker_output_at'] and equivalent(a['matching_worker_output_at'] - a['started_at'], a['change_to_matching_worker_output_ms']), errors, 'Resolution response timestamp/arithmetic mismatch')
            for target, event_kind in (('main', 'preview-image-loaded'), ('stage', 'bitmap-decoded')):
                require(any(v.get('id') == a[target + '_decoded_frame_id'] and v['id'] >= i and [v.get('width'), v.get('height')] == [a['width'], a['height']] for v in selected(raw[target]['rows'], event_kind)), errors, target + ': resolution decode missing')
            require(any(g['id'] == a['stage_decoded_frame_id'] for g in gl), errors, 'Resolution stage submission missing')
        elif kind == 'reconnect':
            require(capture >= a['connect_clicked_at'] and equivalent(r['at'], a['new_capture_received_at']) and equivalent(r['at'] - a['connect_clicked_at'], a['reconnect_to_new_capture_receive_ms']), errors, 'Reconnect response timestamp/arithmetic mismatch')
        elif kind == 'ten-rapid-prompts':
            require(any(e.get('data', {}).get('prompt') == 'rapid benchmark cue 9, luminous organic ribbons' and e['at'] <= capture for e in settings), errors, 'Final rapid prompt/fresh capture missing')
    shapes = [(512, 288), (768, 448), (1024, 576)]
    initial = (job.get('width', 512), job.get('height', 288))
    if initial in shapes:
        ix = shapes.index(initial)
        require([(a['width'], a['height']) for a in actions if a['action'] == 'resolution'] == shapes[ix + 1:] + shapes[:ix + 1], errors, 'Shape cycle did not change and return to initial shape')
    return {'status': 'passed' if result.get('status') == 'passed' and not result.get('errors') and not errors and not failure else 'failed',
            'raw_result': result, 'failure': failure, 'independent_errors': errors, 'boundaries': boundaries, 'ordering': orders,
            'bindings': {n: binding(folder / n) for n in ('stress.json', 'main-stress-raw.json', 'stage-stress-raw.json')},
            'scope': 'Lifecycle observations use each target own window, separate from steady FPS. Settings-to-new-capture receipt proves a subsequent capture, not that the worker used the new prompt revision or visually followed it.'}


def provenance(path, first_start, jobs):
    if path is None:
        return {'status': 'not_supplied', 'errors': [], 'limitation': 'No saved runtime/build attestation supplied; origin alone does not identify executed source.'}
    paths = sorted(set(path.glob('*.json')) | set(path.glob('*.json.gz'))) if path.is_dir() else [path]
    errors, records = [], {}
    for p in paths:
        value = read(p)
        records[p.name] = {'binding': binding(p), 'record': value}
        if not isinstance(value, dict):
            continue
        epoch = value.get('captured_epoch')
        if epoch is None and value.get('captured_utc'):
            epoch = datetime.datetime.fromisoformat(value['captured_utc'].replace('Z', '+00:00')).timestamp()
        if epoch is not None and first_start is not None:
            require(epoch * 1000 <= first_start, errors, p.name + ': attestation is later than first timed window')
        for app in value.get('apps', []):
            require(app.get('build_id_in_served_html') is True, errors, app.get('name', 'app') + ': served build flag is false')
            html = p.parent / (app['name'] + '-served.html')
            if locate(html):
                content = payload(html)
                require(bool(app.get('build_id')) and hashlib.sha256(content).hexdigest() == app.get('served_html_sha256') and app.get('build_id', '').encode() in content, errors, app['name'] + ': saved served HTML hash/build ID mismatch')
            else:
                errors.append(app['name'] + ': saved served HTML unavailable')
        if 'sources' in value and 'prelaunch' in value:
            require(value['sources'] == value['prelaunch'].get('sources'), errors, p.name + ': prelaunch/current source inventories differ')
        worker_count = value.get('runtime', {}).get('worker_count')
        if worker_count is not None:
            require(all(j.get('activeWorkers', 1) <= worker_count for j in jobs), errors, 'Requested workers exceed the saved runtime pool')
    apps = [a for r in records.values() if isinstance(r['record'], dict) for a in r['record'].get('apps', [])]
    if apps:
        require({j['origin'] for j in jobs} <= {a['origin'] for a in apps}, errors, 'A job origin has no served-build attestation')
    require(bool(records), errors, 'No provenance JSON records found')
    return {'status': 'saved_provenance_checked' if not errors else 'failed', 'errors': errors, 'records': records,
            'limitation': 'Checks saved local attestation and HTML consistency only; no live remote or browser query is performed. Collection timestamps and source inventory are retained verbatim.'}


def comparison_report(jobs, trials, progress):
    groups = collections.defaultdict(list)
    for j in jobs:
        match = re.fullmatch(r'(.+)-(\d+)-r(\d+)', j['name'])
        if match:
            groups[(int(match[2]), int(match[3]))].append((match[1], j['name']))
    sequences, comparisons = [], []
    for (width, repeat), entries in sorted(groups.items()):
        names = dict(entries)
        sequences.append({'width': width, 'repeat': repeat, 'order': [v for v, n in entries],
                          'completed': [n for v, n in entries if n in trials],
                          'valid': all(n in trials and trials[n].get('audit_status') == 'passed' for v, n in entries)})
        for left, right in (('before', 'compute-capture'), ('compute-capture', 'latest-input')):
            if left not in names or right not in names or names[left] not in trials or names[right] not in trials:
                continue
            a, b = trials[names[left]], trials[names[right]]
            if 'boundaries' not in a or 'boundaries' not in b:
                continue
            invariant = ('server', 'layout', 'sendFps', 'activeWorkers', 'workerThreads', 'width', 'height', 'seconds')
            mismatches = [k for k in invariant if a['config'].get(k) != b['config'].get(k)]
            x, y = a['boundaries'].get('stage/webgl-frame-submitted', {}), b['boundaries'].get('stage/webgl-frame-submitted', {})
            comparisons.append({'width': width, 'repeat': repeat, 'left': names[left], 'right': names[right],
                                'eligible': not mismatches and a['audit_status'] == b['audit_status'] == 'passed',
                                'invariant_mismatches': mismatches,
                                'configuration_changes': {k: [a['config'].get(k), b['config'].get(k)] for k in set(a['config']) | set(b['config']) if k != 'name' and a['config'].get(k) != b['config'].get(k)},
                                'stage_fps_change_pct': 100 * (y['fps'] / x['fps'] - 1) if x.get('fps') and y.get('fps') else None,
                                'stage_p99_ms': [x.get('age_ms', {}).get('p99'), y.get('age_ms', {}).get('p99')]})
    widths = sorted({v['width'] for v in sequences})
    reverse = bool(widths) and all(len(ss := [s for s in sequences if s['width'] == w]) == 2 and len(ss[0]['order']) == 3 and set(ss[0]['order']) == {'before', 'compute-capture', 'latest-input'} and ss[0]['order'] == list(reversed(ss[1]['order'])) for w in widths)
    completed = len(trials) == len(jobs) and all(t.get('audit_status') == 'passed' for t in trials.values())
    return {'sequences': sequences, 'planned_reverse_order': reverse, 'completed_counterbalanced_cohort': reverse and completed and [p['name'] for p in progress] == [j['name'] for j in jobs],
            'matched_pairs': comparisons,
            'scope': 'Sequential within-cohort comparisons, not simultaneous causal controls. Before versus compute-capture changes capture and compute together. Each report keeps its own manifest/cohort; separate soak runs are not additional repeats.'}


def report(root, identity, trials, provenance_path):
    jobs = identity['jobs']; errors = []
    progress = read(root / 'progress.json', optional=True) or []
    cleanup = read(root / 'cleanup.json', optional=True)
    require(len({j['name'] for j in jobs}) == len(jobs), errors, 'Duplicate manifest names')
    for j in jobs:
        named_width = re.fullmatch(r'(before|compute-capture|latest-input)-(\d+)-r(\d+)', j['name'])
        require(not named_width or int(named_width[2]) == j.get('width'), errors, j['name'] + ': named width differs from config')
    require([p['name'] for p in progress] == [j['name'] for j in jobs[:len(progress)]], errors, 'Progress is not the planned order/prefix')
    for p in progress:
        job = next((j for j in jobs if j['name'] == p['name']), None)
        require(job is not None and p.get('config') == job, errors, p['name'] + ': progress config mismatch')
        if p['name'] in trials and p.get('status') not in ('running', 'pending'):
            require(p['status'] == trials[p['name']].get('raw_status'), errors, p['name'] + ': progress/summary status mismatch')
    timed = [trials[j['name']] for j in jobs if j['name'] in trials and 'window_start' in trials[j['name']]]
    require(all(a['window_end'] <= b['window_start'] for a, b in zip(timed, timed[1:])), errors, 'Timed windows overlap or execute outside manifest order')
    prov = provenance(provenance_path, min((r['window_start'] for r in timed), default=None), jobs)
    all_complete = len(trials) == len(jobs)
    all_passed = all_complete and all(t.get('audit_status') == 'passed' and (not t.get('stress') or t['stress']['status'] == 'passed') for t in trials.values())
    cleanup_ok = cleanup is not None and cleanup.get('status') == 'pages-closed' and not cleanup.get('errors')
    comparisons = comparison_report(jobs, trials, progress)
    if len(jobs) == 18 and all(re.fullmatch(r'(before|compute-capture|latest-input)-\d+-r\d+', j['name']) for j in jobs):
        require(comparisons['planned_reverse_order'], errors, 'Formal three-mode manifest does not provide complete reversed repeat orders')
    status = 'complete_passed' if all_passed and cleanup_ok and not errors and not prov['errors'] and len(progress) == len(jobs) and all(p.get('status') == 'measured' for p in progress) else 'finished_with_failures_or_missing_records' if cleanup else 'in_progress'
    return {'updated_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'root': str(root), 'status': status,
            'planned_trials': len(jobs), 'completed_summaries': len(trials), 'identity': identity,
            'identity_binding': binding(root / 'identity.json'), 'utility_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'progress_records': progress, 'cleanup': cleanup, 'cohort_errors': errors,
            'trials': [trials[j['name']] for j in jobs if j['name'] in trials], 'provenance': prov,
            'comparisons': comparisons,
            'measurement_scope': 'Unique receipts, current loaded image at RAF, and stage GL submissions divided by observed common frozen wall time. Neither RAF nor GL submission is physical display presentation. Age starts at JPEG encode initiation, excluding audio acquisition. All outliers remain included.',
            'gate_scope': 'Steady gates check source order, dimensions, requested worker config, audio, channel/compile errors, freshness and worker-stat arrival gaps no greater than 2 seconds. Passed continuity is not an age-percentile or maximum-age guarantee.',
            'transport_context': 'The app transport uses a default reliable ordered frames data channel and a 256 KiB canSend threshold. One admitted JPEG can raise bufferedAmount above that threshold. A server mailbox cannot evict bytes already queued in browser/SCTP. ACKs document effective admission per trial; exact loss causes or direction are not identified by these client logs.'}


def markdown(data):
    lines = ['# Independent saved app audit', '',
             f"Status: {data['status']}. Completed summaries: {data['completed_summaries']} of {data['planned_trials']} planned.", '',
             data['measurement_scope'], '', data['gate_scope'], '',
             '| Trial | Audit | Seconds | Input FPS | Receive FPS | Preview RAF FPS | Stage GL FPS |',
             '|---|---|---:|---:|---:|---:|---:|']
    def number(v, digits=3):
        return f'{v:.{digits}f}' if finite(v) else '—'
    for r in data['trials']:
        b = r.get('boundaries', {})
        vals = [number(b.get(k, {}).get('fps')) for k in ('main/sent', 'main/received', 'main/preview-image-raf', 'stage/webgl-frame-submitted')]
        lines.append('| ' + ' | '.join([r['name'], r['audit_status'], number(r.get('elapsed_seconds'))] + vals) + ' |')
    lines += ['', '| Trial / boundary | Age p50 / p95 / p99 / max ms | Age >250 / >500 / >1000 ms % | Max arrival gap ms |', '|---|---|---|---:|']
    for r in data['trials']:
        for key, b in r.get('boundaries', {}).items():
            if not b['age_ms']['count']:
                continue
            ages = ' / '.join(number(b['age_ms'][q], 1) for q in ('p50', 'p95', 'p99', 'max'))
            fractions = ' / '.join(number(b['age_over_ms'][str(t)]['percent']) for t in (250, 500, 1000))
            lines.append(f"| {r['name']} / {key} | {ages} | {fractions} | {number(b['max_event_gap_ms'], 1)} |")
    lines += ['', data['comparisons']['scope'], '',
              f"Planned reverse ordering: {data['comparisons']['planned_reverse_order']}. Completed valid counterbalance: {data['comparisons']['completed_counterbalanced_cohort']}.", '',
              'Episodes below are generated only from receipts above the configured age threshold in this cohort. Worker timing pairing is inferred from ordered binary/stat messages; server receive/send timestamps are unavailable.', '']
    for r in data['trials']:
        ep = r.get('episodes', {})
        for group in ep.get('groups', []):
            peak = group['peak']
            lines.append(f"- {r['name']}: {group['frames']} consecutive receipts above {number(ep['threshold_ms'], 0)} ms; peak frame {peak['id']} aged {number(peak['age_ms'], 1)} ms at {number(peak['receive_relative_s'])} s. Worker total p99/max: {number(group['worker_total_ms']['p99'], 1)} / {number(group['worker_total_ms']['max'], 1)} ms; measured queue p99/max: {number(group['worker_queue_ms']['p99'], 1)} / {number(group['worker_queue_ms']['max'], 1)} ms. Full capture/send/render context is retained in JSON.")
    lines += ['', data['transport_context'], '', f"Saved provenance: {data['provenance']['status']}.", '']
    problems = data['cohort_errors'] + data['provenance']['errors']
    for r in data['trials']:
        problems += [r['name'] + ': ' + p for p in r.get('arithmetic_errors', []) + r.get('independent_gate_failures', []) + r.get('raw_problems', [])]
        if r.get('stress'):
            lines.append(f"Stress for {r['name']}: {r['stress']['status']}. Separate target windows; prompt response means a subsequent capture, not proof of model prompt revision.")
    for p in data['progress_records']:
        if p.get('status') not in ('measured', 'running', 'pending'):
            problems.append(p['name'] + ': recorded ' + p['status'] + '; ' + str(p.get('error', '')))
    if data['cleanup'] and data['cleanup'].get('status') != 'pages-closed':
        problems.append('Cleanup: ' + json.dumps(data['cleanup']))
    if problems:
        lines += ['', 'Retained failures or discrepancies:', ''] + ['- ' + p for p in problems]
    return '\n'.join(lines) + '\n'


def signature(folder):
    # Small metadata polling; raw logs are parsed again only when files change.
    names = ('summary.json', 'main-raw.json', 'stage-raw.json', 'stress.json', 'stress-failure.json', 'main-stress-raw.json', 'stage-stress-raw.json')
    return tuple((n, p.stat().st_size, p.stat().st_mtime_ns) for n in names if (p := locate(folder / n)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path, help='JSON output; sibling .md is also generated')
    parser.add_argument('--provenance', type=Path)
    parser.add_argument('--watch', action='store_true')
    parser.add_argument('--episode-ms', type=float, default=1000)
    args = parser.parse_args()
    args.root = args.root.resolve(); args.output = args.output.resolve()
    if args.root == args.output or args.root in args.output.parents:
        parser.error('Output must be outside the input cohort directory')
    if args.output.suffix != '.json' or not finite(args.episode_ms) or args.episode_ms <= 0:
        parser.error('Output must end .json and episode threshold must be positive/finite')
    cache, signatures, frozen_identity = {}, {}, None
    while not locate(args.root / 'identity.json'):
        if not args.watch:
            parser.error('identity.json not found')
        print('Waiting for cohort identity: ' + str(args.root), flush=True)
        time.sleep(10)
    while True:
        try:
            identity = read(args.root / 'identity.json')
            if frozen_identity is None:
                frozen_identity = identity
            elif identity != frozen_identity:
                raise RuntimeError('Cohort identity changed while auditing; start a separate report for a new cohort')
            for job in identity['jobs']:
                folder = args.root / job['name']; sig = signature(folder)
                if not locate(folder / 'summary.json') or signatures.get(job['name']) == sig:
                    continue
                try:
                    result = audit_trial(folder, job, args.episode_ms)
                    result['stress'] = audit_stress(folder, job)
                    cache[job['name']] = result
                    signatures[job['name']] = sig
                    print(job['name'] + ': audit ' + result['audit_status'], flush=True)
                except (ValueError, KeyError, TypeError, OSError) as error:
                    if args.watch and not locate(args.root / 'cleanup.json'):
                        print(job['name'] + ': incomplete or malformed artifact, retrying: ' + repr(error), flush=True)
                        continue
                    cache[job['name']] = {'name': job['name'], 'config': job, 'audit_status': 'failed', 'arithmetic_errors': [repr(error)]}
            data = report(args.root, identity, cache, args.provenance)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            for path, content in ((args.output, json.dumps(data, indent=2, allow_nan=False) + '\n'), (args.output.with_suffix('.md'), markdown(data))):
                temp = path.with_name(path.name + '.tmp')
                temp.write_text(content); temp.replace(path)
        except (OSError, ValueError) as error:
            if not args.watch or locate(args.root / 'cleanup.json'):
                raise
            print('Retrying incomplete cohort metadata: ' + repr(error), flush=True)
        else:
            if not args.watch or data['cleanup'] is not None:
                return 0 if data['status'] == 'complete_passed' else 1
        time.sleep(10)


if __name__ == '__main__':
    raise SystemExit(main())
