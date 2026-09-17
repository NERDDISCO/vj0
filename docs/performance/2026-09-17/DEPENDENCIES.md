# Dependency candidates researched on 2026-09-17

The frozen image uses torch 2.11.0+cu128, torchao 0.17.0+cu128 and diffusers
`160852de680d36117e0a787f7f8b718232539abb`. Keep that environment intact.

The isolated G07 environment successfully runs torch 2.13.0 with CUDA 13.2 and
torchao 0.18.0, retaining pinned diffusers and transformers 5.7.0.
PyTorch publishes 2.13.0 wheels for CUDA 13.0 and 13.2; TorchAO's 0.18 release
notes say its release CI is pinned to PyTorch 2.13 and remove the legacy v1
quantized tensor/layout stack. Verify the current Float8 configuration path and
actual quantization instead of treating an import/fallback as successful FP8.
Do not change the pod's host driver. FP8 import/forward and repeated compute tests passed. Combined warm FPS is
about 31–32 / 15.8 / 9.0 at 512×288 / 768×448 / 1024×576. All 27 live
transport comparisons are complete: combined one-GPU received medians are
31.52 / 15.97 / 9.03 and two-GPU medians 57.21 / 31.48 / 18.08. Latency variation
and paired results are in [NEWSTACK.md](NEWSTACK.md). The app soak is running;
no dependency default is promoted.
Fresh-cache compilation is expensive on both old and new stacks; the late old
control used the new cache directory accidentally, so its cold run must be
labelled separately from previously warm-cache controls.

Sources:
- https://pytorch.org/get-started/previous-versions/
- https://github.com/pytorch/ao/releases/tag/v0.18.0

The WebRTC package's published 0.10.0 is another isolated dependency candidate;
the image declares ^0.8.0. Record the actually resolved native package version
before comparing it. Do not replace the whole transport architecture.

Sources:
- https://www.npmjs.com/package/@roamhq/wrtc
- https://github.com/WonderInventions/node-webrtc

For P06, unordered reliable delivery can be compared with ordered reliable.
Do not promote partial reliability on the existing shared image/settings channel:
lost settings would need a separately acknowledged control mechanism. The
current strict untagged warmup-drain test also requires delivery of all inputs.
Source: https://www.w3.org/TR/webrtc/#dom-rtcdatachannelinit

StreamDiffusionV2's published 64.52 FPS (1.3B) and 58.28 FPS (14B) headline
measurements use **four H100 GPUs**, not one RTX PRO 6000. They are not directly
comparable to this one-GPU smoke test. Source:
https://arxiv.org/abs/2511.07399

Our first StreamDiffusionV2 run explicitly reported FlashAttention missing and
used PyTorch SDPA. An attention-extension experiment must verify SM120 support
and ABI compatibility rather than installing an arbitrary prebuilt wheel.
Official SM120 support discussion:
https://github.com/Dao-AILab/flash-attention/issues/2307

## FA4 integration experiment

The isolated environment uses official `flash-attn-4==4.0.0b31` and
`kernels==0.12.3` while retaining the baseline Torch/Diffusers stack. The kernel
numerical check and full-pipeline native/FA4/combined/native-repeat jobs passed.
The initial native medians were 28.707 / 14.021 / 8.224 FPS; FA4 measured
28.215 / 13.974 / 8.223. These are this integration's end-to-end compute results,
not a claim that the standalone FA4 kernel is universally slower.

Source and log review found no KV-processor bypass. Both processors forward the
selected backend, and the FA4 job logs contain CuTe execution/JIT evidence naming
`FlashAttentionForwardSm120`. This proves the path was reached during full-pipeline
warmup. A measured-frame CUDA trace was not collected for these FA4 jobs.
Compilation-limit and empty-CUDA-graph warnings further constrain conclusions
about the underlying kernel. No attention backend was promoted.

Primary sources:
- https://github.com/Dao-AILab/flash-attention/releases/tag/fa4-v4.0.0.beta31
- https://github.com/Dao-AILab/flash-attention/releases/tag/fa4-v4.0.0.beta5
- https://github.com/Dao-AILab/flash-attention/blob/main/flash_attn/cute/README.md
