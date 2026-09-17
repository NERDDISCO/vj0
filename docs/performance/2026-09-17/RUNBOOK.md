# Resume the experiment loop

## Current next action

Funding was confirmed on 2026-09-17: approximately $100 available. The baseline
pod `0pxb4bss2jmbhg` was created in EU-CZ-1 at $2.09/hour (one RTX PRO 6000).
EU-RO-1 had no matching capacity. API system logs returned image-pull progress
before SSH was ready. Continue B00 on this existing pod; inspect its current
state before any new create. SSH and API container logs are verified. Original-image 512x288 WebRTC baselines
and four repeat runs are saved; the fifth repeat failed its drain check. All
three startup shapes compiled with main-thread warmup, but the original dispatcher
subsequently restarted workers with phantom pending work and during compilation.
Those early higher-resolution attempts were stopped; later candidate trials measured 14.03 FPS at 768x448 and 8.10 FPS at 1024x576.

The first seven-job compute sweep and the following 30-trial live discovery
batch are complete. Raw results are committed. The current service is wrtc
0.10.0 on port 3001, controlled by `/workspace/wrtc010-service-20260917/sweep.json`
(runner 26559, Node 26718 at launch). Original Node 499 remains paused while this
service runs. Always verify manifest/process identity before signaling anything.

The 24-trial `browser-wrtc010-jobs.json` comparison is running from the Mac.
`bench/after_browser.py` waits for every persisted result, runs the replacement
for the trial affected by a local build, then terminates this test service,
waits for process-group cleanup, and starts the 24 jobs in
`stream-extended-jobs.json`. Transition record:
`/tmp/vj0-stream-transition-20260917.json`. If any batch is incomplete/invalid,
this transition fails for inspection rather than starting competing GPU work.
The next GPU manifest will be `/workspace/stream-sweep-20260917/sweep.json`.

Second pod `9vj8k6guaxsbhw` has two PRO 6000 GPUs. GPU 0 is running the serial
extended compute jobs; GPU 1 is deliberately idle during these isolated trials.
Original Node 567 is paused. Manifest:
`/workspace/extended-compute-20260917/sweep.json` (runner 3037 at launch).
A waiting follow-up process starts `dependency-and-attention-jobs.json` after
that runner exits; remote job file is named `dependency-retry-jobs.json` and
output is `/workspace/dependency-retry-20260917`. The dependency retry, constant
cache/profile tests, and FA4 tests are serial and use separate environments.
Do not start scaling tests before this follow-up finishes.

Current spend observed at 10:46 UTC was $6.331/hour for the two test pods plus
storage; account balance was $93.62. Existing older pods remain stopped.
Keep the warm test resources per user authorization, and report their final
running state and refreshed spend. No new inference default is promoted.

Still required after these queues: inspect/fix concrete test failures, live
alternating compute variants, same-pod transport, 1-vs-2 worker scaling, real
app/stage measurements using the synthetic WebAudio fixture, 10-minute soak
with prompt/shape/reconnect changes, and independent final result review.
No UI design changes or stable image/main-branch updates are authorized here.

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
