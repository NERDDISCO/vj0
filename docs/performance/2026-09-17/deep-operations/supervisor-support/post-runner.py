import hashlib,json,os,shutil,subprocess
from pathlib import Path
from datetime import datetime,timezone
r=Path('/workspace/terminal-post-live-code-20260918-05b'); output=Path('/workspace/terminal-post-live-20260918-05b'); progress=r/'post-status.json'
def now():return datetime.now(timezone.utc).isoformat()
state={'status':'running','started_utc':now()}
def save():
    t=progress.with_suffix('.tmp');t.write_text(json.dumps(state,indent=2)+'\n');t.replace(progress)
save()
try:
    for name,digest in json.loads((r/'sources.json').read_text()).items():
        assert hashlib.sha256((r/name).read_bytes()).hexdigest()==digest,name
    assert Path('/proc/500/stat').read_text().split()[2]=='T'
    assert not subprocess.check_output(['nvidia-smi','--query-compute-apps=pid','--format=csv,noheader'],text=True).strip()
    assert not output.exists(), 'Refusing to reuse post results'
    safe={'PATH','LD_LIBRARY_PATH','HF_HOME','HF_HUB_CACHE','TORCHINDUCTOR_CACHE_DIR','INDUCTOR_PERSIST_DIR'}
    raw=Path('/proc/500/environ').read_bytes().split(b'\0')
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
