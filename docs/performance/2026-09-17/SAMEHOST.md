# Same-pod WebRTC appendix — 2026-09-17

All 16 trials completed with measured status. On Pod A, preencoded 512×288 streaming at a requested 60 sends/s received **26.60 FPS**, versus **22.63 FPS** single-flight; send→receive p95 increased from **58.62 to 145.37 ms**. On Pod B, three repeats with telemetry polling averaged **28.73 FPS synchronous** and **28.59 FPS asynchronous**. These controls establish no asynchronous throughput improvement in this configuration. They measure transport plus worker processing; they do not measure full-app FPS. No optimization is promoted by this appendix.

Each table follows execution order. The two batches used different hosts, dispatcher/worker instrumentation, and separately generated fixture files. Compare settings within a batch; their absolute FPS difference does not isolate a telemetry, hardware, or network effect. The trials were sequential, with one observation per Pod A setting and three repeats per enabled Pod B telemetry mode.

## Measurement and configuration

The [Node client](../../../workers/runpod-flux2klein/bench/samehost_transport.cjs) uses `@roamhq/wrtc` 0.10.0, same-pod WebRTC, HTTP signaling at `127.0.0.1:3001`, and no ICE servers. It reads 32 preencoded JPEG inputs before timing and completes 20 sequential warmup requests, including their worker stats, before measuring. Every trial sends FLUX.2-klein-4B settings of 2 steps, alpha 0.10, seed 42, output JPEG80, and prompt `colorful abstract art, vibrant neon lights, psychedelic patterns`. The selected compute variant is `baseline` with worker wall-clock timings. Common limits are client buffered bytes 262,144; server pending requests per worker 3; server outbound buffered bytes 1,048,576. The two [job manifests](samehost-jobs.json) / [telemetry manifest](samehost-telemetry-jobs.json) retain exact input paths, settings, and output paths.

FPS is received images divided by observed elapsed wall time. `single` allows one outstanding request; `stream` sends on a timer while inference proceeds. The name’s send rate is requested cadence, not observed throughput: integer-millisecond scheduling can exceed it. Send→receive age uses the correlated frame ID and the client clock, beginning immediately before `channel.send`. It includes transport, queues, worker JPEG decode/inference/JPEG encode and return delivery. **Preencoding excludes input capture/encode, and the client performs no image decode or display.** JPEG header validation alone does not establish visual correctness.

Queue age is Python reader enqueue→GPU-loop dequeue for **delivered frames only**. It excludes earlier dispatcher/pipe waiting and frames dropped or still pending at the boundary. Baseline queue timing was not instrumented; “—” means unmeasured, not zero. Sent-minus-received includes discarded and boundary-pending inputs and is not a packet-loss count. Bandwidth is decimal Mbps of input/output JPEG payloads plus each 8-byte frame-ID envelope, excluding transport protocol, control-message and HTTP telemetry overhead. Output counters stop at the timing boundary; pending telemetry settles afterward and cannot extend the measured window.

## Pod A: single-flight and streaming baseline

Pod `0pxb4bss2jmbhg`, one RTX PRO 6000 Blackwell Server Edition, original Torch 2.11 stack. Eight approximately 30-second trials completed at 13:17–13:20 UTC. Input paths are `/workspace/samehost-fixtures-20260917/{width}x{height}-{00..31}.jpg`: animated waveform fixtures, 32 per resolution. Their JPEG byte ranges are 11,418–12,069 (512×288), 20,986–22,019 (768×448), and 32,250–33,366 (1024×576). Input JPEG quality is not a field in these saved job configs. All eight trials have zero attempted/completed/failed/censored telemetry polls, zero client buffer skips, and no recorded errors.

| Trial / requested sends/s | Observed s | Sent / received | Received FPS | Age p50 ms | Age p95 ms | Age p99 ms | Queue p95 ms | Input / output Mbps |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| [512×288 single / 120](samehost-baseline/512x288-single-120.json) | 30.000114 | 680 / 679 | 22.633 | 35.78 | 58.62 | 85.73 | — | 2.130 / 7.451 |
| [512×288 stream / 60](samehost-baseline/512x288-stream-60.json) | 30.000470 | 1864 / 798 | 26.600 | 100.14 | 145.37 | 162.41 | — | 5.839 / 8.761 |
| [768×448 single / 120](samehost-baseline/768x448-single-120.json) | 30.000541 | 408 / 407 | 13.566 | 70.30 | 75.29 | 80.84 | — | 2.349 / 3.573 |
| [768×448 stream / 60](samehost-baseline/768x448-stream-60.json) | 30.000597 | 1868 / 426 | 14.200 | 203.14 | 210.94 | 217.10 | — | 10.755 / 3.744 |
| [1024×576 single / 120](samehost-baseline/1024x576-single-120.json) | 29.999473 | 234 / 233 | 7.767 | 122.59 | 125.26 | 128.97 | — | 2.047 / 1.869 |
| [1024×576 stream / 60](samehost-baseline/1024x576-stream-60.json) | 30.000656 | 1868 / 243 | 8.100 | 361.81 | 371.40 | 399.58 | — | 16.347 / 1.940 |
| [512×288 stream / 30](samehost-baseline/512x288-stream-30.json) | 30.000399 | 907 / 766 | 25.533 | 96.54 | 144.04 | 178.97 | — | 2.841 / 8.407 |
| [512×288 stream / 120](samehost-baseline/512x288-stream-120.json) | 30.000854 | 3679 / 751 | 25.033 | 110.74 | 155.04 | 186.40 | — | 11.524 / 8.238 |

At 512×288, requested streaming cadences of 30/60/120 yielded 25.53/26.60/25.03 received FPS. Doubling requested input from 60 to 120 raised input bandwidth from 5.84 to 11.52 Mbps without increasing output throughput in these single observations. Larger resolutions retained a streaming throughput/latency tradeoff: 768×448 single/stream p95 was 75.29/210.94 ms; 1024×576 was 125.26/371.40 ms. These measurements cannot be subtracted from browser WAN or app measurements to isolate network overhead, because the client, fixtures and measurement scopes differ.

## Pod B: synchronous/asynchronous telemetry controls

Pod `9vj8k6guaxsbhw`, two RTX PRO 6000 Blackwell Server Edition GPUs, original Torch 2.11 stack. Both models were loaded and all three shapes warmed; `activeWorkers:1` admits only GPU0. GPU1 remained ready and resident, with zero produced frames, zero pending frames and 0% reported utilization in every saved telemetry snapshot. This is one active GPU on a two-GPU host, not a one-GPU hardware or two-GPU scaling comparison. The batch completed at 13:02–13:09 UTC.

All eight use 512×288 streaming at a requested 60 sends/s, `requireQueueTiming:true`, and `outboundFrames:0` (the byte threshold above applies). Inputs are `/workspace/telemetry-fixtures-20260917/512x288-{00..31}.jpg`, independently generated by Pillow at JPEG85: a white 4-pixel waveform on RGB(10,10,10), with two sinusoidal components animated across 32 frames. These files differ from Pod A’s fixtures. The selected `telemetryMode` is the table’s sync/async value; “off” means no polling, while “on” polls `/telemetry` every 2,000 ms. Off controls last approximately 30 seconds; each on repeat lasts approximately 60 seconds.

| Telemetry trial | Observed s | Sent / received | Received FPS | Age p50 ms | Age p95 ms | Age p99 ms | Queue p95 ms | Input / output Mbps |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| [sync-off](samehost-telemetry/telemetry-sync-off.json) | 29.999792 | 1868 / 867 | 28.900 | 96.00 | 103.82 | 106.76 | 68.29 | 5.846 / 9.540 |
| [async-off](samehost-telemetry/telemetry-async-off.json) | 30.000705 | 1867 / 860 | 28.666 | 96.76 | 105.14 | 110.95 | 68.75 | 5.843 / 9.468 |
| [async-on-r0](samehost-telemetry/telemetry-async-on-r0.json) | 60.000590 | 3735 / 1705 | 28.416 | 96.66 | 107.38 | 160.30 | 69.56 | 5.845 / 9.384 |
| [sync-on-r0](samehost-telemetry/telemetry-sync-on-r0.json) | 60.000323 | 3735 / 1724 | 28.733 | 96.52 | 106.52 | 122.02 | 68.95 | 5.845 / 9.488 |
| [sync-on-r1](samehost-telemetry/telemetry-sync-on-r1.json) | 59.999745 | 3738 / 1718 | 28.633 | 96.99 | 106.18 | 125.69 | 68.96 | 5.850 / 9.455 |
| [async-on-r1](samehost-telemetry/telemetry-async-on-r1.json) | 60.000223 | 3736 / 1726 | 28.767 | 96.58 | 105.00 | 108.84 | 68.88 | 5.846 / 9.499 |
| [async-on-r2](samehost-telemetry/telemetry-async-on-r2.json) | 60.000554 | 3736 / 1716 | 28.600 | 96.19 | 104.45 | 109.40 | 68.61 | 5.846 / 9.443 |
| [sync-on-r2](samehost-telemetry/telemetry-sync-on-r2.json) | 60.000092 | 3736 / 1729 | 28.817 | 96.22 | 106.36 | 126.08 | 68.65 | 5.846 / 9.518 |

Telemetry HTTP durations use the client clock and describe the polling request, not image age. Completed means completion inside the measurement window; censored means a request settled afterward. Every enabled repeat completed 29 of 29 attempts, totaling 174 snapshots; no poll failed or was censored. All eight trials recorded zero client buffer skips and no errors.

| Trial | Attempted | Completed | Failed | Censored | HTTP p50 ms | HTTP p95 ms | HTTP p99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| sync-off | 0 | 0 | 0 | 0 | — | — | — |
| async-off | 0 | 0 | 0 | 0 | — | — | — |
| async-on-r0 | 29 | 29 | 0 | 0 | 45.61 | 69.78 | 105.47 |
| sync-on-r0 | 29 | 29 | 0 | 0 | 48.35 | 52.86 | 78.45 |
| sync-on-r1 | 29 | 29 | 0 | 0 | 50.03 | 61.84 | 89.53 |
| async-on-r1 | 29 | 29 | 0 | 0 | 46.97 | 52.66 | 61.74 |
| async-on-r2 | 29 | 29 | 0 | 0 | 46.24 | 52.89 | 519.71 |
| sync-on-r2 | 29 | 29 | 0 | 0 | 49.50 | 53.35 | 61.75 |

The on-repeat means differ by about 0.47% (async lower), with overlapping repeat ranges: sync 28.63–28.82 FPS, async 28.42–28.77 FPS. This does not support a repeatable async speedup or a general conclusion that async is slower. The single off controls are insufficient to estimate a small polling penalty. Async r2 has a 519.71 ms HTTP p99 but a 109.40 ms frame-age p99; retain these as separate distributions. Polling-on delivered-frame queue p95 stays within 68.61–69.56 ms.

## Identity and reconciliation

The [client source record](samehost-client-source.json) and final client entry in [scaling-extended-source.jsonl](scaling-extended-source.jsonl) both identify SHA-256 `8a3d4ba25d04257d0c359fc38db785dcc2f76e8e68cd2e597b8569d2342a26f6`; the current local client matches. Pod B’s telemetry dispatcher is `5c1396ab0e1907b75a078a1ebdbfa0f0e29c75391b7c95c917ebdfaf48798179`, and queue-instrumented worker is `bdff1fa8918c2985a91a5c77b8b6d494cc24178a81b972cf77576f9b6a036b11`. Earlier entries in that JSONL are superseded staging revisions. Pod A’s dispatcher was `dbe212ac6fab113e4ec28fea64dc92d86303789be3d0a77a9265c233d63dd9b2`, as recorded in `97bc5bd:docs/performance/2026-09-17/RUNBOOK.md`. These runs predate the later idle-resume watchdog correction.

The [baseline environment](baseline-environment.json) records the original model revisions and package stack, including Torch 2.11.0+cu128 and torchao 0.17.0+cu128; the historical runbook identifies these services and wrtc upgrade. These are provenance records, not complete fresh environment fingerprints embedded in each same-pod result. The Pod A fixture manifest reviewed at `/tmp/vj0-samehost-fixtures-20260917/manifest.json` has SHA-256 `2ba7344144ec19901e9eec317e942adeeccf23acd881b037e5f76f9d6a1aaf3e`. Pod B’s fixture generator is retained locally at `/tmp/vj0-wait-telemetry-service.py`; its remote fixture manifest was not part of the local result collection reviewed here.

Independent local reconciliation matched all 16 result configs to both job manifests and per-trial saved configs; each saved log JSON matches its result. Both progress files contain the same eight successful trials in order. Received counts, worker/age/output sample counts, FPS arithmetic, receive-payload bandwidth, quantile ordering, poll accounting and snapshot timing all reconcile. Pod A input bandwidth also matches the exact fixture byte sizes, including the 8-byte envelopes and the post-warmup fixture offset. Pod B input bandwidth is retained as reported because its exact fixture bytes were not collected locally. The raw files retain aggregate percentiles rather than every frame-age sample, so those percentiles cannot be independently recomputed from individual observations.

The summarizer was exercised in memory: it retains all 16 raw same-pod outcomes without merging configurations, preserves browser scope/identity/final-health fields, and retains the premeasurement browser scaling failure. This appendix adds no GPU, browser, network or visual-quality validation.
