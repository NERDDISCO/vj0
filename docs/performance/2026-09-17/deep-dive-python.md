# Python / GPU investigation, 2026-09-17

**Historical research snapshot: 2026-09-17, before the subsequent GPU experiments.**
Descriptions below such as “unmeasured” or “hypothesis” refer to that research
stage. Terminal prediction skipping and native-thread GPU output conversion
have since been measured; lower thread budgets failed the cross-budget quality
gate. See [DEEP-DIVE.md](DEEP-DIVE.md) for subsequent measurements, acceptance
decisions and current application-validation status. The source reasoning and
proposed experiments below are retained as historical context.

At the time of this investigation, the strongest new lead was a potentially redundant final denoiser call in our own sigma schedule, awaiting correctness and speed measurements. Kernel work remains useful, but the old profile points more strongly at matrix multiplications than at attention. The current alpha-blend path does not use a reference-image KV cache despite its pipeline class name.

This investigation initially used local code, saved measurements and pinned upstream source. No production defaults or model weights were changed by that research. The isolated terminal-step benchmark below was prepared for a separate same-GPU validation; its subsequent results are linked above.

## 1. A final prediction may be multiplied by zero

The worker's `generate()` constructs `np.linspace(1 - alpha, 0.0, n_steps)` and passes all entries to the pipeline. The pinned scheduler shifts those values, then appends a terminal zero itself. The exact model scheduler configuration has dynamic exponential shifting, `shift_terminal: null`, `invert_sigmas: false`, and `stochastic_sampling: false`. Thus the supplied terminal zero remains zero. The final Euler interval is zero to zero, and the update is `sample + (sigma_next - sigma) * model_output`. For finite predictions, that last expensive model evaluation cannot change the sample. This follows from the [pinned scheduler source](https://github.com/huggingface/diffusers/blob/160852de680d36117e0a787f7f8b718232539abb/src/diffusers/schedulers/scheduling_flow_match_euler_discrete.py#L348) and [exact model scheduler configuration](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B/blob/e7b7dc27f91deacad38e78976d1f2b499d76a294/scheduler/scheduler_config.json).

This is different from choosing a lower denoising quality preset. Keep the original schedule and step-count inputs. Simply selecting one step in place of two would also change the pipeline's resolution/step-dependent `compute_empirical_mu`; that is not a clean equivalence test.

The isolated [terminal_noop.py](../../../workers/runpod-flux2klein/bench/terminal_noop.py) experiment parses and verifies the exact pinned pipeline source SHA256, then wraps only the prediction branch. It substitutes a zero prediction only for an observed final zero-length interval, with the original deterministic scheduler, no reference image/cache, matching latent/model dtype and matching scheduler index. It keeps the original scheduler update, callbacks, sigma shifting and output conversion. Its first proof version deliberately pays a scalar GPU synchronization to verify the real sigmas; optimize that guard only after correctness is established.

The [benchmark](../../../workers/runpod-flux2klein/bench/bench_terminal_noop.py) checks same-process equality of every step's callback latents, final RGB pixels and encoded JPEGs, and verifies that the reference's last latent update was itself unchanged. Every fixture also compares the actual `worker.generate()` path without callbacks, so diagnostic synchronization cannot conceal a timing-path difference. Traced and untraced outputs must agree, and global CPU/CUDA RNG state must remain unchanged. It checks finite latents and exactly one skipped prediction for the 2/3/4-step recipes. Both scheduler class identity and source hash are pinned. Non-finite predictions invalidate the algebraic shortcut: zero times NaN or infinity is not harmless. No claim of general model equivalence should precede these checks.

```sh
COMPILE_MODE=reduce-overhead python3 bench_terminal_noop.py \
  --worker-script /workspace/baseline-20260917/inference_server.py \
  --output /workspace/terminal-noop-20260917 \
  --sizes 512x288,768x448,1024x576 --steps 2,3,4 \
  --alphas 0.05,0.10,0.18 --seeds 42,123 --quality-phases 3 \
  --frames 100 --repeats 3 --warmup 4
```

Timing alternates reference/candidate order across three repeats and includes input JPEG decode, VAE encode, denoising/decode, output JPEG encode and final CUDA synchronization. It excludes IPC, network, browser and display. A win must subsequently pass actual source-ordered WebRTC/app tests; faster GPU computation alone does not establish displayed FPS.

## 2. What the saved profile actually says

The existing [512×288, two-step profile](attention-profile-512x288.txt) is Torch 2.11/cu128, not the final Torch 2.13 environment. It contains 16 profiled frames. Compiled graph/wrapper rows overlap child activity; do not sum them with CUDA kernel rows.

| Existing evidence | Observed value | Implication |
|---|---:|---|
| Named FP8 GEMM kernels, summed | 240.084 ms / 448.489 ms GPU activity, 53.53% | Matrix multiplication is a larger target than attention at this shape. |
| Named flash attention, split-KV combine and efficient-attention kernels | 38.432 ms / 448.489 ms, 8.57% | Attention-only work has a limited total benefit here. |
| Two transformer graph calls per frame | 32 calls for 16 frames | Consistent with two requested model evaluations. |
| Input JPEG decode, mean over three timing repeats | 0.259 ms | CPU JPEG decode is not the dominant inference cost. |
| VAE encode, same timing repeats | 3.783 ms | Useful secondary target, but only a part of the frame. |
| Generate plus VAE decode, same repeats | 29.820 ms | Most elapsed time lies in this combined stage. |
| Output JPEG encode, same timing repeats | 0.347 ms | Replacing Pillow alone cannot explain a large FPS jump. |
| Total frame time, same repeats | 34.209 ms | Measured boundary excludes transport/display. |

Stage values come from [compute-attention-profile.json](compute-attention-profile.json). The profiler is a separate untimed diagnostic pass, so its CUDA totals should not be subtracted directly from normal wall timing to assign every millisecond to Python.

In the newer combined profile, input decode plus output JPEG average about 0.618 / 1.102 / 1.544 ms at 512 / 768 / 1024, against total frame means 31.865 / 63.424 / 111.102 ms. Even completely eliminating both measured JPEG stages would remove under 2% of these frame times. These numbers exclude base64/JSON IPC and browser encoding. See [new-stack compute records](compute-torch213-combined-confirmation.json).

An Amdahl bound is a useful sanity check: eliminating the named attention kernel time entirely would improve the profiled GPU work by at most about 9.4%, with all else fixed. That is an optimistic zero-cost bound, not a FPS forecast. Attention's fraction may grow at larger resolutions; those need fresh profiles before extrapolating.

## 3. There is no active reference-image KV cache here

Our custom encoder creates image latents and blends them with noise; `generate()` calls the pipeline with `image=None`. The pinned pipeline therefore leaves `image_latents=None`, never takes its reference-token extraction branch and never enters the subsequent cached branch. It calls the standard transformer path each step. The [pinned pipeline branches](https://github.com/huggingface/diffusers/blob/160852de680d36117e0a787f7f8b718232539abb/src/diffusers/pipelines/flux2/pipeline_flux2_klein_kv.py#L749) explicitly distinguish these cases.

Consequently the historical FP8 reference-KV proposal has no useful cache to optimize in this recipe. Changing to reference-image editing would alter the conditioning method and visual behavior; that is a separate model/quality experiment. Text embeddings are already cached, while the transformer text stream can depend on image tokens after attention; it is not valid to cache all later text K/V simply because the prompt is unchanged.

## 4. Remaining experiments, ranked after the terminal-step check

| Priority | Candidate | Concrete experiment and acceptance condition |
|---|---|---|
| 1 | Refresh the actual GPU profile | Profile all three shapes on the winning stack and source-ordered worker, with CPU and CUDA ranges around preprocess, VAE encode, denoiser, VAE decode, conversion and IPC. Collect a clean untimed trace, then repeat timing without profiling. Count graph breaks/recompiles and identify executed kernels, not only selected backend names. |
| 2 | Fixed-shape tensor hot path / wider graph capture | Prototype an isolated tensor-only alpha-blend → existing denoising schedule → VAE decode callable. Reuse coordinate IDs and schedule state keyed by resolution, prompt shape, alpha, steps and seed. Keep exact normalization, precision and scheduler arithmetic. Compare exact intermediate tensors; count graph launches and host gaps. Existing three individually compiled modules do not by themselves capture Python orchestration between modules. |
| 3 | VAE memory layout and compiler settings | Test channels-last on VAE weights and input, then independently `cudnn.benchmark`, 1×1-convolution lowering and bounded coordinate-descent tuning. Do not combine four knobs before knowing which helps. Preserve decoder weights, image dimensions and output dtype; inspect conversion overhead and output differences. |
| 4 | Same-precision GEMM kernel selection | Extract real FP8 matrix shapes and scale layouts, then benchmark compatible ATen/Triton/CUTLASS/NVGEMM choices. Require actual kernel execution evidence and an end-to-end win. Keep activation/weight quantization and accumulation settings fixed before considering numerical changes. |
| 5 | Projection fusion preserving existing scales | The five dual-stream attention blocks expose separate Q/K/V projections; the 20 single-stream blocks already use fused QKV/MLP projection. Determine whether compiled code already shares activation quantization. A grouped projection kernel must preserve original per-matrix FP8 scales: fusing BF16 weights before per-tensor quantization changes quantization and needs a quality gate. |
| 6 | CPU/GPU overlap and copies | If a fresh trace reveals idle gaps, preallocate reusable pinned upload buffers and overlap next input JPEG decode with current GPU work. Preserve generation/source IDs and newest-frame admission; do not predecode an unbounded stale queue. Avoid moving GPU execution back to multiple Python threads because that already broke FP8/CUDA graph ownership here. |
| 7 | Quantization alternatives | Official NVFP4/other kernels are worth a separate measured branch, but they change arithmetic and possibly images. Treat them as quality candidates, not mathematically identical optimizations. Compare against the current FP8 visual output, not just a BF16 reference. |

Diffusers documents channels-last, compiler tuning, graph-break checks and projection fusion, while warning that fusion support varies by model. These establish supported directions, not measured Klein gains. The pinned transformer already implements fused projection branches for compatible attention modules. [Diffusers acceleration guide](https://huggingface.co/docs/diffusers/optimization/fp16), [pinned transformer implementation](https://github.com/huggingface/diffusers/blob/160852de680d36117e0a787f7f8b718232539abb/src/diffusers/models/transformers/transformer_flux2.py#L253).

PyTorch 2.13 added a CuTeDSL compiler path and CUDA graph inspection/profiling capabilities, but its release announcement does not establish that a particular backend supports our RTX PRO GPU. In the exact v2.13.0 compiler configuration, CUTEDSL GEMM templates are labeled SM100–SM109; our hardware is SM120. Its FP8 scaled-matmul lowering contains separate backend eligibility tests. Do not treat all Blackwell GPUs or every compiler path as interchangeable. [PyTorch 2.13 release notes](https://pytorch.org/blog/pytorch-2-13-release-blog/), [v2.13.0 backend configuration](https://github.com/pytorch/pytorch/blob/v2.13.0/torch/_inductor/config.py#L610), [v2.13.0 scaled matmul lowering](https://github.com/pytorch/pytorch/blob/v2.13.0/torch/_inductor/kernel/mm.py#L1104).

The April `max-autotune` failure requested more shared memory than SM120 has and exhausted its trial budget. A new bounded microbenchmark of the exact matrix shapes and current compiler is reasonable; another open-ended whole-model autotune is not justified by the version number alone. We have not established that the old failure is fixed.

## 5. Avoid repeating completed negative controls

- `inference_mode`, default compilation mode, BF16 VAE, and VAE normalization-constant caching did not produce a clear useful win in the current matrix. Noise/sigma caching plus event timing was a modest measured improvement and remains an experimental profile.
- FA4 reached the real SM120 kernel path but did not improve end-to-end throughput in the measured setup. Named backend selection alone was insufficient execution evidence for all measured frames.
- Sage v1/v3 had graph-break/head-dimension problems in April. A new attempt needs a concrete compatibility change and a profile demonstrating relevant attention cost.
- AOT-Inductor previously matched JIT throughput; its benefit was startup rather than steady FPS.
- Lower JPEG quality, fewer genuine denoising updates, reduced generation resolution, temporal approximation and model replacement are quality tradeoffs. They must not be described as free quality-preserving speedups.
- The successful TensorRT experiment accelerated StreamDiffusionV2's TAEHV decoder. It did not compile our FLUX denoiser or establish equivalent visual output.

See [COMPUTE.md](COMPUTE.md), [NEWSTACK.md](NEWSTACK.md), [STREAMDIFFUSION.md](STREAMDIFFUSION.md), and [April experiment history](../../../workers/runpod-flux2klein/BENCH-2026-04-30.md).

## 6. Promotion gates

Keep input/output JPEG settings, actual resolution, original effective denoising trajectory, seed, prompt and decoder fixed for any claim of preserving current quality. Evaluate a changing waveform, detailed shapes, quiet/dark input, hard transients, prompt switches and resolution switches. For algebraic/caching changes require identical intermediate tensors and output bytes where achievable; for different kernels or quantization, use held-out prompts/seeds and side-by-side moving clips as well as numerical comparisons. A scalar similarity score alone does not establish visual equivalence.

After compute validation, measure the actual app's source-ordered unique outputs and stage submissions, p50/p95/p99 input age, backwards/duplicate/missing source IDs and recovery under settings/reconnect stress. CPU/API optimizations that only reduce queue age are useful, but should be reported as latency improvements rather than extra inference FPS.

## 7. Attribute frame-time tails before changing the graph model

The isolated [follow-up harness](../../../workers/runpod-flux2klein/bench/bench_terminal_followup.py) adds a same-process CPU thread-budget sweep and a separate-process explicit CUDA graph iteration experiment. It keeps all original traced/untraced quality and RNG gates, warms each thread-budget cell, and records raw frame durations, process CPU time/context switches/thread count and cgroup CPU-stat deltas. Cgroup throttled time can aggregate CPUs and include other processes; it is not directly a percentage of this process's wall time.

The pinned image processor performs BF16→FP32 conversion on the CPU in `pt_to_numpy`, after downloading the image. This is inside generation/postprocessing time, not the reported JPEG encoding stage. Excessive CPU parallelism or busy-waiting around that relatively small conversion was a concrete hypothesis to test. An alternative is to perform the exact floating-point cast on GPU before download, accepting a larger transfer; this had not been benchmarked at the time of this research snapshot. Subsequent measurements are in [DEEP-DIVE.md](DEEP-DIVE.md). [Pinned image postprocessor](https://github.com/huggingface/diffusers/blob/160852de680d36117e0a787f7f8b718232539abb/src/diffusers/image_processor.py#L191).

PyTorch 2.11 documents `cudagraph_mark_step_begin()` for cases where its iteration heuristic is wrong. Our proposed location is once before each frame's VAE encode, after prior frame results have been copied to CPU. The exact 2.11 implementation switches to an explicit global generation counter after the first mark. Therefore marked and unmarked policies must run in separate processes; alternating a boolean within one process would contaminate the supposedly unmarked control. A graph-lifetime explanation for any timing tails remains a hypothesis until traces, rerecord counters or controlled measurements support it. [PyTorch 2.11 API](https://docs.pytorch.org/docs/2.11/generated/torch.compiler.cudagraph_mark_step_begin.html), [pinned generation-counter implementation](https://github.com/pytorch/pytorch/blob/v2.11.0/torch/_inductor/cudagraph_trees.py#L2478).
