# Worker runtime controls

These changes are prepared on the performance branch. They do not update the
published image or deploy to existing pods. Rebuild the worker image to include
`worker_runtime.py` and the unchanged measured `bench/terminal_noop.py` and
`bench/gpu_output_cast.py` helpers.

For an individual-file deployment, copy `worker_runtime.py` alongside
`inference_server.py` and both exact helpers into its `bench/` subdirectory,
or use the rebuilt image. Do not copy `inference_server.py` alone: the runtime
companion is required even when both optimization flags are off.

| Environment variable | Default | Behavior |
|---|---|---|
| `TORCH_NUM_THREADS` | `0` | PyTorch CPU intra-op threads per GPU worker process. `1`–`256` sets an explicit count; `0` retains PyTorch's native selection. |
| `USE_TERMINAL_NOOP` | `0` | `1` opts into the audited terminal prediction skip if all source guards match. `0` uses the original pipeline. |
| `USE_GPU_OUTPUT_CAST` | `0` | `1` opts into converting the final CUDA image to FP32 before downloading it, when source guards match. `0` uses the original image converter. |

Values outside the documented ranges fail configuration rather than silently
selecting a different benchmark profile. Restart the worker process after
changing these settings. They are not client-controlled image settings.

## CPU thread budget

The thread budget is applied at the start of `setup_pipeline()`, before model
loading, CPU tensor work and compilation. A pod can expose the host's many CPU
cores while having a much smaller CPU quota. In the investigated environment,
the native intra-op pool used 128 threads against a quota of approximately 31
cores; small explicit pools removed observed quota throttling. Four threads is
rejected for the current quality-preservation goal: the explicit cross-thread
check changed model outputs. The 512×288 diagnostic measured pixel MSE
approximately 57–74 (PSNR 29.44–30.57 dB), while returning to 128 threads
reproduced the original output exactly. Native selection remains the default.
This setting is per Python worker, so a
multi-GPU pod has multiple such pools. It does not change inter-op threads,
CPU affinity, the model, image precision or the requested denoising schedule.

Use `TORCH_NUM_THREADS=0` when reproducing native-thread historical runs. Record
the startup log's previous and effective counts, because native selection
depends on the environment. Throughput gains depend on the host and quota;
compute numbers are not WebRTC or projector FPS.

## Opt-in terminal prediction skip

The current `generate()` supplies the original `linspace(1-alpha, 0, steps)`
sigma list to the pinned `Flux2KleinKVPipeline`. Its deterministic Euler schedule
can end in a zero-to-zero update. The audited helper avoids the transformer
prediction used only by that zero update while retaining the scheduler call,
step count, shifted timesteps, callbacks, dtype conversions and output handling.
This is not a reduction of the user's requested step count.

Three checks protect installation: the helper's exact SHA256, the installed
pipeline source SHA256, and the scheduler source SHA256/exact class. A mismatch
or unsupported installation logs `terminal_noop=disabled; original pipeline
retained` and uses the original call method. The helper additionally checks the
actual final sigma pair, scheduler position, deterministic/non-inverted mode,
absence of image-reference/KV conditioning and matching latent/transformer dtype
before each eligible prediction. Unsupported iterations execute the original
prediction branch. Runtime generation errors retain the existing worker error
handling; an error does not trigger a second speculative model call.

The helper is the same file used in the 162-case audit across three resolutions,
two/three/four steps, three alphas, two seeds and three input phases. Those cases
preserved pixels, JPEG bytes, callback latents and global RNG state exactly.
They do not establish equality for every possible prompt/input. In particular,
zero times a nonfinite prediction is not an algebraic no-op; removing such a
prediction can change failure behavior. Keep this option disabled until the
intended workload's quality and actual application tests pass.

Diffusers remains pinned in `requirements.txt`; model weights, dependencies,
JPEG quality, frame settings, source-order checks and GPU thread ownership are
unchanged by these controls. Warmup and inference use the same boot-selected
terminal policy on the existing main execution thread.

## Opt-in GPU output conversion

The pinned image processor downloads its BF16 output before converting it to
FP32 on the CPU. `USE_GPU_OUTPUT_CAST=1` moves that exact cast before the download,
retaining the NHWC array layout, FP32 output and existing PIL/JPEG path. This
avoids the small CPU conversion that was triggering heavy thread-pool overhead
without changing the thread count used by the model or its compiler. Downloading
FP32 instead of BF16 transfers more bytes, so performance remains host-dependent.

Installation checks the unchanged measured helper's SHA256, the exact
`Flux2ImageProcessor` class, the inherited conversion method's identity and its
pinned source SHA256. Unsupported or already-overridden processors retain their
original method and log the reason. Only this processor instance is patched;
CPU input tensors still use the original converter. Runtime CUDA errors retain
the existing worker error handling rather than repeating work speculatively.
The helper's duplicate reference-conversion mode remains disabled in production.

Same-tensor CPU/GPU conversions passed 36 byte-equality checks. The subsequent
native-thread 512×288 control also preserved generated pixels when combined with
the terminal skip. The production boot path subsequently passed 27 exact
pixel/JPEG/RNG cases across 512×288, 768×448 and 1024×576 at two/three/four steps,
plus 54 same-tensor cast checks. This remains evidence for the tested fixtures,
not a guarantee for every workload; the option stays explicitly opt-in.
Warmup and live inference use the same boot-selected converter.

Three alternating 100-frame pairs per size measured production-control offline
FPS of 29.37→42.23, 14.38→21.25 and 8.52→12.72. These include JPEG85 input,
VAE/inference and JPEG80 output, excluding IPC/network/browser. The live-app
matrix uses a separate generated worker with the earlier caching/event-timing
bundle shared by its controls. Enabling these two flags alone is not the whole
live benchmark configuration. See the [measurement boundaries and full evidence](../../docs/performance/2026-09-17/DEEP-DIVE.md).

```sh
# From the worker directory; build a local candidate tag only.
docker build -t vj0-flux2klein-worker:perf-runtime .
# Supply these when launching the candidate container:
# -e TORCH_NUM_THREADS=0 -e USE_TERMINAL_NOOP=1 -e USE_GPU_OUTPUT_CAST=1

# CPU-only guard/configuration checks, from the repository root:
python3 -m unittest discover -s workers/runpod-flux2klein -p 'test_worker_runtime.py' -v
```

The CPU checks validate configuration, guarded fallback, packaging and boot
order. The separate production GPU proof validates boot-selected installation
and the stated fixed-fixture equivalence; the actual-app matrix validates its
combined benchmark worker. A rebuilt published image was not deployed or tested.
