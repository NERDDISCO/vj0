#!/usr/bin/env python3
"""Run a frozen N03/N04 bundle serially after the root releases Pod A's GPU.

This runs on the pod. It never starts/stops/deletes a pod or touches the live
service/process group. Only subprocess groups created by this runner may be
terminated. An external root-owned pod cost guard remains required.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

SAFE_ENV_KEYS = ('PATH','LD_LIBRARY_PATH','HF_HOME','HF_HUB_CACHE','INDUCTOR_PERSIST_DIR')
REQUIRED_SOURCES = ('inference_server.py','worker_runtime.py','bench/n03n04_common.py',
                    'bench/n03_fp8_gemm.py','bench/n04_vae.py','bench/metrics.py',
                    'bench/bench_terminal_followup.py','bench/terminal_noop.py','bench/gpu_output_cast.py')


def utc():
    return datetime.now(timezone.utc).isoformat()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def atomic_json(path, data):
    temporary=path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(data,indent=2)+'\n')
    temporary.replace(path)


def group_members(pgid):
    result=[]
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():continue
        try:
            pid=int(entry.name)
            if os.getpgid(pid)==pgid:
                result.append(pid)
        except ProcessLookupError:
            continue
    return result


def verify_sources(bundle, expected_manifest_sha):
    manifest_path=bundle/'hashes.json'
    if digest(manifest_path)!=expected_manifest_sha:
        raise RuntimeError('Frozen source manifest hash differs from reviewed input')
    expected=json.loads(manifest_path.read_text())
    if not all(name in expected for name in REQUIRED_SOURCES):
        raise RuntimeError('Frozen bundle omits required source files')
    for name, value in expected.items():
        path=(bundle/name).resolve()
        if not path.is_relative_to(bundle.resolve()):
            raise RuntimeError('Source manifest escapes bundle')
        if not path.is_file() or digest(path)!=value:
            raise RuntimeError('Frozen source mismatch: '+name)
    return expected


def paused_original_environment(pid):
    directory=Path('/proc')/str(pid)
    status=(directory/'status').read_text()
    state=next(line for line in status.splitlines() if line.startswith('State:'))
    if state.split()[1] not in ('T','t'):
        raise RuntimeError('Original dispatcher is not paused: '+state)
    pairs={}
    for item in (directory/'environ').read_bytes().split(b'\0'):
        if b'=' in item:
            key,value=item.split(b'=',1)
            pairs[key.decode()]=value.decode()
    env={key:pairs[key] for key in SAFE_ENV_KEYS if key in pairs}
    if 'PATH' not in env:
        raise RuntimeError('Original process lacks PATH')
    env.update(CUDA_VISIBLE_DEVICES='0',HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',
               COMPILE_MODE='reduce-overhead',PYTHONUNBUFFERED='1',
               USE_TERMINAL_NOOP='1',USE_GPU_OUTPUT_CAST='1',USE_VAE_FP8='1',
               TORCHINDUCTOR_CACHE_DIR='/tmp/torchinductor_root',
               TRITON_CACHE_DIR='/tmp/torchinductor_root/triton/0')
    # Deliberately omit thread-count overrides: the worker must retain native128.
    return env,state


def gpu_processes():
    text=subprocess.check_output(['nvidia-smi','--query-compute-apps=pid,process_name,used_gpu_memory',
                                  '--format=csv,noheader'],text=True,timeout=15).strip()
    return text


def stop_owned_group(process, grace=30):
    # This function only receives a Popen created below with start_new_session=True.
    try:os.killpg(process.pid,signal.SIGTERM)
    except ProcessLookupError:pass
    try:process.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        try:os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        process.wait(timeout=15)
    leftovers=group_members(process.pid)
    if leftovers:
        try:os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError:pass
    return leftovers


def result_summary(path):
    if not path.is_file():return {'status':'absent'}
    try:
        data=json.loads(path.read_text())
        records=data.get('records',[])
        return {'status':data.get('status'),'error':data.get('error'),
                'record_count':len(records),
                'last_record_status':records[-1].get('status') if records else None}
    except (OSError,ValueError) as error:
        return {'status':'unreadable','error':str(error)}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle',type=Path,required=True)
    parser.add_argument('--expected-manifest-sha256',required=True)
    parser.add_argument('--output-root',type=Path,required=True)
    parser.add_argument('--original-pid',type=int,required=True)
    parser.add_argument('--released-live-pgid',type=int,required=True)
    parser.add_argument('--jobs',nargs='+',choices=('n03','n04'),default=['n03','n04'])
    parser.add_argument('--job-seconds',type=int,default=2100)
    parser.add_argument('--expected-native-threads',type=int,default=128)
    args=parser.parse_args()
    if args.output_root.exists():parser.error('Refusing to reuse any result root')
    if args.job_seconds<=0 or args.job_seconds>2100:parser.error('Each job cap must be1..2100seconds')
    args.output_root.mkdir(parents=True)
    state={'status':'starting','started_utc':utc(),'pid':os.getpid(),'jobs':[],
           'source_manifest_sha256':args.expected_manifest_sha256,
           'bundle':str(args.bundle),'runner_sha256':digest(__file__),'requested_jobs':args.jobs,
           'pod_lifecycle':'Owned by root; this runner does not manage infrastructure'}
    state_path=args.output_root/'serial-status.json'
    def save():atomic_json(state_path,state)
    save();active=None
    def interrupted(signum, _frame):
        raise SystemExit(128+signum)
    signal.signal(signal.SIGTERM,interrupted)
    signal.signal(signal.SIGINT,interrupted)
    try:
        state['sources']=verify_sources(args.bundle,args.expected_manifest_sha256)
        if group_members(args.released_live_pgid):
            raise RuntimeError('Live process group still exists; root must release it first')
        env,original_state=paused_original_environment(args.original_pid)
        state['original_dispatcher_state']=original_state
        state['environment']=env
        if gpu_processes():raise RuntimeError('GPU is not idle; no compute experiment started')
        state['status']='running';save()
        for name in args.jobs:
            verify_sources(args.bundle,args.expected_manifest_sha256)
            if group_members(args.released_live_pgid):raise RuntimeError('Live group reappeared')
            paused_original_environment(args.original_pid)
            if gpu_processes():raise RuntimeError('GPU ownership changed before '+name)
            script='n03_fp8_gemm.py' if name=='n03' else 'n04_vae.py'
            output=args.output_root/name
            command=[sys.executable,str(args.bundle/'bench'/script),
                     '--worker-script',str(args.bundle/'inference_server.py'),
                     '--output',str(output),'--frames','150','--pairs','3',
                     '--compile-timeout','600','--expected-native-threads',str(args.expected_native_threads)]
            row={'name':name,'status':'starting','started_utc':utc(),'command':command,
                 'log':str(args.output_root/(name+'.log')),'hard_cap_seconds':args.job_seconds}
            state['jobs'].append(row);save()
            with Path(row['log']).open('wb') as log:
                active=subprocess.Popen(command,cwd=args.bundle,env=env,
                                        stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
                row.update(status='running',pid=active.pid,pgid=active.pid);save()
                started=time.monotonic();timed_out=False
                while active.poll() is None:
                    elapsed=time.monotonic()-started
                    row['elapsed_seconds']=elapsed
                    row['result']=result_summary(output/'result.json')
                    save()
                    if elapsed>=args.job_seconds:
                        timed_out=True
                        row['terminated_leftover_pids']=stop_owned_group(active)
                        break
                    time.sleep(2)
                row.update(returncode=active.returncode,finished_utc=utc(),
                           elapsed_seconds=time.monotonic()-started,
                           status='timed-out' if timed_out else 'exited',
                           result=result_summary(output/'result.json'))
                leftovers=group_members(active.pid)
                if leftovers:
                    row['terminated_leftover_pids']=stop_owned_group(active)
                active=None;save()
            # Constructor exceptions can leave a partial result marked running.
            # Do not rewrite the experiment's evidence; record authoritative exit here.
            row['successful_completion']=row['returncode']==0 and row['result']['status']=='complete'
            verify_sources(args.bundle,args.expected_manifest_sha256)
            deadline=time.monotonic()+60
            observed=gpu_processes()
            while observed and time.monotonic()<deadline:
                time.sleep(2);observed=gpu_processes()
            if observed:
                row['gpu_release_failure']=observed;save()
                raise RuntimeError('GPU context remains after '+name+'; refusing overlap')
            row['gpu_released']=True;save()
        state['status']='complete' if all(row['successful_completion'] for row in state['jobs']) else 'complete-with-failures'
    except BaseException as error:
        state.update(status='failed',error=f'{type(error).__name__}: {error}')
        if active is not None:
            state['terminated_active_child_pid']=active.pid
            stop_owned_group(active)
        raise
    finally:
        state['finished_utc']=utc();save()
        print(json.dumps(state,indent=2),flush=True)


if __name__=='__main__':main()
