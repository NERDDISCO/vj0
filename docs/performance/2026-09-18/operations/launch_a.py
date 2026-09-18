import json,os,subprocess
from pathlib import Path
assert Path('/proc/496/stat').read_text().split()[2] == 'T'
assert not subprocess.check_output(['nvidia-smi','--query-compute-apps=pid','--format=csv,noheader'],text=True).strip()
r=Path('/workspace/vj0-next-live-a-20260918')
env=dict(x.split('=',1) for x in Path('/proc/496/environ').read_bytes().decode().split('\0') if '=' in x)
env.update(PORT='3001',WORKER_COUNT='1',INFERENCE_SCRIPT=str(r/'inference_server.py'),PYTHONPATH=str(r),NODE_PATH='/workspace/wrtc010-20260917/node_modules:/app/node_modules',HF_HUB_OFFLINE='1',PYTHONUNBUFFERED='1',COMPILE_MODE='reduce-overhead',LATEST_INPUT_MAILBOX='1',WARMUP_SHAPES='512x288,768x448,1024x576',TORCH_NUM_THREADS='0',USE_TERMINAL_NOOP='0',USE_GPU_OUTPUT_CAST='0')
log=(r/'service.log').open('w')
p=subprocess.Popen(['node','server.js'],cwd=r,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
record={'pid':p.pid,'port':3001,'worker_count':1,'original_dispatcher_paused':496,'log':str(r/'service.log')}
(r/'runtime.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record))
