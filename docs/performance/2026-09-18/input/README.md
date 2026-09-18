# N01/N02 input-admission experiments

Status: all 48 selected input windows are complete at 512 × 288, 768 × 448,
and 1024 × 576. No candidate is promoted. See [final results](RESULTS.md),
[512 details](RESULTS-512.md), [archived 512 report](results-512-archived.json),
[archived 768 report](results-768x448-archived.json),
[archived 1024 report](results-1024x576-archived.json), and
[offline encode timing](encode-duration-archived.json). All original failures
and explicit selections remain preserved.

The control is corrected capture cadence, native 128 CPU threads, terminal skip
and GPU output cast, one active worker, and latest-input mailbox enabled. Only
requested capture rate or browser admission bytes changes. Model, decoder,
precision, two steps, alpha 0.1, seed 42, input JPEG85, output JPEG80, render
cadence, server outbound buffering and visual design remain fixed.

[Predeclared 512 jobs](jobs-screen-512.json) contain four comparisons, each with
three alternating-order 60-second pairs: 60 vs 40 FPS, 60 vs 30 FPS, 256 vs 64 KiB,
and 256 vs 16 KiB. Actual sent/received/preview/stage FPS and age tails are measured.
Capture caps were also tested at both larger resolutions. The 16 KiB expansion
and ten-minute holds were not triggered because preservation/promotion gates
failed; unaccepted candidates are not combined.

The isolated CDP setup rewrites exactly two fixed admission arguments in each
compiled app chunk: before encode and immediately before send. It calls the
original transport `canSend` with the selected threshold. It does not alter
image bytes or transport reliability. Original and delivered chunk bytes/hashes
are preserved in the browser-target directory. Both control and candidate use
the same instrumentation. Threshold semantics permit one newly admitted JPEG
to exceed the threshold; this is not a projected-total-byte cap.

The new [source helpers](../../../../workers/runpod-flux2klein/bench/input_20260918/)
generate a dated derivative of the existing app harness. Historical evidence and
production source/defaults are unchanged. `frozen-harness-v5` includes the current
harness and fresh per-pulse analyser checks. `browser-targets-v6-headless149`
uses that exact probe in Chrome149 headless. Earlier directories
were preparatory/excluded smoke only; v2 preflight caught
an appended-script separator error, fixed before v3. The GPU server was frozen by the
coordinating agent under [frozen-server](frozen-server/).

Between trials, capture stops, observed encoders and worker activity become idle,
and an ordered in-band barrier is sent on the existing reliable channel. The
server acknowledges only after prior inputs are received, workers/compilation/
mailbox/bootstrap work has drained, and its outgoing buffer is empty. The ordered
ACK reaches the browser after earlier output messages. Fresh browser buffers and
server snapshots are retained alongside the acknowledgement. This is stronger
than inferring network drain from a 500 ms quiet period alone. It does not assert
that a physical monitor finished presenting every earlier image.

Each timed run includes repeated 40 ms and 100 ms oscillator bursts, with exact
planned/actual onset and off timestamps. The probe records analyser RMS on each
call and capture-time RMS, source IDs, and stage delivery. The impulse analysis
uses a fixed input RMS threshold of 0.25 and allows the analyser to retain the
burst for 250 ms after gain-off. It reports admitted pulse frames, input analyser
peaks, first returned/stage response, and unobserved responses within the measured
window. Those are temporal capture/delivery checks, not a perceptual claim about
the artistic strength of the generated beat.

Promotion gates from the prior plan: at least 95% of control stage FPS, at least
10% lower median-trial p95 age, and no more than 10% worse median-trial p99 age.
Source-order/settings/connection failures disqualify a cohort; all output gaps,
missing impulse responses and failures remain in the artifacts. No candidate is
promoted automatically from scalar metrics alone.

Owned local services: Next on 18768 and isolated headless Chrome149 CDP on 18779. They will
remain available for the coordinating agent's subsequent scaling trial. GPU
resource ownership and shutdown remain with the coordinating agent.

## Browser cadence qualification

The first excluded eight-second app smoke in headed Chrome153 admitted only
29.46 FPS. A local 2×2 rAF plus 512×288 JPEG85 check, with two reversed-order
repeats, found 30.000 Hz in both headed Chrome149 and153 and 60.003 Hz in both
headless versions. This isolates a headed/headless distinction, not a Chrome153
regression or an instrumentation-induced 30 FPS cap. The coordinating agent's
[read-only display evidence](display-cadence-evidence.json) reports the main
display at 30 Hz, consistent with the headed cadence; macOS display settings
were not changed. A display-coupled rAF loop can limit real input FPS regardless
of the requested rate or GPU capacity. Formal trials use headless149 to match
the previous app cohort and permit distinct 60/40/30 capture treatments.

[Complete local qualification](browser-2x2-final.json),
[owned149 launch identity](browser149-direct-identity.json), and
[excluded headed smoke](excluded-smoke-v5/) are preserved separately. Two earlier
local qualification attempts remain explicitly incomplete/excluded because the
own agent-browser launcher restarted its browser, invalidating the cached CDP
websocket. The final browser uses a direct, stable process. Local cadence tests
are not WAN/GPU throughput results or physical-display presentation measurements.

The replacement [headless149 eight-second app smoke](excluded-smoke-headless149/)
passed source-order, fixed-worker/compute, controlled-pulse, ordered barrier and
cleanup checks, with Metal Apple M4 rendering. Analyser median interval was
16.7 ms (502 samples), confirming the 30 Hz ceiling was removed. It admitted
41.13 FPS and submitted 36.72 stage FPS, with JPEG encode p50 12.1 ms and p95
25.94 ms. These short smoke figures are excluded from performance comparisons.
They still fall below the previous 50–56 FPS admission range; the formal rate
comparison must report actual treatment separation rather than assume a
requested 60 FPS is reached. Background system work and the simultaneously
excluded remote qualification have not yet been isolated in this smoke.

The coordinating agent identified two other active Chrome149 rendering sessions
as unrelated Cube/Kale work. They are left running; OBS and other user processes
are also untouched. Local CPU/GPU load is therefore not a dedicated-machine
benchmark. Alternating paired controls and reported achieved input rates limit
the interpretation; no result assumes that configured60 FPS means60 admitted
frames/s. Thresholds with zero admission rejection are explicitly nonbinding
in the observed link conditions.

The original scalar impulse gate used median counts, which concealed an extra
missed 16 KiB pulse. The corrected reporter uses pooled counts and checks each
matched pair. The original [selection](selection-512-v1.json) is retained, and
the earlier `results-512.json` is explicitly superseded by the archived decision
report. No 16 KiB expansion is authorized after this temporal gate failure.

A preparation error requested 768 × 432 instead of the existing, prewarmed
768 × 448 resolution. It triggered an excluded warmup compile and no timed
result. Capture was stopped; its failed original drain remains recorded.
See [shape correction](768-shape-correction.json). Corrected higher-resolution
jobs use 768 × 448 and 1024 × 576, with capture caps only.

Final archive-only validation moved seven redundant raw cohort directories to a
task-specific `/tmp` backup after checking every original and compressed byte
hash. With those raw paths unavailable, all three archived reports and the
encode report reproduced identical complete JSON objects. See
[validation record and backup paths](archive-only-validation.json). Unarchived
failure evidence, frozen sources and browser targets remain in place.
