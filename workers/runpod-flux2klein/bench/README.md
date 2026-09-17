# September 2026 performance harness

Plan and results: `docs/performance/2026-09-17/` at repository root.
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
These are unmeasured candidates, not recommended production settings.

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
stream mode deliberately reports frame age as unknown. Do not subtract the most
recent send time from an unrelated response.

Decode/draw FPS is an offscreen source-resolution 2D measurement. It is **not**
proof of the full app/projector FPS: that additionally includes React, WebGL
upscaling, stage forwarding and the real audio loop. Production browser capture
uses `HTMLCanvasElement.toBlob`; this harness uses `OffscreenCanvas.convertToBlob`.
Keep this difference in reports. Use the unchanged app for the final integration
and soak test; never promote a browser optimization based only on this harness.

The current image silently ignores the `jpegQuality` client field in its
dispatcher. Until that forwarding is fixed/tested, output-quality baselines must
use `JPEG_QUALITY` in the worker environment, with process restart recorded.

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
