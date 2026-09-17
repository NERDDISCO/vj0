# Resume the experiment loop

Checkpoint 14:11 UTC. Continue until all remaining live/app trials, final review
and push are complete. Both paid pods remain warm. No UI redesign, main push or
stable-image deployment.

The corrected scaling batch completed all 18 trials and is saved in
browser-scaling-idle-fixed/. One raw result remains invalid with an audited,
hash-bound assessment in measurement-assessments.json: its measured data are
usable, but a 3.2165-second client-observed worker-stat arrival gap fails
continuity. No restart, compile, decode/send errors or unavailable workers.
The browser harness now reports continuity separately; missing health/data still
invalidate measurements. The actual-app soak's strict rules are unchanged.

Pushed checkpoint b0d1006. The audited marker /tmp/vj0-post-scaling-ready.json
released successor PID 22824, exec 95579, /tmp/vj0-remaining-queues-20260917.py:
12 frame-buffer trials → both Torch 2.13 workers warm all three shapes → 27 live
trials → 600-second app/projector soak and lifecycle stress.
All 12 frame-buffer trials completed, with two continuity failures retained.
The coordinator is briefly SIGSTOPped for checkpoint push; resume PID 22824
after push, then monitor both new-stack workers warming and remaining queues.
Outputs: /tmp/vj0-browser-frame-buffer-20260917,
/tmp/vj0-browser-torch213-20260917, /tmp/vj0-app-soak-20260917.

Pod B: 9vj8k6guaxsbhw, new-stack runner 67122, manifest
/workspace/torch213-live-service-20260917/sweep.json. Prior server 64226 terminated
by the guarded transition. Both select corrected
/workspace/scaling-livebench-20260917/server-idle-fixed.js, SHA
9fd289c7e339c3496582daeb2a92d615f9db39c0df3a4aa68fa83f98ce6b8c03.
Original Node 567 paused. Pod A: 0pxb4bss2jmbhg, runner 49372,
/workspace/stream512-paced-20260917/sweep.json. Both 512 paced jobs passed;
final Klein service remains warm. Original Node 499 paused.

All Stream results, clips and engine identities have now been collected, including
512×288 / 257-input-frame paced follow-ups. Inspect their clips locally under
/tmp/vj0-quality-20260917/stream512-paced and finish the Stream appendix/review.
35 Stream records now include failed attempts. Browser index has 140 trials;
compute has 85 cells, actual-app has 13 summaries, same-host has 16 trials.

App CDP probe/focus/viewport sessions expire roughly 15:40–16:04 UTC; extend before
expiry if needed without changing the measurement probe. Final soak uses frontend
4a02d2f, 768×448, new-stack combined, two GPUs, pending 3, JPEG 80, telemetry and
real synthetic WebAudio. Stress rotates 1024→512→768, prompts and reconnects.
Keep harness frozen during measurement. Capture screenshots/flow video afterward
outside Git at /tmp/vj0-perf-evidence-20260917.

Never run builds, downloads, pushes or bulk SSH during timed Mac WAN/app trials.
All final reports, independent review, commit and push still require completion.

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
