#!/usr/bin/env python3
"""Reuse completed same-stack FP8 compilation artifacts before N06 warmup."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    pairs = [('/tmp/vj0-c-torch213', '/tmp/vj0-c-live-torch213'),
             ('/tmp/vj0-c-triton213', '/tmp/vj0-c-live-triton213')]
    record = {'status': 'plan-only', 'pairs': pairs,
              'scope': 'Untimed setup; both live arms still require all-shape warmup. No N05 cache or cold-start comparison.',
              'original_cache_paths_retained': True, 'cap_seconds': 120}
    if not args.execute:
        print(json.dumps(record, indent=2))
        return
    proof_path = Path('/workspace/vj0-next-c-live-cache-seed.json')
    assert not proof_path.exists()
    runner_path = Path('/workspace/vj0-next-c-production/run-status.json')
    runner_bytes = runner_path.read_bytes()
    runner = json.loads(runner_bytes)
    assert runner['status'] == 'complete' and runner['exit_code'] == 0
    assert runner['result_status'] == 'complete'
    result_path = Path('/workspace/vj0-next-c-production-results/result.json')
    result_bytes = result_path.read_bytes()
    result = json.loads(result_bytes)
    assert result['status'] == 'complete'
    process_rows = subprocess.check_output(['ps', '-eo', 'pid,pgid,stat,args'], text=True).splitlines()[1:]
    for line in process_rows:
        fields = line.split(None, 3)
        assert int(fields[1]) != runner['child_pid'], 'Production process group still exists'
        assert '/torch/_inductor/compile_worker' not in fields[-1], 'Compiler worker still exists'
    assert Path('/proc/568/stat').read_text().split()[2] == 'T'
    assert not subprocess.check_output(
        ['nvidia-smi', '--query-compute-apps=pid', '--format=csv,noheader'], text=True).strip()
    live = Path('/workspace/vj0-next-live-c-20260918')
    assert not any((live / name).exists() for name in ('runtime.json', 'service.log'))
    assert hashlib.sha256((live / 'launch.py').read_bytes()).hexdigest() == '5028ea47213935e729519e91f4a563a00673536337096b449a67dd8871a44334'
    for source, destination in pairs:
        assert Path(source).is_dir() and not Path(destination).exists()
    started = time.monotonic()
    record.update(status='copying', started_epoch=time.time(), gpu_idle=True,
                  completed_runner_sha256=hashlib.sha256(runner_bytes).hexdigest(),
                  completed_result_sha256=hashlib.sha256(result_bytes).hexdigest(),
                  proof_versions=result['versions'], proof_python=runner['argv'][0],
                  gpu_inventory=subprocess.check_output(['nvidia-smi', '--query-gpu=name,uuid,driver_version',
                      '--format=csv,noheader'], text=True).strip(),
                  process_group_absent=runner['child_pid'],
                  cache_state_note='Completed tree copied intact; inert regular lock files carry no OS-held lock. Special entries are rejected. No live CUDA graphs/model/RNG state transfers.',
                  trees=[])

    def save():
        tmp = proof_path.with_suffix('.json.tmp')
        tmp.write_text(json.dumps(record, indent=2) + '\n')
        tmp.replace(proof_path)

    def remaining():
        value = 120 - (time.monotonic() - started)
        if value <= 0:
            raise TimeoutError('Cache copy/check deadline exceeded')
        return value

    def digest(path):
        h = hashlib.sha256()
        with path.open('rb') as stream:
            while chunk := stream.read(1024 * 1024):
                remaining()
                h.update(chunk)
        return h.hexdigest()

    def inventory(root):
        entries = {}
        for path in sorted(root.rglob('*')):
            remaining()
            name = str(path.relative_to(root))
            if path.is_symlink():
                entries[name] = {'type': 'symlink', 'target': str(path.readlink())}
            elif path.is_dir():
                entries[name] = {'type': 'directory'}
            elif path.is_file():
                entries[name] = {'type': 'file', 'bytes': path.stat().st_size, 'sha256': digest(path)}
            else:
                raise ValueError('Unexpected special cache entry: ' + name)
        return entries

    save()
    try:
        rows = subprocess.check_output(['du', '-sb', *[p[0] for p in pairs]],
                                       text=True, timeout=remaining()).splitlines()
        size = sum(int(row.split()[0]) for row in rows)
        assert shutil.disk_usage('/tmp').free > size * 2
        record['source_bytes'] = size
        for source, destination in pairs:
            subprocess.run(['cp', '-a', source, destination], check=True, timeout=remaining())
            a, b = inventory(Path(source)), inventory(Path(destination))
            assert a == b, 'Copied cache bytes/paths differ'
            record['trees'].append({'source': source, 'destination': destination,
                                    'verified_equal': True, 'entries': a})
            save()
        assert runner_path.read_bytes() == runner_bytes and result_path.read_bytes() == result_bytes
        record['status'] = 'verified'
    except BaseException as error:
        record.update(status='failed', error=f'{type(error).__name__}: {error}')
        raise
    finally:
        record.update(finished_epoch=time.time(), elapsed_seconds=time.monotonic() - started)
        save()
        print(json.dumps({key: value for key, value in record.items() if key != 'trees'}), flush=True)


if __name__ == '__main__':
    main()
