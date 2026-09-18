"""CPU-only lifecycle tests: python3 -m unittest discover -s bench -p test_app_drain.py.

Exercise the actual nested harness helper with fake browser/server boundaries.
No browser, server, GPU, or wall-clock sleeps are required. AST extraction keeps
the tested drain implementation identical to app_batch.py without running main.
"""
import ast
import json
from pathlib import Path
import tempfile
import unittest


SOURCE = Path(__file__).with_name('app_batch.py')
TREE = ast.parse(SOURCE.read_text())
MAIN = next(n for n in TREE.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
DRAIN = next(n for n in MAIN.body if isinstance(n, ast.FunctionDef) and n.name == 'drain_before_navigation')


class Clock:
    def __init__(self):
        self.now = 0.0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class DrainTests(unittest.TestCase):
    def run_case(self, mode, expected_error=None):
        clock = Clock()
        state = {'stop': mode != 'blank-compile', 'observed_encode': False}
        calls = []

        def evaluate(target, expression):
            self.assertEqual(target, 'main')
            if 'url:location.href' in expression:
                blank = mode == 'blank-compile'
                return {'url': 'about:blank' if blank else 'http://app/vj-next',
                    'probe': not blank, 'open': not blank, 'stop': not blank,
                    'stopped': False, 'compileEvents': [],
                    'podUrl': None if blank else 'http://test/webrtc/offer'}
            if 'b.click()' in expression:
                self.assertTrue(state['observed_encode'])
                calls.append('stop')
                state['stop'] = False
                return None
            if 'pendingEncode:pending' in expression:
                return {'open': mode not in ['disconnect', 'blank-compile'],
                    'pendingEncode': int(mode == 'encoder' and clock.now < 1),
                    'stopped': not state['stop'],
                    'activity': 1 if clock.now < 0.3 else 2,
                    'compileOverlay': mode == 'compile', 'compileEvents': []}
            if expression == 'window.vj0AppProbe.begin()':
                calls.append('probe-begin')
                return None
            self.fail('Unexpected browser operation: '+expression)

        def wait_for(target, expression, timeout):
            self.assertEqual(target, 'main')
            if "r.findIndex(x=>x.kind==='encode-start')" in expression:
                state['observed_encode'] = True
                calls.append('fresh-encode')
            elif "some(b=>b.textContent.trim()==='■ stop')" in expression:
                self.assertFalse(state['stop'])
            else:
                self.fail('Unexpected browser wait: '+expression)

        def debug_snapshot(server):
            self.assertEqual(server, 'http://test')
            self.assertFalse(state['stop'], 'Actual Stop must precede drain polling')
            calls.append('debug')
            return {'stats': {'framesFromClient': 10 if clock.now < 0.4 else 11},
                'workers': [{'ready': True,
                    'framePending': int(mode == 'pending' or clock.now < 0.5),
                    'compileStartedAt': 123 if mode == 'blank-compile' else 0}],
                'channel': {'readyState': 'open'}}

        scope = {'evaluate': evaluate, 'debug_snapshot': debug_snapshot,
                 'wait_for': wait_for, 'time': clock, 'json': json}
        exec(compile(ast.Module(body=[DRAIN], type_ignores=[]), str(SOURCE), 'exec'), scope)
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            if expected_error:
                with self.assertRaises(expected_error):
                    scope['drain_before_navigation'](folder, 'http://test')
            else:
                scope['drain_before_navigation'](folder, 'http://test')
            evidence = json.loads((folder/'drain-before-switch.json').read_text())
        self.assertEqual(evidence['status'], 'failed' if expected_error else 'drained')
        if not expected_error:
            self.assertGreaterEqual(evidence['quiet_observed_ms'], 500)
            self.assertEqual(calls[:3], ['probe-begin', 'fresh-encode', 'stop'])
        return clock.now, evidence

    def test_waits_for_worker_completion_then_full_quiet_interval(self):
        elapsed, _ = self.run_case('normal')
        self.assertGreaterEqual(elapsed, 1.0)
        self.assertLess(elapsed, 2.0)

    def test_pending_encoder_delays_quiet_interval_even_with_idle_workers(self):
        elapsed, _ = self.run_case('encoder')
        self.assertGreaterEqual(elapsed, 1.5)
        self.assertLess(elapsed, 2.0)

    def test_lost_old_channel_fails_instead_of_trusting_reset_pending(self):
        elapsed, evidence = self.run_case('disconnect', RuntimeError)
        self.assertEqual(elapsed, 0)
        self.assertIn('Channel closed', evidence['error'])

    def test_stalled_request_times_out_before_policy_switch(self):
        elapsed, _ = self.run_case('pending', TimeoutError)
        self.assertGreaterEqual(elapsed, 30)

    def test_stalled_compile_overlay_times_out(self):
        elapsed, _ = self.run_case('compile', TimeoutError)
        self.assertGreaterEqual(elapsed, 30)

    def test_initial_blank_still_waits_for_server_compile_counter(self):
        elapsed, evidence = self.run_case('blank-compile', TimeoutError)
        self.assertGreaterEqual(elapsed, 30)
        self.assertEqual(evidence['action'], 'no-active-capture-page')


if __name__ == '__main__':
    unittest.main()
