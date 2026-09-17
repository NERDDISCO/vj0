#!/usr/bin/env python3
"""Download pinned official 14B assets on the test pod, before timed GPU jobs.

Large base shards use the pod's separate container disk. Only hash-verified
identical T5/VAE files are shared with the already downloaded 1.3B model.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import urllib.request

os.environ['HF_HUB_OFFLINE'] = '0'
from huggingface_hub import snapshot_download

repo = 'Wan-AI/Wan2.1-T2V-14B'
revision = 'a064a6c71f5be440641209c07bf2a5ce7a2ff5e4'
causal_revision = '2373eb2b39278b3a1aa174964a724ee78ead96f0'
project = Path('/workspace/streamdiffusionv2-20260917')
base = Path('/opt/vj0-wan14b-base-20260917')
original = project / 'wan_models/Wan2.1-T2V-1.3B'
metadata = json.load(urllib.request.urlopen(f'https://huggingface.co/api/models/{repo}/revision/{revision}?blobs=true'))
files = {f['rfilename']:f for f in metadata['siblings']}
shard_bytes = sum(f.get('size', 0) for n,f in files.items() if n.startswith('diffusion_pytorch_model-'))
if not shard_bytes:
    shard_bytes = sum(f['lfs']['size'] for n,f in files.items() if n.startswith('diffusion_pytorch_model-'))
free = shutil.disk_usage('/opt').free
if not base.exists() and free < shard_bytes + 5_000_000_000:
    raise RuntimeError(f'Container disk has {free} bytes free; need shards {shard_bytes} plus headroom')
base.mkdir(parents=True, exist_ok=True)
shared = []
for name in ['models_t5_umt5-xxl-enc-bf16.pth', 'Wan2.1_VAE.pth']:
    source = original / name
    expected = files[name]['lfs']
    if source.stat().st_size != expected['size']:
        raise RuntimeError('Shared file size mismatch: ' + name)
    with source.open('rb') as handle:
        digest = hashlib.file_digest(handle, 'sha256').hexdigest()
    if digest != expected['sha256']:
        raise RuntimeError('Shared file hash mismatch: ' + name)
    target = base / name
    if target.is_symlink():
        if target.resolve() != source.resolve():
            raise RuntimeError('Existing link differs: ' + name)
    elif target.exists():
        raise RuntimeError('Refusing to replace an existing file: ' + name)
    else:
        target.symlink_to(source)
    shared.append({'name':name,'sha256':digest,'bytes':expected['size']})
snapshot_download(repo, revision=revision, local_dir=base,
    allow_patterns=['diffusion_pytorch_model*','config.json','google/*'], max_workers=4)
link = project / 'wan_models/Wan2.1-T2V-14B'
if link.is_symlink():
    if link.resolve() != base.resolve():
        raise RuntimeError('Existing model path points elsewhere')
elif link.exists():
    raise RuntimeError('Refusing to replace an existing model path')
else:
    link.symlink_to(base, target_is_directory=True)
snapshot_download('jerryfeng/StreamDiffusionV2', revision=causal_revision,
    local_dir=project/'ckpts', allow_patterns=['wan_causal_dmd_v2v_14b/*'], max_workers=2)
record = {'base_repository':repo,'base_revision':revision,'causal_revision':causal_revision,
    'base_path':str(base),'shared_files_verified':shared,'container_free_before_bytes':free,
    'base_shards_bytes':shard_bytes,'base_shards':[
        {'name':n,**f['lfs']} for n,f in files.items() if n.startswith('diffusion_pytorch_model-')],
    'status':'downloaded'}
(project/'wan14b-provenance.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record),flush=True)
