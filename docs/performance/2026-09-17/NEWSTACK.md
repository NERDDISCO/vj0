# Newer-stack live confirmation — 2026-09-17

All 27 one-minute trials completed with valid measurements and passed their client-observed continuity guards. Large latency/throughput variation remains visible in some two-GPU trials. These are synthetic-input WAN WebRTC/offscreen-draw results; the actual app/projector soak is reported separately in [RESULTS.md](RESULTS.md).

The same two-GPU PRO 6000 host, worker/dispatcher source, FP8 models, two steps, alpha 0.1, seed 42, input JPEG 85, output JPEG 80, pending limit 3 and one-MiB outbound admission threshold are used throughout. One/two GPU means one/two active workers on this allocated two-GPU host; both models remain loaded. The library is @roamhq/wrtc 0.10.0. The compute environment changes to Torch 2.13.0+cu132 / TorchAO 0.18.0+cu132 / torchvision 0.28.0+cu132, retaining pinned Diffusers and other recorded dependencies. [Runtime/source proof](torch213-live-identity.json), [native library proof](torch213-native-transport-identity.json), [jobs and raw trials](browser-torch213/).

`combined` caches fixed-seed noise and sigma schedules and uses CUDA events instead of intermediate stage synchronizations. This is an experimental worker profile; production dependency/default promotion is a separate decision. Within each resolution the order is baseline one worker, combined one worker, combined two workers, repeated three times. All raw counts, p50/p95/p99, bandwidth and counters are in [BROWSER.md](BROWSER.md) and its [CSV](browser-results.csv).

| Resolution | Profile / active GPUs | Received FPS, repeats 0/1/2 | Median received | Drawn FPS, repeats 0/1/2 | p95 age ms, repeats 0/1/2 | p99 age ms, repeats 0/1/2 |
|---|---|---|---:|---|---|---|
| 512×288 | baseline / 1 | 30.06 / 30.32 / 30.05 | 30.06 | 28.70 / 29.30 / 28.96 | 196.4 / 195.0 / 193.9 | 218.5 / 230.1 / 217.4 |
| 512×288 | combined / 1 | 31.71 / 31.46 / 31.52 | 31.52 | 30.85 / 30.41 / 30.65 | 184.9 / 188.0 / 185.4 | 210.5 / 204.7 / 231.3 |
| 512×288 | combined / 2 | 57.93 / 46.18 / 57.21 | 57.21 | 52.01 / 41.36 / 50.88 | 203.2 / 781.3 / 327.6 | 266.8 / 1876.4 / 436.6 |
| 768×448 | baseline / 1 | 15.55 / 15.58 / 15.60 | 15.58 | 15.33 / 15.45 / 15.60 | 391.9 / 379.5 / 276.6 | 646.9 / 695.1 / 282.1 |
| 768×448 | combined / 1 | 15.97 / 15.78 / 16.08 | 15.97 | 15.68 / 15.48 / 16.08 | 312.6 / 324.6 / 271.1 | 422.0 / 747.8 / 281.1 |
| 768×448 | combined / 2 | 31.48 / 31.61 / 27.45 | 31.48 | 29.61 / 30.13 / 26.31 | 289.5 / 288.3 / 606.8 | 313.3 / 313.3 / 2185.2 |
| 1024×576 | baseline / 1 | 8.75 / 8.90 / 8.88 | 8.88 | 8.75 / 8.90 / 8.83 | 613.1 / 427.4 / 895.4 | 2373.7 / 439.2 / 1298.4 |
| 1024×576 | combined / 1 | 9.03 / 9.02 / 9.07 | 9.03 | 9.03 / 9.02 / 9.07 | 424.6 / 421.9 / 413.0 | 437.2 / 430.5 / 425.0 |
| 1024×576 | combined / 2 | 18.11 / 17.95 / 18.08 | 18.08 | 17.63 / 17.43 / 17.20 | 409.0 / 443.6 / 409.3 | 424.4 / 630.0 / 425.6 |

## Within-stack combination effect

| Resolution | Baseline one-GPU median FPS | Combined one-GPU median FPS | Median ratio change | Paired p95 result |
|---|---:|---:|---:|---|
| 512×288 | 30.064 | 31.515 | +4.83% | Lower in 3/3 pairs |
| 768×448 | 15.582 | 15.965 | +2.46% | Lower in 3/3 pairs |
| 1024×576 | 8.883 | 9.032 | +1.69% | Lower in 3/3 pairs |

## Sequential old/new configuration comparison

This comparison uses the corrected-service old-stack scaling batch and the later new-stack combined batch. They ran sequentially on the same host; network/time variation and the joint Torch/CUDA/TorchAO/profile changes prevent assigning the whole ratio to one package. The old 768 one-GPU run with a 3.2165-second continuity failure remains included through its explicit assessment, and none of the slower new runs are removed.

| Resolution | Old baseline 1 GPU | New combined 1 GPU | Old baseline 2 GPUs | New combined 2 GPUs |
|---|---:|---:|---:|---:|
| 512×288 | 28.86 | 31.52 | 55.80 | 57.21 |
| 768×448 | 13.87 | 15.97 | 27.56 | 31.48 |
| 1024×576 | 8.20 | 9.03 | 16.38 | 18.08 |

The one-GPU combination improves throughput and p95 age in all nine within-stack pairs. P99 age worsens in two pairs; see the per-trial table and [independent audit](review-torch213-live.json). Two-GPU 512 and 768 runs contain substantial dips despite passing the two-second continuity guard; acceptable long-session behavior therefore requires the separate app soak. Higher resolution also changes the generated composition at fixed alpha, as described in the [sample review](new-compute-quality.json).
