# Input capture and admission: final results

No input-rate or byte-threshold change is promoted. The 48 selected 60-second windows cover eight comparisons, each with three alternating-order pairs. All original negative outcomes remain: 47 windows pass structural/continuity checks, and one complete 64 KiB window fails continuity and blocks promotion. Three additional partial-cohort windows are retained but excluded by the recorded recovery selection.

Production defaults, UI, model, precision, decoder, JPEG quality and rendering remain unchanged. These tests keep native 128 threads, terminal skip, GPU output cast, latest-input mailbox and one active worker fixed. Each control is the separately paired 60 FPS / 256 KiB cohort; control differences between rows reflect different measured windows. Values are medians of trial statistics unless marked pooled.

## Achieved input and output rates

| Resolution | Candidate | Requested FPS, control → candidate | Actual send FPS | Stage FPS |
| --- | --- | ---: | ---: | ---: |
| 512 × 288 | 40 FPS cap | 60 → 40 | 42.41 → 37.49 | 37.98 → 36.11 |
| 512 × 288 | 30 FPS cap | 60 → 30 | 50.15 → 29.33 | 39.38 → 29.30 |
| 512 × 288 | 64 KiB admission | 60 → 60 | 42.71 → 43.97 | 36.08 → 37.97 |
| 512 × 288 | 16 KiB admission | 60 → 60 | 43.73 → 45.24 | 36.45 → 37.31 |
| 768 × 448 | 40 FPS cap | 60 → 40 | 47.33 → 35.25 | 21.20 → 20.56 |
| 768 × 448 | 30 FPS cap | 60 → 30 | 46.82 → 28.85 | 21.05 → 20.55 |
| 1024 × 576 | 40 FPS cap | 60 → 40 | 47.50 → 38.45 | 12.24 → 12.21 |
| 1024 × 576 | 30 FPS cap | 60 → 30 | 54.09 → 29.72 | 12.19 → 12.16 |

Stage FPS counts unique WebGL frame submissions in the headless browser, not completed physical monitor presentations. The requested capture rate is a ceiling, not a promise of achieved input FPS. At 512 × 288, the 30 FPS cap visibly starves the faster worker. At larger resolutions both capped input rates exceed output FPS, but that alone does not establish equal freshness or audio responsiveness.

## Capture-to-stage age and controlled pulses

| Resolution / candidate | p95 age, ms: control → candidate | p99 age, ms | Pulse responses within 1 s, pooled |
| --- | ---: | ---: | ---: |
| 512 × 288 / 40 FPS | 108.6 → 114.5 | 125.7 → 229.6 | 51/57 → 57/57 |
| 512 × 288 / 30 FPS | 107.0 → 102.5 | 126.0 → 129.8 | 57/57 → 56/57 |
| 512 × 288 / 64 KiB | 116.0 → 111.5 | 136.4 → 131.9 | 57/57 → 55/57 |
| 512 × 288 / 16 KiB | 260.8 → 112.6 | 463.5 → 142.8 | 56/57 → 55/57 |
| 768 × 448 / 40 FPS | 155.4 → 175.9 | 175.9 → 210.9 | 57/57 → 52/57 |
| 768 × 448 / 30 FPS | 185.2 → 176.4 | 393.3 → 214.0 | 55/57 → 52/57 |
| 1024 × 576 / 40 FPS | 195.9 → 199.6 | 229.2 → 227.2 | 48/57 → 47/57 |
| 1024 × 576 / 30 FPS | 193.6 → 223.3 | 281.9 → 353.0 | 49/57 → 51/57 |

Age starts at capture encode and ends at the stage submission; audio acquisition and physical display latency are excluded. Pulse IDs follow real oscillator-driven waveform input through the actual model and returned image. They measure capture/delivery of brief audio events, not perceptual beat strength or artistic equivalence.

At 768 × 448, both caps return fewer pulses despite maintaining about 21 output FPS. At 1024 × 576, the 30 FPS cap improves pooled pulse responses but worsens latency and fails preservation in one matched pair. The 16 KiB threshold reduces the measured 512 latency tails, but returns 55/57 pulses versus 56/57; its two uncaptured pulses in one candidate pair were hidden by the original median-count gate. The corrected pooled and per-pair gates reject it. This small cohort does not prove each loss is caused by a cap or threshold; it also does not satisfy the predeclared preservation requirement.

No 16 KiB higher-resolution expansion or ten-minute candidate hold was performed because no candidate passed all required gates. No rejected option is combined or enabled. See [512 details](RESULTS-512.md) for the retained output-gap outlier and the superseded median-only report.

## Why target 60 does not mean 60 sent frames

| Resolution / cohort | Control send FPS | Control toBlob callback p50 / p95, ms | Control callbacks over 16.67 ms |
| --- | ---: | ---: | ---: |
| 512 × 288 / 40 FPS pair | 42.41 | 11.0 / 27.1 | 28.2% |
| 512 × 288 / 30 FPS pair | 50.15 | 8.2 / 23.7 | 17.6% |
| 512 × 288 / 64 KiB pair | 42.71 | 12.0 / 28.1 | 34.7% |
| 512 × 288 / 16 KiB pair | 43.73 | 11.0 / 26.4 | 32.3% |
| 768 × 448 / 40 FPS pair | 47.33 | 8.7 / 23.9 | 25.1% |
| 768 × 448 / 30 FPS pair | 46.82 | 10.3 / 27.3 | 23.8% |
| 1024 × 576 / 40 FPS pair | 47.50 | 10.5 / 22.9 | 23.3% |
| 1024 × 576 / 30 FPS pair | 54.09 | 7.6 / 21.1 | 10.1% |

These durations are invocation-to-callback measurements from the existing raw windows, computed offline after timing. They include scheduling, canvas readback, encoding and callback delay. They do not isolate JPEG CPU execution. The [capture loop](../../../../app/vj-next/VJNextApp.tsx#L679) skips admission while an encode is pending; that flag remains set through the subsequent arrayBuffer/send completion. A callback delayed beyond a 16.67 ms frame opportunity therefore makes missed admissions plausible. The measured callback interval is only part of that busy period, and admission backpressure plus other main-thread/render work also contribute. This experiment did not isolate their causal shares. [Full encode distributions and raw hashes](encode-duration-archived.json) retain every selected window, including the failed continuity outcome.

Pure local rAF/JPEG qualification found 30 Hz in headed Chrome 149 and 153, versus 60 Hz headless in both. The [main display evidence](display-cadence-evidence.json) reports 30 Hz; no OS setting changed. That physical refresh limit is separate from the formal headless submission results. The machine also runs unrelated Cube/Kale browser sessions and user workloads, which were untouched; alternating controls help comparison but do not turn this into an isolated-machine benchmark.

## Reliability and provenance

Three connection attempts failed before a timed window: two in the 512 recovery and one in the 1024 cohort. The last has direct passive browser evidence: health GET 200, OPTIONS 200 with the expected CORS headers, then offer Fetch net::ERR_FAILED with neither corsErrorStatus nor blockedReason supplied. The exact cause remains unresolved. It is not evidence of a Python-specific proxy 403. A fresh unchanged connection succeeded, and only the five untimed 1024 cells were continued; the seven completed windows were retained. See [512 failure record](connection-failure-record.json), [1024 failure details](connection-failure-1024-details.json), and [1024 selection](selection-1024-archived.json). WebRTC therefore did not succeed on every setup attempt.

An incorrect 768 × 432 preparatory request triggered an excluded 190-second compile. It produced no timed result, and its original drain timed out. After the worker became idle, a fresh no-input ordered barrier passed; the correct 768 × 448 cohort followed. This recovery does not retroactively validate the failed original drain. See [shape correction](768-shape-correction.json) and [fresh barrier](post-compile-fresh-barrier.json).

All selected timed transitions and final cohort cleanup pass the ordered-barrier checks. The server ACK follows prior outputs after all earlier input, mailbox, bootstrap, worker and compile work is drained. This addresses reliable SCTP backlog; it does not claim physical display completion. The retained 64 KiB continuity failure occurred inside its timed window and is not excused by successful cleanup.

Authoritative compressed evidence: [512 report](results-512-archived.json), [512 selection](selection-512-archived.json), [768 report](results-768x448-archived.json), [1024 report](results-1024x576-archived.json), [1024 selection](selection-1024-archived.json). Original selections remain as historical provenance. Cohort archive manifests include original byte hashes and compressed hashes; decompression was verified exactly, and archived recomputation returns the same metrics and gates. The [final archive-only audit](archive-only-validation.json) moved all seven redundant raw cohorts outside the repository and then reproduced all four complete report JSON objects identically, with the original raw paths unavailable. [Frozen measurement sources](frozen-harness-v5/sources.json), [served chunk identities](browser-targets-v6-headless149/chunk-patches.json), [server hashes](frozen-server/hashes.json), and [independent preparation review](review-preparation.json) remain available.

The final input run ended with an ordered ACK at client epoch 75 and source/received watermark 146611, followed by both pages closing to about:blank. GPU/browser ownership was handed back to the coordinating agent for subsequent experiments. The input-only passive logger stopped after cleanup; the shared owned browser and Next server remain available for that handoff.
