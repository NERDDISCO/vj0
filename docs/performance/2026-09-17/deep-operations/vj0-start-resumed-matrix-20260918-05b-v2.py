import json, subprocess, time, sys, urllib.request
from pathlib import Path

root=Path('/Users/nerddisco/.t3/worktrees/vj0/t3code-78489133')
runtime=Path('/tmp/vj0-resume-runtime-20260918-05b.json')
config=json.loads(runtime.read_text())
formal=Path(config['formal_directory']);targets=Path(config['targets_directory'])
ssh=['ssh','-i',config['ssh']['key'],'-o','UserKnownHostsFile='+config['ssh']['known_hosts'],
     '-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15','-p',str(config['ssh']['port']),
     'root@'+config['ssh']['host']]
probe="""import json,urllib.request,re
from pathlib import Path
log=Path(DIRECTORY+'/service.log').read_text()
required=['512x288','768x448','1024x576']
warmed=[size for size in required if re.search(r'warmed '+size+r' in ',log)]
debug=json.load(urllib.request.urlopen('http://127.0.0.1:3001/debug',timeout=5))
workers=[{k:w.get(k) for k in ['gpu','ready','framePending','compileStartedAt']} for w in debug['workers']]
print(json.dumps({'warmed':warmed,'workers':workers,'all_ready':len(warmed)==3 and len(workers)==1 and all(w['ready'] and w['framePending']==0 and w['compileStartedAt']==0 for w in workers)}))
""".replace('DIRECTORY',repr(config['live_directory']))
deadline=time.monotonic()+15*60;ready_observations=0;history=[]
while time.monotonic()<deadline:
    p=subprocess.run(ssh+['python3 -'],input=probe,text=True,capture_output=True,timeout=25)
    if p.returncode:
        print('Warmup probe pending: '+p.stderr[-300:],flush=True);ready_observations=0
    else:
        status=json.loads(p.stdout);history.append({'epoch':time.time(),**status})
        print(json.dumps(status),flush=True)
        ready_observations=ready_observations+1 if status['all_ready'] else 0
        if ready_observations>=2:break
    time.sleep(10)
else:raise RuntimeError('All-resolution warmup exceeded15minutes; shutdown guard stays armed')
Path('/tmp/vj0-all-shapes-ready-20260918-05b.json').write_text(json.dumps(history,indent=2)+'\n')
assert not formal.exists()
with Path(config['formal_log']).open('w') as log:
    app=subprocess.Popen([sys.executable,str(root/'workers/runpod-flux2klein/bench/app_batch.py'),
        '--main-target',str(targets/'main.json'),'--stage-target',str(targets/'stage.json'),
        '--fixture','/tmp/vj0-deep-app-fixture-20260917.json',
        '--jobs','/tmp/vj0-deep-app-jobs-20260917.json','--output',str(formal)],
        cwd=root,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    for _ in range(100):
        if (formal/'identity.json').exists():break
        if app.poll() is not None:raise RuntimeError('Formal harness exited before identity')
        time.sleep(.1)
    else:raise RuntimeError('Formal harness did not save identity')
    with Path('/tmp/vj0-resume-supervisor-launch-20260918-05b.log').open('w') as output:
        supervisor=subprocess.Popen([sys.executable,'/tmp/vj0-resume-tests-and-stop-20260918-05b.py',
            '--runtime',str(runtime),'--execute'],cwd=root,stdin=subprocess.DEVNULL,
            stdout=output,stderr=subprocess.STDOUT,start_new_session=True)
    record={'app_pid':app.pid,'supervisor_pid':supervisor.pid,'started_epoch':time.time(),
            'formal':str(formal),'runtime':str(runtime)}
    Path('/tmp/vj0-resume-launch-20260918-05b.json').write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps(record),flush=True)
    result=app.wait();print('Formal harness exit='+str(result),flush=True)
