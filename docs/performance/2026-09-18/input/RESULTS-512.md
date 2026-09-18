# 512 × 288 input experiments

No input change is promoted. Reducing the browser buffer threshold to 16 KiB
improved measured latency, but lost an additional controlled audio pulse. Lower
capture caps reduced output FPS; 64 KiB retained a failed continuity trial.

Each comparison contains three predeclared, alternating-order pairs of 60-second
windows. Values below are medians of the three trial values per role, except
pulse responses, which are pooled across all 57 planned pulses. Controls are
separate paired cohorts, so their performance differs.

| Change from 60 FPS / 256 KiB | Stage FPS, control → candidate | p95 age, ms | p99 age, ms | Pulse responses within 1 s | Outcome |
| --- | ---: | ---: | ---: | ---: | --- |
| Capture cap 40 FPS | 37.98 → 36.11 | 108.6 → 114.5 | 125.7 → 229.6 | 51/57 → 57/57 | No latency benefit; worse p99 |
| Capture cap 30 FPS | 39.38 → 29.30 | 107.0 → 102.5 | 126.0 → 129.8 | 57/57 → 56/57 | Output FPS and temporal gates fail |
| Admission threshold 64 KiB | 36.08 → 37.97 | 116.0 → 111.5 | 136.4 → 131.9 | 57/57 → 55/57 | Continuity and temporal gates fail |
| Admission threshold 16 KiB | 36.45 → 37.31 | 260.8 → 112.6 | 463.5 → 142.8 | 56/57 → 55/57 | Temporal preservation fails |

Stage FPS counts unique actual WebGL frame submissions. Age starts at capture
JPEG encode and ends at that submission; it excludes audio acquisition and
physical monitor presentation. Model, native 128 threads, terminal skip, GPU
output cast, mailbox policy, one active worker, JPEG quality and visual settings
are fixed. Only requested capture rate or the existing browser admission
threshold changes. These trials do not establish perceptual image equivalence
between different frame selections.

The 16 KiB comparison recorded 418 admission rejections versus 34 in its paired
controls. Its final candidate trial did not capture two planned pulses; one
control trial missed one pulse. Median per-trial response counts were 19 versus
19 and initially concealed this loss. The authoritative reporter now requires
pooled and matched-pair temporal preservation. Independent review confirmed
55/57 versus 56/57 directly from pulse records. One additional miss in this small
cohort does not prove a causal regression, but it does not satisfy the original
preservation requirement, so 16 KiB is not expanded or enabled.

The 64 KiB failed trial remains included in descriptive numbers and blocks
promotion. It had a 2,522 ms receive gap while the client sent 149 input frames;
recorded worker processing stayed below 75 ms. A separate 256 KiB control had a
1,346 ms gap while sending 43 frames. These records support a delivery backlog
outside measured inference; they do not identify the exact network segment.
See [outlier diagnostics](outlier-diagnostics.json). No failed outcome was rerun
until it passed.

Two new-channel setup attempts timed out before measurement. Server cleanup was
healthy; a bounded browser diagnostic then connected unchanged, with OPTIONS
and POST returning 200. The original cause remains unknown. The first partial
30 FPS cohort remains archived and excluded from the complete replacement
cohort. See [connection failures](connection-failure-record.json). Later passive
connection logging records failures and responses only before channel-open,
then pauses before timed capture.

Use [archived results](results-512-archived.json) and
[explicit archived selection](selection-512-archived.json) for reproduction.
The [original selection](selection-512-v1.json) retains recovery provenance and
all original planned trial identities. Every compressed source has an original
byte hash and archive hash in its cohort's `archive.json`; decompression was
verified byte-for-byte. Archived reproduction returns the same numbers and
promotion decisions. [Frozen measurement sources](frozen-harness-v5/sources.json)
and [server hashes](frozen-server/hashes.json) are retained. The earlier
`results-512.json` is a superseded scalar report whose impulse gate was too weak.

The local machine also runs unrelated user workloads. Pure rAF/JPEG tests found
30 Hz in both headed Chrome versions and 60 Hz in both headless versions; the
main macOS display is configured at 30 Hz. Formal trials use the prior
HeadlessChrome 149 and Metal Apple M4 renderer. Actual admitted FPS is reported
in the JSON; a configured 60 FPS is not assumed to produce 60 frames/s.
