#!/usr/bin/env python3
"""Release only the owned, drained Pod A experiment service for GPU tests."""
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import urllib.request

directory = Path('/workspace/vj0-next-live-a-20260918')
output = directory / 'release.json'
assert not output.exists(), 'Preserve the prior release attempt'
runtime = json.loads((directory / 'runtime.json').read_text())
pid = runtime['pid']
assert pid == 1089 and os.getpgid(pid) == pid
assert Path(f'/proc/{pid}/cwd').resolve() == directory
assert Path('/proc/496/stat').read_text().split()[2] == 'T'
request = urllib.request.Request('http://127.0.0.1:3001/debug',
    headers={'User-Agent': 'Mozilla/5.0 vj0-performance-benchmark'})
with urllib.request.urlopen(request, timeout=10) as response:
    debug = json.load(response)
assert all(w['framePending'] == 0 and not w.get('compileStartedAt') for w in debug['workers'])
assert debug['stats'].get('channelState') in (None, 'null', 'closed')


def members():
    result = []
    for path in Path('/proc').iterdir():
        if not path.name.isdigit():
            continue
        try:
            if os.getpgid(int(path.name)) == pid:
                result.append({'pid': int(path.name),
                    'state': (path / 'stat').read_text().rpartition(') ')[2].split()[0]})
        except (ProcessLookupError, FileNotFoundError):
            pass
    return result


record = {'started_epoch': time.time(), 'owned_pgid': pid, 'original_paused_pid': 496,
          'debug_before': debug, 'members_before': members()}
# Let the dispatcher send its own shutdown message and reap the worker before
# its two-second exit timer, instead of killing parent and child simultaneously.
os.kill(pid, signal.SIGTERM)
for sig, grace in ((None, 8), (signal.SIGTERM, 8), (signal.SIGKILL, 5)):
    if sig is not None and any(m['state'] != 'Z' for m in members()):
        os.killpg(pid, sig)
    deadline = time.monotonic() + grace
    while members() and time.monotonic() < deadline:
        time.sleep(.2)
    if not members():
        break
record['members_after'] = members()
record['gpu_compute_after'] = subprocess.check_output(
    ['nvidia-smi', '--query-compute-apps=pid,process_name', '--format=csv,noheader'], text=True).strip()
record['original_state_after'] = Path('/proc/496/stat').read_text().split()[2]
record['finished_epoch'] = time.time()
record['released'] = not record['members_after'] and not record['gpu_compute_after'] and record['original_state_after'] == 'T'
output.write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record))
assert record['released'], 'Do not start compute until release is resolved'
