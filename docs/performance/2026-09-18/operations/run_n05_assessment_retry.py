#!/usr/bin/env python3
"""Bound the reviewed N05 model and LPIPS phases to one shared 60-minute slot."""
import datetime,hashlib,json,os,pathlib,signal,subprocess,time
ROOT=pathlib.Path('/workspace/vj0-n05')
MANIFEST=ROOT/'model-source-sha256.json'
EXPECTED_MANIFEST='c6c091d898d36354ed2aab8c660d8098e3cccbb257bdd53815b1cd5538fdd4e6'
PYTHON='/workspace/envs/klein-torch213-cu132/bin/python'
OUTPUT=ROOT/'results/model-02'
STATE=ROOT/'model-02-assessment-retry-supervisor.json'
CAP=3600
ORIGINAL_DEADLINE_EPOCH=1789728583.769467

def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(path):return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
def check_sources():
 assert sha(MANIFEST)==EXPECTED_MANIFEST,'Source manifest changed'
 data=json.loads(MANIFEST.read_text())
 for name,value in data.items():assert sha(ROOT/name)==value,name
 return data

def gpu():return subprocess.check_output(['nvidia-smi','--query-compute-apps=pid,process_name,used_gpu_memory','--format=csv,noheader'],text=True,timeout=15).strip()
def original_paused():
 line=next(x for x in pathlib.Path('/proc/568/status').read_text().splitlines() if x.startswith('State:'))
 assert line.split()[1] in ['T','t'],line
 return line

def members(pgid):
 rows=[]
 for path in pathlib.Path('/proc').iterdir():
  if not path.name.isdigit():continue
  try:
   if os.getpgid(int(path.name))==pgid:rows.append(int(path.name))
  except ProcessLookupError:pass
 return rows

def stop(process):
 try:os.killpg(process.pid,signal.SIGTERM)
 except ProcessLookupError:pass
 try:process.wait(timeout=20)
 except subprocess.TimeoutExpired:
  try:os.killpg(process.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  process.wait(timeout=10)
 if members(process.pid):
  try:os.killpg(process.pid,signal.SIGKILL)
  except ProcessLookupError:pass


def main():
 assert OUTPUT.is_dir() and not (OUTPUT/'assessment.json').exists() and not STATE.exists(),'Require completed model evidence and fresh assessment output'
 started=time.monotonic();remaining=max(0,ORIGINAL_DEADLINE_EPOCH-time.time());deadline=started+remaining
 state={'status':'starting','started_utc':now(),'pid':os.getpid(),'cap_seconds':CAP,'remaining_original_slot_seconds':remaining,'original_deadline_epoch':ORIGINAL_DEADLINE_EPOCH,'jobs':[],
        'runner_sha256':sha(__file__),'manifest_sha256':EXPECTED_MANIFEST}
 active=None
 def save():
  temporary=STATE.with_suffix('.tmp');temporary.write_text(json.dumps(state,indent=2)+'\n');temporary.replace(STATE)
 def interrupted(number,frame):raise SystemExit(128+number)
 signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
 save()
 try:
  state['sources']=check_sources();state['original_state']=original_paused()
  assert not gpu(),'Another GPU workload is active'
  env=os.environ.copy()
  for key in ['TORCH_NUM_THREADS','OMP_NUM_THREADS','MKL_NUM_THREADS','OPENBLAS_NUM_THREADS']:env.pop(key,None)
  selected={'CUDA_VISIBLE_DEVICES':'0','CUDA_HOME':'/workspace/cuda-13.2',
   'PATH':'/workspace/envs/klein-torch213-cu132/bin:/workspace/cuda-13.2/bin:'+env.get('PATH','/usr/local/bin:/usr/bin:/bin'),
   'HF_HOME':'/workspace/hf-cache','HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1',
   'TORCHINDUCTOR_CACHE_DIR':'/tmp/vj0-n05-inductor','TRITON_CACHE_DIR':'/tmp/vj0-n05-triton',
   'FLASHINFER_WORKSPACE_BASE':'/tmp/vj0-n05-flashinfer','TORCH_HOME':'/workspace/vj0-n05/torchhub',
   'MAX_JOBS':'8','PYTHONUNBUFFERED':'1'}
  env.update(selected);state['selected_env']=selected;state['status']='running';save()
  jobs=[('assessment',[PYTHON,str(ROOT/'bench/n05_analyze.py'),'--results',str(OUTPUT),'--device','cuda'])]
  for name,command in jobs:
   check_sources();original_paused();assert not gpu(),'GPU overlap before '+name
   if name=='assessment':assert json.loads((OUTPUT/'result.json').read_text())['status']=='compute-and-images-complete'
   assert time.monotonic()<deadline,'Shared60-minute deadline expired'
   row={'name':name,'command':command,'started_utc':now(),'log':str(ROOT/f'model-02-{name}-retry.log')}
   state['jobs'].append(row);save()
   with open(row['log'],'wb') as log:
    active=subprocess.Popen(command,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    row.update(pid=active.pid,pgid=active.pid,status='running');save()
    while active.poll() is None:
     if time.monotonic()>=deadline:
      row['status']='timed-out';stop(active);raise TimeoutError('Shared model+assessment60-minute cap reached')
     state['elapsed_seconds']=time.monotonic()-started;save();time.sleep(2)
    row.update(returncode=active.returncode,finished_utc=now(),status='exited')
    leftovers=members(active.pid)
    if leftovers:stop(active)
    active=None;save()
   assert row['returncode']==0,f'{name} failed; preserve partial evidence'
   check_sources()
   release_deadline=min(deadline,time.monotonic()+60)
   while gpu() and time.monotonic()<release_deadline:time.sleep(2)
   assert not gpu(),'GPU context remains after '+name
   row['gpu_released']=True;save()
  assert (OUTPUT/'assessment.json').is_file()
  state['status']='complete';state['visual_acceptance']='Pending independent review; never automatic'
 except BaseException as error:
  state.update(status='failed',error=f'{type(error).__name__}: {error}')
  if active is not None:stop(active)
  raise
 finally:
  state.update(finished_utc=now(),elapsed_seconds=time.monotonic()-started)
  state['gpu_processes_at_finish']=gpu();save();print(json.dumps(state,indent=2),flush=True)

if __name__=='__main__':main()
