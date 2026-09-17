# Experiment results — 2026-09-17

## Status

Funding is confirmed and baseline pod `0pxb4bss2jmbhg` is running. Initial live
transport measurements are below. These are discovery runs; no performance
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
| Live serverless worker logs | Pending | Command exists; no live worker validated |
| GPU baseline and optimization sweep | In progress | Initial 512x288 WAN runs measured; remaining sweep pending |
| Compute harness | Prepared, CUDA unverified | Actual worker import, wall-clock FPS, stage timings, A/B/blank and encoded JPEG samples |
| Browser harness | Live WebRTC measured | Raw-image protocol, server-verified stream drain, single-flight timing, decode/draw checks |
| Local bookkeeping tests | Passed: 5 | Python unittest suite in `bench/test_metrics.py` |
| Browser regression tests | Passed: 4 | Mocked decode failure, delayed warmup input/output, and late-control-message cases |
| Archived-output JPEG sweep | Measured locally | 12 existing images, 6 quality settings; no live inference or FPS measurement |
| Syntax and whitespace | Passed | Python AST/CLI help, JavaScript module syntax, `git diff --check` |
| StreamDiffusionV2 | Isolated environment/import and checkpoint downloads passed; forward pass pending | Pinned upstream commit and model/environment notes in STREAMDIFFUSION.md |

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
`resolution-watchdog-events.json`. No higher-resolution WAN number is valid yet.

The candidate now carries optional per-frame IDs and server-owned connection
epochs to measure streaming frame age without mixing old-client responses. It
also acknowledges Python queue evictions/errors, which otherwise leave phantom
pending counts, and forwards the existing JPEG-quality setting. Default app
image payloads remain raw JPEG. These additions are under validation and not yet
running on the GPU pod. Local dispatcher/envelope and browser correlation checks
pass; live correlated-age and final queue regression checks remain pending.

The isolated compute sweep has started, with exact serial jobs in
`compute-jobs.json`. Do not infer completion from job preparation or partial logs.

## Independent preparation review

A separate reviewer found five measurement defects: false single-flight latency
from a slow warmup response; success despite every JPEG decode failing; JPEG
quality samples saved before compression; late stats arriving outside the timing
window; delayed warmup input arriving after a false streaming drain. All five
were corrected. The browser reproductions were retained as
regression tests. This is manual review of preparation, not an automatic stop
gate or independent verification of GPU performance.

The reviewer's focused follow-up passed after the final correction. Five Python
tests and four browser regression tests pass. At that preparation checkpoint both worktrees were clean and both branches
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
