# StreamDiffusionV2 measurements — 2026-09-17

StreamDiffusionV2 works on the test PRO 6000, including its 14B model and a real TensorRT decoder. Its strongest tested small-resolution result is **43.66–44.49 decoded FPS at 512×288** with 1.3B/TAEHV/two steps. At native 832×480, standard decoding produces **13.58–13.84 FPS**, TAEHV **20.64–21.06 FPS**, and the corrected TensorRT fast preset **22.76–23.11 FPS**. These are different model/decoder/context choices, not equal-quality FLUX speedups or app/projector FPS.

**Model and source identity**

The pinned [official source](https://github.com/chenfengxu714/StreamDiffusionV2/tree/6961a5cf2045d1dda05a04ef229698bdc04e873a) is commit `6961a5cf2045d1dda05a04ef229698bdc04e873a`, dated September 14, package version 0.1.1. It uses causal Wan2.1 video models with temporal state:

- [Wan2.1 1.3B base](https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B), revision `37ec512624d61f7aa208f7ea8140a131f93afc9a`.
- [Distilled causal checkpoint](https://huggingface.co/jerryfeng/StreamDiffusionV2), revision `2373eb2b39278b3a1aa174964a724ee78ead96f0`; folders `wan_causal_dmd_v2v` and `wan_causal_dmd_v2v_14b`.
- Wan2.1 14B base revision `a064a6c71f5be440641209c07bf2a5ce7a2ff5e4`.
- [TAEHV](https://github.com/madebyollin/taehv), commit `011dfc2112197741c540e0bdd5b7b67bcc930771`, `taew2_1.pth` weights.

`single` uses stream batching; `single-wo` is the non-batched single-GPU path. The first input chunk contains five frames and subsequent chunks four. At 30 FPS, collecting four frames spans 100 ms from first to fourth, with chunks arriving every 133 ms. Its step/noise-scale values are not numerically equivalent to Klein's steps/alpha. The denoising schedule is restored before each repeat, caches reset, and seed set to 42. Each raw record retains resolved context, effective noise and adaptive timestep.

**Measurement boundaries and latency**

The original trials use 65 input frames; the final 512×288 paced follow-up uses 257. Each full trial has three independent clips. Repeat 0 is explicitly cold; the table reports repeats 1 and 2. FPS is actual decoded output count / observed wall time, including encode/denoise/decode and pipeline fill/tail shortfall, excluding model construction, file writing and input host upload. Inputs are preloaded GPU-resident synthetic clips. No interpolation or duplicated display frames count as output.

With two steps, standard `single` emits 61/65 frames and `single-wo` 65/65. TAEHV removes the separate frame-zero anchor, yielding 60/65 and 64/65 respectively; the remaining four-frame tail in `single` is not drained. Exact counts for other settings remain in each raw record.

The corrected 30-FPS-arrival tests verify source mapping through rolling latent positions. At 832×480, TAEHV/two steps/noise 0.95 measured **19.23–19.66 FPS and p95 simulated capture→decoded age 1087–1155 ms** (`single`), versus **20.00–20.39 FPS and 1037–1097 ms** (`single-wo`). Output slower than input accumulates delay. These ages exclude JPEG transport, host upload, browser/display and audio acquisition, and apply only to these settings. Earlier anchor-count assertions failed explicitly and their failed records are retained.

**No Stream browser-display rate is claimed.** The existing application sends independent image requests. Mapping its latest-frame admission, prompt changes and reconnects onto causal four-frame chunks and persistent video state requires a model-specific streaming adapter. The tested visual/latency tradeoffs do not currently justify building that adapter: the fast 1.3B output mostly preserves the line, while the stronger 14B transformation is slower. Adapter complexity is a scope cost, not proof of incompatibility. FLUX actual-app/projector measurements are reported separately. The completed 512×288 follow-up below establishes a much lower isolated latency at that size; it still does not establish app display rate or long-session continuity.

**512×288 paced follow-up**

To test the small-resolution exception directly, two additional jobs used 257
input frames at simulated 30 FPS arrival, 1.3B/two steps/noise 0.95, the ordinary
context and the verified FP16 TensorRT decoder. Each had one cold and two warm
clips. The pipeline keeps up with this input rate in the warm clips; these
arrival-limited rates do not measure its maximum unpaced capacity.

| Mode | Warm output FPS | Output / input frames | Simulated source age p50 ms | p95 ms | First output ms |
|---|---:|---:|---:|---:|---:|
| single, stream batching | 29.271 / 29.271 | 252 / 257 | 248.3 / 247.7 | 309.2 / 309.0 | 277.2 / 274.7 |
| single-wo, direct single GPU | 29.692 / 29.692 | 256 / 257 | 154.7 / 154.5 | 190.9 / 190.3 | 278.5 / 274.6 |

The frame-zero anchor is omitted in both modes; stream batching also leaves its
four-frame tail undrained. Source ages include input collection and pipeline
fill. They exclude real input upload, transport, JPEG, app/projector and audio.
The first cold single clip built three 512 engines in 30.08 seconds total;
its first output took 16.63 seconds, throughput was 6.78 FPS, and p95 age 32.07
seconds. The later single-wo process reused disk-cached engines; its process-cold
clip was 29.69 FPS with p95 age 550.9 ms. Cold results remain separate from warm.

The saved cold-first-clip samples from both modes begin with full-frame neon
rings/blobs, then mostly preserve the
waveform with colored highlights on black in the inspected middle/final frames.
This makes the measured speed/latency promising for that visual style, but does
not establish equivalent Klein scene transformation. See the [sample contact
sheet](samples/stream512-contact.jpg), [inspection record](stream512-quality.json),
[raw results](stream512-paced-results/), [job commands](stream512-paced-jobs.json),
[manifest](stream512-paced-manifest.json) and [actual engine hashes](stream512-engine-identity.json).

**Environment and compatibility work**

The isolated environment uses Python 3.11.16, Torch 2.11.0+cu128, Diffusers 0.35.1, Transformers 4.54.0, NumPy 1.24.4 and Pillow 10.1.0. Explicit Torch/vision/audio overrides reconcile upstream strict Torch 2.6 metadata with its Blackwell installation guidance. FlashAttention is absent; the measured pipeline uses PyTorch SDPA fallback. The original Klein environment remains intact.

TensorRT uses an isolated complete Torch 2.11/cu128 environment with `tensorrt-cu12==10.16.1.11`, ONNX1.22.0 and onnxscript0.7.2. Version 11 removes `BuilderFlag.FP16`, used by this exporter, so the experiment pins compatible 10.x. [NVIDIA migration reference](https://docs.nvidia.com/deeplearning/tensorrt/latest/api/migration/tensorrt-10x-to-11x-python-api-patterns.html).

Two real compatibility failures were diagnosed and retained:

1. Parent `nn.Module.to()` bypasses TAEHV's custom initialization. Requested TensorRT silently falls back to native. The benchmark rejects results without an initialized decoder and executed cached engine. The retry explicitly invokes the wrapper, applying its FP16 decoder policy and eval mode; matched native controls use the same parallel FP16 decoder.
2. The newer ONNX exporter writes weights beside the model. Upstream calls `parser.parse(bytes)` without the model path, so TensorRT cannot locate those weights. The final benchmark changes only that documented path argument in-process, preserving the pinned checkout. The exact missing external-weight message is retained in the [failed export log](trt-external-weight-failure.log). [TensorRT parser API](https://docs.nvidia.com/deeplearning/tensorrt/latest/_static/python-api/parsers/Onnx/pyOnnx.html).

All five final native/TRT jobs passed. [Job commands](trt-parser-path-jobs.json), [manifest](trt-parser-path-manifest.json), [engine identity](trt-engine-identity.json), and [raw results](stream-trt-parser-path-results/) record the evidence. Export builds preserve CPU/current-GPU RNG so random export inputs do not alter subsequent video noise.

| Matched final 832×480/two-step setting | Warm decoded FPS | Warm first output s |
|---|---:|---:|
| Native FP16 parallel, ordinary context | 20.21–20.36 | 0.273–0.276 |
| TensorRT FP16, ordinary context | 22.00–22.13 | 0.253–0.269 |
| Native FP16, fast context | 21.67–22.06 | 0.264–0.267 |
| TensorRT FP16, fast context | 22.76–23.11 | 0.263–0.265 |
| TensorRT FP16, ordinary context, noise 0.95 | 21.33–21.45 | 0.263–0.267 |

The ordinary-context TRT mean is approximately 8.8% above its matched native mean; fast-context TRT approximately 4.9% above its matched native control. These are two warm clips in sequential processes, not a long live confirmation. TRT accelerates the TAEHV decoder only, not Wan's denoising transformer. Fast context changes KV-cache/sink/adaptation settings (6/3/0.2→5/2/−1), so its gain also changes model context.

The first cold TRT clip built three actual engines, shapes 1×2/3/4×16×60×104, taking **13.77+9.23+10.02≈33.02 seconds** in total. Its first output took 14.41s and overall cold throughput 1.66 FPS. Later TRT processes reuse disk-cached engines; their repeat 0 remains process-cold, not engine-build-cold. Initial cache hashes and build timings are in raw results. PyTorch allocated/reserved peaks exclude TensorRT allocations; nvidia-smi end snapshots include total usage but are not peaks.

**Quality and practical fit**

At noise 0.8, the 1.3B model mainly preserves/recolours the waveform. It does not produce the rich full-frame Klein scene on this fixture. At noise 0.95, the inspected TRT clip begins with stronger rainbow imagery and later returns to a largely preserved line as processing adapts. The fast-context and ordinary-context native/TRT pairs look very similar in the selected first/middle/last frames. Their saved 8-bit sample PSNR is 59.81–60.53 dB; that measures numerical closeness, not a perceptual preference or temporal guarantee. See [TRT quality diagnostics](trt-quality.json) and [contact sheet](samples/trt-contact.jpg).

The 14B model produces stronger transformation in the inspected noise 0.95 samples. At 832×480, its standard-VAE trial used noise 0.8 and reached **6.45–6.50 FPS**; TAEHV reached **7.68–7.71 FPS** at both tested noise 0.8 and 0.95 settings. Peak PyTorch allocated memory is about 61.5 GB/59.6 GB decimal, with reserved memory higher. Model/step/decoder/noise changes are explicit quality tradeoffs. This quality conclusion applies to the measured settings and synthetic fixture;
it does not rule out further model-quality tuning. No Stream backend replaces
the application's FLUX default.

The 120 GB workspace quota was reached during installation. Recovery preserved results/source and removed reproducible cache plus the already-tested 28.6 GB 14B causal checkpoint. Download it again before another 14B run; the 57 GB base remains on the pod container disk. [Recovery record](stream-cache-recovery.json).

**Every retained trial**

Each warm range below represents two clips. Failed rows have no throughput. `paced` marks simulated 30 FPS input; all other trials process the GPU-resident clip as quickly as possible. Initial explicit-wrapper failures and final parser-path successes remain separate.

| Raw trial | Status | Model / size | Steps / mode | Decoder / noise / paced | Warm FPS | Output frames per warm clip |
|---|---|---|---|---|---:|---|
| [stream-recovery-results/taehv-1024x576](stream-recovery-results/taehv-1024x576.json) | measured | T2V-1.3B / 1024×576 | 2 / single | TAEHV / 0.8 / no | 13.65–13.95 | [60, 60] |
| [stream-recovery-results/taehv-512x288](stream-recovery-results/taehv-512x288.json) | measured | T2V-1.3B / 512×288 | 2 / single | TAEHV / 0.8 / no | 43.66–44.49 | [60, 60] |
| [stream-recovery-results/taehv-arrival30-single-anchor-corrected](stream-recovery-results/taehv-arrival30-single-anchor-corrected.json) | measured | T2V-1.3B / 832×480 | 2 / single | TAEHV / 0.95 / yes | 19.23–19.66 | [60, 60] |
| [stream-recovery-results/taehv-arrival30-single-wo-anchor-corrected](stream-recovery-results/taehv-arrival30-single-wo-anchor-corrected.json) | measured | T2V-1.3B / 832×480 | 2 / single-wo | TAEHV / 0.95 / yes | 20.00–20.39 | [64, 64] |
| [stream-recovery-results/taehv-three-step](stream-recovery-results/taehv-three-step.json) | measured | T2V-1.3B / 832×480 | 3 / single | TAEHV / 0.8 / no | 15.51–16.01 | [56, 56] |
| [stream-results/standard-single-wo](stream-results/standard-single-wo.json) | measured | T2V-1.3B / 832×480 | 2 / single-wo | standard / 0.8 / no | 13.73–13.98 | [65, 65] |
| [stream-results/standard-single](stream-results/standard-single.json) | measured | T2V-1.3B / 832×480 | 2 / single | standard / 0.8 / no | 13.58–13.84 | [61, 61] |
| [stream-results/taehv-arrival30-single-wo](stream-results/taehv-arrival30-single-wo.json) | failed | T2V-1.3B / 832×480 | 2 / single-wo | TAEHV / 0.95 / yes | — | [] |
| [stream-results/taehv-arrival30-single](stream-results/taehv-arrival30-single.json) | failed | T2V-1.3B / 832×480 | 2 / single | TAEHV / 0.95 / yes | — | [] |
| [stream-results/taehv-detailed](stream-results/taehv-detailed.json) | measured | T2V-1.3B / 832×480 | 2 / single | TAEHV / 0.95 / no | 20.88–21.28 | [60, 60] |
| [stream-results/taehv-four-step](stream-results/taehv-four-step.json) | measured | T2V-1.3B / 832×480 | 4 / single | TAEHV / 0.8 / no | 12.94–13.20 | [52, 52] |
| [stream-results/taehv-noise 095](stream-results/taehv-noise095.json) | measured | T2V-1.3B / 832×480 | 2 / single | TAEHV / 0.95 / no | 20.72–21.08 | [60, 60] |
| [stream-results/taehv-noise100](stream-results/taehv-noise100.json) | measured | T2V-1.3B / 832×480 | 2 / single | TAEHV / 1.0 / no | 20.71–21.14 | [60, 60] |
| [stream-results/taehv-one-step](stream-results/taehv-one-step.json) | measured | T2V-1.3B / 832×480 | 1 / single | TAEHV / 0.8 / no | 27.33–27.87 | [64, 64] |
| [stream-results/taehv-single-wo](stream-results/taehv-single-wo.json) | measured | T2V-1.3B / 832×480 | 2 / single-wo | TAEHV / 0.8 / no | 21.04–21.24 | [64, 64] |
| [stream-results/taehv-single](stream-results/taehv-single.json) | measured | T2V-1.3B / 832×480 | 2 / single | TAEHV / 0.8 / no | 20.64–21.06 | [60, 60] |
| [stream-results/wan14b-standard](stream-results/wan14b-standard.json) | measured | T2V-14B / 832×480 | 2 / single | standard / 0.8 / no | 6.45–6.50 | [61, 61] |
| [stream-results/wan14b-taehv-noise 095](stream-results/wan14b-taehv-noise095.json) | measured | T2V-14B / 832×480 | 2 / single | TAEHV / 0.95 / no | 7.68–7.71 | [60, 60] |
| [stream-results/wan14b-taehv](stream-results/wan14b-taehv.json) | measured | T2V-14B / 832×480 | 2 / single | TAEHV / 0.8 / no | 7.68–7.71 | [60, 60] |
| [stream-trt-explicit-results/native-fast-fp16](stream-trt-explicit-results/native-fast-fp16.json) | measured | T2V-1.3B / 832×480 | 2 / single | TAEHV fast / 0.8 / no | 21.43–21.79 | [60, 60] |
| [stream-trt-explicit-results/native-fp16-parallel](stream-trt-explicit-results/native-fp16-parallel.json) | measured | T2V-1.3B / 832×480 | 2 / single | TAEHV / 0.8 / no | 20.41–20.79 | [60, 60] |
| [stream-trt-explicit-results/trt-fast-fp16](stream-trt-explicit-results/trt-fast-fp16.json) | failed | T2V-1.3B / 832×480 | 2 / single | TRT fast / 0.8 / no | — | [] |
| [stream-trt-explicit-results/trt-fp16-noise 095](stream-trt-explicit-results/trt-fp16-noise095.json) | failed | T2V-1.3B / 832×480 | 2 / single | TRT / 0.95 / no | — | [] |
| [stream-trt-explicit-results/trt-fp16](stream-trt-explicit-results/trt-fp16.json) | failed | T2V-1.3B / 832×480 | 2 / single | TRT / 0.8 / no | — | [] |
| [stream-trt-initial-results/trt-env-taehv-baseline](stream-trt-initial-results/trt-env-taehv-baseline.json) | measured | T2V-1.3B / 832×480 | 2 / single | TAEHV / 0.8 / no | 20.42–20.65 | [60, 60] |
| [stream-trt-initial-results/trt-fast](stream-trt-initial-results/trt-fast.json) | failed | T2V-1.3B / 832×480 | 2 / single | TRT fast / 0.8 / no | — | [] |
| [stream-trt-initial-results/trt-taehv-noise 095](stream-trt-initial-results/trt-taehv-noise095.json) | failed | T2V-1.3B / 832×480 | 2 / single | TRT / 0.95 / no | — | [] |
| [stream-trt-initial-results/trt-taehv](stream-trt-initial-results/trt-taehv.json) | failed | T2V-1.3B / 832×480 | 2 / single | TRT / 0.8 / no | — | [] |
| [stream-trt-parser-path-results/native-fast-fp16](stream-trt-parser-path-results/native-fast-fp16.json) | measured | T2V-1.3B / 832×480 | 2 / single | TAEHV fast / 0.8 / no | 21.67–22.06 | [60, 60] |
| [stream-trt-parser-path-results/native-fp16-parallel](stream-trt-parser-path-results/native-fp16-parallel.json) | measured | T2V-1.3B / 832×480 | 2 / single | TAEHV / 0.8 / no | 20.21–20.36 | [60, 60] |
| [stream-trt-parser-path-results/trt-fast-fp16](stream-trt-parser-path-results/trt-fast-fp16.json) | measured | T2V-1.3B / 832×480 | 2 / single | TRT fast / 0.8 / no | 22.76–23.11 | [60, 60] |
| [stream-trt-parser-path-results/trt-fp16-noise 095](stream-trt-parser-path-results/trt-fp16-noise095.json) | measured | T2V-1.3B / 832×480 | 2 / single | TRT / 0.95 / no | 21.33–21.45 | [60, 60] |
| [stream-trt-parser-path-results/trt-fp16](stream-trt-parser-path-results/trt-fp16.json) | measured | T2V-1.3B / 832×480 | 2 / single | TRT / 0.8 / no | 22.00–22.13 | [60, 60] |
| [stream512-paced-results/trt512-arrival30-single](stream512-paced-results/trt512-arrival30-single.json) | measured | T2V-1.3B / 512×288 | 2 / single | TAEHV/TRT / 0.95 / yes | 29.27 | [252, 252] / 257 input |
| [stream512-paced-results/trt512-arrival30-single-wo](stream512-paced-results/trt512-arrival30-single-wo.json) | measured | T2V-1.3B / 512×288 | 2 / single-wo | TAEHV/TRT / 0.95 / yes | 29.69 | [256, 256] / 257 input |
