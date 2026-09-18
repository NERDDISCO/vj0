#!/usr/bin/env python3
"""Bounded, additive compiler-cache persistence after GPU jobs have completed.

Never deletes destination cache entries. Each changed regular file is copied to
a temporary sibling, size/source-stat checked, and atomically replaced. Symlinks
and special files are recorded and skipped. Existing cache files survive errors.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import tempfile
import time
from datetime import datetime, timezone


def gpu_idle():
    return not subprocess.check_output(['nvidia-smi','--query-compute-apps=pid',
                                        '--format=csv,noheader'],text=True,timeout=10).strip()


def persist(source,destination,proof,budget_seconds=100,reserve_bytes=256*1024*1024):
    start=time.monotonic();deadline=start+budget_seconds
    result={'status':'running','started_utc':datetime.now(timezone.utc).isoformat(),
            'source':str(source),'destination':str(destination),'budget_seconds':budget_seconds,
            'reserve_bytes':reserve_bytes,'source_files':0,'source_bytes':0,
            'copied_files':0,'copied_bytes':0,'unchanged_files':0,'unchanged_bytes':0,
            'skipped_symlinks_or_special':0,'deleted_files':0,'copy_policy':'additive, atomic file replacement; no destination deletion'}
    pending_temp=None
    def save():
        proof.parent.mkdir(parents=True,exist_ok=True)
        tmp=proof.with_suffix(proof.suffix+'.tmp')
        tmp.write_text(json.dumps(result,indent=2)+'\n');tmp.replace(proof)
    def check_time():
        if time.monotonic()>deadline:raise TimeoutError('Cache persistence time budget exceeded')
    def alarm(_signum,_frame):raise TimeoutError('Cache persistence alarm exceeded')
    previous_handler=signal.signal(signal.SIGALRM,alarm)
    signal.alarm(max(1,int(budget_seconds)))
    try:
        assert source.is_dir() and not source.is_symlink(), 'Source must be a real directory'
        source=source.resolve();destination=destination.resolve()
        assert source!=destination and source not in destination.parents and destination not in source.parents, 'Cache paths must be disjoint'
        assert gpu_idle(), 'GPU must be idle before cache persistence'
        result['gpu_idle_checked']=True
        destination.mkdir(parents=True,exist_ok=True)
        todo=[];growth=0;largest=0;inventory=hashlib.sha256()
        for base,dirs,files in os.walk(source,followlinks=False):
            check_time();base=Path(base)
            for name in list(dirs):
                if (base/name).is_symlink():dirs.remove(name);result['skipped_symlinks_or_special']+=1
            dirs.sort()
            for name in sorted(files):
                check_time();path=base/name;before=path.lstat()
                if not stat.S_ISREG(before.st_mode):result['skipped_symlinks_or_special']+=1;continue
                relative=path.relative_to(source);target=destination/relative
                result['source_files']+=1;result['source_bytes']+=before.st_size
                inventory.update((str(relative)+'\0'+str(before.st_size)+'\0'+str(before.st_mtime_ns)+'\n').encode())
                assert not target.is_symlink(), 'Destination file is a symlink: '+str(relative)
                prior=target.stat() if target.exists() else None
                if prior and stat.S_ISREG(prior.st_mode) and prior.st_size==before.st_size and prior.st_mtime_ns==before.st_mtime_ns:
                    result['unchanged_files']+=1;result['unchanged_bytes']+=before.st_size;continue
                if prior:assert stat.S_ISREG(prior.st_mode), 'Destination entry is not a regular file'
                growth+=max(0,before.st_size-(prior.st_size if prior else 0));largest=max(largest,before.st_size)
                todo.append((path,relative,before))
        result['inventory_metadata_sha256']=inventory.hexdigest()
        assert result['source_files']>0 and result['source_bytes']>0, 'Source cache contains no nonempty regular files'
        free=shutil.disk_usage(destination).free
        required=growth+largest+reserve_bytes
        result.update(free_bytes_before=free,required_spare_bytes=required,planned_copy_files=len(todo),
                      planned_copy_bytes=sum(row[2].st_size for row in todo))
        save()
        assert free>=required, 'Insufficient destination space including spare reserve'
        for path,relative,before in todo:
            check_time();target=destination/relative
            parent=destination
            for part in relative.parts[:-1]:
                parent=parent/part
                assert not parent.is_symlink(), 'Destination directory is a symlink'
                parent.mkdir(exist_ok=True)
            assert shutil.disk_usage(destination).free>=before.st_size+reserve_bytes, 'Destination spare reserve exhausted'
            fd,temp=tempfile.mkstemp(prefix='.vj0-cache-copy-',dir=target.parent);os.close(fd);pending_temp=Path(temp)
            shutil.copy2(path,pending_temp)
            after=path.stat()
            assert (after.st_size,after.st_mtime_ns,after.st_ino)==(before.st_size,before.st_mtime_ns,before.st_ino), 'Source changed during persistence'
            assert pending_temp.stat().st_size==before.st_size, 'Copied size differs'
            pending_temp.replace(target);pending_temp=None
            result['copied_files']+=1;result['copied_bytes']+=before.st_size
            if result['copied_files']%100==0:save()
        result['free_bytes_after']=shutil.disk_usage(destination).free
        result['status']='complete'
    except BaseException as error:
        result.update(status='failed',error=f'{type(error).__name__}: {error}')
    finally:
        signal.alarm(0);signal.signal(signal.SIGALRM,previous_handler)
        if pending_temp is not None:
            try:pending_temp.unlink(missing_ok=True)
            except OSError:pass
        result['elapsed_seconds']=time.monotonic()-start
        result['finished_utc']=datetime.now(timezone.utc).isoformat();save()
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=Path('/tmp/torchinductor_root'))
    parser.add_argument('--destination',type=Path,default=Path('/workspace/torch-inductor-cache'))
    parser.add_argument('--proof',type=Path,required=True)
    parser.add_argument('--budget-seconds',type=int,default=100)
    args=parser.parse_args()
    if not 1<=args.budget_seconds<=110:parser.error('Budget must be1..110seconds')
    result=persist(args.source,args.destination,args.proof,args.budget_seconds)
    print(json.dumps(result),flush=True)
    return 0 if result['status']=='complete' else 1


if __name__=='__main__':raise SystemExit(main())
