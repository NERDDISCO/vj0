# Resume the experiment loop

## Current next action

Checkpoint at 12:04 UTC, 2026-09-17. Continue the selected plan through measured,
failed, or concretely unsuitable outcomes; the user has authorized funded tests
and keeping these resources warm. Do not create replacement pods unnecessarily.
No UI redesign, main-branch deployment, or stable image overwrite is authorized.

The original snapshot is pushed on `snapshot/pre-performance-2026-09-17`.
The experiment branch is `perf/2026-09-live-bench` (last pushed checkpoint
`51315b3` before the updates below). Original-image compute, 30 WebRTC discovery
trials, 24 wrtc 0.10 trials plus a clean replacement, extended compute, and the
original-environment Stream model/decoder/step/resolution/paced tests are saved.
The old quota/interrupted-install failures are preserved separately.

**Pod A:** `0pxb4bss2jmbhg`, one PRO 6000, $2.09/GPU-hour.
Current runner 38454: `/workspace/trt-retry-20260917/sweep.json`.
Node 39977 serves `https://0pxb4bss2jmbhg-3001.proxy.runpod.net`; original Node
499 is paused. All three shapes warmed. Dispatcher SHA
`dbe212ac6fab113e4ec28fea64dc92d86303789be3d0a77a9265c233d63dd9b2`.
The 36 alternating live trials are running in
`/tmp/vj0-browser-live-compute-20260917`, browser session `vj0-perf-20260917`.
A local follow-up waits for all 36 valid results, then runs the entropy batch,
app smoke4, and twelve app comparisons. It stops explicitly on failure.
No other client or GPU job may overlap these Pod A timed trials.

TRT imports now pass. The initial acceleration requests failed because upstream
parent `Module.to()` bypasses decoder initialization, leaving a silent native
fallback. The guarded explicit-wrapper retry is staged but **not started**:
`/workspace/livebench-20260917/trt-explicit-jobs.json`, output will be
`/workspace/trt-explicit-20260917`. Its harness is
`streamv2-explicit.py`, SHA
`eed04fbcd318bf7fcdc6007b6140f0998ba8d69ca781451460fb18045580ebd9`.
Run it only after Pod A live/app/same-host clients finish. It includes matched
FP16 parallel native controls, RNG-isolated builds, and engine-cache identity.
See STREAMDIFFUSION.md for quota recovery and the 14B checkpoint re-download note.

**Pod B:** `9vj8k6guaxsbhw`, two PRO 6000 GPUs, $4.18/GPU-hour.
Runner 28890: `/workspace/dependency-retry-20260917/sweep.json`.
GPU 0 runs serial tests; GPU 1 is idle. Original Node 567 is paused.
Torch 2.13 baseline and combined tests passed, followed by normalization/cache
and attention profiling. FA4 installed and its kernel correctness check passed;
full-pipeline FA4 tests are underway. Waiter 31190 then runs
`scaling-service-jobs.json`: three late compute confirmations, isolated wrtc
installation, and a two-worker service. Its future manifest is
`/workspace/scaling-service-20260917/sweep.json`. After both workers warm,
run the eighteen `browser-scaling-jobs.json` trials. These compare one/two active
GPUs with both models loaded, not differently priced allocations.

**Actual app:** production builds are on 18766 (candidate app source 4a02d2f)
and 18767 (7139e0f baseline). Both tabs need persistent CDP probe, focus, and
viewport overrides: main 1440x900, stage 1920x1080, DPR 1. At source 512x288,
the real stage GL buffer is 2048x1152. Do not confuse viewport and GL dimensions.
Run setup keeps both tabs visible; an inactive headless tab otherwise pauses RAF.
The proxy rejects Python's default HTTP User-Agent; the harness sets an explicit
browser-compatible benchmark User-Agent for the control request.

Smoke1 failed that proxy request. Smoke2 failed viewport verification. Smoke3
received/submitted 28.56 FPS to stage with real analyser RMS around 0.14, but was
invalid because preview RAF measurement omitted revoked-yet-loaded image URLs.
That probe omission is reproduced/fixed with CPU controls; smoke3 stays invalid.
Updated init requests `/tmp/vj0-app-init-v2.json` and
`/tmp/vj0-stage-init-v2.json` are attached. Smoke4 must pass before the twelve
comparisons. The final ten-minute soak and prompt/resolution/reconnect stress
remain required. Screenshots/video must be outside timed measurements.

Remaining after queued work: same-host transport, multi-GPU scaling, the matched
TRT retry, the final combination/soak, raw-data review, complete result tables,
independent review, and final branch push. Keep model changes isolated; do not
promote an option based on one trial. Preserve failed attempts and exact labels.
Current spend last observed at 10:46 UTC was $6.331/hour including storage;
balance $93.62. Refresh at completion. Five unrelated old pods remain stopped.

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
