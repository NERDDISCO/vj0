N06 audit: **complete-with-failed-outcomes**. {'passed': 35, 'continuity-failed': 1}

Eligibility: blocked by retained failures or incomplete evidence. Failed attempts retained: 0.

Selected versus baseline is a configuration bundle: terminal-noop, CUDA-event stage timing and GPU output cast versus baseline, wall-clock timing and CPU output cast. It does not isolate the terminal skip.

One versus two means active GPU workers on the same two-GPU host with both models loaded. This is not a comparison of separately provisioned hosts.

Trials run sequentially. Matched repeat ratios reduce some drift but do not establish causality independently of transport/browser variation. The declared sequence has two forward repeats and one reverse repeat.

FPS counts unique source IDs over the observed common main/stage interval. Stage age is capture encode start to WebGL submission, not physical display presentation. Preview RAF is a distinct browser boundary.

A cell percentile is the median/range of three per-trial percentiles, not a pooled percentile. Pair ratios are calculated within repeat before their median/range. All raw tails and failed trials remain in the report.

Impulse metadata/RMS tests delivery of a captured input, not perceptual beat strength or model prompt correctness. Impulse coverage is reported separately; N01 admission-promotion thresholds are not applied to N06.

Source hashes bind the recorded harness identity to supplied frozen sources; they are not an independent attestation of remote runtime/GPU packages. Server snapshots bracket, rather than exactly equal, the client interval.

Complete windows that fail only continuity remain in descriptive statistics and always fail eligibility. Structural, configuration, source-order or missing-window failures are not valid measured cells. Separate unsuccessful connection/setup attempts remain visible and fail the lifecycle gate.

Cell values are medians across three complete repeats.

| Resolution | Active workers | Bundle | Status | Stage FPS median [min, max] | Age p50 / p95 / p99 / max (ms) |
|---|---:|---|---|---|---|
| 512×288 | 1 | baseline | complete | 28.394 [28.289, 28.676] | 101.600 / 130.530 / 148.230 / 279.800 |
| 512×288 | 1 | selected bundle | complete | 38.983 [37.559, 39.655] | 83.400 / 110.455 / 152.870 / 264.500 |
| 512×288 | 2 | baseline | complete | 43.750 [38.875, 48.253] | 85.300 / 131.100 / 159.600 / 260.900 |
| 512×288 | 2 | selected bundle | complete | 45.896 [41.617, 51.401] | 67.200 / 95.550 / 111.250 / 239.200 |
| 768×448 | 1 | baseline | complete | 15.205 [15.155, 15.225] | 139.600 / 165.720 / 197.392 / 259.700 |
| 768×448 | 1 | selected bundle | complete | 22.336 [21.494, 22.424] | 114.250 / 154.010 / 177.335 / 299.900 |
| 768×448 | 2 | baseline | complete | 28.273 [27.261, 28.654] | 143.600 / 177.265 / 214.053 / 360.600 |
| 768×448 | 2 | selected bundle | complete | 36.551 [35.526, 37.478] | 116.000 / 152.700 / 308.750 / 471.600 |
| 1024×576 | 1 | baseline | complete | 8.680 [8.630, 8.683] | 187.250 / 226.700 / 246.200 / 265.700 |
| 1024×576 | 1 | selected bundle | complete | 12.388 [12.335, 12.487] | 159.600 / 187.005 / 225.383 / 358.900 |
| 1024×576 | 2 | baseline | complete | 17.218 [17.181, 17.363] | 199.300 / 241.515 / 276.101 / 377.300 |
| 1024×576 | 2 | selected bundle | descriptive-with-failed-outcomes | 23.606 [18.717, 24.337] | 163.500 / 211.200 / 329.788 / 486.100 |

| Resolution | Matched comparison | Status | FPS ratio median [min, max] | Age delta p50 / p95 / p99 / max (ms) |
|---|---|---|---|---|
| 512×288 | selected bundle / baseline at 1 active worker(s) | complete | 1.373 [1.328, 1.383] | -15.800 / -16.250 / -19.740 / -16.800 |
| 512×288 | selected bundle / baseline at 2 active worker(s) | complete | 1.071 [0.951, 1.175] | -19.600 / -24.300 / -29.772 / -21.700 |
| 512×288 | 2 / 1 active GPU workers within selected bundle | complete | 1.177 [1.049, 1.369] | -16.200 / -17.165 / -44.872 / -104.600 |
| 768×448 | selected bundle / baseline at 1 active worker(s) | complete | 1.469 [1.418, 1.473] | -25.150 / -9.590 / -15.418 / 40.200 |
| 768×448 | selected bundle / baseline at 2 active worker(s) | complete | 1.326 [1.240, 1.341] | -28.400 / -35.075 / -47.914 / -61.700 |
| 768×448 | 2 / 1 active GPU workers within selected bundle | complete | 1.630 [1.590, 1.744] | 4.100 / 5.765 / 131.415 / 171.700 |
| 1024×576 | selected bundle / baseline at 1 active worker(s) | complete | 1.429 [1.427, 1.438] | -26.800 / -31.050 / -30.196 / 37.600 |
| 1024×576 | selected bundle / baseline at 2 active worker(s) | descriptive-with-failed-outcomes | 1.371 [1.078, 1.416] | -35.800 / -30.640 / 50.408 / 74.800 |
| 1024×576 | 2 / 1 active GPU workers within selected bundle | descriptive-with-failed-outcomes | 1.914 [1.511, 1.949] | 3.900 / 8.955 / 6.338 / 92.600 |

Every declared trial, including failures:

| Trial | Status | Input FPS | Stage FPS | Age p50 / p95 / p99 / max (ms) | Stage >250 / 500 / 1000 ms (%) | Max stage gap (ms) |
|---|---|---:|---:|---|---|---:|
| n06-512-workers1-baseline-r0 | passed | 43.129 | 28.289 | 106.000 / 135.700 / 174.155 / 281.300 | 0.117 / 0.000 / 0.000 | 181.200 |
| n06-512-workers1-terminal-noop-r0 | passed | 42.506 | 37.559 | 80.900 / 110.455 / 152.870 / 264.500 | 0.044 / 0.000 / 0.000 | 160.900 |
| n06-512-workers2-baseline-r0 | passed | 49.460 | 43.750 | 85.300 / 135.180 / 197.248 / 280.400 | 0.151 / 0.000 / 0.000 | 209.700 |
| n06-512-workers2-terminal-noop-r0 | passed | 51.650 | 51.401 | 64.700 / 93.290 / 107.998 / 159.900 | 0.000 / 0.000 / 0.000 | 91.600 |
| n06-768-workers1-baseline-r0 | passed | 47.487 | 15.155 | 143.500 / 187.520 / 226.686 / 361.400 | 0.656 / 0.000 / 0.000 | 216.900 |
| n06-768-workers1-terminal-noop-r0 | passed | 40.671 | 21.494 | 140.800 / 622.260 / 925.534 / 1200.700 | 12.163 / 6.467 / 0.693 | 523.800 |
| n06-768-workers2-baseline-r0 | passed | 42.128 | 28.273 | 143.600 / 177.265 / 214.053 / 308.100 | 0.703 / 0.000 / 0.000 | 189.100 |
| n06-768-workers2-terminal-noop-r0 | passed | 44.089 | 37.478 | 109.300 / 142.190 / 166.139 / 246.400 | 0.000 / 0.000 / 0.000 | 124.600 |
| n06-1024-workers1-baseline-r0 | passed | 54.114 | 8.630 | 191.200 / 226.700 / 246.200 / 265.700 | 0.768 / 0.000 / 0.000 | 145.600 |
| n06-1024-workers1-terminal-noop-r0 | passed | 50.037 | 12.335 | 164.400 / 211.740 / 359.000 / 494.400 | 3.490 / 0.000 / 0.000 | 293.500 |
| n06-1024-workers2-baseline-r0 | passed | 44.130 | 17.218 | 199.600 / 241.840 / 279.380 / 411.300 | 3.176 / 0.000 / 0.000 | 184.700 |
| n06-1024-workers2-terminal-noop-r0 | passed | 43.898 | 23.606 | 162.400 / 211.200 / 329.788 / 486.100 | 2.737 / 0.000 / 0.000 | 294.200 |
| n06-512-workers2-terminal-noop-r1 | passed | 46.294 | 45.896 | 67.200 / 95.550 / 111.250 / 357.500 | 0.144 / 0.000 / 0.000 | 188.800 |
| n06-512-workers2-baseline-r1 | passed | 52.111 | 48.253 | 79.450 / 115.640 / 141.022 / 205.500 | 0.000 / 0.000 / 0.000 | 98.500 |
| n06-512-workers1-terminal-noop-r1 | passed | 47.773 | 38.983 | 85.800 / 263.020 / 411.438 / 611.000 | 5.435 / 0.594 / 0.000 | 459.900 |
| n06-512-workers1-baseline-r1 | passed | 43.179 | 28.394 | 101.600 / 130.530 / 148.230 / 279.800 | 0.058 / 0.000 / 0.000 | 205.500 |
| n06-768-workers2-terminal-noop-r1 | passed | 39.267 | 35.526 | 122.100 / 1189.250 / 1363.575 / 1408.700 | 16.869 / 15.377 / 11.976 | 141.000 |
| n06-768-workers2-baseline-r1 | passed | 43.693 | 28.654 | 142.600 / 175.055 / 195.997 / 360.600 | 0.231 / 0.000 / 0.000 | 204.400 |
| n06-768-workers1-terminal-noop-r1 | passed | 47.871 | 22.336 | 114.250 / 154.010 / 175.753 / 242.100 | 0.000 / 0.000 / 0.000 | 117.800 |
| n06-768-workers1-baseline-r1 | passed | 52.921 | 15.205 | 139.400 / 163.600 / 191.171 / 226.600 | 0.000 / 0.000 / 0.000 | 103.700 |
| n06-1024-workers2-terminal-noop-r1 | passed | 44.581 | 24.337 | 163.500 / 195.960 / 214.920 / 395.700 | 0.272 / 0.000 / 0.000 | 212.700 |
| n06-1024-workers2-baseline-r1 | passed | 43.285 | 17.181 | 199.300 / 241.515 / 276.101 / 377.300 | 2.312 / 0.000 / 0.000 | 229.100 |
| n06-1024-workers1-terminal-noop-r1 | passed | 52.447 | 12.487 | 159.600 / 187.005 / 208.582 / 303.100 | 0.133 / 0.000 / 0.000 | 144.600 |
| n06-1024-workers1-baseline-r1 | passed | 55.065 | 8.680 | 180.500 / 218.055 / 241.451 / 265.500 | 0.382 / 0.000 / 0.000 | 148.400 |
| n06-512-workers1-baseline-r2 | passed | 51.885 | 28.676 | 96.600 / 125.250 / 144.840 / 210.200 | 0.000 / 0.000 / 0.000 | 112.400 |
| n06-512-workers1-terminal-noop-r2 | passed | 45.469 | 39.655 | 83.400 / 109.000 / 125.100 / 183.100 | 0.000 / 0.000 / 0.000 | 97.400 |
| n06-512-workers2-baseline-r2 | passed | 40.579 | 38.875 | 95.900 / 131.100 / 159.600 / 260.900 | 0.043 / 0.000 / 0.000 | 146.600 |
| n06-512-workers2-terminal-noop-r2 | passed | 41.898 | 41.617 | 76.300 / 106.800 / 132.704 / 239.200 | 0.000 / 0.000 / 0.000 | 127.100 |
| n06-768-workers1-baseline-r2 | passed | 51.259 | 15.225 | 139.600 / 165.720 / 197.392 / 259.700 | 0.109 / 0.000 / 0.000 | 164.600 |
| n06-768-workers1-terminal-noop-r2 | passed | 50.661 | 22.424 | 111.900 / 146.935 / 177.335 / 299.900 | 0.222 / 0.000 / 0.000 | 169.600 |
| n06-768-workers2-baseline-r2 | passed | 45.612 | 27.261 | 144.400 / 283.925 / 1205.525 / 2580.400 | 6.804 / 2.734 / 1.701 | 1840.900 |
| n06-768-workers2-terminal-noop-r2 | passed | 40.850 | 36.551 | 116.000 / 152.700 / 308.750 / 471.600 | 1.221 / 0.000 / 0.000 | 150.300 |
| n06-1024-workers1-baseline-r2 | passed | 50.208 | 8.683 | 187.250 / 235.170 / 255.579 / 358.900 | 1.718 / 0.000 / 0.000 | 237.400 |
| n06-1024-workers1-terminal-noop-r2 | passed | 53.195 | 12.388 | 158.700 / 186.165 / 225.383 / 358.900 | 0.401 / 0.000 / 0.000 | 202.800 |
| n06-1024-workers2-baseline-r2 | passed | 52.686 | 17.363 | 191.100 / 229.900 / 246.777 / 320.200 | 0.763 / 0.000 / 0.000 | 148.500 |
| n06-1024-workers2-terminal-noop-r2 | continuity-failed | 33.228 | 18.717 | 173.850 / 2743.750 / 5676.179 / 7122.100 | 29.027 / 25.841 / 16.637 | 1970.900 |

Validation findings:

- n06-1024-workers2-terminal-noop-r2: Worker 0: arrival gap over 2 seconds; Worker 1: arrival gap over 2 seconds
