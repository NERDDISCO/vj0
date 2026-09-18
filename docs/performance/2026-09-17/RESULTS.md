# Live image performance results — 2026-09-17

For the subsequent capture, Python/GPU and model investigation, see the
[September 18 follow-up](DEEP-DIVE.md). It retains a separate repeated
single-GPU comparison; the two-GPU results below remain historical evidence.

**All selected experiments now have results.** The final audit found and led to
a correction for out-of-order output from multiple GPUs. The corrected
three-resolution app tests and ten-minute soak/lifecycle checks passed. Original
failures and slower trials remain preserved. No UI redesign, main deployment,
or stable image overwrite was made.

The most relevant final numbers are from the **actual app with two GPUs**, using
FLUX.2-klein-4B, two steps, the combined profile and the isolated newer stack:

| Generated size | Test duration | Received FPS | Projector GL FPS | Encode→projector p95 age |
|---|---:|---:|---:|---:|
| 512×288 | 60 seconds | 33.54 | 32.64 | 180 ms |
| 768×448 | 600 seconds | 26.96 | 26.73 | 285 ms |
| 1024×576 | 60 seconds | 17.02 | 17.01 | 462 ms |

These are one completed observation per size, not repeated medians. All three
have zero observed source-order reversals. The long run's stage median/p99 age
is 227.7/329.9 ms; maximum 532.2 ms. Three reconnects recovered in about 11.2
seconds. Projector FPS counts unique WebGL submissions, not physical display
presentation. The [app report](APP.md) has full counts, main-preview rates,
latency distributions, original failure evidence and remaining limitations.

## What the completed measurements show

- **Two GPUs approximately double received throughput in the earlier controlled transport tests.** Before the source-order correction, three watchdog-corrected-service
  60-second live pairs per resolution measured one/two-GPU medians of
  **28.86/55.80 FPS at 512×288, 13.87/27.56 at 768×448, and 8.20/16.38 at
  1024×576**. The 768 runs include a 3.2165-second continuity failure and latency
  spikes; their numbers remain visible. The idle-watchdog fix held through all
  18 trials. Scaling throughput alone does not establish acceptable continuity.
- **The isolated new compute stack reaches about 31–32 /15.8 /9.0FPS per GPU** at
  512×288 /768×448 /1024×576, two steps. Old-stack late control medians are
  28.37 /14.09 /8.18. These are sequential compute batches. The completed live confirmation is
  reported in [NEWSTACK.md](NEWSTACK.md). The combined variant caches fixed-seed noise/sigmas and removes
  intermediate stage synchronization. New Torch/CUDA/TorchAO changes are tested
  together; the whole difference cannot be assigned to one package.
- **The newer combined live profile reaches median 31.52 / 15.97 / 9.03 received
  FPS with one active GPU and 57.21 / 31.48 / 18.08 with two**, at 512×288 /
  768×448 / 1024×576. Within the new stack, adding constant reuse and event timing
  improves one-GPU medians by 4.83% / 2.46% / 1.69%. Throughput and p95 age improve
  in all nine pairs, but p99 worsens in two; two-GPU runs contain notable dips.
  These are pre-ordering-fix browser transport results. They include older source
  results arriving late and cannot establish temporally correct projector FPS.
- **Queue limits trade throughput against age.** On the upgraded WebRTC test
  library, pending 1/2/3 discovery runs measured 20.70 /27.10 /27.86FPS and
  p95 age 141 /166 /188ms. Later alternating timing-events+pending2 comparisons
  improved p95 in three pairs, but p99 worsened in two. Compression can lower
  bandwidth/age, with an explicit image-quality tradeoff.
- **The actual app changes do not show a consistent overall FPS improvement.**
  Next-layout projector median 26.89→27.85FPS (+3.60%); legacy 26.70→26.02FPS
  (−2.56%). Both have run variation. These changes address stale work and
  lifecycle correctness; the data does not support a universal app speedup.
- **StreamDiffusionV2 works, including 14B and real TensorRT.** The 1.3B/TAEHV
  two-step path reaches 43.66–44.49 decodedFPS at 512×288; the corrected TRT fast
  path reaches 22.76–23.11 at 832×480. Its visual transformation and temporal
  behavior differ substantially from FLUX. At 832×480 the 14B/TAEHV path reaches
  7.68–7.71FPS. These are isolated generation measurements, not browser FPS.
- **Several plausible changes did not provide a useful win:** synchronous versus
  asynchronous telemetry on this machine, VAE BF16, inference mode, compile-default,
  normalization caching alone, and this FlashAttention4 integration. Reliable
  unordered transport worsened tail latency in its discovery run. Failed and
  slower trials remain in the evidence.

## Read the numbers at the correct boundary

| Measurement | Includes | Excludes |
|---|---|---|
| FLUX compute | JPEG input decode, VAE encode, denoising/decode, JPEG output encode, final GPU synchronization | Model load, prompt lookup, IPC, network, application rendering |
| Same-host WebRTC | Preencoded JPEG send→receive on the pod | Fixture encoding, browser decode/draw, WAN, app/projector |
| Browser transport | Synthetic fixture draw/encode, actual WAN WebRTC, received JPEG decode/offscreen2D draw | Audio acquisition, app upscaler/projector, compositor/physical display |
| Actual app | Synthetic WebAudio through real analyser, real app capture/transport, main-image RAF observation and stage WebGL submission | Age starts at JPEG encoding; audio acquisition/canvas copy and physical display presentation are outside that age |
| StreamDiffusion | GPU-resident video encode/denoise/decode, pipeline fill/tail effects | Host upload, JPEG/network, audio acquisition, app/browser/display |

Generated/received/drawn frames are counted separately. Dropped or skipped frames
are not counted as useful display throughput. Client ages use one client clock;
worker queue timing, when present, applies only to delivered frames. The app
probe observes a current loaded image at an animation-frame callback and unique
stage GL submissions; it does not prove actual display presentation.

Complete tables and raw artifacts:
[compute appendix](COMPUTE.md), [compute CSV](compute-results.csv),
[browser table](BROWSER.md), [browser CSV](browser-results.csv),
[same-host table](SAMEHOST.md), [newer-stack comparison](NEWSTACK.md),
[StreamDiffusion](STREAMDIFFUSION.md),
[actual app and corrected soak](APP.md), [app comparisons](app-comparison/),
[dependency details](DEPENDENCIES.md).
The index can be regenerated with
`python3 workers/runpod-flux2klein/bench/summarize_results.py --root docs/performance/2026-09-17 --output /tmp/vj0-metrics-index.json`.

## Preserved project state and last implementation

The last pre-existing commit was 141569d on May 3, 2026, adding six legacy scene
templates. Other recent changes added AI/global error logs, pod telemetry,
stage/projector behavior and recording. The project was using **FLUX.2-klein-4B**
with `Flux2KleinKVPipeline` and the FLUX.2 small decoder. The May benchmark had
already adopted FP8 transformer/VAE, PerTensor quantization, reduce-overhead
compilation and independent workers across GPUs. Those are existing features,
not new gains from this session. The saved snapshot already contained the
asynchronous telemetry implementation.

All starting local work is preserved as **a10fdbe** on the pushed branch
`snapshot/pre-performance-2026-09-17`. Experiments and focused fixes are on
`perf/2026-09-live-bench`; pushed checkpoint 7c41b8e includes the idle-watchdog fix.
The original checkout remains on the snapshot branch. Checkpoint 98dc346
preserves the original final soak, all 27 newer-stack live trials and the
source-order correction; later report artifacts are on the same performance branch.

The baseline image was last updated May 3, 18:46:46 UTC and is frozen at
`nerddisco/vj0-flux2klein-worker@sha256:689e0f1cbcc8053727da3539080312fa3645d01649daf2106472679b768ce490`.
Runtime models download separately. This run resolves Klein revision
`e7b7dc27f91deacad38e78976d1f2b499d76a294` and small decoder
`a3efc24f613ef42d9428af62fdbd6f5fd8856c4a`; the exact May model-cache revision
is unknown. Image identity alone cannot establish identical May weights.
The historical benchmark is project evidence of the selected configuration,
not proof that it was universally the best model at that date.

## Focused implementation changes and observed failures

1. **Warmup owns the main GPU thread.** The frozen background warmup first failed
   with FP8 autograd; adding no-grad exposed CUDA-graph thread-state assertions.
   Main-thread optional warmup successfully compiles all three shapes. It waits
   for one second after frame activity; an already-running compile still blocks
   inference. Terminal compile failure clears tracking, and compile timeouts
   remain bounded at ten minutes.
2. **Pod mode forwards actual step/alpha settings in both layouts.** Previously
   the UI could show two steps while the worker retained four. Captured payloads
   now contain two and 0.10. Any 4→2 FPS change is a corrected setting/quality
   change, not an equal-quality inference optimization.
3. **Per-frame settings are snapshotted consistently.** The baseline CPU
   reproduction generated 32×16 after a 16×16 request raced a settings change;
   the candidate retains the requested dimensions, step count and alpha.
4. **Capture/decode work is bounded.** Admission runs before canvas copying and
   again after encoding; obsolete callbacks are invalidated. Legacy preview and
   stage keep one decode in progress plus the newest queued frame, close replaced
   bitmaps and recover after decode errors. Stage forwarding rejects older
   asynchronous results. The Next image element remains the existing renderer.
5. **Dispatcher accounting survives drops and reconnects.** Queue evictions and
   frame errors acknowledge drops; connection epochs reject old responses.
   Optional frame IDs enable measurements while ordinary clients retain raw JPEG.
6. **Idle time no longer counts as a stalled request.** The scaling test resumed
   GPU 1 after 88.1 seconds without output; its first new pending frames triggered
   an immediate watchdog kill. The corrected deadline starts when pending work
   changes 0→1, extends on real output/compile completion, and is not extended by
   additional queued input. Two new regressions fail before the fix and pass
   afterward; all eight lifecycle/frame-ID checks pass. All 18 corrected-service
   GPU trials completed without this watchdog restart.
   [Failure and correction](watchdog-idle-recovery.json).

7. **Late GPU results no longer reverse source order.** The original ten-minute
   app run had 2,293 backwards source transitions at the projector. A private
   dispatcher sequence now accompanies all raw/tagged requests and worker
   responses. Older results are dropped after pending/watchdog accounting;
   only successfully sent JPEGs advance the delivery watermark. Invalid sequence
   echoes fail closed and are logged. The dispatcher and worker deploy together.
   Ten CPU lifecycle/frame-ID checks pass. The corrected app trials and stress
   explicitly test source order. [Original audit](review-app-soak.json),
   [corrected application results](APP.md).

The production frontend build and earlier focused regressions passed. Twelve
real app comparisons use source 7139e0f as the baseline and 4a02d2f as the frontend
candidate. That app baseline already includes step/alpha forwarding and the
warmup/lifecycle fixes; it is not the untouched a10fdbe snapshot. The later
watchdog correction changes the test dispatcher, not the frontend build.

## Actual app comparisons

Both versions used the same saved fixture within each layout, the same warm
one-GPU service at 512×288/two steps, main viewport 1440×900 and stage 1920×1080,
DPR 1. The stage's actual GL buffer was 2048×1152. Synthetic WebAudio drove the
real analyser; exact audio/fixture/config/source identities and raw frame logs
are retained. Each of three alternating pairs ran 60 seconds after warmup.

| Layout / source | Projector FPS, three trials | Capture→stage p95ms, three trials |
|---|---|---|
| Next baseline | 26.885 /28.066 /26.096 | 179.720 /161.620 /296.150 |
| Next candidate | 27.979 /27.853 /26.839 | 178.400 /173.300 /214.275 |
| Legacy baseline | 26.044 /27.125 /26.703 | 298.700 /191.200 /246.625 |
| Legacy candidate | 27.505 /26.019 /25.501 | 190.400 /226.810 /331.850 |

All twelve complete trials passed their channel/visibility/dimension/audio and
fresh-output guards. Independent review reconciled 234,540 common-window events
and 19,426 cross-tab age checks. Comparison scope is within a layout; these numbers
do not establish one layout is faster overall. The first three smoke attempts
failed harness checks (proxy user-agent, viewport/visibility, then RAF observation);
smoke 4 passed. Invalid smoke runs are not promoted into app measurements.

## Quality and unsupported claims

Within-process combined FLUX reference checks record MSE 0, and changed/blank
waveforms produce distinct outputs. Across separately loaded processes, saved
samples differ numerically; visual inspection found the same broad composition
at fixed resolution with local texture/colour differences. Higher resolution
also changes the composition at fixed alpha, rather than merely sharpening the
512 image. [Compute sample review](new-compute-quality.json).

JPEG 60 reduced median size to about 68.9% of JPEG 80 in the nine-current-image
local study, with PSNR 30.05 dB versus 31.49 dB. This compression study is not a live
FPS measurement. VAE BF16 samples looked broadly similar to FP8, with no clear
throughput advantage. Neither PSNR nor a static contact sheet substitutes for
live perceptual preference. [JPEG evidence](jpeg-current-worker.json),
[VAE evidence](vae-quality-comparison.json).

Partial reliability is not selected for the existing shared settings/image
channel: losing settings would require an acknowledged control mechanism.
Reliable unordered delivery was actually tested and regressed. StreamDiffusion
browser display remains unmeasured because its causal chunk/state adapter is a
separate backend integration; isolated throughput and simulated-age results are
reported without substituting them for application FPS.

## Runpod and logging

Funding was confirmed and paid test pods were created. `runpodctl` was updated
from 2.1.9 to **2.14.0-dd55bcf**, and the official project skill to 1.2.0.
**API system/image-pull logs worked before SSH became available.** Container
application logs also worked through the API, including model/compile output.
Live serverless-worker logs were not exercised. [Evidence and tweet draft](RUNPOD-LOGS.md).

At this report's September 17 snapshot, both task pods were running as requested:
one PRO 6000 in **0pxb4bss2jmbhg** and two in **9vj8k6guaxsbhw**, EU-CZ-1.
The running GPU price quote totaled **$6.27/hour**, or **$6.331/hour** including
storage. At 17:32 UTC, the balance was **$50.36**. Both services reported healthy
with all workers ready; five unrelated old pods were stopped.
**September 18 update: both task pods are now verified stopped**, at 06:36:54 UTC,
after the follow-up measurements and artifact backup.
[Current stop verification](deep-operations/vj0-both-pods-stopped-20260918-final.json),
[historical resource snapshot](final-resources.json),
[corrected two-GPU service](final-source-order-service/),
[retained one-GPU service](final-baseline-retained-service/).
The corrected service uses isolated workspace files and a pinned environment;
these experiments have not published a replacement stable Docker image.

## Experiment coverage

| Plan ID | Current outcome | Evidence / qualification |
|---|---|---|
| T00 | Complete | CLI/skill update; real pod API logs; serverless logs untested |
| F00 | Measured failure and corrected warmup | Baseline FP8/thread failures; all three shapes warm on main GPU thread; bounded failure controls |
| F01 | Corrected and verified | Both real app payloads transmit requested steps/alpha |
| B00 | Measured boot and recovery | Immutable image/source/environment, original cold-start failure and timestamps retained |
| B01 | Complete | Five-resolution, 2/3/4-step compute frontier; 85 total compute cells across experiments |
| B02 | Complete | Eight same-host trials and WAN send-rate/mode comparisons |
| B03 | Complete | Waveform A/B/blank, three prompts, detailed background, fixed-seed checks and samples |
| M00 | Complete | Raw/tagged single/stream trials; unknown ages remain unknown |
| P01 | Complete; no material FPS benefit here | Eight controlled same-host sync/async off/on trials, plus WAN polling discovery |
| P02 | Complete; quality tradeoff | Six output JPEG levels, live discovery and repeated JPEG 60 combinations; numerical/sample checks |
| P03 | Complete | Input JPEG95/85/70/60 discovery and entropy stress |
| P04 | Complete | Pending1/2/3 discovery and repeated pending2 combinations; p99 caveats retained |
| P05 | Complete; no reliable benefit | Twelve frame-aware-policy discovery trials; two continuity failures retained, no default promotion |
| P06 | Reliable unordered regressed; partial reliability unsuitable for current protocol | Dropping shared settings messages requires acknowledged controls; no invented lossy-channel result |
| P07 | Implemented and app-tested | Admission/decoder/stage regressions; twelve real app comparisons, mixed FPS result |
| G01 | Complete | Stage-sync removal, event-timed live variant, repeated three-resolution transport trials |
| G02 | Complete | Noise/sigma and normalization caches, exact in-process reference checks; combined variants |
| G03 | Complete; no consistent large gain | Inference-mode compute trials |
| G04 | Complete; BF16 VAE no clear win | Baseline FP8 verified, VAE BF16 speed/sample comparisons |
| G05 | Complete for selected modes | reduce-overhead/default measured; prior SM120 max-autotune failure has no verified enabling change, so not repeated |
| G06 | Complete; no FA4 integration win | Native profiler plus actual SM120 FA4 path; no measured-frame FA4 CUDA trace |
| G07 | Compute/live complete | Isolated Torch2.13/CUDA13.2/TorchAO0.18; repeated compute and all 27 live trials, exact runtime identity retained |
| G08 | Scripted lifecycle complete | Prompt settings, rapid changes, three resolutions and three reconnects recovered; prompt revision execution latency is not proven |
| S01 | Complete; one continuity failure retained | All 18 corrected-service trials; approximately 1.93–2.00× median received-throughput scaling; no watchdog restart |
| V01 | Isolated generation/age complete | Wan1.3B; real app display unmeasured without a causal-state adapter |
| V02 | Complete | Decoder, mode, 1–4 steps, noise, sizes, matched TensorRT/fast controls |
| V03 | Complete | Wan14B standard/TAEHV/noise 0.95; checkpoint cleanup documented |
| C01 | Complete; tail tradeoffs retained | 36 old-stack live compute trials, 13 responsive combinations, 27 new-stack live trials; app acceptance separate |
| C02 | Corrected trials and soak/stress passed | Original temporal-order failure retained; corrected 512/1024 confirmations and ten-minute 768 run have zero reversals. See APP.md and independent corrected-run review |
| R00 | Independent measurement and report audits passed | Original failure, corrected raw capture order, counts/ages, source hashes and archival identity reconciled; manual review, not an automatic Codex Stop hook |

The runbook records retained resources, source identities and reproduction
commands for the completed matrix: [RUNBOOK.md](RUNBOOK.md).
