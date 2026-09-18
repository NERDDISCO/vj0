# N06: app throughput, two workers, and lifecycle — 18 September 2026

**The selected bundle improves throughput, but the complete matrix and 10-minute hold fail the declared continuity requirement.** All 36 planned windows remain included: 35 passed and one complete continuity-negative result. The hold also failed continuity. The separate, predeclared lifecycle contingency passed all 10 actions. There were no N06 connection/setup failures or timed reruns.

The baseline uses original compute with wall-clock stage timing, CPU output cast and terminal skip off. The selected bundle uses the previously tested compute path, CUDA-event stage timing, GPU output cast and terminal skip. Both use native 128 threads, the same FP8 model, two denoising steps, alpha 0.1, seed 42, mailbox on, max pending 3, requested input 60 FPS, 256 KiB admission threshold, JPEG 85 input and JPEG 80 output. No N01–N05 candidate was combined. One versus two means active workers on the same two-GPU host, with both models loaded.

Each cell contains three sequential 60-second windows. Values below are median [minimum–maximum] across trials; age columns are medians of trial percentiles, not pooled percentiles. All failed outcomes remain in descriptive statistics. Stage FPS means unique source frames submitted to WebGL, not physical monitor presentation. Resolution refers to generated images, not the larger stage canvas.

| Output | Workers | Bundle | Sent FPS (target 60) | Stage FPS | Source age p50 / p95 / p99 ms | Worst source age ms | Timely pulse lineage |
|---|---:|---|---|---|---|---:|---|
| 512 × 288 | 1 | baseline | 43.18 [43.13–51.88] | 28.39 [28.29–28.68] | 101.6 / 130.5 / 148.2 | 281.3 | 57/57 |
| 512 × 288 | 1 | selected | 45.47 [42.51–47.77] | 38.98 [37.56–39.66] | 83.4 / 110.5 / 152.9 | 611.0 | 56/57 |
| 512 × 288 | 2 | baseline | 49.46 [40.58–52.11] | 43.75 [38.87–48.25] | 85.3 / 131.1 / 159.6 | 280.4 | 57/57 |
| 512 × 288 | 2 | selected | 46.29 [41.90–51.65] | 45.90 [41.62–51.40] | 67.2 / 95.6 / 111.3 | 357.5 | 57/57 |
| 768 × 448 | 1 | baseline | 51.26 [47.49–52.92] | 15.21 [15.16–15.23] | 139.6 / 165.7 / 197.4 | 361.4 | 52/57 |
| 768 × 448 | 1 | selected | 47.87 [40.67–50.66] | 22.34 [21.49–22.42] | 114.3 / 154.0 / 177.3 | 1200.7 | 56/57 |
| 768 × 448 | 2 | baseline | 43.69 [42.13–45.61] | 28.27 [27.26–28.65] | 143.6 / 177.3 / 214.1 | 2580.4 | 56/57 |
| 768 × 448 | 2 | selected | 40.85 [39.27–44.09] | 36.55 [35.53–37.48] | 116.0 / 152.7 / 308.7 | 1408.7 | 54/57 |
| 1024 × 576 | 1 | baseline | 54.11 [50.21–55.06] | 8.68 [8.63–8.68] | 187.2 / 226.7 / 246.2 | 358.9 | 37/57 |
| 1024 × 576 | 1 | selected | 52.45 [50.04–53.19] | 12.39 [12.34–12.49] | 159.6 / 187.0 / 225.4 | 494.4 | 53/57 |
| 1024 × 576 | 2 | baseline | 44.13 [43.28–52.69] | 17.22 [17.18–17.36] | 199.3 / 241.5 / 276.1 | 411.3 | 53/57 |
| 1024 × 576 | 2 | selected (continuity failed) | 43.90 [33.23–44.58] | 23.61 [18.72–24.34] | 163.5 / 211.2 / 329.8 | 7122.1 | 50/57 |

Paired gains are calculated within each repeat before taking the median and range. They are not ratios of the cell medians.

| Output | Comparison | Paired FPS ratio, median [range] |
|---|---|---|
| 512 × 288 | selected bundle / baseline at 1 active worker(s) | 1.37 [1.33–1.38] |
| 512 × 288 | selected bundle / baseline at 2 active worker(s) | 1.07 [0.95–1.17] |
| 512 × 288 | 2 / 1 active GPU workers within selected bundle | 1.18 [1.05–1.37] |
| 768 × 448 | selected bundle / baseline at 1 active worker(s) | 1.47 [1.42–1.47] |
| 768 × 448 | selected bundle / baseline at 2 active worker(s) | 1.33 [1.24–1.34] |
| 768 × 448 | 2 / 1 active GPU workers within selected bundle | 1.63 [1.59–1.74] |
| 1024 × 576 | selected bundle / baseline at 1 active worker(s) | 1.43 [1.43–1.44] |
| 1024 × 576 | selected bundle / baseline at 2 active worker(s) (includes continuity failure) | 1.37 [1.08–1.42] |
| 1024 × 576 | 2 / 1 active GPU workers within selected bundle (includes continuity failure) | 1.91 [1.51–1.95] |

The 512 × 288 two-worker bundle gain is variable (one paired ratio is below 1). Two workers improve 768 × 448 and 1024 × 576 throughput, but scaling does not establish stable delivery: the final 1024 selected trial has worker gaps of 2076.6 and 3490.5 ms, an overall stage gap of 1970.9 ms, p95/p99 source ages of 2743.8/5676.2 ms and a 7122.1 ms maximum. Other tails remain visible: the 768 two-worker selected repeat 1 has p95/p99 ages of 1189.2/1363.6 ms. The median is not the worst trial.

The 600.541-second 768 × 448 two-worker selected hold delivered 36.354 stage FPS. Source age was p50 113.6 ms, p95 162.4 ms, p99 767.5 ms, maximum 4139.8 ms. Worker gaps reached 2038.1 and 2008.5 ms; the overall stage gap reached 2005.9 ms. Its continuity gate failed. Of 199 pulsed inputs, 194 had timely source-frame lineage within 1 second; four were unobserved in the window, including three with no admitted capture, and one additional observed response was later than 1 second. These overlapping counts must not be added as independent losses.

Pulse checks track a sampled pulsed input through source IDs to output delivery. They do not assess perceptual beat strength, artistic responsiveness, or prompt correctness. No invalid or censored pulse was silently removed; per-trial pulse records are preserved.

The declared lifecycle contingency used a separate excluded 8-second qualification, then passed three prompt changes, three resolution changes, ten rapid prompts, and three intentional disconnect/reconnect cycles. Reconnect-to-new-capture receive took 11.270, 11.228 and 11.193 seconds. These are startup times, distinct from steady-state frame age. The lifecycle pass does not repair the failed hold. Final ordered nonce ACKs and cleanup passed after matrix, hold and lifecycle; safe drain is separate from continuity performance.

Input encoding callback durations are retained below. They include browser scheduling and are evidence of occupied capture time, not an isolated JPEG CPU benchmark. The formal browser was Chrome 149 headless with Metal on the M4; unrelated user browser/OBS workloads were left running. Earlier bounded qualification found headed rendering at the physical main display’s 30 Hz versus headless 60 Hz. Neither target input FPS nor headless WebGL submission guarantees the monitor presents that many distinct frames.

| Output | Workers | Bundle | Encode callback p50 ms, median [range] | Encode callback p95 ms, median [range] |
|---|---:|---|---|---|
| 512 × 288 | 1 | baseline | 11.80 [8.30–12.15] | 27.80 [23.10–27.90] |
| 512 × 288 | 1 | selected | 10.80 [9.90–10.90] | 26.58 [25.90–27.26] |
| 512 × 288 | 2 | baseline | 8.00 [7.15–12.80] | 23.00 [22.00–30.64] |
| 512 × 288 | 2 | selected | 8.90 [8.30–11.80] | 24.60 [22.90–27.80] |
| 768 × 448 | 1 | baseline | 8.50 [6.60–10.20] | 22.83 [22.20–25.70] |
| 768 × 448 | 1 | selected | 8.10 [7.90–12.60] | 24.00 [23.10–29.70] |
| 768 × 448 | 2 | baseline | 9.80 [9.00–11.00] | 27.12 [26.64–28.28] |
| 768 × 448 | 2 | selected | 13.00 [8.90–13.10] | 33.30 [27.40–35.80] |
| 1024 × 576 | 1 | baseline | 8.10 [7.40–8.40] | 20.77 [20.20–22.00] |
| 1024 × 576 | 1 | selected | 7.00 [7.00–10.00] | 21.20 [20.70–23.60] |
| 1024 × 576 | 2 | baseline | 11.60 [8.00–11.90] | 26.93 [22.71–27.39] |
| 1024 × 576 | 2 | selected | 10.55 [10.10–11.80] | 26.40 [25.45–27.75] |

The production proof establishes within-process equivalence for terminal skip/output cast. It does not prove full wrapper, cross-worker or cross-stack pixel equivalence. All nine old/new-stack image pairs were non-exact, with hardware, process and dependency confounds; broad style similarity is not artistic acceptance. This N06 matrix measures throughput, latency and lifecycle on the newer stack. Source images and output snapshots remain archived for visual review. No production defaults or UI were changed by this matrix.

Evidence: [compact full-precision JSON](metrics-compact-v1.json), [per-trial CSV](metrics-compact-v1.csv), [archived selection](selection-archived-v1.json), [original immutable selection](selection-v1.json), [archive-only verification](archive-only-validation.json), and [full archived audit](archived-reports/results-archived-v1.json.gz). The original 112 MB audit is preserved byte-for-byte in [the original-report archive](archived-browser-evidence/results-matrix-v1.json.gz). All four cohorts, including excluded qualifications, lifecycle raw events and JPEG snapshots, are in [archived-cohorts](archived-cohorts). [Protected input prefix proof](archived-browser-evidence/protected-input-prefix-proof.json) binds the appended interception suffix without altering prior input evidence. Remote preservation and pod shutdown are recorded separately by the root agent.
