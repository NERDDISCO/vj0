import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class SummaryGate(unittest.TestCase):
    def run_case(self,status='measured',cleanup='pages-closed',barrier='passed',problems=None,selection=False,mismatch=False,unmatched=False,identity_mismatch=False,temporal_losses=None):
        with tempfile.TemporaryDirectory(prefix='vj0-input-summary-test-') as directory:
            root=Path(directory);jobs=[]
            for pair in range(3):
                for role in ['control','candidate']:
                    name=f'r{pair}-{role}';folder=root/name;folder.mkdir()
                    jobs.append({'name':name,'role':role,'pair':pair+3 if unmatched and role=='candidate' else pair,'comparison':'rate40','width':512,'height':288})
                    age={'p95':100 if role=='control' else 80,'p99':200,'max':300}
                    surface={'unique_fps':40,'source_age_ms':age,'fractions_older_than_ms':{},'output_gap_ms':{'max':50}}
                    summary={'status':status,'config':jobs[-1],'problems':problems or [],'input':{'surfaces':{'stage/webgl-frame-submitted':surface,
                        'main/sent':surface,'main/received':surface},'impulse_summary':{
                            'stage_unobserved_in_window':0,'stage_response_within_1000ms':18,
                            'count':18,'expected_count':18,'valid_indices':list(range(18)),
                            'invalid_indices':[],'censored_indices':[],'no_admitted_capture':0}}}
                    lost=(temporal_losses or {}).get((role,pair),0)
                    summary['input']['impulse_summary'].update(stage_response_within_1000ms=18-lost,
                        stage_unobserved_in_window=lost,no_admitted_capture=lost)
                    (folder/'summary.json').write_text(json.dumps(summary))
                    (folder/'drain-before-switch.json').write_text(json.dumps({'status':'drained','initial':{'open':True},
                        'ordered_barrier':{'ack':{'status':barrier}}}))
            identity={'jobs':jobs,'fixture':{},'harness_sha256':'a'*64,'probe_sha256':'b'*64}
            (root/'identity.json').write_text(json.dumps(identity))
            (root/'cleanup.json').write_text(json.dumps({'status':cleanup,'errors':[]}))
            source=['--results',str(root)]
            if selection:
                second=root/'other-cohort';second.mkdir()
                (second/'cleanup.json').write_text((root/'cleanup.json').read_text())
                other=dict(identity)
                if identity_mismatch:other['probe_sha256']='c'*64
                (second/'identity.json').write_text(json.dumps(other))
                moved=jobs[-1]['name'];(root/moved).rename(second/moved)
                if mismatch:jobs[-1]['sendFps']=17
                manifest={'jobs':jobs,'trial_roots':{j['name']:str(second if j['name']==moved else root) for j in jobs}}
                (root/'selection.json').write_text(json.dumps(manifest));source=['--selection',str(root/'selection.json')]
            subprocess.run([sys.executable,str(Path(__file__).with_name('summarize.py')),*source,
                            '--output',str(root/'summary-all.json')],check=True,capture_output=True)
            return json.loads((root/'summary-all.json').read_text())['comparisons']['rate40-512x288']

    def test_actual_measured_status_reaches_promotion_gates(self):
        result=self.run_case();self.assertTrue(result['decision'].startswith('eligible-for-expansion'))

    def test_invalid_trials_are_not_mixed_into_medians(self):
        self.assertNotIn('median_trials',self.run_case(status='invalid'))

    def test_continuity_failure_remains_a_negative_measured_outcome(self):
        result=self.run_case(status='invalid',problems=['main: worker 0 had an output gap over two seconds'])
        self.assertIn('median_trials',result)
        self.assertTrue(result['descriptive_medians_include_failed_outcome_trials'])
        self.assertFalse(result['gates']['all_trials_passed_continuity_and_structure'])
        self.assertTrue(result['decision'].startswith('not-promoted'))

    def test_explicit_cross_cohort_selection_and_configuration_guard(self):
        self.assertTrue(self.run_case(selection=True)['decision'].startswith('eligible-for-expansion'))
        with self.assertRaises(subprocess.CalledProcessError):self.run_case(selection=True,mismatch=True)
        with self.assertRaises(subprocess.CalledProcessError):self.run_case(selection=True,identity_mismatch=True)

    def test_equal_role_counts_do_not_allow_unmatched_pairs(self):
        result=self.run_case(selection=True,unmatched=True)
        self.assertFalse(result['matched_predeclared_pairs'])
        self.assertNotIn('median_trials',result)

    def test_median_equality_cannot_hide_additional_lost_impulses(self):
        result=self.run_case(temporal_losses={('control',0):1,('candidate',2):2})
        self.assertEqual(result['median_trials']['control']['impulses_within_1000ms'],18)
        self.assertEqual(result['median_trials']['candidate']['impulses_within_1000ms'],18)
        self.assertFalse(result['gates']['no_fewer_impulses_within_1000ms'])
        self.assertFalse(result['gates']['all_matched_pairs_preserve_temporal_response'])
        self.assertTrue(result['decision'].startswith('not-promoted'))

    def test_pooled_equality_cannot_hide_a_matched_pair_regression(self):
        result=self.run_case(temporal_losses={('control',0):1,('candidate',2):1})
        self.assertTrue(result['gates']['no_fewer_impulses_within_1000ms'])
        self.assertFalse(result['gates']['all_matched_pairs_preserve_temporal_response'])

    def test_cleanup_and_barrier_failure_prevent_promotion(self):
        for settings in [{'cleanup':'failed'},{'barrier':'failed'}]:
            with self.subTest(settings=settings):
                self.assertTrue(self.run_case(**settings)['decision'].startswith('not-promoted'))


if __name__=='__main__':unittest.main()
