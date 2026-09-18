#!/usr/bin/env python3
"""One-shot replacement of this run's guards, without any unguarded interval.

Only the two already authorized experiment pods are in scope. A new local and
pod-local guard must both be verified before either old guard is terminated.
The API credential travels only on SSH stdin, never in arguments or artifacts.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shlex
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
CONFIG = {
    'a': ('0pxb4bss2jmbhg', 40098, '2026-09-18T11:00:00+00:00'),
    'c': ('v09w5n4ljqcjvj', 40093, '2026-09-18T12:50:00+00:00'),
}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--execute', action='store_true')
    args = p.parse_args()
    if not args.execute:
        print(json.dumps({'mode': 'plan-only', 'guards': CONFIG}, indent=2))
        return
    key = os.environ['RUNPOD_API_KEY']
    ledger = ROOT / 'guard-replacement-01.json'
    assert not ledger.exists(), 'Preserve the prior attempt ledger'
    user = json.loads(subprocess.check_output(['runpodctl', 'user'], text=True))
    record = {'started_epoch': time.time(), 'balance_before': {
        k: user.get(k) for k in ('clientBalance', 'currentSpendPerHr')}, 'pods': []}
    assert user['clientBalance'] > 19, 'Reassess the bounded budget first'

    def save():
        ledger.write_text(json.dumps(record, indent=2) + '\n')

    save()
    for short, (pod, port, deadline) in CONFIG.items():
        seconds = int(datetime.fromisoformat(deadline).timestamp() - time.time())
        assert 60 <= seconds <= 21600
        old_tag, tag = '20260918-next-' + short, '20260918-next-' + short + '2'
        state = Path('/tmp/vj0-pod-stop-guard-' + tag + '.json')
        runtime = Path('/tmp/vj0-next-' + short + '2-runtime.json')
        remote_old = '/workspace/vj0-next-' + short + '-remote-guard.json'
        remote_new = '/workspace/vj0-next-' + short + '-remote-guard2.json'
        assert not state.exists() and not runtime.exists()
        old_local = json.loads(Path('/tmp/vj0-pod-stop-guard-' + old_tag + '.json').read_text())
        assert old_local['pod'] == pod and old_local['status'] == 'armed'
        old_command = subprocess.check_output(['ps', '-p', str(old_local['pid']), '-o', 'command='], text=True)
        assert 'local_stop_guard.py' in old_command and '/tmp/vj0-next-' + short + '-runtime.json' in old_command
        ssh = ['ssh', '-i', '/Users/nerddisco/.runpod/ssh/RunPod-Key-Go', '-p', str(port),
               '-o', 'HostKeyAlias=[213.192.2.81]:40032', '-o', 'UserKnownHostsFile=/tmp/vj0-perf-known-hosts',
               '-o', 'StrictHostKeyChecking=yes', 'root@213.192.2.81']

        def remote(code):
            return json.loads(subprocess.check_output(ssh + [shlex.join(['python3', '-c', code])], text=True, timeout=40))

        expected_sha = hashlib.sha256((ROOT / 'remote_stop_guard.py').read_bytes()).hexdigest()
        preflight = remote("import hashlib,json;from pathlib import Path;"
            "print(json.dumps({'sha':hashlib.sha256(Path('/tmp/vj0-next-stop-guard.py').read_bytes()).hexdigest(),"
            "'old':json.loads(Path(" + repr(remote_old) + ").read_text())}))")
        assert preflight['sha'] == expected_sha and preflight['old']['pod'] == pod
        argv = ['python3', '/tmp/vj0-next-stop-guard.py', '--pod', pod, '--seconds', str(seconds),
                '--state', remote_new, '--daemon']
        armed = subprocess.run(ssh + [shlex.join(argv)], input=key + '\n', capture_output=True,
                               text=True, timeout=45, check=True)
        row = {'pod': pod, 'requested_deadline_utc': deadline, 'old_local': old_local,
               'old_remote': preflight['old'], 'new_remote_arm': json.loads(armed.stdout)}
        record['pods'].append(row); save()
        runtime.write_text(json.dumps({'pod_id': pod, 'authorized_test_pods': [pod], 'run_tag': tag}) + '\n')
        with Path('/tmp/vj0-next-' + short + '2-guard.log').open('x') as log:
            proc = subprocess.Popen(['caffeinate', '-is', sys.executable, str(ROOT / 'local_stop_guard.py'),
                '--runtime', str(runtime), '--seconds', str(seconds), '--execute'],
                stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        row['local_launcher_pid'] = proc.pid; save()
        until = time.monotonic() + 10
        while not state.exists() and time.monotonic() < until:
            time.sleep(.1)
        local = json.loads(state.read_text())
        assert local['pod'] == pod and local['status'] == 'armed'
        os.kill(local['pid'], 0)
        new_remote = remote("import os,json;from pathlib import Path;"
            "s=json.loads(Path(" + repr(remote_new) + ").read_text());os.kill(s['pid'],0);print(json.dumps(s))")
        assert new_remote['pod'] == pod and new_remote['status'] == 'armed'
        assert new_remote['pid'] == row['new_remote_arm']['guard_pid']
        row.update(new_local=local, new_remote_verified=new_remote, replacement_verified_epoch=time.time()); save()
        # Both replacements are now active. Retire only the identified old guards.
        retired = remote("import os,signal,json;from pathlib import Path;"
            "s=json.loads(Path(" + repr(remote_old) + ").read_text());"
            "cmd=Path('/proc/'+str(s['pid'])+'/cmdline').read_bytes();"
            "assert b'vj0-next-stop-guard.py' in cmd and " + repr(remote_old.encode()) + " in cmd;"
            "os.kill(s['pid'],signal.SIGTERM);print(json.dumps({'retired_pid':s['pid']}))")
        current_command = subprocess.check_output(['ps', '-p', str(old_local['pid']), '-o', 'command='], text=True)
        assert current_command == old_command
        os.kill(old_local['pid'], signal.SIGTERM)
        row.update(old_remote_retired=retired, old_local_retired_pid=old_local['pid']); save()
    record['status'] = 'both-guard-pairs-replaced'
    record['finished_epoch'] = time.time(); save()
    print(json.dumps({'status': record['status'], 'ledger': str(ledger), 'balance_before': record['balance_before']}))


if __name__ == '__main__':
    main()
