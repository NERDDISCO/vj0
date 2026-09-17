#!/usr/bin/env python3
"""Run explicit GPU jobs serially, pausing an existing Node dispatcher safely.

Pod-only tool. Job file: [{"name": "...", "argv": [...], "cwd": "...",
"env": {...}, "timeout_seconds": 1800}]. Every result/log persists immediately.
The original dispatcher is resumed on completion or interruption and will
respawn its terminated inference worker. Never run alongside live benchmarks.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dispatcher-pid', type=int, required=True)
    p.add_argument('--jobs', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    jobs = json.loads(a.jobs.read_text())
    for job in jobs:
        if not job['name'].replace('-', '').replace('_', '').isalnum() or not job['argv']:
            p.error('Each job requires a simple name and explicit argv')
    proc = Path('/proc') / str(a.dispatcher_pid)
    if proc.joinpath('comm').read_text().strip() != 'node':
        raise RuntimeError('Expected the existing Node dispatcher')
    original_env = dict(entry.split('=', 1) for entry in proc.joinpath('environ').read_bytes().decode().split('\0') if '=' in entry)
    env = dict(os.environ)
    for key in ['PATH', 'LD_LIBRARY_PATH', 'HF_HOME', 'HF_HUB_CACHE', 'TORCHINDUCTOR_CACHE_DIR', 'INDUCTOR_PERSIST_DIR']:
        if key in original_env:
            env[key] = original_env[key]
    env.update(CUDA_VISIBLE_DEVICES='0', PYTHONUNBUFFERED='1', HF_HUB_OFFLINE='1')
    if a.output.exists() and any(a.output.iterdir()):
        raise RuntimeError('Output directory is not empty; choose a new run directory')
    a.output.mkdir(parents=True, exist_ok=True)
    results = []
    active = None

    def persist(status):
        temporary = a.output / 'sweep.json.tmp'
        temporary.write_text(json.dumps({'status': status,
            'dispatcher_pid': a.dispatcher_pid, 'runner_pid': os.getpid(), 'jobs': results}, indent=2) + '\n')
        temporary.replace(a.output / 'sweep.json')

    def interrupt(signum, frame):
        raise KeyboardInterrupt(f'signal {signum}')

    def cleanup_group(process):
        # The leader may already have exited while compiler children survive.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=10)

    def assert_gpu_idle():
        for attempt in range(10):
            gpu_processes = subprocess.check_output(['nvidia-smi', '--query-compute-apps=pid', '--format=csv,noheader'], text=True).strip()
            if not gpu_processes:
                return
            time.sleep(0.5)
        raise RuntimeError(f'GPU still has compute processes: {gpu_processes}')

    signal.signal(signal.SIGTERM, interrupt)
    signal.signal(signal.SIGINT, interrupt)
    persist('pausing-dispatcher')
    try:
        os.kill(a.dispatcher_pid, signal.SIGSTOP)
        children = []

        def descendants(pid):
            file = Path(f'/proc/{pid}/task/{pid}/children')
            for child in file.read_text().split() if file.exists() else []:
                descendants(int(child))
                children.append(int(child))

        descendants(a.dispatcher_pid)
        for pid in children:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        time.sleep(2)
        for pid in children:
            try:
                if Path(f'/proc/{pid}/stat').read_text().split()[2] != 'Z':
                    os.kill(pid, signal.SIGKILL)
            except (FileNotFoundError, ProcessLookupError):
                pass
        assert_gpu_idle()
        for job in jobs:
            record = {'name': job['name'], 'argv': job['argv'], 'cwd': job['cwd'],
                'started_at': datetime.now(timezone.utc).isoformat(), 'status': 'running'}
            results.append(record)
            with (a.output / (job['name'] + '.log')).open('w') as log:
                active = subprocess.Popen(job['argv'], cwd=job['cwd'], env={**env, **job.get('env', {})},
                    stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                record['pid'] = active.pid
                persist('running')
                print(json.dumps(record), flush=True)
                try:
                    code = active.wait(timeout=job.get('timeout_seconds', 1800))
                    record.update(status='passed' if code == 0 else 'failed', returncode=code)
                except subprocess.TimeoutExpired:
                    record.update(status='timed-out')
                cleanup_group(active)
                active = None
                assert_gpu_idle()
            record['finished_at'] = datetime.now(timezone.utc).isoformat()
            persist('running')
            print(json.dumps(record), flush=True)
        failed = any(result['status'] != 'passed' for result in results)
        persist('finished-with-failures' if failed else 'finished')
        return 1 if failed else 0
    except BaseException as error:
        results.append({'name': 'runner', 'status': 'interrupted' if isinstance(error, KeyboardInterrupt) else 'failed',
                        'error': str(error)})
        persist('interrupted' if isinstance(error, KeyboardInterrupt) else 'failed')
        raise
    finally:
        # A repeated interrupt or cleanup race must never bypass resume.
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        try:
            if active is not None:
                cleanup_group(active)
        finally:
            os.kill(a.dispatcher_pid, signal.SIGCONT)
            print('Original dispatcher resumed; its close handler respawns the worker.', flush=True)


if __name__ == '__main__':
    sys.exit(main())
