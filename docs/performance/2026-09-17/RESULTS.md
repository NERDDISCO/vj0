# Experiment results — 2026-09-17

## Status

Preparation is committed and backed up on the experiment branch. GPU execution
is waiting on account funding. **No new GPU performance numbers have been measured.**

| Item | Result | Evidence |
|---|---|---|
| Preserve all local work | Complete | `a10fdbe`, snapshot branch pushed |
| Isolated experiment branch | Complete | `perf/2026-09-live-bench` |
| Runpod CLI update | Complete | `runpodctl 2.14.0-dd55bcf` |
| Project Runpod skill update | Complete | Official skill 1.2.0 and lock record |
| API authentication and catalog | Passed | `user`, `pod list --all`, `gpu list --include-unavailable` |
| Baseline image pin | Complete | Digests in PLAN.md |
| Two-GPU EU-RO-1 create | No pod created | API reported insufficient matching capacity |
| One-GPU create | No pod created | API reported insufficient account funds |
| Live pod/container log retrieval | Pending live pod | Stopped-pod probe timed out without log lines; not a successful log test |
| Live serverless worker logs | Pending | Command exists; no live worker validated |
| GPU baseline and optimization sweep | Pending funding | See experiment queue in PLAN.md |
| Compute harness | Prepared, CUDA unverified | Actual worker import, wall-clock FPS, stage timings, A/B/blank and encoded JPEG samples |
| Browser harness | Prepared, real WebRTC unverified | Raw-image protocol, server-verified stream drain, single-flight timing, decode/draw checks |
| Local bookkeeping tests | Passed: 5 | Python unittest suite in `bench/test_metrics.py` |
| Browser regression tests | Passed: 4 | Mocked decode failure, delayed warmup input/output, and late-control-message cases |
| Archived-output JPEG sweep | Measured locally | 12 existing images, 6 quality settings; no live inference or FPS measurement |
| Syntax and whitespace | Passed | Python AST/CLI help, JavaScript module syntax, `git diff --check` |
| StreamDiffusionV2 | Source inspected, runtime pending | Pinned upstream commit and model/environment notes in STREAMDIFFUSION.md |

## Independent preparation review

A separate reviewer found five measurement defects: false single-flight latency
from a slow warmup response; success despite every JPEG decode failing; JPEG
quality samples saved before compression; late stats arriving outside the timing
window; delayed warmup input arriving after a false streaming drain. All five
were corrected. The browser reproductions were retained as
regression tests. This is manual review of preparation, not an automatic stop
gate or independent verification of GPU performance.

The reviewer's focused follow-up passed after the final correction. Five Python
tests and four browser regression tests pass. Both local worktrees are clean;
the snapshot and experiment branches are pushed to GitHub. GitHub rejected two
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

None yet. Preparation and locally passing tests do not establish a GPU speedup.
