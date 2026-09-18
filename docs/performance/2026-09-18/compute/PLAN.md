# N03/N04 bounded compute experiments

Prepared 2026-09-18. These are new isolated experiments; no result or speedup is
claimed until the GPU records exist. Production defaults and historical evidence
are unchanged. Root coordinates one GPU job at a time and owns pod shutdown.

Control: actual production worker, native Torch thread count preserved (128 on
Pod A), current per-tensor FP8 transformer and VAE linears, existing small decoder,
terminal-zero prediction skip enabled, GPU output cast enabled. JPEG85 input and
JPEG80 output match the preceding offline proof. The baseline includes the two
validated optimizations; new gains must be measured relative to this baseline.

## N03: bounded generic Triton scaled-mm

The prior production traces show FP8 GEMM is the largest named kernel class but
do not include matrix shapes. An untimed diagnostic runs the original quantized
transformer eagerly, intercepts actual `aten._scaled_mm` calls, records dimensions,
strides, scales, output dtype and `use_fast_accum`, and ranks the two largest shape
families by summed CUDA-event activity. This diagnostic ranking is not a new
production profile or an end-to-end FPS claim.

Each selected family keeps those real FP8 operands/scales and compares ATen with
only the generic Inductor Triton `mm` template. Allowed tiles are
`(M,N,K,stages,warps)=(64,128,64,4,4)` and `(128,64,64,4,4)`. Their FP8 operand
shared-memory estimate is 48 KiB before compiler overhead. Actual compilation and
execution must succeed on SM120; an estimate is not a compatibility proof.
TMA, CuTeDSL and datacenter-only Blackwell paths are excluded. The backend hook is
audited for Torch2.11 and fails closed for other versions.

The official [scaled-mm lowering](https://github.com/pytorch/pytorch/blob/v2.11.0/torch/_inductor/kernel/mm.py)
passes the original fast-accumulation flag to the template. Its
[template-choice hook](https://github.com/pytorch/pytorch/blob/v2.11.0/torch/_inductor/choices.py)
and [generic scaled-mm heuristics](https://github.com/pytorch/pytorch/blob/v2.11.0/torch/_inductor/template_heuristics/triton.py)
allow the tile list to be restricted before code generation. The harness records
installed source hashes and actual kernel names, rather than trusting a backend
label. Identical input dtype/scale settings do not guarantee identical numerical
output: the exact-output check remains mandatory.

Three alternating micro pairs retain numerical and performance failures. Only
exact finite outputs plus all three pairs faster and a median gain above 2%
advance to full-pipeline trials. Pipeline lowering changes only selected exact
matrix shapes; other operations keep their original backend. Start at the
1024x576 capture shape, then test other requested sizes. No whole-model autotuning.
Unsupported/resource errors or a ten-minute subgraph compilation stop the backend.

## N04: maximum two VAE variants

1. Convert a deep copy of the same quantized VAE weights to channels-last;
   verify all changed four-dimensional parameter layouts retain exact values.
2. Independently compile only VAE encoder/decoder with `conv_1x1_as_mm=True`.
   [Torch2.11 defaults](https://github.com/pytorch/pytorch/blob/v2.11.0/torch/_inductor/config.py)
   set this option false; if the effective control is already true the harness
   rejects the experiment rather than claiming a change.

Neither variant changes checkpoint, selected decoder, weight precision, native
thread count, input size or inference schedule. Four-dimensional layout changes
and GEMM lowering can still change floating-point rounding, so quality is checked
before timing. Failed variants stop expansion; at most two variants run.

## Shared gates and evidence

For three waveform phases at steps2/3/4, compare encoded latents, decoder input
latents, decoder output tensors, final pixels and JPEG bytes. Save images and
compressed stage arrays even on failure. Compare both instrumented quality calls
and the original uninstrumented `worker.generate` path, and require unchanged
CPU/CUDA RNG state. A failing two-step fixture stops further step counts/timing.

Only exact candidates get three alternating 150-frame full-pipeline pairs,
including JPEG decode/encode, VAE encode, generation/decode and final CUDA
completion. No quality snapshots or profiles run inside timed cells. Record
cgroup counters, process CPU usage, native threads and frame distributions.
Require every pair faster and a median gain above 2% to expand. This is a bounded
noise gate, not proof of an application benefit: any survivor still requires the
actual app/transport gate. Three separate untimed frames retain VAE kernel names.

Each result records installed package versions, local source hashes, cached model
snapshot refs/blob identifiers and exact runtime controls. Partial records are
flushed after every cell. A per-compile alarm enforces the intended ten-minute
budget; the root runner must also apply an external process timeout to bound a
CUDA/extension hang that cannot return to a Python signal handler.

## Commands

Upload the current worker/runtime/helpers plus `n03n04_common.py`, `n03_fp8_gemm.py`,
`n04_vae.py`, `metrics.py` and `bench_terminal_followup.py` as an immutable new
bundle. Keep `COMPILE_MODE=reduce-overhead`, offline model caches and the existing
CUDA/library environment. No package installation is required on the validated
Torch2.11/TorchAO0.17 pod. Example commands, run serially only when GPU idle:

```sh
timeout --signal=TERM --kill-after=30s 35m python bench/n03_fp8_gemm.py \
  --worker-script inference_server.py --output /workspace/n03-fp8-20260918 \
  --frames 150 --pairs 3 --compile-timeout 600

timeout --signal=TERM --kill-after=30s 35m python bench/n04_vae.py \
  --worker-script inference_server.py --output /workspace/n04-vae-20260918 \
  --frames 150 --pairs 3 --compile-timeout 600
```

Existing output directories are rejected, so a failed or interrupted attempt
cannot be silently overwritten. Local syntax and CLI checks are complete;
GPU runtime/source compatibility and numerical gates remain to be executed.
