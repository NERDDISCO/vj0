# Further model and inference-engine investigation

Current follow-up measurements and implementation status are in [DEEP-DIVE.md](DEEP-DIVE.md). The source research below retains its original scope.

Research checked on **2026-09-17, approximately 19:45–19:51 UTC**. This is source inspection and experiment design, **not a new GPU benchmark**. No pod was started, no weights were downloaded, and no model or application defaults were changed. Existing measured outcomes remain in [RESULTS.md](RESULTS.md) and [STREAMDIFFUSION.md](STREAMDIFFUSION.md).

The strongest new model/precision lead in this research snapshot is **selective NVFP4 transformer computation**. It has real upstream weights and SM120 kernel implementations, but neither a speedup over our existing FP8 nor preserved visual quality is established. The official Klein 4B repository HEAD matched our measured revision when checked on September 17; this is not a claim that no better model exists. Several impressive realtime claims use interpolation, approximate reuse, different conditioning, or many more GPUs. The newer [execution priorities](NEXT-EXPERIMENTS.md) put measured input admission and profile-guided exact changes before lower precision.

## What this application actually asks the model to do

The current worker is more specific than generic image editing:

1. Encode each waveform image with the FLUX.2 VAE.
2. Blend its latent with fixed-seed noise: `alpha * image_latents + (1-alpha) * noise`.
3. Run two denoising steps using the supplied sigma schedule and cached prompt embeddings.
4. Decode with the already adopted FLUX.2 small decoder.

`generate()` explicitly supplies **`image=None`** to `Flux2KleinKVPipeline`. There are consequently no reference-image tokens to cache in this path. Prompt embeddings already have an LRU cache; a text-encoder speedup primarily affects a new prompt, not steady-state FPS. [Local worker](../../../workers/runpod-flux2klein/inference_server.py).

This distinction matters when evaluating engines: accepting an image-edit HTTP request does not establish support for our custom initial latents, sigma schedule, two-step behavior, fixed seed, small decoder, and cached prompt embeddings. Replacing this with instruction-based reference editing changes the visual transformation even if both use Klein weights.

## Ranked next experiments

Ranking weighs likely relevance, integration work, and preservation of the current look. None of the unmeasured rows carries a promised FPS gain.

| Priority | Concrete candidate | What it could improve | Quality and applicability | Next falsifiable test |
|---|---|---|---|---|
| 1 | Selective NVFP4 on the existing Klein transformer | Lower matrix-multiplication time and weight traffic, especially if the denoiser dominates 768/1024 | Same model family; lower precision changes numerics. Keep sensitive layers and the existing VAE/decoder at their current precision. | Native SM120 kernel microcheck at actual matrix sizes, then paired FP8/NVFP4 full-frame runs and matched audio-driven clips. |
| 2 | Export/compile the existing small decoder or a fixed-shape denoiser subgraph | Fewer launches/fusions or a better backend without selecting a different model | Same weights and computation; numerical differences still require checking. CUDA graphs and compilation already exist, so the available margin may be small. | Profile the submodule first; compare an executed TensorRT engine with the present compiled module, including transfers and real output validation. |
| 3 | Small in-flight batch or denoising-stage batching using the same Klein math | Better GPU utilization and weight reuse | Per-frame math can be preserved, but waiting to form a batch raises latency; altered reduction order can change samples. | Batch 1 versus 2 with source identities, queued age and unique generated FPS. Reject throughput bought by excessive age. |
| 4 | Diffusers' newly merged tensor parallelism, only if single-frame latency is the target | Two GPUs can cooperate on one frame rather than independently generating different frames | No intentional quality reduction, but FP8/compile compatibility and communication costs are unknown. | First check topology and peer bandwidth; compare against the already effective independent-worker configuration at equal GPU count. |
| 5 | FluxRT-style spatial token reuse | Skip computation in apparently unchanged regions | Approximate across frames. A changed waveform can influence the entire output through attention, so a static input background is not proof of a static generated background. | Disable interpolation; compare sparse motion, whole-frame motion, beat impulses, prompt edits and cuts against an uncached reference. |
| 6 | Different distilled model or task-specific distillation | Potentially a larger speed change than runtime tuning | Changes the learned visual behavior. A separate visual-quality study is mandatory. | A small matched clip comparison before any new streaming adapter or large benchmark matrix. |

At 512×288, an inference gain may be hidden behind the browser/input limit. At 768×448 and 1024×576, GPU compute remains the more relevant throughput target. Useful FPS must count fresh, temporally ordered generations; display interpolation is a separate metric.

## 1. NVFP4 is a real candidate, not a guarantee

BFL publishes [FLUX.2-klein-4b-nvfp4](https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-nvfp4), a quantized version of the same 4B model. Its checked repository revision is `1db2b2f776c24b76f1122e5f69ab1949fc620068` (last modified February 24). A compact checkpoint alone does not establish native low-bit execution; a loader can expand it and erase the intended performance benefit.

TorchAO exposes `NVFP4DynamicActivationNVFP4WeightConfig`, while FlashInfer's current [`mm_fp4` documentation](https://docs.flashinfer.ai/generated/flashinfer.gemm.mm_fp4.html) explicitly selects its `b12x` path on SM120 before other backends. FlashInfer's latest release checked via its API was [v0.6.18.post1](https://github.com/flashinfer-ai/flashinfer/releases/tag/v0.6.18.post1), September 5. This is a plausible route for the RTX PRO 6000, not an assumption that B200 binaries work unchanged.

The [PyTorch diffusion quantization study](https://pytorch.org/blog/faster-diffusion-on-blackwell-mxfp8-and-nvfp4-with-diffusers-and-torchao/) uses **B200**, different models and BF16 baselines. Its Flux.1 batch-one NVFP4 latency is 1.41 seconds versus 2.10 seconds BF16; reported mean LPIPS is 0.44, compared with 0.11 for MXFP8. Those are neither Klein results nor gains over our FP8 baseline. They support selective quantization and perceptual testing, not a blanket “no quality loss” claim.

Our experiment should retain current input JPEG, resolution, steps, alpha, seed, decoder and prompt embeddings. Quantize a bounded group of high-cost linears first, compare against the current FP8 path, and expand only if both timing and clips pass. A GPU trace must show native FP4 GEMM, with finite outputs at every actual sequence shape. A historical [SM120 shape-dependent zero-output bug](https://github.com/flashinfer-ai/flashinfer/issues/3398) is closed, but is a concrete reason to validate several shapes instead of treating an import as a successful integration.

Hardware distinction: [NVIDIA lists](https://developer.nvidia.com/cuda/gpus) RTX PRO 6000 Blackwell as compute capability 12.0, separately from B200's 10.0. Do not transfer datacenter-Blackwell kernel requirements or benchmark ratios to SM120 without checking.

## 2. Current weights and newer Diffusers code

The official [Klein 4B model API](https://huggingface.co/api/models/black-forest-labs/FLUX.2-klein-4B) returned **`e7b7dc27f91deacad38e78976d1f2b499d76a294`**, exactly the revision already measured. Last modification: February 24. This verifies the current model repository, rather than assuming a new release from a fresh article.

Diffusers main was `7221eef4573574925b67a69e9fc1482bf093e569`, September 17. A direct comparison with our `160852de680d36117e0a787f7f8b718232539abb` pin found:

- The KV pipeline's only file change is a dtype/device cast for reference-image VAE normalization. Our `image=None` path does not use that helper, and the local custom encoder already casts its normalization tensors.
- Transformer changes are mainly Neuron compatibility, documentation and tensor-parallel sharding/reshape support. This inspection found no newly added single-GPU Klein kernel that justifies promising a large upgrade.

Sources: [pinned KV pipeline](https://github.com/huggingface/diffusers/blob/160852de680d36117e0a787f7f8b718232539abb/src/diffusers/pipelines/flux2/pipeline_flux2_klein_kv.py), [current KV pipeline](https://github.com/huggingface/diffusers/blob/7221eef4573574925b67a69e9fc1482bf093e569/src/diffusers/pipelines/flux2/pipeline_flux2_klein_kv.py), [current transformer](https://github.com/huggingface/diffusers/blob/7221eef4573574925b67a69e9fc1482bf093e569/src/diffusers/models/transformers/transformer_flux2.py).

[Tensor parallelism PR #13718](https://github.com/huggingface/diffusers/pull/13718) merged August 19. It is newly available relative to the pin, but two independent workers already scale throughput well here. Splitting one small, two-step frame across PCIe GPUs can lose to communication overhead. Its distinct potential benefit is lower per-frame inference latency, and that must be measured separately from aggregate throughput.

## 3. Klein 9B-KV's reference-token cache does not apply to this path

The official [9B-KV model](https://huggingface.co/black-forest-labs/FLUX.2-klein-9b-kv) is real and supports reference-image editing. BFL's cache avoids recomputing reference tokens after the first step. The [published comparison](https://github.com/black-forest-labs/flux2/blob/main/docs/flux2_klein_kv_cache.md) varies the number of 1024×1024 reference images and the output size; it is not a comparison with our two-step, no-reference-token Klein 4B path.

Inference for vj0: switching to 9B-KV adds a larger model while the present request has no reusable reference tokens. Switching the waveform into reference-image conditioning would be a new visual mode. It could be interesting for precise instruction editing or multiple static references, but it is not the first route to preserving today's look at higher FPS.

## 4. FluxRT: useful ideas, incompatible FPS headline

[FluxRT](https://github.com/tensorforger/FluxRT/tree/32206e8255b085b9075e05d389781bcbc728d513) is a same-Klein realtime project, checked at `32206e8255b085b9075e05d389781bcbc728d513` (June 13). It includes spatial reuse, RIFE interpolation and optional tiny-VAE/latent-upscaler paths. It deserves code study, but its advertised display rates cannot be imported into our generated-FPS table.

Concrete source finding: [`run_benchmark.py`](https://github.com/tensorforger/FluxRT/blob/32206e8255b085b9075e05d389781bcbc728d513/scripts/run_benchmark.py) calculates `1 / processing_time` and then multiplies by `2 ** interpolation_exp`. The checked [benchmark configuration](https://github.com/tensorforger/FluxRT/blob/32206e8255b085b9075e05d389781bcbc728d513/configs/benchmark_config.json) sets `interpolation_exp=2`, so the reported rate includes a **4× interpolation multiplier**. It also uses 576×320 and tests different fractions of changing input. It does not count unique generated outputs over a common observation window as our app harness does.

Its [spatial cache implementation](https://github.com/tensorforger/FluxRT/blob/32206e8255b085b9075e05d389781bcbc728d513/src/fluxrt/stream_processor/transformer_flux2.py) stores token-level outputs and K/Vs across frames; masks select updates. This is a potentially large optimization precisely because it skips model work, but skipped globally interacting tokens can change the result. For our audio-driven scene, preservation must include the response outside the thin waveform, not merely its local edges. Periodic full refresh and immediate invalidation on prompt/settings/cuts would be necessary experimental controls.

Interpolation could make presentation smoother, but a 15→60 FPS interpolated stream still contains 15 newly inferred responses per second. It may also require future-frame buffering. It is not an increase in image-model inference rate and should not be used to claim one.

## 5. Engine comparison without a wholesale migration

| Engine | Verified upstream situation | Consequence for this project |
|---|---|---|
| SGLang Diffusion | Klein image editing and multiple quantized component formats exist. Its current quantization documentation distinguishes actual compute formats from weight-only storage. | Evaluate a single resident transformer component or kernels first. Port our initial latent/sigma/small-decoder behavior explicitly before calling an engine comparison equivalent. |
| TensorRT / TensorRT-LLM visual generation | NVIDIA's published FLUX.2 optimization study is for **dev**, with FP4, compilation, caching and multi-GPU changes combined. The TensorRT Klein feature request remains open. | A custom small-decoder/denoiser export is plausible; turnkey equivalent Klein support was not established by this research. Our successful StreamDiffusion TensorRT decoder does not establish a Klein transformer speedup. |
| Nunchaku | FLUX.2 runtime PR #926 remains **open and unmerged**; the author points to separate 4B/9B quantized weights. | A source-branch prototype is possible, but this is not verified release support. Prefer the narrower TorchAO/FlashInfer test before taking on another runtime. |

Sources: [SGLang quantization](https://github.com/sgl-project/sglang/blob/72d9419bef89177b9cae7af6e3d751d9825cc471/docs/docs/sglang-diffusion/quantization.mdx), [NVIDIA FLUX.2 dev study](https://developer.nvidia.com/blog/scaling-nvfp4-inference-for-flux-2-on-nvidia-blackwell-data-center-gpus/), [TensorRT issue #4712](https://github.com/NVIDIA/TensorRT/issues/4712), [Nunchaku PR #926](https://github.com/nunchux-ai/nunchaku/pull/926).

SGLang's [progressive-resolution example](https://github.com/sgl-project/sglang/blob/main/docs/docs/sglang-diffusion/progressive_resolution.mdx) reports a denoising-loop speedup for **30-step** Klein at 1024² on an RTX A6000. Our two-step schedule has very little room to distribute coarse and fine phases; changed resolution during denoising can also change composition. The published ratio is not applicable as a free two-step speedup.

## 6. Different model directions and the quality constraint

The already completed StreamDiffusionV2 experiments remain the most directly relevant streaming alternative. They use distilled causal **Wan 2.1 video models**, in 1.3B and 14B sizes, from `jerryfeng/StreamDiffusionV2` (`wan_causal_dmd_v2v` and `wan_causal_dmd_v2v_14b`). The fast 1.3B path changes the visual behavior, while the tested 14B transformation is slower. At 512×288, the real TensorRT paced test had approximately 190 ms p95 simulated source age before transport in direct single-GPU mode; it is incorrect to dismiss every Stream setting as having more than a second of latency. See [model identity, measured results and sample limitations](STREAMDIFFUSION.md).

Other compact/few-step families remain research options, not equivalent replacements:

- [SANA-Sprint](https://github.com/NVlabs/Sana) targets fast one/few-step text-to-image with a different transformer and latent representation. Its published speed does not establish our continuous waveform conditioning or Klein-level scene behavior.
- [DMD2](https://github.com/tianweiy/DMD2) publishes one/four-step SDXL and a four-step T2I-adapter example. It gives a concrete route to conditioned distilled image generation, but the visual model and denoising schedule differ from ours. It is also older research, not a newly discovered Klein successor.
- Task-specific distillation could train a smaller/fewer-step student on our current teacher's waveform-driven outputs. That is the direction most explicitly aligned with preserving this application's look, but it requires training data, training runs and held-out temporal evaluation. A speedup and generalization across prompts cannot be assumed.

## Acceptance criteria for the next GPU session

Freeze a short fixture set containing sparse waveforms, dense/high-frequency audio, abrupt impulses, silent holds, a detailed background, three different prompts and a hard scene cut. Save the exact input JPEG bytes and prompt embeddings so the candidate sees the same inputs.

For math-preserving changes, compare intermediate tensors and raw decoded images in-process before JPEG. For quantization/cache/model changes, compare paired clips for texture, color, composition, motion, response to impulses and stale/frozen regions. LPIPS or PSNR can detect changes but cannot prove artistic equivalence; compare against same-stack repeat variation and inspect the clips.

Run interleaved warm controls and candidate repeats at 512×288, 768×448 and 1024×576, followed by actual app tests only for survivors. Record unique generated/received/projector frames, source order, p50/p95/p99 age, first-result and prompt-change recovery, and cold compilation separately. Preserve failures and negative outcomes. An option that wins raw GPU FPS but loses freshness or the current visual response is not an accepted performance improvement.
