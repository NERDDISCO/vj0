# Queued full-model run

Wait for the parent to release C after the input/kernel experiments. The approved
cap is 60 minutes including compilation; preserve failures and partial results.
Do not start another pod or change the parent-managed shutdown guards.

**Re-copy the frozen model probe and analyzer first.** The remote copies predate
the final independent review fixes; they must match
[model-frozen-sources/sha256.json](model-frozen-sources/sha256.json).
The passed kernel gate's helper and production companions remain unchanged.

Use the assigned C GPU0, the existing isolated environment and warm local caches:

```bash
export CUDA_VISIBLE_DEVICES=0
export CUDA_HOME=/workspace/cuda-13.2
export PATH=/workspace/envs/klein-torch213-cu132/bin:/workspace/cuda-13.2/bin:$PATH
export HF_HOME=/workspace/hf-cache
export HF_HUB_OFFLINE=1
export TORCHINDUCTOR_CACHE_DIR=/tmp/vj0-n05-inductor
export TRITON_CACHE_DIR=/tmp/vj0-n05-triton
export FLASHINFER_WORKSPACE_BASE=/tmp/vj0-n05-flashinfer
export TORCH_HOME=/workspace/vj0-n05/torchhub
export MAX_JOBS=8

timeout --signal=TERM --kill-after=30 3600 \
  /workspace/envs/klein-torch213-cu132/bin/python \
  /workspace/vj0-n05/bench/n05_model_probe.py \
  --worker-script /workspace/vj0-n05/inference_server.py \
  --kernel-gate /workspace/vj0-n05/results/kernel-05/result.json \
  --output /workspace/vj0-n05/results/model-01 \
  --frames 100 --pairs 3
```

Capture stdout/stderr and the exact environment/source manifest. No active
compute process may coexist. All paired arms share native 128 CPU threads and
`recompile_limit=64`; compare their own matched controls, rather than importing
production-default8 FPS. The model suite comprises 162 image cases, 108 temporal
PNG frames, nine untimed compiled native-kernel profiles and 3,600 timed frames.
It verifies raw pre-clamp decoder tensors, actual native counts 0/5/10 per
control/candidate profile, fixed RNG and exact return to FP8 after both variants.

If the model manifest reaches `compute-and-images-complete`, run the untimed
assessment within the assigned slot, subject to the same overall cap:

```bash
/workspace/envs/klein-torch213-cu132/bin/python \
  /workspace/vj0-n05/bench/n05_analyze.py \
  --results /workspace/vj0-n05/results/model-01 --device cuda
```

LPIPS 0.1.4 and its 4.96 MB SqueezeNet backbone are already installed/cached;
this command should not install dependencies. Retain the raw PNGs, traces,
strict finite metrics, keyed pair deltas/ratios and paired lossless WebP clips.
The analyzer expects the formal 100-frame, three-pair protocol above. No scalar
metric grants visual acceptance and no candidate is automatically promoted.

Before releasing C, confirm the full process tree and GPU compute list are idle.
Keep the local JIT caches intact for subsequent experiments. The parent decides
when to persist caches or stop the pod.
