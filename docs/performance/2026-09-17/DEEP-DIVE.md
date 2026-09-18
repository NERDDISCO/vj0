# Further performance investigation

Follow-up to the user's request to investigate capture, Python/GPU execution,
custom kernels and current models while preserving visual quality. This is a
new investigation after the original [completed matrix](RESULTS.md).
**The repeated remote-app matrix, sustained/lifecycle checks and integrated
production-worker quality/compute tests are complete. Both test pods are stopped.**
[Independent final review](review-deep-final.json) found no blocking issues;
deployment and the proposed future experiments remain unperformed.

## Why 37–38 input FPS matters only sometimes

The user is right: input above the rate the GPU can consume does not increase
generation throughput. At the previously measured 768/1024 resolutions, 37–38
input FPS was already sufficient for the two GPUs. At 512, earlier synthetic
transport tests demonstrated more throughput than that capture rate, although
those tests preceded the source-order correction and cannot promise identical
projector throughput.

There was nevertheless a real capture defect: both application loops compared
an exact 16.67 ms interval against fluctuating callback execution times, then
reset the timer. A healthy 60 Hz callback arriving fractionally early was
rejected, and its opportunity was lost. The same effect reduced the default
30 FPS target to about 23 FPS. Captures blocked by an encoder or the channel
also consumed the old timer's deadline.

The correction uses the animation-frame timestamp, preserves the scheduled
deadline, and consumes it only after admission. It keeps one active JPEG
conversion, the same backpressure checks, JPEG85, dimensions and source pixels.
Missed work is discarded rather than sent in a catch-up burst. Both layouts
use the shared helper. No UI/model/rendering changes were made.

| Resolution | Isolated input FPS before → after | Real app/local WebRTC echo sent FPS before → after |
|---|---:|---:|
| 512×288 | 37.89 → 59.95 | 38.63 → 59.90 |
| 768×448 | 37.24 → 59.95 | 39.16 → 59.29 |
| 1024×576 | 37.69 → 59.95 | 38.29 → 59.49 |

The isolated figures are medians of two ten-second trials per setting; the
real-app figures are one accepted thirty-second observation per setting, with
active WebAudio, the normal application and projector. Its WebRTC peers echo
JPEG bytes locally: **there is no GPU/model/WAN in the right column**. It proves
the frontend can sustain the higher cadence, not that generation runs at 60 FPS.
The real remote GPU confirmation is a separate experiment.

[Isolated diagnostics and regressions](capture-diagnostics/README.md),
[real application loopback evidence](deep-dive-app-loopback/README.md).
The production build and 50 focused capture/decoder/forwarding tests pass.
Capture commit `4170cee` is pushed to `perf/2026-09-live-bench`; GitHub API
verification confirmed the exact remote SHA.

## Queue age is separate from throughput

Reanalysis of the preserved corrected remote-app trials found median worker
queue waits of 0.052/78.546/205.071 ms at 512/768/1024. Those values describe
delivered frames, not discarded work. Median worker processing totals were
32.54/63.17/111.15 ms. Percentiles of independent stages cannot be added to
reconstruct a latency percentile. [Reproducible analysis](deep-dive-capture-existing.json).

The current dispatcher discards new arrivals when each worker has three
pending requests, retaining older queued input. The new isolated experiment
keeps one physically active request per GPU plus one newest waiting input
globally and dispatches it immediately on completion. This differs from merely
lowering the pending limit, which can leave a GPU waiting for the next browser
capture tick. The existing source-order protection remains. Eleven new lifecycle
tests pass. The completed live comparison below records its mixed throughput and frame-age results; it remains experimental.

## Remote application measurement method

The fresh September 18 cohort uses one RTX PRO 6000 Blackwell Server GPU and
the original Torch 2.11/CUDA 12.8 image. The before arm uses frontend `01aa639`
and the existing source-ordered `combined` benchmark worker. The candidate uses
frontend `4170cee` with corrected capture plus terminal skip/GPU output
conversion; the third arm adds the experimental newest-input mailbox. All
worker arms share the earlier cached-noise/sigma and CUDA-event timing changes;
the before arm is not the untouched worker baked into the image. All arms retain
native 128 CPU threads, two steps, alpha 0.1, seed 42, JPEG85 and the same prompt.
Each resolution/configuration has two 60-second trials, with reversed
configuration order in the second repeat. The normal app, active WebAudio and
projector run in a real browser over WAN WebRTC. The mailbox remains benchmark
code; production `server.js` is unchanged.

Reported projector FPS counts unique source frames submitted to WebGL, not
physical monitor refreshes. Frame age runs from input JPEG encode start to
that submission; it excludes upstream audio acquisition/analysis and physical
display latency. Repeated/late frames do not count as useful new frames.
Long tails are retained even when the trial's continuity gates pass. Connected
WebRTC candidate diagnostics establish connectivity, not uniformly low latency.

Before switching trials, capture stops and observed encoder/worker work becomes
idle, with 500 ms of unchanged browser-send/server-receive counters. **Complete
SCTP/network drain is not verified.** Both pages are then closed, a new peer
epoch is created, and at least 40 received outputs and 20 stage submissions
must warm up before measurement. Worker variant, thread count, output converter,
source order and dimensions are checked. These protections reduce transition
carryover; they do not prove no old work overlapped a transition. A future
strict drain test needs current channel-buffer measurements plus an ordered
input barrier acknowledged after worker/mailbox occupancy reaches zero.

The first overnight cohort was interrupted by macOS lid-close sleep after
eight completed trials. Its partial data is preserved separately, including
a multi-second frame-age episode that occurred before sleep. A first morning
restart also remains recorded as a preflight failure: health readiness became
true after the first shape, while two other shapes were still compiling, and
the harness refused to measure. The fresh cohort requires explicit warmup
completion for all three shapes plus idle worker telemetry. None of these
cohorts is silently pooled with the fresh repeated matrix.

[Interrupted cohort](deep-app-wan-interrupted/archive.json),
[sleep and shutdown evidence](deep-app-environment-interruption/interpretation.json),
[excluded startup attempt](deep-app-startup-excluded/archive.json).

### Completed repeated WAN comparison

All 18 trials passed the independent arithmetic, configuration, source-order,
capture-order and cleanup audit. Values below are medians of two trial values;
ranges retain both observations. Percentage changes are the median of the two
matched repeat ratios, rather than ratios of rounded table entries.

| Generated resolution | Before: projector FPS [range] | Capture + compute: FPS [range] | Matched gain | With experimental newest-input queue |
|---|---:|---:|---:|---:|
| 512×288 | 26.84 [26.44–27.24] | 38.93 [36.36–41.49] | +44.91% | 34.54 [30.56–38.53] |
| 768×448 | 14.24 [14.14–14.35] | 21.31 [21.27–21.36] | +49.66% | 20.77 [20.56–20.98] |
| 1024×576 | 8.26 [8.23–8.28] | 12.11 [12.08–12.13] | +46.69% | 12.03 [12.00–12.06] |

This combined comparison does not isolate the capture and two compute changes.
The separate offline controls below address those mechanisms. Actual admitted
input FPS in the capture/compute arm was 50.93/52.33/56.30 at the three sizes,
below its configured 60 target because capture admission and browser work still
apply. That input rate remains above generated throughput at every size.

The mailbox is a **throughput/freshness tradeoff, not a universal improvement**.
At 768, stage median age fell from 191–194 ms to 116–125 ms, while matched
throughput fell 2.56%. At 1024, median age fell from 301–309 ms to 160–161 ms,
with 0.64% lower throughput. But the second 512 mailbox trial had p95/p99/max
age of 2,075/2,396/3,008 ms and 19.72% of stage frames older than one second;
its matched FPS fell 26.35%. The second 1024 mailbox trial also retained a
1,419 ms p99 tail. Existing server-side replacement cannot remove bytes already
queued in browser/SCTP transport.

The compute/capture path has WAN tails too. At 1024 its two p95 ages were
413 and 620 ms, versus 446 and 443 ms before, despite lower median age and
higher FPS. WebRTC stayed connected and the ordering gates passed throughout
this cohort; that does not establish consistently low frame age. Two repeats
reduce a simple order bias but do not remove WAN variation or establish a
long-term tail distribution. Every per-trial tail and all 72 input/receive/
preview/projector boundary rows remain in the [full comparison](review-formal-app.md)
and [machine-readable table](review-formal-app.csv).

Two separate 180-second 768×448 soaks varied actual WebAudio input between
silence, quiet and loud levels. They are sequential observations, not additional
counterbalanced repeats, and are not pooled with the table above.

| Soak | Projector FPS | Age p50 / p95 / p99 / max, ms | Stage frames over one second |
|---|---:|---:|---:|
| Capture + compute, FIFO3 | 21.19 | 193 / 761 / 2,627 / 3,529 | 2.64% |
| Same compute, newest-input queue | 21.13 | 114 / 147 / 607 / 2,231 | 0.89% |

Both passed ordering, configuration, audio and continuity checks. The mailbox
soak then recovered through three prompt changes, three resolution changes,
ten rapid prompt inputs and three deliberate reconnects. Reconnect-to-fresh-
receive times were 11.21–11.23 seconds, consistent with the existing signaling
delay; startup latency was not optimized. Prompt checks establish that settings
were sent and subsequent newly captured inputs returned; they do not inspect
whether the generated image semantically matches the new prompt. Resolution
checks also require matching decoded dimensions on the preview and projector.
These lifecycle actions occur outside the steady-state FPS window.
[Soak and lifecycle evidence](deep-app-soaks-final/archive.json),
[independent soak review](review-soaks.md),
[independent app audit](review-app-final.md),
[source/runtime/build provenance](deep-app-provenance/archive.json).

## GPU and Python investigations

The leading new hypothesis is an unused terminal denoising prediction. Our
provided sigma list ends at zero; the deterministic Euler scheduler appends
another zero. The final prediction is then multiplied by a zero update size.
The isolated candidate preserves the original step count, schedule shifting,
scheduler updates, callbacks and decoder, replacing only that discarded
prediction. Reducing the user-facing step count would alter the earlier
schedule, so that is not an equivalent optimization.

The benchmark compares intermediate latents, finite values, pixels, JPEGs,
unchanged global RNG and the actual uninstrumented worker entry point, using
the same loaded model. Both pipeline and scheduler sources are pinned and
checked. All 162 quality cases passed, including the actual untraced worker path, exact pixels/JPEG bytes, intermediate latents and unchanged CPU/CUDA random state. The independent [audit](review-terminal-noop.json) reconciles all 225 records and 5,400 timed frames and confirms FP8 was actually applied. This is evidence for the tested finite inputs and prompt, not a proof for arbitrary inputs: a discarded non-finite prediction would not be equivalent to zero.

A follow-up investigated CPU thread limits and output conversion. Earlier
profiling observed 229 process threads on a cgroup with approximately 31 CPU
cores of quota. Diffusers copies BF16 image tensors from the GPU and converts
them to FP32 on the CPU inside generation; this cost is not in the JPEG timing
field. The thread sweep recorded 148 throttled CPU periods with the default
128 intra-op threads across three terminal-skip trials. Budgets of 1/4/8/16
eliminated observed throttling in those trials, but the explicit 128-versus-four
quality comparison failed. **Lower thread budgets are not accepted as a
quality-preserving optimization.** The selected candidate retains native 128
threads and moves only the exact BF16-to-FP32 output conversion onto the GPU.

### Measured compute results

One RTX PRO 6000 Blackwell Server GPU, original Torch 2.11/CUDA 12.8 stack,
same FP8 model/decoder/input. Offline fixtures use input JPEG85 and output JPEG80; live application trials use their unchanged JPEG85 settings. Each value is the median of three alternating-order
100-frame trials. Includes JPEG decode, VAE encode, generation/decode, JPEG
output and CUDA completion; excludes worker IPC, WebRTC, browser and display.
No outliers were removed.

| Resolution | Two steps: original → terminal skip | Three steps | Four steps |
|---|---:|---:|---:|
| 512×288 | 29.32 → 30.26 FPS | 22.30 → 29.62 | 18.58 → 22.79 |
| 768×448 | 14.65 → 21.59 FPS | 10.98 → 14.58 | 8.78 → 10.96 |
| 1024×576 | 8.25 → 11.94 FPS | 6.42 → 8.47 | 5.15 → 6.41 |

The first matrix kept the original CPU thread count. At 512/two steps the
median GPU work was shorter, but p95 worsened in all three paired trials.
Across the whole matrix p95/p99 each improve in 24/27 pairs, not universally.
The separate CPU sweep explains why low thread counts looked promising. These
numbers remain historical measurements, not accepted exact-output gains:

| Intra-op threads | Original FPS | Terminal-skip FPS | Skip p95 frame time | Throttled periods, all three skip trials |
|---|---:|---:|---:|---:|
| 128 (original) | 29.26 | 30.44 | 53.54 ms | 148 |
| 1 | 31.34 | 46.28 | 21.71 ms | 0 |
| 4 | 31.41 | 46.35 | 21.65 ms | 0 |
| 8 | 31.42 | 46.38 | 21.66 ms | 0 |
| 16 | 31.28 | 46.15 | 21.73 ms | 0 |

These are 150-frame trials, three repeats per variant and budget, at 512×288,
two steps. CPU throttling counters cover the entire cgroup; aggregated
throttled CPU time must not be interpreted as a wall-time stall percentage.
Per-budget terminal equivalence checks pass, but all nine cross-budget
128-versus-four-thread pixel/JPEG/step-latent hashes differ.
[Failed cross-thread gate](terminal-cross-thread-quality/archive.json).
A subsequent same-process 128→4→128 diagnosis retained intermediate arrays:
the first observed difference appears in VAE-derived encoded latents, before
noise blending or denoising. The fixed-seed noise stays identical. At 512×288,
four-thread output MSE is 57.01–73.92, PSNR is 29.44–30.57 dB, and 58.28–59.20%
of RGB channel values change across three input phases. Returning to 128
threads exactly restores every retained stage and pixel in both repeats.
This identifies where divergence is first observed, not the particular kernel
or compiler decision that causes it. Native threads are retained for the
accepted candidate. [Stage arrays and independent audit](review-native-cast.json).

In the historical thread sweep, native-thread slow frames recur every
100.00–100.05 ms; the four-thread trials contain no frames over 40 ms.
The recurrence and cgroup counters support a CPU throttling explanation, but
do not make the changed-output configuration acceptable.
[Raw periodic-tail analysis](terminal-threads/tail-periods.json).
[Raw full matrix](terminal-noop-full/archive.json),
[thread sweep and raw frame times](terminal-threads/archive.json),
[summary values](terminal-compute-summary.json).

### Native-thread GPU output conversion

The new same-process comparison keeps 128 threads, the same model, decoder,
two-step schedule, and terminal skip in both timing arms. It changes only where
BF16 output is converted to FP32. Three input phases pass exact pixel/JPEG
comparisons against the untouched worker and against terminal skip alone;
global RNG stays unchanged. Three additional comparisons of CPU/GPU conversion
on the same CUDA tensor are exact and finite. The nine retained PNGs also match
byte for byte within each phase.

| 512×288, two steps, native128 | CPU output conversion | GPU output conversion |
|---|---:|---:|
| Median offline FPS | 33.28 | 45.11 |
| Median trial p95 frame time | 54.63 ms | 22.44 ms |
| Frames over 40 ms, out of 450 | 91 | 1 |
| Throttled cgroup periods, all three trials | 136 | 35 |

This is a **35.55% cast improvement with terminal skipping already enabled**,
from three alternating-order 150-frame trials per arm. The untouched worker
was quality-checked but not timed in this diagnostic, so this table is not a
matched original-versus-all-optimizations comparison. No comparison work ran
inside the timed GPU conversion path. Throttling decreases but does not
disappear: GPU-cast trial counts were 0, 22 and 13 throttled periods. These
offline results do not establish application, WAN, projector or
higher-resolution FPS. Native-thread GPU output conversion passes the tested
quality gate. The completed application comparison above measures it combined
with terminal skipping and corrected capture.
[Raw diagnostics, PNGs and NPZ arrays](terminal-native-cast-diagnostic/archive.json),
[independent count/hash/array/timing audit](review-native-cast.json).

### Integrated production controls

A separate fresh process booted the actual production `setup_pipeline()` with
both optimization flags enabled and native thread selection unchanged. It
confirmed source guards, FP8 application and the selected production conversion
callable. All 27 fixtures across three resolutions, two/three/four steps and
three input phases preserved pixels, JPEG bytes and global RNG across original,
terminal-only, cast-only and combined paths. All 54 same-tensor cast checks
passed. This matrix uses alpha 0.1, seed 42 and one fixed prompt; the wider
162-case matrix above tests terminal skipping separately.

| Resolution | Production original → both flags: offline FPS | Gain | Median trial p95 frame time, before → after |
|---|---:|---:|---:|
| 512×288 | 29.37 → 42.23 | +43.8% | 41.37 → 34.78 ms |
| 768×448 | 14.38 → 21.25 | +47.8% | 70.51 → 47.77 ms |
| 1024×576 | 8.52 → 12.72 | +49.2% | 117.79 → 78.85 ms |

These are medians of three alternating 100-frame pairs per size, 1,800 timed
frames total, two steps, input JPEG85/output JPEG80 and CUDA completion included.
This production-path test does not install the live benchmark's earlier
constant-cache/event bundle. The figures are offline compute results, not WAN
or projector FPS. At 512, CPU throttling remains: optimized trial counts were
12/17/21 periods, versus zero at both larger sizes. The earlier cast-only
35.55% result and this full-path comparison have different controls and must not
be added together. [Production proof and profiles](terminal-production-proof/archive.json),
[independent audit](review-production-proof.json).

### What the final profiles suggest next

Separate untimed 20-frame traces at 512×288 and 1024×576 profile the selected
production controls after warmup. The first three profiled outputs at each size
still match the retained quality references. Conservative kernel-name grouping
attributes the following shares of **summed CUDA kernel duration**, excluding
nested host/compiled wrappers:

| Named kernel group | 512×288 | 1024×576 |
|---|---:|---:|
| FP8 matrix multiplication | 42.95% | 36.59% |
| Attention | 8.00% | 14.34% |
| cuDNN | 27.42% | 23.43% |

These shares are diagnostic GPU activity, not percentages of end-to-end frame
latency or promised speedups. They justify first inspecting compatible FP8
GEMM shapes on SM120 and remaining VAE computation. They do not justify
assuming attention replacement is the largest opportunity. Native128 CPU
throttling at 512 remains a separate issue; lowering thread count already failed
the exact-quality gate. Lower-precision NVFP4 and model swaps still require a
separate visual-quality study. [Ranked tests and stop criteria](NEXT-EXPERIMENTS.md).

The profiled GPU encoder-plus-decoder ranges are approximately 7.93/33.07 ms
per frame at 512/1024; transformer ranges are 10.45/37.78 ms. These inclusive
diagnostic ranges must not be added to kernel shares. Actual GPU output
conversion/copy annotations are only 0.038/0.196 ms per frame. The much larger
4.18/17.59 ms host conversion ranges mostly observe waiting for preceding GPU
work, rather than exposing an equally expensive conversion to remove. Remaining
512 CPU throttling needs per-thread CPU/runtime observation: this trace does
not establish a new CPU arithmetic hotspot or justify thread-pool tuning that
could change outputs.

The two-GPU newer-stack pod could not restart: Runpod returned insufficient
free GPUs on its existing host. It remains stopped. New remote-app trials
therefore use the available single-GPU original stack for a matched comparison;
they must not be compared as if they repeat the earlier two-GPU newer-stack
projector measurements.

[Python/kernel source investigation](deep-dive-python.md),
[current model/engine investigation](deep-dive-models.md).

## Experiment ledger

| ID | Experiment | State / acceptance condition |
|---|---|---|
| D01 | Capture deadline correction | Complete: 18 browser trials, 128 simulations, meaningful old-code failure and passing regressions. |
| D02 | Actual frontend capture/echo/projector | Complete: six accepted trials; setup failures retained separately. |
| D03 | Skip terminal zero-update prediction | Offline gate passed: 162 quality cases, 5,400 timed frames across 3 sizes × 3 step counts; all exact checks pass. Native-thread small-resolution tails are addressed by D12; the combined actual-app candidate increased FPS in all six matched repeats. |
| D04 | CPU intra-op budgets default/1/4/8/16 | Measured but rejected as an exact-output optimization: 4,500 timed frames; lower budgets remove observed throttling, but the cross-budget quality gate fails. Retained 128→4→128 arrays locate the first difference in encoded latents and confirm exact recovery at native128. |
| D05 | Explicit CUDA graph frame boundary | Deferred: D12 substantially reduces the measured native-thread tails. Graph marking remains untested and requires a separate process because its global counter persists. |
| D12 | GPU image-output cast | Native128 offline quality gate passed: 900 timed frames, 33.28→45.11 FPS (+35.55%) at 512 with terminal skip in both arms; throttled periods136→35. Combined actual-app confirmation passed at all three resolutions; the integrated production path also passed 27 quality fixtures and 1,800 timed frames across all three sizes. Earlier four-thread cast-only changes (+0.92% / −0.36% / +4.56% at512/768/1024, separate processes,36 exact conversion checks) remain historical diagnostics, not accepted cross-thread gains. |
| D06 | Completion-driven newest-input mailbox | Measured against FIFO pending3 with equal capture/compute settings: mixed throughput/tail results, generally lower median age at larger sizes. Still experimental. A separate FIFO pending1 control was not run in this follow-up. |
| D07 | Actual WAN WebRTC/app confirmation | Complete: 18 matched trials, two separate 180-second audio soaks, lifecycle stress and independent audits. Throughput improves; multi-second WAN tails remain and are retained. |
| D08 | Selective native NVFP4 | Research candidate only; requires actual SM120 execution and matched clips before accepting lower precision. |
| D09 | Compatible GEMM kernels/compiler tuning | Profile-led future work: do not assume SM100/B200 templates support SM120. |
| D10 | Wider graph capture, VAE layout/export, projection fusion | Bounded future experiments detailed in the Python note; no FPS claim before measurement. |
| D11 | New model/engine swap, interpolation or spatial reuse | Research only. Current official Klein4B weights match our revision. Different/approximate outputs require visual acceptance; interpolated frames are not generated FPS. |

Only selected, measured survivors will be presented as improvements. Lower
resolution, JPEG quality or step settings are not treated as free speedups.
The original matrix's failed FA4/Sage/telemetry/codec trials and the extensive
StreamDiffusionV2 results remain relevant negative controls.

## Implementation and reproducibility

Capture scheduling is committed in `4170cee`. The production worker adds
source-guarded `USE_TERMINAL_NOOP=1` and `USE_GPU_OUTPUT_CAST=1` controls;
both default to off, and `TORCH_NUM_THREADS=0` preserves native selection.
These two controls do not install the inherited cached-noise/sigma and event-
timing bundle used by the generated live benchmark worker. Its frozen source
and configuration are preserved separately, so the app FPS table is not a
promise that enabling only those two flags reproduces the whole live bundle.
The mailbox is benchmark-only. No UI redesign, published-image replacement or
main-branch deployment is part of this change.
[Runtime configuration and packaging](../../../workers/runpod-flux2klein/RUNTIME-OPTIMIZATIONS.md),
[live benchmark sources](live-frozen-sources/archive.json),
[production probe sources](post-live-frozen-sources/archive.json).

From the repository root, the saved compressed app evidence can be checked
without a GPU, running pod or original `/tmp` files:

```sh
python3 workers/runpod-flux2klein/bench/audit_app.py \
  --root docs/performance/2026-09-17/deep-app-wan-final \
  --provenance docs/performance/2026-09-17/deep-app-provenance \
  --output /tmp/vj0-saved-formal-audit.json
python3 workers/runpod-flux2klein/bench/aggregate_formal_app.py \
  --audit /tmp/vj0-saved-formal-audit.json \
  --output /tmp/vj0-saved-formal-summary.json
python3 workers/runpod-flux2klein/bench/audit_app.py \
  --root docs/performance/2026-09-17/deep-app-soaks-final \
  --provenance docs/performance/2026-09-17/deep-app-provenance \
  --output /tmp/vj0-saved-soak-audit.json
python3 workers/runpod-flux2klein/bench/aggregate_soak_app.py \
  --audit /tmp/vj0-saved-soak-audit.json \
  --output /tmp/vj0-saved-soak-summary.json
python3 workers/runpod-flux2klein/bench/audit_post_live.py \
  --input docs/performance/2026-09-17/terminal-production-proof \
  --output /tmp/vj0-saved-production-audit.json
```

Both archive-based audits passed after preservation: 18 formal and two soak
summaries, with 72 and eight boundary rows respectively. Each archive manifest
records the original byte count/hash and stored byte count/hash; gzip is
lossless and retains all outliers. [Next bounded experiments](NEXT-EXPERIMENTS.md)
record separate acceptance criteria for admission, kernels, lower precision and
future multi-GPU confirmation.

## Saved state and shutdown

All final browser evidence, production results, PNG quality pairs, CUDA
profiles, executed source bundles and service/supervisor logs were copied
locally before shutdown, with no artifact-transfer errors. Runpod independently
reported both `0pxb4bss2jmbhg` and `9vj8k6guaxsbhw` as `runtimeStatus=stopped`
at **2026-09-18 06:36:54 UTC (08:36:54 Europe/Berlin)**. The shutdown backstop
cancelled only after confirmed stop. The owned browser, target supervisor and
two benchmark Next servers were also closed.

Optional compiler-cache persistence reached its 100-second limit after copying
14,043 of 67,863 files (541 MB of 1.90 GB) to persistent workspace. It did not
delete existing cache files. **Complete cache preservation was not achieved**;
a future start may recompile missing entries. This does not affect the saved
code, measured artifacts or model checkpoints. Pods were stopped, not deleted.
[Verified pod states](deep-operations/vj0-both-pods-stopped-20260918-final.json),
[operation scripts and logs](deep-operations/archive.json),
[cache-copy outcome](deep-operations/cache-persist-20260918-05b.json).

Runpod CLI/API logging was also exercised in the earlier phase: image-pull and
application logs were available through the API, including before SSH was
ready. Serverless-worker logging was not tested. [Exact CLI and log evidence](RUNPOD-LOGS.md).
