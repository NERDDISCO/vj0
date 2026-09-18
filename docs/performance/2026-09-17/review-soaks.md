# Separate app soak audit

Both 180-second rotating-audio windows, the subsequent lifecycle stress test and final cleanup passed. All age outliers remain included. These two observations are separate from the 18-trial formal cohort.

| Policy | Observed seconds | Input / receive / preview RAF / stage FPS | Stage p50 / p95 / p99 / max age ms | Stage >250 / >500 / >1000 ms % |
|---|---:|---:|---:|---:|
| Compute/capture, mailbox off | 180.313300 | 47.246 / 21.196 / 21.113 / 21.191 | 193.20 / 760.80 / 2627.26 / 3529.30 | 9.9189 / 7.5111 / 2.6433 |
| Latest-input mailbox | 180.312000 | 48.671 / 21.130 / 21.086 / 21.130 | 114.00 / 147.30 / 606.79 / 2230.50 | 1.1811 / 1.0761 / 0.8924 |

Mailbox stage p95/p99 in this pair are 147.30/606.79 ms versus 760.80/2627.26 ms with the mailbox off; mailbox maximum age remains 2.231 seconds. These separate observations do not override the formal cohort.

Actual analyser RMS medians for requested levels 0 / 0.2 / 0.6:

- compute-capture-768-three-minute-soak: 0.000000 / 0.141268 / 0.422770
- latest-input-768-three-minute-soak: 0.000000 / 0.142064 / 0.424916

Received, preview and stage IDs and reconstructed capture timestamps are strictly increasing within each target measurement window, with no missing IDs or duplicates. Worker 0 provided the requested native 128-thread, terminal-skip, GPU-output-cast telemetry; maximum steady worker-stat arrival gaps were 579.5 / 514.5 ms.

Stress retained 744 / 727 / 745 receive / preview RAF / stage observations in separate target windows. It completed three prompt changes, three resolution changes returning to 768x448, ten rapid prompt inputs with the final cue observed, and three reconnects. Source IDs and reconstructed capture timestamps stayed ordered.

Settings-to-subsequent-capture receipt: 134.900 / 119.600 / 129.500 ms. Connect-click-to-new-capture receipt: 11.2134 / 11.2299 / 11.2166 seconds.

The two 180-second runs are sequential, with one observation per policy and changing audio levels. They cannot establish a general causal tail improvement.

The 1920x1080 stage viewport used a 2304x1344 WebGL buffer at 768x448 input. Stage submissions and preview RAF observations are not physical display presentation.

Stress uses separate main and stage windows and includes deliberate disconnects. Its event rates and long gaps are not steady-state FPS or continuity failures.

Settings-to-subsequent-capture receipt proves a newer capture, not which model prompt revision produced the image or semantic adherence.

Reconnect times include app signaling, control flow and generation until a new captured frame arrives; they are not network handshake-only times.

Inter-trial drain establishes observed encoder/worker quiescence, not complete SCTP drain. Epochs and warmup mitigate stale-session effects without proving contamination or its absence.

