# Live image performance experiments — 2026-09-17

## Objective and scope

Increase useful displayed FPS and the resolution sustainable at 30 FPS, while
measuring capture-to-display latency and preserving audio-driven input influence.
No UI redesign, no wholesale pipeline replacement. StreamDiffusionV2 is an isolated
comparison, not a change to the application's default backend.

Run experiments sequentially on the same warm machine. Change one variable at a
time, save raw results immediately, and repeat promising combinations against the
baseline. A failed or slower experiment is a result, not something to omit.

## Preserved starting state

- GitHub/main before this session: `f3e30d6`.
- Latest pre-existing local commits: `141569d` (11 ahead of GitHub/main).
- Complete work-in-progress snapshot: `a10fdbe`, branch
  `snapshot/pre-performance-2026-09-17`, pushed to GitHub.
- Experiment branch: `perf/2026-09-live-bench`.
- Baseline image: `nerddisco/vj0-flux2klein-worker`.
- Immutable manifest digest:
  `sha256:689e0f1cbcc8053727da3539080312fa3645d01649daf2106472679b768ce490`.
- Linux amd64 digest:
  `sha256:2822032324bc17f15c2751fee8c7e0f48360ae5a57b39db709337ac7caa5135f`.
- Image last updated: 2026-05-03T18:46:46Z; compressed size about 6.49 GB.
- Models download at runtime. Record their resolved Hugging Face cache revisions;
  an image digest alone does not freeze model weights or establish May parity.
- Existing local snapshot includes the asynchronous telemetry fix. Compare the
  baked image against that snapshot before attributing gains to new work.

## Tooling and infrastructure

- Updated CLI from `2.1.9-673143d` to `2.14.0-dd55bcf` with `runpodctl update`.
- Updated project Runpod skill from the official `runpod/runpod-plugins-official`
  repository; version 1.2.0, references and lock record included in Git.
- Verify both container and system output through `runpodctl pod logs`. SSH
  availability is a separate observation. Record the first successful log before
  SSH if possible; do not claim this happened just because the CLI exposes it.
- `serverless logs` is available too. Do not claim live serverless-worker log
  verification without an endpoint/worker actually returning output.
- Initial choice: RTX PRO 6000 Blackwell Server Edition in EU-RO-1; 96 GB VRAM
  permits the resolution sweep and a separate video-model experiment. Try one
  GPU if a two-GPU allocation is unavailable. Only compare hardware at identical
  settings; never label 512-square versus 512x288 as a hardware speedup.
- API quotes on this date: PRO 6000 secure $2.09/GPU-hour; RTX 5090 $0.99/GPU-hour,
  excluding storage. Re-query before provisioning.
- Keep the test pod warm between runs per user authorization. Record IDs, actual
  hourly price, creation time, and final running state. Do not modify old pods.
- Funding resolved on 2026-09-17. Baseline pod `0pxb4bss2jmbhg` was created in
  EU-CZ-1 after EU-RO-1 reported insufficient capacity. One PRO 6000 at $2.09/hour;
  pinned image and original three-shape warmup. API system logs were received
  while SSH was still unavailable. Container logs and original-image inference
  are verified. Original warmup failed; the main-thread correction compiled all
  three resolutions. See RESULTS.md for exact identities and measurements.


## Measurement contract

1. Record image/source hashes, GPU, driver, CUDA, torch, torchao, diffusers,
   transformers, environment, resolution, prompt, seed, alpha, steps, JPEG
   qualities, worker count, queue/buffer limits, transport mode, and run location.
2. Inputs: deterministic animated waveforms on a dark background, a waveform
   over a detailed synthetic background, and a high-entropy transport stress
   image. Primary results use waveform content; random noise alone is not a VJ
   workload. Use three fixed prompts and seed 42; retain samples.
3. Warm up every tested shape/variant. No background compile may overlap the
   measured interval. Separate cold start, compilation, and steady state.
4. Discovery: at least 100 measured frames per compute cell; transport: 30 s
   after warmup. Confirm candidates using three alternating baseline/candidate
   runs of 60 s; report median and run spread. Final soak: 10 minutes plus rapid
   prompt changes, resolution changes, disconnect/reconnect, and telemetry.
5. Report actual wall-clock FPS, not just 1000/mean(GPU milliseconds). Report
   generated, received, and displayed FPS separately. Record dropped frames and
   send/decode backpressure, output KB/frame and Mbps, GPU utilization and VRAM.
6. Capture-to-display latency is measured on the client clock, correlated by
   frame ID. Report p50/p95/p99, network RTT separately, and worker queue time.
   Uninstrumented streaming runs have unknown frame age. A single-in-flight run
   can measure exact request/response latency but is not maximum throughput.
7. GPU correctness: fixed seed reference comparisons, waveform A/B and blank
   input controls, dimensions and finite pixels, output samples, and visible
   quality assessment. Record image MSE/PSNR as diagnostics, not a substitute
   for temporal quality or input responsiveness.
8. Interpolation/display duplication does not count as generated FPS. Changing
   steps, JPEG quality, resolution, alpha or model is an explicit quality tradeoff.
9. Promote a speed change only when repeated measurements beat run-to-run noise,
   no relevant correctness check fails, and p95 frame age does not regress
   materially without being reported. Keep speculative options off by default.

## Experiment queue

| ID | Experiment | Values / comparison | Outcome needed |
|---|---|---|---|
| T00 | Tool update and API logs | installed version, auth, pod system/container logs, optional serverless logs | Real log evidence and limitations |
| F00 | Fix warmup thread ownership/lifecycle | original background thread versus no-grad/main-thread warmup | Reproduced failure, thread regression, all selected shapes warm on GPU |
| F01 | Forward dynamic-pod step/alpha settings | original app payload versus corrected payload in both layouts | Real transmitted values; label changed-step gains honestly |
| B00 | Immutable image cold boot | pinned image, no old cache, one then two GPUs if available | Boot/compile time and environment |
| B01 | Compute baseline | 256x144, 512x288, 768x448, 1024x576, 1280x720; 2/3/4 steps | FPS/latency/resolution frontier |
| B02 | Baseline through WebRTC | local pod client then actual local browser/WAN; 30/60/120 send FPS | Compute versus transport bottleneck |
| B03 | Baseline correctness | 3 prompts x waveform A/B/blank; fixed seed and alpha | Input influence and samples |
| M00 | Correlation instrumentation | raw versus tagged frames, identical worker | Instrumentation overhead; exact frame age |
| P01 | Telemetry fix | baked synchronous handler versus saved asynchronous handler; poll off/on at 2 s | Delivered FPS and tail stalls |
| P02 | JPEG output quality | 95/85/80/70/60/50, input fixed 85 | Bytes/FPS/PSNR and visible tradeoff |
| P03 | JPEG input quality | 95/85/70/60 with output fixed | Encode/upload time and input influence |
| P04 | Queue limits | pending per worker 1/2/3, bounded newest-frame variant if needed | Throughput versus frame age |
| P05 | Buffer limits | inbound/outbound byte budget versus frame-size-aware budget | Congestion, dropped frames, p95 age |
| P06 | Unordered frame delivery | reliable controls; reliable versus limited-retransmission frames | Lossy-path FPS/staleness, reconnect correctness |
| P07 | Capture/decode scheduling | admission before canvas copy; post-encode recheck; stale decode rejection | Browser work and displayed FPS |
| G01 | Timing synchronization | current stage sync versus sampled CUDA event profiling | Profiling overhead with valid timing |
| G02 | Per-frame constant reuse | cached fixed-seed noise, sigma schedules, VAE normalization | Exactness and CPU/GPU wall time |
| G03 | Inference context | current no-grad versus inference_mode where compatible | Correctness, graph compatibility, FPS |
| G04 | Quantization controls | transformer FP8 baseline; VAE FP8 on/off; existing PerTensor baseline | Quality/performance on current GPU |
| G05 | Compile modes | reduce-overhead versus default; other modes only if new upstream support resolves old failures | Warm/cold time, memory, FPS |
| G06 | Attention / graph breaks | profile first; new compatible kernels only after checking upstream change | Avoid repeating known bad ports |
| G07 | Dependency/CUDA refresh | isolated environment, pinned old versus current supported stack | Speed, compatibility, exact versions |
| G08 | Prompt switching | cold/warm LRU, repeated presets, rapid state changes | Stalls and stability |
| S01 | Multi-GPU scaling | 1 versus 2 workers, identical shape/steps | Actual aggregate FPS and per-frame delay |
| V01 | StreamDiffusionV2 1.3B | official Wan2.1 causal v2v checkpoint, same GPU and waveform clip | Generation/display FPS, chunk latency, continuity |
| V02 | StreamDiffusionV2 options | default decoder versus TAEHV, 1–4 steps where supported | Speed/quality; compare native supported resolutions honestly |
| V03 | StreamDiffusionV2 14B | only if 1.3B is operational and hardware/memory permit | Quality frontier; no model swap in production |
| C01 | Combine independent winners | telemetry + compression + queue + winning compute options | Repeated A/B versus frozen baseline |
| C02 | Final soak and regression | 10 min, presets, telemetry, reconnect, shape changes | No hangs, bounded age, stable useful FPS |
| R00 | Independent review | inspect raw artifacts, commands, arithmetic, scope, outstanding gaps | Correct claims and reproducible report |

Statuses and evidence belong in RESULTS.md; leave unrun rows explicitly pending.
Do not turn speculative expected gains into measurements. An experiment may be
closed as unsuitable only with a concrete compatibility, quality, or scope reason.

## Current upstream references

- CLI and log API: https://github.com/runpod/runpodctl
- Official skills: https://github.com/runpod/runpod-plugins-official
- StreamDiffusionV2: https://github.com/chenfengxu714/StreamDiffusionV2
- Video checkpoint: https://huggingface.co/jerryfeng/StreamDiffusionV2
- Base video model: https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B

The video pipeline uses distilled causal Wan2.1 video models (1.3B and 14B), not
FLUX.2. Initial Blackwell support was added 2026-05-17. Published headline FPS on
four H100s is not a forecast for this project's machine or latency.
