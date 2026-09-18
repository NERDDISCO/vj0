#!/usr/bin/env python3
"""Fresh bounded stop backstop. No network calls unless --execute is supplied."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--runtime',type=Path,required=True)
    p.add_argument('--seconds',type=int,default=10800)
    p.add_argument('--execute',action='store_true')
    args=p.parse_args()
    data=json.loads(args.runtime.read_text());tag=data['run_tag'];pod=data['pod_id']
    if pod not in data.get('authorized_test_pods',[]) or not re.fullmatch(r'20260918-next[a-z0-9-]*',tag):
        p.error('Only an explicitly listed authorized test pod and fresh next-series tag are allowed')
    if not 60<=args.seconds<=21600:p.error('Guard seconds must be60..21600')
    state_path=Path('/tmp/vj0-pod-stop-guard-'+tag+'.json')
    marker=Path('/tmp/vj0-pod-stop-confirmed-'+tag)
    if not args.execute:
        print(json.dumps({'mode':'plan-only-no-network','pod':pod,'seconds':args.seconds,
                          'state':str(state_path),'confirmation_marker':str(marker)},indent=2));return 0
    if state_path.exists() or marker.exists():raise SystemExit('Refusing to reuse a guard state or confirmation marker')
    state={'pod':pod,'run_tag':tag,'status':'armed','deadline_epoch':time.time()+args.seconds,
           'pid':os.getpid(),'confirmation_marker':str(marker),
           'runtime_json_sha256_at_arm':hashlib.sha256(args.runtime.read_bytes()).hexdigest()}
    def save():
        tmp=state_path.with_suffix('.tmp');tmp.write_text(json.dumps(state,indent=2)+'\n');tmp.replace(state_path)
        print(json.dumps(state),flush=True)
    save()
    while time.time()<state['deadline_epoch']:
        if marker.exists():
            try:
                confirmed=json.loads(marker.read_text())
                if confirmed.get('pod')==pod and confirmed.get('observed',{}).get('id')==pod and confirmed.get('observed',{}).get('runtimeStatus')=='stopped':
                    state['status']='cancelled-after-confirmed-stop';save();return 0
            except (OSError,json.JSONDecodeError):pass
        time.sleep(10)
    cli=shutil.which('runpodctl')
    if not cli:state.update(status='stop-failed',error='runpodctl unavailable');save();return 1
    for attempt in range(12):
        try:
            stopped=subprocess.run([cli,'pod','stop',pod],text=True,capture_output=True,timeout=45)
            got=subprocess.run([cli,'pod','get',pod],text=True,capture_output=True,timeout=45)
            observed={}
            if got.returncode==0:
                result=json.loads(got.stdout);observed={key:result.get(key) for key in ['id','desiredStatus','runtimeStatus']}
            state.update(status='stop-requested',attempt=attempt,stop_exit=stopped.returncode,get_exit=got.returncode,observed=observed);save()
            if observed.get('id')==pod and observed.get('runtimeStatus')=='stopped':
                state['status']='stopped';save()
                marker.write_text(json.dumps({'pod':pod,'observed':observed,'guard_pid':os.getpid(),
                                             'verified_epoch':time.time()},indent=2)+'\n');return 0
            if stopped.returncode:
                try:code=json.loads(stopped.stderr).get('code')
                except (json.JSONDecodeError,AttributeError):code='unknown'
                if code not in ['network_error','server_error','rate_limited']:
                    state.update(status='stop-failed',error_code=code);save();return 1
        except (OSError,subprocess.TimeoutExpired,json.JSONDecodeError) as error:
            state.update(status='retrying',attempt=attempt,error=str(error));save()
        time.sleep(min(30,5+attempt*3))
    state['status']='stop-unconfirmed';save();return 1


if __name__=='__main__':raise SystemExit(main())
