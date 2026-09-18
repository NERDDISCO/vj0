# Latest-input mailbox experiment

This is an isolated dispatcher variant. Production `server.js` is unchanged.
The candidate keeps one physically outstanding image per worker plus one newest
waiting image globally. Each valid arriving input receives its immutable epoch
and source sequence immediately. A busy dispatcher replaces the waiting image;
it does not retain a FIFO of old inputs or require another capture tick to fill
a newly available worker.

Generate directly from `server.js`, or after `configurable_server.py` to retain
the existing compute-variant, worker-routing and buffer controls:

```sh
python3 workers/runpod-flux2klein/bench/latest_mailbox.py \
  --source /path/to/configured-server.js \
  --output /path/to/mailbox-server.js
node --check /path/to/mailbox-server.js
node --test workers/runpod-flux2klein/bench/latest_mailbox_test.mjs
```

The generated file is standalone; it does not require the runtime helper at
launch. The generator prints the input, output and runtime SHA-256 identities
and refuses an existing output path or changed source anchors.

Mailbox mode is enabled by default in this generated file. Set
`LATEST_INPUT_MAILBOX=0` before launch for the original queue policy. For a warm
same-process comparison, stop sending frames, allow all worker requests to
finish, then POST JSON `{"enabled":true}` or `{"enabled":false}` to
`/benchmark/mailbox`. The endpoint returns 409 while any physical request is
outstanding, or while baseline bootstrap requests remain buffered. The latter
includes settings-only requests: replaying an old prompt after switching could
otherwise overwrite newer mailbox settings. `/benchmark/config` continues to configure the baseline pending
limit: with mailbox enabled, effective per-worker pending is always one.

Completion, acknowledged frame drops and per-frame errors flush after ordinary
pending/liveness/output-order accounting, including branches that reject late
or congested output. Worker error acknowledgements do not include source IDs
in the current Python protocol; epoch matching plus the one-request invariant
identifies their occupied slot. A mismatched or duplicate source-bearing frame
response cannot consume another request's slot.

Settings discard the waiting input. Compile start also discards it; subsequent
inputs during compilation replace one another, and the newest can dispatch
when a worker becomes available. Existing compile status gates exclude that
worker from selection. Bootstrap retains settings and only one latest image.
There is no input age timeout: if the sender stops during a long compile, its
last input can still dispatch afterward. Record this boundary in lifecycle
results rather than calling that old input fresh.

Reconnect discards the waiting input but preserves the physical occupancy of
old-client work, including its watchdog pending count. Its real completion is
discarded for delivery, frees the slot, and can immediately dispatch the newest
replacement-client input. Worker exit marks it unavailable before any compile
failure cleanup can flush another request into the dead process.

Extra `/diag` counters are `mailboxDispatched`, `mailboxReplaced`,
`mailboxCleared`, `mailboxLastClearReason` and `mailboxUnmatched`. They distinguish
replaced waiting inputs from ordinary saturation drops. No claim of improved
FPS or latency is made before actual measurements.

Compare baseline pending-three, baseline pending-one, and mailbox at the same
send cadence, compute profile, resolution, compression and GPU count. Report
useful ordered output FPS, p50/p95/p99 source age, dropped/replaced counts and
continuity. It is expected to remove queue waiting and capture-tick refill
gaps, but CPU IPC/refill latency may still reduce throughput compared with
prefilling a worker queue. This experiment establishes that tradeoff.
