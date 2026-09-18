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
from input_metrics import summarize_input


def source_order(rows):
    """Audit source IDs, not receive-order counters, on the actual app surfaces."""
    result = {}
    for kind in ['received', 'preview-image-raf', 'webgl-frame-submitted']:
        selected = [r for r in rows if r['kind'] == kind]
        if not selected:
            continue
        ids = [r.get('id') for r in selected]
        missing = sum(not isinstance(i, int) or i < 1 for i in ids)
        reversals = sum(b < a for a,b in zip(ids, ids[1:]) if isinstance(a,int) and isinstance(b,int))
        duplicates = len(ids) - len(set(ids))
        result[kind] = {'frames':len(ids), 'missing_ids':missing,
            'reversals':reversals, 'duplicate_ids':duplicates,
            'status':'failed' if missing or reversals or duplicates else 'passed'}
    return result


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

    def debug_snapshot(server):
        request = urllib.request.Request(server+'/debug', headers={
            'User-Agent':'Mozilla/5.0 vj0-performance-benchmark'})
        with urllib.request.urlopen(request, timeout=10) as response:
            data = json.load(response)
        if not data.get('workers') or not isinstance(data.get('stats', {}).get('framesFromClient'), int):
            raise RuntimeError('Missing worker/input accounting in /debug')
        if any(type(w.get('framePending')) is not int or w['framePending'] < 0 for w in data['workers']):
            raise RuntimeError('Invalid framePending accounting in /debug')
        return {key:data[key] for key in ['protocol','uptime_s','stats','workers','channel','connection'] if key in data}

    def drain_before_navigation(folder, server):
        """Keep the old channel alive until physical work drains, before reset.

        Both app layouts cancel the generation of outstanding encoder callbacks
        when their actual generation Stop control is clicked. Observe a complete
        encode before that click so the restarted probe also accounts for any
        toBlob still pending at the click. Blob.arrayBuffer continuations retain
        the app's running/generation guards; browser/server quiet checks follow.
        """
        evidence = {'server':server, 'endpoint':'/debug', 'quiet_required_ms':500,
                    'samples':[], 'status':'running'}
        path = folder/'drain-before-switch.json'
        try:
            initial = evaluate('main', '''(()=>{
                const buttons=Array.from(document.querySelectorAll('button.vj-btn'));
                return {url:location.href, probe:!!window.vj0AppProbe,
                    open:!!window.vj0AppProbe?.snapshot().channelStates.includes('open'),
                    compileEvents:(window.vj0AppProbe?.snapshot().events||[]).filter(e=>e.type==='compile'),
                    stop:buttons.some(b=>b.textContent.trim()==='■ stop'),
                    stopped:buttons.some(b=>b.textContent.trim()==='▶ generate'),
                    podUrl:location.protocol==='about:' ? null :
                        JSON.parse(localStorage.getItem('vj0-ai-settings-storage')||'null')?.state?.podUrl};
            })()''')
            evidence['initial'] = initial
            compile_states = {e.get('worker'):e.get('status') for e in initial.get('compileEvents', [])}
            if initial.get('open') and (initial.get('podUrl') or '').rstrip('/') != server+'/webrtc/offer':
                raise RuntimeError('Active browser server differs from the server being drained')
            if initial.get('stop'):
                if not initial.get('probe') or not initial.get('open'):
                    raise RuntimeError('Cannot drain active generation without its connected probe')
                evaluate('main', 'window.vj0AppProbe.begin()')
                # A pre-existing encode may contribute an unmatched completion.
                # Requiring a new start followed by a completion establishes a
                # known point; subsequent starts/completions can be balanced.
                wait_for('main', '''(()=>{const r=window.vj0AppProbe.snapshot().rows;
                    const i=r.findIndex(x=>x.kind==='encode-start');
                    return i>=0&&r.slice(i+1).some(x=>x.kind==='encode-done');})()''', 15)
                evaluate('main', '''(()=>{const b=Array.from(document.querySelectorAll('button.vj-btn'))
                    .find(b=>b.textContent.trim()==='■ stop');
                    if(!b||b.disabled)throw new Error('Generation Stop unavailable');b.click();})()''')
                wait_for('main', '''!Array.from(document.querySelectorAll('button.vj-btn'))
                    .some(b=>b.textContent.trim()==='■ stop')''', 10)
                evidence['action'] = 'clicked-generation-stop'
            elif initial.get('stopped'):
                evaluate('main', 'window.vj0AppProbe?.begin()')
                evidence['action'] = 'already-stopped'
            elif initial.get('open') or initial['url'].split('?')[0].rstrip('/').endswith(('/vj','/vj-next')):
                raise RuntimeError('Unknown app capture state; refusing to reset pending accounting')
            else:
                evidence['action'] = 'no-active-capture-page'

            deadline = time.monotonic()+30
            quiet_since, previous = None, None
            while time.monotonic() < deadline:
                browser = evaluate('main', '''(()=>{
                    const s=window.vj0AppProbe?.snapshot();let pending=0;
                    for(const r of s?.rows||[]){if(r.kind==='encode-start')pending++;
                        if(r.kind==='encode-done')pending=Math.max(0,pending-1);}
                    return {open:!!s?.channelStates.includes('open'),pendingEncode:pending,
                        compileOverlay:!!document.querySelector('.vp-compile-overlay'),
                        compileEvents:(s?.events||[]).filter(e=>e.type==='compile'),
                        stopped:!Array.from(document.querySelectorAll('button.vj-btn'))
                            .some(b=>b.textContent.trim()==='■ stop'),
                        inputState:window.__VJ0_INPUT_BENCH?.snapshot(),
                        activity:(s?.rows||[]).filter(r=>['sent','encode-start','encode-done'].includes(r.kind)).length};
                })()''')
                debug = debug_snapshot(server)
                compile_states.update({e.get('worker'):e.get('status') for e in browser['compileEvents']})
                if initial.get('open') and (not browser['open'] or (debug.get('channel') or {}).get('readyState') != 'open'):
                    raise RuntimeError('Channel closed before physical requests drained')
                now = time.monotonic()
                sample = {'at_monotonic':now,'browser':browser,'debug':debug}
                evidence['samples'].append(sample)
                key = (browser['activity'], debug['stats']['framesFromClient'])
                idle = browser['stopped'] and browser['pendingEncode'] == 0 and not browser['compileOverlay'] and not any(
                    state in ['compiling','compiling_progress','compile_failed'] for state in compile_states.values()) and all(
                    w['framePending'] == 0 and w.get('ready') and not w.get('compileStartedAt', 0)
                    for w in debug['workers'])
                if not idle:
                    quiet_since = None
                elif quiet_since is None or key != previous:
                    quiet_since = now
                previous = key
                if quiet_since is not None and now-quiet_since >= 0.5:
                    if browser['open']:
                        evidence['ordered_barrier'] = evaluate('main', 'window.__VJ0_INPUT_BENCH.barrier()')
                    evidence['debug_after_barrier'] = debug_snapshot(server)
                    evidence.update(status='drained',quiet_observed_ms=(now-quiet_since)*1000)
                    path.write_text(json.dumps(evidence,indent=2)+'\n')
                    return
                time.sleep(0.1)
            raise TimeoutError('Capture/encoder/worker work did not drain while connected; policy unchanged')
        except BaseException as error:
            evidence.update(status='failed',error=str(error))
            path.write_text(json.dumps(evidence,indent=2)+'\n')
            raise

    def stress(folder, initial_size):
        """Separate lifecycle trial; deliberate disconnects aren't steady FPS."""
        actions, intentional_disconnects = [], []
        for target in targets:
            evaluate(target, 'window.vj0AppProbe.begin()')

        def received_after(at, timeout=60, dimensions=None):
            expression = ('window.vj0AppProbe.snapshot().rows.find(r=>r.kind==="received"&&'
                          'Number.isFinite(r.ageMs)&&r.at-r.ageMs>='+str(at)+')')
            wait_for('main', '!!('+expression+')', timeout)
            row = evaluate('main', expression)
            wait_for('stage', 'window.vj0AppProbe.snapshot().rows.some(r=>r.kind==="webgl-frame-submitted"&&r.id>='+str(row['id'])+')', timeout)
            if dimensions:
                width, height = dimensions
                for target, kind in [('main','preview-image-loaded'), ('stage','bitmap-decoded')]:
                    expr = ('window.vj0AppProbe.snapshot().rows.find(r=>r.kind==='+json.dumps(kind)+
                        '&&r.id>='+str(row['id'])+'&&r.width==='+str(width)+'&&r.height==='+str(height)+')')
                    wait_for(target, '!!('+expr+')', timeout)
                    decoded = evaluate(target, expr)
                    row[target+'_decoded_frame_id'] = decoded['id']
                    if target == 'stage':
                        wait_for(target, 'window.vj0AppProbe.snapshot().rows.some(r=>r.kind==="webgl-frame-submitted"&&r.id==='+str(decoded['id'])+')', timeout)
            return row

        try:
            prompts = ['luminous glass ribbons woven through a dark teal space, shimmering gradients',
                       'rippling liquid metal sculpture with orange and purple reflections',
                       'luminous glass ribbons woven through a dark teal space, shimmering gradients']
            for index, prompt in enumerate(prompts):
                before = evaluate('main', 'performance.timeOrigin+performance.now()')
                evaluate('main', '(()=>{const t=document.querySelector("textarea.vp-prompt");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(t,'+json.dumps(prompt)+');t.dispatchEvent(new Event("input",{bubbles:true}));})()')
                expression = 'window.vj0AppProbe.snapshot().events.find(e=>e.type==="settings-sent"&&e.at>='+str(before)+'&&e.data.prompt==='+json.dumps(prompt)+')'
                wait_for('main', '!!('+expression+')')
                sent = evaluate('main', expression)
                row = received_after(sent['at'])
                actions.append({'action':'prompt', 'index':index, 'prompt':prompt,
                    'settings_sent_at':sent['at'], 'first_subsequent_capture_received_at':row['at'],
                    'settings_to_new_capture_receive_ms':row['at']-sent['at'], 'frame_id':row['id']})
                time.sleep(2)
            shapes = [(512,288),(768,448),(1024,576)]
            index = shapes.index(initial_size)
            for width, height in shapes[index+1:] + shapes[:index+1]:
                before = evaluate('main', 'performance.timeOrigin+performance.now()')
                value = f'{width}x{height}'
                evaluate('main', '(()=>{const s=Array.from(document.querySelectorAll("select")).find(s=>Array.from(s.options).some(o=>o.value==="512x288"));s.value='+json.dumps(value)+';s.dispatchEvent(new Event("change",{bubbles:true}));})()')
                condition = 'window.vj0AppProbe.snapshot().rows.find(r=>r.kind==="worker-stats"&&r.at>='+str(before)+'&&r.width==='+str(width)+'&&r.height==='+str(height)+')'
                wait_for('main', '!!('+condition+')', 180)
                state = evaluate('main', condition)
                row = received_after(state['at'], 180, (width,height))
                actions.append({'action':'resolution', 'width':width, 'height':height,
                    'started_at':before, 'matching_worker_output_at':state['at'],
                    'change_to_matching_worker_output_ms':state['at']-before, 'subsequent_frame_id':row['id'],
                    'main_decoded_frame_id':row['main_decoded_frame_id'], 'stage_decoded_frame_id':row['stage_decoded_frame_id']})
                time.sleep(2)
            # Exercise rapid preset input through the actual controlled field.
            # React/app debounce may intentionally coalesce these changes.
            evaluate('main', '(async()=>{const t=document.querySelector("textarea.vp-prompt");const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set;for(let i=0;i<10;i++){set.call(t,"rapid benchmark cue "+i+", luminous organic ribbons");t.dispatchEvent(new Event("input",{bubbles:true}));await new Promise(r=>setTimeout(r,100));}})()')
            wait_for('main', 'window.vj0AppProbe.snapshot().events.some(e=>e.type==="settings-sent"&&e.data.prompt==="rapid benchmark cue 9, luminous organic ribbons")')
            at = evaluate('main', 'performance.timeOrigin+performance.now()')
            row = received_after(at)
            actions.append({'action':'ten-rapid-prompts', 'final_prompt_observed':True, 'subsequent_frame_id':row['id']})
            for index in range(3):
                evaluate('main', '(()=>{if(!document.querySelector("[role=dialog][aria-label=\\"AI transport\\"]"))Array.from(document.querySelectorAll("button.vp-ai-chip")).find(b=>b.querySelector(".vp-ai-chip__label")?.textContent.trim()==="ai").click()})()')
                wait_for('main', '!!document.querySelector("[role=dialog][aria-label=\\"AI transport\\"]")')
                disconnect_at = evaluate('main', 'performance.timeOrigin+performance.now()')
                evaluate('main', 'Array.from(document.querySelectorAll("button")).find(b=>/disconnect/i.test(b.textContent)).click()')
                wait_for('main', '!window.vj0AppProbe.snapshot().channelStates.includes("open")')
                time.sleep(2)
                at = evaluate('main', 'performance.timeOrigin+performance.now()')
                evaluate('main', 'Array.from(document.querySelectorAll("button")).find(b=>/connect/i.test(b.textContent)&&!/disconnect/i.test(b.textContent)&&!b.disabled).click()')
                wait_for('main', 'window.vj0AppProbe.snapshot().channelStates.includes("open")', 60)
                evaluate('main', '(()=>{const b=Array.from(document.querySelectorAll("button")).find(b=>/generate/i.test(b.textContent)&&!b.disabled);if(b)b.click()})()')
                row = received_after(at)
                intentional_disconnects.append((disconnect_at,row['at']))
                actions.append({'action':'reconnect', 'index':index, 'connect_clicked_at':at,
                    'disconnect_clicked_at':disconnect_at,
                    'new_capture_received_at':row['at'], 'reconnect_to_new_capture_receive_ms':row['at']-at,
                    'frame_id':row['id']})
                time.sleep(3)
            raw = {target:evaluate(target, 'window.vj0AppProbe.end()') for target in targets}
            problems = [target+': '+str(error) for target,data in raw.items() for error in data['errors']]
            if 'open' not in raw['main']['channelStates']:
                problems.append('main: no open channel at stress completion')
            order = {target:source_order(data['rows']) for target,data in raw.items()}
            for target, checks in order.items():
                if any(check['status'] != 'passed' for check in checks.values()):
                    problems.append(target+': source frames are not strictly increasing during stress')
            for target, data in raw.items():
                if any(e.get('type')=='error' or e.get('status') in ['error','compile_failed'] or
                       (e.get('type')=='connection' and e.get('state')=='failed') for e in data['events']):
                    problems.append(target+': worker or connection failure')
                for event in data['events']:
                    if event.get('type')=='connection' and event.get('state') in ['closed','disconnected'] and not any(
                        start<=event['at']<=end for start,end in intentional_disconnects):
                        problems.append(target+': unexpected disconnection outside a requested reconnect')
                for kind in (['received','preview-image-raf'] if target=='main' else ['webgl-frame-submitted']):
                    recent = [r['at'] for r in data['rows'] if r['kind']==kind]
                    if not recent or data['at']-max(recent)>2000:
                        problems.append(target+': stale final '+kind+' output')
                (folder/(target+'-stress-raw.json')).write_text(json.dumps(data,indent=2)+'\n')
            result = {'status':'failed' if problems else 'passed', 'actions':actions, 'errors':problems, 'source_order':order,
                'measurement':'Lifecycle/input response trial; intentional disconnects and prompt work are excluded from the preceding steady-state FPS result'}
            (folder/'stress.json').write_text(json.dumps(result,indent=2)+'\n')
            if problems:
                raise RuntimeError('; '.join(problems))
            return result
        except BaseException as error:
            (folder/'stress-failure.json').write_text(json.dumps({'status':'failed','error':str(error),'completed_actions':actions},indent=2)+'\n')
            raise

    progress = []
    active_server = None
    try:
        # Metrics and focus emulation belong to the persistent setup sessions.
        # A short-lived CDP session can lose its override when it detaches.
        for job in jobs:
            name = job['name']
            if not name.replace('-', '').replace('_', '').isalnum():
                raise ValueError('Unsafe job name')
            folder = a.output / name
            folder.mkdir()
            record = {'name':name, 'status':'running', 'config':job}
            progress.append(record)
            (a.output/'progress.json').write_text(json.dumps(progress, indent=2)+'\n')
            server = job['server'].rstrip('/')
            drain_before_navigation(folder, active_server or server)
            for target in targets:
                navigate(target, 'about:blank')
            time.sleep(2)
            if 'mailbox' in job:
                mailbox_request = urllib.request.Request(server+'/benchmark/mailbox',
                    data=json.dumps({'enabled':job['mailbox']}).encode(), headers={
                        'Content-Type':'application/json', 'User-Agent':'Mozilla/5.0 vj0-performance-benchmark'})
                with urllib.request.urlopen(mailbox_request, timeout=15) as response:
                    mailbox_applied = json.load(response)
                if mailbox_applied.get('enabled') is not job['mailbox']:
                    raise RuntimeError('Server did not confirm mailbox policy')
                (folder/'mailbox-config.json').write_text(json.dumps(mailbox_applied,indent=2)+'\n')
            request = urllib.request.Request(server+'/benchmark/config', data=json.dumps({
                'maxPending':job.get('maxPending',3), 'maxOutboundBytes':1048576,
                **({'activeWorkers':job['activeWorkers']} if 'activeWorkers' in job else {}),
                **({'benchmarkThreads':job['workerThreads']} if 'workerThreads' in job else {}),
                'benchmarkVariant':job.get('variant','baseline')}).encode(), headers={
                    'Content-Type':'application/json', 'User-Agent':'Mozilla/5.0 vj0-performance-benchmark'})
            with urllib.request.urlopen(request, timeout=15) as response:
                applied = json.load(response)
            if applied.get('benchmarkVariant') != job.get('variant','baseline'):
                raise RuntimeError('Server did not confirm compute variant')
            if 'activeWorkers' in job and applied.get('activeWorkers') != job['activeWorkers']:
                raise RuntimeError('Server did not confirm active workers')
            if 'workerThreads' in job and applied.get('benchmarkThreads') != job['workerThreads']:
                raise RuntimeError('Server did not confirm worker thread count')
            active_server = server
            origin = job['origin'].rstrip('/')
            # The stage's first visit seeds shared localStorage too. Complete
            # both init scripts before applying the final per-run fixture.
            navigate('stage', origin+'/_not-found')
            wait_for('stage', '!!window.vj0AppProbe')
            navigate('main', origin+'/_not-found')
            wait_for('main', '!!window.vj0AppProbe')
            state = json.loads(json.dumps(fixture))
            state['vj0-input-benchmark'] = {'thresholdBytes':job['thresholdBytes']}
            state['vj0-ai-settings-storage']['state'].update(autoConnect=True, sendFrames=True,
                podUrl=server+'/webrtc/offer', frameRate=job.get('sendFps',60),
                outputWidth=job.get('width',512), outputHeight=job.get('height',288))
            evaluate('main', '(()=>{const f='+json.dumps(state)+';for(const [k,v] of Object.entries(f))localStorage.setItem(k,JSON.stringify(v));sessionStorage.vj0FixtureInstalled="1";return true})()')
            navigate('stage', origin+'/vj/stage')
            wait_for('stage', '!!window.vj0AppProbe && !!document.querySelector("canvas")')
            evaluate('stage', 'window.vj0AppProbe.begin()')
            navigate('main', origin+'/'+job['layout'])
            wait_for('main', '!!window.vj0AppProbe && !!document.querySelector("canvas")')
            for target in targets:
                wait_for(target, 'document.visibilityState === "visible"')
            evaluate('main', 'window.vj0AppProbe.begin();window.vj0AppProbe.setAudio(0.2,110)')
            wait_for('main', 'window.vj0AppProbe.snapshot().channelStates.includes("open")', 60)
            if job['layout'] == 'vj-next':
                wait_for('main', 'Array.from(document.querySelectorAll("button")).some(b=>/generate/i.test(b.textContent)&&!b.disabled)')
                evaluate('main', 'Array.from(document.querySelectorAll("button")).find(b=>/generate/i.test(b.textContent)&&!b.disabled).click()')
                wait_for('main', 'Array.from(document.querySelectorAll("button")).some(b=>/stop/i.test(b.textContent)&&!b.disabled)')
            wait_for('main', 'window.vj0AppProbe.snapshot().rows.filter(r=>r.kind==="received").length>=40', 120)
            wait_for('stage', 'window.vj0AppProbe.snapshot().rows.filter(r=>r.kind==="webgl-frame-submitted").length>=20', 60)
            wait_for('main', 'window.vj0AppProbe.snapshot().rms.some(r=>r.level===0.2&&r.rms>0.01)', 15)
            expected_variant = job.get('variant', 'baseline')
            expected_clock = 'wall-clock' if expected_variant == 'baseline' else 'cuda-events'
            warm_stats = evaluate('main', 'window.vj0AppProbe.snapshot().rows.filter(r=>r.kind==="worker-stats")')
            if not warm_stats or any(r['timing'].get('benchmark_variant') != expected_variant or
                r['timing'].get('stage_clock') != expected_clock for r in warm_stats):
                raise RuntimeError('Worker telemetry did not confirm requested warmup compute variant')
            if expected_variant == 'terminal-noop' and any(r['timing'].get('terminal_skips') != 1 for r in warm_stats):
                raise RuntimeError('Worker did not confirm one skipped terminal prediction per warmup frame')
            if 'workerThreads' in job and any(r['timing'].get('torch_threads') != job['workerThreads'] for r in warm_stats):
                raise RuntimeError('Worker did not apply the requested thread count')
            if 'outputCast' in job and any(r['timing'].get('output_cast') != job['outputCast'] for r in warm_stats):
                raise RuntimeError('Worker did not apply the requested output conversion')
            if 'activeWorkers' in job and {r.get('worker') for r in warm_stats} != set(range(job['activeWorkers'])):
                raise RuntimeError('Not all requested workers produced warmup frames')
            renderer = evaluate('stage', '(()=>{const g=document.querySelector("canvas").getContext("webgl2");const e=g.getExtension("WEBGL_debug_renderer_info");return {vendor:g.getParameter(g.VENDOR),renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER),userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight],glBuffer:[g.drawingBufferWidth,g.drawingBufferHeight],devicePixelRatio}})()')
            renderer['mainViewport'] = evaluate('main', '[innerWidth,innerHeight]')
            renderer['focusEmulation'] = True
            (folder/'renderer.json').write_text(json.dumps(renderer,indent=2)+'\n')
            if renderer['viewport'] != [1920,1080] or renderer['devicePixelRatio'] != 1:
                raise RuntimeError('Stage viewport differs from the requested benchmark configuration')
            if renderer['mainViewport'] != [1440,900]:
                raise RuntimeError('Main viewport differs from the requested benchmark configuration')
            if job.get('telemetry'):
                if job['layout'] != 'vj-next':
                    raise ValueError('Telemetry popover action currently targets vj-next')
                evaluate('main', 'Array.from(document.querySelectorAll("button.vp-ai-chip")).find(b=>b.querySelector(".vp-ai-chip__label")?.textContent.trim()==="ai").click()')
                wait_for('main', '!!document.querySelector("[role=dialog][aria-label=\\"AI transport\\"]")')
            admission = evaluate('main', 'window.__VJ0_INPUT_BENCH.snapshot()')
            if admission['thresholdBytes'] != job['thresholdBytes']:
                raise RuntimeError('Browser did not apply requested threshold')
            if job.get('audioCycle'):
                evaluate('main', 'window.vj0AppProbe.setAudio(0,110)')
            (folder/'debug-before.json').write_text(json.dumps(debug_snapshot(server),indent=2)+'\n')
            for target in targets:
                evaluate(target, 'window.vj0AppProbe.begin()')
            evaluate('main', 'window.__VJ0_INPUT_BENCH.begin()')
            if job.get('inputImpulses'):
                evaluate('main', 'window.__VJ0_INPUT_BENCH.startImpulses('+str(job['seconds'])+')')
            started = time.monotonic()
            audio_index = 0
            # Check at a low rate. Probe arrays stay in-page until the interval
            # ends; recording/screenshots and sample encoding happen afterwards.
            while time.monotonic()-started < job['seconds']:
                time.sleep(min(10, max(0, job['seconds']-(time.monotonic()-started))))
                healthy = evaluate('main', 'window.vj0AppProbe.snapshot().channelStates.includes("open")')
                if not healthy:
                    raise RuntimeError('App disconnected during measurement')
                for target in targets:
                    if evaluate(target, 'document.visibilityState') != 'visible':
                        raise RuntimeError(target+' became hidden during measurement')
                if job.get('audioCycle'):
                    index = int((time.monotonic()-started)//30) % 3
                    if index != audio_index:
                        audio_index = index
                        evaluate('main', 'window.vj0AppProbe.setAudio('+str([0,0.2,0.6][index])+','+str([110,110,220][index])+')')
            raw = {target:evaluate(target, 'window.vj0AppProbe.end()') for target in targets}
            input_raw = evaluate('main', 'window.__VJ0_INPUT_BENCH.end()')
            (folder/'input-raw.json').write_text(json.dumps(input_raw,indent=2)+'\n')
            for target, data in raw.items():
                (folder/(target+'-raw.json')).write_text(json.dumps(data, indent=2)+'\n')
            rtc_stats = evaluate('main', 'window.vj0AppProbe.rtcStats()')
            (folder/'rtc-stats.json').write_text(json.dumps(rtc_stats,indent=2)+'\n')
            (folder/'debug-after.json').write_text(json.dumps(debug_snapshot(server),indent=2)+'\n')
            start = max(r['started'] for r in raw.values())
            end = min(r['at'] for r in raw.values())
            seconds = (end-start)/1000
            summary = {'window_start':start, 'window_end':end, 'seconds':seconds, 'renderer':renderer, 'targets':{}}
            problems = []
            summary['input'] = summarize_input(raw,start,end,input_raw)
            if any(input_raw['checks'].get(phase,{}).get('calls',0)<1 for phase in ['before-encode','before-send']):
                problems.append('Input threshold was not exercised at both admission sites')
            for key, surface in summary['input']['surfaces'].items():
                if key!='main/sent' and surface['missing_age_frames']:
                    problems.append(key+': missing source capture age')
            if job.get('inputImpulses') and not any(pulse['status']=='valid' and (pulse['analyser_peak_rms'] or 0)>=0.25 for pulse in summary['input']['impulses']):
                problems.append('Audio analyser did not observe the controlled bursts')
            if not rtc_stats or not any(pair.get('type') == 'candidate-pair' and pair.get('state') == 'succeeded'
                    for peer in rtc_stats for pair in peer):
                problems.append('main: no succeeded WebRTC candidate pair on a connected peer after measurement')
            audio_rows = [r for r in raw['main']['rms'] if start<=r['at']<=end]
            summary['audio_rms_by_fixture_level'] = {str(level):distribution([r['rms'] for r in audio_rows if r['level']==level])
                for level in sorted({r['level'] for r in audio_rows})}
            for level in ([0,0.2,0.6] if job.get('audioCycle') else [0.2]):
                values = [r['rms'] for r in audio_rows if r['level']==level]
                if not values or (level and max(values)<0.01):
                    problems.append('main: audio analyser did not observe fixture level '+str(level))
            for target, data in raw.items():
                rows = [r for r in data['rows'] if start<=r['at']<=end]
                order = source_order(rows)
                summary.setdefault('source_order', {})[target] = order
                if any(check['status'] != 'passed' for check in order.values()):
                    problems.append(target+': source frames are not strictly increasing during measurement')
                for row in rows:
                    if row['kind'] in ['preview-image-loaded', 'bitmap-decoded'] and row.get('id'):
                        if row.get('width') != job.get('width',512) or row.get('height') != job.get('height',288):
                            problems.append(target+': decoded output dimensions differ from the requested resolution')
                            break
                kinds = sorted({r['kind'] for r in rows})
                result = {}
                for kind in kinds:
                    selected = [r for r in rows if r['kind']==kind]
                    ids = {r['id'] for r in selected if r.get('id') is not None}
                    result[kind] = {'events':len(selected), 'unique_frames':len(ids),
                        'fps':len(ids)/seconds if ids else None,
                        'dimensions':sorted({(r['width'],r['height']) for r in selected if r.get('width') and r.get('height')}),
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
                    if expected_variant == 'terminal-noop' and any(
                        r['timing'].get('terminal_skips') != 1 for r in stats):
                        problems.append('main: terminal prediction skip missing during measurement')
                    if 'workerThreads' in job and any(
                        r['timing'].get('torch_threads') != job['workerThreads'] for r in stats):
                        problems.append('main: worker thread count changed during measurement')
                    if 'outputCast' in job and any(r['timing'].get('output_cast') != job['outputCast'] for r in stats):
                        problems.append('main: output conversion changed during measurement')
                    if 'activeWorkers' in job:
                        expected_workers = set(range(job['activeWorkers']))
                        if {r.get('worker') for r in stats} != expected_workers:
                            problems.append('main: measured worker identities differ from the requested pool')
                        summary['worker_activity'] = {}
                        for worker in sorted(expected_workers):
                            at = [start] + [r['at'] for r in stats if r.get('worker') == worker] + [end]
                            gap = max(b-a for a,b in zip(at,at[1:]))
                            summary['worker_activity'][str(worker)] = {'frames':len(at)-2, 'max_gap_ms':gap}
                            if gap > 2000:
                                problems.append('main: worker '+str(worker)+' had an output gap over two seconds')
            summary.update(status='invalid' if problems else 'measured', problems=problems,
                measurement='Actual app capture/preview + stage GL submission in a 1920x1080 viewport; actual GL buffer sizes recorded separately; excludes physical display presentation', config=job)
            (folder/'summary.json').write_text(json.dumps(summary, indent=2)+'\n')
            samples = evaluate('main', 'window.vj0AppProbe.sampleImages()')
            for sample, value in samples.items():
                (folder/(sample+'.jpg')).write_bytes(base64.b64decode(value.split(',',1)[1]))
            record.update(status=summary['status'], summary=str(folder/'summary.json'))
            (a.output/'progress.json').write_text(json.dumps(progress, indent=2)+'\n')
            print(json.dumps({'name':name, 'status':record['status'], 'summary':summary['targets']}), flush=True)
            if problems:
                raise RuntimeError('; '.join(problems))
            if job.get('stress'):
                if job['layout'] != 'vj-next':
                    raise ValueError('Lifecycle actions currently target vj-next')
                record['stress_status'] = 'running'
                (a.output/'progress.json').write_text(json.dumps(progress, indent=2)+'\n')
                try:
                    record['stress_status'] = stress(folder, (job.get('width',512), job.get('height',288)))['status']
                except BaseException as error:
                    record.update(stress_status='failed', stress_error=str(error))
                    (a.output/'progress.json').write_text(json.dumps(progress, indent=2)+'\n')
                    raise
                (a.output/'progress.json').write_text(json.dumps(progress, indent=2)+'\n')
    except BaseException as error:
        if progress and progress[-1]['status'] == 'running':
            progress[-1].update(status='failed', error=str(error))
            (a.output/'progress.json').write_text(json.dumps(progress, indent=2)+'\n')
        raise
    finally:
        cleanup_errors = []
        if active_server:
            try:
                drain_before_navigation(a.output, active_server)
            except Exception as error:
                cleanup_errors.append('final drain: '+str(error))
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
