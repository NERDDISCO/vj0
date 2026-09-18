#!/usr/bin/env python3
"""Preserve completed C experiment caches only after the GPU slot is idle."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import signal
import stat
import subprocess
import tarfile
import time


def remaining(deadline):
    value = deadline - time.monotonic()
    if value <= 0:
        raise TimeoutError('Cache preservation deadline expired')
    return value


def hash_stream(stream, deadline):
    digest = hashlib.sha256()
    size = 0
    while True:
        remaining(deadline)
        block = stream.read(1024 * 1024)
        if not block:
            return digest.hexdigest(), size
        digest.update(block)
        size += len(block)


def cache_inventory(parent, names, deadline):
    """Hash ordinary files; preserve symlinks without following external targets."""
    rows = {}

    def visit(path):
        remaining(deadline)
        info = path.lstat()
        key = path.relative_to(parent).as_posix()
        row = {'mode': stat.S_IMODE(info.st_mode), 'mtime_ns': info.st_mtime_ns,
               'inode': info.st_ino, 'device': info.st_dev}
        if stat.S_ISDIR(info.st_mode):
            row['type'] = 'directory'
            rows[key] = row
            for child in sorted(path.iterdir()):
                visit(child)
            return
        if stat.S_ISREG(info.st_mode):
            with path.open('rb') as stream:
                digest, size = hash_stream(stream, deadline)
            after = path.lstat()
            assert (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns) == (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), 'Cache changed during inventory'
            assert size == info.st_size
            row.update(type='file', bytes=size, sha256=digest)
        elif stat.S_ISLNK(info.st_mode):
            row.update(type='symlink', target=os.readlink(path))
        else:
            raise ValueError(f'Unsupported cache entry: {path}')
        rows[key] = row

    for name in names:
        path = parent / name
        assert path.is_dir() and not path.is_symlink(), 'Expected real top-level cache directory'
        visit(path)
    return rows


def verify_archive(archive_path, inventory, deadline):
    """Verify exact member coverage and file payloads, including hard-link targets."""
    seen = set()
    with tarfile.open(archive_path, 'r:') as archive:
        for member in archive:
            remaining(deadline)
            key = member.name.rstrip('/')
            path = PurePosixPath(key)
            assert not path.is_absolute() and '..' not in path.parts
            assert key in inventory and key not in seen, f'Unexpected/duplicate archive member: {key}'
            seen.add(key)
            row = inventory[key]
            assert stat.S_IMODE(member.mode) == row['mode'], f'Mode differs: {key}'
            if row['type'] == 'directory':
                assert member.isdir(), key
            elif row['type'] == 'symlink':
                assert member.issym() and member.linkname == row['target'], key
            else:
                assert member.isfile() or member.islnk(), key
                if member.islnk():
                    target = PurePosixPath(member.linkname)
                    assert not target.is_absolute() and '..' not in target.parts
                    assert member.linkname in inventory, key
                with archive.extractfile(member) as stream:
                    digest, size = hash_stream(stream, deadline)
                assert size == row['bytes'] and digest == row['sha256'], f'Payload differs: {key}'
    assert seen == set(inventory), 'Archive omits source entries'
    with archive_path.open('rb') as stream:
        digest, size = hash_stream(stream, deadline)
    return {'archive_sha256': digest, 'archive_bytes': size,
            'verified_members': len(seen),
            'verified_regular_files': sum(row['type'] == 'file' for row in inventory.values())}


def current_live_group_members(pgid):
    members = []
    for path in Path('/proc').iterdir():
        if not path.name.isdigit():
            continue
        try:
            if os.getpgid(int(path.name)) == pgid:
                state = (path / 'stat').read_text().rpartition(') ')[2].split()[0]
                if state != 'Z':
                    members.append(int(path.name))
        except (ProcessLookupError, FileNotFoundError):
            pass
    return members


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--release', type=Path,
                        default=Path('/workspace/vj0-next-live-c-20260918/release.json'))
    args = parser.parse_args()
    names = ['vj0-n05-inductor', 'vj0-n05-triton', 'vj0-n05-flashinfer',
             'vj0-c-torch213', 'vj0-c-triton213',
             'vj0-c-live-torch213', 'vj0-c-live-triton213']
    destination = Path('/workspace/vj0-C-20260918-final-caches.tar')
    partial = destination.with_suffix('.tar.partial')
    proof = destination.with_suffix('.json')
    manifest_path = destination.with_suffix('.manifest.json')
    state = {'status': 'plan-only', 'source_parent': '/tmp', 'candidate_names': names,
             'destination': str(destination), 'cap_seconds': 180,
             'declared_workspace_capacity_bytes': 160_000_000_000,
             'cache_optional': True, 'release_path': str(args.release)}
    if not args.execute:
        print(json.dumps(state, indent=2))
        return
    release_bytes = args.release.read_bytes()
    release = json.loads(release_bytes)
    assert release.get('status') == 'released' and release.get('released') is True
    assert release.get('critical_artifacts_saved') is True
    assert release.get('live_members_after') == [] and release.get('gpu_compute_after') == ''
    assert release.get('original_state_after') == 'T' and release.get('owned_pgid') == 34687
    assert not current_live_group_members(release['owned_pgid']), 'Live cache writer group remains'
    assert Path('/proc/568/stat').read_text().rpartition(') ')[2].split()[0] == 'T'
    assert not subprocess.check_output(
        ['nvidia-smi', '--query-compute-apps=pid', '--format=csv,noheader'], text=True, timeout=15).strip()
    # From here cache failure is explicitly non-blocking for pod stop: critical
    # evidence is saved and the verified experiment group is no longer running.
    state.update(stop_ready=True, stop_blocked_by_cache=False,
                 release_sha256=hashlib.sha256(release_bytes).hexdigest())
    if any(p.exists() for p in (destination, partial, proof, manifest_path)):
        state.update(status='cache-preservation-skipped-optional',
                     error='Prior cache attempt exists and was preserved; inspect its recorded outcome')
        print(json.dumps(state, indent=2))
        return
    selected = [name for name in names if (Path('/tmp') / name).exists()]
    start = time.monotonic()
    deadline = start + 180
    state.update(status='running', selected_names=selected, gpu_idle=True,
                 missing_names=[name for name in names if name not in selected],
                 started_utc=datetime.datetime.now(datetime.timezone.utc).isoformat())

    def save():
        temp = proof.with_suffix('.json.tmp')
        temp.write_text(json.dumps(state, indent=2) + '\n')
        temp.replace(proof)

    def interrupted(signum, _frame):
        raise SystemExit(128 + signum)

    previous = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGINT, signal.SIGTERM)}
    save()
    try:
        assert selected, 'No expected caches found'
        inventory = cache_inventory(Path('/tmp'), selected, deadline)
        size = sum(row.get('bytes', 0) for row in inventory.values())
        # Reserve content padding plus generous per-entry POSIX/PAX headers;
        # 2x payload alone is insufficient for a tree containing tiny files.
        estimated_tar = sum(((row.get('bytes', 0) + 511) // 512) * 512 + 8192
                            for row in inventory.values()) + 10240
        reserve = max(size * 2, estimated_tar) + 64 * 1024 * 1024
        workspace_used = int(subprocess.check_output(
            ['du', '-sb', '/workspace'], text=True, timeout=remaining(deadline)).split()[0])
        state.update(source_bytes=size, workspace_used_bytes=workspace_used,
                     reserved_archive_bytes=reserve,
                     external_symlink_targets_unfollowed=True)
        assert workspace_used + reserve < state['declared_workspace_capacity_bytes'], 'Workspace quota headroom insufficient'
        assert shutil.disk_usage('/workspace').free > reserve
        manifest_bytes = (json.dumps(inventory, indent=2) + '\n').encode()
        with manifest_path.open('xb') as stream:
            stream.write(manifest_bytes)
        state['source_manifest_sha256'] = hashlib.sha256(manifest_bytes).hexdigest()
        state['source_manifest_path'] = str(manifest_path)
        with destination.with_suffix('.log').open('xb') as log:
            subprocess.run(['tar', '--format=posix', '-cf', str(partial), '-C', '/tmp', *selected],
                           stdout=log, stderr=subprocess.STDOUT, check=True, timeout=remaining(deadline))
        state.update(verify_archive(partial, inventory, deadline))
        remaining(deadline)
        partial.rename(destination)
        state.update(status='complete', readable_archive_checked=True,
                     source_payloads_verified=True)
    except BaseException as error:
        state.update(status='cache-preservation-failed-optional', error=f'{type(error).__name__}: {error}',
                     partial_bytes=partial.stat().st_size if partial.exists() else 0)
        # Do not erase failure/partial evidence or let an optional cache archive
        # hold a paid, already-idle pod open after critical results are saved.
    finally:
        for sig in previous:
            signal.signal(sig, signal.SIG_IGN)
        state.update(elapsed_seconds=time.monotonic() - start,
                     finished_utc=datetime.datetime.now(datetime.timezone.utc).isoformat())
        save()
        print(json.dumps(state, indent=2), flush=True)
        for sig, handler in previous.items():
            signal.signal(sig, handler)


if __name__ == '__main__':
    main()
