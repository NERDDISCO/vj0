# Independent saved app audit

Status: complete_passed. Completed summaries: 2 of 2 planned.

Unique receipts, current loaded image at RAF, and stage GL submissions divided by observed common frozen wall time. Neither RAF nor GL submission is physical display presentation. Age starts at JPEG encode initiation, excluding audio acquisition. All outliers remain included.

Steady gates check source order, dimensions, requested worker config, audio, channel/compile errors, freshness and worker-stat arrival gaps no greater than 2 seconds. Passed continuity is not an age-percentile or maximum-age guarantee.

| Trial | Audit | Seconds | Input FPS | Receive FPS | Preview RAF FPS | Stage GL FPS |
|---|---|---:|---:|---:|---:|---:|
| compute-capture-768-three-minute-soak | passed | 180.313 | 47.246 | 21.196 | 21.113 | 21.191 |
| latest-input-768-three-minute-soak | passed | 180.312 | 48.671 | 21.130 | 21.086 | 21.130 |

| Trial / boundary | Age p50 / p95 / p99 / max ms | Age >250 / >500 / >1000 ms % | Max arrival gap ms |
|---|---|---|---:|
| compute-capture-768-three-minute-soak / main/preview-image-raf | 210.5 / 767.5 / 2618.1 / 3536.8 | 10.954 / 7.486 / 2.653 | 564.0 |
| compute-capture-768-three-minute-soak / main/received | 189.1 / 757.0 / 2624.7 / 3526.8 | 9.864 / 7.457 / 2.643 | 579.4 |
| compute-capture-768-three-minute-soak / stage/webgl-frame-submitted | 193.2 / 760.8 / 2627.3 / 3529.3 | 9.919 / 7.511 / 2.643 | 575.2 |
| latest-input-768-three-minute-soak / main/preview-image-raf | 132.7 / 167.1 / 594.6 / 2231.2 | 1.157 / 1.052 / 0.868 | 508.3 |
| latest-input-768-three-minute-soak / main/received | 110.4 / 143.5 / 604.2 / 2227.1 | 1.181 / 1.076 / 0.892 | 513.6 |
| latest-input-768-three-minute-soak / stage/webgl-frame-submitted | 114.0 / 147.3 / 606.8 / 2230.5 | 1.181 / 1.076 / 0.892 | 517.2 |

Sequential within-cohort comparisons, not simultaneous causal controls. Before versus compute-capture changes capture and compute together. Each report keeps its own manifest/cohort; separate soak runs are not additional repeats.

Planned reverse ordering: False. Completed valid counterbalance: False.

Episodes below are generated only from receipts above the configured age threshold in this cohort. Worker timing pairing is inferred from ordered binary/stat messages; server receive/send timestamps are unavailable.

- compute-capture-768-three-minute-soak: 83 consecutive receipts above 1000 ms; peak frame 1079 aged 3526.8 ms at 19.476 s. Worker total p99/max: 48.4 / 49.1 ms; measured queue p99/max: 91.7 / 93.9 ms. Full capture/send/render context is retained in JSON.
- compute-capture-768-three-minute-soak: 9 consecutive receipts above 1000 ms; peak frame 4271 aged 1214.9 ms at 83.608 s. Worker total p99/max: 47.0 / 47.0 ms; measured queue p99/max: 83.0 / 83.5 ms. Full capture/send/render context is retained in JSON.
- compute-capture-768-three-minute-soak: 1 consecutive receipts above 1000 ms; peak frame 4397 aged 1000.6 ms at 87.629 s. Worker total p99/max: 44.8 / 44.8 ms; measured queue p99/max: 56.8 / 56.8 ms. Full capture/send/render context is retained in JSON.
- compute-capture-768-three-minute-soak: 3 consecutive receipts above 1000 ms; peak frame 4418 aged 1086.7 ms at 88.548 s. Worker total p99/max: 47.1 / 47.1 ms; measured queue p99/max: 62.2 / 63.2 ms. Full capture/send/render context is retained in JSON.
- compute-capture-768-three-minute-soak: 5 consecutive receipts above 1000 ms; peak frame 4439 aged 1174.5 ms at 89.619 s. Worker total p99/max: 47.3 / 47.3 ms; measured queue p99/max: 33.5 / 34.0 ms. Full capture/send/render context is retained in JSON.
- latest-input-768-three-minute-soak: 34 consecutive receipts above 1000 ms; peak frame 1488 aged 2227.1 ms at 27.215 s. Worker total p99/max: 54.3 / 56.6 ms; measured queue p99/max: 0.1 / 0.1 ms. Full capture/send/render context is retained in JSON.

The app transport uses a default reliable ordered frames data channel and a 256 KiB canSend threshold. One admitted JPEG can raise bufferedAmount above that threshold. A server mailbox cannot evict bytes already queued in browser/SCTP. ACKs document effective admission per trial; exact loss causes or direction are not identified by these client logs.

Saved provenance: saved_provenance_checked.

Stress for latest-input-768-three-minute-soak: passed. Separate target windows; prompt response means a subsequent capture, not proof of model prompt revision.
