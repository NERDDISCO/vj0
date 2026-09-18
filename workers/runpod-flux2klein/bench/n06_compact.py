#!/usr/bin/env python3
"""Extract compact N06 results from the audited report and saved hold/lifecycle."""
import argparse
import csv
import gzip
import hashlib
import json
from pathlib import Path
import statistics


def read(path):
    if not path.exists():
        path = Path(str(path) + '.gz')
    data = path.read_bytes()
    return json.loads(gzip.decompress(data) if path.suffix == '.gz' else data)


def spread(values):
    return {'n': len(values), 'median': statistics.median(values),
            'min': min(values), 'max': max(values)}


def compact(report, base):
    assert report['declared_trials'] == report['expected_trials'] == 36
    assert not report['common_errors']
    assert len(report['trials']) == 36
    trials = []
    for t in report['trials']:
        a = t['audit']
        trials.append({
            'name': t['name'], 'config': t['config'], 'status': t['status'],
            'errors': t['errors'], 'valid_for_descriptive': t['valid_for_descriptive'],
            'seconds': a['elapsed_seconds'], 'source_summary': t['source_summary'],
            'summary_binding': t['summary_binding'], 'metrics': t['metrics'],
            'encode_done_ms': t['reported_targets']['main']['encode-done']['duration_ms'],
            'worker_activity': a['worker_activity'], 'worker_timings': a['worker_timings'],
            'source_order': a['ordering'],
            'pulse_source_delivery': t['input_evidence']['impulse_summary'],
            'transition_status': t['transition']['status'],
        })
    cells = []
    for cell in report['cells']:
        rows = [t for t in trials if t['name'] in cell['trials']]
        assert len(rows) == 3 and all(t['valid_for_descriptive'] for t in rows)
        value = dict(cell)
        value['encode_done_ms'] = {k: spread([t['encode_done_ms'][k] for t in rows])
                                   for k in ('p50', 'p95', 'p99', 'max')}
        value['pulse_source_delivery'] = {k: sum(t['pulse_source_delivery'][k] for t in rows)
            for k in ('expected_count', 'count', 'no_admitted_capture',
                      'stage_response_within_1000ms', 'stage_unobserved_in_window')}
        cells.append(value)
    hold_dir = base / 'archived-cohorts/hold-01/n06-768-workers2-selected-hold'
    h = read(hold_dir / 'summary.json')
    hold = {k: h[k] for k in ('config', 'status', 'problems', 'seconds', 'source_order', 'worker_activity')}
    hold.update(surfaces=h['input']['surfaces'], pulse_source_delivery=h['input']['impulse_summary'],
                encode_done_ms=h['targets']['main']['encode-done']['duration_ms'],
                cleanup=read(base/'archived-cohorts/hold-01/cleanup.json'),
                ordered_barrier=read(base/'archived-cohorts/hold-01/drain-before-switch.json')['ordered_barrier']['ack'])
    life = read(base/'archived-cohorts/lifecycle-contingency-01/n06-lifecycle-after-failed-hold/stress.json')
    return {'schema': 'n06-compact-v1', 'status': report['status'],
            'eligibility': report['eligibility'], 'trial_status_counts': report['trial_status_counts'],
            'common_errors': report['common_errors'], 'failed_attempts': report['failed_attempts'],
            'validation_gates': report['validation_gates'], 'source_identity': report['source_identity'],
            'analysis_sources': report['analysis_sources'], 'cells': cells,
            'comparisons': report['comparisons'], 'trials': trials, 'hold': hold,
            'lifecycle': life, 'limitations': report['limitations']}


def fmt(value):
    return f"{value['median']:.2f} [{value['min']:.2f}–{value['max']:.2f}]"


def markdown(d):
    lines = [
        '# N06: app throughput, two workers, and lifecycle — 18 September 2026', '',
        '**The selected bundle improves throughput, but the complete matrix and 10-minute hold fail the declared continuity requirement.** All 36 planned windows remain included: 35 passed and one complete continuity-negative result. The hold also failed continuity. The separate, predeclared lifecycle contingency passed all 10 actions. There were no N06 connection/setup failures or timed reruns.', '',
        'The baseline uses original compute with wall-clock stage timing, CPU output cast and terminal skip off. The selected bundle uses the previously tested compute path, CUDA-event stage timing, GPU output cast and terminal skip. Both use native 128 threads, the same FP8 model, two denoising steps, alpha 0.1, seed 42, mailbox on, max pending 3, requested input 60 FPS, 256 KiB admission threshold, JPEG 85 input and JPEG 80 output. No N01–N05 candidate was combined. One versus two means active workers on the same two-GPU host, with both models loaded.', '',
        'Each cell contains three sequential 60-second windows. Values below are median [minimum–maximum] across trials; age columns are medians of trial percentiles, not pooled percentiles. All failed outcomes remain in descriptive statistics. Stage FPS means unique source frames submitted to WebGL, not physical monitor presentation. Resolution refers to generated images, not the larger stage canvas.', '',
        '| Output | Workers | Bundle | Sent FPS (target 60) | Stage FPS | Source age p50 / p95 / p99 ms | Worst source age ms | Timely pulse lineage |',
        '|---|---:|---|---|---|---|---:|---|',
    ]
    for c in d['cells']:
        a=c['aggregate']; pulses=c['pulse_source_delivery']
        ages=' / '.join(f"{a['stage_age_ms'][k]['median']:.1f}" for k in ('p50','p95','p99'))
        label='baseline' if c['variant']=='baseline' else 'selected'
        if not c['all_trials_passed']: label+=' (continuity failed)'
        lines.append(f"| {c['width']} × {c['height']} | {c['active_workers']} | {label} | {fmt(a['achieved_input_fps'])} | {fmt(a['stage_fps'])} | {ages} | {a['worst_stage_age_ms']:.1f} | {pulses['stage_response_within_1000ms']}/{pulses['expected_count']} |")
    lines += ['', 'Paired gains are calculated within each repeat before taking the median and range. They are not ratios of the cell medians.', '',
              '| Output | Comparison | Paired FPS ratio, median [range] |', '|---|---|---|']
    for c in d['comparisons']:
        label=c['comparison']+(' (includes continuity failure)' if not c['all_trials_passed'] else '')
        lines.append(f"| {c['width']} × {c['height']} | {label} | {fmt(c['aggregate']['stage_fps_ratio'])} |")
    lines += ['', 'The 512 × 288 two-worker bundle gain is variable (one paired ratio is below 1). Two workers improve 768 × 448 and 1024 × 576 throughput, but scaling does not establish stable delivery: the final 1024 selected trial has worker gaps of 2076.6 and 3490.5 ms, an overall stage gap of 1970.9 ms, p95/p99 source ages of 2743.8/5676.2 ms and a 7122.1 ms maximum. Other tails remain visible: the 768 two-worker selected repeat 1 has p95/p99 ages of 1189.2/1363.6 ms. The median is not the worst trial.', '',
        'The 600.541-second 768 × 448 two-worker selected hold delivered 36.354 stage FPS. Source age was p50 113.6 ms, p95 162.4 ms, p99 767.5 ms, maximum 4139.8 ms. Worker gaps reached 2038.1 and 2008.5 ms; the overall stage gap reached 2005.9 ms. Its continuity gate failed. Of 199 pulsed inputs, 194 had timely source-frame lineage within 1 second; four were unobserved in the window, including three with no admitted capture, and one additional observed response was later than 1 second. These overlapping counts must not be added as independent losses.', '',
        'Pulse checks track a sampled pulsed input through source IDs to output delivery. They do not assess perceptual beat strength, artistic responsiveness, or prompt correctness. No invalid or censored pulse was silently removed; per-trial pulse records are preserved.', '',
        'The declared lifecycle contingency used a separate excluded 8-second qualification, then passed three prompt changes, three resolution changes, ten rapid prompts, and three intentional disconnect/reconnect cycles. Reconnect-to-new-capture receive took 11.270, 11.228 and 11.193 seconds. These are startup times, distinct from steady-state frame age. The lifecycle pass does not repair the failed hold. Final ordered nonce ACKs and cleanup passed after matrix, hold and lifecycle; safe drain is separate from continuity performance.', '',
        'Input encoding callback durations are retained below. They include browser scheduling and are evidence of occupied capture time, not an isolated JPEG CPU benchmark. The formal browser was Chrome 149 headless with Metal on the M4; unrelated user browser/OBS workloads were left running. Earlier bounded qualification found headed rendering at the physical main display’s 30 Hz versus headless 60 Hz. Neither target input FPS nor headless WebGL submission guarantees the monitor presents that many distinct frames.', '',
        '| Output | Workers | Bundle | Encode callback p50 ms, median [range] | Encode callback p95 ms, median [range] |',
        '|---|---:|---|---|---|']
    for c in d['cells']:
        lines.append(f"| {c['width']} × {c['height']} | {c['active_workers']} | {'baseline' if c['variant']=='baseline' else 'selected'} | {fmt(c['encode_done_ms']['p50'])} | {fmt(c['encode_done_ms']['p95'])} |")
    lines += ['', 'The production proof establishes within-process equivalence for terminal skip/output cast. It does not prove full wrapper, cross-worker or cross-stack pixel equivalence. All nine old/new-stack image pairs were non-exact, with hardware, process and dependency confounds; broad style similarity is not artistic acceptance. This N06 matrix measures throughput, latency and lifecycle on the newer stack. Source images and output snapshots remain archived for visual review. No production defaults or UI were changed by this matrix.', '',
        'Evidence: [compact full-precision JSON](metrics-compact-v1.json), [per-trial CSV](metrics-compact-v1.csv), [archived selection](selection-archived-v1.json), [original immutable selection](selection-v1.json), [archive-only verification](archive-only-validation.json), and [full archived audit](archived-reports/results-archived-v1.json.gz). The original 112 MB audit is preserved byte-for-byte in [the original-report archive](archived-browser-evidence/results-matrix-v1.json.gz). All four cohorts, including excluded qualifications, lifecycle raw events and JPEG snapshots, are in [archived-cohorts](archived-cohorts). [Protected input prefix proof](archived-browser-evidence/protected-input-prefix-proof.json) binds the appended interception suffix without altering prior input evidence. Remote preservation and pod shutdown are recorded separately by the root agent.', '']
    return '\n'.join(lines)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--report',type=Path,required=True)
    p.add_argument('--base',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args(); d=compact(read(a.report),a.base)
    a.output.mkdir(parents=True,exist_ok=True)
    (a.output/'metrics-compact-v1.json').write_text(json.dumps(d,indent=2)+'\n')
    (a.output/'RESULTS.md').write_text(markdown(d))
    rows=[]
    for t in d['trials']:
        m=t['metrics']; stage=m['stage/webgl-frame-submitted']; pulses=t['pulse_source_delivery']
        rows.append(dict(name=t['name'],status=t['status'],width=t['config']['width'],height=t['config']['height'],
            workers=t['config']['activeWorkers'],variant=t['config']['variant'],seconds=t['seconds'],
            sent_fps=m['main/sent']['fps'],received_fps=m['main/received']['fps'],stage_fps=stage['fps'],
            age_p50_ms=stage['age_ms']['p50'],age_p95_ms=stage['age_ms']['p95'],age_p99_ms=stage['age_ms']['p99'],
            age_max_ms=stage['age_ms']['max'],stage_gap_max_ms=stage['max_event_gap_ms'],
            worker_gap_max_ms=max(x['max_gap_ms'] for x in t['worker_activity'].values()),
            encode_p50_ms=t['encode_done_ms']['p50'],encode_p95_ms=t['encode_done_ms']['p95'],
            pulses=pulses['expected_count'],timely_pulses=pulses['stage_response_within_1000ms'],
            uncaptured_pulses=pulses['no_admitted_capture'],unobserved_pulses=pulses['stage_unobserved_in_window']))
    with (a.output/'metrics-compact-v1.csv').open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    print(json.dumps({'trials':len(rows),'status':d['status'],'output':str(a.output)}))


if __name__=='__main__':main()
