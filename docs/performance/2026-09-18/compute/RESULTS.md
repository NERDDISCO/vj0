# N03/N04 compute results — 2026-09-18

Neither experiment produced a candidate that cleared its predeclared gates.
Production behavior remains unchanged. These trials used Pod A, Torch 2.11.0+cu128,
TorchAO 0.17, SM120, native 128 threads, the existing FP8 weights and small decoder,
and the already validated terminal-zero skip plus GPU output cast. New results
are relative to that optimized control, not the original pre-optimization worker.

## N03: two compatible FP8 GEMM families

Both generic Triton candidates compiled and executed on this SM120 GPU, and both
produced exact finite tensors against the original ATen/cuBLAS operation for the
captured operands. Saved generated source establishes two FP8 input pointers,
`tl.dot`, exact matrix dimensions and an allowed tile; independent raw trace
review confirms exactly three matching template launches per candidate. This is
an actual compatible backend result, not a label inferred from a pointwise kernel.

| Actual M × N × K | Original median ms/call | Triton median ms/call | Latency change | Micro decision |
| --- | ---: | ---: | ---: | --- |
| 2368 × 27648 × 3072 | 0.764535 | 0.752431 | −1.583% | Below the required >2% reduction |
| 2368 × 3072 × 12288 | 0.395589 | 0.414810 | +4.859% | Slower median; one pair regressed |

Each median contains three alternating pairs of 100 repeated compiled calls,
measured by a CUDA-event interval. These are microbenchmark intervals, **not
production FPS or isolated kernel-duration measurements**. The generic top-level
`timing_boundary` field in raw results describes the common pipeline harness;
the `micro-measured` rows' explicit timing scope is authoritative here. The first
family's reciprocal throughput change is +1.609%; that is not an application gain.

The actual 1024×576 eager-transformer inventory selected these two families by
summed CUDA-event activity. That diagnostic ranking is not the production
compiled kernel profile. No family passed the predeclared requirement of every
pair faster and candidate median below 98% of control median. Therefore no
full-pipeline, extra-resolution, visual-output or application timing followed.
The micro comparator records exact output, zero MSE and finite tensors; the raw
micro tensors were not retained for independent numerical recalculation.

The initial v2 attempt stopped before candidate compilation because its source
proof referenced `PyCodeCache.cache`, which does not exist in installed Torch
2.11. Its raw `backend-failed` label is a **harness API failure**, not evidence that
the backend or GPU is unsupported. The complete failed attempt is retained. V3
only corrected source capture to the actual `load_by_key_path` classmethod,
including cache hits, with exact descriptor restoration. Actual CPU-only API
preflight and independent review passed before rerunning N03 in a fresh output
directory. Shapes, tiles and numerical/timing gates were unchanged. The existing
600-second compile deadline conservatively included untimed proof/profile work.

## N04: same-weight VAE variants

Both variants failed the exact-output gate at 512×288, two steps, across all three
waveform phases. Differences start in encoded VAE latents and reach final images.
The actual uninstrumented generation path confirmed the same pixel differences;
traced versus untraced control outputs were exact, and global RNG state remained
unchanged. Channels-last conversion also verified exact values of all 64 affected
four-dimensional parameter tensors before compilation.

| Candidate | RGB MSE range | PSNR range (dB) | Maximum channel error | Result |
| --- | ---: | ---: | ---: | --- |
| Channels-last VAE | 60.60–75.76 | 29.34–30.31 | 78–109 / 255 | Exact-output gate failed |
| VAE `conv_1x1_as_mm=True` | 71.55–89.56 | 28.61–29.58 | 95–109 / 255 | Exact-output gate failed |

The [comparison image](n04-quality-comparison.png) retains the broad psychedelic
composition with local detail changes. The gate failure is not evidence that
perceptual quality degraded or that either variant is slower. Timing was
intentionally not run after quality rejection; no VAE speed claim is available.
All six saved PNG pairs and all three intermediate stage arrays were independently
recomputed by [audit_n04.py](../../../../workers/runpod-flux2klein/bench/audit_n04.py)
and exactly match the recorded metrics. Raw/archive parity passes.

## Evidence and scope

- [V2 raw evidence](attempt-v2/): failed N03 API attempt and both completed N04 trials.
- [V3 raw evidence](attempt-v3/): completed N03 microbenchmarks, generated source and traces.
- [N03 independent source/timing audit](review-n03.json), [N04 numerical audit](review-n04.json), and [installed API preflight](cpu-preflight-v3.json).
- Frozen source bundles `frozen`, `frozen-v2` and `frozen-v3` preserve every version.
- Input JPEG85/output JPEG80 is the offline pipeline configuration; no new live WebRTC claim is made.

These negative results close the bounded N03/N04 groups without changing the
quality gate after seeing results. Wider tile searches or relaxed numerical
acceptance would be new experiments, not untested options claimed to be exhausted.
