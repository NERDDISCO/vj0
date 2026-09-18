"""Launch the frozen two-worker app only after the C compute slot is released."""
import hashlib
import json
import os
import subprocess
from pathlib import Path

assert Path('/proc/568/stat').read_text().split()[2] == 'T'
assert not subprocess.check_output(['nvidia-smi', '--query-compute-apps=pid', '--format=csv,noheader'], text=True).strip()
r = Path('/workspace/vj0-next-live-c-20260918')
assert not any((r / name).exists() for name in ('runtime.json', 'service.log')), 'Use a fresh attempt directory; preserve prior logs'
assert hashlib.sha256((r / 'hashes.json').read_bytes()).hexdigest() == '8eaf61588016d923acd829b327a6a49d0580fc21866a8b7c55fbec6745a51d56'
sources = json.loads((r / 'hashes.json').read_text())
assert set(sources) == {'metrics.py', 'server.js', 'gpu_output_cast.py', 'generator-proof.json',
                        'inference_server.py', 'terminal_noop.py', 'compute.py'}
for name, digest in sources.items():
    assert hashlib.sha256((r / name).read_bytes()).hexdigest() == digest, name
env = dict(x.split('=', 1) for x in Path('/proc/568/environ').read_bytes().decode().split('\0') if '=' in x)
env.update(
    PATH='/workspace/envs/klein-torch213-cu132/bin:' + env['PATH'],
    PORT='3001', WORKER_COUNT='2', INFERENCE_SCRIPT=str(r / 'inference_server.py'),
    PYTHONPATH=str(r), NODE_PATH='/workspace/wrtc010-20260918/node_modules:/app/node_modules',
    HF_HUB_OFFLINE='1', PYTHONUNBUFFERED='1', COMPILE_MODE='reduce-overhead',
    LATEST_INPUT_MAILBOX='1', WARMUP_SHAPES='512x288,768x448,1024x576',
    TORCH_NUM_THREADS='0', USE_TERMINAL_NOOP='0', USE_GPU_OUTPUT_CAST='0',
    TORCHINDUCTOR_CACHE_DIR='/tmp/vj0-c-live-torch213',
    TRITON_CACHE_DIR='/tmp/vj0-c-live-triton213',
)
with (r / 'service.log').open('x') as log:
    p = subprocess.Popen(['node', 'server.js'], cwd=r, env=env, stdout=log,
                         stderr=subprocess.STDOUT, start_new_session=True)
record = {
    'pid': p.pid, 'port': 3001, 'worker_count': 2,
    'original_dispatcher_paused': 568, 'log': str(r / 'service.log'),
    'python_prefix': '/workspace/envs/klein-torch213-cu132',
    'sources': sources,
}
(r / 'runtime.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record))
