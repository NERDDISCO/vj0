# Next performance experiments

Plan updated on 2026-09-18 after the **completed application cohort and
production-worker GPU proof/profiles**. Both test pods are stopped. This document records proposed
tests and decision rules, not additional measured speedups. Current evidence
and implementation status live in [DEEP-DIVE.md](DEEP-DIVE.md).

## Starting point

Capture scheduling has a measured correction; terminal prediction skipping
has passed the tested exact-quality matrix. Native-thread GPU output
conversion passed its initial 512×288 diagnostic. The integrated production
controls then passed 27 exact pixel/JPEG/RNG cases at all three resolutions and
1,800 timed frames. The separate combined-worker app matrix completed all 18
trials, two audio soaks and lifecycle checks; its throughput gains do not remove
WAN latency tails. [Production proof](review-production-proof.json),
[app comparison](review-formal-app.md). Keep native thread selection;
the four-thread setting changed encoded latents and output pixels and is
rejected for this quality goal. [Compute audit](review-terminal-noop.json),
[native-cast audit](review-native-cast.json), [runtime review](review-runtime.json).

The interrupted WAN cohort is useful evidence but is not the final comparison:
eight of eighteen trials finished, without reverse-order repeats. One 512
candidate frame was already about 6.86 seconds old on receipt, despite roughly
22 ms measured worker processing. Client buffered bytes rose above the 256 KiB
admission threshold. This supports a transport-backlog hypothesis; missing
correlated server timestamps prevent assigning the exact network direction or
cause. The later machine-sleep interruption does not explain that earlier
outlier. [Interrupted-cohort audit](review-app-interrupted.md).

The server's latest-input mailbox can replace an input only after the server
receives it. It cannot evict JPEG bytes already queued in the browser/SCTP
transport. This makes client admission the first remaining latency experiment,
even when inference itself is fast. The completed 18-trial cohort retained a
3.0-second maximum in one 512 mailbox run, and the two 768 audio soaks retained
3.5/2.2-second maxima. The mailbox reduced common-case age at larger sizes but
did not improve every throughput or tail comparison. [Final repeated comparison](review-formal-app.md),
[separate soaks](review-soaks.md).

## Common comparison rules

Use the latest **validated** native-thread configuration as control, with exact
source/model hashes and effective thread count recorded. Keep model, small
decoder, precision, resolution, requested steps, alpha, seed and JPEG quality
fixed unless that experiment explicitly changes one of them. Never compare a
one-GPU old-stack result to a two-GPU new-stack result as an isolated feature gain.

Start with three alternating-order 60-second app trials per control/candidate
at one resolution; expand survivors to 512×288, 768×448 and 1024×576 and a
ten-minute hold. Keep the test machine awake. Warm compilation first, stop capture and verify encoder/worker quiescence
between policies, and collect heavy diagnostics outside timing. For a strict
transport-drain guarantee, add current buffer observations and an ordered
in-band barrier/acknowledgement; the completed harness did not prove complete
SCTP drainage. Retain failures, interruption metadata and every
outlier; do not mix incomplete cohorts into a final median.

Report unique sent, received, preview and stage-submission FPS separately,
alongside p50/p95/p99/max source age, fractions above 250/500/1000 ms, longest
output gaps, source-order errors and byte rates. A stage GL submission is not
physical display presentation. Compare identical saved inputs for per-image
quality; use changing audio clips to assess temporal response.

For admission experiments, proposed promotion thresholds are: preserve at
least 95% of control stage throughput, lower median trial p95 age by at least
10%, and do not worsen median trial p99 age by more than 10%. These are decision
thresholds, not measured promises. A throughput/freshness tradeoff that misses
them remains labelled as such. Reject source reversals, duplicate delivery,
settings contamination, or repeated connection/continuity failures. If three
pairs remain inconclusive, permit one additional three-pair batch, then defer
instead of repeatedly testing until a favorable number appears.

## Ranked tests

### N01 — Send 40 or 30 FPS instead of 60

**Status:** next admission experiment after the completed app comparison;
not yet measured on this combined path. Hold browser admission at 256 KiB and hold server policy and
compute fixed. At 512, compare 60 against 40 first, then 30; at 768/1024 repeat
only candidates that plausibly remain above the measured consumption rate.
Record actual admitted FPS because a configured rate is only a target.

Apply the admission thresholds above. A lower cap must also retain beat/impulse
response in the same audio fixture: fewer captures do not change image-model
settings, but they can miss rapid input changes. If GPU idle gaps grow or useful FPS falls beyond the allowed tradeoff,
reject that cap at that resolution. Do not
reduce render cadence or JPEG quality to obtain the result. Even a failed
512 cap may remain useful at a slower generation resolution.

### N02 — Bound browser bytes before they enter the transport

**Status:** new matched retest, not a wholly untried idea. Older synthetic
16/64 KiB trials exist in [BROWSER.md](BROWSER.md); they do not establish the
result with corrected capture, current compute and the real app.

First hold 60 FPS and compare the existing 256 KiB admission threshold against
64 KiB, then 16 KiB. Change the client threshold only; keep server mailbox and
outbound buffering fixed. Check both before encoding and immediately before
sending. Record JPEG sizes and buffer peaks: the current threshold semantics
allow one admitted image to exceed the limit. If implementing a projected-byte
cap later, allow a single image when empty so a JPEG larger than the cap cannot
starve forever. Keep one encoder in flight and never queue unsent old captures.

Use the same throughput/age gate as N01. Stop expansion if a threshold creates
starvation, burstier output or more lost impulses. Only after separate wins,
compare control / rate-only / threshold-only / combined settings. More aggressive
reliability or ordering changes are a separate protocol experiment, not part
of this threshold test. The [mailbox lifecycle review](review-latest-mailbox.json)
also records its outstanding no-TTL caveat when a sender stops during compilation.

### N03 — Same-precision GEMM/kernel selection on SM120

**Status:** ready for a bounded microbenchmark, not yet executed. The final
production-control traces attribute 42.95%/36.59% of summed CUDA kernel duration
to explicitly named FP8 GEMM at 512/1024, versus 8.00%/14.34% to named attention.
These are kernel activity shares, not end-to-end wall-time fractions or a
promised gain. The older profile describes a different computation path.
[Profile/source analysis](deep-dive-python.md).

Select at most the two largest remaining GEMM shape families from the new trace.
Microbenchmark one compatible backend change at a time, with identical FP8
scales, accumulation, layouts and actual shapes. Confirm the executed kernel
and numerical output; an import or selected backend name is insufficient.
Then run three alternating 150-frame full-pipeline pairs without profiling.
Accept only exact fixture output plus a repeatable end-to-end gain that also
survives the app gate. Otherwise record the numerical/performance tradeoff and
keep the original path. Stop a backend after an unsupported SM120/resource error
or ten minutes compiling a single bounded subgraph; retain the failure.

RTX PRO 6000 Blackwell is SM120, not B200/SM100. The examined PyTorch 2.13
CuTeDSL GEMM settings target SM100–SM109. Do not repeat whole-model autotuning
or attention-backend trials without a new compatible kernel and a measured
remaining bottleneck. [NVIDIA GPU capabilities](https://developer.nvidia.com/cuda/gpus),
[pinned compiler settings](https://github.com/pytorch/pytorch/blob/v2.13.0/torch/_inductor/config.py#L610).

### N04 — VAE and copies, only where the new trace shows time

**Status:** final CPU/CUDA ranges are saved; targeted changes remain untested.
The new traces attribute 27.42%/23.43% of summed kernel duration to cuDNN at
512/1024. Inspect the associated encode/decode ranges before treating all of
that as one optimizable stage. Input conversion/upload, VAE encode, denoiser,
decode and output conversion/download have separate host ranges; IPC requires
separate live-worker instrumentation. Do not add overlapping profiler rows or
subtract them from unrelated wall-clock samples.

Prioritize VAE computation: its profiled GPU encoder/decoder ranges total about
7.93/33.07 ms per frame at 512/1024, while the output conversion/copy GPU
annotation is only 0.038/0.196 ms. The larger host conversion ranges wait for
preceding decoder work and are not a free copy optimization. These are inclusive
diagnostic ranges, not independently additive latency components.

Choose one of: VAE channels-last or one compiler option; investigate reusable
pinned upload buffers only if further evidence identifies an exposed transfer
gap. Keep the already selected decoder and precision. If the trace
shows no material exposed gap in that stage, skip the experiment. Compare
intermediate latents and final pixels/JPEGs on fixed inputs before three paired
150-frame trials per affected shape. Advance only with exact quality and a
repeatable full-frame gain; stop after two unsuccessful targeted variants.
Do not reintroduce multiple Python GPU-execution threads: previous FP8/CUDA
graph ownership failures already rule out that shortcut here.
Remaining native128 CPU throttling at 512 needs per-thread CPU/runtime
observation before wait/spin-policy experiments; the saved trace does not prove
which CPU work causes it. Keep the native thread count and repeat exact-output
checks for any such change.
[Existing negative controls and proposals](deep-dive-python.md),
[Diffusers acceleration guidance](https://huggingface.co/docs/diffusers/optimization/fp16).

### N05 — Selective NVFP4 with a separate visual-quality gate

**Status:** researched, not executed in this setup. BFL publishes a Klein 4B
NVFP4 checkpoint, and FlashInfer documents an SM120 `b12x` path. Neither proves
a gain over our current FP8 model or preservation of its look.
[BFL checkpoint](https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-nvfp4),
[FlashInfer FP4 kernel documentation](https://docs.flashinfer.ai/generated/flashinfer.gemm.mm_fp4.html),
[applicability research](deep-dive-models.md).

First validate one real high-cost layer family at actual sequence shapes and
confirm native FP4 execution, finite output and memory use. Stop on zero/nonfinite
output, unsupported kernels or fallback that expands away the intended low-bit
computation. Then quantize only that family; keep sensitive layers and VAE/decoder
at their current precision. Limit the pilot to two selective configurations
before reassessing the profile and evidence.

Compare against current FP8 using fixed input bytes, three prompts, two seeds,
all three resolutions, and clips covering silence, thin/dense waveforms, abrupt
beats and scene cuts. Retain raw images and paired clips. Measure PSNR/LPIPS,
color/texture/composition and impulse response; a scalar score alone cannot
certify the same artistic result. Any failed visual/temporal gate stops promotion
regardless of FPS. Non-exact candidates require an explicitly recorded visual
acceptance decision and stay separate from the exact-output improvements.

### N06 — Return to two GPUs and the newer stack when available

**Status:** deferred by host capacity. The stopped two-GPU pod could not restart;
this is not evidence that the newer stack or multiple GPUs failed.

Once capacity is available, establish an original-versus-selected comparison
on that same pod, first with one active worker and then two. Fix frontend,
transport/admission and model configuration. Keep native thread selection and
record effective counts and cgroup quota; do not import the rejected four-thread
setting. Require both workers to produce ordered fresh outputs, report stale
output drops and per-worker gaps, and pass prompt/resolution/reconnect recovery.
Run the same three-resolution paired app protocol rather than extrapolating a
one-GPU ratio. If duplicate/out-of-order delivery or host contention erases the
gain, retain independent results and stop promotion. Keep warm capacity for a
scheduled next trial; if capacity fails, mark this entry deferred and continue
the experiments that are not blocked.

### N07 — Shorter ICE gathering, measured as startup only

**Status:** deferred; separate from steady-state FPS. The existing server waits
for gathering completion or a 10-second timeout before returning its answer.
Completion can already occur sooner; reducing the timeout does not inherently
save ten seconds. [Current signaling source](../../../workers/runpod-flux2klein/server.js).

With a warm worker, compare the existing timeout against 2 seconds in an isolated
server. Record offer→answer, answer→open-channel and open-channel→first fresh
result separately. Use at least twelve attempts per variant across available
direct, NAT and TURN-required paths; retain failed attempts and candidate types.
Stop if an earlier answer loses the only viable candidate or increases failures.
If representative relay/NAT paths cannot be exercised, leave the default alone.
Do not combine this with trickle-ICE migration or claim steady FPS from a faster
connection setup.

## Resume record

After each experiment append its exact control/candidate hashes, fixtures,
completed and failed trial paths, quality verdict, throughput/age result and
decision to [DEEP-DIVE.md](DEEP-DIVE.md). Mark **measured**, **rejected**,
**inconclusive** or **deferred** explicitly. Combine only individually accepted
changes and rerun the matched combined control. Use the retained final
production-control profiles to select N03/N04 shapes before spending GPU time
on another kernel or copy path.

Model swaps, spatial reuse and interpolation remain separate research directions:
StreamDiffusionV2 was already tested and changed the visual behavior; generated
FPS must never include an interpolation multiplier. See the preserved
[model/engine comparison](deep-dive-models.md) and [StreamDiffusion results](STREAMDIFFUSION.md).
