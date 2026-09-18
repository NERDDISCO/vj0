import hashlib,json,subprocess,sys,time
from pathlib import Path
sys.path.insert(0,'/workspace')
import release_live_c as release
folder=Path('/workspace/vj0-next-live-c-20260918')
source=folder/'release.json';out=folder/'release-verification.json'
assert not out.exists()
prior=json.loads(source.read_text())
assert prior['owned_pgid']==34687 and prior['live_members_after']==[] and prior['critical_artifacts_saved'] is True
members=release.group_members(34687)
live=release.live_members(members)
gpu=subprocess.check_output(['nvidia-smi','--query-compute-apps=pid,process_name','--format=csv,noheader'],text=True,timeout=15).strip()
original=release.process_state(568)
assert not live and not gpu and original=='T'
record=dict(prior)
record.update(status='released',released=True,verification_epoch=time.time(),prior_release_path=str(source),prior_release_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),prior_status=prior['status'],prior_gpu_compute_after=prior['gpu_compute_after'],verification_note='First post-signal snapshot still listed one zombie PID in nvidia-smi. Later read-only verification finds no live group member or GPU compute process; original failed evidence retained.',members_after=members,live_members_after=live,zombie_members_after=[m for m in members if m['state']=='Z'],gpu_compute_after=gpu,original_state_after=original)
out.write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({k:record[k] for k in ['status','released','verification_epoch','live_members_after','zombie_members_after','gpu_compute_after','original_state_after']}))
