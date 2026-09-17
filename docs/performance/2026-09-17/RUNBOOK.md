# Resume the experiment loop

## Current next action

Checkpoint at 13:01 UTC, 2026-09-17. Continue the selected plan until every row
has a measured, failed, or concretely unsuitable outcome. Funding and warm paid
pods are authorized. No UI redesign, main deployment, or stable image overwrite.
Original snapshot `a10fdbe` is pushed; perf branch `perf/2026-09-live-bench` last
pushed checkpoint is `51315b3`; newer local commits also need the final push.

**Active Mac queues:**
- `/tmp/vj0-app-comparison-20260917`: eleven/twelve jobs started; the Next layout's
  six comparisons passed, legacy comparisons continue. Smoke4 passed.
- `/tmp/vj0-after-app-comparisons.py` (PID 80695) waits for all twelve measured
  app trials and closed tabs, then runs thirteen `browser-responsive-jobs.json`
  trials into `/tmp/vj0-browser-responsive-20260917`. Last trial restores JPEG80.
- `/tmp/vj0-finish-queues-20260917.py` (PID 96095) waits for those thirteen trials.
  It starts Pod A same-host tests and Pod B scaling in parallel on separate GPUs.
  Pod A then transitions to the five explicit TRT/native tests. Pod B runs
  eighteen scaling trials, twelve frame-aware buffer trials, transitions to the
  isolated Torch2.13 service, runs eighteen alternating within-stack live trials,
  then the actual-app ten-minute soak plus prompt/resolution/reconnect stress.
  Every transition stops on failed prerequisites; inspect any failure and resume
  deliberately. No additional Mac WAN or app client may overlap timed batches.

**Pod A** `0pxb4bss2jmbhg`, one PRO6000, $2.09 GPU/hour.
Current runner38454 `/workspace/trt-retry-20260917/sweep.json`, Node39977 on3001;
original Node499 paused. Current server SHA dbe212ac6fab113e4ec28fea64dc92d86303789be3d0a77a9265c233d63dd9b2.
All36 alternating live compute trials passed and are saved in browser-live-compute/.
Three entropy tests also passed in `/tmp/vj0-browser-entropy-20260917` (collect).
Same-host baseline runner `/workspace/livebench-20260917/samehost_runner.py`
will write `/workspace/samehost-results-20260917`; do not launch it via run_sweep,
which would pause the service it needs. The coordinator transitions afterward to
`/workspace/trt-explicit-20260917`, using `trt-explicit-jobs.json` and guarded
streamv2-explicit.py SHA eed04fbcd318bf7fcdc6007b6140f0998ba8d69ca781451460fb18045580ebd9.
Initial TRT requests failed because upstream parent Module.to bypassed decoder
initialization. The explicit retry includes matched FP16 parallel native controls,
RNG-isolated export builds, and real engine-cache guards. See STREAMDIFFUSION.md.
The final TRT service now has no automatic six-hour timeout; keep it warm.

**Pod B** `9vj8k6guaxsbhw`, two PRO6000 GPUs, $4.18 GPU/hour.
Runner48800 `/workspace/scaling-service-20260917/sweep.json`: both Torch2.13
confirmations and the late original control passed. Node60552 is warming two
workers on3001; original Node567 remains paused. Latest staged source hashes:
server5c1396ab0e1907b75a078a1ebdbfa0f0e29c75391b7c95c917ebdfaf48798179,
workerbdff1fa8918c2985a91a5c77b8b6d494cc24178a81b972cf77576f9b6a036b11.
`scaling-extended-source.jsonl` preserves prior and final identities.
Waiter58492 `/workspace/scaling-livebench-20260917/wait-telemetry-service.py`
waits for both workers' three-shape completion, then runs eight same-host
sync/async telemetry controls into `/workspace/telemetry-controlled-20260917`.
Its log is `/workspace/telemetry-service-waiter.log`. The Mac coordinator will
not begin scaling until all eight controls are measured. These loopback clients
can overlap Pod A WAN tests; they share neither GPU nor Mac network workload.
Latest samehost client SHA8a3d4ba25d04257d0c359fc38db785dcc2f76e8e68cd2e597b8569d2342a26f6.

The late original Torch2.11 control accidentally retained the new environment's
cache-directory settings. It therefore compiled fresh (~531s first shape).
Warm FPS remains valid; do not claim the long fresh-cache compile is unique to
Torch2.13. All12 dependency-retry jobs completed; collect their final JSONL and
environment files, including FA4, normalization, all-constants and profiling.

The future new-stack service uses the same generated dispatcher/worker but
WORKER_COUNT1 and the isolated venv's PATH plus its separate caches. Its manifest
will be `/workspace/torch213-live-service-20260917/sweep.json`. Current-stack
versus refreshed-stack WAN batches are sequential; within-stack baseline versus
combined is alternating. Preserve that distinction. The final app soak explicitly
uses the new-stack combined variant, pending3, JPEG80 and telemetry enabled.

**Actual app:** production builds18766 candidate source4a02d2f and18767 baseline
7139e0f. Main/stage targets and persistent CDP requests are listed in `/tmp/vj0-*
cdp.json` and init-v2/focus/metrics request files. Main1440x900, stage1920x1080,
DPR1, focus emulation enabled. Stage source512x288 has actual GL buffer2048x1152.
Both init-v2 sessions and focus/viewport sessions are held for four hours; verify
that they are still attached before the final soak. Inactive headless tabs pause
RAF. Do not substitute screenshot dimensions for canvas dimensions.

Smoke1 proxy-UA failure, smoke2 viewport failure, smoke3 invalid RAF observation
are preserved. Smoke4 fixed probe passed: received/projector27.106FPS, p95stage
177.410ms. The observation is unique WebGL submission/current loaded image at RAF,
not compositor/physical presentation. No extra JPEG subscriber or UI change.

Still required after queues: collect all raw results and quality samples; inspect
TRT success/failure and repair concrete compatibility problems; record screenshots
and a short flow video outside timed work; regenerate summaries; rewrite final
RESULTS/DEPENDENCIES/STREAMDIFFUSION status; independent final review; commit/push.
No speculative performance default is promoted. Keep both task pods warm and
refresh account balance/hourly spend at completion. Five unrelated old pods stay
stopped. API system/container logs worked before SSH; serverless logs untested.

## Tool and infrastructure checks

```bash
runpodctl version
runpodctl user
runpodctl gpu list --include-unavailable
runpodctl pod list --all
```

Current verified CLI: `2.14.0-dd55bcf`. Read `pod create --help` before provisioning.
The installed CLI's GraphQL create path uses only the first `--data-center-ids`
entry, even though the flag accepts comma-separated input. Choose one location
explicitly and move to a different location only after a concrete capacity error.

Use the pinned image digest from PLAN.md, a unique `vj0-perf-*` pod name, 1 PRO
6000 GPU initially (2 if available), EU-RO-1 preferred, 80 GB container disk and
120 GB pod volume mounted at `/workspace`. No existing network volumes currently
remain in this account. Ports: `3000/http,3001/http,22/tcp,10000/udp,10001/udp,10002/udp`.

Supply the existing public SSH key from `~/.runpod/ssh/RunPod-Key-Go.pub` as
`PUBLIC_KEY`; never place the private key in environment or logs. Override
`WARMUP_SHAPES=512x288,768x448,1024x576` initially; later shapes can be added and
warmed outside measurements. The user authorized paid test pods and keeping the
active test machine warm during the experiment series.

Use `--wait` for SSH readiness in a background CLI process. A concurrent
`pod list --name <unique-name>` can retrieve the ID for API log observation while
SSH is still starting. A timeout can leave a billed resource: inspect the returned
ID / pod list before attempting another create. Save sanitized pod identity,
price, source/image hashes, and timestamps to RESULTS.md.

## Verify logs before using SSH

```bash
runpodctl pod logs POD_ID --tail 50 --source system
runpodctl pod logs POD_ID --tail 50 --source container
runpodctl pod logs POD_ID --tail 0 --follow
runpodctl ssh info POD_ID
```

The first three use the API, not SSH. Save actual JSONL output with timestamps.
If no lines arrive, record whether the pod has started; a timeout by itself does
not establish that logging is unsupported. The stopped pre-existing pod probe
returned a timeout with no lines, but the new running pod verified system and container logging successfully.

`serverless logs ENDPOINT_ID` similarly reads workers' API logs. Existing
serverless endpoints are unrelated and configured with zero max workers; leave
them alone. A dedicated minimal log-emitting test endpoint may be used after the
pod baseline if required to verify serverless logs. Do not present CLI help as a
successful live worker-log test.

## Freeze the baseline

Once SSH is available, copy `/app/server.js`, `/app/inference_server.py`, the
package metadata, pip freeze and relevant nonsecret environment values into a
baseline artifact directory. Preserve source SHA-256 values. Fetch only the
specific known configuration keys; never dump all environment variables.

1. Wait for all selected shapes to finish compile, not just first `ready`.
2. Run the unmodified app to verify a real generated image reaches this Mac.
3. Run raw WebRTC streaming and single-flight harnesses before patching worker
   code. Record browser/OS and network path; the browser harness's offscreen draw
   is not the app's projector renderer.
4. For compute-only runs, stop the dispatcher/worker pool in a controlled way
   that prevents its auto-respawn from competing for the GPU. Do not merely kill
   one Python process (server.js will restart it). Restore the baseline service
   after the compute sweep. Verify processes and GPU utilization before timing.
5. Import the preserved original worker in `bench/compute.py`. Use distinct run
   directories for each configuration. Retain logs because FP8 can fall back.

## Iterate

For each PLAN.md row: record pending -> running -> measured/failed/not-applicable,
the exact command/configuration, and artifact paths. Run the next applicable
experiment. Pin dependency refreshes in separate environments and retain the
working baseline. Do not benchmark variants concurrently on the same GPU.

When a candidate appears faster, repeat alternating baseline/candidate trials,
inspect waveform A/B/blank and fixed-seed samples, and only then combine wins.
Update RESULTS.md and commit raw summaries regularly. The final report must
distinguish generated FPS, browser decoded/drawn FPS and actual app display FPS.

## Completion criteria

- Baseline and every selected experiment have terminal, evidenced outcomes.
- Winning combinations repeat, preserve input influence, and pass the soak.
- Unsupported experiments have specific reasons, not invented results.
- Independent review checks arithmetic, experiment identity, and pending gaps.
- Commit/push the report and reviewable implementation branch; do not overwrite
  the stable image tag or main branch before review.
- State exactly which test resources remain running and their hourly cost.
- Provide tweet-ready log/API conclusions limited to what actually worked.
