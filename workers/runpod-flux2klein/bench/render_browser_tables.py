#!/usr/bin/env python3
from pathlib import Path
import json,csv,hashlib,collections
import argparse
parser=argparse.ArgumentParser(description='Render per-trial browser tables from the validated measurement index')
parser.add_argument('--root',type=Path,required=True)
parser.add_argument('--index',type=Path,required=True)
a=parser.parse_args()
root=a.root;index=json.loads(a.index.read_text());rows=index['browser']
fields=['artifact','artifact_sha256','status','error','width','height','steps','input_quality','output_quality','mode','variant','active_workers','pending_per_worker','received_fps','drawn_fps','elapsed_seconds','capture_to_draw_p50_ms','capture_to_draw_p95_ms','capture_to_draw_p99_ms','worker_queue_p95_ms','worker_total_p95_ms','input_mbps','output_mbps','received_frames','drawn_frames','decode_skips','encode_skips','input_buffer_skips','output_buffer_drops','measurement','frame_age','config_json','counts_json','server_counters_json','transport_json','observed_variants_json']
def val(d,*keys):
 for key in keys:
  if not isinstance(d,dict):return None
  d=d.get(key)
 return d
def fmt(v):return '—' if v is None else f'{v:.2f}' if isinstance(v,(int,float)) else str(v)
def add_validation(row, result):
 assessment=result.get('derivedAssessment') or {}
 continuity=result.get('continuity') or {}
 row.update(measurement_status=assessment.get('measurement_status',result.get('status')),
  continuity_status=assessment.get('continuity_status',continuity.get('status')),
  validation_status=assessment.get('validation_status',result.get('validationStatus')),
  assessment_json=json.dumps(assessment,separators=(',',':')))
 return row

def status_text(result):
 text=str(result.get('status'))
 if result.get('derivedAssessment'):
  return text+'; measured data, continuity failed (audited)'
 if (result.get('continuity') or {}).get('status')=='failed':
  return text+'; continuity failed'
 return text

with (root/'browser-results.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,fieldnames=fields+["measurement_status","continuity_status","validation_status","assessment_json"],lineterminator="\n");w.writeheader()
 for r in rows:
  c=r.get('config') or {};counts=r.get('counts') or {};s=c.get('serverConfig') or {};d=r.get('distributions') or {};sc=r.get('serverCounters') or {}
  w.writerow(add_validation(dict(zip(fields,[r['artifact'],hashlib.sha256((root/r['artifact']).read_bytes()).hexdigest(),r.get('status'),r.get('error'),c.get('width'),c.get('height'),c.get('steps'),c.get('inputQuality'),c.get('outputQuality'),c.get('mode'),s.get('benchmarkVariant'),s.get('activeWorkers'),s.get('maxPending'),r.get('receivedFps'),r.get('decodedDrawnFps'),r.get('elapsedSeconds'),val(d,'captureToDrawMs','p50'),val(d,'captureToDrawMs','p95'),val(d,'captureToDrawMs','p99'),val(d,'workerQueueMs','p95'),val(d,'workerTimingMs','p95'),r.get('outboundMbps'),r.get('inboundMbps'),counts.get('received'),counts.get('decodedDrawn'),counts.get('decodeSkips'),counts.get('encodeSkips'),counts.get('sendBufferSkips'),val(sc,'deltas','droppedOutbound'),r.get('measurement'),r.get('frameAge'),json.dumps(c,separators=(',',':')),json.dumps(counts,separators=(',',':')),json.dumps(sc,separators=(',',':')),json.dumps(r.get('transport'),separators=(',',':')),json.dumps(r.get('workerVariants'),separators=(',',':'))])),r))
lines=['# Browser transport measurements — 2026-09-17','','This table preserves each trial separately. It does not pool different batches, native WebRTC libraries, stacks, settings or models. The [CSV](browser-results.csv) includes exact rates, p50/p95/p99 frame age, queue time where instrumented, bandwidth, drop counters, source hashes and full configurations. Raw JSON and each batch\'s jobs/run identity retain the remaining evidence.','','Received FPS counts generated JPEG responses. Drawn FPS counts successful browser offscreen 2D draws; it excludes the application upscaler/projector, audio capture, physical display and compositor presentation. Frame age uses the client clock and starts before drawing the synthetic input fixture and encoding its JPEG. Untagged streaming runs have unknown frame age. Same-host and actual-app measurements are separate. Percentiles summarize observed frames, not all submitted/dropped inputs.','','One earlier WebRTC-upgrade trial overlapped a local build and is explicitly excluded, with its replacement identified in [measurement-exclusions.json](measurement-exclusions.json). The interrupted pre-watchdog-fix scaling batch retains seven complete trials and its warmup failure; later corrected-service repetitions form a separate batch. Real network latency spikes are retained.','','`Input/Output Mbps` are client upload/download. A dash means unmeasured or unavailable. Trials failing before measurement have no throughput number. Quantified continuity failures retain their rates and are marked separately; they remain ineligible for acceptance. Hash-bound assessments preserve the original raw status/errors. The p95 and p99 values are capture-to-offscreen-draw ages, unless the raw record explicitly describes its single-flight measurement.','']
groups=collections.defaultdict(list)
for r in rows:groups[str(Path(r['artifact']).parent)].append(r)
for name,rs in groups.items():
 lines+=['## '+('Initial and recovery baselines' if name=='.' else name),'','| Trial | Status | Received FPS | Drawn FPS | Age p95 ms | Age p99 ms | Queue p95 ms | Input / output Mbps |','|---|---|---:|---:|---:|---:|---:|---:|']
 for r in rs:
  d=r.get('distributions') or {};a=r['artifact'];lines.append('| ['+Path(a).stem+']('+a+') | '+status_text(r)+' | '+' | '.join(fmt(x) for x in [r.get('receivedFps'),r.get('decodedDrawnFps'),val(d,'captureToDrawMs','p95'),val(d,'captureToDrawMs','p99'),val(d,'workerQueueMs','p95')])+' | '+fmt(r.get('outboundMbps'))+' / '+fmt(r.get('inboundMbps'))+' |')
 lines.append('')
(root/'BROWSER.md').write_text('\n'.join(lines)+'\n');print('browser rows',len(rows))
