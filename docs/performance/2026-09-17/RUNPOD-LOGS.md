# Runpod CLI/API log verification

Verified on test pod `0pxb4bss2jmbhg` on 2026-09-17, using
`runpodctl 2.14.0-dd55bcf` and official project skill 1.2.0.

- API system logs returned image-pull/container-creation progress while
  `runpodctl ssh info` still reported that the container was not ready.
- `pod create --wait` completed after 158 seconds. A subsequent SSH command
  succeeded; this is separate from the earlier API-log observation.
- API container logs returned entrypoint, model loading, compilation errors,
  and worker watchdog/respawn events. They were useful for diagnosing actual
  FP8/autograd and CUDA-graph warmup failures.
- No live serverless worker-log test has been performed. Do not extend these
  conclusions to serverless logging or to every Runpod failure mode.

Evidence: `baseline-pod.json`, `baseline-boot-events.json`,
`no-grad-recovery-events.json`, `idle-recovery-events.json`, and
`resolution-watchdog-events.json`.

Possible tweet:

> Tried runpodctl 2.14 on a fresh GPU pod: image-pull logs were available through
> the API before SSH was ready. Container logs then helped me debug a real
> FP8/CUDA-graph warmup failure. That made the startup/debugging loop much easier.
