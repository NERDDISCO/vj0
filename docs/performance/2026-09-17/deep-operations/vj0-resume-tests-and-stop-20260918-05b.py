#!/usr/bin/env python3
"""Reviewed one-shot continuation. Preparation/--plan performs no network calls.

Only --execute runs jobs. Every exit after execution begins attempts archival and
Pod A stop; the independent backstop is cancelled only after verified stopped.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone

# Runtime values are supplied by the root agent after the pod restart.
# No previous-run address, PID, result directory or cancellation marker is reused.
REPO = Path('/Users/nerddisco/.t3/worktrees/vj0/t3code-78489133')
BENCH = REPO/'workers/runpod-flux2klein/bench'
RUNTIME_PATH = None
RUNTIME = None
CACHE_HELPER_SHA256 = '8077259d8c320f4f06d8d42621a76d41e528cbc07d18f24827f610d62ddc83ff'


def configure(path):
    global RUNTIME_PATH,RUNTIME,FORMAL,TARGETS,SOAK,LOCAL,FROZEN,SUPPORT,STATE_PATH,LOG_PATH,CONFIRMED
    global POD,SERVER,ORIGIN,REMOTE_CODE,REMOTE_OUTPUT,REMOTE_LIVE,KEY,KNOWN,SSH,SCP,SSH_DEST
    global EXPECTED_APP_SHA,EXPECTED_PROBE_SHA,EXPECTED_POST_SHA,ORIGINAL_PID,LIVE_PGID,RUN_TAG,FORMAL_LOG,LOCK_PATH,GUARD_STATE
    import re
    RUNTIME_PATH=Path(path).resolve();raw=json.loads(RUNTIME_PATH.read_text())
    required=['run_tag','pod_id','ssh','original_node_pid','live_pgid','live_directory',
              'formal_directory','targets_directory','formal_log','app_origin','app_server',
              'artifact_root','post_frozen_directory','expected_app_sha','expected_probe_sha','expected_post_sha']
    missing=[name for name in required if name not in raw]
    if missing:raise ValueError('Runtime configuration lacks: '+','.join(missing))
    RUNTIME={name:raw[name] for name in required}
    RUN_TAG=raw['run_tag']
    if not isinstance(RUN_TAG,str) or not re.fullmatch(r'20260918-05[a-z0-9-]*',RUN_TAG):
        raise ValueError('A fresh 20260918-05xx run tag is required')
    POD=raw['pod_id']
    if POD!='0pxb4bss2jmbhg':raise ValueError('Only the authorized Pod A may be stopped')
    ORIGINAL_PID=raw['original_node_pid'];LIVE_PGID=raw['live_pgid']
    if any(type(pid) is not int or pid<=1 for pid in [ORIGINAL_PID,LIVE_PGID]) or ORIGINAL_PID==LIVE_PGID:
        raise ValueError('Fresh, distinct original/live PIDs are required')
    ssh=raw['ssh'];host=ssh['host'];port=ssh['port']
    if not isinstance(host,str) or not re.fullmatch(r'[A-Za-z0-9.:-]+',host):raise ValueError('Invalid SSH host')
    if type(port) is not int or not 1<=port<=65535:raise ValueError('Invalid SSH port')
    KEY=ssh['key'];KNOWN=ssh['known_hosts'];SSH_DEST='root@'+host
    opts=['-i',KEY,'-o','UserKnownHostsFile='+KNOWN,'-o','StrictHostKeyChecking=yes',
          '-o','BatchMode=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2']
    SSH=['ssh','-p',str(port),*opts,SSH_DEST];SCP=['scp','-P',str(port),*opts]
    FORMAL=Path(raw['formal_directory']);TARGETS=Path(raw['targets_directory']);FORMAL_LOG=Path(raw['formal_log'])
    LOCAL=Path(raw['artifact_root']);FROZEN=Path(raw['post_frozen_directory']);REMOTE_LIVE=raw['live_directory']
    SERVER=raw['app_server'].rstrip('/');ORIGIN=raw['app_origin'].rstrip('/')
    if SERVER!='https://'+POD+'-3001.proxy.runpod.net':raise ValueError('Unexpected app server')
    if any(not p.is_absolute() for p in [FORMAL,TARGETS,FORMAL_LOG,LOCAL,FROZEN,Path(KEY),Path(KNOWN),Path(REMOTE_LIVE)]):
        raise ValueError('All local/remote file paths must be absolute')
    if RUN_TAG not in FORMAL.name or RUN_TAG not in TARGETS.name:
        raise ValueError('Fresh formal and target paths must contain the new run tag')
    SOAK=Path('/tmp/vj0-deep-app-soaks-'+RUN_TAG)
    SUPPORT=Path('/tmp/vj0-complete-tests-support-'+RUN_TAG)
    STATE_PATH=Path('/tmp/vj0-complete-tests-and-stop-'+RUN_TAG+'.json')
    LOG_PATH=Path('/tmp/vj0-complete-tests-and-stop-'+RUN_TAG+'.log')
    LOCK_PATH=Path('/tmp/vj0-complete-tests-and-stop-'+RUN_TAG+'.lock')
    CONFIRMED=Path('/tmp/vj0-pod-stop-confirmed-'+RUN_TAG)
    GUARD_STATE=Path('/tmp/vj0-pod-stop-guard-'+RUN_TAG+'.json')
    REMOTE_CODE='/workspace/terminal-post-live-code-'+RUN_TAG
    REMOTE_OUTPUT='/workspace/terminal-post-live-'+RUN_TAG
    EXPECTED_APP_SHA=raw['expected_app_sha'];EXPECTED_PROBE_SHA=raw['expected_probe_sha'];EXPECTED_POST_SHA=raw['expected_post_sha']
    if any(not isinstance(value,str) or not re.fullmatch(r'[0-9a-f]{64}',value) for value in [EXPECTED_APP_SHA,EXPECTED_PROBE_SHA,EXPECTED_POST_SHA]):
        raise ValueError('Expected source SHA256 values must be explicit')


def utc():
    return datetime.now(timezone.utc).isoformat()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None  # app progress writes are not atomic


class Supervisor:
    def __init__(self):
        self.state = {'status':'running','started_utc':utc(),'pid':os.getpid(),
                      'pod':POD,'script_sha256':digest(__file__),'phase':'initializing',
                      'events':[],'archive_errors':[], 'runtime_json_sha256':digest(RUNTIME_PATH),'runtime':RUNTIME}
        self.log_stream = LOG_PATH.open('a', buffering=1)

    def save(self):
        temporary = STATE_PATH.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.state,indent=2)+'\n')
        temporary.replace(STATE_PATH)

    def event(self, message, **details):
        row = {'at':utc(),'message':message,**details}
        self.state['events'].append(row)
        line = json.dumps(row)
        print(line,flush=True)
        self.log_stream.write(line+'\n')
        self.save()

    def phase(self, name):
        self.state['phase'] = name
        self.event('phase',phase=name)

    def command(self, argv, label, *, timeout=60, input_text=None, check=True):
        # These invocations contain paths/configuration only, never credentials.
        path = SUPPORT/(label+'.log')
        with path.open('a') as stream:
            process = subprocess.Popen(argv,stdin=subprocess.PIPE if input_text is not None else subprocess.DEVNULL,
                                       stdout=stream,stderr=subprocess.STDOUT,text=True,start_new_session=True)
            self.event('process-started',label=label,pid=process.pid,log=str(path))
            try:
                process.communicate(input_text,timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid,signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid,signal.SIGKILL)
                    process.wait(timeout=10)
                raise TimeoutError(label+' exceeded its deadline')
        self.event('process-finished',label=label,returncode=process.returncode)
        if check and process.returncode:
            raise RuntimeError(label+' failed; see '+str(path))
        return process.returncode

    def remote(self, source, label, timeout=90):
        return self.command(SSH+['python3 -'],label,timeout=timeout,input_text=source)

    def prepare_local(self):
        # No remote operation happens here or while waiting on formal results.
        if SUPPORT.exists() or SOAK.exists():
            raise RuntimeError('Refusing to reuse supervisor support or soak directory')
        SUPPORT.mkdir()
        LOCAL.mkdir(exist_ok=True)
        guard = read_json(GUARD_STATE) or {}
        if guard.get('status')!='armed' or guard.get('pod')!=POD or guard.get('confirmation_marker')!=str(CONFIRMED):
            raise RuntimeError('Fresh shutdown guard must be armed against the new marker before supervisor execution')
        if guard.get('deadline_epoch',0)<=time.time():raise RuntimeError('Fresh shutdown guard has already expired')
        (SUPPORT/'runtime-config.json').write_text(json.dumps(RUNTIME,indent=2)+'\n')
        identity = read_json(FORMAL/'identity.json')
        if not identity or len(identity['jobs']) != 18:
            raise RuntimeError('Formal identity must contain exactly 18 jobs')
        if identity['harness_sha256'] != EXPECTED_APP_SHA or identity['probe_sha256'] != EXPECTED_PROBE_SHA:
            raise RuntimeError('Formal harness differs from reviewed sources')
        if digest(BENCH/'app_batch.py') != EXPECTED_APP_SHA or digest(BENCH/'app_probe.js') != EXPECTED_PROBE_SHA:
            raise RuntimeError('Current app harness differs from the running formal harness')
        source_dir = SUPPORT/'app-harness'
        source_dir.mkdir()
        for name in ['app_batch.py','app_probe.js','metrics.py','cdp.mjs']:
            shutil.copy2(BENCH/name,source_dir/name)
        sources = json.loads((FROZEN/'sources.json').read_text())
        for name, expected in sources.items():
            if digest(FROZEN/name) != expected:
                raise RuntimeError('Frozen post-probe source mismatch: '+name)
        if sources['bench/bench_post_live.py'] != EXPECTED_POST_SHA:
            raise RuntimeError('Unexpected post-probe version')
        self.state['post_sources'] = sources
        self.state['formal_job_names'] = [job['name'] for job in identity['jobs']]
        for name in ['main.json','stage.json','ready.json']:
            if not (TARGETS/name).is_file():
                raise RuntimeError('Missing owned browser target '+name)
        (SUPPORT/'fixture.json').write_text(json.dumps(identity['fixture'],indent=2)+'\n')
        jobs = []
        for name, mailbox in [('compute-capture-768-three-minute-soak',False),
                              ('latest-input-768-three-minute-soak',True)]:
            jobs.append({'name':name,'server':SERVER,'origin':ORIGIN,'layout':'vj-next',
                         'sendFps':60,'activeWorkers':1,'maxPending':3,'variant':'terminal-noop',
                         'workerThreads':128,'mailbox':mailbox,'width':768,'height':448,
                         'seconds':180,'outputCast':'gpu','audioCycle':True,'stress':mailbox})
        (SUPPORT/'soak-jobs.json').write_text(json.dumps(jobs,indent=2)+'\n')
        shutil.copy2(__file__,SUPPORT/'supervisor.py')
        self.event('local-inputs-frozen',post_sources=sources,soak_jobs=jobs)

    def wait_formal(self):
        self.phase('waiting-for-formal-app')
        deadline = time.monotonic()+45*60
        last = None
        while time.monotonic() < deadline:
            rows = read_json(FORMAL/'progress.json') or []
            cleanup = read_json(FORMAL/'cleanup.json')
            statuses = [(row.get('name'),row.get('status')) for row in rows]
            if statuses != last:
                self.event('formal-progress',jobs=statuses,cleanup=cleanup)
                last = statuses
            failed = any(row.get('status') in ['failed','invalid'] or row.get('stress_status')=='failed' for row in rows)
            if failed:
                # Give the existing harness its finally/drain window. It cannot
                # advance to another measured cell after a recorded failure.
                cleanup_deadline = time.monotonic()+90
                while cleanup is None and time.monotonic()<cleanup_deadline:
                    time.sleep(5)
                    cleanup = read_json(FORMAL/'cleanup.json')
                raise RuntimeError('Formal app benchmark failed; soak/post skipped')
            if cleanup is not None:
                if cleanup.get('status') != 'pages-closed' or cleanup.get('errors'):
                    raise RuntimeError('Formal app cleanup failed; soak/post skipped')
                expected = self.state['formal_job_names']
                if [row.get('name') for row in rows] != expected or any(row.get('status')!='measured' for row in rows):
                    raise RuntimeError('Formal app ended without all 18 measured jobs')
                for name in expected:
                    summary = read_json(FORMAL/name/'summary.json')
                    if not summary or summary.get('status')!='measured' or summary.get('problems'):
                        raise RuntimeError('Formal summary not measured: '+name)
                self.event('formal-passed',measured_jobs=18,cleanup=cleanup)
                return
            time.sleep(5)
        raise TimeoutError('Formal benchmark did not complete within 45 minutes')

    def run_soaks(self):
        self.phase('two-app-soaks')
        self.command([sys.executable,str(SUPPORT/'app-harness/app_batch.py'),
                      '--main-target',str(TARGETS/'main.json'),'--stage-target',str(TARGETS/'stage.json'),
                      '--fixture',str(SUPPORT/'fixture.json'),'--jobs',str(SUPPORT/'soak-jobs.json'),
                      '--output',str(SOAK)],'app-soaks',timeout=30*60)
        rows = read_json(SOAK/'progress.json') or []
        cleanup = read_json(SOAK/'cleanup.json') or {}
        if len(rows)!=2 or any(row.get('status')!='measured' for row in rows):
            raise RuntimeError('Soaks were not both measured')
        if rows[1].get('stress_status')!='passed':
            raise RuntimeError('Latest-input lifecycle stress did not pass')
        if cleanup.get('status')!='pages-closed' or cleanup.get('errors'):
            raise RuntimeError('Soak browser cleanup not confirmed')
        for row in rows:
            summary = read_json(SOAK/row['name']/'summary.json') or {}
            if summary.get('status')!='measured' or summary.get('problems'):
                raise RuntimeError('Invalid soak summary')
        self.event('soaks-passed',measured_jobs=2,stress='passed',cleanup=cleanup)

    def stop_live_group(self):
        self.phase('stopping-live-process-group')
        self.remote("""import os,signal,time,json,subprocess
from pathlib import Path
assert Path('/proc/__ORIGINAL_PID__/stat').read_text().split()[2]=='T', 'Original Node is not paused'
leader=__LIVE_PGID__
if Path(f'/proc/{leader}').exists():
    assert os.getpgid(leader)==leader, 'Live PID is not its expected process group leader'
    assert str(Path(f'/proc/{leader}/cwd').resolve())==__LIVE_DIRECTORY__
    cmd=Path(f'/proc/{leader}/cmdline').read_bytes().split(b'\\0')
    assert any(b'node' in x for x in cmd) and b'server.js' in cmd, 'Unexpected live PID identity'
    os.killpg(leader,signal.SIGTERM)
def active_group():
    found=[]
    for p in Path('/proc').iterdir():
        if not p.name.isdigit():continue
        try:
            if os.getpgid(int(p.name))==leader and (p/'stat').read_text().split()[2]!='Z':found.append(int(p.name))
        except (OSError,ProcessLookupError):pass
    return found
deadline=time.monotonic()+45
while active_group() and time.monotonic()<deadline:time.sleep(1)
if active_group():
    os.killpg(leader,signal.SIGKILL)
    deadline=time.monotonic()+10
    while active_group() and time.monotonic()<deadline:time.sleep(1)
assert not active_group(), 'Live group did not stop'
assert Path('/proc/__ORIGINAL_PID__/stat').read_text().split()[2]=='T', 'Original Node changed state'
assert not subprocess.check_output(['nvidia-smi','--query-compute-apps=pid','--format=csv,noheader'],text=True).strip(), 'GPU still occupied'
print(json.dumps({'stopped_process_group':leader,'original_node_pid':__ORIGINAL_PID__,'original_node_state':'T','gpu_idle':True}))
""".replace('__ORIGINAL_PID__',str(ORIGINAL_PID)).replace('__LIVE_PGID__',str(LIVE_PGID)).replace('__LIVE_DIRECTORY__',repr(REMOTE_LIVE)),'stop-live-group',timeout=90)

    def run_post(self):
        self.phase('uploading-frozen-post-probe')
        self.remote("from pathlib import Path\nr=Path("+repr(REMOTE_CODE)+")\nassert not r.exists(), 'Refusing to reuse post code directory'\nr.mkdir()\n(r/'bench').mkdir()\n",'post-mkdir')
        for name in [*self.state['post_sources'],'sources.json']:
            self.command(SCP+[str(FROZEN/name),SSH_DEST+':'+REMOTE_CODE+'/'+name],
                         'upload-'+name.replace('/','-'),timeout=90)
        runner = '''import hashlib,json,os,shutil,subprocess
from pathlib import Path
from datetime import datetime,timezone
r=Path(REMOTE_CODE); output=Path(REMOTE_OUTPUT); progress=r/'post-status.json'
def now():return datetime.now(timezone.utc).isoformat()
state={'status':'running','started_utc':now()}
def save():
    t=progress.with_suffix('.tmp');t.write_text(json.dumps(state,indent=2)+'\\n');t.replace(progress)
save()
try:
    for name,digest in json.loads((r/'sources.json').read_text()).items():
        assert hashlib.sha256((r/name).read_bytes()).hexdigest()==digest,name
    assert Path('/proc/__ORIGINAL_PID__/stat').read_text().split()[2]=='T'
    assert not subprocess.check_output(['nvidia-smi','--query-compute-apps=pid','--format=csv,noheader'],text=True).strip()
    assert not output.exists(), 'Refusing to reuse post results'
    safe={'PATH','LD_LIBRARY_PATH','HF_HOME','HF_HUB_CACHE','TORCHINDUCTOR_CACHE_DIR','INDUCTOR_PERSIST_DIR'}
    raw=Path('/proc/__ORIGINAL_PID__/environ').read_bytes().split(b'\\0')
    env={x.split(b'=',1)[0].decode():x.split(b'=',1)[1].decode() for x in raw if b'=' in x and x.split(b'=',1)[0].decode() in safe}
    env.update(HF_HUB_OFFLINE='1',CUDA_VISIBLE_DEVICES='0',COMPILE_MODE='reduce-overhead',PYTHONUNBUFFERED='1',PYTHONPATH=str(r/'bench'))
    python=shutil.which('python3',path=env['PATH']);assert python
    argv=[python,str(r/'bench/bench_post_live.py'),'--worker-script',str(r/'inference_server.py'),'--output',str(output),'--frames','100','--pairs','3','--profile-frames','20','--warmup','4','--expected-native-threads','128']
    state.update(argv=argv,environment=env,sources=json.loads((r/'sources.json').read_text()))
    with (r/'post-worker.log').open('w') as log:
        child=subprocess.Popen(argv,cwd=r,env=env,stdout=log,stderr=subprocess.STDOUT)
        state['child_pid']=child.pid;save();code=child.wait()
    state['exit_code']=code
    result=json.loads((output/'result.json').read_text()) if (output/'result.json').exists() else {}
    state['result_status']=result.get('status')
    assert code==0 and result.get('status')=='complete', 'Post-probe did not complete'
    state['status']='complete'
except Exception as exc:
    state['status']='failed';state['error']=str(exc);raise
finally:
    state['finished_utc']=now();save()
'''.replace('REMOTE_CODE',repr(REMOTE_CODE)).replace('REMOTE_OUTPUT',repr(REMOTE_OUTPUT)).replace('__ORIGINAL_PID__',str(ORIGINAL_PID))
        (SUPPORT/'post-runner.py').write_text(runner)
        self.command(SCP+[str(SUPPORT/'post-runner.py'),SSH_DEST+':'+REMOTE_CODE+'/post-runner.py'],
                     'upload-post-runner',timeout=90)
        self.phase('post-probe-running')
        launch = """import subprocess,json
from pathlib import Path
r=Path(REMOTE_CODE)
assert not (r/'post-launch.json').exists()
with (r/'post-runner.log').open('w') as log:
    p=subprocess.Popen(['python3',str(r/'post-runner.py')],cwd=r,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
record={'runner_pid':p.pid};(r/'post-launch.json').write_text(json.dumps(record));print(json.dumps(record))
""".replace('REMOTE_CODE',repr(REMOTE_CODE))
        self.remote(launch,'post-launch')
        deadline = time.monotonic()+25*60
        while time.monotonic()<deadline:
            remote_state = SUPPORT/'post-status.json'
            code = self.command(SCP+[SSH_DEST+':'+REMOTE_CODE+'/post-status.json',str(remote_state)],
                                'post-status-poll',timeout=60,check=False)
            status = read_json(remote_state) if code==0 else None
            if status:
                self.state['post_status']=status;self.save()
                if status.get('status')=='failed':raise RuntimeError('Post-probe failed: '+str(status.get('error')))
                if status.get('status')=='complete':
                    self.event('post-probe-complete',status=status)
                    return
            time.sleep(15)
        raise TimeoutError('Post-probe exceeded 25 minutes')

    def persist_cache_optional(self):
        """No GPU jobs overlap this bounded, non-critical persistence task."""
        self.phase('persisting-compiler-cache')
        helper=Path('/tmp/vj0-persist-inductor-cache-20260918.py')
        proof='/workspace/vj0-cache-persist-'+RUN_TAG+'.json'
        self.state['cache_persist']={'status':'running','proof':proof}
        try:
            if digest(helper)!=CACHE_HELPER_SHA256:
                raise RuntimeError('Cache helper differs from the reviewed source')
            shutil.copy2(helper,SUPPORT/'persist-inductor-cache.py')
            argv=['persist-inductor-cache.py','--source','/tmp/torchinductor_root',
                  '--destination','/workspace/torch-inductor-cache','--proof',proof,'--budget-seconds','100']
            program='import sys\nsys.argv='+repr(argv)+'\n'+helper.read_text()
            self.remote(program,'persist-inductor-cache',timeout=120)
            self.state['cache_persist']['status']='command-complete'
        except BaseException as error:
            self.state['cache_persist'].update(status='failed-noncritical',error=f'{type(error).__name__}: {error}')
        self.event('cache-persist-finished',result=self.state['cache_persist'])

    def archive_available(self):
        self.phase('archiving-available-evidence')
        # Local artifacts remain available even if a remote transfer fails.
        for source in [FORMAL/'identity.json',FORMAL/'progress.json',FORMAL/'cleanup.json',
                       SOAK/'identity.json',SOAK/'progress.json',SOAK/'cleanup.json',
                       FORMAL_LOG]:
            if source.is_file():
                destination=LOCAL/(source.parent.name+'-'+source.name)
                try:shutil.copy2(source,destination)
                except Exception as error:self.state['archive_errors'].append(str(error))
        transfers = [
            (REMOTE_OUTPUT,LOCAL,True),
            (REMOTE_CODE+'/post-worker.log',LOCAL/('post-worker-'+RUN_TAG+'.log'),False),
            (REMOTE_CODE+'/post-runner.log',LOCAL/('post-runner-'+RUN_TAG+'.log'),False),
            (REMOTE_CODE+'/post-status.json',LOCAL/('post-status-'+RUN_TAG+'.json'),False),
            (REMOTE_LIVE+'/service.log',LOCAL/('live-service-'+RUN_TAG+'.log'),False),
            (REMOTE_LIVE+'/runtime.json',LOCAL/('live-runtime-'+RUN_TAG+'.json'),False),
        ]
        for remote,destination,recursive in transfers:
            try:
                code=self.command(SCP+(['-r'] if recursive else [])+
                                  [SSH_DEST+':'+remote,str(destination)],
                                  'archive-'+Path(remote).name,timeout=120,check=False)
                if code:self.state['archive_errors'].append(remote+' transfer returned '+str(code))
            except Exception as error:self.state['archive_errors'].append(remote+': '+str(error))
        if self.state.get('cache_persist'):
            try:
                code=self.command(SCP+[SSH_DEST+':'+self.state['cache_persist']['proof'],
                                      str(LOCAL/('cache-persist-'+RUN_TAG+'.json'))],
                                  'archive-cache-persist-proof',timeout=30,check=False)
                self.state['cache_persist']['proof_download_exit']=code
            except Exception as error:
                self.state['cache_persist']['proof_download_error']=str(error)
        self.state['artifact_locations']={'formal':str(FORMAL),'soaks':str(SOAK),'post_and_live_logs':str(LOCAL),'supervisor_support':str(SUPPORT)}
        self.save()

    def stop_pod(self):
        self.phase('stopping-pod-a')
        cli=shutil.which('runpodctl')
        if not cli:raise RuntimeError('runpodctl unavailable; backstop remains armed')
        transient={'network_error','rate_limited','server_error'}
        for attempt in range(12):
            try:
                stop=subprocess.run([cli,'pod','stop',POD],text=True,capture_output=True,timeout=45)
                get=subprocess.run([cli,'pod','get',POD],text=True,capture_output=True,timeout=45)
            except (subprocess.TimeoutExpired,OSError) as error:
                self.event('pod-stop-network-retry',attempt=attempt,error=str(error))
                time.sleep(min(30,5+attempt*3))
                continue
            error=None
            if stop.returncode:
                try:error=json.loads(stop.stderr)
                except json.JSONDecodeError:error={'code':'unknown','error':stop.stderr[:1000]}
            observed={}
            if get.returncode==0:
                try:
                    value=json.loads(get.stdout)
                    observed={key:value.get(key) for key in ['id','desiredStatus','runtimeStatus']}
                except (json.JSONDecodeError,AttributeError):
                    self.event('pod-status-invalid-json',attempt=attempt)
            # Never log full pod-get responses: they can contain environment secrets.
            self.event('pod-stop-attempt',attempt=attempt,stop_returncode=stop.returncode,
                       get_returncode=get.returncode,observed=observed,error=error)
            if observed.get('id')==POD and observed.get('runtimeStatus')=='stopped':
                confirmation={'pod':POD,'verified_utc':utc(),'observed':observed,'supervisor_pid':os.getpid()}
                CONFIRMED.write_text(json.dumps(confirmation,indent=2)+'\n')
                self.state['pod_stop_confirmed']=confirmation
                self.event('pod-stopped-verified',confirmation=confirmation)
                return
            if error and error.get('code') not in transient:
                raise RuntimeError('Non-transient Runpod stop failure; backstop remains armed')
            time.sleep(min(30,5+attempt*3))
        raise RuntimeError('Pod stopped status was not confirmed; backstop remains armed')

    def run(self):
        failure=None
        try:
            self.prepare_local()
            self.wait_formal()
            self.run_soaks()
            self.stop_live_group()
            self.run_post()
            self.persist_cache_optional()
        except BaseException as error:
            failure=f'{type(error).__name__}: {error}'
            self.state['test_failure']=failure
            self.event('test-sequence-failed',error=failure)
            self.log_stream.write(traceback.format_exc()+'\n')
        finally:
            try:
                # Support creation may have failed before any test started.
                SUPPORT.mkdir(exist_ok=True)
                LOCAL.mkdir(exist_ok=True)
                self.archive_available()
            except BaseException as error:
                self.state['archive_errors'].append(str(error));self.save()
            try:
                self.stop_pod()
            except BaseException as error:
                self.state['stop_failure']=f'{type(error).__name__}: {error}'
                self.event('pod-stop-not-confirmed',error=self.state['stop_failure'])
            self.state['finished_utc']=utc()
            self.state['status']='complete' if not failure and not self.state['archive_errors'] and self.state.get('pod_stop_confirmed') else 'failed-stopped' if self.state.get('pod_stop_confirmed') else 'failed-stop-unconfirmed'
            self.save()
            shutil.copy2(STATE_PATH,LOCAL/STATE_PATH.name)
            self.log_stream.close()
            shutil.copy2(LOG_PATH,LOCAL/LOG_PATH.name)
        return 0 if self.state['status']=='complete' else 1


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute',action='store_true',help='Root-reviewed execution; otherwise print plan only')
    parser.add_argument('--runtime',type=Path,required=True,help='Fresh root-provided runtime JSON; no credentials')
    args=parser.parse_args()
    configure(args.runtime)
    if not args.execute:
        print(json.dumps({'mode':'plan-only-no-network','formal':str(FORMAL),'formal_jobs':18,
                          'soaks':str(SOAK),'soak_seconds_each':180,'stress_only_latest':True,
                          'live_process_group_to_stop':LIVE_PGID,'original_node_pid':ORIGINAL_PID,'original_node_state':'must remain paused',
                          'post_bundle':str(FROZEN),'remote_post_code':REMOTE_CODE,'remote_post_output':REMOTE_OUTPUT,
                          'pod_to_stop_and_verify':POD,'confirmation_marker':str(CONFIRMED)},indent=2))
        return 0
    lock=open(LOCK_PATH,'w')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:raise SystemExit('Supervisor already running')
    if STATE_PATH.exists() or CONFIRMED.exists():
        raise SystemExit('Refusing duplicate execution or previously confirmed stopped pod')
    def terminate(_signum,_frame):
        raise KeyboardInterrupt('Supervisor termination requested; archiving and stopping Pod A')
    signal.signal(signal.SIGTERM,terminate)
    return Supervisor().run()


if __name__=='__main__':
    raise SystemExit(main())
