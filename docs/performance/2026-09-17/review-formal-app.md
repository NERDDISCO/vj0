# Formal app WAN comparison audit

Status: complete_verified_formal_cohort. 18 trials retained, with both repeat orders preserved.

Within this one-GPU Torch 2.11/native-128-thread cohort only. Before-to-compute-capture combines capture scheduling, terminal compute skip and GPU output conversion changes. Latest-input changes admission/mailbox policy relative to that candidate. Sequential reversed-order repeats reduce one simple order confound but do not isolate features or remove WAN variation.

Each arm has two trials. Median is the midpoint of the two trial values; min/max retain their spread. No pooling, outlier removal or averaging percentile samples into a pooled percentile.

| Resolution | Arm | Input FPS median [range] | Receive FPS median [range] | Preview RAF FPS median [range] | Stage GL FPS median [range] |
|---|---|---:|---:|---:|---:|
| 512 | before | 34.74 [33.73, 35.75] | 26.87 [26.51, 27.24] | 25.97 [24.87, 27.07] | 26.84 [26.44, 27.24] |
| 512 | compute-capture | 50.93 [49.04, 52.83] | 39.17 [36.81, 41.53] | 33.44 [31.18, 35.70] | 38.93 [36.36, 41.49] |
| 512 | latest-input | 52.62 [48.24, 56.99] | 34.63 [30.76, 38.51] | 29.88 [26.18, 33.58] | 34.54 [30.56, 38.53] |
| 768 | before | 36.25 [35.85, 36.65] | 14.26 [14.14, 14.38] | 14.14 [14.14, 14.15] | 14.24 [14.14, 14.35] |
| 768 | compute-capture | 52.33 [49.78, 54.88] | 21.31 [21.27, 21.36] | 21.27 [21.22, 21.32] | 21.31 [21.27, 21.36] |
| 768 | latest-input | 49.94 [48.24, 51.63] | 20.77 [20.56, 20.98] | 20.69 [20.48, 20.89] | 20.77 [20.56, 20.98] |
| 1024 | before | 35.94 [35.81, 36.07] | 8.26 [8.23, 8.28] | 8.26 [8.23, 8.28] | 8.26 [8.23, 8.28] |
| 1024 | compute-capture | 56.30 [55.47, 57.12] | 12.11 [12.08, 12.13] | 12.11 [12.08, 12.13] | 12.11 [12.08, 12.13] |
| 1024 | latest-input | 54.85 [53.46, 56.23] | 12.03 [12.00, 12.06] | 12.02 [11.98, 12.06] | 12.03 [12.00, 12.06] |

compute-capture versus before: stage FPS increased in 6/6 matched pairs; stage p95 age decreased in 5/6, and p99 age decreased in 5/6. These count observed directions, not statistically established effects.

latest-input versus compute-capture: stage FPS increased in 1/6 matched pairs; stage p95 age decreased in 5/6, and p99 age decreased in 3/6. These count observed directions, not statistically established effects.

| Resolution | Matched comparison | Stage FPS change %, repeat 0 / repeat 1 | Median [range] % |
|---|---|---:|---:|
| 512 | compute-capture versus before | 37.49 / 52.34 | 44.91 [37.49, 52.34] |
| 512 | latest-input versus compute-capture | 5.97 / -26.35 | -10.19 [-26.35, 5.97] |
| 768 | compute-capture versus before | 48.23 / 51.08 | 49.66 [48.23, 51.08] |
| 768 | latest-input versus compute-capture | -3.34 / -1.78 | -2.56 [-3.34, -1.78] |
| 1024 | compute-capture versus before | 47.43 / 45.94 | 46.69 [45.94, 47.43] |
| 1024 | latest-input versus compute-capture | -0.59 / -0.69 | -0.64 [-0.69, -0.59] |

Every trial tail is shown below. A higher FPS observation does not establish consistently fresher frames or a universal mailbox benefit.

| Trial | Receive p95 / p99 ms | Preview RAF p95 / p99 ms | Stage p95 / p99 / max ms | Stage >250 / >500 / >1000 ms % |
|---|---:|---:|---:|---:|
| before-512-r0 | 1021.1 / 1839.8 | 863.1 / 1717.3 | 1025.0 / 1844.1 / 1969.7 | 13.936 / 7.219 / 5.399 |
| before-512-r1 | 172.0 / 187.8 | 186.0 / 200.3 | 177.0 / 192.1 / 227.9 | 0.000 / 0.000 / 0.000 |
| compute-capture-512-r0 | 281.7 / 341.0 | 235.4 / 325.8 | 274.1 / 343.4 / 1237.1 | 5.748 / 0.456 / 0.365 |
| compute-capture-512-r1 | 125.6 / 142.4 | 143.8 / 158.2 | 129.1 / 146.2 / 360.0 | 0.160 / 0.000 / 0.000 |
| latest-input-512-r0 | 145.3 / 309.8 | 159.4 / 319.9 | 147.9 / 313.4 / 415.9 | 1.724 / 0.000 / 0.000 |
| latest-input-512-r1 | 2071.0 / 2387.9 | 2070.4 / 2410.2 | 2074.9 / 2395.7 / 3008.1 | 37.914 / 28.463 / 19.718 |
| before-768-r0 | 329.4 / 404.6 | 313.2 / 400.1 | 328.2 / 403.7 / 545.8 | 81.040 / 0.231 / 0.000 |
| before-768-r1 | 286.8 / 293.0 | 302.5 / 314.8 | 292.2 / 302.0 / 381.1 | 90.728 / 0.000 / 0.000 |
| compute-capture-768-r0 | 208.4 / 225.0 | 231.8 / 251.3 | 212.2 / 229.2 / 409.9 | 0.780 / 0.000 / 0.000 |
| compute-capture-768-r1 | 201.9 / 219.4 | 222.1 / 240.5 | 207.5 / 223.8 / 229.1 | 0.000 / 0.000 / 0.000 |
| latest-input-768-r0 | 142.7 / 321.7 | 168.9 / 337.4 | 147.5 / 326.1 / 493.7 | 1.776 / 0.000 / 0.000 |
| latest-input-768-r1 | 147.0 / 193.6 | 168.2 / 211.6 | 153.0 / 197.5 / 260.5 | 0.237 / 0.000 / 0.000 |
| before-1024-r0 | 439.6 / 1345.3 | 455.6 / 1367.1 | 446.0 / 1351.7 / 1577.5 | 100.000 / 2.419 / 1.210 |
| before-1024-r1 | 435.8 / 442.5 | 452.0 / 456.8 | 443.4 / 448.4 / 476.4 | 100.000 / 0.000 / 0.000 |
| compute-capture-1024-r0 | 409.2 / 800.2 | 423.2 / 806.5 | 412.5 / 808.7 / 1116.3 | 100.000 / 4.104 / 0.684 |
| compute-capture-1024-r1 | 616.3 / 1082.2 | 632.7 / 1100.2 | 620.0 / 1093.3 / 1409.6 | 100.000 / 6.181 / 1.236 |
| latest-input-1024-r0 | 177.5 / 180.8 | 195.8 / 202.2 | 181.8 / 187.0 / 198.8 | 0.000 / 0.000 / 0.000 |
| latest-input-1024-r1 | 224.6 / 1404.6 | 241.7 / 1421.0 | 229.6 / 1419.0 / 1716.7 | 4.841 / 2.905 / 1.660 |

Retained high-age receive episodes:

- before-512-r0: 87 receipts above 1000 ms across 3 consecutive groups; peak 1963.3 ms at 50.246 seconds, frame 1719. No outlier was removed.
- compute-capture-512-r0: 8 receipts above 1000 ms across 1 consecutive groups; peak 1235.0 ms at 0.033 seconds, frame 103. No outlier was removed.
- latest-input-512-r1: 368 receipts above 1000 ms across 7 consecutive groups; peak 3001.7 ms at 40.459 seconds, frame 1877. No outlier was removed.
- before-1024-r0: 6 receipts above 1000 ms across 1 consecutive groups; peak 1574.4 ms at 41.338 seconds, frame 1652. No outlier was removed.
- compute-capture-1024-r0: 4 receipts above 1000 ms across 1 consecutive groups; peak 1110.7 ms at 17.643 seconds, frame 1240. No outlier was removed.
- compute-capture-1024-r1: 8 receipts above 1000 ms across 1 consecutive groups; peak 1406.1 ms at 38.011 seconds, frame 2354. No outlier was removed.
- latest-input-1024-r1: 12 receipts above 1000 ms across 1 consecutive groups; peak 1712.5 ms at 40.058 seconds, frame 2407. No outlier was removed.

Preview means the current loaded image observed during RAF; stage means a WebGL submission. Neither proves compositor or physical display presentation.

JPEG encode initiation to observed boundary, excluding audio acquisition and physical presentation.

Passing final freshness and at-most-2-second worker-stat arrival gaps does not impose a frame-age tail bound.

Inter-trial drain proves observed encoder and worker quiescence only, not that SCTP contains no queued JPEG. Client epochs and 40-frame warmup limit stale-session effects; these records do not establish cross-trial contamination.

Interrupted observations, startup failure, and later three-minute soaks remain separate; no failed or high-tail trial was replaced or folded into another cohort.

Runtime, source hashes, served build identities, worker IDs, source/capture ordering, audio levels and measurement arithmetic are bound to the saved independent audit. Provenance checks compare saved artifacts; they do not query live hosts.

The companion CSV contains all 72 trial/boundary rows, including frame counts, observed seconds, achieved rates, tails and final/maximum gaps.
