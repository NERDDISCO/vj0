import base64,hashlib,json,subprocess,time
from pathlib import Path
root=Path('/workspace/vj0-next-live-c-20260918')
names=['metrics.py','server.js','gpu_output_cast.py','generator-proof.json','inference_server.py','terminal_noop.py','compute.py','hashes.json','runtime.json','service.log','release.json','release-verification.json']
files={name:root/name for name in names}
files.update({name:Path('/workspace')/name for name in ['release_live_c.py','persist_c_caches.py','capture-completion.json','vj0-next-c-remote-guard2.json']})
rows=[]
for name,path in files.items():
 data=path.read_bytes();rows.append({'name':name,'remote':str(path),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'base64':base64.b64encode(data).decode()})
metadata={'observed_epoch':time.time(),'original_dispatcher_state':Path('/proc/568/stat').read_text().rpartition(') ')[2].split()[0],'cpu_max':Path('/sys/fs/cgroup/cpu.max').read_text(),'cpu_stat':Path('/sys/fs/cgroup/cpu.stat').read_text(),'gpu_snapshot':subprocess.check_output(['nvidia-smi','--query-gpu=index,uuid,name,driver_version,memory.used,utilization.gpu','--format=csv,noheader'],text=True,timeout=15),'compute_processes':subprocess.check_output(['nvidia-smi','--query-compute-apps=pid,process_name','--format=csv,noheader'],text=True,timeout=15)}
assert metadata['original_dispatcher_state']=='T' and not metadata['compute_processes'].strip()
print(json.dumps({'metadata':metadata,'files':rows}))
