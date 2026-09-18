# N05 selective NVFP4 pilot — 2026-09-18

Status: all six native kernel checks passed; the full-model phase is queued.
**No full-frame FPS or visual-quality result yet.** [Measured gate](README.md). The user
approved the bounded experiment in [N05](../../2026-09-17/NEXT-EXPERIMENTS.md).
Only isolated benchmark files and this evidence directory change. The parent
agent manages the pod and exclusive GPU slot; this experiment does not deploy
or alter defaults.

## Scope and prerequisites

Use the unchanged Klein 4B checkpoint and current small decoder. Quantize
original BF16 image feed-forward weights before the worker's existing FP8
conversion; do not quantize a dequantized FP8 approximation. The two permitted
configurations are:

1. `image_ff_in`: the five dual-stream image FFN input projections.
2. `image_ff_both`: their input and output projections (ten linears total).

Attention, text FFNs, embeddings, modulation, final projection and VAE retain
the control precision. Klein's twenty single-stream blocks fuse their QKV and
MLP projections, so they are excluded from this conservative pilot. This limits
the potential gain: the earlier profile attributes 36–43% of summed CUDA kernel
time to all FP8 GEMMs; that is **not** this selected family's share or an expected
end-to-end speedup. The kernel probe records actual input shapes and the actual
selected FFN shapes, not synthetic square matrices.

Native backend is explicitly `b12x`, with NVFP4 block 16 and 128×4 scale layout.
FlashInfer release `0.6.18.post1` is pinned to source commit
`8bc3b578027791336c6ae87db5c9d76f82cef8bc`. Its source requires CUDA 13+,
SM120/121 and contraction dimension divisible by 32. Our pilot further requires
actual SM120. No automatic backend selection, BF16 fallback or driver change.
Runtime activation quantization cost is included in measurements.

Parent provisions the separate environment using Torch 2.13 CUDA 13.2,
TorchAO 0.18 and the existing pinned Diffusers. NVFP4 is compared with FP8 **in
that same environment**, not against old-stack numbers from another pod.
Native CPU thread selection and the exact-output terminal skip/GPU output cast
remain fixed. Required added packages:

```text
flashinfer-python[cu13]==0.6.18.post1
nvidia-cutlass-dsl[cu13]==4.7.1
cuda-toolkit[nvcc,cccl]==13.2.1
```

FlashInfer's core wheel is 18.3 MB; CUTLASS DSL CUDA 13 libraries are 88.3 MB plus
2.8 MB common bindings. The compiler/header dependencies and JIT cache add more;
reserve 1–2 GB beyond the isolated Torch environment and existing model cache.
No new model checkpoint download is needed. Package versions, source hashes,
actual installed sizes and any dependency adjustments belong in the run record.
The initial toolkit 13.2.0 request conflicted with Torch 2.13's exact 13.2.1
dependency. The corrected constrained install retains Torch 2.13.0+cu132,
TorchAO 0.18.0+cu132, TorchVision 0.28.0+cu132 and Triton 3.7.1. It restores the
comparison's NumPy 2.4.4, Pillow 12.2.0 and Hub 1.13.0 rather than accepting
incidental resolver upgrades. Actual nvcc is 13.2.78 and CCCL 13.2.75.

The pip CUDA 13 components share a coherent `nvidia/cu13` prefix, containing
compiler, headers and runtime libraries. `/workspace/cuda-13.2` links those
components and adds the conventional `lib64/libcudart.so` alias required by
FlashInfer's linker. The relevant paths and `nvcc --version` were checked.
The similarly named
`nvidia-cuda-nvcc-cu13` is a placeholder, not the compiler package.

## Gates and stop conditions

First run `n05_kernel_probe.py` on real intermediate inputs at 512×288,
768×448 and 1024×576. Capture is untimed eager FP8 transformer execution with the
production VAE/conditioning, rather than claiming those captures measure app
speed. The kernel test uses the middle image FFN's input/output linears.

Require finite, nonzero native output; compare against a separately dequantized
FP4 mathematical oracle, record error against FP8, packed storage and peak
memory. The oracle is untimed and never used as an inference fallback. Save
CUDA traces; explicit b12x source dispatch plus the native GEMM kernel identity
must be visible. Stop on unsupported kernel, ambiguous execution evidence,
zero/nonfinite output, oracle failure or catastrophic layer error. Microtiming
uses CUDA graphs on both sides and includes dynamic activation quantization;
it is not full-frame FPS. If neither selected shape family benefits, stop
before spending time compiling full model variants.

If the native gate passes, compare at most the two configurations above with
the FP8 control: three prompts, two seeds, all three resolutions; preserve fixed
JPEG input bytes and raw output PNGs. Add deterministic clips containing
silence, thin/dense waveform, an abrupt beat and a scene cut. Save paired clips
and report PSNR/LPIPS plus color, texture, composition and temporal differences.
Measure warmed full-frame latency (JPEG decode, VAE, generation, output/JPEG
conversion and CUDA completion) in alternating paired trials. Untimed profiling
is separate. No text encoding is included per frame.

Any non-exact output requires a separate recorded visual acceptance decision.
Passing a scalar metric does not accept its artistic look. Failed visual or
temporal review stops promotion regardless of FPS; the default remains FP8.

Estimated durations after environment readiness: kernel gate 10–20 minutes;
two-configuration quality/timing 30–60 minutes if compilation succeeds. These
are planning estimates, not measured initialization claims. Parent's global
hard-stop applies; archive partial evidence and failures before releasing GPU.

## Commands

Run only after the parent assigns the exclusive GPU and the isolated environment
is ready. The probe refuses any active GPU compute process and existing output
directory. Substitute actual copied worker path and configured CUDA prefix:

```bash
CUDA_VISIBLE_DEVICES=0 CUDA_HOME=/workspace/cuda-13.2 \
  PATH=/workspace/envs/klein-torch213-cu132/bin:/workspace/cuda-13.2/bin:$PATH \
  TORCHINDUCTOR_CACHE_DIR=/tmp/vj0-n05-inductor \
  TRITON_CACHE_DIR=/tmp/vj0-n05-triton \
  FLASHINFER_WORKSPACE_BASE=/tmp/vj0-n05-flashinfer \
  /workspace/envs/klein-torch213-cu132/bin/python \
  /workspace/vj0-n05/bench/n05_kernel_probe.py \
  --worker-script /workspace/vj0-n05/inference_server.py \
  --output /workspace/vj0-n05/results/kernel-05
```

The first attempt used a network-volume JIT cache and stopped after 34 seconds
with `OSError 116: Stale file handle` while compiling the unchanged VAE, before
any FP4 matmul. Its failed log/result are retained. The retry places JIT caches
on container-local `/tmp` and shares the original 20-minute kernel-gate deadline.
This preparation failure is not evidence about NVFP4 numerical correctness or speed.

The second attempt reached FP4 weight quantization but could not find the
installed `ninja` executable: the launcher's `PATH` omitted the isolated
environment's `bin` directory. The third attempt fixes only that launch path,
retains local warm caches, and keeps the original deadline. Both failed attempts
are retained, with no FP4 matmul result attributed to them.

The third attempt compiled the quantization extension but its linker expected
`CUDA_HOME/lib64` and unversioned `libcudart.so`, whereas pip supplied
`lib/libcudart.so.13`. The composed prefix adds these aliases without modifying
installed packages. The fourth attempt executed a valid native FP4 matmul, then
stopped at an overly strict profiler-name check: the source aliases
`Sm120B12xBlockScaledDenseGemmKernel` to `DenseGemmKernel`, and the emitted symbol
uses the latter. The reviewed fifth probe requires both the explicit
`dense_blockscaled_gemm_sm120_b12x` source path and `f4E2M1FN` type in the kernel
symbol. This is a trace-format correction, not permission to accept generic
GEMM or fallback execution. Earlier source snapshots/results remain unchanged.

For later offline assessment, `lpips==0.1.4` was installed with `--no-deps`.
Its official SqueezeNet1.1 backbone is 4,958,839 bytes, SHA256
`b8a52dc049b60e4b6ab68ad0df457362afab8b6304b2febdc1650a5dab4d7e7b`.
This small metric model is separate from the unchanged Klein checkpoint.
`n05_analyze.py` uses full-resolution RGB[-1,1] inputs and writes paired lossless
WebP previews alongside the raw PNG evidence. It is not part of timed inference.

## Primary sources checked 2026-09-18

- [Pinned native b12x backend, CUDA/shape guards](https://github.com/flashinfer-ai/flashinfer/blob/8bc3b578027791336c6ae87db5c9d76f82cef8bc/flashinfer/gemm/gemm_base.py).
- [Pinned SM120 kernel: native MmaMXF4NVF4Op](https://github.com/flashinfer-ai/flashinfer/blob/8bc3b578027791336c6ae87db5c9d76f82cef8bc/flashinfer/gemm/kernels/dense_blockscaled_gemm_sm120_b12x.py).
- [Pinned quantization and scaling](https://github.com/flashinfer-ai/flashinfer/blob/8bc3b578027791336c6ae87db5c9d76f82cef8bc/flashinfer/quantization/fp4_quantization.py).
- [Pinned upstream smoke tests](https://github.com/flashinfer-ai/flashinfer/blob/8bc3b578027791336c6ae87db5c9d76f82cef8bc/tests/gemm/test_mm_fp4.py).
- [Upstream dequantized numerical oracle](https://github.com/flashinfer-ai/flashinfer/blob/8bc3b578027791336c6ae87db5c9d76f82cef8bc/tests/gemm/test_unified_gemm_fuzz.py).
- [Exact Klein 4B model configuration](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B/blob/e7b7dc27f91deacad38e78976d1f2b499d76a294/transformer/config.json).
- [Official NVFP4 checkpoint](https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-nvfp4), contextual only: this pilot quantizes selected original weights, not that full-model checkpoint.
