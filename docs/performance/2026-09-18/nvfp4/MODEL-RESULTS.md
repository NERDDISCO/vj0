# Selective NVFP4 full-model results

The two selective NVFP4 configurations ran successfully, but their full-frame
benefit was small and their images changed. I recommend retaining FP8 for this
setup. This is a precision/performance judgment, not a newly invented numerical
acceptance threshold. The [independent visual review](review-model.json) also
accepts neither configuration as an appearance-preserving replacement.
No production default, live application or UI was changed.

## Paired full-frame compute

Same process, Torch 2.13.0+cu132/TorchAO 0.18, native 128 CPU threads, the unchanged
Klein 4B checkpoint and small decoder, terminal skip and GPU output conversion.
Every arm uses `recompile_limit=64`; these controls are not the production default of 8
results and do not measure an old-stack→new-stack improvement. Timing includes
JPEG85 input decode, VAE encode, generation, output JPEG80 and synchronized CUDA
completion. It excludes prompt encoding, image saving, metrics, IPC and WebRTC.

Each row has three alternating matched pairs of 100 frames. FPS columns are arm
medians; gains and ranges are calculated from matched pairs, so the median gain
need not equal the ratio of the two displayed medians.

| Resolution | NVFP4 layers | FP8 median FPS | Candidate median FPS | Median paired gain | Paired gain range |
| --- | --- | ---: | ---: | ---: | ---: |
| 512×288 | Five image FFN inputs | 42.79 | 43.09 | +0.69% | −4.72% to +0.99% |
| 512×288 | Ten image FFN inputs/outputs | 43.39 | 43.49 | +0.25% | −0.51% to +1.21% |
| 768×448 | Five image FFN inputs | 22.04 | 22.28 | +1.38% | +0.15% to +1.58% |
| 768×448 | Ten image FFN inputs/outputs | 22.17 | 22.27 | +0.47% | −1.12% to +1.06% |
| 1024×576 | Five image FFN inputs | 13.03 | 13.19 | +1.35% | +1.19% to +1.84% |
| 1024×576 | Ten image FFN inputs/outputs | 13.03 | 13.10 | +0.53% | +0.37% to +0.71% |

The earlier 1.43–1.76× representative-layer speed ratios did not translate into a
similar whole-frame gain. Only a selected subset of image FFNs changes here;
attention, text FFNs, twenty fused single-stream blocks and VAE remain at their
control precision. This pilot does not establish the performance or quality of
whole-model NVFP4 or a differently quantized checkpoint. No app FPS benefit was
measured.

## Image and temporal evidence

All 162 image cases passed raw pre-clamp decoder finiteness and global RNG checks.
Each configuration covers three resolutions, three prompts, two seeds and three
input states at two steps and alpha 0.1. All 108 candidate images differ from their
matched FP8 images. A scalar perceptual metric is descriptive, not visual
acceptance.

| Configuration | Candidate fixtures | PSNR min / median / max (dB) | LPIPS min / median / max |
| --- | ---: | --- | --- |
| Five image FFN inputs | 54 | 17.58 / 32.35 / 58.59 | 0.00046 / 0.00598 / 0.06409 |
| Ten image FFN inputs/outputs | 54 | 15.68 / 30.96 / 57.99 | 0.00050 / 0.00803 / 0.13700 |

The [worst-case comparison](model-worst-case-comparison.png) deliberately selects
high-error fixtures rather than claiming they are typical. It shows visible
brightness/contrast and color-detail changes in dark neon scenes, especially for
the ten-layer variant. These are aesthetic changes, not proof that every image
is perceptually worse. Given the modest compute gains, they do not justify
changing the current look by default.

Nine 12-frame deterministic sequences cover silence, thin/dense waveforms, an
abrupt beat and a scene cut. All four repeated-input transitions in every paired
sequence retained identical candidate output, so no new variation appeared on
these held inputs. Changes between distinct states still differ from FP8.
These short fixed-input sequences are not a live-audio stability or long-session
WebRTC test. Paired lossless WebP previews place FP8 left and NVFP4 right:

- [512, five layers](model-02/paired-512x288-image_ff_in.webp) / [512, ten layers](model-02/paired-512x288-image_ff_both.webp)
- [768, five layers](model-02/paired-768x448-image_ff_in.webp) / [768, ten layers](model-02/paired-768x448-image_ff_both.webp)
- [1024, five layers](model-02/paired-1024x576-image_ff_in.webp) / [1024, ten layers](model-02/paired-1024x576-image_ff_both.webp)

## Execution and retained failures

All nine untimed compiled traces show the expected native launch count: zero for
FP8, five for input-only and ten for input/output conversion at every resolution.
The kernel symbols name the pinned SM120 `b12x` implementation and FP4 operand
type. After both candidate swaps, returning to FP8 reproduced exact pixels and
JPEG bytes at each resolution. Alternatives coexist in memory, so memory
statistics are comparison-process figures, not standalone deployment footprints.

The first model attempt failed before any timing. Pinned FlashInfer source
creates a globally retained 32 MiB workspace on the first `mm_fp4` call. That
call occurred during the first compiled candidate warmup, consistent with the
reported untracked CUDA-graph-pool allocation error.
The independently reviewed correction creates that exact cache buffer on the
actual selected GPU before compiled frames. Kernel arithmetic, graph correctness
checks and all comparison settings remain unchanged. The retry completed all
nine configurations. The first failure's specific allocation pointer was not
identified directly; the cause remains a source-supported explanation reinforced
by the successful bounded correction.
[Source review](review-workspace-preinit.json),
[pinned workspace call](https://github.com/flashinfer-ai/flashinfer/blob/8bc3b578027791336c6ae87db5c9d76f82cef8bc/flashinfer/gemm/gemm_base.py),
[pinned cache ownership](https://github.com/flashinfer-ai/flashinfer/blob/8bc3b578027791336c6ae87db5c9d76f82cef8bc/flashinfer/utils.py).

The completed model phase was followed by an assessment import failure because
SciPy was missing from the earlier LPIPS `--no-deps` installation. Installing
`scipy==1.17.1 --no-deps` added only SciPy according to the preserved pip log.
Before/after distribution inventories match on existing names, but their
name-keyed dictionaries collapse duplicate inherited system-site entries. They
are not independent attestations of the imported venv versions. The completed
model records Torch2.13/TorchAO0.18 via `metadata.version`, and assessment uses the
same pinned venv executable. SciPy's declared NumPy range includes the installed
2.4.4. The unchanged analyzer then completed in 16.26 seconds.
No inference timing was repeated. [Official dependency metadata](https://pypi.org/pypi/scipy/1.17.1/json),
[package verification](full-model-operations/assessment-dependency-verification.json).

A cross-attempt reproducibility limitation remains: all 18 saved 512×288 FP8
control images from the original process and the corrected retry differ, with
pixel MSE 18.56–220.63 and maximum channel error 79–222. The cause is unresolved;
these data do not establish that workspace initialization alone caused the
difference, nor that it preserves exact images across processes. The two control
cohorts stay separate. Model-02's same-process candidate comparisons and three
exact returns to its own FP8 outputs remain valid. No additional timed run was
used to select a more favorable control.

The original one-hour deadline was preserved across both corrections. The
assessment finished 10:14:58 UTC, before the 10:49:43 deadline. GPU compute and owned
process groups were absent before releasing the slot. All 387 artifacts,
98,216,854 bytes, were downloaded and checked against remote SHA256/byte counts
before the next GPU workload began.

## Reproducible evidence

- [Independent numerical/proof/visual audit](review-model.json) and its [selected panels](review-model-panels/selection.json). All PNG, timing and temporal delta metrics were recomputed; LPIPS values were checked for source binding, coverage and finiteness but the metric network was not independently rerun.
- [Raw completed model](model-02/result.json), [assessment](model-02/assessment.json), [derived summary](model-summary.json).
- [Failed first model](model-01/result.json); logs and package changes in [operations](full-model-operations/).
- [Original frozen source manifest](model-frozen-sources/sha256.json) and [corrected manifest](model-frozen-sources-v2/sha256.json).
- [Download verification](full-model-operations/download-verification.json); full remote file manifest remains beside it.
- [Original bounded plan](PLAN.md) and [preparation review](review-preparation.json).
