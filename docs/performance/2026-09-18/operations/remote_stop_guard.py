#!/usr/bin/env python3
"""Pod-local hard deadline. Credential arrives on stdin and stays only in RAM.

Runs independently of the laptop. Uses the documented Runpod stop endpoint;
never deletes storage. The local controller must still verify runtimeStatus.
"""
import argparse
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--pod', required=True)
    p.add_argument('--seconds', type=int, required=True)
    p.add_argument('--state', type=Path, required=True)
    p.add_argument('--daemon', action='store_true')
    args = p.parse_args()
    container_env = dict(item.split(b'=', 1) for item in
                         Path('/proc/1/environ').read_bytes().split(b'\0') if b'=' in item)
    own_pod = os.environ.get('RUNPOD_POD_ID') or container_env.get(b'RUNPOD_POD_ID', b'').decode()
    if args.pod != own_pod:
        p.error('Only this container\'s own pod may be stopped')
    if not 60 <= args.seconds <= 21600:
        p.error('Deadline must be between one minute and six hours')
    if args.state.exists():
        p.error('Refusing an existing run state')
    key = input().strip()
    if not key:
        p.error('Missing credential on stdin')
    base = 'https://rest.runpod.io/v1/pods/' + args.pod

    def request(method, suffix=''):
        req = urllib.request.Request(base + suffix, method=method,
            headers={'Authorization': 'Bearer ' + key, 'User-Agent': 'vj0-stop-watchdog/1',
                     'Content-Type': 'application/json'},
            data=b'{}' if method == 'POST' else None)
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else {}

    # Verify the credential/target without changing the pod before arming.
    status, target = request('GET')
    if status != 200 or target.get('id') != args.pod:
        raise SystemExit('Credential/target preflight failed')
    deadline = time.time() + args.seconds
    if args.daemon:
        pid = os.fork()
        if pid:
            print(json.dumps({'pod': args.pod, 'guard_pid': pid,
                              'deadline_epoch': deadline, 'preflight_http': status}), flush=True)
            return
        os.setsid()
        with open(os.devnull, 'r+b', buffering=0) as null:
            for fd in (0, 1, 2):
                os.dup2(null.fileno(), fd)
    state = {'pod': args.pod, 'pid': os.getpid(), 'deadline_epoch': deadline,
             'status': 'armed', 'preflight_http': status}

    def save():
        temporary = args.state.with_suffix('.tmp')
        temporary.write_text(json.dumps(state, indent=2) + '\n')
        temporary.replace(args.state)

    save()
    while time.time() < deadline:
        time.sleep(min(15, max(0, deadline - time.time())))
    for attempt in range(20):
        state.update(status='stop-requested', attempt=attempt, attempted_epoch=time.time())
        save()
        try:
            status, _ = request('POST', '/stop')
            state.update(status='stop-accepted', stop_http=status)
            save()
            return
        except urllib.error.HTTPError as error:
            state.update(status='stop-error', http=error.code)
        except Exception as error:
            state.update(status='stop-error', error_type=type(error).__name__)
        save()
        time.sleep(min(30, 5 + attempt * 3))


if __name__ == '__main__':
    main()
