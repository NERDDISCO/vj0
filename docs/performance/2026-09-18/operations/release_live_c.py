#!/usr/bin/env python3
"""Release the owned C live experiment after browser capture has drained."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import time
import urllib.request


def process_state(pid):
    return Path(f'/proc/{pid}/stat').read_text().rpartition(') ')[2].split()[0]


def group_members(pgid):
    result = []
    for path in Path('/proc').iterdir():
        if not path.name.isdigit():
            continue
        try:
            if os.getpgid(int(path.name)) == pgid:
                result.append({'pid': int(path.name), 'state': process_state(path.name)})
        except (ProcessLookupError, FileNotFoundError):
            pass
    return result


def live_members(members):
    # A zombie cannot execute or hold a CUDA context/cache writer open. Retain
    # it in evidence, but do not wait indefinitely for container PID 1 to reap it.
    return [member for member in members if member['state'] != 'Z']


def validate_capture_completion(record, pid, runtime_sha256, now):
    assert record.get('status') == 'complete'
    assert record.get('owned_pgid') == pid
    assert record.get('runtime_sha256') == runtime_sha256
    for key in ('ordered_barrier_passed', 'cleanup_acknowledged', 'critical_artifacts_saved'):
        assert record.get(key) is True, f'Capture handoff lacks {key}'
    completed = record.get('completed_epoch')
    assert isinstance(completed, (float, int)) and not isinstance(completed, bool)
    assert math.isfinite(completed) and 0 < completed <= now + 60, 'Invalid capture completion timestamp'


def validate_idle_debug(debug, worker_count):
    workers = debug.get('workers')
    assert isinstance(workers, list) and len(workers) == worker_count
    assert all(w['framePending'] == 0 and 'compileStartedAt' in w and not w['compileStartedAt']
               and 'mailboxFlightSource' in w and w['mailboxFlightSource'] is None for w in workers)
    # diagStats.channelState can describe an older channel; use the actual
    # active channel object. The handoff supplies the ordered barrier proof.
    assert 'channel' in debug
    channel = debug['channel']
    assert channel is None or channel.get('readyState') == 'closed', 'Active channel not closed'


def signal_owned(pid, sig, *, group=False):
    try:
        (os.killpg if group else os.kill)(pid, sig)
    except ProcessLookupError:
        pass  # The already-verified owned process/group completed naturally.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--capture-completion', type=Path,
        help='Required with --execute: completed handoff with owned_pgid, runtime_sha256, '
             'completed_epoch and true ordered_barrier_passed, cleanup_acknowledged, '
             'critical_artifacts_saved fields')
    args = parser.parse_args()
    directory = Path('/workspace/vj0-next-live-c-20260918')
    pid = 34687
    original_pid = 568
    output = directory / 'release.json'
    if not args.execute:
        print(json.dumps({'mode': 'plan-only', 'directory': str(directory),
                          'owned_pgid': pid, 'original_paused_pid': original_pid}))
        return
    assert not output.exists(), 'Preserve any prior release attempt'
    assert args.capture_completion, '--capture-completion is required'
    runtime_bytes = (directory / 'runtime.json').read_bytes()
    runtime = json.loads(runtime_bytes)
    capture_bytes = args.capture_completion.read_bytes()
    capture = json.loads(capture_bytes)
    validate_capture_completion(capture, pid, hashlib.sha256(runtime_bytes).hexdigest(), time.time())
    assert runtime['pid'] == pid and os.getpgid(pid) == pid
    assert Path(f'/proc/{pid}/cwd').resolve() == directory
    command = Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
    assert any(part.endswith(b'node') for part in command)
    assert any(part.endswith(b'server.js') for part in command)
    assert process_state(original_pid) == 'T'
    assert hashlib.sha256((directory / 'server.js').read_bytes()).hexdigest() == '8abdfb33cd5c72cba3efbac662ca2bef5805e16ffca06c96285b18ebc0b4674c'
    request = urllib.request.Request('http://127.0.0.1:3001/debug',
        headers={'User-Agent': 'Mozilla/5.0 vj0-performance-benchmark'})
    with urllib.request.urlopen(request, timeout=10) as response:
        debug = json.load(response)
    validate_idle_debug(debug, runtime['worker_count'])

    record = {'status': 'releasing', 'released': False, 'started_epoch': time.time(), 'owned_pgid': pid,
              'original_paused_pid': original_pid, 'runtime': runtime,
              'runtime_sha256': hashlib.sha256(runtime_bytes).hexdigest(),
              'capture_completion': capture,
              'capture_completion_path': str(args.capture_completion),
              'capture_completion_sha256': hashlib.sha256(capture_bytes).hexdigest(),
              'critical_artifacts_saved': True,
              'debug_observed_epoch': time.time(), 'debug_before': debug,
              'members_before': group_members(pid)}

    def save():
        temporary = output.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(record, indent=2) + '\n')
        temporary.replace(output)

    def interrupted(signum, _frame):
        raise SystemExit(128 + signum)

    previous = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGINT, signal.SIGTERM)}
    save()
    try:
        # Let the dispatcher reap workers before escalating within this owned group.
        signal_owned(pid, signal.SIGTERM)
        for sig, grace in ((None, 8), (signal.SIGTERM, 8), (signal.SIGKILL, 5)):
            if sig is not None and live_members(group_members(pid)):
                signal_owned(pid, sig, group=True)
            deadline = time.monotonic() + grace
            while live_members(group_members(pid)) and time.monotonic() < deadline:
                time.sleep(.2)
            if not live_members(group_members(pid)):
                break
        record['members_after'] = group_members(pid)
        record['live_members_after'] = live_members(record['members_after'])
        record['zombie_members_after'] = [m for m in record['members_after'] if m['state'] == 'Z']
        record['gpu_compute_after'] = subprocess.check_output(
            ['nvidia-smi', '--query-compute-apps=pid,process_name', '--format=csv,noheader'],
            text=True, timeout=15).strip()
        record['original_state_after'] = process_state(original_pid)
        record['released'] = (not record['live_members_after'] and not record['gpu_compute_after']
                              and record['original_state_after'] == 'T')
        record['status'] = 'released' if record['released'] else 'failed'
    except BaseException as error:
        record.update(status='failed', error=f'{type(error).__name__}: {error}')
        raise
    finally:
        # Repeated terminal signals must not interrupt the final evidence write.
        for sig in previous:
            signal.signal(sig, signal.SIG_IGN)
        record['finished_epoch'] = time.time()
        save()
        print(json.dumps(record))
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    assert record['released'], 'Resolve release before archiving caches or stopping the pod'


if __name__ == '__main__':
    main()
