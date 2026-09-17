# Completed performance experiment record

All selected timed tests are complete. Corrected app results and remaining
limits are in [RESULTS.md](RESULTS.md) and [APP.md](APP.md). The original snapshot
is pushed at a10fdbe; the isolated branch is perf/2026-09-live-bench. Source-order
correction checkpoint98dc346 is pushed. The final report and audit artifacts are
saved on the same branch. Main and the stable image tag were not overwritten.

## Retained running resources

- Pod B 9vj8k6guaxsbhw: two RTX PRO6000 GPUs, $4.18 GPU/hour, corrected ordered
  source delivery. Runner74772/server74775; workers74782/74783. Manifest
  /workspace/source-order-service-20260917/sweep.json; job source
  /workspace/source-order-20260917/jobs.json. Server URL
  https://9vj8k6guaxsbhw-3001.proxy.runpod.net. Both workers ready.
- Pod A 0pxb4bss2jmbhg: one RTX PRO6000, $2.09 GPU/hour, retained older baseline
  Klein service. Runner49372, /workspace/stream512-paced-20260917/sweep.json.
  Its service is healthy; it has not been switched to the newer source-order
  deployment. Original Node499 remains paused; B original Node567 is paused.
- Account quote at17:32UTC: $6.331/hour including storage, balance$50.36.
  Both pods intentionally remain running. Five unrelated pods remain stopped.

The final service snapshots and allowed runtime identities are checked into this
folder. The Python dispatcher/worker pair must be deployed together: missing
source_seq is explicitly rejected. Source hashes: server e4e2626116f517b6d6fcdad84c8dde31b6fb3dc14c97faa489a230116613518f;
worker cc9fb7a5f849a0308d9c6509e7d5ffe0ab0853cb29ec7487a0642082cbd647ac.
Environment: isolated Torch2.13/cu132/TorchAO0.18; pinned Diffusers/weights;
wrtc0.10.0; combined benchmark profile, JPEG80, pending3, two steps.

## Final artifacts and reproduction

- app-soak/ preserves the original measured ordering failure; do not replace it.
- app-source-order/ contains 60s512,60s1024,600s768+stress, eight lossless gzip
  frame logs and their original SHA256 values. The fixed source-order assertion
  checks received, main RAF and stage source IDs; the independent audit also
  checks reconstructed capture timestamps.
- app-source-order-jobs.json supplies the final live configs. app_batch.py requires
  two owned CDP targets with persistent app_probe.js, focus and viewport sessions.
  Benchmark frontend remains4a02d2f; no production build was rerun during timing.
- /tmp/vj0-source-order-queue.py was the serial coordinator; all its trials ended.
  /tmp/vj0-app-source-order-runner.log retains stdout. The script and transient
  CDP sessions are not required to read committed results.
- Browser179records, compute85cells/255repeats/25,500frames, Stream35records/
  27measured/81clips, same-host16trials, app18summaries (16formal +2setup smokes).
  Boundaries and failed/invalid observations are explicit in the appendices.
- Visual evidence lives outside Git at /tmp/vj0-perf-evidence-20260917. Capture
  uses explicit full-viewport CDP frames after all timed work; video playback
  FPS must not be used as benchmark throughput.

Both pods were left warm by request. Local test clients are closed after evidence.
To restart experiments after a pod/container restart, use the recorded files and
current dispatcher PID, rather than assuming the old process IDs remain valid.
The stable image still contains its original code; workspace tests did not
publish a new Docker image. Never overlap benchmark timing with builds, bulk
transfers, other clients or evidence capture.

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
