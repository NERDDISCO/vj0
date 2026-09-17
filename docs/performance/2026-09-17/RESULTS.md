# Experiment results — 2026-09-17

## Status

Funding is confirmed and baseline pod `0pxb4bss2jmbhg` is running. Both funded test pods are running: the original one-GPU pod and two-GPU
scaling pod `9vj8k6guaxsbhw`. The first compute sweep and 30 candidate live
discovery trials are complete. The 24 WebRTC-upgrade comparisons and one clean repeat are complete.
StreamDiffusionV2 and extended compute jobs are running. These are discovery runs; no performance
optimization has passed repeated comparison or been promoted yet.

| Item | Result | Evidence |
|---|---|---|
| Preserve all local work | Complete | `a10fdbe`, snapshot branch pushed |
| Isolated experiment branch | Complete | `perf/2026-09-live-bench` |
| Runpod CLI update | Complete | `runpodctl 2.14.0-dd55bcf` |
| Project Runpod skill update | Complete | Official skill 1.2.0 and lock record |
| API authentication and catalog | Passed | `user`, `pod list --all`, `gpu list --include-unavailable` |
| Baseline image pin | Complete | Digests in PLAN.md |
| Baseline runtime captured | Complete | `baseline-environment.json`: exact packages, driver, model revisions and source hashes |
| SSH readiness | Passed | `pod create --wait` completed after 158 seconds; SSH execution verified |
| Unmodified app production build | Passed | `pnpm install --frozen-lockfile`, `pnpm build` |
| Two-GPU EU-RO-1 create | No pod created | API reported insufficient matching capacity |
| One-GPU create | No pod created | API reported insufficient account funds |
| Live pod API system logs | Passed before SSH readiness | `baseline-pod.json`: image-pull logs while SSH reported no container |
| Live container application logs | Passed | API returned entrypoint, model fetch and compilation messages; samples in `baseline-pod.json` |
| Live serverless worker logs | Not exercised | Pod workloads were used; no endpoint/worker created |
| GPU baseline and optimization sweep | In progress | First seven jobs complete; extended sweeps running |
| Compute harness | Nine baseline settings measured on CUDA | Actual worker import, wall-clock FPS, stage timings, A/B/blank and encoded JPEG samples |
| Browser harness | Live WebRTC measured | Raw-image protocol, server-verified stream drain, single-flight timing, decode/draw checks |
| Local bookkeeping tests | Passed: 5 | Python unittest suite in `bench/test_metrics.py` |
| Browser regression tests | Passed: 5 | Mocked decode failure, delayed warmup input/output, and late-control-message cases |
| Archived-output JPEG sweep | Measured locally | 12 existing images, 6 quality settings; no live inference or FPS measurement |
| Syntax and whitespace | Passed | Python AST/CLI help, JavaScript module syntax, `git diff --check` |
| StreamDiffusionV2 | Wan2.1 1.3B forward pass passed; steady-state comparisons pending | Pinned upstream commit and model/environment notes in STREAMDIFFUSION.md |

## Live baseline discovery runs

One RTX PRO 6000, original image/Python, 512x288, 2 steps, alpha 0.10, seed 42,
JPEG input 85/output 80. Local headless Chrome 149 on this Mac, actual WAN
WebRTC path, 30 seconds after warmup. The failed background warmup thread had
already exited before these runs; no compilation overlapped measurement.

| Run | Received FPS | Offscreen decoded/drawn FPS | Mean worker time | Network RTT snapshot |
|---|---:|---:|---:|---:|
| Telemetry off | 27.43 | 24.43 | 35.65 ms | 21 ms |
| Telemetry every 2 seconds | 25.60 | 22.70 | 37.62 ms | See raw JSON |

Source files: `baseline-webrtc-512x288-2step-stream-telemetry-{off,on}.json`.
No decode failures or transport errors occurred. The first run received 823
images and drew 733; 90 images were skipped while another decode was pending.
Configured sending was 60 FPS, but observed sending in the first run was 62.16
FPS because interval scheduling uses integer milliseconds. Use measured rates.
The reviewer independently reconciled the first run's counts, FPS and bytes.

These are not full-app/projector FPS or exact streaming frame-age measurements.
The separate one-request-in-flight run delivered 6.17 FPS with median capture-to-
draw age 150.5 ms (p95 200.88 ms); mean worker time was 40.05 ms. This measures
latency on the client clock, not concurrent streaming age. See the `single` JSON.

The telemetry difference is one pair of discovery trials, not a repeat-verified
speedup or proof that the asynchronous handler fixes the whole difference.

## Live failures and focused fixes under validation

1. **Background shape warmup crashes with FP8 autograd.** First 512x288 readiness
   was reported at 08:46:14 UTC, about 453 seconds after pod creation. The next
   768x448 shape failed with `derivative for aten::_scaled_mm is not implemented`.
   `setup_pipeline()` disables gradients only in its caller thread; a newly
   spawned warmup thread enables them again. A focused check against the actual
   warmup function fails on the frozen source and passes with `@torch.no_grad()`.
   The decorator removed that error but exposed a second CUDA-graph thread-state
   assertion (`tree_manager_containers`). Moving optional warmup onto the main
   GPU thread successfully compiled 768x448; 1024x576 also completed at 09:12:10 UTC (3/3 shapes).
   The worker waits for one second after frame completion before starting
   optional work; an already-running compile still blocks frames. Terminal
   compile failure now clears dispatcher/client tracking, and the dispatcher
   grants compilation up to ten minutes before the normal frame watchdog applies.
   Four local dispatcher lifecycle/watchdog tests pass; full GPU lifecycle validation remains
   pending. Evidence:
   `baseline-boot-events.json`, `warmup-thread-baseline.json`,
   `warmup-thread-no-grad.json`, `no-grad-recovery-events.json`,
   `idle-recovery-events.json`. Final idle-grace/shutdown/failure CPU checks also
   pass; see `gpu-thread-*-final.json`.
2. **Dynamic pod mode drops step/alpha settings.** Both app layouts send those
   fields only for backend `klein`; the current pod picker selects Klein images
   but sets backend `pod`. The app can show two steps while the worker runs its
   four-step default. The settings paths now include `pod`. Rebuilt production-app payload capture passed for both layouts:
   `app-pod-settings-next.json` and `app-pod-settings-legacy.json` contain
   actual RTCDataChannel sends with two steps and alpha 0.10. Any resulting FPS increase is a corrected step/quality
   setting, not a speedup at equal settings. No visual UI change was made.

The unchanged production app received and displayed generated output at 512x288
before these fixes. This was a smoke check, not a timed full-app benchmark.

## Repeat transport attempts and measurement corrections

Four additional 512x288/two-step runs completed on the recovered Python warmup
code and original dispatcher: telemetry-off received 27.93/28.40 FPS;
telemetry-on received 28.00/28.11 FPS. Thus the earlier apparent telemetry loss
is not consistently reproduced. The fifth repeat failed the strict warmup-drain
check, and the subsequent resolution sweep was interrupted after worker restarts.
See `recovered-webrtc-*.json`, `recovered-batch-failure.json`, and
`resolution-watchdog-events.json`. Those early higher-resolution attempts yielded no valid numbers; later candidate trials below succeeded.

The candidate now carries optional per-frame IDs and server-owned connection
epochs to measure streaming frame age without mixing old-client responses. It
also acknowledges Python queue evictions/errors, which otherwise leave phantom
pending counts, and forwards the existing JPEG-quality setting. Default app
image payloads remain raw JPEG. These additions ran successfully through 30 GPU-backed live trials. Local
dispatcher/envelope and browser correlation checks pass; exact correlated ages
are recorded below. Final live queue comparisons and the soak remain pending.

The first isolated compute sweep completed, with exact serial jobs in
`compute-jobs.json`. Extended jobs are tracked separately.

## Completed isolated compute baseline

One RTX PRO 6000, frozen original Python and environment; 100 frames per run,
three runs per setting after warmup. Median measured wall-clock FPS includes
input JPEG decoding, VAE encode, generation/decode and output JPEG encoding.
It excludes network, application rendering, prompt-cache lookup and model load.

| Resolution | 2 steps | 3 steps | 4 steps |
|---|---:|---:|---:|
| 512x288 | 28.88 | 22.47 | 18.08 |
| 768x448 | 13.98 | 10.63 | 8.68 |
| 1024x576 | 8.28 | 6.34 | 5.07 |

All nine configurations produced the requested dimensions, and changed/blank
inputs produced distinct outputs. This demonstrates input influence on the
synthetic fixture; it is not a real-audio or perceptual-quality score. Raw records
and environment are in `compute-baseline.json`; earlier partial records remain
archived separately. See `samples/baseline-step-quality.jpg`: two steps produce
a more textured appearance, while three/four give smoother shapes in this prompt.
No step-count change is an equal-quality performance optimization.

The queue-drop CPU regression passed against the candidate: a three-frame burst
produced one explicit drop and two outputs with their original IDs/connection
epoch. It ran while StreamDiffusionV2 was still loading, before its timed forward
pass (checked before and after). See `gpu-thread-queue-drops-candidate.json`.

## Completed first compute sweep

All seven serial jobs completed at 09:57:59 UTC, including the final baseline
repeat. Each two-step cell used 100 frames, three runs, on one PRO 6000.
Median wall-clock FPS:

| Variant | 512x288 | 768x448 | 1024x576 |
|---|---:|---:|---:|
| Initial baseline | 28.88 | 13.98 | 8.28 |
| No intermediate stage sync | 28.22 | 14.54 | 8.34 |
| Cached noise/sigmas | 28.61 | 13.94 | 8.22 |
| Inference mode | 29.06 | 14.04 | 8.27 |
| Cached constants + no stage sync | 30.05 | 14.52 | 8.36 |
| Final baseline repeat | 28.85 | 14.05 | 8.21 |

The combined candidate is approximately 4.2%, 3.3%, and 1.8% above the final
baseline repeat. Cached and combined outputs match their in-process baseline
reference exactly (MSE 0 for each size). These are discovery measurements,
not the alternating 60-second live comparisons required for promotion. The
candidate is still confined to the benchmark harness. Caching or inference mode
alone has no demonstrated substantial throughput benefit.

Raw records: `compute-{baseline,no-sync,constants,inference-mode,combined,baseline-repeat}.json`.
The server was restored after the compute sweep. All 30 subsequent live
discovery trials completed successfully and were persisted individually.

## Completed live discovery batch

All 30 trials in `browser-jobs.json` completed with status `measured`; full
records are in `browser-discovery/`. Candidate worker/dispatcher, wrtc 0.8.0,
2 steps, default 512x288, WAN Chrome 149, 30-second discovery windows.
These measure offscreen decode/draw, not the complete app or projector.

- Single-in-flight: raw 6.13–6.50 FPS, tagged 6.17–6.53 FPS.
- Streaming: raw 24.73–27.86 received FPS; tagged 20.23–26.60 FPS.
  The tagged p95 capture-to-draw age ranged from 260 to 884 ms. Sequential
  run variation prevents attributing the whole difference to the ID envelope.
- JPEG output 60: 28.10 received / 26.40 drawn FPS, p95 age 208 ms, 6.42 Mbps
  incoming. This promising single trial requires repeated confirmation and
  image-quality review. No compression default changed.
- Send target 30: 27.93 received / 25.66 drawn FPS, p95 age 200 ms.
- Reliable unordered: 23.37 received / 21.10 drawn FPS, p95 age 1,121 ms,
  p99 3,662 ms. This run regressed; no recommendation to enable it.
- Input buffering capped at 16/64 KB: 26.90/27.10 received FPS, p95 age
  223/219 ms. Other parameters retained their recorded defaults.
- 768x448: 14.03 received/drawn FPS, p95 age 324 ms.
- 1024x576: 8.10 received/drawn FPS, p95 age 488 ms.

The following 24-trial batch uses wrtc 0.10.0 and varies pending/output buffers,
then alternates 60-second baseline, JPEG 60, and combination trials three times.
Its exact jobs are in `browser-wrtc010-jobs.json`; all 24 completed, plus one
clean replacement for the trial excluded due to a concurrent local build.
Raw results are in `browser-wrtc010/`; exclusions are explicit in
`measurement-exclusions.json`. The replacement received 26.96 FPS, p95 age 199 ms.

## Additional correctness fixes and secondary compute

A deterministic concurrent-settings check reproduces a mixed-frame race on the
frozen Python: an input captured at 16x16 is generated/reported at 32x16 after a
reader-thread settings update. Copying settings under the lock for each frame
passes the same check. See `state-race-baseline.json` and
`state-snapshot-candidate.json`. The updated worker also warmed all three GPU
shapes before the wrtc 0.10.0 trials.

Capture scheduling now admits before canvas copy, rechecks after asynchronous
JPEG encoding, and invalidates old callbacks when capture stops. The legacy
layout also cancels its RAF on cleanup. Bounded latest-frame decoding prevents
an unbounded JPEG decode backlog in legacy preview and the stage. Sixteen focused
capture/decode/stage-forwarding checks and the production build pass; full-app live performance
and lifecycle validation are still pending. No visual design change was made.

On GPU 0 of the separate two-GPU pod, the original environment's two-step
baseline measured 28.33 / 13.97 / 8.20 FPS at the three main sizes. Disabling
VAE FP8 measured 28.75 / 13.99 / 8.16 FPS: no substantial speed benefit.
Quantization output-quality comparisons remain pending. Compile mode `default`
measured 27.89 / 13.50 / 8.28 FPS; it did not consistently beat `reduce-overhead`.
See `compute-compile-default.json`. Raw records are
`compute-baseline-secondary.json` and `compute-vae-bf16.json`.

The first PyTorch 2.13 installation failed dependency resolution. A separately
resolved lock addresses setuptools and CUDA-toolkit constraints; the retry is
queued after the extended compute jobs. Failure and retry are separate records.

## StreamDiffusionV2 smoke result

Wan2.1 1.3B, distilled video-to-video checkpoint, 832x480, two steps, standard
VAE, single mode, PyTorch SDPA fallback: 13 output frames from 17 inputs, with
a four-frame output shortfall. The cold forward pass took 3.86 s;
this short run is not a steady-state throughput comparison. Actual frame shapes
and finite RGB ranges passed. The visual output mostly preserves/recolors the
white waveform rather than producing the rich abstract Klein appearance.
See `streamv2-smoke.json` and the input/output clips and quality contact sheet in
`samples/`. Faster decoder, noise strength and scene trials remain pending.

## Independent preparation review

A separate reviewer found five measurement defects: false single-flight latency
from a slow warmup response; success despite every JPEG decode failing; JPEG
quality samples saved before compression; late stats arriving outside the timing
window; delayed warmup input arriving after a false streaming drain. All five
were corrected. The browser reproductions were retained as
regression tests. This is manual review of preparation, not an automatic stop
gate or independent verification of GPU performance.

The reviewer's focused follow-up passed after the final correction. Five Python
tests and five browser regression tests pass. At that preparation checkpoint both worktrees were clean and both branches
were pushed. Later live experiments add new results and focused fixes. GitHub rejected two
SSH pack transfers for the experiment branch; local object/pack verification
passed and the HTTPS push succeeded. No global Git configuration was changed.

## Offline JPEG payload study

Re-encoded 12 archived generated PNGs with the worker's Pillow JPEG options.
These are existing outputs, not freshly generated baseline images. The raw
measurements and image hashes are in `jpeg-archived-results.json`; reproduce
with `bench/jpeg_sweep.py` using Pillow 11.3.0 and NumPy 2.3.3.

| JPEG quality | Median paired payload change versus 80 | Median PSNR versus original PNG |
|---|---:|---:|
| 95 | +69.8% | 49.9 dB |
| 85 | +10.1% | 47.2 dB |
| 80 | Baseline | 46.2 dB |
| 70 | −11.9% | 44.5 dB |
| 60 | −19.1% | 42.9 dB |
| 50 | −24.0% | 42.2 dB |

This supports testing quality 70 and 60 for bandwidth reduction. It does not
establish a live FPS/latency improvement, perceptual acceptability, or the same
savings at other resolutions/content. PSNR alone is not a visual quality gate.
No production JPEG setting was changed.

## How results will be stored

Commit compact JSON summaries and representative synthetic inputs/outputs with
the report. Keep full machine logs and high-volume frame traces as downloadable
artifacts, never credentials or full pod environment dumps. Each summary records
source/image identity, environment, settings, sample count, wall time and latency
percentiles. Record failed runs and timeouts too.

## Promotion decision

None yet. Passing focused checks and single discovery trials do not establish
a repeatable performance improvement.

## Repeated transport results and resolution frontier

On wrtc 0.10.0, pending limits 1/2/3 delivered 20.70/27.10/27.86 received FPS
with p95 capture-to-draw ages 141/166/188 ms. Limiting the queue trades throughput
for responsiveness. The three alternating 60-second combined trials
(JPEG 60, send target 30, input buffer 16 KB, pending 2, output buffer 64 KB)
received 25.20/23.67/26.15 FPS with p95 ages 164/257/163 ms. Their paired
baselines received 27.22/26.65/24.68 FPS with p95 ages 308/203/997 ms.
This is a latency/throughput tradeoff, not a verified overall FPS improvement.
JPEG 60 alone received 27.06/27.31/27.55 FPS; WAN variation and one 531 ms
p95 tail prevent claiming a uniformly improved result.

The combination at 768x448 delivered 13.83 received/drawn FPS, p95 235 ms;
at 1024x576 it delivered 8.18 received/drawn FPS, p95 350 ms. These are
offscreen benchmark draws, not complete app/projector rendering. The wrtc
version trials were sequential batches, so they do not establish an isolated
library speedup. No dependency or compression default was promoted.

On GPU 0 of the second pod (same PRO 6000 model), the additional compute
frontier medians were 49.49/39.47/32.43 FPS at 256x144 for 2/3/4 steps,
and 4.84/3.66/2.91 FPS at 1280x720. See `compute-resolution-frontier.json`.
These include JPEG decode, inference and JPEG encode, excluding transport/display.
