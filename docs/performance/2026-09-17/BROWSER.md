# Browser transport measurements — 2026-09-17

This table preserves each trial separately. It does not pool different batches, native WebRTC libraries, stacks, settings or models. The [CSV](browser-results.csv) includes exact rates, p50/p95/p99 frame age, queue time where instrumented, bandwidth, drop counters, source hashes and full configurations. Raw JSON and each batch's jobs/run identity retain the remaining evidence.

Received FPS counts generated JPEG responses. Drawn FPS counts successful browser offscreen 2D draws; it excludes the application upscaler/projector, audio capture, physical display and compositor presentation. Frame age uses the client clock and starts before drawing the synthetic input fixture and encoding its JPEG. Untagged streaming runs have unknown frame age. Same-host and actual-app measurements are separate. Percentiles summarize observed frames, not all submitted/dropped inputs.

One earlier WebRTC-upgrade trial overlapped a local build and is explicitly excluded, with its replacement identified in [measurement-exclusions.json](measurement-exclusions.json). The interrupted pre-watchdog-fix scaling batch retains seven complete trials and its warmup failure; later corrected-service repetitions form a separate batch. Real network latency spikes are retained.

`Input/Output Mbps` are client upload/download. A dash means unmeasured or unavailable. Trials failing before measurement have no throughput number. Quantified continuity failures retain their rates and are marked separately; they remain ineligible for acceptance. Hash-bound assessments preserve the original raw status/errors. The p95 and p99 values are capture-to-offscreen-draw ages, unless the raw record explicitly describes its single-flight measurement.

## Initial and recovery baselines

| Trial | Status | Received FPS | Drawn FPS | Age p95 ms | Age p99 ms | Queue p95 ms | Input / output Mbps |
|---|---|---:|---:|---:|---:|---:|---:|
| [baseline-webrtc-512x288-2step-single-telemetry-off](baseline-webrtc-512x288-2step-single-telemetry-off.json) | measured | 6.17 | 6.17 | 200.88 | 298.48 | — | 0.49 / 2.05 |
| [baseline-webrtc-512x288-2step-stream-telemetry-off](baseline-webrtc-512x288-2step-stream-telemetry-off.json) | measured | 27.43 | 24.43 | — | — | — | 4.94 / 9.13 |
| [baseline-webrtc-512x288-2step-stream-telemetry-on](baseline-webrtc-512x288-2step-stream-telemetry-on.json) | measured | 25.60 | 22.70 | — | — | — | 4.94 / 8.53 |
| [recovered-webrtc-512x288-2step-telemetry-0-repeat0](recovered-webrtc-512x288-2step-telemetry-0-repeat0.json) | measured | 27.93 | 25.63 | — | — | — | 4.92 / 9.30 |
| [recovered-webrtc-512x288-2step-telemetry-0-repeat1](recovered-webrtc-512x288-2step-telemetry-0-repeat1.json) | measured | 28.40 | 26.63 | — | — | — | 4.94 / 9.46 |
| [recovered-webrtc-512x288-2step-telemetry-2000-repeat0](recovered-webrtc-512x288-2step-telemetry-2000-repeat0.json) | measured | 28.00 | 25.30 | — | — | — | 4.80 / 9.32 |
| [recovered-webrtc-512x288-2step-telemetry-2000-repeat1](recovered-webrtc-512x288-2step-telemetry-2000-repeat1.json) | measured | 28.11 | 26.61 | — | — | — | 4.93 / 9.36 |

## browser-discovery

| Trial | Status | Received FPS | Drawn FPS | Age p95 ms | Age p99 ms | Queue p95 ms | Input / output Mbps |
|---|---|---:|---:|---:|---:|---:|---:|
| [async-telemetry-r0](browser-discovery/async-telemetry-r0.json) | measured | 26.79 | 23.83 | 320.53 | 1173.85 | — | 4.87 / 8.92 |
| [async-telemetry-r1](browser-discovery/async-telemetry-r1.json) | measured | 26.03 | 22.56 | 806.52 | 903.04 | — | 4.87 / 8.67 |
| [async-telemetry-r2](browser-discovery/async-telemetry-r2.json) | measured | 27.90 | 24.73 | 213.69 | 236.86 | — | 4.78 / 9.29 |
| [ids-single-raw-r0](browser-discovery/ids-single-raw-r0.json) | measured | 6.50 | 6.50 | 158.09 | 164.91 | — | 0.52 / 2.16 |
| [ids-single-raw-r1](browser-discovery/ids-single-raw-r1.json) | measured | 6.13 | 6.13 | 170.17 | 183.60 | — | 0.49 / 2.04 |
| [ids-single-raw-r2](browser-discovery/ids-single-raw-r2.json) | measured | 6.20 | 6.20 | 167.13 | 175.44 | — | 0.49 / 2.06 |
| [ids-single-tagged-r0](browser-discovery/ids-single-tagged-r0.json) | measured | 6.23 | 6.23 | 163.33 | 166.84 | — | 0.50 / 2.07 |
| [ids-single-tagged-r1](browser-discovery/ids-single-tagged-r1.json) | measured | 6.17 | 6.17 | 169.96 | 201.18 | — | 0.49 / 2.05 |
| [ids-single-tagged-r2](browser-discovery/ids-single-tagged-r2.json) | measured | 6.53 | 6.53 | 154.33 | 159.14 | — | 0.52 / 2.17 |
| [ids-stream-raw-r0](browser-discovery/ids-stream-raw-r0.json) | measured | 27.86 | 25.46 | — | — | — | 4.95 / 9.27 |
| [ids-stream-raw-r1](browser-discovery/ids-stream-raw-r1.json) | measured | 26.53 | 23.56 | — | — | — | 4.93 / 8.84 |
| [ids-stream-raw-r2](browser-discovery/ids-stream-raw-r2.json) | measured | 24.73 | 21.76 | — | — | — | 4.92 / 8.24 |
| [ids-stream-tagged-r0](browser-discovery/ids-stream-tagged-r0.json) | measured | 26.60 | 24.13 | 883.79 | 1309.08 | — | 4.94 / 8.86 |
| [ids-stream-tagged-r1](browser-discovery/ids-stream-tagged-r1.json) | measured | 25.23 | 22.26 | 793.05 | 1224.60 | — | 4.95 / 8.40 |
| [ids-stream-tagged-r2](browser-discovery/ids-stream-tagged-r2.json) | measured | 20.23 | 17.93 | 259.93 | 393.83 | — | 4.00 / 6.74 |
| [input-buffer-16384](browser-discovery/input-buffer-16384.json) | measured | 26.90 | 23.50 | 222.88 | 261.66 | — | 4.79 / 8.96 |
| [input-buffer-65536](browser-discovery/input-buffer-65536.json) | measured | 27.10 | 23.93 | 218.91 | 252.38 | — | 4.92 / 9.02 |
| [input-jpeg-60](browser-discovery/input-jpeg-60.json) | measured | 28.00 | 25.06 | 203.01 | 316.79 | — | 3.52 / 9.52 |
| [input-jpeg-70](browser-discovery/input-jpeg-70.json) | measured | 25.83 | 23.03 | 243.85 | 318.60 | — | 3.90 / 8.55 |
| [input-jpeg-95](browser-discovery/input-jpeg-95.json) | measured | 26.73 | 23.63 | 318.98 | 592.91 | — | 6.49 / 9.08 |
| [output-jpeg-50](browser-discovery/output-jpeg-50.json) | measured | 26.20 | 25.13 | 991.76 | 1366.31 | — | 4.27 / 5.30 |
| [output-jpeg-60](browser-discovery/output-jpeg-60.json) | measured | 28.10 | 26.40 | 208.36 | 235.06 | — | 4.92 / 6.42 |
| [output-jpeg-70](browser-discovery/output-jpeg-70.json) | measured | 25.26 | 24.73 | 505.12 | 717.02 | — | 4.94 / 6.78 |
| [output-jpeg-85](browser-discovery/output-jpeg-85.json) | measured | 25.83 | 24.27 | 668.78 | 953.36 | — | 4.94 / 10.01 |
| [output-jpeg-95](browser-discovery/output-jpeg-95.json) | measured | 25.16 | 24.26 | 391.45 | 502.28 | — | 4.94 / 17.05 |
| [resolution-1024x576](browser-discovery/resolution-1024x576.json) | measured | 8.10 | 8.10 | 487.77 | 503.33 | — | 11.11 / 1.54 |
| [resolution-768x448](browser-discovery/resolution-768x448.json) | measured | 14.03 | 14.03 | 323.50 | 381.36 | — | 8.00 / 3.83 |
| [send-fps-120](browser-discovery/send-fps-120.json) | measured | 25.79 | 22.83 | 241.18 | 262.96 | — | 7.87 / 8.59 |
| [send-fps-30](browser-discovery/send-fps-30.json) | measured | 27.93 | 25.66 | 200.03 | 222.35 | — | 2.41 / 9.30 |
| [unordered-reliable](browser-discovery/unordered-reliable.json) | measured | 23.37 | 21.10 | 1121.26 | 3662.21 | — | 4.37 / 7.78 |

## browser-entropy

| Trial | Status | Received FPS | Drawn FPS | Age p95 ms | Age p99 ms | Queue p95 ms | Input / output Mbps |
|---|---|---:|---:|---:|---:|---:|---:|
| [high-entropy-default](browser-entropy/high-entropy-default.json) | measured | 25.33 | 24.73 | 248.68 | 268.54 | — | 49.07 / 12.46 |
| [high-entropy-input16k](browser-entropy/high-entropy-input16k.json) | measured | 21.70 | 21.30 | 222.53 | 252.11 | — | 21.33 / 10.67 |
| [high-entropy-input60](browser-entropy/high-entropy-input60.json) | measured | 24.43 | 23.90 | 508.08 | 641.12 | — | 28.69 / 12.06 |

## browser-frame-buffer

| Trial | Status | Received FPS | Drawn FPS | Age p95 ms | Age p99 ms | Queue p95 ms | Input / output Mbps |
|---|---|---:|---:|---:|---:|---:|---:|
| [buffer-1024x576-frames0](browser-frame-buffer/buffer-1024x576-frames0.json) | measured | 8.20 | 8.03 | 966.40 | 1235.24 | 240.42 | 10.63 / 1.58 |
| [buffer-1024x576-frames1](browser-frame-buffer/buffer-1024x576-frames1.json) | measured | 7.87 | 7.80 | 1344.80 | 2079.94 | 239.91 | 10.26 / 1.51 |
| [buffer-1024x576-frames2](browser-frame-buffer/buffer-1024x576-frames2.json) | measured; continuity failed | 6.60 | 6.57 | 2256.90 | 5343.27 | 240.80 | 7.03 / 1.28 |
| [buffer-512x288-frames0](browser-frame-buffer/buffer-512x288-frames0.json) | measured | 28.53 | 28.36 | 184.20 | 189.40 | 69.00 | 4.94 / 9.50 |
| [buffer-512x288-frames1](browser-frame-buffer/buffer-512x288-frames1.json) | measured | 27.20 | 27.03 | 1948.05 | 3031.85 | 68.80 | 4.94 / 9.07 |
| [buffer-512x288-frames2](browser-frame-buffer/buffer-512x288-frames2.json) | measured | 28.16 | 27.86 | 263.90 | 479.65 | 68.69 | 4.91 / 9.38 |
| [buffer-768x448-frames0](browser-frame-buffer/buffer-768x448-frames0.json) | measured | 14.10 | 14.07 | 299.78 | 412.43 | 139.92 | 8.58 / 3.83 |
| [buffer-768x448-frames1](browser-frame-buffer/buffer-768x448-frames1.json) | measured | 13.93 | 13.93 | 311.94 | 344.85 | 141.56 | 8.58 / 3.81 |
| [buffer-768x448-frames2](browser-frame-buffer/buffer-768x448-frames2.json) | measured | 13.90 | 13.40 | 792.00 | 1014.31 | 141.24 | 8.54 / 3.79 |
| [buffer-entropy-frames0](browser-frame-buffer/buffer-entropy-frames0.json) | measured; continuity failed | 5.20 | 5.20 | 3247.90 | 6186.31 | 14.31 | 4.54 / 2.56 |
| [buffer-entropy-frames1](browser-frame-buffer/buffer-entropy-frames1.json) | measured | 24.20 | 23.66 | 324.51 | 554.88 | 69.00 | 37.53 / 11.90 |
| [buffer-entropy-frames2](browser-frame-buffer/buffer-entropy-frames2.json) | measured | 22.66 | 21.86 | 2244.55 | 2498.09 | 68.95 | 49.30 / 11.15 |

## browser-live-compute

| Trial | Status | Received FPS | Drawn FPS | Age p95 ms | Age p99 ms | Queue p95 ms | Input / output Mbps |
|---|---|---:|---:|---:|---:|---:|---:|
| [compute-1024x576-all-constants-r0](browser-live-compute/compute-1024x576-all-constants-r0.json) | measured | 8.20 | 8.15 | 568.04 | 698.34 | — | 12.47 / 1.59 |
| [compute-1024x576-all-constants-r1](browser-live-compute/compute-1024x576-all-constants-r1.json) | measured | 8.23 | 8.18 | 525.55 | 671.14 | — | 12.59 / 1.59 |
| [compute-1024x576-all-constants-r2](browser-live-compute/compute-1024x576-all-constants-r2.json) | measured | 7.97 | 7.80 | 1544.16 | 1971.78 | — | 10.40 / 1.52 |
| [compute-1024x576-baseline-r0](browser-live-compute/compute-1024x576-baseline-r0.json) | measured | 7.95 | 7.88 | 508.50 | 2320.50 | — | 11.83 / 1.54 |
| [compute-1024x576-baseline-r1](browser-live-compute/compute-1024x576-baseline-r1.json) | measured | 8.15 | 8.15 | 459.56 | 479.00 | — | 12.52 / 1.56 |
| [compute-1024x576-baseline-r2](browser-live-compute/compute-1024x576-baseline-r2.json) | measured | 8.12 | 8.00 | 591.47 | 1161.88 | — | 12.44 / 1.56 |
| [compute-1024x576-combined-r0](browser-live-compute/compute-1024x576-combined-r0.json) | measured | 8.23 | 8.23 | 445.01 | 456.83 | — | 12.56 / 1.58 |
| [compute-1024x576-combined-r1](browser-live-compute/compute-1024x576-combined-r1.json) | measured | 8.12 | 8.08 | 1012.02 | 1468.36 | — | 11.23 / 1.57 |
| [compute-1024x576-combined-r2](browser-live-compute/compute-1024x576-combined-r2.json) | measured | 8.27 | 8.27 | 448.15 | 457.42 | — | 12.56 / 1.60 |
| [compute-1024x576-events-r0](browser-live-compute/compute-1024x576-events-r0.json) | measured | 6.27 | 6.20 | 2963.34 | 5356.08 | — | 5.31 / 1.21 |
| [compute-1024x576-events-r1](browser-live-compute/compute-1024x576-events-r1.json) | measured | 8.23 | 8.20 | 597.77 | 866.96 | — | 12.31 / 1.58 |
| [compute-1024x576-events-r2](browser-live-compute/compute-1024x576-events-r2.json) | measured | 8.25 | 8.23 | 458.42 | 702.06 | — | 12.59 / 1.58 |
| [compute-512x288-all-constants-r0](browser-live-compute/compute-512x288-all-constants-r0.json) | measured | 28.21 | 28.08 | 189.78 | 231.22 | — | 4.92 / 9.40 |
| [compute-512x288-all-constants-r1](browser-live-compute/compute-512x288-all-constants-r1.json) | measured | 28.55 | 28.13 | 192.36 | 224.38 | — | 4.85 / 9.50 |
| [compute-512x288-all-constants-r2](browser-live-compute/compute-512x288-all-constants-r2.json) | measured | 28.08 | 27.90 | 214.51 | 477.72 | — | 4.87 / 9.35 |
| [compute-512x288-baseline-r0](browser-live-compute/compute-512x288-baseline-r0.json) | measured | 27.73 | 27.46 | 193.70 | 212.70 | — | 4.89 / 9.23 |
| [compute-512x288-baseline-r1](browser-live-compute/compute-512x288-baseline-r1.json) | measured | 27.93 | 27.75 | 188.40 | 220.28 | — | 4.91 / 9.30 |
| [compute-512x288-baseline-r2](browser-live-compute/compute-512x288-baseline-r2.json) | measured | 26.20 | 25.91 | 221.23 | 431.58 | — | 4.81 / 8.72 |
| [compute-512x288-combined-r0](browser-live-compute/compute-512x288-combined-r0.json) | measured | 29.08 | 28.90 | 182.00 | 201.33 | — | 4.93 / 9.69 |
| [compute-512x288-combined-r1](browser-live-compute/compute-512x288-combined-r1.json) | measured | 28.00 | 27.78 | 198.74 | 220.91 | — | 4.92 / 9.32 |
| [compute-512x288-combined-r2](browser-live-compute/compute-512x288-combined-r2.json) | measured | 28.24 | 27.89 | 202.21 | 239.98 | — | 4.81 / 9.40 |
| [compute-512x288-events-r0](browser-live-compute/compute-512x288-events-r0.json) | measured | 29.17 | 28.98 | 179.20 | 202.87 | — | 4.91 / 9.71 |
| [compute-512x288-events-r1](browser-live-compute/compute-512x288-events-r1.json) | measured | 28.97 | 28.62 | 184.30 | 210.75 | — | 4.90 / 9.65 |
| [compute-512x288-events-r2](browser-live-compute/compute-512x288-events-r2.json) | measured | 24.88 | 23.65 | 1039.52 | 1965.66 | — | 4.33 / 8.28 |
| [compute-768x448-all-constants-r0](browser-live-compute/compute-768x448-all-constants-r0.json) | measured | 14.15 | 14.15 | 313.20 | 327.52 | — | 8.43 / 3.85 |
| [compute-768x448-all-constants-r1](browser-live-compute/compute-768x448-all-constants-r1.json) | measured | 14.17 | 14.17 | 317.40 | 328.20 | — | 7.68 / 3.86 |
| [compute-768x448-all-constants-r2](browser-live-compute/compute-768x448-all-constants-r2.json) | measured | 14.07 | 14.07 | 314.77 | 332.04 | — | 8.18 / 3.83 |
| [compute-768x448-baseline-r0](browser-live-compute/compute-768x448-baseline-r0.json) | measured | 13.83 | 13.83 | 321.30 | 331.11 | — | 7.92 / 3.77 |
| [compute-768x448-baseline-r1](browser-live-compute/compute-768x448-baseline-r1.json) | measured | 13.82 | 13.82 | 318.46 | 333.76 | — | 8.29 / 3.77 |
| [compute-768x448-baseline-r2](browser-live-compute/compute-768x448-baseline-r2.json) | measured | 13.71 | 13.71 | 326.79 | 347.56 | — | 7.66 / 3.74 |
| [compute-768x448-combined-r0](browser-live-compute/compute-768x448-combined-r0.json) | measured | 14.08 | 14.08 | 306.46 | 317.06 | — | 8.51 / 3.85 |
| [compute-768x448-combined-r1](browser-live-compute/compute-768x448-combined-r1.json) | measured | 14.22 | 14.22 | 312.90 | 322.10 | — | 7.75 / 3.88 |
| [compute-768x448-combined-r2](browser-live-compute/compute-768x448-combined-r2.json) | measured | 13.95 | 13.93 | 324.47 | 347.87 | — | 8.01 / 3.80 |
| [compute-768x448-events-r0](browser-live-compute/compute-768x448-events-r0.json) | measured | 14.18 | 14.18 | 311.40 | 328.05 | — | 8.49 / 3.87 |
| [compute-768x448-events-r1](browser-live-compute/compute-768x448-events-r1.json) | measured | 14.20 | 14.20 | 304.93 | 315.55 | — | 8.44 / 3.87 |
| [compute-768x448-events-r2](browser-live-compute/compute-768x448-events-r2.json) | measured | 14.13 | 14.13 | 316.17 | 330.27 | — | 7.86 / 3.85 |

## browser-responsive

| Trial | Status | Received FPS | Drawn FPS | Age p95 ms | Age p99 ms | Queue p95 ms | Input / output Mbps |
|---|---|---:|---:|---:|---:|---:|---:|
| [combination-1024x576-responsive-events-jpeg60](browser-responsive/combination-1024x576-responsive-events-jpeg60.json) | measured | 8.23 | 8.23 | 329.31 | 354.65 | — | 12.64 / 1.19 |
| [combination-1024x576-responsive-events-jpeg80](browser-responsive/combination-1024x576-responsive-events-jpeg80.json) | measured | 8.20 | 8.20 | 331.08 | 352.10 | — | 12.58 / 1.58 |
| [combination-512x288-baseline-r0](browser-responsive/combination-512x288-baseline-r0.json) | measured | 25.45 | 25.17 | 229.40 | 316.24 | — | 4.94 / 8.48 |
| [combination-512x288-baseline-r1](browser-responsive/combination-512x288-baseline-r1.json) | measured | 25.53 | 25.02 | 916.70 | 1675.30 | — | 4.89 / 8.50 |
| [combination-512x288-baseline-r2](browser-responsive/combination-512x288-baseline-r2.json) | measured | 25.65 | 25.57 | 214.80 | 249.53 | — | 4.92 / 8.54 |
| [combination-512x288-responsive-events-jpeg60-r0](browser-responsive/combination-512x288-responsive-events-jpeg60-r0.json) | measured | 27.23 | 26.67 | 166.91 | 534.31 | — | 4.95 / 6.22 |
| [combination-512x288-responsive-events-jpeg60-r1](browser-responsive/combination-512x288-responsive-events-jpeg60-r1.json) | measured | 26.53 | 26.13 | 156.50 | 194.66 | — | 4.94 / 6.06 |
| [combination-512x288-responsive-events-jpeg60-r2](browser-responsive/combination-512x288-responsive-events-jpeg60-r2.json) | measured | 28.15 | 27.78 | 142.18 | 177.00 | — | 4.93 / 6.43 |
| [combination-512x288-responsive-events-r0](browser-responsive/combination-512x288-responsive-events-r0.json) | measured | 27.30 | 26.65 | 200.35 | 769.70 | — | 4.94 / 9.09 |
| [combination-512x288-responsive-events-r1](browser-responsive/combination-512x288-responsive-events-r1.json) | measured | 27.63 | 27.53 | 163.21 | 196.25 | — | 4.93 / 9.20 |
| [combination-512x288-responsive-events-r2](browser-responsive/combination-512x288-responsive-events-r2.json) | measured | 25.83 | 25.48 | 198.96 | 1063.61 | — | 4.93 / 8.60 |
| [combination-768x448-responsive-events-jpeg60](browser-responsive/combination-768x448-responsive-events-jpeg60.json) | measured | 14.27 | 14.27 | 215.42 | 231.71 | — | 8.57 / 2.67 |
| [combination-768x448-responsive-events-jpeg80](browser-responsive/combination-768x448-responsive-events-jpeg80.json) | measured | 14.37 | 14.37 | 231.90 | 237.57 | — | 8.60 / 3.92 |

## browser-scaling-before-idle-fix

| Trial | Status | Received FPS | Drawn FPS | Age p95 ms | Age p99 ms | Queue p95 ms | Input / output Mbps |
|---|---|---:|---:|---:|---:|---:|---:|
| [scaling-512x288-active1-r0](browser-scaling-before-idle-fix/scaling-512x288-active1-r0.json) | measured | 23.53 | 23.00 | 1958.08 | 2917.85 | 67.86 | 3.64 / 7.84 |
| [scaling-512x288-active1-r1](browser-scaling-before-idle-fix/scaling-512x288-active1-r1.json) | measured | 29.01 | 28.86 | 180.70 | 186.35 | 67.98 | 4.95 / 9.66 |
| [scaling-512x288-active1-r2](browser-scaling-before-idle-fix/scaling-512x288-active1-r2.json) | measured | 28.66 | 28.26 | 264.38 | 506.61 | 68.14 | 4.88 / 9.54 |
| [scaling-512x288-active2-r0](browser-scaling-before-idle-fix/scaling-512x288-active2-r0.json) | measured | 55.58 | 52.21 | 171.40 | 245.09 | 72.23 | 4.94 / 18.51 |
| [scaling-512x288-active2-r1](browser-scaling-before-idle-fix/scaling-512x288-active2-r1.json) | measured | 55.08 | 51.60 | 182.63 | 270.51 | 69.66 | 4.85 / 18.34 |
| [scaling-512x288-active2-r2](browser-scaling-before-idle-fix/scaling-512x288-active2-r2.json) | measured | 55.68 | 53.15 | 175.16 | 243.25 | 72.04 | 4.94 / 18.54 |
| [scaling-768x448-active1-r0](browser-scaling-before-idle-fix/scaling-768x448-active1-r0.json) | measured | 13.80 | 13.80 | 312.07 | 317.04 | 143.86 | 8.60 / 3.76 |
| [scaling-768x448-active2-r0](browser-scaling-before-idle-fix/scaling-768x448-active2-r0.json) | failed | — | — | — | — | — | — / — |

## browser-scaling-idle-fixed

| Trial | Status | Received FPS | Drawn FPS | Age p95 ms | Age p99 ms | Queue p95 ms | Input / output Mbps |
|---|---|---:|---:|---:|---:|---:|---:|
| [scaling-1024x576-active1-r0](browser-scaling-idle-fixed/scaling-1024x576-active1-r0.json) | measured | 8.20 | 8.13 | 524.98 | 694.30 | 243.67 | 12.56 / 1.58 |
| [scaling-1024x576-active1-r1](browser-scaling-idle-fixed/scaling-1024x576-active1-r1.json) | measured | 8.15 | 8.15 | 459.36 | 491.08 | 246.21 | 12.60 / 1.56 |
| [scaling-1024x576-active1-r2](browser-scaling-idle-fixed/scaling-1024x576-active1-r2.json) | measured | 8.20 | 8.20 | 458.74 | 486.68 | 242.99 | 12.54 / 1.57 |
| [scaling-1024x576-active2-r0](browser-scaling-idle-fixed/scaling-1024x576-active2-r0.json) | measured | 16.38 | 15.63 | 441.00 | 475.09 | 242.55 | 12.56 / 3.13 |
| [scaling-1024x576-active2-r1](browser-scaling-idle-fixed/scaling-1024x576-active2-r1.json) | measured | 16.35 | 15.42 | 450.26 | 985.48 | 243.77 | 12.50 / 3.17 |
| [scaling-1024x576-active2-r2](browser-scaling-idle-fixed/scaling-1024x576-active2-r2.json) | measured | 16.43 | 15.35 | 450.50 | 646.14 | 242.53 | 12.50 / 3.16 |
| [scaling-512x288-active1-r0](browser-scaling-idle-fixed/scaling-512x288-active1-r0.json) | measured | 28.05 | 27.61 | 550.56 | 899.08 | 68.75 | 4.67 / 9.34 |
| [scaling-512x288-active1-r1](browser-scaling-idle-fixed/scaling-512x288-active1-r1.json) | measured | 28.86 | 28.73 | 176.79 | 184.35 | 68.38 | 4.94 / 9.61 |
| [scaling-512x288-active1-r2](browser-scaling-idle-fixed/scaling-512x288-active1-r2.json) | measured | 29.00 | 28.88 | 172.08 | 182.00 | 67.99 | 4.93 / 9.66 |
| [scaling-512x288-active2-r0](browser-scaling-idle-fixed/scaling-512x288-active2-r0.json) | measured | 55.80 | 53.10 | 164.20 | 227.24 | 71.10 | 4.92 / 18.58 |
| [scaling-512x288-active2-r1](browser-scaling-idle-fixed/scaling-512x288-active2-r1.json) | measured | 56.26 | 51.63 | 170.21 | 246.72 | 70.39 | 4.94 / 18.73 |
| [scaling-512x288-active2-r2](browser-scaling-idle-fixed/scaling-512x288-active2-r2.json) | measured | 53.30 | 48.98 | 453.71 | 620.55 | 68.60 | 4.68 / 17.75 |
| [scaling-768x448-active1-r0](browser-scaling-idle-fixed/scaling-768x448-active1-r0.json) | invalid; measured data, continuity failed (audited) | 13.92 | 13.83 | 1614.52 | 3359.42 | 142.29 | 8.30 / 3.80 |
| [scaling-768x448-active1-r1](browser-scaling-idle-fixed/scaling-768x448-active1-r1.json) | measured | 13.73 | 13.53 | 430.63 | 848.52 | 143.12 | 8.36 / 3.74 |
| [scaling-768x448-active1-r2](browser-scaling-idle-fixed/scaling-768x448-active1-r2.json) | measured | 13.87 | 13.82 | 309.80 | 804.37 | 142.64 | 8.55 / 3.78 |
| [scaling-768x448-active2-r0](browser-scaling-idle-fixed/scaling-768x448-active2-r0.json) | measured | 22.42 | 21.90 | 1229.08 | 2849.97 | 144.61 | 6.11 / 6.10 |
| [scaling-768x448-active2-r1](browser-scaling-idle-fixed/scaling-768x448-active2-r1.json) | measured | 27.56 | 26.81 | 310.00 | 473.97 | 144.10 | 8.49 / 7.51 |
| [scaling-768x448-active2-r2](browser-scaling-idle-fixed/scaling-768x448-active2-r2.json) | measured | 27.61 | 26.37 | 721.45 | 1901.75 | 143.68 | 8.53 / 7.52 |

## browser-wrtc010

| Trial | Status | Received FPS | Drawn FPS | Age p95 ms | Age p99 ms | Queue p95 ms | Input / output Mbps |
|---|---|---:|---:|---:|---:|---:|---:|
| [combined-1024x576](browser-wrtc010/combined-1024x576.json) | measured | 8.18 | 8.18 | 350.15 | 357.04 | — | 3.37 / 1.20 |
| [combined-768x448](browser-wrtc010/combined-768x448.json) | measured | 13.83 | 13.83 | 234.71 | 245.60 | — | 2.91 / 2.59 |
| [confirm-baseline-r0](browser-wrtc010/confirm-baseline-r0.json) | measured | 27.22 | 26.57 | 307.98 | 518.90 | — | 4.94 / 9.06 |
| [confirm-baseline-r1](browser-wrtc010/confirm-baseline-r1.json) | measured | 26.65 | 26.50 | 202.56 | 232.31 | — | 4.93 / 8.88 |
| [confirm-baseline-r2](browser-wrtc010/confirm-baseline-r2.json) | measured | 24.68 | 24.15 | 997.22 | 2306.16 | — | 4.26 / 8.22 |
| [confirm-combination-r0](browser-wrtc010/confirm-combination-r0.json) | measured | 25.20 | 24.73 | 164.25 | 354.27 | — | 2.33 / 5.76 |
| [confirm-combination-r1](browser-wrtc010/confirm-combination-r1.json) | measured | 23.67 | 23.13 | 257.20 | 417.42 | — | 2.11 / 5.41 |
| [confirm-combination-r2](browser-wrtc010/confirm-combination-r2.json) | measured | 26.15 | 25.75 | 162.66 | 253.19 | — | 2.35 / 5.98 |
| [confirm-jpeg60-r0](browser-wrtc010/confirm-jpeg60-r0.json) | measured | 27.06 | 26.65 | 201.31 | 229.01 | — | 4.92 / 6.18 |
| [confirm-jpeg60-r1](browser-wrtc010/confirm-jpeg60-r1.json) | measured | 27.31 | 26.80 | 531.04 | 1010.12 | — | 4.64 / 6.24 |
| [confirm-jpeg60-r2](browser-wrtc010/confirm-jpeg60-r2.json) | measured | 27.55 | 26.97 | 197.53 | 227.11 | — | 4.82 / 6.29 |
| [outbound-128k](browser-wrtc010/outbound-128k.json) | measured | 27.56 | 27.30 | 196.43 | 229.13 | — | 4.89 / 9.18 |
| [outbound-16k](browser-wrtc010/outbound-16k.json) | measured | 28.02 | 27.89 | 664.82 | 791.64 | — | 4.91 / 9.33 |
| [outbound-32k](browser-wrtc010/outbound-32k.json) | measured | 27.72 | 27.36 | 196.70 | 226.62 | — | 4.91 / 9.24 |
| [outbound-64k](browser-wrtc010/outbound-64k.json) | measured | 27.63 | 27.43 | 197.50 | 218.68 | — | 4.89 / 9.21 |
| [pending-1](browser-wrtc010/pending-1.json) | measured | 20.70 | 20.53 | 141.32 | 161.08 | — | 4.78 / 6.89 |
| [pending-2](browser-wrtc010/pending-2.json) | measured | 27.10 | 26.46 | 166.27 | 196.71 | — | 4.81 / 9.02 |
| [pending-3](browser-wrtc010/pending-3.json) | measured | 27.86 | 27.63 | 188.10 | 214.23 | — | 4.91 / 9.28 |
| [replacement-wrtc010-stream-build-free-repeat](browser-wrtc010/replacement-wrtc010-stream-build-free-repeat.json) | measured | 26.96 | 26.90 | 199.04 | 231.01 | — | 4.94 / 8.98 |
| [wrtc010-single-r0](browser-wrtc010/wrtc010-single-r0.json) | measured | 7.03 | 7.03 | 149.55 | 166.11 | — | 0.56 / 2.34 |
| [wrtc010-single-r1](browser-wrtc010/wrtc010-single-r1.json) | measured | 6.47 | 6.47 | 161.64 | 652.65 | — | 0.52 / 2.15 |
| [wrtc010-single-r2](browser-wrtc010/wrtc010-single-r2.json) | measured | 5.60 | 5.60 | 295.69 | 380.32 | — | 0.45 / 1.87 |
| [wrtc010-stream-r0](browser-wrtc010/wrtc010-stream-r0.json) | measured | 26.80 | 26.53 | 206.07 | 237.84 | — | 4.92 / 8.93 |
| [wrtc010-stream-r1](browser-wrtc010/wrtc010-stream-r1.json) | excluded | 27.86 | 27.56 | 194.69 | 230.23 | — | 4.89 / 9.28 |
| [wrtc010-stream-r2](browser-wrtc010/wrtc010-stream-r2.json) | measured | 27.26 | 26.60 | 278.20 | 379.14 | — | 4.81 / 9.07 |

