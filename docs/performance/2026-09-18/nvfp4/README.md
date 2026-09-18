# N05: selective NVFP4 study completed

Native NVFP4 works on the assigned SM120 GPU, but the two selective full-model
variants provide only small gains while changing the output images. Retain FP8
for the current setup; no production change or app FPS gain is claimed.

- Median matched compute gains: **+0.25% to +1.38%**, with regressions in some pairs.
- All 108 candidate images differ; the worst cases visibly change dark-scene brightness and color detail.
- All nine native-kernel proofs, 162 finite image cases, 36 timing cells and three exact returns to FP8 completed.
- The initial CUDA-graph workspace failure and missing-SciPy assessment failure are preserved; reviewed setup corrections did not rerun completed inference measurements.

See [full-model results, numbers and visual evidence](MODEL-RESULTS.md),
[machine-readable summary](model-summary.json), [independent numerical and visual review](review-model.json), and the [original plan](PLAN.md).
The following representative-layer gate is narrower than full-frame performance.

## Previously completed native kernel gate

The explicit FlashInfer `b12x` NVFP4 path ran correctly on the RTX PRO 6000
Blackwell SM120 using real Klein image-feed-forward inputs at all three sizes.
This proves the native kernel works for these shapes. **This layer-only result does not establish full-frame speed or visual quality.**

| Input resolution | Image FFN layer | FP8 median GPU time | NVFP4 median GPU time | Microbenchmark ratio |
|---|---|---:|---:|---:|
| 512×288 | input projection | 0.12573 ms | 0.08605 ms | 1.461× |
| 512×288 | output projection | 0.10876 ms | 0.07606 ms | 1.430× |
| 768×448 | input projection | 0.29084 ms | 0.16487 ms | 1.764× |
| 768×448 | output projection | 0.24008 ms | 0.15952 ms | 1.505× |
| 1024×576 | input projection | 0.42272 ms | 0.25507 ms | 1.657× |
| 1024×576 | output projection | 0.47761 ms | 0.27883 ms | 1.713× |

Each row has five alternating paired CUDA-graph trials, 100 replays per trial,
including dynamic activation quantization. FP8 is the existing TorchAO layer
invoked eagerly and captured into a graph; this is not the whole compiled
transformer. These are selected layers, so the ratios cannot be extrapolated
to full inference or app FPS. Other layers may have different characteristics.
Cold VAE compilation and diagnostic/oracle work are outside microtiming.

All six outputs were finite/nonzero. The separately dequantized mathematical
oracle's normalized RMSE was 3.48e-5–5.92e-5. Each saved trace contains three
native kernel launches explicitly naming `dense_blockscaled_gemm_sm120_b12x`
and `f4E2M1FN`; the version and implementation source hashes are pinned.
There is no dense-BF16 matmul fallback in the measured callable. Against FP8,
the layer activation error is much larger: normalized RMSE 9.70–10.83%.
That measures quantization changes, not image quality, and is why image/temporal
review remains mandatory. [Raw result](kernel-05/result.json),
[source/count consistency check](kernel-consistency.json).

The control uses Torch 2.13.0+cu132/TorchAO 0.18.0+cu132, native 128 CPU threads,
the unchanged Klein 4B revision `e7b7dc27f91deacad38e78976d1f2b499d76a294`
and small-decoder revision `a3efc24f613ef42d9428af62fdbd6f5fd8856c4a`.
The source-guarded terminal skip and GPU conversion stay enabled. The full-model
comparison used its same-environment FP8 control; these numbers do not compare
the newer environment against the older production stack.

The kernel run finished 2026-09-18 at 07:57:41 UTC. GPU compute and its process
group were confirmed absent afterward. The later exclusive full-model slot
completed within its one-hour cap, including corrections and assessment.
[Kernel idle evidence](kernel-05-idle.json), [full-model results](MODEL-RESULTS.md).

The earlier failed attempts are retained: network-volume JIT-cache I/O,
missing isolated-venv `PATH`, CUDA library-layout mismatch, and a profiler-symbol
qualification correction. None is presented as a model-quality failure or a
speed result. Exact source snapshots preserve both probe versions.
