**Compute measurements — 2026-09-17**

The strongest repeated two-step FLUX.2 Klein compute results at the three main resolutions came from the isolated Torch 2.13/CUDA 13.2 stack with cached noise/sigma constants and intermediate stage synchronizations removed (`combined`). The resolved and confirmation batches measured median **31.24 / 31.65 FPS at 512×288, 15.79 / 15.80 at 768×448, and 9.07 / 9.00 at 1024×576**, respectively. Each number is a separate batch's median of three 100-frame runs. These measure one GPU's JPEG-input-to-JPEG-output compute throughput; they do not measure live transport, app rendering or physical display FPS. Sources: [resolved combined](compute-torch213-combined-resolved.json), [confirmation combined](compute-torch213-combined-confirmation.json).

The confirmation combined medians are 11.6%, 12.1% and 10.0% above the later old-stack baseline at the same dimensions and two steps. Against the new-stack confirmation baseline, the differences are 7.1%, 0.7% and 1.3%. These are descriptive ratios between sequential batches: stack, cache state, batch order and run variation prevent assigning the whole difference to one change. The new stack changes Torch, CUDA runtime and TorchAO together. **No dependency default is promoted.** Static sample inspection found the same broad composition at fixed resolution, with local texture/colour differences; samples are not bit-identical across processes. See [quality diagnostics and review](new-compute-quality.json) and the [contact sheet](samples/new-compute-contact.jpg). This does not establish equivalent temporal quality. Sources: [new-stack baseline confirmation](compute-torch213-baseline-confirmation.json), [old-stack late baseline](compute-original-stack-late-baseline.json).

This appendix contains **85 complete cells from 27 artifacts: 255 timed repeats and 25,500 frames**. The companion [compute-results.csv](compute-results.csv) retains every cell separately, including exact FPS values, repeat IDs, frame counts, wall durations, raw environment/configuration JSON, backend identity, artifact SHA-256, manifest/job identity and correctness records. The historical [partial baseline](compute-baseline-partial.json) is excluded because [compute-baseline.json](compute-baseline.json) is the complete replacement. Failed dependency-install attempts in the [extended manifest](extended-compute-manifest.json) are not compute cells. No failed attempt is converted into a successful measurement.

**Measurement and identity**

The [compute harness](../../../workers/runpod-flux2klein/bench/compute.py) imports the frozen worker's actual pipeline, image encoding and generation functions. Timing includes input JPEG decoding, VAE encoding, generation/output decoding and output JPEG encoding, with final CUDA synchronization. Input fixture construction, model loading, prompt-embedding lookup, correctness samples and profiling are outside the timed region. `fps = frames / observed wall_seconds`; the tables show the median and minimum–maximum of repeat FPS, not a confidence interval or pooled FPS.

Each cell has **three consecutive repeats of 100 frames**, after **one eight-frame warmup per size/step cell**. The same warmup duration is copied into all three raw repeat records; it is reported once below and must not be summed three times. Repeat IDs are 0, 1 and 2. All cells use seed 42, alpha 0.10, JPEG input quality 85/output quality 80, and one visible RTX PRO 6000 Blackwell Server Edition (`CUDA_VISIBLE_DEVICES=0`, capability 12.0). Two-GPU-host results below still measure a single GPU. All use `reduce-overhead` compilation and VAE FP8 except the explicitly named compile-default and VAE-BF16 controls.

| Environment | Recorded stack | Batch context |
|---|---|---|
| O1 | Torch 2.11.0+cu128; TorchAO 0.17.0+cu128; CUDA 12.8 | Original one-GPU-pod batch |
| O2 | Same original stack | GPU 0 of the separate two-GPU host |
| F4 | Original stack in isolated FA4 environment | Native controls and FA4 trials on GPU 0 of that host |
| N2 | Torch 2.13.0+cu132; TorchAO 0.18.0+cu132; CUDA 13.2 | Isolated dependency environment on GPU 0 of that host |

Shared recorded versions are Python 3.12.3, Diffusers 0.38.0.dev0, Transformers 5.7.0, Pillow 12.2.0 and NumPy 2.4.4; the recorded driver is 595.71.05. [Dependency notes](DEPENDENCIES.md) identify the retained Diffusers source pin as `160852de680d36117e0a787f7f8b718232539abb`. FA4-selected records additionally report `flash-attn-4==4.0.0b31`, `nvidia-cutlass-dsl==4.7.1`, `kernels==0.12.3`, `quack-kernels==0.6.5` and 25 selected transformer processors. The native F4 controls do not enumerate those additional packages in their environment JSON; their [job manifest](dependency-retry-20260917-manifest.json) identifies the same isolated interpreter. Missing backend fields stay `null` in the CSV and appear as **default†** below; they are not upgraded to recorded execution proof.

All 27 artifacts record worker SHA-256 `89cb3a1408bd710a34abfadc246d07ef6f92520abd8c84e088450dd0089882b9` and image `nerddisco/vj0-flux2klein-worker@sha256:689e0f1cbcc8053727da3539080312fa3645d01649daf2106472679b768ce490`. Recorded model-cache refs are Klein 4B `e7b7dc27f91deacad38e78976d1f2b499d76a294` and small decoder `a3efc24f613ef42d9428af62fdbd6f5fd8856c4a`. Environment labels are reading aids; full per-artifact identities and timestamps remain in the CSV/raw JSON. Manifest commands distinguish staged `compute.py`, `compute-v2.py` and `compute-v3.py`; a shared worker hash does not imply an identical harness revision.

**Warmup and cold-cache qualifications**

Warmup seconds include the eight warmup frames and any lazy compilation they trigger; they exclude model load and prompt embedding. New shapes, compile modes, precision changes and prior cache reuse affect this duration. Short step-3/4 warmups follow an already exercised shape. These records are not a controlled cold-start study, and later fast warmups are not cold-compilation measurements.

The **old Torch 2.11 late control accidentally inherited the new-stack cache directories** and compiled fresh: its reported warmups were **531.415 / 543.035 / 479.935 seconds** at 512×288 / 768×448 / 1024×576. These approximately **531 / 543 / 480-second cold times are not a unique new-Torch cost**. The first resolved Torch 2.13 baseline reported 508.599 / 475.462 / 518.688 seconds; cache provenance differs, so neither set establishes a causal old/new cold-compile penalty. Both sets' FPS was timed after their warmup. Sources: [late old-stack raw record](compute-original-stack-late-baseline.json), [first resolved new-stack record](compute-torch213-baseline-resolved.json), [dependency qualification](DEPENDENCIES.md).

In all tables, `FPS median [min–max]` summarizes three 100-frame repeats; `Warmup s` is the single reported eight-frame warmup. †Default means no explicit attention-backend field was recorded, not a measured kernel assertion.

**Initial baseline and resolution frontier — 15 cells**

The initial nine-cell baseline and six-cell frontier keep step count and resolution explicit. The 256×144 two-step cell reaches 49.49 compute FPS, but reducing spatial detail or denoising steps changes the output/quality tradeoff. It is not an equal-quality speedup. Frontier measurements ran later on the second host; they are not an interleaved scaling curve. Sources: [initial jobs](compute-jobs.json), [extended jobs](extended-compute-manifest.json).

| Source artifact / setting | Env | Size | Steps | Variant / attention | FPS median [min–max] | Warmup s |
|---|---|---|---:|---|---:|---:|
| [Initial baseline](compute-baseline.json) | O1 | 512×288 | 2 | baseline / default† | 28.88 [28.44–29.31] | 48.080 |
| [Initial baseline](compute-baseline.json) | O1 | 512×288 | 3 | baseline / default† | 22.47 [22.43–22.58] | 0.351 |
| [Initial baseline](compute-baseline.json) | O1 | 512×288 | 4 | baseline / default† | 18.08 [18.06–18.10] | 0.445 |
| [Initial baseline](compute-baseline.json) | O1 | 768×448 | 2 | baseline / default† | 13.98 [13.92–14.02] | 60.508 |
| [Initial baseline](compute-baseline.json) | O1 | 768×448 | 3 | baseline / default† | 10.63 [10.60–10.63] | 0.773 |
| [Initial baseline](compute-baseline.json) | O1 | 768×448 | 4 | baseline / default† | 8.68 [8.67–8.69] | 0.928 |
| [Initial baseline](compute-baseline.json) | O1 | 1024×576 | 2 | baseline / default† | 8.28 [8.28–8.30] | 121.416 |
| [Initial baseline](compute-baseline.json) | O1 | 1024×576 | 3 | baseline / default† | 6.34 [6.34–6.34] | 1.262 |
| [Initial baseline](compute-baseline.json) | O1 | 1024×576 | 4 | baseline / default† | 5.07 [5.07–5.08] | 1.561 |
| [Resolution frontier](compute-resolution-frontier.json) | O2 | 256×144 | 2 | baseline / default† | 49.49 [48.66–50.01] | 222.489 |
| [Resolution frontier](compute-resolution-frontier.json) | O2 | 256×144 | 3 | baseline / default† | 39.47 [39.19–39.68] | 0.207 |
| [Resolution frontier](compute-resolution-frontier.json) | O2 | 256×144 | 4 | baseline / default† | 32.43 [32.31–32.55] | 0.247 |
| [Resolution frontier](compute-resolution-frontier.json) | O2 | 1280×720 | 2 | baseline / default† | 4.84 [4.83–4.85] | 273.847 |
| [Resolution frontier](compute-resolution-frontier.json) | O2 | 1280×720 | 3 | baseline / default† | 3.66 [3.66–3.67] | 2.167 |
| [Resolution frontier](compute-resolution-frontier.json) | O2 | 1280×720 | 4 | baseline / default† | 2.91 [2.91–2.91] | 2.758 |

**Original-stack variants — 37 cells**

The first combined batch is 4.2% / 3.3% / 1.8% above its final baseline repeat; the secondary combined batch is 2.6% / 1.8% / 1.2% above its later secondary baseline repeat. The differing magnitudes illustrate batch variation. Constants alone, inference mode, VAE BF16 and compile-default do not show a consistent substantial benefit across all three sizes. These are sequential discovery comparisons, not promotion evidence. `combined` caches fixed-seed noise and the sigma schedule and removes intermediate stage synchronizations; `all-constants` also caches VAE normalization tensors. The attention-profile control collects 16 additional profiler frames only after its timed/correctness runs; its three reported FPS repeats are unprofiled.

| Source artifact / setting | Env | Size | Steps | Variant / attention | FPS median [min–max] | Warmup s |
|---|---|---|---:|---|---:|---:|
| [No stage sync](compute-no-sync.json) | O1 | 512×288 | 2 | no-stage-sync / default† | 28.22 [26.87–29.94] | 39.122 |
| [No stage sync](compute-no-sync.json) | O1 | 768×448 | 2 | no-stage-sync / default† | 14.54 [14.50–14.58] | 49.799 |
| [No stage sync](compute-no-sync.json) | O1 | 1024×576 | 2 | no-stage-sync / default† | 8.34 [8.33–8.36] | 67.871 |
| [Noise/sigma cache](compute-constants.json) | O1 | 512×288 | 2 | constants / default† | 28.61 [27.64–28.70] | 38.064 |
| [Noise/sigma cache](compute-constants.json) | O1 | 768×448 | 2 | constants / default† | 13.94 [13.92–14.16] | 54.264 |
| [Noise/sigma cache](compute-constants.json) | O1 | 1024×576 | 2 | constants / default† | 8.22 [8.21–8.25] | 65.089 |
| [Inference mode](compute-inference-mode.json) | O1 | 512×288 | 2 | inference-mode / default† | 29.06 [28.00–29.15] | 41.068 |
| [Inference mode](compute-inference-mode.json) | O1 | 768×448 | 2 | inference-mode / default† | 14.04 [14.00–14.11] | 52.720 |
| [Inference mode](compute-inference-mode.json) | O1 | 1024×576 | 2 | inference-mode / default† | 8.27 [8.24–8.27] | 65.993 |
| [Combined, first pod](compute-combined.json) | O1 | 512×288 | 2 | combined / default† | 30.05 [29.56–30.33] | 43.089 |
| [Combined, first pod](compute-combined.json) | O1 | 768×448 | 2 | combined / default† | 14.52 [14.39–14.53] | 41.475 |
| [Combined, first pod](compute-combined.json) | O1 | 1024×576 | 2 | combined / default† | 8.36 [8.35–8.38] | 58.565 |
| [Baseline repeat, first pod](compute-baseline-repeat.json) | O1 | 512×288 | 2 | baseline / default† | 28.85 [28.37–29.02] | 37.458 |
| [Baseline repeat, first pod](compute-baseline-repeat.json) | O1 | 768×448 | 2 | baseline / default† | 14.05 [14.04–14.15] | 75.794 |
| [Baseline repeat, first pod](compute-baseline-repeat.json) | O1 | 1024×576 | 2 | baseline / default† | 8.21 [8.18–8.22] | 68.867 |
| [Secondary baseline](compute-baseline-secondary.json) | O2 | 512×288 | 2 | baseline / default† | 28.33 [28.20–28.83] | 174.365 |
| [Secondary baseline](compute-baseline-secondary.json) | O2 | 768×448 | 2 | baseline / default† | 13.97 [13.85–14.08] | 322.626 |
| [Secondary baseline](compute-baseline-secondary.json) | O2 | 1024×576 | 2 | baseline / default† | 8.20 [8.18–8.22] | 312.638 |
| [VAE BF16](compute-vae-bf16.json) | O2 | 512×288 | 2 | baseline / default† | 28.75 [28.11–29.09] | 145.189 |
| [VAE BF16](compute-vae-bf16.json) | O2 | 768×448 | 2 | baseline / default† | 13.99 [13.77–14.02] | 190.078 |
| [VAE BF16](compute-vae-bf16.json) | O2 | 1024×576 | 2 | baseline / default† | 8.16 [8.12–8.22] | 163.740 |
| [Compile default](compute-compile-default.json) | O2 | 512×288 | 2 | baseline / default† | 27.89 [27.62–27.93] | 129.378 |
| [Compile default](compute-compile-default.json) | O2 | 768×448 | 2 | baseline / default† | 13.50 [13.48–13.77] | 144.916 |
| [Compile default](compute-compile-default.json) | O2 | 1024×576 | 2 | baseline / default† | 8.28 [8.17–8.28] | 117.327 |
| [Secondary combined](compute-combined-secondary.json) | O2 | 512×288 | 2 | combined / default† | 29.38 [29.34–30.16] | 36.893 |
| [Secondary combined](compute-combined-secondary.json) | O2 | 768×448 | 2 | combined / default† | 14.20 [14.16–14.28] | 46.686 |
| [Secondary combined](compute-combined-secondary.json) | O2 | 1024×576 | 2 | combined / default† | 8.34 [8.34–8.41] | 61.224 |
| [Secondary baseline repeat](compute-baseline-secondary-repeat.json) | O2 | 512×288 | 2 | baseline / default† | 28.64 [28.51–28.76] | 41.350 |
| [Secondary baseline repeat](compute-baseline-secondary-repeat.json) | O2 | 768×448 | 2 | baseline / default† | 13.95 [13.82–13.97] | 47.675 |
| [Secondary baseline repeat](compute-baseline-secondary-repeat.json) | O2 | 1024×576 | 2 | baseline / default† | 8.24 [8.21–8.25] | 58.088 |
| [VAE normalization cache](compute-vae-normalization-cache.json) | O2 | 512×288 | 2 | vae-constants / default† | 28.95 [28.52–29.25] | 45.656 |
| [VAE normalization cache](compute-vae-normalization-cache.json) | O2 | 768×448 | 2 | vae-constants / default† | 14.05 [13.85–14.14] | 48.869 |
| [VAE normalization cache](compute-vae-normalization-cache.json) | O2 | 1024×576 | 2 | vae-constants / default† | 8.22 [8.21–8.30] | 52.500 |
| [All constant caches](compute-all-constant-caches.json) | O2 | 512×288 | 2 | all-constants / default† | 29.64 [29.33–29.67] | 38.068 |
| [All constant caches](compute-all-constant-caches.json) | O2 | 768×448 | 2 | all-constants / default† | 14.14 [14.04–14.40] | 42.688 |
| [All constant caches](compute-all-constant-caches.json) | O2 | 1024×576 | 2 | all-constants / default† | 8.34 [8.32–8.36] | 57.196 |
| [Attention profile control](compute-attention-profile.json) | O2 | 512×288 | 2 | baseline / default† | 29.21 [29.19–29.29] | 35.618 |

**Dependency, FA4 and late controls — 27 cells**

The resolved new-stack, FA4 and confirmation/late-control jobs are separate sequential batches, retained separately. FA4 baseline attention does not show a consistent full-pipeline improvement over the native controls. FA4 plus combined changes two factors and lacks a same-batch native-combined control, so its difference cannot be assigned to FA4. Source and log review found CuTe/SM120 FA4 execution during full-pipeline warmup and no KV-processor bypass, but no measured-frame CUDA trace was collected; compilation-limit and empty-CUDA-graph warnings constrain claims about the kernel itself. See [FA4 evidence qualifications](DEPENDENCIES.md), [dependency manifest](dependency-retry-20260917-manifest.json) and [confirmation/late-control manifest](scaling-service-20260917-manifest.json).

| Source artifact / setting | Env | Size | Steps | Variant / attention | FPS median [min–max] | Warmup s |
|---|---|---|---:|---|---:|---:|
| [New stack, resolved baseline](compute-torch213-baseline-resolved.json) | N2 | 512×288 | 2 | baseline / default† | 29.80 [29.43–29.91] | 508.599 |
| [New stack, resolved baseline](compute-torch213-baseline-resolved.json) | N2 | 768×448 | 2 | baseline / default† | 14.56 [14.45–15.20] | 475.462 |
| [New stack, resolved baseline](compute-torch213-baseline-resolved.json) | N2 | 1024×576 | 2 | baseline / default† | 8.79 [8.77–8.87] | 518.688 |
| [New stack, resolved combined](compute-torch213-combined-resolved.json) | N2 | 512×288 | 2 | combined / default† | 31.24 [30.45–31.28] | 13.892 |
| [New stack, resolved combined](compute-torch213-combined-resolved.json) | N2 | 768×448 | 2 | combined / default† | 15.79 [15.65–15.98] | 32.667 |
| [New stack, resolved combined](compute-torch213-combined-resolved.json) | N2 | 1024×576 | 2 | combined / default† | 9.07 [9.01–9.07] | 41.854 |
| [FA4 environment, native](compute-flash4-env-native.json) | F4 | 512×288 | 2 | baseline / native | 28.71 [28.69–29.12] | 42.781 |
| [FA4 environment, native](compute-flash4-env-native.json) | F4 | 768×448 | 2 | baseline / native | 14.02 [13.98–14.05] | 42.702 |
| [FA4 environment, native](compute-flash4-env-native.json) | F4 | 1024×576 | 2 | baseline / native | 8.22 [8.20–8.24] | 51.470 |
| [FA4 attention](compute-flash4-transformer.json) | F4 | 512×288 | 2 | baseline / flash4 | 28.21 [27.98–28.56] | 121.296 |
| [FA4 attention](compute-flash4-transformer.json) | F4 | 768×448 | 2 | baseline / flash4 | 13.97 [13.94–14.01] | 103.411 |
| [FA4 attention](compute-flash4-transformer.json) | F4 | 1024×576 | 2 | baseline / flash4 | 8.22 [8.20–8.26] | 111.191 |
| [FA4 + combined](compute-flash4-transformer-combined.json) | F4 | 512×288 | 2 | combined / flash4 | 29.79 [29.14–29.89] | 56.991 |
| [FA4 + combined](compute-flash4-transformer-combined.json) | F4 | 768×448 | 2 | combined / flash4 | 14.32 [14.32–14.34] | 47.980 |
| [FA4 + combined](compute-flash4-transformer-combined.json) | F4 | 1024×576 | 2 | combined / flash4 | 8.40 [8.40–8.41] | 54.477 |
| [FA4 environment, native repeat](compute-flash4-env-native-repeat.json) | F4 | 512×288 | 2 | baseline / native | 29.21 [29.07–29.23] | 42.938 |
| [FA4 environment, native repeat](compute-flash4-env-native-repeat.json) | F4 | 768×448 | 2 | baseline / native | 13.80 [13.77–14.09] | 47.725 |
| [FA4 environment, native repeat](compute-flash4-env-native-repeat.json) | F4 | 1024×576 | 2 | baseline / native | 8.23 [8.19–8.24] | 48.099 |
| [New stack, baseline confirmation](compute-torch213-baseline-confirmation.json) | N2 | 512×288 | 2 | baseline / default† | 29.56 [27.93–29.74] | 14.387 |
| [New stack, baseline confirmation](compute-torch213-baseline-confirmation.json) | N2 | 768×448 | 2 | baseline / default† | 15.70 [15.38–15.96] | 32.703 |
| [New stack, baseline confirmation](compute-torch213-baseline-confirmation.json) | N2 | 1024×576 | 2 | baseline / default† | 8.88 [8.84–8.90] | 66.173 |
| [New stack, combined confirmation](compute-torch213-combined-confirmation.json) | N2 | 512×288 | 2 | combined / default† | 31.65 [30.77–31.72] | 8.523 |
| [New stack, combined confirmation](compute-torch213-combined-confirmation.json) | N2 | 768×448 | 2 | combined / default† | 15.80 [15.60–15.90] | 24.987 |
| [New stack, combined confirmation](compute-torch213-combined-confirmation.json) | N2 | 1024×576 | 2 | combined / default† | 9.00 [8.98–9.02] | 49.737 |
| [Old stack, late baseline](compute-original-stack-late-baseline.json) | O2 | 512×288 | 2 | baseline / default† | 28.37 [27.04–28.65] | 531.415 |
| [Old stack, late baseline](compute-original-stack-late-baseline.json) | O2 | 768×448 | 2 | baseline / default† | 14.09 [13.76–14.12] | 543.035 |
| [Old stack, late baseline](compute-original-stack-late-baseline.json) | O2 | 1024×576 | 2 | baseline / default† | 8.18 [8.12–8.23] | 479.935 |

**Content and prompt controls — 6 cells**

These O2 controls keep two steps and the original stack. Detailed-scene changes the synthetic input texture. Liquid and neon use the default waveform input with different cached prompt embeddings. Prompt encoding, interactive prompt switching and real audio responsiveness are outside these timing windows. The exact prompts below and in the CSV prevent pooling unlike content.

| Source artifact / setting | Env | Size | Steps | Variant / attention | FPS median [min–max] | Warmup s |
|---|---|---|---:|---|---:|---:|
| [Detailed input scene](compute-detailed-scene.json) | O2 | 512×288 | 2 | baseline / default† | 28.58 [28.23–28.87] | 47.378 |
| [Detailed input scene](compute-detailed-scene.json) | O2 | 768×448 | 2 | baseline / default† | 13.72 [13.43–13.84] | 58.638 |
| [Liquid prompt](compute-prompt-liquid.json) | O2 | 512×288 | 2 | baseline / default† | 29.26 [28.70–29.43] | 41.965 |
| [Liquid prompt](compute-prompt-liquid.json) | O2 | 768×448 | 2 | baseline / default† | 14.01 [13.85–14.14] | 62.872 |
| [Neon prompt](compute-prompt-neon.json) | O2 | 512×288 | 2 | baseline / default† | 28.66 [28.14–28.98] | 45.584 |
| [Neon prompt](compute-prompt-neon.json) | O2 | 768×448 | 2 | baseline / default† | 14.04 [13.95–14.05] | 46.113 |

Default prompt: `colorful abstract art, vibrant neon lights, psychedelic patterns`. Liquid prompt: `liquid chrome waves, flowing colorful reflections, high contrast abstract sculpture`. Neon prompt: `neon light trails forming fluid organic shapes, dark background, glowing cyan and magenta`.

**Correctness evidence and limits**

All 85 cells have a saved correctness record with `input_influence_observed: true`: changed and blank synthetic inputs produced outputs distinct from input A's output. This is evidence that the input affects the result, not a perceptual-quality score, temporal-coherence result or real-audio responsiveness test. JPEG compression measurements and correctness values remain in each CSV cell's `correctness_json` and the linked raw artifact.

Twenty-one cache/combined cells report `baseline_reference_mse: 0` for the in-process, uncompressed input-A reference; this includes both new-stack combined batches. It does not compare old-stack and new-stack images against each other, nor certify all frames or prompts as equivalent. The six FA4-selected cells report nonzero reference MSE. For FA4 baseline at the three main sizes these are 0.00101350 / 0.000589607 / 0.000317056; these are differences from the in-process native reference, not pass/fail perceptual thresholds. Samples still need visual review before a quality or promotion decision.

**Reconciliation**

The tables and CSV use the grouping and FPS checks from [summarize_results.py](../../../workers/runpod-flux2klein/bench/summarize_results.py): artifact, width, height, steps, variant and recorded attention backend. All 255 raw measured records reconcile to `frames / wall_seconds`; each of the 85 groups has repeat IDs 0–2, three 100-frame records and one correctness record. Minimum/maximum refer to repeat FPS; the CSV's `frame_ms_p95_*` fields summarize the three per-repeat frame-latency p95 values, not a pooled p95. No cells are merged across artifacts/environments, no partial record is counted twice, and no missing metadata is inferred as measured execution evidence.
