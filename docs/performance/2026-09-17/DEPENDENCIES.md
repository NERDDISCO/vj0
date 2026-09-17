# Dependency candidates researched on 2026-09-17

The frozen image uses torch 2.11.0+cu128, torchao 0.17.0+cu128 and diffusers
`160852de680d36117e0a787f7f8b718232539abb`. Keep that environment intact.

A separate G07 candidate should test torch 2.13.0 with CUDA 13.2 and torchao
0.18.0, retaining the pinned diffusers source and transformers 5.7.0 initially.
PyTorch publishes 2.13.0 wheels for CUDA 13.0 and 13.2; TorchAO's 0.18 release
notes say its release CI is pinned to PyTorch 2.13 and remove the legacy v1
quantized tensor/layout stack. Verify the current Float8 configuration path and
actual quantization instead of treating an import/fallback as successful FP8.
Do not change the pod's host driver. Import/forward-pass and performance tests
remain pending; these versions are candidates, not measured wins.

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
