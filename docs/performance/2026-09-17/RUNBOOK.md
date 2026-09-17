# Resume the experiment loop

Checkpoint 13:32 UTC. Latest active recovery coordinator PID12509, exec31307:
`/tmp/vj0-finish-queues-idle-fixed-20260917.py`. It waits for both workers in
`/workspace/scaling-idle-fixed-service-20260917/scaling-service.log` to finish
3/3 shapes plus local `/tmp/vj0-benchmark-io-complete`, then runs all18 scaling
trials into `/tmp/vj0-browser-scaling-idle-fixed-20260917`, 12 frame buffers,
new-stack warmup, 27 new-stack live trials, and 600s actual-app768 soak+stress.
Previous coordinator1155 exited after intentional cancellation of scaling.
Seven measured initial trials plus one failure are preserved under
browser-scaling-before-idle-fix/. GPU1 resumed after88s idle and the watchdog
incorrectly counted that as processing stall. Fixed dispatcher starts deadline
on0→1 pending transition. Eight CPU lifecycle/frame-ID checks and independent
source review pass; complete GPU rerun remains required.

Pod B original Node567 paused; runner64223 current recovery manifest above.
Corrected generated server path `server-idle-fixed.js`, SHA
9fd289c7e339c3496582daeb2a92d615f9db39c0df3a4aa68fa83f98ce6b8c03.
Future Torch2.13 service jobs now select this same corrected server.
Original generated server retained unchanged for historical identity.

Pod A original Node499 paused; runner45986 now executes
`/workspace/trt-parser-path-20260917/sweep.json`. Explicit wrapper tests exposed
upstream ONNX parser omission of the model path for external weights. Isolated
harness SHA bce7f8edeb43b5407788da895cbbc1b59a62dc5cd44823801c619fae2474605f
patches only that path argument in-process, preserving the upstream checkout.
Native control and real TRT engine trial have passed; remaining fast/noise tests
are running, then indefinite Klein service. Real TRT first trial builds3shapes
(~33s total); warm~22FPS versus matching native~20.3FPS. Collect terminal records,
engine hashes, samples and verify quality before closing.

All16 samehost trials collected, plus13 responsive trials. COMPUTE appendix
contains85cells/255repeats. New compute quality contact sheet inspected; local
texture differences are visible and samples are not bit-identical across processes.
No dependency/queue/JPEG default promoted. Final report/review/push still required.

The retained instructions below contain earlier process IDs; use the checkpoint
above for current processes.

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

Latest account check13:08UTC: balance$78.3258, total spend$6.331/hour. A transient
503 from the account endpoint cleared on retry; benchmark services were unaffected.
