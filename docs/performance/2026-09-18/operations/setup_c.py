#!/usr/bin/env python3
"""Isolated dependency setup on the replacement two-GPU test pod."""
import os,subprocess,json,time
from pathlib import Path
root=Path('/workspace/vj0-next-c-setup');root.mkdir(exist_ok=True)
uv='/workspace/tools/uv-py/bin/uv'
venv='/workspace/envs/klein-torch213-cu132'
state={'started_epoch':time.time(),'stages':[]}
env=dict(os.environ,UV_CACHE_DIR='/workspace/uv-cache',UV_LINK_MODE='copy')
commands=[
 ['venv',[uv,'venv','--system-site-packages','--python','/usr/bin/python3',venv]],
 ['torch',[uv,'pip','install','--python',venv+'/bin/python','--index-url','https://download.pytorch.org/whl/cu132','torch==2.13.0','torchvision==0.28.0','torchao==0.18.0']],
 ['fp4',[uv,'pip','install','--python',venv+'/bin/python','flashinfer-python[cu13]==0.6.18.post1','nvidia-cutlass-dsl[cu13]==4.7.1','cuda-toolkit[nvcc,cccl]==13.2.0']],
 ['verify',[venv+'/bin/python','-c','import torch,torchao,diffusers,transformers; print(torch.__version__,torch.version.cuda,torchao.__version__,diffusers.__version__,transformers.__version__,torch.get_num_threads())']],
 ['freeze',[uv,'pip','freeze','--python',venv+'/bin/python']],
]
for name,argv in commands:
 row={'name':name,'argv':argv,'started_epoch':time.time()};state['stages'].append(row)
 (root/'status.json').write_text(json.dumps(state,indent=2)+'\n')
 with (root/(name+'.log')).open('w') as log:
  try:r=subprocess.run(argv,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=1200);row['exit']=r.returncode
  except subprocess.TimeoutExpired:row['exit']='timeout'
 row['finished_epoch']=time.time();(root/'status.json').write_text(json.dumps(state,indent=2)+'\n')
 if row['exit']!=0:raise SystemExit(1)
state['completed_epoch']=time.time();state['status']='ready'
(root/'status.json').write_text(json.dumps(state,indent=2)+'\n')
