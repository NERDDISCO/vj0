"""Additional N01/N02 freshness, continuity, byte and impulse measurements."""
from metrics import distribution


def summarize_input(raw, start, end, admission):
    seconds = (end-start)/1000
    result = {'admission':admission, 'surfaces':{}, 'impulses':[]}
    sent = [r for r in raw['main']['rows'] if r['kind']=='sent' and start<=r['at']<=end]
    maps = {}
    for target, kinds in [('main',['sent','received','preview-image-raf']),('stage',['webgl-frame-submitted'])]:
        for kind in kinds:
            rows = [r for r in raw[target]['rows'] if r['kind']==kind and start<=r['at']<=end]
            ages = [r['ageMs'] for r in rows if r.get('ageMs') is not None]
            gaps = [b['at']-a['at'] for a,b in zip(rows,rows[1:])]
            key = target+'/'+kind
            maps[key] = {r['id']:r for r in rows if r.get('id') is not None}
            result['surfaces'][key] = {
                'frames':len(rows), 'unique_fps':len(maps[key])/seconds,
                'bytes_per_second':sum(r.get('bytes',0) for r in rows)/seconds,
                'bytes':distribution([r['bytes'] for r in rows if 'bytes' in r]),
                'source_age_ms':distribution(ages), 'output_gap_ms':distribution(gaps),
                'boundary_gap_ms':max((rows[0]['at']-start,end-rows[-1]['at'])) if rows else end-start,
                'fractions_older_than_ms':{str(limit):sum(x>limit for x in ages)/len(ages) if ages else None
                                         for limit in [250,500,1000]},
                'missing_age_frames':sum(r.get('ageMs') is None for r in rows) if kind!='sent' else 0,
            }
    impulse_events = admission.get('impulses',[])
    for event in impulse_events:
        if event['kind']!='on':continue
        off = next((e for e in impulse_events if e['kind']=='off' and e['index']==event['index']),None)
        if not off:continue
        scheduled = [r for r in sent if r.get('audioLevel')==0.65 and
                    event['at']<=r.get('captureAt',r['at'])<off['at']]
        # Allow the analyser window to retain a burst briefly after gain-off.
        # This is a fixed input-waveform threshold, not a visual quality score.
        captured = [r for r in sent if r.get('inputRms') is not None and r['inputRms']>=0.25 and
                    event['at']<=r.get('captureAt',r['at'])<off['at']+250]
        observed_audio = [r['rms'] for r in admission.get('audioRms',[]) if event['at']<=r['at']<off['at']+250]
        ids = {r['id'] for r in captured}
        row = {'index':event['index'], 'duration_ms':off['at']-event['at'],
               'planned_duration_ms':event['durationMs'], 'timer_lateness_ms':event['at']-event['plannedAt'],
               'scheduled_capture_frames':len(scheduled),'captured_frames':len(ids),
               'analyser_peak_rms':max(observed_audio,default=None), 'capture_rms_threshold':0.25,
               'observation_remaining_ms':end-event['at'], 'responses':{}}
        for key in ['main/received','stage/webgl-frame-submitted']:
            delivered = [r for frame_id,r in maps[key].items() if frame_id in ids]
            delay = min((r['at']-event['at'] for r in delivered),default=None)
            row['responses'][key] = {'observed_frames':len(delivered),'first_response_ms':delay,
                                    'within_1000ms':delay is not None and delay<=1000}
        result['impulses'].append(row)
    pulses = result['impulses']
    result['impulse_summary'] = {'count':len(pulses),
        'no_admitted_capture':sum(r['captured_frames']==0 for r in pulses),
        'stage_response_within_1000ms':sum(r['responses']['stage/webgl-frame-submitted']['within_1000ms'] for r in pulses),
        'stage_unobserved_in_window':sum(r['responses']['stage/webgl-frame-submitted']['observed_frames']==0 for r in pulses),
        'meaning':'Impulse metadata follows encoded input through the actual model/output; not perceptual beat-strength equivalence.'}
    return result
