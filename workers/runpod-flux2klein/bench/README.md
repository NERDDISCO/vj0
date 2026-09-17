# September 2026 performance harness

Plan and results: [September report](../../../docs/performance/2026-09-17/RESULTS.md).
These are experimental harnesses. They do not change application defaults.

## Compute

Use the immutable baseline image recorded in the plan. Stop its existing
inference processes before running another model on the same GPU. Preserve its
original source at `/app/inference_server.py`; import that exact file:

```bash
CUDA_VISIBLE_DEVICES=0 HF_HOME=/workspace/hf-cache \
  python3 bench/compute.py --worker-script /app/inference_server.py \
  --output /workspace/results/baseline --sizes 512x288,768x448,1024x576 \
  --steps 2,3,4 --frames 100 --warmup 8 --repeats 3 \
  --image-digest sha256:689e0f1cbcc8053727da3539080312fa3645d01649daf2106472679b768ce490
```

Capture stdout/stderr to a log. The FP8 loader can fall back to bf16, so inspect
that log rather than assuming the requested quantization was applied.

Each invocation creates `environment.json`, append-only `results.jsonl`, input
images and output A/B/blank samples. Use a different output directory per run.
Compute FPS includes input JPEG decode, preprocessing/VAE encode, diffusion,
VAE decode, and output JPEG encode. It excludes IPC, network, browser work and
prompt-cache lookups; compare separately with end-to-end results.

Available isolated experiments: `--variant constants`, `--variant no-stage-sync`,
`--variant inference-mode`, `--variant combined` (constants + no-stage-sync),
`--compile-mode default`, `--vae-fp8 0`, JPEG qualities and step/resolution sweeps.
Measured outcomes, repeat spreads and compatibility failures are recorded in the
report. Experimental variants remain separate from production defaults.

## Browser / actual WAN path

Serve this repository locally with `python3 -m http.server 8765 --bind 127.0.0.1`.
Open its local HTTP origin in a real browser. From browser evaluation:

```javascript
const { runBenchmark } = await import('/workers/runpod-flux2klein/bench/browser.js');
window.benchResult = await runBenchmark({
  server: 'https://POD-ID-3000.proxy.runpod.net',
  width: 512, height: 288, steps: 2, seconds: 30,
  sendFps: 60, mode: 'stream', telemetryEveryMs: 0,
});
```

Save the returned JSON. Repeat with `telemetryEveryMs: 2000`, `mode: 'single'`,
and the planned shapes/settings. The harness uses the actual WebRTC connection
and binary JPEG protocol. Single mode measures correlated request/response time;
untagged stream mode reports frame age as unknown. Set `frameIds: true` only
against the instrumented dispatcher to correlate each output with its input.
Do not subtract the most recent send time from an unrelated response.

Decode/draw FPS is an offscreen source-resolution 2D measurement. It is **not**
proof of the full app/projector FPS: that additionally includes React, WebGL
upscaling, stage forwarding and the real audio loop. Production browser capture
uses `HTMLCanvasElement.toBlob`; this harness uses `OffscreenCanvas.convertToBlob`.
Keep this difference in reports. Use the unchanged app for the final integration
and soak test; never promote a browser optimization based only on this harness.

The frozen baseline image ignores the `jpegQuality` client field in its
dispatcher. Immutable-image baselines therefore use `JPEG_QUALITY` in the worker
environment, with process restart recorded. The instrumented candidate forwards
and verifies this field; its quality trials record an explicit output quality.

## Local checks

An offline JPEG sweep can measure payload tradeoffs on the archived PNGs:

```bash
python3 bench/jpeg_sweep.py --output /tmp/jpeg-results.json --samples /tmp/jpeg-samples
```

Run from the worker directory with Pillow and NumPy available. This measures
compression size/error only, not live FPS or inference. Use actual production
outputs at the target resolutions before choosing a JPEG setting.

```bash
python3 -m unittest discover -s workers/runpod-flux2klein/bench -p 'test_*.py'
python3 workers/runpod-flux2klein/bench/compute.py --help
node --test workers/runpod-flux2klein/bench/test_browser.mjs
```

Passing these checks validates bookkeeping and argument handling, not CUDA
execution, performance, image quality or live transport.

The live baseline exposed a background warmup grad-mode failure. In the worker
environment, verify the real function's behavior in a fresh thread:

```bash
python3 bench/check_warmup_thread.py --worker-script /app/inference_server.py
```

The frozen original source exits 1; the no-grad correction exits 0. Tiny CPU
operations replace model/GPU work in this check. Separately validate that all
selected resolutions actually finish compilation on the GPU. The final worker
correction runs optional warmup on the main GPU thread because no-grad alone
does not resolve CUDA-graph thread ownership.

The warmup recovery also has dispatcher lifecycle/watchdog coverage:
`node --test workers/runpod-flux2klein/bench/test_compile.mjs`.
`check_gpu_thread.py --worker-script PATH --scenario idle-grace` exercises a
slow frame and verifies a full second of idle time afterward; `shutdown` and
`failure` cover early exit and terminal compile-failure reporting. These execute
fake model operations in the actual loop and do not replace GPU recovery tests.

`streamv2.py` is the separate staged-API benchmark for the pinned StreamDiffusionV2
environment, including decoder/mode/context and paced-input experiments. It records actual output counts and the
first pass separately; offline output FPS is not capture-to-output age. Run only
with the Klein dispatcher paused and its Python process stopped. See
`docs/performance/2026-09-17/STREAMDIFFUSION.md` for environment/model identities.

For the candidate dispatcher, `frameIds: true` uses an optional `VJ0B`/uint32/JPEG
envelope and measures streaming capture age from the echoed ID. `/debug` must
advertise protocol version 1. Connection epochs prevent old results from being
assigned to a replacement client. The ordinary app protocol stays raw JPEG.
Frame-ID trials default to explicit output quality 80; **set `outputQuality`
explicitly in every patched-server quality comparison** because worker state
persists between clients. `channelOptions: {ordered: false}` tests unordered
reliable transport; partial reliability is not validated by the current drain
checks and must not be promoted for the shared settings/image channel.

`check_gpu_thread.py --scenario queue-drops` queues three frames before the GPU
loop can dequeue any, then verifies one explicit drop plus two outputs retain
their IDs/connection epoch. It is a CPU control-flow check, not a throughput test.

`run_sweep.py` runs the explicit `compute-jobs.json` jobs serially on the pod.
It refuses to overwrite prior run output, cleans process groups between jobs,
checks for competing CUDA processes, and resumes the paused dispatcher in a
nested `finally`. Failed jobs produce a nonzero aggregate exit status. The
runner must never overlap browser/GPU measurements on that pod.

## Saved result review

`summarize_results.py` validates recorded rate arithmetic and produces an index
without pooling different settings. `render_browser_tables.py` renders that index
as per-trial Markdown and CSV. Both retain explicit exclusions, failed trials,
raw status/errors, and any hash-bound assessment of measured continuity failures.

A client-observed worker-stat gap over two seconds fails continuity even when
frame counts and rates remain valid. Missing timing/health or unavailable workers
still invalidate the measurement. `validationStatus` and `validationFailed` retain
this distinction; a numerically measured run is not necessarily acceptable.
The actual-app soak uses its own unchanged, strict continuity/lifecycle guards.

`app_batch.py` requires two owned browser targets with persistent `app_probe.js`,
focus and viewport CDP sessions installed before navigation. It exercises real
WebAudio/analyser/capture, the selected app layout and the projector renderer.
Observe exact source/config identities and common windows in saved artifacts.
Screenshots or recordings must be captured outside timed intervals.
