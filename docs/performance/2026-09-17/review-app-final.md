# Independent saved app audit

Status: complete_passed. Completed summaries: 18 of 18 planned.

Unique receipts, current loaded image at RAF, and stage GL submissions divided by observed common frozen wall time. Neither RAF nor GL submission is physical display presentation. Age starts at JPEG encode initiation, excluding audio acquisition. All outliers remain included.

Steady gates check source order, dimensions, requested worker config, audio, channel/compile errors, freshness and worker-stat arrival gaps no greater than 2 seconds. Passed continuity is not an age-percentile or maximum-age guarantee.

| Trial | Audit | Seconds | Input FPS | Receive FPS | Preview RAF FPS | Stage GL FPS |
|---|---|---:|---:|---:|---:|---:|
| before-512-r0 | passed | 60.240 | 33.732 | 26.510 | 24.867 | 26.444 |
| compute-capture-512-r0 | passed | 60.290 | 52.828 | 36.806 | 31.183 | 36.358 |
| latest-input-512-r0 | passed | 60.217 | 56.994 | 38.511 | 33.579 | 38.528 |
| before-768-r0 | passed | 60.275 | 36.649 | 14.384 | 14.135 | 14.351 |
| compute-capture-768-r0 | passed | 60.265 | 49.780 | 21.273 | 21.223 | 21.273 |
| latest-input-768-r0 | passed | 60.255 | 48.245 | 20.563 | 20.480 | 20.563 |
| before-1024-r0 | passed | 60.259 | 35.812 | 8.231 | 8.231 | 8.231 |
| compute-capture-1024-r0 | passed | 60.239 | 57.122 | 12.135 | 12.135 | 12.135 |
| latest-input-1024-r0 | passed | 60.266 | 56.234 | 12.063 | 12.063 | 12.063 |
| latest-input-512-r1 | passed | 60.245 | 48.237 | 30.758 | 26.177 | 30.559 |
| compute-capture-512-r1 | passed | 60.276 | 49.041 | 41.526 | 35.702 | 41.492 |
| before-512-r1 | passed | 60.248 | 35.752 | 27.237 | 27.071 | 27.237 |
| latest-input-768-r1 | passed | 60.257 | 51.629 | 20.977 | 20.894 | 20.977 |
| compute-capture-768-r1 | passed | 60.403 | 54.881 | 21.356 | 21.323 | 21.356 |
| before-768-r1 | passed | 60.272 | 35.854 | 14.136 | 14.152 | 14.136 |
| latest-input-1024-r1 | passed | 60.250 | 53.461 | 12.000 | 11.983 | 12.000 |
| compute-capture-1024-r1 | passed | 60.245 | 55.473 | 12.084 | 12.084 | 12.084 |
| before-1024-r1 | passed | 60.267 | 36.073 | 8.280 | 8.280 | 8.280 |

| Trial / boundary | Age p50 / p95 / p99 / max ms | Age >250 / >500 / >1000 ms % | Max arrival gap ms |
|---|---|---|---:|
| before-512-r0 / main/preview-image-raf | 149.8 / 863.1 / 1717.3 / 1949.8 | 12.550 / 6.275 / 4.406 | 1465.5 |
| before-512-r0 / main/received | 134.5 / 1021.1 / 1839.8 / 1963.3 | 14.026 / 7.326 / 5.448 | 1459.1 |
| before-512-r0 / stage/webgl-frame-submitted | 140.8 / 1025.0 / 1844.1 / 1969.7 | 13.936 / 7.219 / 5.399 | 1463.2 |
| compute-capture-512-r0 / main/preview-image-raf | 126.9 / 235.4 / 325.8 / 1240.7 | 4.096 / 0.426 / 0.319 | 214.4 |
| compute-capture-512-r0 / main/received | 112.6 / 281.7 / 341.0 / 1235.0 | 6.580 / 0.451 / 0.361 | 198.5 |
| compute-capture-512-r0 / stage/webgl-frame-submitted | 115.3 / 274.1 / 343.4 / 1237.1 | 5.748 / 0.456 / 0.365 | 222.1 |
| latest-input-512-r0 / main/preview-image-raf | 89.9 / 159.4 / 319.9 / 428.4 | 1.879 / 0.000 / 0.000 | 189.4 |
| latest-input-512-r0 / main/received | 78.1 / 145.3 / 309.8 / 413.2 | 1.725 / 0.000 / 0.000 | 180.4 |
| latest-input-512-r0 / stage/webgl-frame-submitted | 81.1 / 147.9 / 313.4 / 415.9 | 1.724 / 0.000 / 0.000 | 184.1 |
| before-768-r0 / main/preview-image-raf | 271.1 / 313.2 / 400.1 / 466.1 | 92.606 / 0.000 / 0.000 | 227.0 |
| before-768-r0 / main/received | 258.4 / 329.4 / 404.6 / 531.7 | 72.549 / 0.231 / 0.000 | 231.7 |
| before-768-r0 / stage/webgl-frame-submitted | 262.9 / 328.2 / 403.7 / 545.8 | 81.040 / 0.231 / 0.000 | 233.1 |
| compute-capture-768-r0 / main/preview-image-raf | 210.6 / 231.8 / 251.3 / 404.2 | 1.173 / 0.000 / 0.000 | 200.8 |
| compute-capture-768-r0 / main/received | 189.9 / 208.4 / 225.0 / 404.9 | 0.780 / 0.000 / 0.000 | 202.0 |
| compute-capture-768-r0 / stage/webgl-frame-submitted | 193.8 / 212.2 / 229.2 / 409.9 | 0.780 / 0.000 / 0.000 | 203.6 |
| latest-input-768-r0 / main/preview-image-raf | 136.3 / 168.9 / 337.4 / 492.7 | 1.702 / 0.000 / 0.000 | 247.5 |
| latest-input-768-r0 / main/received | 119.4 / 142.7 / 321.7 / 488.8 | 1.776 / 0.000 / 0.000 | 249.3 |
| latest-input-768-r0 / stage/webgl-frame-submitted | 125.0 / 147.5 / 326.1 / 493.7 | 1.776 / 0.000 / 0.000 | 250.7 |
| before-1024-r0 / main/preview-image-raf | 423.4 / 455.6 / 1367.1 / 1586.7 | 100.000 / 3.226 / 1.210 | 680.8 |
| before-1024-r0 / main/received | 409.9 / 439.6 / 1345.3 / 1574.4 | 100.000 / 2.218 / 1.210 | 684.6 |
| before-1024-r0 / stage/webgl-frame-submitted | 415.1 / 446.0 / 1351.7 / 1577.5 | 100.000 / 2.419 / 1.210 | 684.5 |
| compute-capture-1024-r0 / main/preview-image-raf | 313.8 / 423.2 / 806.5 / 1118.4 | 100.000 / 4.378 / 0.684 | 167.8 |
| compute-capture-1024-r0 / main/received | 296.2 / 409.2 / 800.2 / 1110.7 | 100.000 / 4.104 / 0.547 | 164.5 |
| compute-capture-1024-r0 / stage/webgl-frame-submitted | 301.1 / 412.5 / 808.7 / 1116.3 | 100.000 / 4.104 / 0.684 | 168.6 |
| latest-input-1024-r0 / main/preview-image-raf | 174.2 / 195.8 / 202.2 / 209.3 | 0.000 / 0.000 / 0.000 | 112.3 |
| latest-input-1024-r0 / main/received | 155.2 / 177.5 / 180.8 / 189.2 | 0.000 / 0.000 / 0.000 | 96.6 |
| latest-input-1024-r0 / stage/webgl-frame-submitted | 159.6 / 181.8 / 187.0 / 198.8 | 0.000 / 0.000 / 0.000 | 98.0 |
| latest-input-512-r1 / main/preview-image-raf | 135.7 / 2070.4 / 2410.2 / 3017.1 | 37.920 / 27.077 / 18.263 | 1445.0 |
| latest-input-512-r1 / main/received | 122.0 / 2071.0 / 2387.9 / 3001.7 | 37.453 / 28.548 / 19.860 | 1451.1 |
| latest-input-512-r1 / stage/webgl-frame-submitted | 125.1 / 2074.9 / 2395.7 / 3008.1 | 37.914 / 28.463 / 19.718 | 1450.4 |
| compute-capture-512-r1 / main/preview-image-raf | 114.0 / 143.8 / 158.2 / 311.5 | 0.232 / 0.000 / 0.000 | 191.0 |
| compute-capture-512-r1 / main/received | 96.7 / 125.6 / 142.4 / 355.7 | 0.160 / 0.000 / 0.000 | 185.0 |
| compute-capture-512-r1 / stage/webgl-frame-submitted | 101.7 / 129.1 / 146.2 / 360.0 | 0.160 / 0.000 / 0.000 | 184.7 |
| before-512-r1 / main/preview-image-raf | 150.1 / 186.0 / 200.3 / 234.0 | 0.000 / 0.000 / 0.000 | 106.4 |
| before-512-r1 / main/received | 136.5 / 172.0 / 187.8 / 219.9 | 0.000 / 0.000 / 0.000 | 91.0 |
| before-512-r1 / stage/webgl-frame-submitted | 141.1 / 177.0 / 192.1 / 227.9 | 0.000 / 0.000 / 0.000 | 92.9 |
| latest-input-768-r1 / main/preview-image-raf | 132.9 / 168.2 / 211.6 / 281.9 | 0.397 / 0.000 / 0.000 | 104.2 |
| latest-input-768-r1 / main/received | 112.7 / 147.0 / 193.6 / 256.6 | 0.079 / 0.000 / 0.000 | 124.7 |
| latest-input-768-r1 / stage/webgl-frame-submitted | 115.9 / 153.0 / 197.5 / 260.5 | 0.237 / 0.000 / 0.000 | 106.9 |
| compute-capture-768-r1 / main/preview-image-raf | 205.4 / 222.1 / 240.5 / 258.7 | 0.233 / 0.000 / 0.000 | 101.5 |
| compute-capture-768-r1 / main/received | 187.3 / 201.9 / 219.4 / 223.0 | 0.000 / 0.000 / 0.000 | 80.3 |
| compute-capture-768-r1 / stage/webgl-frame-submitted | 191.0 / 207.5 / 223.8 / 229.1 | 0.000 / 0.000 / 0.000 | 79.8 |
| before-768-r1 / main/preview-image-raf | 280.7 / 302.5 / 314.8 / 396.0 | 96.131 / 0.000 / 0.000 | 119.3 |
| before-768-r1 / main/received | 262.4 / 286.8 / 293.0 / 375.6 | 83.099 / 0.000 / 0.000 | 116.1 |
| before-768-r1 / stage/webgl-frame-submitted | 268.7 / 292.2 / 302.0 / 381.1 | 90.728 / 0.000 / 0.000 | 118.1 |
| latest-input-1024-r1 / main/preview-image-raf | 172.6 / 241.7 / 1421.0 / 1728.9 | 4.848 / 3.186 / 1.662 | 231.6 |
| latest-input-1024-r1 / main/received | 157.0 / 224.6 / 1404.6 / 1712.5 | 4.841 / 2.905 / 1.660 | 220.6 |
| latest-input-1024-r1 / stage/webgl-frame-submitted | 161.1 / 229.6 / 1419.0 / 1716.7 | 4.841 / 2.905 / 1.660 | 226.0 |
| compute-capture-1024-r1 / main/preview-image-raf | 319.6 / 632.7 / 1100.2 / 1425.2 | 100.000 / 6.456 / 1.236 | 144.5 |
| compute-capture-1024-r1 / main/received | 304.0 / 616.3 / 1082.2 / 1406.1 | 100.000 / 6.181 / 1.099 | 143.0 |
| compute-capture-1024-r1 / stage/webgl-frame-submitted | 308.8 / 620.0 / 1093.3 / 1409.6 | 100.000 / 6.181 / 1.236 | 141.8 |
| before-1024-r1 / main/preview-image-raf | 425.3 / 452.0 / 456.8 / 489.8 | 100.000 / 0.000 / 0.000 | 167.8 |
| before-1024-r1 / main/received | 411.7 / 435.8 / 442.5 / 473.3 | 100.000 / 0.000 / 0.000 | 169.3 |
| before-1024-r1 / stage/webgl-frame-submitted | 416.7 / 443.4 / 448.4 / 476.4 | 100.000 / 0.000 / 0.000 | 169.4 |

Sequential within-cohort comparisons, not simultaneous causal controls. Before versus compute-capture changes capture and compute together. Each report keeps its own manifest/cohort; separate soak runs are not additional repeats.

Planned reverse ordering: True. Completed valid counterbalance: True.

Episodes below are generated only from receipts above the configured age threshold in this cohort. Worker timing pairing is inferred from ordered binary/stat messages; server receive/send timestamps are unavailable.

- before-512-r0: 23 consecutive receipts above 1000 ms; peak frame 1225 aged 1193.0 ms at 35.361 s. Worker total p99/max: 41.2 / 42.0 ms; measured queue p99/max: 63.7 / 63.9 ms. Full capture/send/render context is retained in JSON.
- before-512-r0: 10 consecutive receipts above 1000 ms; peak frame 1508 aged 1160.1 ms at 43.476 s. Worker total p99/max: 40.3 / 40.7 ms; measured queue p99/max: 41.4 / 41.4 ms. Full capture/send/render context is retained in JSON.
- before-512-r0: 54 consecutive receipts above 1000 ms; peak frame 1719 aged 1963.3 ms at 50.246 s. Worker total p99/max: 38.2 / 39.1 ms; measured queue p99/max: 66.3 / 67.8 ms. Full capture/send/render context is retained in JSON.
- compute-capture-512-r0: 8 consecutive receipts above 1000 ms; peak frame 103 aged 1235.0 ms at 0.033 s. Worker total p99/max: 42.3 / 43.0 ms; measured queue p99/max: 51.8 / 51.8 ms. Full capture/send/render context is retained in JSON.
- before-1024-r0: 6 consecutive receipts above 1000 ms; peak frame 1652 aged 1574.4 ms at 41.338 s. Worker total p99/max: 122.1 / 122.2 ms; measured queue p99/max: 235.3 / 235.9 ms. Full capture/send/render context is retained in JSON.
- compute-capture-1024-r0: 4 consecutive receipts above 1000 ms; peak frame 1240 aged 1110.7 ms at 17.643 s. Worker total p99/max: 79.9 / 80.0 ms; measured queue p99/max: 162.2 / 162.4 ms. Full capture/send/render context is retained in JSON.
- latest-input-512-r1: 1 consecutive receipts above 1000 ms; peak frame 862 aged 1004.7 ms at 16.397 s. Worker total p99/max: 22.8 / 22.8 ms; measured queue p99/max: 0.0 / 0.0 ms. Full capture/send/render context is retained in JSON.
- latest-input-512-r1: 197 consecutive receipts above 1000 ms; peak frame 947 aged 2270.8 ms at 19.145 s. Worker total p99/max: 32.3 / 36.2 ms; measured queue p99/max: 0.0 / 0.1 ms. Full capture/send/render context is retained in JSON.
- latest-input-512-r1: 53 consecutive receipts above 1000 ms; peak frame 1251 aged 2857.5 ms at 26.065 s. Worker total p99/max: 41.1 / 48.8 ms; measured queue p99/max: 0.1 / 0.1 ms. Full capture/send/render context is retained in JSON.
- latest-input-512-r1: 16 consecutive receipts above 1000 ms; peak frame 1577 aged 1107.4 ms at 32.549 s. Worker total p99/max: 33.5 / 34.1 ms; measured queue p99/max: 0.0 / 0.0 ms. Full capture/send/render context is retained in JSON.
- latest-input-512-r1: 66 consecutive receipts above 1000 ms; peak frame 1877 aged 3001.7 ms at 40.459 s. Worker total p99/max: 39.3 / 40.0 ms; measured queue p99/max: 0.1 / 0.1 ms. Full capture/send/render context is retained in JSON.
- latest-input-512-r1: 34 consecutive receipts above 1000 ms; peak frame 2064 aged 1491.6 ms at 44.748 s. Worker total p99/max: 38.2 / 45.4 ms; measured queue p99/max: 0.1 / 0.1 ms. Full capture/send/render context is retained in JSON.
- latest-input-512-r1: 1 consecutive receipts above 1000 ms; peak frame 2782 aged 1004.7 ms at 57.244 s. Worker total p99/max: 29.5 / 29.5 ms; measured queue p99/max: 0.0 / 0.0 ms. Full capture/send/render context is retained in JSON.
- latest-input-1024-r1: 12 consecutive receipts above 1000 ms; peak frame 2407 aged 1712.5 ms at 40.058 s. Worker total p99/max: 84.5 / 84.5 ms; measured queue p99/max: 0.1 / 0.1 ms. Full capture/send/render context is retained in JSON.
- compute-capture-1024-r1: 8 consecutive receipts above 1000 ms; peak frame 2354 aged 1406.1 ms at 38.011 s. Worker total p99/max: 85.0 / 85.0 ms; measured queue p99/max: 163.4 / 163.6 ms. Full capture/send/render context is retained in JSON.

The app transport uses a default reliable ordered frames data channel and a 256 KiB canSend threshold. One admitted JPEG can raise bufferedAmount above that threshold. A server mailbox cannot evict bytes already queued in browser/SCTP. ACKs document effective admission per trial; exact loss causes or direction are not identified by these client logs.

Saved provenance: saved_provenance_checked.

