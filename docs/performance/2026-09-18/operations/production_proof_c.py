#!/usr/bin/env python3
"""Explicit one-shot C production proof; root launches only in its GPU slot."""
import hashlib,json,os,signal,subprocess,time
from pathlib import Path
r=Path('/workspace/vj0-next-c-production')
output=Path('/workspace/vj0-next-c-production-results')
progress=r/'run-status.json'
assert not progress.exists() and not output.exists() and not (r/'worker.log').exists(), 'Use fresh result paths; preserve prior logs'
assert Path('/proc/568/stat').read_text().split()[2]=='T', 'Original dispatcher must remain paused'
assert not subprocess.check_output(['nvidia-smi','--query-compute-apps=pid','--format=csv,noheader'],text=True).strip(), 'GPU slot not idle'
sources=json.loads((r/'hashes.json').read_text())
for name,digest in sources.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==digest,name
raw=dict(x.split('=',1) for x in Path('/proc/568/environ').read_bytes().decode().split('\0') if '=' in x)
env={k:v for k,v in raw.items() if k in ['PATH','LD_LIBRARY_PATH','HF_HOME','HF_HUB_CACHE']}
env.update(PATH='/workspace/envs/klein-torch213-cu132/bin:'+env['PATH'],HF_HUB_OFFLINE='1',CUDA_VISIBLE_DEVICES='0',COMPILE_MODE='reduce-overhead',PYTHONUNBUFFERED='1',PYTHONPATH=str(r/'bench'),TORCHINDUCTOR_CACHE_DIR='/tmp/vj0-c-torch213',TRITON_CACHE_DIR='/tmp/vj0-c-triton213')
argv=['/workspace/envs/klein-torch213-cu132/bin/python',str(r/'bench/bench_post_live.py'),'--worker-script',str(r/'inference_server.py'),'--output',str(output),'--frames','100','--pairs','3','--warmup','4','--expected-native-threads','128','--skip-profiles']
state={'status':'running','started_epoch':time.time(),'argv':argv,'environment':env,'sources':sources}
def save():
 tmp=progress.with_suffix('.tmp');tmp.write_text(json.dumps(state,indent=2)+'\n');tmp.replace(progress)
save()
p=None
def interrupted(signum, _frame):
 raise SystemExit(128+signum)
def stop_owned_group():
 if p is None:return
 try:os.killpg(p.pid,signal.SIGTERM)
 except ProcessLookupError:pass
 try:p.wait(timeout=30)
 except subprocess.TimeoutExpired:
  try:os.killpg(p.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  p.wait(timeout=15)
 # A child may already have exited while compiler grandchildren still run.
 try:os.killpg(p.pid,signal.SIGKILL)
 except ProcessLookupError:pass
signal.signal(signal.SIGTERM,interrupted)
signal.signal(signal.SIGINT,interrupted)
try:
 with (r/'worker.log').open('x') as log:
  p=subprocess.Popen(argv,cwd=r,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  state['child_pid']=p.pid;save()
  try:state['exit_code']=p.wait(timeout=2100)
  except subprocess.TimeoutExpired:
   state['timeout_seconds']=2100;stop_owned_group()
   state['exit_code']=p.returncode
 result=json.loads((output/'result.json').read_text()) if (output/'result.json').exists() else {}
 state['result_status']=result.get('status')
 state['status']='complete' if state['exit_code']==0 and result.get('status')=='complete' else 'failed'
except BaseException as error:
 state.update(status='failed',error=f'{type(error).__name__}: {error}')
 raise
finally:
 stop_owned_group()
 state['finished_epoch']=time.time();save()
