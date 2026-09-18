import sys
from pathlib import Path
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from input_metrics import summarize_input


class InputMetrics(unittest.TestCase):
    def test_actual_analyser_tail_can_carry_an_impulse_after_gain_off(self):
        raw={'main':{'rows':[
            {'kind':'sent','id':1,'at':160,'captureAt':150,'audioAt':145,'audioLevel':0.2,'inputRms':0.3,'bytes':100},
            {'kind':'received','id':1,'at':300,'ageMs':150,'bytes':200},
            {'kind':'preview-image-raf','id':1,'at':310,'ageMs':160}]},
            'stage':{'rows':[{'kind':'webgl-frame-submitted','id':1,'at':320,'ageMs':170}]}}
        admission={'plannedImpulses':[{'index':0,'plannedAt':100,'durationMs':40}],
                   'impulses':[{'kind':'on','index':0,'at':100,'plannedAt':100,'durationMs':40},
                               {'kind':'off','index':0,'at':140}],
                   'audioRms':[{'at':150,'rms':0.3}]}
        result=summarize_input(raw,0,2000,admission)
        pulse=result['impulses'][0]
        self.assertEqual(pulse['scheduled_capture_frames'],0)
        self.assertEqual(pulse['captured_frames'],1)
        self.assertEqual(pulse['responses']['stage/webgl-frame-submitted']['first_response_ms'],220)
        self.assertEqual(result['surfaces']['main/sent']['bytes_per_second'],50)

    def test_stale_rms_does_not_turn_into_a_delivered_current_impulse(self):
        raw={'main':{'rows':[{'kind':'sent','id':1,'at':160,'captureAt':150,'audioAt':0,
                             'inputRms':0.8,'bytes':100}]},'stage':{'rows':[]}}
        admission={'plannedImpulses':[{'index':0,'plannedAt':100,'durationMs':40}],
                   'impulses':[{'kind':'on','index':0,'at':100,'plannedAt':100,'durationMs':40},
                               {'kind':'off','index':0,'at':140}], 'audioRms':[{'at':145,'rms':0.1}]}
        result=summarize_input(raw,0,2000,admission)
        self.assertEqual(result['impulses'][0]['captured_frames'],0)
        admission['audioRms']=[]
        self.assertEqual(summarize_input(raw,0,2000,admission)['impulses'][0]['status'],'invalid')

    def test_late_and_missing_pulses_are_not_silently_dropped(self):
        admission={'plannedImpulses':[{'index':0,'plannedAt':900,'durationMs':40},
                                     {'index':1,'plannedAt':950,'durationMs':40}],
                   'impulses':[{'kind':'on','index':0,'at':900,'plannedAt':900,'durationMs':40},
                               {'kind':'off','index':0,'at':940}], 'audioRms':[]}
        result=summarize_input({'main':{'rows':[]},'stage':{'rows':[]}},0,1000,admission)
        self.assertEqual(result['impulse_summary']['censored_indices'],[0])
        self.assertEqual(result['impulse_summary']['invalid_indices'],[1])
        self.assertEqual(result['impulse_summary']['count'],0)

    def test_tail_fractions_and_gaps_include_all_observed_outputs(self):
        rows=[{'kind':'webgl-frame-submitted','id':i+1,'at':at,'ageMs':age}
              for i,(at,age) in enumerate([(100,100),(500,300),(2000,1100)])]
        result=summarize_input({'main':{'rows':[]},'stage':{'rows':rows}},0,3000,{})
        surface=result['surfaces']['stage/webgl-frame-submitted']
        self.assertEqual(surface['fractions_older_than_ms']['250'],2/3)
        self.assertEqual(surface['fractions_older_than_ms']['1000'],1/3)
        self.assertEqual(surface['output_gap_ms']['max'],1500)
        self.assertEqual(surface['unique_fps'],1)


if __name__=='__main__':unittest.main()
