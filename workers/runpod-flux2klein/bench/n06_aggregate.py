#!/usr/bin/env python3
"""Audit and aggregate the declared N06 36-trial app cohort, entirely offline.

Accepts JSON or JSON.gz artifacts from the frozen v5 app harness. Writes JSON,
Markdown and per-trial CSV outside --root. Exit 0 requires all 36 trials plus
source, configuration, ordered-transition and final-cleanup evidence to pass.
There is no input-admission promotion gate and no automatic performance winner.
--selection accepts an immutable JSON snapshot with the full ordered 36 jobs,
trial_roots mapping every job name to its selected cohort, and cohort_roots listing
ALL chronological attempts, including connection failures. Relative cohort paths
are relative to the selection file. Save a new selection version when continuing;
the report hashes the snapshot and every cohort identity. Existing timed outcomes
cannot be replaced by another cohort's attempt of the same declared job.
"""
import argparse
import collections
import csv
import hashlib
import json
from pathlib import Path
import re
import statistics
import sys

import audit_app as audit


SHAPES = {512: 288, 768: 448, 1024: 576}
VARIANTS = ('baseline', 'terminal-noop')
KINDS = ('main/sent', 'main/received', 'main/preview-image-raf',
         'stage/webgl-frame-submitted')
STAGE = KINDS[-1]
AGE_KEYS = ('p50', 'p95', 'p99', 'max')
DEFAULT_SOURCES = (Path(__file__).resolve().parents[3] / 'docs/performance/2026-09-18/'
                   'input/frozen-harness-v5/sources.json')
NAME = re.compile(r'n06-(512|768|1024)-workers([12])-(baseline|terminal-noop)-r([012])\Z')
RAW_CONTINUITY = re.compile(r'main: worker (\d+) had an output gap over two seconds\Z')
AUDIT_CONTINUITY = re.compile(r'Worker \d+: arrival gap over 2 seconds\Z')
LIMITS = [
    'Selected versus baseline is a configuration bundle: terminal-noop, CUDA-event '
    'stage timing and GPU output cast versus baseline, wall-clock timing and CPU '
    'output cast. It does not isolate the terminal skip.',
    'One versus two means active GPU workers on the same two-GPU host with both '
    'models loaded. This is not a comparison of separately provisioned hosts.',
    'Trials run sequentially. Matched repeat ratios reduce some drift but do not '
    'establish causality independently of transport/browser variation. The '
    'declared sequence has two forward repeats and one reverse repeat.',
    'FPS counts unique source IDs over the observed common main/stage interval. '
    'Stage age is capture encode start to WebGL submission, not physical display '
    'presentation. Preview RAF is a distinct browser boundary.',
    'A cell percentile is the median/range of three per-trial percentiles, not '
    'a pooled percentile. Pair ratios are calculated within repeat before their '
    'median/range. All raw tails and failed trials remain in the report.',
    'Impulse metadata/RMS tests delivery of a captured input, not perceptual '
    'beat strength or model prompt correctness. Impulse coverage is reported '
    'separately; N01 admission-promotion thresholds are not applied to N06.',
    'Source hashes bind the recorded harness identity to supplied frozen sources; '
    'they are not an independent attestation of remote runtime/GPU packages. '
    'Server snapshots bracket, rather than exactly equal, the client interval.',
    'Complete windows that fail only continuity remain in descriptive statistics '
    'and always fail eligibility. Structural, configuration, source-order or '
    'missing-window failures are not valid measured cells. Separate unsuccessful '
    'connection/setup attempts remain visible and fail the lifecycle gate.',
]


def name(width, workers, variant, repeat):
    return f'n06-{width}-workers{workers}-{variant}-r{repeat}'


def declared_order():
    result = []
    for repeat in range(3):
        arms = [(w, v) for w in (1, 2) for v in VARIANTS]
        if repeat == 1:
            arms.reverse()
        for width in SHAPES:
            result.extend(name(width, w, v, repeat) for w, v in arms)
    return result


def spread(values):
    if not values or not all(audit.finite(v) for v in values):
        return None
    return {'n': len(values), 'median': statistics.median(values),
            'min': min(values), 'max': max(values)}


def check_manifest(jobs):
    errors = []
    names = [j.get('name') for j in jobs]
    audit.require(names == declared_order(), errors, 'Manifest is not the declared ordered 36-trial matrix')
    audit.require(len(names) == len(set(names)), errors, 'Duplicate trial names')
    for job in jobs:
        match = NAME.fullmatch(str(job.get('name', '')))
        if not match:
            errors.append(f"Unrecognized N06 trial name: {job.get('name')}")
            continue
        width, workers, variant, _ = match.groups()
        fixed = {'width': int(width), 'height': SHAPES[int(width)],
                 'activeWorkers': int(workers), 'variant': variant,
                 'outputCast': 'cpu' if variant == 'baseline' else 'gpu',
                 'layout': 'vj-next', 'sendFps': 60, 'maxPending': 3,
                 'workerThreads': 128, 'mailbox': True, 'seconds': 60,
                 'thresholdBytes': 262144, 'inputImpulses': True}
        for key, value in fixed.items():
            audit.require(job.get(key) == value, errors, f"{job['name']}: unexpected {key}")
    # Also reject undeclared differences such as a prompt, seed or telemetry knob.
    variable = {'name', 'width', 'height', 'activeWorkers', 'variant', 'outputCast'}
    controls = [{k: v for k, v in j.items() if k not in variable} for j in jobs]
    audit.require(bool(controls) and all(c == controls[0] for c in controls), errors,
                  'Non-treatment controls differ between jobs')
    audit.require(all(j.get('server') and j.get('origin') for j in jobs), errors,
                  'Missing server or app origin')
    return errors


def reliable_channels(channels):
    return bool(channels) and all(c.get('readyState') == 'open' and c.get('ordered') is True
        and c.get('maxRetransmits') is None and c.get('maxPacketLifeTime') is None for c in channels)


def drain_check(value, needs_ack, server, lower=None, upper=None, closed_failed_attempt=False):
    errors = []
    value = value or {}
    audit.require(value.get('status') == 'drained', errors, 'Missing successful drain')
    audit.require(value.get('server') == server, errors, 'Drain server differs')
    audit.require(audit.finite(value.get('quiet_observed_ms')) and value['quiet_observed_ms'] >= 500,
                  errors, 'Insufficient observed quiet interval')
    barrier = value.get('ordered_barrier', {})
    needs_ack = needs_ack or value.get('initial', {}).get('open') is True
    if needs_ack:
        ack = barrier.get('ack', {})
        audit.require(ack.get('status') == 'passed' and ack.get('type') == 'vj0-input-barrier-ack'
                      and bool(ack.get('nonce')), errors, 'Missing passed ordered barrier ACK')
        audit.require(reliable_channels(barrier.get('before', {}).get('channels'))
                      and reliable_channels(barrier.get('after')), errors,
                      'Barrier channel is not open, reliable and ordered')
        at = barrier.get('receivedAt')
        audit.require(audit.finite(at) and (lower is None or at >= lower)
                      and (upper is None or at <= upper), errors, 'Barrier timestamp outside transition')
    else:
        audit.require(value.get('initial', {}).get('open') is False
                      and (value.get('initial', {}).get('url') == 'about:blank' or
                           (closed_failed_attempt and value.get('initial', {}).get('stopped') is True)), errors,
                      'Only initial blank setup or a documented closed failed attempt may omit an ordered barrier')
    debug = value.get('debug_after_barrier', {})
    workers = debug.get('workers', [])
    audit.require(bool(workers) and all(w.get('ready') is True and w.get('framePending') == 0
                  and w.get('compileStartedAt') == 0 and w.get('mailboxFlightSource') is None
                  for w in workers), errors, 'Drain workers not idle and ready')
    audit.require(not debug.get('channel') or debug['channel'].get('bufferedAmount') == 0,
                  errors, 'Drain server outgoing channel not empty')
    return {'status': 'passed' if not errors else 'failed', 'errors': errors,
            'ack_required': needs_ack, 'ack': barrier.get('ack'),
            'closed_failed_attempt': closed_failed_attempt,
            'scope': 'Idle worker/channel observation after failed attempt; no ordered ACK claimed' if closed_failed_attempt and not needs_ack else 'Ordered barrier or initial blank-page drain',
            'ack_received_at': barrier.get('receivedAt'), 'evidence': value}


def source_check(identity, sources_path):
    sources = audit.read(sources_path)
    errors = []
    for field, file in [('harness_sha256', 'app_batch.py'), ('probe_sha256', 'app_probe.js')]:
        wanted = sources.get('files', {}).get(file)
        audit.require(isinstance(wanted, str) and re.fullmatch('[0-9a-f]{64}', wanted)
                      and identity.get(field) == wanted, errors, f'{field} differs from frozen sources')
    for file, sha in sources.get('files', {}).items():
        audit.require(Path(file).name == file, errors, 'Unsafe frozen-source filename')
        if Path(file).name == file:
            audit.require(audit.locate(sources_path.parent / file) is not None
                          and hashlib.sha256(audit.payload(sources_path.parent / file)).hexdigest() == sha,
                          errors, f'Frozen source bytes differ: {file}')
    settings = identity.get('fixture', {}).get('vj0-ai-settings-storage', {}).get('state', {})
    for key, value in [('seed', 42), ('kleinSteps', 2), ('kleinAlpha', .1)]:
        audit.require(settings.get(key) == value, errors, f'Fixture {key} differs')
    return {'errors': errors, 'sources': sources, 'binding': audit.binding(sources_path),
            'recorded_harness_sha256': identity.get('harness_sha256'),
            'recorded_probe_sha256': identity.get('probe_sha256'), 'fixture': identity.get('fixture')}


def audit_one(root, job, index, previous_end):
    folder = root / job['name']
    result = {'name': job['name'], 'config': job, 'status': 'missing', 'errors': [],
              'cohort_root': str(root.resolve()), 'source_summary': str(folder / 'summary.json'),
              'valid_for_descriptive': False, 'continuity_errors': []}
    errors = result['errors']
    continuity = result['continuity_errors']
    summary = audit.read(folder / 'summary.json', optional=True)
    if summary is None:
        result['failure_artifacts'] = {n: audit.read(folder / n, optional=True)
                                       for n in ('failure.json', 'stress-failure.json')}
        return result
    result['raw_status'] = summary.get('status')
    result['raw_problems'] = summary.get('problems')
    result['reported_targets'] = summary.get('targets')
    result['summary_binding'] = audit.binding(folder / 'summary.json')
    try:
        detail = result['audit'] = audit.audit_trial(folder, job, 1000)
        errors.extend(detail['arithmetic_errors'])
        for issue in detail['independent_gate_failures']:
            (continuity if AUDIT_CONTINUITY.fullmatch(issue) else errors).append(issue)
        if summary.get('status') == 'measured':
            audit.require(not summary.get('problems'), errors, 'Measured status contradicts recorded problems')
        else:
            problems = summary.get('problems') or []
            matched = [RAW_CONTINUITY.fullmatch(p) if isinstance(p, str) else None for p in problems]
            only_continuity = summary.get('status') == 'invalid' and bool(matched) and all(matched)
            if only_continuity:
                only_continuity = all(detail['worker_activity'].get(m.group(1), {}).get('max_gap_ms', 0) > 2000
                                      for m in matched)
            audit.require(only_continuity, errors, 'Status/problems do not establish a sole observed continuity failure')
        for key in KINDS:
            b = detail['boundaries'].get(key)
            audit.require(bool(b), errors, key + ': missing measurement boundary')
            if b and key != 'main/sent':
                audit.require(b['age_ms']['count'] == b['events'], errors, key + ': missing source ages')
                audit.require(b['max_event_gap_ms'] <= 2000, continuity, key + ': continuity gap over 2 seconds')
        if previous_end is not None:
            audit.require(detail['window_start'] > previous_end, errors, 'Trial windows overlap or reverse')
        workers = detail.get('final_server_workers') or []
        audit.require(sorted(w.get('gpu') for w in workers) == [0, 1]
                      and all(w.get('ready') is True and w.get('compileStartedAt') == 0 for w in workers),
                      errors, 'Both loaded server workers must finish ready without compilation')
        values = summary.get('input', {})
        admission = values.get('admission', {})
        audit.require(admission.get('thresholdBytes') == job['thresholdBytes'], errors, 'Input threshold mismatch')
        audit.require(reliable_channels(admission.get('channels')), errors, 'Final input channel not reliable/ordered')
        for site in ('before-encode', 'before-send'):
            check = admission.get('checks', {}).get(site, {})
            audit.require(audit.finite(check.get('calls')) and check['calls'] > 0, errors,
                          'Missing admission checks: ' + site)
        for key in KINDS:
            measured = detail['boundaries'].get(key, {})
            surface = values.get('surfaces', {}).get(key, {})
            for a, b in [('unique_fps', 'fps'), ('frames', 'events'), ('source_age_ms', 'age_ms')]:
                audit.require(audit.equivalent(surface.get(a), measured.get(b)), errors,
                              key + ': input surface ' + a + ' arithmetic')
            expected = {k: v['percent'] / 100 if v['percent'] is not None else None
                        for k, v in measured.get('age_over_ms', {}).items()}
            audit.require(audit.equivalent(surface.get('fractions_older_than_ms'), expected), errors,
                          key + ': age threshold fraction arithmetic')
        impulses = values.get('impulse_summary', {})
        result['input_evidence'] = {'admission': admission, 'impulse_summary': impulses,
                                  'impulses': values.get('impulses'),
                                  'coverage_complete': (impulses.get('expected_count', 0) > 0
                                      and impulses.get('count') == impulses.get('expected_count')
                                      and not impulses.get('invalid_indices') and not impulses.get('censored_indices'))}
        drain = audit.read(folder / 'drain-before-switch.json', optional=True)
        result['transition'] = drain_check(drain, index > 0, job['server'],
                                           lower=previous_end, upper=detail['window_start'])
        errors.extend('Transition: ' + e for e in result['transition']['errors'])
        result['metrics'] = {key: detail['boundaries'].get(key) for key in KINDS}
    except (OSError, ValueError, TypeError, KeyError, IndexError, ZeroDivisionError) as exc:
        errors.append(f'Cannot audit complete raw evidence: {type(exc).__name__}: {exc}')
    result['structural_errors'] = list(errors)
    result['valid_for_descriptive'] = not errors
    result['status'] = 'failed' if errors else 'continuity-failed' if continuity else 'passed'
    errors.extend(continuity)
    return result


def cell(trials, width, workers, variant, common_errors):
    names = [name(width, workers, variant, r) for r in range(3)]
    rows = [trials.get(n) for n in names]
    result = {'width': width, 'height': SHAPES[width], 'active_workers': workers,
              'variant': variant, 'label': 'baseline' if variant == 'baseline' else 'selected bundle',
              'trials': names, 'valid_trials': sum(bool(r) and r['status'] == 'passed' for r in rows),
              'descriptive_trials': sum(bool(r) and r.get('valid_for_descriptive', r['status'] == 'passed') for r in rows),
              'all_trials_passed': all(r and r['status'] == 'passed' for r in rows),
              'status': 'unavailable', 'aggregate': None}
    if common_errors or any(not r or not r.get('valid_for_descriptive', r['status'] == 'passed') for r in rows):
        return result
    stage = [r['metrics'][STAGE] for r in rows]
    result.update(status='complete' if result['all_trials_passed'] else 'descriptive-with-failed-outcomes', aggregate={
        'stage_fps': spread([s['fps'] for s in stage]),
        'stage_age_ms': {key: spread([s['age_ms'][key] for s in stage]) for key in AGE_KEYS},
        'worst_stage_age_ms': max(s['age_ms']['max'] for s in stage),
        'stage_max_gap_ms': spread([s['max_event_gap_ms'] for s in stage]),
        'stage_age_over_percent': {key: spread([s['age_over_ms'][key]['percent'] for s in stage])
                                   for key in ('250', '500', '1000')},
        'achieved_input_fps': spread([r['metrics']['main/sent']['fps'] for r in rows])})
    return result


def comparison(trials, width, numerator, denominator, label, common_errors):
    pairs = []
    for repeat in range(3):
        names = [name(width, *arm, repeat) for arm in (numerator, denominator)]
        rows = [trials.get(n) for n in names]
        pair = {'repeat': repeat, 'numerator': names[0], 'denominator': names[1],
                'status': 'unavailable', 'metrics': None,
                'all_trials_passed': all(r and r['status'] == 'passed' for r in rows)}
        if not common_errors and all(r and r.get('valid_for_descriptive', r['status'] == 'passed') for r in rows):
            a, b = (r['metrics'][STAGE] for r in rows)
            def change(x, y):
                return {'numerator': x, 'denominator': y, 'delta': x - y,
                        'ratio': x / y if y != 0 else None}
            pair.update(status='complete' if pair['all_trials_passed'] else 'descriptive-with-failed-outcomes', metrics={
                'stage_fps': change(a['fps'], b['fps']),
                'stage_age_ms': {k: change(a['age_ms'][k], b['age_ms'][k]) for k in AGE_KEYS}})
        pairs.append(pair)
    result = {'width': width, 'height': SHAPES[width], 'comparison': label,
              'pairs': pairs, 'status': 'unavailable', 'aggregate': None}
    result['all_trials_passed'] = all(p['all_trials_passed'] for p in pairs)
    if all(p['metrics'] is not None for p in pairs):
        result.update(status='complete' if result['all_trials_passed'] else 'descriptive-with-failed-outcomes', aggregate={
            'stage_fps_ratio': spread([p['metrics']['stage_fps']['ratio'] for p in pairs]),
            'stage_fps_delta': spread([p['metrics']['stage_fps']['delta'] for p in pairs]),
            'stage_age_ms': {k: {kind: spread([p['metrics']['stage_age_ms'][k][kind] for p in pairs])
                                for kind in ('ratio', 'delta')} for k in AGE_KEYS}})
    return result


def cohort_record(root, jobs, sources_path):
    """Retain unsuccessful attempts as well as selected timed cells."""
    errors = []
    identity = audit.read(root / 'identity.json', optional=True)
    audit.require(bool(identity), errors, 'Missing cohort identity')
    identity = identity or {'jobs': []}
    source = source_check(identity, sources_path)
    errors.extend(source['errors'])
    canonical = {j['name']: j for j in jobs}
    names = [j['name'] for j in identity.get('jobs', [])]
    audit.require(len(names) == len(set(names)), errors, 'Duplicate cohort job names')
    audit.require(names == [j['name'] for j in jobs if j['name'] in names], errors,
                  'Cohort jobs do not follow the declared matrix order')
    for job in identity.get('jobs', []):
        audit.require(canonical.get(job['name']) == job, errors, 'Cohort configuration differs: ' + job['name'])
    progress = audit.read(root / 'progress.json', optional=True) or []
    audit.require([p.get('name') for p in progress] == names[:len(progress)], errors,
                  'Cohort progress is not a unique ordered prefix of its jobs')
    for p in progress:
        audit.require(p.get('config') == canonical.get(p.get('name')), errors,
                      'Cohort progress configuration differs: ' + str(p.get('name')))
        audit.require(p.get('status') in ('measured', 'invalid', 'failed'), errors,
                      'Unknown progress status: ' + str(p.get('status')))
    return {'root': str(root), 'identity': identity, 'source_identity': source,
            'progress': progress, 'errors': errors,
            'bindings': {n: audit.binding(root / n) for n in
                         ('identity.json', 'progress.json', 'cleanup.json', 'drain-before-switch.json')}}


def aggregate(root=None, sources_path=DEFAULT_SOURCES, selection_path=None):
    sources_path = Path(sources_path)
    selection_bytes = audit.payload(selection_path) if selection_path is not None else None
    selection = json.loads(selection_bytes) if selection_bytes is not None else None
    selection_binding = audit.binding(selection_path) if selection_path is not None else None
    if selection_binding and selection_binding['uncompressed_sha256'] != hashlib.sha256(selection_bytes).hexdigest():
        raise ValueError('Selection changed while being read; use an immutable version')
    if selection is not None:
        selection_path = Path(selection_path).resolve()
        def resolved(value):
            path = Path(value)
            return (path if path.is_absolute() else selection_path.parent / path).resolve()
        jobs = selection['jobs']
        names = [j['name'] for j in jobs]
        if set(selection['trial_roots']) != set(names):
            raise ValueError('Selection must map every declared job exactly once')
        roots = {n: resolved(p) for n, p in selection['trial_roots'].items()}
        cohort_roots = [resolved(p) for p in selection['cohort_roots']]
        if len(cohort_roots) != len(set(cohort_roots)) or not set(roots.values()).issubset(cohort_roots):
            raise ValueError('cohort_roots must uniquely include every selected root and all retained attempts')
    else:
        root = Path(root).resolve()
        jobs = audit.read(root / 'identity.json')['jobs']
        roots = {j['name']: root for j in jobs}
        cohort_roots = [root]
    common = check_manifest(jobs)
    cohort_indices = {str(p): i for i, p in enumerate(cohort_roots)}
    chosen_order = [cohort_indices[str(roots[j['name']])] for j in jobs]
    audit.require(chosen_order == sorted(chosen_order), common, 'Selected cohorts reverse or interleave execution order')
    cohorts = {str(p): cohort_record(p, jobs, sources_path) for p in cohort_roots}
    signatures = [{k: c['identity'].get(k) for k in ('harness_sha256', 'probe_sha256', 'fixture')}
                  for c in cohorts.values()]
    audit.require(bool(signatures) and all(v == signatures[0] for v in signatures), common,
                  'Cohort harness, probe or fixture identities differ')
    attempts, seen_timed = [], set()
    for cohort in cohorts.values():
        common.extend(cohort['root'] + ': ' + e for e in cohort['errors'])
        p_root = Path(cohort['root'])
        for p in cohort['progress']:
            name_ = p['name']
            if not NAME.fullmatch(name_):
                continue
            folder = p_root / name_
            saved_window = any(audit.locate(folder / n) for n in ('summary.json', 'main-raw.json', 'stage-raw.json'))
            audit.require(name_ not in seen_timed, common,
                          'Previously timed cell was attempted again: ' + name_)
            if saved_window:
                seen_timed.add(name_)
                audit.require(roots.get(name_) == p_root, common,
                              'Selection discards an existing saved measurement: ' + name_)
            if p['status'] == 'failed':
                attempts.append({'name': name_, 'cohort_root': str(p_root), 'progress': p,
                    'saved_measurement_artifact': saved_window,
                    'classification': 'failed attempt with saved measurement' if saved_window else 'failed attempt without a complete saved window',
                    'phase_limit': 'Original error is retained; absent raw files alone do not prove whether timing began.',
                    'bindings': {n: audit.binding(folder / n) for n in
                                 ('summary.json', 'main-raw.json', 'stage-raw.json', 'failure.json', 'drain-before-switch.json', 'mailbox-config.json')},
                    'failure': audit.read(folder / 'failure.json', optional=True)})
        # Saved outcomes must also appear in progress; otherwise do not silently
        # select a different root after a partially written or interrupted run.
        progressed = {p['name'] for p in cohort['progress']}
        for job in cohort['identity'].get('jobs', []):
            if NAME.fullmatch(job['name']) and any(audit.locate(p_root / job['name'] / n)
                    for n in ('summary.json', 'main-raw.json', 'stage-raw.json')):
                audit.require(job['name'] in progressed, common,
                              'Saved outcome missing from cohort progress: ' + job['name'])
                audit.require(roots.get(job['name']) == p_root, common,
                              'Existing timed outcome cannot be replaced: ' + job['name'])
    provenance_valid = not common
    rows, previous_end = [], None
    for job in jobs:
        p_root = roots[job['name']]
        cohort = cohorts[str(p_root)]
        members = [j for j in cohort['identity'].get('jobs', []) if j.get('name') == job['name']]
        member_valid = members == [job]
        if not NAME.fullmatch(str(job.get('name', ''))):
            rows.append({'name': job.get('name'), 'config': job, 'status': 'failed', 'valid_for_descriptive': False,
                         'errors': ['Unsafe or unrecognized N06 trial name']})
            continue
        local_names = [j['name'] for j in cohort['identity'].get('jobs', [])]
        index = local_names.index(job['name']) if job['name'] in local_names else 0
        try:
            row = audit_one(p_root, job, index, previous_end)
        except (OSError, ValueError, TypeError, KeyError) as exc:
            row = {'name': job['name'], 'config': job, 'status': 'failed', 'valid_for_descriptive': False,
                   'errors': [f'Unreadable saved trial: {type(exc).__name__}: {exc}']}
        progress_matches = [p for p in cohort['progress'] if p.get('name') == job['name']]
        p = row['progress'] = progress_matches[0] if len(progress_matches) == 1 else None
        if not member_valid or p is None or p.get('status') != row.get('raw_status') or p.get('config') != job:
            row['errors'].append('Selected job membership or progress status/config is absent or differs')
            row['valid_for_descriptive'] = False
            if row['status'] != 'missing':
                row['status'] = 'failed'
        if not provenance_valid:
            row['errors'].append('Matrix, selection or cohort provenance is invalid; measurement cannot be labeled valid')
            row['valid_for_descriptive'] = False
            if row['status'] != 'missing':
                row['status'] = 'failed'
        if row.get('audit', {}).get('window_end') is not None:
            previous_end = row['audit']['window_end']
        rows.append(row)
    renderers = [r['audit'].get('renderer') for r in rows if r.get('audit')]
    keys = ('userAgent', 'renderer', 'viewport', 'mainViewport', 'devicePixelRatio', 'focusEmulation')
    audit.require(bool(renderers) and all(isinstance(r, dict) and all(k in r for k in keys)
                  and all(r[k] == renderers[0][k] for k in keys) for r in renderers), common,
                  'Browser/renderer identity or viewport controls differ or are absent')
    for cohort in cohorts.values():
        p_root = Path(cohort['root'])
        cleanup = cohort['cleanup'] = audit.read(p_root / 'cleanup.json', optional=True)
        audit.require(bool(cleanup) and cleanup.get('status') == 'pages-closed' and not cleanup.get('errors'),
                      common, 'Missing acknowledged cleanup: ' + str(p_root))
        progress = cohort['progress']
        last = progress[-1] if progress else None
        last_folder = p_root / last['name'] if last and NAME.fullmatch(last['name']) else None
        failed_without_window = bool(last and last.get('status') == 'failed' and last_folder and not any(
            audit.locate(last_folder / n) for n in ('summary.json', 'main-raw.json', 'stage-raw.json')))
        ends = [r['audit']['window_end'] for r in rows if r.get('cohort_root') == str(p_root) and r.get('audit')]
        lower = max(ends) if ends else None
        server = (cohort['identity'].get('jobs') or jobs or [{}])[-1].get('server')
        if failed_without_window:
            prior_drain = drain_check(audit.read(last_folder / 'drain-before-switch.json', optional=True),
                                     bool(ends), server, lower=lower)
            cohort['failed_attempt_transition'] = prior_drain
            common.extend(str(p_root) + ': failed attempt transition: ' + e for e in prior_drain['errors'])
        final = cohort['final_transition'] = drain_check(
            audit.read(p_root / 'drain-before-switch.json', optional=True),
            bool(ends) and not failed_without_window, server, lower=lower,
            closed_failed_attempt=failed_without_window)
        common.extend(str(p_root) + ': final transition: ' + e for e in final['errors'])
    if selection_path is not None:
        audit.require(audit.binding(selection_path) == selection_binding, common,
                      'Selection changed during the audit; use a new immutable version')
    indexed = {r['name']: r for r in rows}
    cells = [cell(indexed, width, workers, variant, common)
             for width in SHAPES for workers in (1, 2) for variant in VARIANTS]
    comparisons = []
    for width in SHAPES:
        comparisons.extend(comparison(indexed, width, (w, 'terminal-noop'), (w, 'baseline'),
            f'selected bundle / baseline at {w} active worker(s)', common) for w in (1, 2))
        comparisons.append(comparison(indexed, width, (2, 'terminal-noop'), (1, 'terminal-noop'),
                                      '2 / 1 active GPU workers within selected bundle', common))
    descriptive_complete = not common and len(rows) == 36 and all(r.get('valid_for_descriptive') for r in rows)
    gates = {'complete_36_valid_windows': descriptive_complete,
             'all_trial_continuity_passed': len(rows) == 36 and all(r['status'] == 'passed' for r in rows),
             'all_cohort_source_and_lifecycle_checks_passed': not common,
             'no_failed_connection_or_setup_attempts': not attempts}
    passed = all(gates.values())
    return {'schema': 'n06-offline-audit-v2', 'root': str(root.resolve()) if root is not None else None,
            'input_roots': [str(p) for p in cohort_roots],
            'selection': {'file': str(selection_path), 'binding': selection_binding,
                          'manifest': selection} if selection_path is not None else None,
            'status': 'complete' if passed else 'complete-with-failed-outcomes' if descriptive_complete else 'incomplete-or-failed',
            'common_errors': common, 'expected_trials': 36, 'declared_trials': len(jobs),
            'trial_status_counts': dict(collections.Counter(r['status'] for r in rows)),
            'validation_gates': gates, 'eligibility': 'data-ready; not promoted' if passed else 'blocked by retained failures or incomplete evidence',
            'cohorts': cohorts, 'failed_attempts': attempts,
            'source_identity': next(iter(cohorts.values()))['source_identity'] if cohorts else None,
            'analysis_sources': {p.name: audit.binding(p) for p in (Path(__file__), Path(audit.__file__))},
            'trials': rows, 'cells': cells, 'comparisons': comparisons,
            'promotion': 'not evaluated; report all throughput/latency tradeoffs and review quality separately',
            'limitations': LIMITS}


def fmt(value):
    return '—' if value is None else f'{value:.3f}'


def markdown(report):
    lines = [f"N06 audit: **{report['status']}**. {report['trial_status_counts']}", '',
             f"Eligibility: {report.get('eligibility')}. Failed attempts retained: {len(report.get('failed_attempts', []))}.", '',
             *[s + '\n' for s in report['limitations']],
             'Cell values are medians across three complete repeats.', '',
             '| Resolution | Active workers | Bundle | Status | Stage FPS median [min, max] | Age p50 / p95 / p99 / max (ms) |',
             '|---|---:|---|---|---|---|']
    for c in report['cells']:
        a = c['aggregate']
        fps = (f"{fmt(a['stage_fps']['median'])} [{fmt(a['stage_fps']['min'])}, {fmt(a['stage_fps']['max'])}]" if a else '—')
        ages = ' / '.join(fmt(a['stage_age_ms'][k]['median']) for k in AGE_KEYS) if a else '—'
        lines.append(f"| {c['width']}×{c['height']} | {c['active_workers']} | {c['label']} | {c['status']} | {fps} | {ages} |")
    lines.extend(['', '| Resolution | Matched comparison | Status | FPS ratio median [min, max] | Age delta p50 / p95 / p99 / max (ms) |',
                  '|---|---|---|---|---|'])
    for c in report['comparisons']:
        a = c['aggregate']
        ratio = (f"{fmt(a['stage_fps_ratio']['median'])} [{fmt(a['stage_fps_ratio']['min'])}, {fmt(a['stage_fps_ratio']['max'])}]" if a else '—')
        ages = ' / '.join(fmt(a['stage_age_ms'][k]['delta']['median']) for k in AGE_KEYS) if a else '—'
        lines.append(f"| {c['width']}×{c['height']} | {c['comparison']} | {c['status']} | {ratio} | {ages} |")
    lines.extend(['', 'Every declared trial, including failures:', '',
                  '| Trial | Status | Input FPS | Stage FPS | Age p50 / p95 / p99 / max (ms) | Stage >250 / 500 / 1000 ms (%) | Max stage gap (ms) |',
                  '|---|---|---:|---:|---|---|---:|'])
    for row in report['trials']:
        s = row.get('metrics', {}).get(STAGE) or {}
        ages = ' / '.join(fmt(s.get('age_ms', {}).get(k)) for k in AGE_KEYS)
        tails = ' / '.join(fmt(s.get('age_over_ms', {}).get(k, {}).get('percent')) for k in ('250', '500', '1000'))
        lines.append(f"| {row['name']} | {row['status']} | {fmt((row.get('metrics', {}).get('main/sent') or {}).get('fps'))} | {fmt(s.get('fps'))} | {ages} | {tails} | {fmt(s.get('max_event_gap_ms'))} |")
    errors = list(report['common_errors'])
    errors.extend(r['name'] + ': ' + '; '.join(r['errors']) for r in report['trials'] if r['errors'])
    if errors:
        lines.extend(['', 'Validation findings:', '', *['- ' + e for e in errors]])
    if report.get('failed_attempts'):
        lines.extend(['', 'Separate failed attempts retained:', '', *[
            '- ' + a['name'] + ' (' + a['cohort_root'] + '): ' + str(a['progress'].get('error', a['progress']['status']))
            for a in report['failed_attempts']]])
    return '\n'.join(lines) + '\n'


def write_report(report, output, root=None):
    output = Path(output).resolve()
    roots = [Path(p).resolve() for p in report.get('input_roots', [])]
    if root is not None:
        roots.append(Path(root).resolve())
    paths = [output, output.with_suffix('.md'), output.with_suffix('.csv')]
    selection = report.get('selection')
    if (output.suffix != '.json' or any(p == r or r in p.parents for p in paths for r in roots)
            or (selection and Path(selection['file']).resolve() in paths)):
        raise ValueError('--output must be a .json path outside every read-only input root and selection file')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    paths[1].write_text(markdown(report))
    fields = ['name', 'status', 'raw_status', 'valid_for_descriptive', 'cohort_root', 'source_summary',
              'width', 'height', 'active_workers', 'variant',
              'input_fps', 'stage_frames', 'stage_fps', 'p50_age_ms', 'p95_age_ms', 'p99_age_ms',
              'max_age_ms', 'over_250_percent', 'over_500_percent', 'over_1000_percent',
              'max_gap_ms', 'worker_ids', 'impulse_coverage_complete', 'errors']
    with paths[2].open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, lineterminator='\n')
        writer.writeheader()
        for r in report['trials']:
            s = r.get('metrics', {}).get(STAGE) or {}
            job = r['config']
            writer.writerow(dict(name=r['name'], status=r['status'], raw_status=r.get('raw_status'),
                valid_for_descriptive=r.get('valid_for_descriptive', False), cohort_root=r.get('cohort_root'),
                source_summary=r.get('source_summary'),
                width=job.get('width'), height=job.get('height'), active_workers=job.get('activeWorkers'),
                variant=job.get('variant'), input_fps=(r.get('metrics', {}).get('main/sent') or {}).get('fps'),
                stage_frames=s.get('unique_frames'), stage_fps=s.get('fps'),
                **{k + '_age_ms': s.get('age_ms', {}).get(k) for k in AGE_KEYS},
                **{'over_' + k + '_percent': s.get('age_over_ms', {}).get(k, {}).get('percent') for k in ('250', '500', '1000')},
                max_gap_ms=s.get('max_event_gap_ms'), worker_ids=r.get('audit', {}).get('worker_ids'),
                impulse_coverage_complete=r.get('input_evidence', {}).get('coverage_complete'),
                errors='; '.join(r['errors'])))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--root', '--results', dest='root', type=Path)
    source.add_argument('--selection', type=Path, help='Immutable full-matrix jobs/trial_roots/cohort_roots JSON snapshot')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--sources', type=Path, default=DEFAULT_SOURCES,
                        help='Frozen v5 sources.json, with the bound source files alongside it')
    args = parser.parse_args(argv)
    try:
        result = aggregate(args.root, args.sources, args.selection)
        write_report(result, args.output, args.root)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        print(f'N06 audit could not complete: {type(exc).__name__}: {exc}', file=sys.stderr)
        return 2
    print(json.dumps({'status': result['status'], 'trials': result['trial_status_counts'],
                      'common_errors': result['common_errors'], 'output': str(args.output)}))
    return 0 if result['status'] == 'complete' else 1


if __name__ == '__main__':
    raise SystemExit(main())
