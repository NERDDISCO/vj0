"""CPU-only saved-artifact fixtures; no browser, network, model or GPU imports."""
import contextlib
import copy
import gzip
import hashlib
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest

import audit_app as audit
import n06_aggregate as n06


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


def channel():
    return {'readyState': 'open', 'bufferedAmount': 0, 'ordered': True,
            'maxRetransmits': None, 'maxPacketLifeTime': None}


def debug():
    return {'stats': {}, 'workers': [dict(gpu=i, ready=True, framePending=0,
        compileStartedAt=0, mailboxFlightSource=None) for i in (0, 1)], 'channel': channel()}


def drain(server, at, initial=False):
    value = {'status': 'drained', 'server': server, 'quiet_observed_ms': 600,
             'initial': {'open': not initial, 'url': 'about:blank' if initial else 'http://app/vj-next'},
             'debug_after_barrier': debug()}
    if not initial:
        value['ordered_barrier'] = {'before': {'at': at - 1, 'channels': [channel()]},
            'after': [channel()], 'receivedAt': at, 'ack': {'status': 'passed',
            'type': 'vj0-input-barrier-ack', 'nonce': 'synthetic-' + str(at)}}
    return value


def publish_summary(folder, job, start, end):
    raw = {target: audit.read(folder / (target + '-raw.json')) for target in ('main', 'stage')}
    targets, ordering, surfaces = {}, {}, {}
    for target, data in raw.items():
        rr = [r for r in data['rows'] if start <= r['at'] <= end]
        targets[target] = {k: audit.metrics(audit.selected(rr, k), start, end) for k in {r['kind'] for r in rr}}
        ordering[target] = {}
        for key in n06.KINDS:
            t, kind = key.split('/')
            if target != t:
                continue
            rows = audit.selected(rr, kind)
            b = audit.boundary(rows, start, end)
            surfaces[key] = {'frames': b['events'], 'unique_fps': b['fps'], 'source_age_ms': b['age_ms'],
                'fractions_older_than_ms': {k: v['percent'] / 100 if v['percent'] is not None else None
                                           for k, v in b['age_over_ms'].items()}}
            if kind != 'sent':
                o = audit.order(rows)
                ordering[target][kind] = {k: o[k] for k in ('frames', 'missing_ids', 'reversals', 'duplicate_ids')}
                ordering[target][kind]['status'] = 'failed' if audit.bad_order(o) else 'passed'
    stats = audit.selected(raw['main']['rows'], 'worker-stats')
    activity = {str(w): {'frames': sum(r['worker'] == w for r in stats),
        'max_gap_ms': audit.max_gap([r['at'] for r in stats if r['worker'] == w], start, end)}
        for w in range(job['activeWorkers'])}
    summary = {'window_start': start, 'window_end': end, 'seconds': (end - start) / 1000,
        'status': 'measured', 'problems': [], 'config': job, 'targets': targets,
        'source_order': ordering, 'worker_activity': activity,
        'audio_rms_by_fixture_level': {'0.2': audit.distribution([.14])},
        'renderer': {'userAgent': 'HeadlessChrome/149 fixture', 'renderer': 'synthetic',
            'viewport': [1920, 1080], 'mainViewport': [1440, 900], 'devicePixelRatio': 1,
            'focusEmulation': True, 'glBuffer': [2048, 1152]},
        'input': {'admission': {'thresholdBytes': 262144, 'channels': [channel()],
            'checks': {k: {'calls': 100, 'rejected': 0} for k in ('before-encode', 'before-send')}},
            'surfaces': surfaces, 'impulse_summary': {'count': 1, 'expected_count': 1,
                'invalid_indices': [], 'censored_indices': []}, 'impulses': []}}
    save(folder / 'summary.json', summary)


def fixture(root):
    sources = root.parent / 'frozen'
    sources.mkdir()
    files = {}
    for name in ('app_batch.py', 'app_probe.js', 'input_metrics.py'):
        data = ('synthetic identity only: ' + name).encode()
        (sources / name).write_bytes(data)
        files[name] = hashlib.sha256(data).hexdigest()
    save(sources / 'sources.json', {'files': files})
    jobs = []
    for i, trial_name in enumerate(n06.declared_order()):
        width, workers, variant, repeat = n06.NAME.fullmatch(trial_name).groups()
        width, workers, repeat = int(width), int(workers), int(repeat)
        job = dict(name=trial_name, width=width, height=n06.SHAPES[width], activeWorkers=workers,
            variant=variant, outputCast='cpu' if variant == 'baseline' else 'gpu',
            server='https://fixture.invalid', origin='http://app', layout='vj-next', sendFps=60,
            maxPending=3, workerThreads=128, mailbox=True, seconds=60, thresholdBytes=262144,
            inputImpulses=True)
        jobs.append(job)
        rates = {(1, 'baseline'): [4, 8, 6], (1, 'terminal-noop'): [8, 8, 18],
                 (2, 'baseline'): [8, 12, 10], (2, 'terminal-noop'): [12, 16, 18]}
        fps = rates[workers, variant][repeat]
        start, end = 1000000 + i * 100000, 1060000 + i * 100000
        age = 100 + repeat * 10 + (50 if variant == 'terminal-noop' else 0)
        main, stage = [], []
        for frame in range(60 * fps):
            at = start + (frame + .5) * 1000 / fps
            frame_id = frame + 1
            main.extend([{'kind': 'sent', 'id': frame_id, 'at': at - 10, 'bytes': 100},
                {'kind': 'received', 'id': frame_id, 'at': at, 'ageMs': age, 'bytes': 200},
                {'kind': 'worker-stats', 'at': at + .001, 'worker': frame % workers,
                    'width': width, 'height': n06.SHAPES[width], 'timing': {
                    'benchmark_variant': variant, 'stage_clock': 'wall-clock' if variant == 'baseline' else 'cuda-events',
                    'torch_threads': 128, 'output_cast': job['outputCast'], 'terminal_skips': int(variant != 'baseline'),
                    'total_ms': 30, 'queue_wait_ms': 1}},
                {'kind': 'preview-image-raf', 'id': frame_id, 'at': at + .01, 'ageMs': age + .01}])
            stage.append({'kind': 'webgl-frame-submitted', 'id': frame_id, 'at': at + .02,
                          'ageMs': age + .02, 'width': 2048, 'height': 1152})
        folder = root / trial_name
        for target, rows in [('main', main), ('stage', stage)]:
            save(folder / (target + '-raw.json'), {'started': start, 'at': end, 'measuring': False,
                'rows': sorted(rows, key=lambda r: r['at']), 'events': [], 'errors': [],
                'channelStates': ['open'] if target == 'main' else [],
                'rms': [{'at': start + 1000, 'level': .2, 'rms': .14}] if target == 'main' else []})
        publish_summary(folder, job, start, end)
        save(folder / 'mailbox-config.json', {'enabled': True, 'effectiveMaxPending': 1, 'waitingCapacity': 1})
        save(folder / 'rtc-stats.json', [[{'type': 'candidate-pair', 'state': 'succeeded'}]])
        save(folder / 'debug-before.json', debug())
        save(folder / 'debug-after.json', debug())
        save(folder / 'drain-before-switch.json', drain(job['server'], start - 1000, initial=i == 0))
    save(root / 'identity.json', {'jobs': jobs, 'harness_sha256': files['app_batch.py'],
        'probe_sha256': files['app_probe.js'], 'fixture': {'vj0-ai-settings-storage': {'state': {
            'seed': 42, 'kleinSteps': 2, 'kleinAlpha': .1}}}})
    save(root / 'progress.json', [{'name': j['name'], 'config': j, 'status': 'measured'} for j in jobs])
    save(root / 'cleanup.json', {'status': 'pages-closed', 'errors': []})
    save(root / 'drain-before-switch.json', drain(jobs[-1]['server'], end + 1000))
    return sources / 'sources.json'


class N06Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name) / 'results'
        cls.sources = fixture(cls.root)
        cls.report = n06.aggregate(cls.root, cls.sources)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def mutate_trial(self, change, which=0):
        identity = audit.read(self.root / 'identity.json')
        job = identity['jobs'][which]
        folder = self.root / job['name']
        changed = change(folder)
        try:
            result = n06.audit_one(self.root, job, which, None)
        finally:
            for path, data in changed.items():
                path.write_bytes(data)
        return result

    def test_full_matrix_and_matched_ratios_not_ratios_of_medians(self):
        r = self.report
        self.assertEqual(r['status'], 'complete', r['common_errors'] or
                         [(t['name'], t['errors']) for t in r['trials'] if t['errors']])
        self.assertEqual(r['trial_status_counts'], {'passed': 36})
        self.assertEqual(len(r['cells']), 12)
        self.assertEqual(len(r['comparisons']), 9)
        c = r['comparisons'][0]
        self.assertEqual([p['metrics']['stage_fps']['ratio'] for p in c['pairs']], [2, 1, 3])
        self.assertEqual(c['aggregate']['stage_fps_ratio']['median'], 2)
        self.assertNotEqual(c['aggregate']['stage_fps_ratio']['median'], 8 / 6)
        scaling = r['comparisons'][2]
        self.assertEqual([p['metrics']['stage_fps']['ratio'] for p in scaling['pairs']], [1.5, 2, 1])
        self.assertEqual(scaling['aggregate']['stage_fps_ratio']['median'], 1.5)
        # A valid throughput gain with worse ages remains measured, not arbitrarily rejected.
        self.assertAlmostEqual(c['aggregate']['stage_age_ms']['p95']['delta']['median'], 50)
        self.assertEqual(r['cells'][0]['aggregate']['stage_fps'], {'n': 3, 'median': 6, 'min': 4, 'max': 8})

    def test_missing_trial_cannot_be_averaged_away(self):
        rows = {r['name']: copy.deepcopy(r) for r in self.report['trials']}
        rows.pop(n06.name(512, 1, 'baseline', 1))
        self.assertIsNone(n06.cell(rows, 512, 1, 'baseline', [])['aggregate'])
        c = n06.comparison(rows, 512, (1, 'terminal-noop'), (1, 'baseline'), 'bundle', [])
        self.assertIsNone(c['aggregate'])
        self.assertEqual([p['status'] for p in c['pairs']], ['complete', 'unavailable', 'complete'])

    def test_config_and_matrix_reject_duplicates_unbalanced_and_leakage(self):
        jobs = audit.read(self.root / 'identity.json')['jobs']
        self.assertFalse(n06.check_manifest(jobs))
        for mode in ('missing', 'duplicate', 'threshold', 'prompt'):
            bad = copy.deepcopy(jobs)
            if mode == 'missing': bad.pop()
            elif mode == 'duplicate': bad[-1] = bad[0]
            elif mode == 'threshold': bad[0]['thresholdBytes'] = 65536
            else: bad[0]['prompt'] = 'unmatched'
            self.assertTrue(n06.check_manifest(bad), mode)

    def test_source_hash_cleanup_and_barrier_are_required(self):
        identity = audit.read(self.root / 'identity.json')
        identity['probe_sha256'] = '0' * 64
        self.assertTrue(n06.source_check(identity, self.sources)['errors'])
        missing = drain('x', 100)
        missing.pop('ordered_barrier')
        self.assertEqual(n06.drain_check(missing, True, 'x')['status'], 'failed')
        blank = drain('x', 100, initial=True)
        self.assertEqual(n06.drain_check(blank, False, 'x')['status'], 'passed')
        self.assertEqual(n06.drain_check(blank, True, 'x')['status'], 'failed')
        self.assertEqual(n06.drain_check(drain('x', 100), True, 'x', lower=101)['status'], 'failed')
        path = self.root / 'cleanup.json'
        original = path.read_bytes()
        try:
            save(path, {'status': 'pages-closed', 'errors': ['target still open']})
            result = n06.aggregate(self.root, self.sources)
            self.assertEqual(result['status'], 'incomplete-or-failed')
            self.assertTrue(all(c['aggregate'] is None for c in result['cells']))
        finally:
            path.write_bytes(original)

    def test_raw_order_worker_identity_continuity_and_arithmetic_fail(self):
        def change(kind):
            def mutate(folder):
                path = folder / 'main-raw.json'
                original = path.read_bytes()
                raw = json.loads(original)
                if kind == 'order':
                    rows = [r for r in raw['rows'] if r['kind'] == 'received']
                    rows[1]['id'], rows[2]['id'] = rows[2]['id'], rows[1]['id']
                elif kind == 'worker':
                    for r in raw['rows']:
                        if r['kind'] == 'worker-stats': r['worker'] = 0
                elif kind == 'continuity':
                    raw['rows'] = [r for r in raw['rows'] if r['kind'] != 'worker-stats'
                                   or not raw['started'] + 10000 < r['at'] < raw['started'] + 14000]
                elif kind == 'capture':
                    rows = [r for r in raw['rows'] if r['kind'] == 'received']
                    rows[1]['ageMs'] = 2000
                else:
                    raw['at'] -= 1
                save(path, raw)
                return {path: original}
            return mutate
        for kind, message in [('order', 'ordering'), ('capture', 'ordering'),
                              ('worker', 'identity'), ('continuity', 'arrival gap'), ('arithmetic', 'arithmetic')]:
            with self.subTest(kind=kind):
                row = self.mutate_trial(change(kind), which=2)
                self.assertEqual(row['status'], 'failed')
                self.assertFalse(row['valid_for_descriptive'])
                self.assertIn(message, ' '.join(row['errors']))

    def test_both_admission_sites_and_age_arithmetic_required(self):
        for kind in ('site', 'age', 'unproven-continuity'):
            def change(folder):
                path = folder / 'summary.json'; data = path.read_bytes(); value = json.loads(data)
                if kind == 'site': value['input']['admission']['checks']['before-encode']['calls'] = 0
                elif kind == 'age': value['input']['surfaces'][n06.STAGE]['source_age_ms']['p99'] += 1
                else:
                    value['status'] = 'invalid'
                    value['problems'] = ['main: worker 0 had an output gap over two seconds']
                save(path, value)
                return {path: data}
            self.assertEqual(self.mutate_trial(change)['status'], 'failed')

    def test_multi_root_retains_continuity_and_connection_failures_without_reruns(self):
        with tempfile.TemporaryDirectory(prefix='n06-multiroot-') as directory:
            base = Path(directory)
            first, failed, remaining = (base / n for n in ('first', 'connection-failed', 'remaining'))
            sources = fixture(first)
            identity = audit.read(first / 'identity.json')
            jobs = identity['jobs']
            progress = audit.read(first / 'progress.json')
            first_job, next_job = jobs[:2]
            folder = first / first_job['name']
            original = audit.read(folder / 'summary.json')
            start, end = original['window_start'], original['window_end']
            # A real four-second delivery hole, fully retained in a 60s window.
            for target in ('main', 'stage'):
                path = folder / (target + '-raw.json'); raw = audit.read(path)
                raw['rows'] = [r for r in raw['rows'] if r['kind'] == 'sent'
                               or not start + 10000 < r['at'] < start + 14000]
                save(path, raw)
            publish_summary(folder, first_job, start, end)
            summary = audit.read(folder / 'summary.json')
            summary.update(status='invalid', problems=['main: worker 0 had an output gap over two seconds'])
            save(folder / 'summary.json', summary)
            progress[0]['status'] = 'invalid'
            remaining.mkdir()
            failed.mkdir()
            for job in jobs[1:]:
                shutil.move(str(first / job['name']), str(remaining / job['name']))
            final_drain = audit.read(first / 'drain-before-switch.json')
            save(first / 'progress.json', progress[:1])
            save(first / 'drain-before-switch.json', drain(first_job['server'], end + 1000))
            continuation_identity = {**identity, 'jobs': jobs[1:]}
            for root in (failed, remaining):
                save(root / 'identity.json', continuation_identity)
                save(root / 'cleanup.json', {'status': 'pages-closed', 'errors': []})
            save(remaining / 'progress.json', progress[1:])
            save(remaining / 'drain-before-switch.json', final_drain)
            next_start = audit.read(remaining / next_job['name'] / 'summary.json')['window_start']
            save(remaining / next_job['name'] / 'drain-before-switch.json',
                 drain(next_job['server'], next_start - 1000, initial=True))
            failure = {'name': next_job['name'], 'config': next_job, 'status': 'failed',
                       'error': 'channel did not open during setup'}
            save(failed / 'progress.json', [failure])
            save(failed / next_job['name'] / 'drain-before-switch.json',
                 drain(next_job['server'], end + 10000, initial=True))
            closed = drain(next_job['server'], end + 20000)
            closed.pop('ordered_barrier')
            closed['initial'].update(open=False, stopped=True)
            save(failed / 'drain-before-switch.json', closed)
            selection = base / 'selection-v1.json'
            manifest = {'jobs': jobs, 'cohort_roots': [str(p) for p in (first, failed, remaining)],
                        'trial_roots': {j['name']: str(first if i == 0 else remaining) for i, j in enumerate(jobs)}}
            save(selection, manifest)
            result = n06.aggregate(sources_path=sources, selection_path=selection)
            self.assertFalse(result['common_errors'], result['common_errors'])
            self.assertEqual(result['status'], 'complete-with-failed-outcomes')
            self.assertEqual(result['trial_status_counts'], {'continuity-failed': 1, 'passed': 35})
            self.assertTrue(result['validation_gates']['complete_36_valid_windows'])
            self.assertFalse(result['validation_gates']['all_trial_continuity_passed'])
            self.assertFalse(result['validation_gates']['no_failed_connection_or_setup_attempts'])
            self.assertEqual(len(result['failed_attempts']), 1)
            self.assertEqual(result['failed_attempts'][0]['progress'], failure)
            self.assertEqual(result['cells'][0]['status'], 'descriptive-with-failed-outcomes')
            self.assertEqual(result['cells'][0]['descriptive_trials'], 3)
            self.assertEqual(result['cells'][0]['aggregate']['stage_fps']['min'],
                             summary['input']['surfaces'][n06.STAGE]['unique_fps'])
            self.assertIsNotNone(result['comparisons'][0]['aggregate'])
            self.assertFalse(result['comparisons'][0]['all_trials_passed'])
            self.assertEqual(result['selection']['binding'], audit.binding(selection))
            with contextlib.redirect_stdout(io.StringIO()):
                code = n06.main(['--selection', str(selection), '--sources', str(sources),
                                 '--output', str(base / 'report.json')])
            self.assertEqual(code, 1)  # Valid negative outcomes cannot signal success.
            self.assertEqual(len((base / 'report.csv').read_text().splitlines()), 37)
            with self.assertRaises(ValueError):
                n06.write_report(result, remaining / 'overwrite.json')
            with self.assertRaises(ValueError):
                n06.write_report(result, selection)
            # A different cohort probe cannot be silently merged.
            save(remaining / 'identity.json', {**continuation_identity, 'probe_sha256': '0' * 64})
            mismatch = n06.aggregate(sources_path=sources, selection_path=selection)
            self.assertEqual(mismatch['status'], 'incomplete-or-failed')
            self.assertTrue(any('identities differ' in e for e in mismatch['common_errors']))
            self.assertTrue(all(c['aggregate'] is None for c in mismatch['cells']))
            save(remaining / 'identity.json', continuation_identity)
            # Re-running a timed failure remains forbidden even if selection
            # still points at the first negative record instead of the repeat.
            shutil.copytree(folder, remaining / first_job['name'])
            save(remaining / 'identity.json', identity)
            save(remaining / 'progress.json', progress)
            repeated = n06.aggregate(sources_path=sources, selection_path=selection)
            self.assertTrue(any('Previously timed cell was attempted again' in e for e in repeated['common_errors']))
            self.assertEqual(repeated['status'], 'incomplete-or-failed')

    def test_gzip_and_cli_outputs_preserve_inputs(self):
        path = self.root / n06.declared_order()[0] / 'main-raw.json'
        original = path.read_bytes()
        packed = Path(str(path) + '.gz')
        packed.write_bytes(gzip.compress(original))
        path.unlink()
        try:
            output = self.root.parent / 'report.json'
            with contextlib.redirect_stdout(io.StringIO()):
                status = n06.main(['--root', str(self.root), '--sources', str(self.sources), '--output', str(output)])
            self.assertEqual(status, 0)
            self.assertEqual(json.loads(output.read_text())['status'], 'complete')
            self.assertEqual(len(output.with_suffix('.csv').read_text().splitlines()), 37)
            self.assertFalse(path.exists())
            self.assertEqual(gzip.decompress(packed.read_bytes()), original)
            with self.assertRaises(ValueError):
                n06.write_report(self.report, self.root / 'unsafe.json', self.root)
        finally:
            packed.unlink()
            path.write_bytes(original)


if __name__ == '__main__':
    unittest.main()
