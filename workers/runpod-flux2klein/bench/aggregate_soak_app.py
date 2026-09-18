#!/usr/bin/env python3
"""Create a compact review of a separately audited, completed soak cohort."""
import argparse,csv,hashlib,json
from pathlib import Path

p=argparse.ArgumentParser(description=__doc__);p.add_argument('--audit',type=Path,required=True);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
a=json.loads(args.audit.read_text())
assert a['status']=='complete_passed' and a['completed_summaries']==a['planned_trials']==2
assert a['cleanup']=={'status':'pages-closed','errors':[]}
rows=[];trials=[]
for t in a['trials']:
 assert t['audit_status']=='passed' and t['config']['seconds']==180
 for key,b in t['boundaries'].items():
  assert abs(b['unique_frames']/t['elapsed_seconds']-b['fps'])<1e-10
  row={'trial':t['name'],'boundary':key,'frames':b['unique_frames'],'seconds':t['elapsed_seconds'],'fps':b['fps'],
       'p50_age_ms':b['age_ms']['p50'],'p95_age_ms':b['age_ms']['p95'],'p99_age_ms':b['age_ms']['p99'],'max_age_ms':b['age_ms']['max'],
       'max_gap_ms':b['max_event_gap_ms'],'final_silence_ms':b['final_silence_ms']}
  row.update({'percent_over_'+k+'ms':v['percent'] for k,v in b['age_over_ms'].items()});rows.append(row)
 trials.append({k:t[k] for k in ('name','config','elapsed_seconds','audit_status','boundaries','worker_activity','audio_rms','ordering','renderer','episodes','stress')})
control=next(t for t in trials if not t['config']['mailbox'])
mailbox=next(t for t in trials if t['config']['mailbox'])
control_age=control['boundaries']['stage/webgl-frame-submitted']['age_ms']
mailbox_age=mailbox['boundaries']['stage/webgl-frame-submitted']['age_ms']
assert all(t['config']['width']==768 and t['config']['height']==448 and t['config']['workerThreads']==128 and t['config']['activeWorkers']==1 for t in trials)
assert all(t['renderer']['viewport']==[1920,1080] and t['renderer']['glBuffer']==[2304,1344] for t in trials)
stress=next(t['stress'] for t in trials if t['stress'])
assert stress['status']=='passed' and not stress['independent_errors']
actions=stress['raw_result']['actions']
assert len(actions)==10
result={'status':'passed_with_all_age_tails_retained','cohort':'Separate two-trial rotating-audio soak cohort; not additional formal repeats',
 'input_audit':str(args.audit),'input_audit_sha256':hashlib.sha256(args.audit.read_bytes()).hexdigest(),
 'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'trials':trials,'cleanup':a['cleanup'],
 'stress_actions':actions,'stress_counts':{k:v['events'] for k,v in stress['boundaries'].items()},
 'limitations':['The two 180-second runs are sequential, with one observation per policy and changing audio levels. They cannot establish a general causal tail improvement.',
  'The 1920x1080 stage viewport used a 2304x1344 WebGL buffer at 768x448 input. Stage submissions and preview RAF observations are not physical display presentation.',
  'Stress uses separate main and stage windows and includes deliberate disconnects. Its event rates and long gaps are not steady-state FPS or continuity failures.',
  'Settings-to-subsequent-capture receipt proves a newer capture, not which model prompt revision produced the image or semantic adherence.',
  'Reconnect times include app signaling, control flow and generation until a new captured frame arrives; they are not network handshake-only times.',
  'Inter-trial drain establishes observed encoder/worker quiescence, not complete SCTP drain. Epochs and warmup mitigate stale-session effects without proving contamination or its absence.']}
args.output.write_text(json.dumps(result,indent=2)+'\n')
with args.output.with_suffix('.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,fieldnames=list(rows[0]),lineterminator='\n');w.writeheader();w.writerows(rows)
lines=['# Separate app soak audit','','Both 180-second rotating-audio windows, the subsequent lifecycle stress test and final cleanup passed. All age outliers remain included. These two observations are separate from the 18-trial formal cohort.','',
 '| Policy | Observed seconds | Input / receive / preview RAF / stage FPS | Stage p50 / p95 / p99 / max age ms | Stage >250 / >500 / >1000 ms % |','|---|---:|---:|---:|---:|']
for t in trials:
 b=t['boundaries'];stage=b['stage/webgl-frame-submitted'];rates=' / '.join(f"{b[k]['fps']:.3f}" for k in ('main/sent','main/received','main/preview-image-raf','stage/webgl-frame-submitted'))
 ages=' / '.join(f"{stage['age_ms'][k]:.2f}" for k in ('p50','p95','p99','max'));tail=' / '.join(f"{stage['age_over_ms'][str(k)]['percent']:.4f}" for k in (250,500,1000))
 lines.append(f"| {'Latest-input mailbox' if t['config']['mailbox'] else 'Compute/capture, mailbox off'} | {t['elapsed_seconds']:.6f} | {rates} | {ages} | {tail} |")
lines+=['',f"Mailbox stage p95/p99 in this pair are {mailbox_age['p95']:.2f}/{mailbox_age['p99']:.2f} ms versus {control_age['p95']:.2f}/{control_age['p99']:.2f} ms with the mailbox off; mailbox maximum age remains {mailbox_age['max']/1000:.3f} seconds. These separate observations do not override the formal cohort.",'',
 'Actual analyser RMS medians for requested levels 0 / 0.2 / 0.6:','']
for t in trials:lines.append('- '+t['name']+': '+' / '.join(f"{t['audio_rms'][str(v)]['p50']:.6f}" for v in (0,0.2,0.6)))
lines+=['','Received, preview and stage IDs and reconstructed capture timestamps are strictly increasing within each target measurement window, with no missing IDs or duplicates. Worker 0 provided the requested native 128-thread, terminal-skip, GPU-output-cast telemetry; maximum steady worker-stat arrival gaps were '+ ' / '.join(str(t['worker_activity']['0']['max_gap_ms']) for t in trials)+' ms.','',
 'Stress retained '+ ' / '.join(str(v) for v in result['stress_counts'].values())+' receive / preview RAF / stage observations in separate target windows. It completed three prompt changes, three resolution changes returning to 768x448, ten rapid prompt inputs with the final cue observed, and three reconnects. Source IDs and reconstructed capture timestamps stayed ordered.','',
 'Settings-to-subsequent-capture receipt: '+' / '.join(f"{v['settings_to_new_capture_receive_ms']:.3f}" for v in actions if v['action']=='prompt')+' ms. Connect-click-to-new-capture receipt: '+' / '.join(f"{v['reconnect_to_new_capture_receive_ms']/1000:.4f}" for v in actions if v['action']=='reconnect')+' seconds.','']
for limitation in result['limitations']:lines.extend([limitation,''])
args.output.with_suffix('.md').write_text('\n'.join(lines)+'\n')
print(result['status'],len(rows),'steady boundary rows')
