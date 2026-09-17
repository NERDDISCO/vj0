#!/usr/bin/env python3
"""After a verified browser batch and replacement, start the next pod sweep.

Explicit IDs and process-identity checks prevent touching unrelated workloads.
Any incomplete browser result blocks this transition for inspection.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--batch',type=Path,required=True)
p.add_argument('--session',required=True)
p.add_argument('--replacement-jobs',type=Path,required=True)
p.add_argument('--replacement-output',type=Path,required=True)
p.add_argument('--ssh-host',required=True)
p.add_argument('--ssh-port',required=True)
p.add_argument('--ssh-key',required=True)
p.add_argument('--known-hosts',required=True)
p.add_argument('--service-manifest',required=True)
p.add_argument('--next-jobs',required=True)
p.add_argument('--next-output',required=True)
p.add_argument('--record',type=Path,required=True)
a=p.parse_args()
expected=json.loads((a.batch/'jobs.json').read_text())
deadline=time.monotonic()+7200
while True:
    try:
        state=json.loads((a.batch/'batch.json').read_text())
    except json.JSONDecodeError:
        # Older collectors wrote their small progress file in place.
        if time.monotonic()>deadline:raise
        time.sleep(0.1)
        continue
    if state['done']:
        if state['error'] or state['count']!=len(expected):
            raise RuntimeError('Current batch did not finish every job successfully')
        for job in expected:
            if json.loads((a.batch/(job['name']+'.json')).read_text())['status']!='measured':
                raise RuntimeError('Unmeasured current trial: '+job['name'])
        break
    if time.monotonic()>deadline:
        raise TimeoutError('Current browser batch did not finish in two hours')
    time.sleep(5)
subprocess.run([sys.executable,str(Path(__file__).with_name('browser_batch.py')),
    '--session',a.session,'--jobs',str(a.replacement_jobs),'--output',str(a.replacement_output)],check=True)
remote='''import json,os,pathlib,signal,subprocess,time
config=CONFIG
m=json.loads(pathlib.Path(config['manifest']).read_text())
assert m['status']=='running', m['status']
service=m['jobs'][-1]
assert service['status']=='running' and 'service' in service['name'],service
pid=service['pid']; runner=m['runner_pid']; dispatcher=m['dispatcher_pid']
cmd=pathlib.Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\\0')
assert cmd[0]==b'node' and b'server-configurable-bench-20260917.js' in cmd[1],cmd
os.kill(pid,signal.SIGTERM)
for _ in range(120):
 p=pathlib.Path(f'/proc/{runner}/stat')
 if not p.exists() or p.read_text().split()[2]=='Z':break
 time.sleep(0.5)
else:raise RuntimeError('Service runner did not finish cleanup')
path=pathlib.Path(config['output'])
assert not path.exists(), 'Next output already exists'
log=pathlib.Path(str(path)+'-runner.log').open('w')
proc=subprocess.Popen(['python3','/workspace/bench-20260917/run_sweep.py','--dispatcher-pid',str(dispatcher),'--jobs',config['jobs'],'--output',str(path)],stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
print(json.dumps({'status':'next-sweep-started','runner_pid':proc.pid,'output':str(path),'terminated_service_pid':pid}))
'''.replace('CONFIG',repr({'manifest':a.service_manifest,'jobs':a.next_jobs,'output':a.next_output}))
result=subprocess.run(['ssh','-i',a.ssh_key,'-o','UserKnownHostsFile='+a.known_hosts,'-p',a.ssh_port,a.ssh_host,'python3 -'],
    input=remote,text=True,capture_output=True,check=True,timeout=90)
record=json.loads(result.stdout)
a.record.write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record),flush=True)
