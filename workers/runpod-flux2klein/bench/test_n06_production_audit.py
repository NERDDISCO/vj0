"""Offline regression fixtures from the retained complete production proof."""
import copy
import gzip
import json
from pathlib import Path
import tempfile
import unittest

import audit_n06_production as audit


class N06ProductionAuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = Path(__file__).resolve().parents[3] / 'docs/performance/2026-09-17/terminal-production-proof'
        cls.old_result = json.loads(gzip.decompress((cls.original / 'result.json.gz').read_bytes()))
        assert cls.old_result['status'] == 'complete'
        assert sum(r['status'] == 'profile' for r in cls.old_result['records']) == 2

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='vj0-test-n06-production-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'proof'
        self.root.mkdir()
        # Only the declared profile omission changes the retained result.
        # All quality/timing rows and saved image bytes stay untouched.
        self.result = copy.deepcopy(self.old_result)
        self.result['arguments']['skip_profiles'] = True
        self.result['records'] = [r for r in self.result['records'] if r['status'] != 'profile']
        for path in self.original.glob('*.png'):
            (self.root / path.name).write_bytes(path.read_bytes())
        args = self.result['arguments']
        self.runner = {'status': 'complete', 'exit_code': 0, 'result_status': 'complete',
                       'sources': audit.EXPECTED_SOURCES,
                       'argv': ['/example/env/bin/python', str(Path(args['worker_script']).parent / 'bench/bench_post_live.py'),
                                '--worker-script', args['worker_script'], '--output', args['output'],
                                '--frames', '100', '--pairs', '3', '--warmup', '4',
                                '--expected-native-threads', '128', '--skip-profiles']}
        self.runner_path = Path(self.temporary.name) / 'runner.json'

    def run_audit(self):
        (self.root / 'result.json').write_text(json.dumps(self.result))
        self.runner_path.write_text(json.dumps(self.runner))
        return audit.audit(self.root, self.runner_path)

    def test_declared_profile_omission_keeps_original_failure(self):
        out = self.run_audit()
        self.assertEqual(out['status'], 'passed-quality-timing-only', out['errors'])
        self.assertEqual(out['original_auditor']['status'], 'failed')
        self.assertEqual(out['original_auditor']['errors'], [audit.MISSING_PROFILES])
        self.assertEqual(out['original_auditor']['quality_fixtures'], 27)
        self.assertEqual(out['original_auditor']['same_tensor_cast_checks'], 54)
        self.assertEqual(out['original_auditor']['record_counts']['compute-measured'], 18)
        self.assertFalse((audit.DEFAULT_FROZEN / 'sources.json').exists())

    def test_missing_quality_is_not_reclassified_as_pass(self):
        row = next(r for r in self.result['records'] if r['status'] == 'quality')
        self.result['records'].remove(row)
        out = self.run_audit()
        self.assertEqual(out['status'], 'failed')
        self.assertIn('Quality matrix incomplete or duplicated', out['original_auditor']['errors'])

    def test_wrong_launch_argv_rejected(self):
        self.runner['argv'].remove('--skip-profiles')
        out = self.run_audit()
        self.assertEqual(out['status'], 'failed')
        self.assertIsNone(out['original_auditor'])

    def test_result_must_declare_omission(self):
        self.result['arguments']['skip_profiles'] = False
        self.assertEqual(self.run_audit()['status'], 'failed')

    def test_timing_arithmetic_remains_mandatory(self):
        row = next(r for r in self.result['records'] if r['status'] == 'compute-measured')
        row['fps'] *= 1.1
        out = self.run_audit()
        self.assertEqual(out['status'], 'failed')
        self.assertTrue(any('FPS arithmetic mismatch' in e for e in out['original_auditor']['errors']))

    def test_pixels_remain_exact(self):
        image = next(self.root.glob('*-optimized.png'))
        image.write_bytes(image.read_bytes() + b'changed')
        out = self.run_audit()
        self.assertEqual(out['status'], 'failed')
        self.assertTrue(any('Saved PNG bytes differ' in e for e in out['original_auditor']['errors']))

    def test_failed_runner_and_wrong_sources_rejected(self):
        self.runner['exit_code'] = 1
        self.runner['sources'] = {**audit.EXPECTED_SOURCES, 'bench/metrics.py': '0' * 64}
        out = self.run_audit()
        self.assertEqual(out['status'], 'failed')
        self.assertGreaterEqual(len(out['errors']), 2)

    def test_unexpected_profile_artifact_rejected(self):
        (self.root / 'profile-unexpected.json.gz').write_bytes(b'not evidence')
        self.assertEqual(self.run_audit()['status'], 'failed')

    def test_duplicate_argv_rejected(self):
        self.runner['argv'] += ['--frames', '100']
        self.assertEqual(self.run_audit()['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
