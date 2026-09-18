#!/usr/bin/env python3
"""Freeze a dated derivative of app_batch without modifying historical sources."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil


def replace_once(source, before, after):
    if source.count(before)!=1:
        raise ValueError('Expected one source anchor: '+before[:120])
    return source.replace(before,after)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    if a.output.exists():p.error('Use a new output directory')
    a.output.mkdir(parents=True)
    own=Path(__file__).parent;base=own.parent
    original=(base/'app_batch.py').read_text();source=original
    source=replace_once(source,'from metrics import distribution','from metrics import distribution\nfrom input_metrics import summarize_input')
    source=replace_once(source,"                    evidence.update(status='drained',quiet_observed_ms=(now-quiet_since)*1000)",
        """                    if browser['open']:
                        evidence['ordered_barrier'] = evaluate('main', 'window.__VJ0_INPUT_BENCH.barrier()')
                    evidence['debug_after_barrier'] = debug_snapshot(server)
                    evidence.update(status='drained',quiet_observed_ms=(now-quiet_since)*1000)""")
    source=replace_once(source,"                        activity:(s?.rows||[]).filter(r=>['sent','encode-start','encode-done'].includes(r.kind)).length};",
        """                        inputState:window.__VJ0_INPUT_BENCH?.snapshot(),
                        activity:(s?.rows||[]).filter(r=>['sent','encode-start','encode-done'].includes(r.kind)).length};""")
    source=replace_once(source,"            state = json.loads(json.dumps(fixture))",
        """            state = json.loads(json.dumps(fixture))
            state['vj0-input-benchmark'] = {'thresholdBytes':job['thresholdBytes']}""")
    source=replace_once(source,"            if job.get('audioCycle'):\n                evaluate('main', 'window.vj0AppProbe.setAudio(0,110)')",
        """            admission = evaluate('main', 'window.__VJ0_INPUT_BENCH.snapshot()')
            if admission['thresholdBytes'] != job['thresholdBytes']:
                raise RuntimeError('Browser did not apply requested threshold')
            if job.get('audioCycle'):
                evaluate('main', 'window.vj0AppProbe.setAudio(0,110)')""")
    source=replace_once(source,"            started = time.monotonic()\n            audio_index = 0",
        """            evaluate('main', 'window.__VJ0_INPUT_BENCH.begin()')
            if job.get('inputImpulses'):
                evaluate('main', 'window.__VJ0_INPUT_BENCH.startImpulses('+str(job['seconds'])+')')
            started = time.monotonic()
            audio_index = 0""")
    # One occurrence has the main timed window's following raw-file writer.
    source=replace_once(source,"""            raw = {target:evaluate(target, 'window.vj0AppProbe.end()') for target in targets}
            for target, data in raw.items():""",
        """            raw = {target:evaluate(target, 'window.vj0AppProbe.end()') for target in targets}
            input_raw = evaluate('main', 'window.__VJ0_INPUT_BENCH.end()')
            (folder/'input-raw.json').write_text(json.dumps(input_raw,indent=2)+'\\n')
            for target, data in raw.items():""")
    source=replace_once(source,"            problems = []\n            if not rtc_stats",
        """            problems = []
            summary['input'] = summarize_input(raw,start,end,input_raw)
            if any(input_raw['checks'].get(phase,{}).get('calls',0)<1 for phase in ['before-encode','before-send']):
                problems.append('Input threshold was not exercised at both admission sites')
            for key, surface in summary['input']['surfaces'].items():
                if key!='main/sent' and surface['missing_age_frames']:
                    problems.append(key+': missing source capture age')
            if job.get('inputImpulses') and not any(pulse['status']=='valid' and (pulse['analyser_peak_rms'] or 0)>=0.25 for pulse in summary['input']['impulses']):
                problems.append('Audio analyser did not observe the controlled bursts')
            if not rtc_stats""")
    (a.output/'app_batch.py').write_text(source)
    probe=(base/'app_probe.js').read_text()
    probe=replace_once(probe,'const value = {capture:epoch(), audioLevel, width:this.width, height:this.height};',
        'const value = {capture:epoch(), audioLevel, inputRms:window.__VJ0_INPUT_BENCH?.latestRms, audioAt:window.__VJ0_INPUT_BENCH?.latestAudioAt, width:this.width, height:this.height};')
    probe=replace_once(probe,"record('sent',{id,bytes:tagged.byteLength,buffered:channel.bufferedAmount,audioLevel:value.audioLevel});",
        "record('sent',{id,captureAt:value.capture,inputRms:value.inputRms,audioAt:value.audioAt,bytes:tagged.byteLength,buffered:channel.bufferedAmount,audioLevel:value.audioLevel});")
    probe+=';\n'+(own/'input_probe_extra.js').read_text()
    (a.output/'app_probe.js').write_text(probe)
    for name in ['metrics.py','cdp.mjs']:shutil.copy2(base/name,a.output/name)
    shutil.copy2(own/'input_metrics.py',a.output/'input_metrics.py')
    def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
    identity={'base_app_batch_sha256':hashlib.sha256(original.encode()).hexdigest(),
              'generator_sha256':sha(Path(__file__)),
              'files':{p.name:sha(p) for p in a.output.iterdir() if p.is_file()}}
    (a.output/'sources.json').write_text(json.dumps(identity,indent=2)+'\n')
    print(json.dumps(identity))


if __name__=='__main__':main()
