#!/usr/bin/env python3
"""Measure actual app + stage tabs with preinstalled CDP probes.

Requires two owned targets with app_probe.js installed before app startup.
Runs serially; ordinary app auto-connect/capture/render code remains under test.
Render events are unique frame submissions, not physical display presentation.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import time
import urllib.request

from metrics import distribution


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--main-target', type=Path, required=True)
    p.add_argument('--stage-target', type=Path, required=True)
    p.add_argument('--fixture', type=Path, required=True)
    p.add_argument('--jobs', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    if a.output.exists() and any(a.output.iterdir()):
        p.error('Output must be new or empty')
    a.output.mkdir(parents=True, exist_ok=True)
    targets = {name: json.loads(path.read_text()) for name, path in
               [('main', a.main_target), ('stage', a.stage_target)]}
    fixture = json.loads(a.fixture.read_text())
    jobs = json.loads(a.jobs.read_text())
    cdp = Path(__file__).with_name('cdp.mjs')
    identity = {'jobs': jobs, 'fixture': fixture, 'harness_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                'probe_sha256': hashlib.sha256(Path(__file__).with_name('app_probe.js').read_bytes()).hexdigest()}
    (a.output / 'identity.json').write_text(json.dumps(identity, indent=2) + '\n')

    def command(target, method, params=None):
        request = {**targets[target], 'method': method, 'params': params or {}}
        r = subprocess.run(['node', str(cdp)], input=json.dumps(request), capture_output=True, text=True, timeout=35)
        if r.returncode:
            raise RuntimeError(r.stderr)
        return json.loads(r.stdout)

    def evaluate(target, expression):
        r = command(target, 'Runtime.evaluate', {'expression': expression, 'awaitPromise': True, 'returnByValue': True})
        if r.get('exceptionDetails'):
            raise RuntimeError(str(r['exceptionDetails']))
        return r['result'].get('value')

    def navigate(target, url):
        command(target, 'Page.navigate', {'url': url})

    def wait_for(target, expression, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if evaluate(target, expression):
                return
            time.sleep(1)
        raise TimeoutError(expression)

    progress = []
    try:
        command('main', 'Emulation.setDeviceMetricsOverride', {'width':1440, 'height':900, 'deviceScaleFactor':1, 'mobile':False})
        command('stage', 'Emulation.setDeviceMetricsOverride', {'width':1920, 'height':1080, 'deviceScaleFactor':1, 'mobile':False})
        for job in jobs:
            name = job['name']
            if not name.replace('-', '').replace('_', '').isalnum():
                raise ValueError('Unsafe job name')
            folder = a.output / name
            folder.mkdir()
            record = {'name':name, 'status':'running', 'config':job}
            progress.append(record)
            (a.output/'progress.json').write_text(json.dumps(progress, indent=2)+'\n')
            for target in targets:
                navigate(target, 'about:blank')
            time.sleep(2)
            server = job['server'].rstrip('/')
            request = urllib.request.Request(server+'/benchmark/config', data=json.dumps({
                'maxPending':job.get('maxPending',3), 'maxOutboundBytes':1048576,
                'benchmarkVariant':job.get('variant','baseline')}).encode(), headers={'Content-Type':'application/json'})
            with urllib.request.urlopen(request, timeout=15) as response:
                applied = json.load(response)
            if applied.get('benchmarkVariant') != job.get('variant','baseline'):
                raise RuntimeError('Server did not confirm compute variant')
            origin = job['origin'].rstrip('/')
            # The stage's first visit seeds shared localStorage too. Complete
            # both init scripts before applying the final per-run fixture.
            navigate('stage', origin+'/_not-found')
            wait_for('stage', '!!window.vj0AppProbe')
            navigate('main', origin+'/_not-found')
            wait_for('main', '!!window.vj0AppProbe')
            state = json.loads(json.dumps(fixture))
            state['vj0-ai-settings-storage']['state'].update(autoConnect=True, sendFrames=True,
                podUrl=server+'/webrtc/offer', frameRate=job.get('sendFps',60),
                outputWidth=job.get('width',512), outputHeight=job.get('height',288))
            evaluate('main', '(()=>{const f='+json.dumps(state)+';for(const [k,v] of Object.entries(f))localStorage.setItem(k,JSON.stringify(v));sessionStorage.vj0FixtureInstalled="1";return true})()')
            navigate('stage', origin+'/vj/stage')
            wait_for('stage', '!!window.vj0AppProbe && !!document.querySelector("canvas")')
            evaluate('stage', 'window.vj0AppProbe.begin()')
            navigate('main', origin+'/'+job['layout'])
            wait_for('main', '!!window.vj0AppProbe && !!document.querySelector("canvas")')
            evaluate('main', 'window.vj0AppProbe.begin();window.vj0AppProbe.setAudio(0.2,110)')
            wait_for('main', 'window.vj0AppProbe.snapshot().channelStates.includes("open")', 60)
            if job['layout'] == 'vj-next':
                wait_for('main', 'Array.from(document.querySelectorAll("button")).some(b=>/generate/i.test(b.textContent)&&!b.disabled)')
                evaluate('main', 'Array.from(document.querySelectorAll("button")).find(b=>/generate/i.test(b.textContent)&&!b.disabled).click()')
                wait_for('main', 'Array.from(document.querySelectorAll("button")).some(b=>/stop/i.test(b.textContent)&&!b.disabled)')
            wait_for('main', 'window.vj0AppProbe.snapshot().rows.filter(r=>r.kind==="received").length>=40', 120)
            wait_for('stage', 'window.vj0AppProbe.snapshot().rows.filter(r=>r.kind==="webgl-frame-submitted").length>=20', 60)
            expected_variant = job.get('variant', 'baseline')
            expected_clock = 'wall-clock' if expected_variant == 'baseline' else 'cuda-events'
            warm_stats = evaluate('main', 'window.vj0AppProbe.snapshot().rows.filter(r=>r.kind==="worker-stats")')
            if not warm_stats or any(r['timing'].get('benchmark_variant') != expected_variant or
                r['timing'].get('stage_clock') != expected_clock for r in warm_stats):
                raise RuntimeError('Worker telemetry did not confirm requested warmup compute variant')
            renderer = evaluate('stage', '(()=>{const g=document.querySelector("canvas").getContext("webgl2");const e=g.getExtension("WEBGL_debug_renderer_info");return {vendor:g.getParameter(g.VENDOR),renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER),userAgent:navigator.userAgent}})()')
            if job.get('telemetry'):
                if job['layout'] != 'vj-next':
                    raise ValueError('Telemetry popover action currently targets vj-next')
                evaluate('main', 'document.querySelector("button.vp-ai-chip").click()')
                wait_for('main', '!!document.querySelector("[role=dialog][aria-label=\\"AI transport\\"]")')
            if job.get('audioCycle'):
                evaluate('main', 'window.vj0AppProbe.setAudio(0,110)')
            for target in targets:
                evaluate(target, 'window.vj0AppProbe.begin()')
            started = time.monotonic()
            audio_index = 0
            # Check at a low rate. Probe arrays stay in-page until the interval
            # ends; recording/screenshots and sample encoding happen afterwards.
            while time.monotonic()-started < job['seconds']:
                time.sleep(min(10, max(0, job['seconds']-(time.monotonic()-started))))
                healthy = evaluate('main', 'window.vj0AppProbe.snapshot().channelStates.includes("open")')
                if not healthy:
                    raise RuntimeError('App disconnected during measurement')
                if job.get('audioCycle'):
                    index = int((time.monotonic()-started)//30) % 3
                    if index != audio_index:
                        audio_index = index
                        evaluate('main', 'window.vj0AppProbe.setAudio('+str([0,0.2,0.6][index])+','+str([110,110,220][index])+')')
            raw = {target:evaluate(target, 'window.vj0AppProbe.end()') for target in targets}
            start = max(r['started'] for r in raw.values())
            end = min(r['at'] for r in raw.values())
            seconds = (end-start)/1000
            summary = {'window_start':start, 'window_end':end, 'seconds':seconds, 'renderer':renderer, 'targets':{}}
            problems = []
            for target, data in raw.items():
                (folder/(target+'-raw.json')).write_text(json.dumps(data, indent=2)+'\n')
                rows = [r for r in data['rows'] if start<=r['at']<=end]
                kinds = sorted({r['kind'] for r in rows})
                result = {}
                for kind in kinds:
                    selected = [r for r in rows if r['kind']==kind]
                    ids = {r['id'] for r in selected if r.get('id') is not None}
                    result[kind] = {'events':len(selected), 'unique_frames':len(ids),
                        'fps':len(ids)/seconds if ids else None,
                        'age_ms':distribution([r['ageMs'] for r in selected if r.get('ageMs') is not None]),
                        'duration_ms':distribution([r['ms'] for r in selected if r.get('ms') is not None])}
                summary['targets'][target] = result
                if data['errors']:
                    problems.extend(target+': '+str(e) for e in data['errors'])
                if any(e.get('type')=='compile' and e.get('status')!='warmed' for e in data['events']):
                    problems.append(target+': compilation overlapped measurement')
                if any(e.get('type')=='error' or e.get('status')=='error' or
                    (e.get('type')=='connection' and e.get('state') in ['failed','disconnected','closed']) for e in data['events']):
                    problems.append(target+': worker or connection error during measurement')
                required = ['webgl-frame-submitted'] if target=='stage' else ['received',
                    'preview-image-raf' if job['layout']=='vj-next' else 'webgl-frame-submitted']
                for kind in required:
                    selected = [r for r in rows if r['kind']==kind]
                    if not selected or end-selected[-1]['at']>2000:
                        problems.append(target+': no '+kind+' output in final two seconds')
                if target == 'main':
                    stats = [r for r in rows if r['kind']=='worker-stats']
                    if not stats or any(r['timing'].get('benchmark_variant') != expected_variant or
                        r['timing'].get('stage_clock') != expected_clock for r in stats):
                        problems.append('main: missing or mismatched compute variant telemetry')
            summary.update(status='invalid' if problems else 'measured', problems=problems,
                measurement='Actual app capture and preview + 1920x1080 stage GL submission; excludes physical display presentation', config=job)
            (folder/'summary.json').write_text(json.dumps(summary, indent=2)+'\n')
            samples = evaluate('main', 'window.vj0AppProbe.sampleImages()')
            for sample, value in samples.items():
                (folder/(sample+'.jpg')).write_bytes(base64.b64decode(value.split(',',1)[1]))
            record.update(status=summary['status'], summary=str(folder/'summary.json'))
            (a.output/'progress.json').write_text(json.dumps(progress, indent=2)+'\n')
            print(json.dumps({'name':name, 'status':record['status'], 'summary':summary['targets']}), flush=True)
            if problems:
                raise RuntimeError('; '.join(problems))
    except BaseException as error:
        if progress and progress[-1]['status'] == 'running':
            progress[-1].update(status='failed', error=str(error))
            (a.output/'progress.json').write_text(json.dumps(progress, indent=2)+'\n')
        raise
    finally:
        cleanup_errors = []
        for target in targets:
            try:
                navigate(target, 'about:blank')
                wait_for(target, 'location.href === "about:blank"', 10)
            except Exception as error:
                cleanup_errors.append(target+': '+str(error))
        (a.output/'cleanup.json').write_text(json.dumps({'status':'failed' if cleanup_errors else 'pages-closed',
            'errors':cleanup_errors}, indent=2)+'\n')
        if cleanup_errors:
            raise RuntimeError('Client termination unconfirmed: '+ '; '.join(cleanup_errors))


if __name__ == '__main__':
    main()
