#!/usr/bin/env python3
"""Run saved browser benchmark jobs serially and persist each result locally.

Requires agent-browser and an already-open local harness origin. Stop other
clients and wait for GPU startup compilation before starting this runner.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
import uuid


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--session', required=True)
    p.add_argument('--jobs', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--resume', action='store_true', help='Reattach to the same browser batch and output directory')
    p.add_argument('--origin', default='http://127.0.0.1:18765')
    p.add_argument('--timeout-seconds', type=float, default=7200)
    a = p.parse_args()
    jobs = json.loads(a.jobs.read_text())
    names = [job['name'] for job in jobs]
    if len(set(names)) != len(names) or any(not n.replace('-', '').replace('_', '').isalnum() for n in names):
        p.error('Job names must be unique simple filenames')
    if a.output.exists() and any(a.output.iterdir()) and not a.resume:
        p.error('Output directory must be new or empty')
    a.output.mkdir(parents=True, exist_ok=True)
    harness = Path(__file__).with_name('browser.js')
    harness_hash = hashlib.sha256(harness.read_bytes()).hexdigest()
    config_hash = hashlib.sha256((json.dumps(jobs, sort_keys=True) + harness_hash).encode()).hexdigest()
    identity_path = a.output / 'run-identity.json'
    if a.resume:
        identity = json.loads(identity_path.read_text())
        if identity['config_hash'] != config_hash or identity['origin'] != a.origin:
            p.error('Saved run identity does not match configuration')
    else:
        identity = {'run_id': str(uuid.uuid4()), 'config_hash': config_hash, 'origin': a.origin}
        identity_path.write_text(json.dumps(identity, indent=2) + '\n')
    signature = identity['run_id']
    if a.resume:
        if json.loads((a.output / 'jobs.json').read_text()) != jobs or (a.output / 'harness-sha256.txt').read_text().strip() != harness_hash:
            p.error('Resume jobs or harness differ from saved identity')
    else:
        (a.output / 'jobs.json').write_text(json.dumps(jobs, indent=2) + '\n')
        (a.output / 'harness-sha256.txt').write_text(harness_hash + '\n')

    def evaluate(script):
        proc = subprocess.run(['agent-browser', '--session', a.session, '--json', 'eval', '--stdin'],
            input=script, text=True, capture_output=True, timeout=20, check=True)
        data = json.loads(proc.stdout)
        if not data.get('success'):
            raise RuntimeError(str(data.get('error')))
        return data['data']['result']

    saved = 0
    failed_names = []

    def snapshot(freeze=False):
        return evaluate("(() => { const b=window.vj0Batch; if (!b) return null; "
            + (f"if (b.signature === {json.dumps(signature)}) b.cancelRequested=true; " if freeze else "")
            + f"return {{signature:b.signature,done:b.done,active:b.active,error:b.error,count:b.results.length,results:b.results.slice({saved})}}; }})()")

    def persist_snapshot(payload):
        nonlocal saved
        if payload is None or payload.get('signature') != signature:
            raise RuntimeError('Browser batch disappeared or identity changed')
        for record in payload['results']:
            if saved >= len(names) or record['name'] != names[saved]:
                raise RuntimeError('Unexpected result order or name')
            target = a.output / (record['name'] + '.json')
            body = json.dumps(record['result'], indent=2) + '\n'
            if target.exists() and target.read_text() != body:
                raise RuntimeError('Saved result differs from the identified browser run')
            temporary = target.with_suffix('.json.tmp')
            temporary.write_text(body)
            temporary.replace(target)
            if record['result']['status'] != 'measured':
                failed_names.append(record['name'])
            saved += 1
            print(json.dumps({'saved':record['name'], 'status':record['result']['status'],
                'receivedFps':record['result'].get('receivedFps')}), flush=True)
        state = {key:value for key,value in payload.items() if key != 'results'}
        state['failed'] = list(failed_names)
        (a.output / 'batch.json').write_text(json.dumps(state, indent=2) + '\n')
        return state

    previous = None
    deadline = time.monotonic() + a.timeout_seconds
    try:
        # Resuming never launches another browser loop. Results remain in the page
        # and are re-collected by identity after an unexpected collector disconnect.
        if a.resume:
            state = evaluate('window.vj0Batch && ({signature:window.vj0Batch.signature})')
            if not state or state.get('signature') != signature:
                raise RuntimeError('Browser has no matching batch to resume')
        else:
            evaluate('''(() => {
          if (location.origin !== ORIGIN) throw new Error('Unexpected harness origin');
          if (window.vj0Batch && !window.vj0Batch.done) throw new Error('A batch is already running');
          const jobs = JOBS;
          window.vj0Batch = {signature:SIGNATURE, done:false, active:null, results:[], error:null, failed:[]};
          (async () => {
            const response = await fetch('/browser.js?batch=' + Date.now(), {cache:'no-store'});
            if (!response.ok) throw new Error('Could not fetch harness');
            const bytes = await response.arrayBuffer();
            const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
            if (hash !== HARNESS_HASH) throw new Error('Served harness does not match recorded hash');
            const url = URL.createObjectURL(new Blob([bytes], {type:'text/javascript'}));
            const {runBenchmark} = await import(url);
            URL.revokeObjectURL(url);
            let consecutiveFailures = 0;
            for (const job of jobs) {
              if (window.vj0Batch.cancelRequested) throw new Error('Batch cancelled');
              window.vj0Batch.active = job.name;
              let result;
              try { result = await runBenchmark(job.options); }
              catch (error) { result = {status:'failed', error:String(error), config:job.options, date:new Date().toISOString()}; }
              if (window.vj0Batch.cancelRequested) throw new Error('Batch cancelled');
              window.vj0Batch.results.push({name:job.name, result});
              if (result.status !== 'measured') window.vj0Batch.failed.push(job.name);
              consecutiveFailures = result.status === 'measured' ? 0 : consecutiveFailures + 1;
              if (consecutiveFailures >= 2) throw new Error('Two consecutive failed trials; inspect before continuing');
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          })().catch(error => {window.vj0Batch.error = String(error);}).finally(() => {
            window.vj0Batch.active = null; window.vj0Batch.done = true;
          });
          return {started:true, jobs:jobs.length};
        })()'''.replace('JOBS', json.dumps(jobs)).replace('SIGNATURE', json.dumps(signature))
                .replace('HARNESS_HASH', json.dumps(harness_hash)).replace('ORIGIN', json.dumps(a.origin)))
        while time.monotonic() < deadline:
            state = persist_snapshot(snapshot())
            if state['active'] != previous:
                print(json.dumps(state), flush=True)
                previous = state['active']
            if state['done']:
                if state['error']:
                    raise RuntimeError(state['error'])
                if saved != len(jobs):
                    raise RuntimeError(f'Incomplete batch: saved {saved} of {len(jobs)} trials')
                if failed_names:
                    raise RuntimeError('Failed trials: ' + ', '.join(failed_names))
                return
            time.sleep(5)
        raise TimeoutError('Batch exceeded its execution time allowance')
    except BaseException:
        # Ending collection must not silently leave timed GPU jobs executing.
        # This session is exclusively the benchmark page. Navigation destroys
        # its timers and peer connections, then acknowledge the new document.
        # If the CLI itself is unreachable, retain identity for --resume and
        # report that termination has NOT been confirmed.
        try:
            current = snapshot(freeze=True)
            if current and current.get('signature') == signature:
                # Freeze publication of the active trial, then save all fully
                # completed results before destroying this benchmark document.
                persist_snapshot(current)
            if current and current.get('signature') == signature and not current['done']:
                subprocess.run(['agent-browser', '--session', a.session, 'open', 'about:blank'],
                    capture_output=True, text=True, check=True, timeout=20)
                if evaluate('location.href') != 'about:blank':
                    raise RuntimeError('Cancellation navigation was not acknowledged')
                (a.output / 'cancelled.json').write_text(json.dumps({'signature':signature,
                    'browserTerminationConfirmed':True,'savedResults':saved,
                    'completedResults':current['count'],'unrecoveredCompletedResults':current['count']-saved,
                    'interruptedTrial':current['active']}) + '\n')
        except Exception as cancellation_error:
            print('Browser termination UNCONFIRMED; inspect or resume this exact batch before other GPU work: '
                + str(cancellation_error), flush=True)
        raise


if __name__ == '__main__':
    main()
