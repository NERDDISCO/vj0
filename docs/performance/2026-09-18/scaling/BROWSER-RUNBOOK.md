# N06 browser execution handoff

Prepared against commit `74e4751a7d34f06ba740a2eb1fb762072559414c`.
The browser targets remain blank. No N06 connection or capture has started.
See [readiness checks](browser-readiness.json) and the unchanged [plan](PLAN.md).

## Prerequisites and ownership

The coordinating agent must release the exclusive GPU slot after the Pod C
production proof, cross-stack quality review and live-worker warmup. Do not
start an app connection while N05, production proof or heavy compilation runs.
Both loaded workers must be ready, pending counts zero, compile state zero,
and all three correct shapes warmed: 512 × 288, 768 × 448, 1024 × 576.
Baseline and selected paths need warmup on both workers. The frozen harness
then independently checks each requested active worker's telemetry before
starting each measured interval.

The control remains 60 requested FPS, 256 KiB admission, latest-input mailbox,
native 128 threads, two steps, alpha 0.1, seed 42, JPEG85 input and JPEG80 output.
No N01/N02, N03 or N04 candidate is combined. The hold is unchanged.
The selected bundle and two-worker scaling are separate paired comparisons;
their percentages must not be added.

Keep these owned services running: Next on 18768, HeadlessChrome 149 on CDP
18779, and target setup PID 73222. Do not rebuild `.next` or restart the target
setup. Its two pinned admission rewrites and the exact frozen v5 probe must
remain the same throughout the matrix, hold and lifecycle test. Do not touch
unrelated Chrome, Cube/Kale, OBS or macOS display settings.
The [owned process inventory](owned-local-resources.json) records root PIDs,
current descendants and exact argv, including Next listener PID 57535 and the
owned caffeinate PID 58068. Recheck argv before eventual cleanup to avoid PID
reuse; no owned service should be stopped during preparation.

Expected exclusive measurement time is about 50 minutes for 36 one-minute
windows plus setup/drains, then 10 minutes for the hold and approximately
3 minutes for lifecycle actions. Remote proof/warmup, failures, bounded recovery
and offline evidence archiving are additional. Root owns pod stop guards and
must provide sufficient time before granting the slot.

## Protected input evidence

[Input log prefixes](input-log-prefixes.json) record the complete committed
input interception log's byte boundary and SHA-256 before future appends.
Existing input bytes must remain identical. New N06 interception lines may
append after that boundary. The error log did not exist; any new interception
error blocks measurement and must be preserved. The completed input passive
connection log is immutable and must not be reused.

The new passive log path is deliberately not pre-created because the logger
refuses overwrite. After slot release, start it in its own process:

```sh
node workers/runpod-flux2klein/bench/input_20260918/connection_logger.mjs \
  docs/performance/2026-09-18/input/browser-targets-v6-headless149/main.json \
  docs/performance/2026-09-18/scaling/passive-connections-n06.jsonl
```

The logger records only connection setup, then pauses on DataChannel OPEN
before capture starts. It resumes on the next `/vj-next` navigation. Stop only
its own PID from `passive-connections-n06.jsonl.ready` after the final cleanup;
retain the browser and setup process until root finishes all browser work.

## Excluded qualification before the matrix

After the slot grant and idle baseline warmup, run the same harness with
`--jobs docs/performance/2026-09-18/scaling/jobs-qualification-prepared.json`
and a new `--output docs/performance/2026-09-18/scaling/qualification-01`.
The six eight-second cells keep both workers active across three shapes and
baseline/selected variants, at 60 requested FPS without controlled impulses.
They are explicitly excluded from N06 performance comparisons and from the
36-cell selection. The ordinary frozen warmup gates check both workers,
native 128 threads, exact size, variant and CPU/GPU output cast.

All six configurations must qualify before any formal timed cell starts.
A selected-path compile can exceed the frozen 120-second warmup wait. Preserve
that failed qualification and its cleanup state; do not lengthen the harness
wait or call it a performance result. After root confirms compilation finished,
perform a verified drain and a bounded qualification continuation in a new
output root. See [qualification plan](qualification-plan.json). Allow about
three additional minutes if all six configurations are already warm.

## Matrix invocation

The full ordered 36-job plan is [jobs-v2.json](jobs-v2.json). The immutable
[initial selection](selection-v1.json) assigns every cell to the new `matrix-01`
root before outcomes exist. Relative roots in this selection resolve beside
the selection file. Existing output directories must never be overwritten.

```sh
python3 -u docs/performance/2026-09-18/input/frozen-harness-v5/app_batch.py \
  --main-target docs/performance/2026-09-18/input/browser-targets-v6-headless149/main.json \
  --stage-target docs/performance/2026-09-18/input/browser-targets-v6-headless149/stage.json \
  --fixture docs/performance/2026-09-18/input/fixture.json \
  --jobs docs/performance/2026-09-18/scaling/jobs-v2.json \
  --output docs/performance/2026-09-18/scaling/matrix-01 \
  > docs/performance/2026-09-18/scaling/matrix-01.log 2>&1
```

Preserve per-trial progress as written. Poll small progress records and report
every few trials; do not run profiling, heavy offline aggregation or archive
compression alongside measured browser windows. Verify the first actual worker
shape and requested active pool before accepting timing. Never infer achieved
input FPS from the requested 60 FPS value.

## Failures and continuation

The frozen harness stops on a failed window and always attempts ordered drain
and blank-page cleanup. A complete continuity-only negative remains a measured
outcome; never rerun or replace it. After verifying its source/settings/order,
ordered ACK and cleanup, continue only the unrun declared cells in a new output
root. It remains descriptive and blocks eligibility.

For connection or structural failures, stop and retain the exact progress,
network/console evidence, raw artifacts and cleanup state for root's bounded
diagnosis. An absent summary alone does not prove that timing never began.
Only a confirmed untimed setup failure may be attempted again after diagnosis;
all original failed attempts remain in the chronological cohort list. No
protocol, harness or server changes may be silently mixed into the same matrix.

Create a new immutable selection version for every continuation. Keep the full
original ordered 36 jobs, map each completed cell to its original root, map only
untimed/unrun cells to the new root, and list every chronological attempt in
`cohort_roots`, including roots that produced no valid window. Exact job configs,
fixture and harness/probe hashes must match. The aggregator rejects replacing
an existing timed outcome or hiding a failed attempt.

After capture stops, aggregate outside all raw roots:

```sh
python3 workers/runpod-flux2klein/bench/n06_aggregate.py \
  --selection docs/performance/2026-09-18/scaling/selection-v1.json \
  --output docs/performance/2026-09-18/scaling/results-matrix-v1.json
```

Use the latest immutable selection if a continuation exists. Exit 1 can mean
retained negative continuity/setup outcomes; keep its report and failure gates.
It does not authorize dropping evidence or rerunning cells until they pass.
The reporter calculates paired repeat ratios before medians and never applies
the N01 admission-promotion thresholds as a scaling acceptance rule.

## Hold and lifecycle

After the matrix and verified drain, invoke the same harness with
`--jobs docs/performance/2026-09-18/scaling/jobs-hold-prepared.json`, a new
`--output docs/performance/2026-09-18/scaling/hold-01`, and a separate log.
This is the unchanged 600-second 768 × 448 selected/two-worker hold. Its normal
success path then runs the existing three prompt changes, all three resolutions,
ten rapid prompts and three disconnect/reconnect cycles. Lifecycle intervals
are excluded from the preceding steady-state FPS result.

If a complete negative hold prevents the frozen harness from reaching lifecycle
actions, retain the hold and do not repeat it. After its drain is verified and
structural issues are ruled out, use the predeclared
[lifecycle contingency](jobs-lifecycle-contingency.json) in a new output root.
Its eight-second qualification is excluded from throughput comparisons and
cannot repair the failed hold. Preserve lifecycle failures too.

After all browser work, verify protected input prefixes, freeze the new logger,
archive raw evidence with byte hashes, and reproduce reports with redundant raw
paths unavailable. Root handles service termination, artifact backup and pod
shutdown. No production UI/default changes or deployment are part of this run.
