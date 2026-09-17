# Actual application and projector measurements

Frontend source `4a02d2f`; the unchanged app consumes WebRTC JPEG output and forwards generated frames to its existing projector. Synthetic WebAudio drives the real analyser. Ages begin at canvas JPEG encoding, excluding audio acquisition/canvas copying and physical display presentation. Main-image RAF observations and unique stage WebGL submissions are separate from compositor display FPS.

## Original ten-minute two-GPU soak: valid numbers, failed ordering

Torch 2.13 / CUDA 13.2 / TorchAO 0.18, combined cache/event profile, two RTX PRO 6000 GPUs, 768×448, two steps, alpha 0.1, seed 42, JPEG 80, pending 3, telemetry open. Main 1440×900; projector 1920×1080 at DPR 1; actual GL buffer 2304×1344. Common timed interval 600.4072seconds.

| Observed boundary | Unique frames | FPS | Age p50 / p95 / p99 ms |
|---|---:|---:|---|
| Received JPEG | 17986 | 29.956 | 220.8 / 594.3 / 2445.6 |
| Main current-image RAF | 14592 | 24.304 | 233.6 / 624.1 / 2465.5 |
| Projector GL submission | 17955 | 29.905 | 225.5 / 598.6 / 2454.9 |

The scripted channel/audio/worker/recovery guards passed, but independent source-ID audit failed: 2,300 received frames, 1,383 main RAF observations and 2,293 stage submissions reversed source order. Both individual GPU streams were monotonic; all reversals crossed GPUs. The app sequences asynchronous receive/decode work but cannot infer capture order from untagged JPEGs. This configuration is not approved for temporally correct display.

Projector maximum age was 4,444.5ms. Worker 0/1 delivered 8,989 / 8,997 observed outputs; maximum observed stats-arrival gaps 1,911.6 / 1,553.1 ms. Those liveness bounds do not imply low frame age. All latency spikes remain in the raw data.

### Separate scripted lifecycle trial

| Action | Observed interval ms | Meaning |
|---|---|---|
| Prompt 1 | 253.3 | Settings sent→receive of a subsequently captured input; prompt revision execution not proven |
| Prompt 2 | 209.7 | Settings sent→receive of a subsequently captured input; prompt revision execution not proven |
| Prompt 3 | 198.6 | Settings sent→receive of a subsequently captured input; prompt revision execution not proven |
| 1024×576 | 231.5 | Change→matching worker size; actual matching main/stage decode also checked |
| 512×288 | 119.9 | Change→matching worker size; actual matching main/stage decode also checked |
| 768×448 | 178.4 | Change→matching worker size; actual matching main/stage decode also checked |
| Reconnect 1 | 11258.0 | Connect click→newly captured frame received |
| Reconnect 2 | 11286.6 | Connect click→newly captured frame received |
| Reconnect 3 | 11251.0 | Connect click→newly captured frame received |

Ten rapid prompt edits also reached the final outgoing setting and fresh generated output recovered. Three reconnects took approximately 11.25–11.29 seconds; they are successful recovery, not fast reconnection. Deliberate disconnects and resolution/prompt changes are outside the steady FPS window.

## Source-order correction

The dispatcher assigns a private monotonic sequence to every dispatched image, including raw JPEG clients, and the Python worker echoes it. After pending-count and watchdog accounting, the dispatcher rejects any result older than the last successfully sent image. Sequence state advances after JPEG send, before stats send; congestion and failed JPEG sends do not advance it. Prior connection epochs remain rejected before new-session accounting. Missing/invalid sequence echoes are counted and logged; dispatcher and worker must deploy together. The existing ordered WebRTC wire format is unchanged.

CPU regressions cover raw/tagged inversion, stale epochs, congestion, later stats-send failure and invalid worker echoes. Ten lifecycle/frame-ID tests pass. Against the prior server, both inversion tests fail; the new source-ID app assertion also detects the original measured failure.

## Corrected actual-app measurements

All three steady trials passed the existing channel/audio/dimension/worker checks and the added source-order checks. These are one observation per size, not three repeated trials per size. The 768×448 interval lasts ten minutes; the others last one minute. All use two active GPUs and the same combined profile, two steps and JPEG 80.

| Generated size | Seconds | Input sent FPS | Received FPS | Main RAF FPS | Projector GL FPS | Stage age p50 / p95 / p99 ms |
|---|---:|---:|---:|---:|---:|---|
| 512×288 | 60.204 | 37.589 | 33.536 | 26.244 | 32.639 | 122.6 / 179.8 / 223.5 |
| 768×448 | 600.253 | 37.018 | 26.959 | 21.529 | 26.729 | 227.7 / 285.0 / 329.9 |
| 1024×576 | 60.211 | 38.216 | 17.024 | 15.329 | 17.007 | 391.4 / 462.4 / 484.9 |

The corrected 768×448 run contains 16,182 received source frames, 12,923 main RAF observations and 16,044 stage submissions. Every observed stream has zero backwards IDs, duplicates or missing IDs. Its maximum stage age is 532.2 ms. Worker 0/1 contribute 8,376 / 7,806 delivered frames, with maximum observed stats gaps of 710.7 / 1,520.7 ms.

Compared with the earlier failed-ordering soak, stage throughput is 29.90→26.73 FPS, p95 age 598.6→285.0 ms, and p99 age 2,454.9→329.9 ms. These are sequential runs: the ordering correction is verified, but the full latency difference cannot be assigned exclusively to it. The new configuration discards older source outputs instead of counting them as useful display work.

The actual app sends only about 37–38 input FPS in the corrected 512 and 768 trials despite its 60 FPS setting. Its capture/scheduling/rendering path is a follow-up profiling target; the standalone 57 FPS transport result is not attainable app FPS evidence. No additional capture-cadence change was made during these frozen confirmations.

**Corrected lifecycle stress passed.** Three prompt-setting edits, ten rapid
edits, size changes 1024→512→768 and three reconnects recovered. Settings→receive
of a subsequently captured frame was 154.2 / 166.6 / 129.5 ms; this does not prove
which prompt revision generated that output. Matching-resolution worker output
arrived after 225.9 / 175.4 / 185.0 ms, with main and stage size checks also
passing. Reconnect→fresh receive took 11,151.3 / 11,165.9 / 11,184.8 ms.
The stress records 1,049 received frames, 861 main RAF observations and 1,052
stage submissions in separate target windows, all with zero source reversals,
duplicates or missing IDs. Intentional disconnects are excluded from steady FPS.
[Stress evidence](app-source-order/source-order-next-768x448-ten-minute-soak/stress.json).

Raw summaries and lossless frame logs: [corrected app artifacts](app-source-order/). The runtime and paired source hashes are in [source-order-runtime.json](source-order-runtime.json).

## Earlier frontend comparisons

The twelve alternating one-GPU 512×288 comparisons remain summarized in [RESULTS.md](RESULTS.md). Next projector medians 26.89→27.85FPS; legacy 26.70→26.02FPS. These do not establish an overall frontend FPS improvement. They predate the dispatcher source-order correction.

Evidence: [original summary](app-soak/candidate-next-ten-minute-soak/summary.json), [stress](app-soak/candidate-next-ten-minute-soak/stress.json), [independent review](review-app-soak.json), [corrected source hashes](source-order-identity.json). Raw event logs are losslessly gzipped beside the summaries.

## Visual evidence

Captured after every timed experiment, using the actual app and the corrected
two-GPU service at 768×448. Main viewport1440×900; projector1920×1080.
Synthetic WebAudio levels0 /0.2 /0.6 change the input and generated waveform.
Videos use full-viewport CDP image sequences with capture-timestamp durations,
encoded at15FPS for playback; playback FPS is not benchmark throughput.
Screenshots and 5/15/30-second video samples were visually inspected.

- [Ready app](/tmp/vj0-perf-evidence-20260917/next-ready.png)
- [Generating app](/tmp/vj0-perf-evidence-20260917/next-generating.png)
- [Higher audio level, app](/tmp/vj0-perf-evidence-20260917/next-audio-reactive.png)
- [Generating projector](/tmp/vj0-perf-evidence-20260917/projector-generating.png)
- [Higher audio level, projector](/tmp/vj0-perf-evidence-20260917/projector-audio-reactive.png)
- [App flow, 38.2 seconds](/tmp/vj0-perf-evidence-20260917/app-flow.webm)
- [Projector flow, 38.1 seconds](/tmp/vj0-perf-evidence-20260917/projector-flow.webm)

The two earlier cropped/incorrect-viewport evidence attempts are retained in
separate scratch subdirectories and are not the final screenshots/videos above.
No screenshot, video, browser profile or trace is committed to Git.
