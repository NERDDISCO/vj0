# Independent app WAN audit — partial cohort

8 of 18 planned trials completed. All completed arithmetic/configuration/source-order checks passed. All outliers remain included.

The ninth trial, latest-input-1024-r0, disconnected around local clamshell sleep and has no completed summary. Cleanup failed its connected-probe drain guard. This is an environment interruption, not a completed mailbox stability result. None of the reverse-order repeats ran. Preserve these eight observations separately from a fresh full cohort.

Rates below count unique receipts, current-image RAF observations and stage GL submissions in each common frozen interval. They are not physical display FPS. Ages start at JPEG encode initiation.

| Trial | Seconds | Sent FPS | Received FPS | Preview RAF FPS | Stage GL FPS |
|---|---:|---:|---:|---:|---:|
| before-512-r0 | 60.252 | 37.758 | 29.708 | 28.264 | 29.659 |
| compute-capture-512-r0 | 60.309 | 49.959 | 38.518 | 31.189 | 38.286 |
| latest-input-512-r0 | 60.370 | 51.715 | 40.815 | 34.355 | 40.765 |
| before-768-r0 | 60.270 | 36.718 | 14.336 | 14.219 | 14.352 |
| compute-capture-768-r0 | 60.278 | 54.763 | 21.401 | 20.190 | 21.384 |
| latest-input-768-r0 | 60.279 | 53.617 | 20.637 | 19.924 | 20.571 |
| before-1024-r0 | 60.421 | 36.262 | 8.341 | 8.292 | 8.341 |
| compute-capture-1024-r0 | 60.374 | 52.871 | 12.058 | 11.893 | 12.058 |

| Trial | Stage p50/p95/p99/max ms | Stage >250/500/1000 ms % | Max stage/worker-stat gap ms |
|---|---|---|---|
| before-512-r0 | 137.6 / 163.3 / 183.9 / 278.8 | 0.056 / 0.000 / 0.000 | 142.8 / 141.1 |
| compute-capture-512-r0 | 112.8 / 555.4 / 6523.8 / 6872.3 | 8.142 / 5.500 / 3.638 | 1528.1 / 1519.7 |
| latest-input-512-r0 | 81.8 / 132.5 / 762.7 / 1280.0 | 2.357 / 1.585 / 0.691 | 429.9 / 427.6 |
| before-768-r0 | 277.4 / 327.6 / 359.9 / 399.2 | 92.139 / 0.000 / 0.000 | 167.8 / 165.9 |
| compute-capture-768-r0 | 206.7 / 258.1 / 342.4 / 457.2 | 6.439 / 0.000 / 0.000 | 273.1 / 171.3 |
| latest-input-768-r0 | 135.8 / 199.0 / 278.2 / 574.8 | 2.016 / 0.161 / 0.000 | 503.5 / 414.3 |
| before-1024-r0 | 429.8 / 489.0 / 932.1 / 1154.9 | 100.000 / 4.365 / 0.794 | 430.7 / 234.7 |
| compute-capture-1024-r0 | 318.4 / 379.1 / 414.9 / 549.1 | 100.000 / 0.137 / 0.000 | 236.8 / 212.7 |

The first 512 candidate delay is already present at receipt: peak ID874 was captured at12.9532s, sent at12.9595s and received at19.8169s. It saw265097 buffered client bytes,35.718ms worker queue time,21.93ms worker frame time,then8.6ms to stage and22.6ms to preview RAF. Across84 receipts over1s old,worker processing is21.86–35.02ms,queue0.012–42.826ms,and receive→stage at most11.8ms. Client sending pauses during seconds13–16; WebAudio samples continue at approximately500ms,max501.4ms. Bracketed Node event-loop accumulated lag is37ms across122 checks.

This supports reliable-transport backlog and weighs against a multi-second measured inference operation or continuous browser/Node event-loop freeze. There are no correlated server arrival/send timestamps to prove exact network direction,packet-loss cause or residual IPC/host scheduling. The final22ms RTT snapshot does not describe the episode. The much later lid-close interruption does not explain or justify excluding this earlier outlier.

The production channel is created with reliable ordered defaults. Admission uses a256KiB browser send-buffer threshold; one accepted JPEG may take it above the threshold. A server mailbox cannot remove bytes already queued in browser/SCTP. Mailbox ACKs show effective1inflight+1latest waiting versus pending3 when off.

Matched context: one active GPU,declared original Torch2.11 stack,native128 worker threads,2steps/alpha0.1/seed42 fixture. Actual worker ID,thread count,variant,output-cast mode and terminal skip are validated per frame; app build/runtime source identity requires the separate retained launch/build inventory. Before→compute-capture changes compute and capture together; mailbox changes its effective admission policy. No result here establishes an isolated feature gain or complete counterbalanced estimate.

Measured status checks continuity and correctness but has no age threshold. All per-trial tails and >250/500/1000ms fractions are retained in the JSON for receive,preview and stage separately. A future40/30FPS cap is a throughput/freshness experiment,not a claim from these trials and not an image-quality change.

Reproduce: `python3 /tmp/vj0-audit-deep-app-20260918.py --environment-context /tmp/vj0-deep-environment-interruption-20260918`.

Full machine-readable audit: `review-app-interrupted.json`.
