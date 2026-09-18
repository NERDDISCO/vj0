# Performance experiments — 2026-09-18

All five approved experiment groups are complete. Two GPUs increased measured
throughput, especially at the larger resolutions, but the matrix and ten-minute
hold failed continuity. The input, FP8 kernel, VAE and selective NVFP4 candidates
did not qualify for adoption. Results below are measurements, not deployed
defaults. Both test pods are verified stopped; code, raw evidence and caches
have been preserved. No UI or production-default changes were made.

| Experiment | Measured result | Decision |
|---|---|---|
| N01: capture 40/30 instead of 60 | All six resolution/cap comparisons failed the declared latency, FPS or pulse-preservation gates | Keep capture target 60 |
| N02: admission 64/16 KiB instead of 256 KiB | Median gains did not survive continuity and matched-pulse checks; 64 KiB includes a 2.52-second arrival gap | Keep 256 KiB; no larger-resolution expansion |
| N03: same-precision FP8 kernel candidates | First shape: 1.58% shorter compiled-call interval, below the 2% gate; second: 4.86% longer | No full-frame expansion |
| N04: VAE channels-last / conv1x1-as-matmul | Both changed encoded latents and final pixels in all three tested phases | Exact-output gate failed; no timing expansion |
| N05: selective NVFP4 | Median paired full-frame gains of 0.25–1.38%, with visible image changes | No promotion recommended |
| N06: newer-stack, one/two-GPU app | Two/one-worker median paired stage FPS gains of 17.7%, 63.0% and 91.4%; 35/36 matrix windows passed, hold failed continuity, lifecycle passed | Throughput gains measured; no overall stability pass |

## Actual-app results

N06 measured unique frames received, previewed and submitted to the stage,
with three alternating matched repeats per configuration. A stage submission
is not a measurement of physical display presentation. Both workers stayed
loaded on the same two-GPU pod; the dispatcher activated one or two for the
comparison. The selected arm uses the existing compute bundle plus terminal-zero
prediction skip and GPU output cast. It includes no newly rejected N01–N05
candidate. These are median stage FPS; paired gains are calculated per repeat
before taking the median, rather than dividing the displayed medians.

| Generated resolution | Baseline, one GPU | Selected, one GPU | Selected, two GPUs | Selected two/one median paired gain |
|---|---:|---:|---:|---:|
| 512 × 288 | 28.39 | 38.98 | 45.90 | +17.7% |
| 768 × 448 | 15.21 | 22.34 | 36.55 | +63.0% |
| 1024 × 576 | 8.68 | 12.39 | 23.61 | +91.4% |

The final 1024 two-GPU selected window failed the predeclared per-worker
continuity requirement. Its 18.72 FPS remains included; it had worker gaps of
2.08/3.49 seconds, a stage-wide gap of 1.97 seconds and maximum source age of
7.12 seconds. The complete 600.541-second 768 two-GPU hold averaged 36.35 FPS,
but also failed continuity: stage-wide gap 2.006 seconds, source-age p95
162.4 ms, p99 767.5 ms and maximum 4.14 seconds. Good median FPS does not
remove these failures. This is not a clean stability pass or evidence that
two GPUs caused the stalls; their cause remains unresolved.

The separate planned lifecycle test passed three prompt changes, all three
resolutions, ten rapid prompts and three reconnects. Reconnect-to-new-capture
receive took 11.19–11.27 seconds, distinct from steady-state frame age. Safe
ordered drain and cleanup passed after every cohort. No N06 setup attempts or
timed windows were rerun. The failed hold remains separate from the lifecycle
pass. [Full app results](scaling/RESULTS.md) include all baseline/two-worker
cells, ranges, latency tails, pulse lineage and archive reproduction.

The previous cohort reached 38.93 / 21.31 / 12.11 stage FPS at 512 × 288,
768 × 448 and 1024 × 576 respectively. Those are historical observations, not
matched controls for this run's different physical hardware and dependencies.

## Completed compute and quality proof

On Pod C's isolated Torch 2.13 / CUDA 13.2 environment, the production compute
probe passed 27 within-process terminal-skip/output-cast quality cases and 54
same-tensor cast checks. Its 18 timing cells contain 100 frames each:

| Resolution | Baseline median compute FPS | Optimized median compute FPS | Median paired gain |
|---|---:|---:|---:|
| 512 × 288 | 32.09 | 45.52 | +41.71% |
| 768 × 448 | 15.57 | 22.04 | +40.98% |
| 1024 × 576 | 9.12 | 13.04 | +42.45% |

These are JPEG decode → generation → JPEG encode timings, with CUDA completion;
they exclude IPC, network and browser presentation. The gains describe the
terminal-skip/output-cast comparison within this run, not an isolated Torch
upgrade benefit. Paired gains are computed before taking the median, so they
need not equal the ratio of the two displayed arm medians.

All nine paired old/new-stack static images differed in pixels. Independent
native-resolution review found similar broad composition and phase response,
with local color, edge and detail differences. Different physical GPUs,
dependencies, processes and compilation-cache histories prevent attributing
these differences to Torch alone. Separate-process FP8 controls also varied in
N05. The proof does not establish cross-stack pixel or temporal equivalence,
nor directly test the full live constant-cache/event-timing wrapper. CUDA
profiling was deliberately skipped in this production proof.

## Input findings

The capture target was 60, while actual sending in the selected N01/N02 controls
was roughly 42–54 FPS. Archived `toBlob` callback intervals had medians around
7.6–12 ms and p95 around 21.1–28.1 ms; 10–35% exceeded a 60 Hz frame's 16.67 ms
budget. Those intervals include scheduling/readback/encoding, and pending
encoding also covers later buffer conversion and sending. They do not isolate
JPEG CPU time.

Sending faster than inference can still make the latest input fresher and give
brief audio changes more chances to reach a generated frame. Lower capture caps
therefore need direct pulse and latency testing. All six cap comparisons failed
the declared combination of gates, even when their sending rate remained above
generation FPS. For admission limits, a favorable median was insufficient:
16 KiB lost timely pulses in a matched pair; 64 KiB failed output continuity.

WebRTC carried the measured traffic, but setup and delivery were not uniformly
reliable: three N01/N02 setup attempts failed and were preserved. A later browser
offer failed without a POST response or an ICE-connected state; its cause is
unresolved. Some output-age tails reached seconds while input continued and
worker durations stayed short. This N01/N02 observation is consistent with delay
outside inference, but does not locate the responsible transport segment or
establish the cause of N06's separate failures. N06 connected all planned
cohorts and passed the three intentional reconnects; its delivery gaps and
long source-age tails remain failures despite those successful connections.

## Quality and precision

N04 failed an exact-output requirement; that alone does not establish worse
artistic quality. Its candidates were not timed after failing the quality gate.
N05 separately tested five or ten image feed-forward projections using the
original BF16 weights quantized to NVFP4, with native Blackwell kernel proof.
Its layer speedups of 1.43–1.76× became only 0.25–1.38% median paired full-frame
gains. All 108 candidate images changed, and representative dark scenes showed
visible brightness, color and detail changes. The additional speed does not
justify recommending those precision changes under the requested appearance
constraint. Human artistic approval has not been supplied or implied.

## Evidence and reproducibility

- [Input results](input/RESULTS.md): 48 selected 60-second windows, every failed setup, pulse checks, source-age tails and archive-only reproduction.
- [FP8/VAE results](compute/RESULTS.md): native kernel proof, paired microtimings, failed setup and exact intermediate/image comparisons.
- [NVFP4 results](nvfp4/MODEL-RESULTS.md): all model cases, native profiles, timings, static/temporal review and failed attempts.
- [N06 plan](scaling/PLAN.md) and [browser runbook](scaling/BROWSER-RUNBOOK.md): frozen settings, all 36 cells, hold and lifecycle protocol.
- [N06 results](scaling/RESULTS.md) and [archive instructions](scaling/ARCHIVE.md): measured throughput, continuity failures, lifecycle and byte-for-byte reproduction with original raw paths unavailable.
- [Independent production review](scaling/review-production-result.json): proof scope, quality checks, all timing cells and cross-stack visual review.
- [Operations](operations/) and [run state](RUN-STATE.json): allocation, guards, dependencies, commits, preservation and shutdown evidence.

Measurements follow base commit `5004163` on `perf/2026-09-live-bench`.
Input, compute and NVFP4 checkpoints are pushed as `f63f927`, `74e4751` and
`b30fad4`. Failed or gate-rejected candidates are retained; they are not rerun
to select better outcomes. Historical evidence under `2026-09-17` is unchanged.

Both pods used image digest
`689e0f1cbcc8053727da3539080312fa3645d01649daf2106472679b768ce490`.
Pod A has one RTX PRO 6000 Blackwell GPU at $2.09/hour and was verified stopped
at 09:47 UTC after saving results and its 2.914 GB compilation cache. Pod C has
two such GPUs at $4.18/hour while running. Native Torch
threads remain 128; CPU quotas are 31.125 and 62.25 cores respectively.
Pod C was verified stopped at **11:53:53 UTC** after its final source/log
download and verified 6.504 GB cache archive. The initial worker-release check
briefly still saw a zombie PID in the GPU driver's process list; a separate
read-only verification confirmed no live group members or GPU contexts. Both
records are retained. The stop guard cancelled only after actual stopped state
was observed. The older unused Pod B also remains stopped.

Runpod reported **$8.2752 remaining at 11:54:11 UTC**, with account spend
**$0.122/hour** after shutdown. Persistent disks remain; stopping is not deletion
and does not eliminate storage charges. [Final infrastructure verification](operations/final-infrastructure.json)
records the observed states and balance. All GPU work is complete; subsequent
review and reporting use local archives.
