# StreamDiffusionV2 comparison preparation

Inspected official source at commit
`6961a5cf2045d1dda05a04ef229698bdc04e873a` (2026-09-14), package version 0.1.1.
Source: https://github.com/chenfengxu714/StreamDiffusionV2

## Model and actual processing behavior

- Start with `Wan-AI/Wan2.1-T2V-1.3B` plus the distilled causal video-to-video
  checkpoint `jerryfeng/StreamDiffusionV2`, folder `wan_causal_dmd_v2v`.
- The 14B alternative uses the Wan2.1 14B base plus `wan_causal_dmd_v2v_14b`;
  upstream credits CausVid-Plus for its offline 14B model.
- This is a video pipeline with temporal state. It is not a faster FLUX.2 loader.
- Current default source resolution is 832x480; the API accepts width/height.
  Validate smaller identical-to-Klein sizes before treating them as supported.
- `num_frame_per_block=1` in the standard config; `chunk_size=4` video frames.
  The initial chunk contains five input frames. Future chunks contain four.
  At a 30 FPS source, simply collecting four frames takes approximately 100 ms
  from first to fourth frame (133 ms between four-frame chunk arrivals), before
  processing. Capture age must include this, not just frames/compute-second.
- Modes `single` and `single-wo` respectively use stream batching and the
  non-batched single-GPU path. Measure both. `single` can return no decoded output
  for intermediate chunks while filling the denoising pipeline.
- Standard denoising schedule is `[700, 500, 400, 200, 0]`; `step=1..4` selects
  that many nonterminal entries and retains terminal zero. These steps and its
  `noise_scale` are not numerically equivalent to Klein's step count and alpha.
- Optional TAEHV uses `madebyollin/taehv`'s `taew2_1.pth` decoder.
- Latest inspected commit fixes streaming RoPE position refresh. Pin this commit
  instead of assuming the PyPI wheel contains the same fix.

## Environment isolation

The package pins torch 2.6.0, torchvision 0.21.0, torchaudio 2.6.0,
diffusers 0.35.1, transformers 4.54.0, and numpy 1.24.4. Its README separately
instructs Blackwell users to install torch 2.11.0 / torchvision 0.26.0.
Those are incompatible with the unmodified package's strict torch metadata.

Use a dedicated Python 3.11 environment on `/workspace/envs/streamv2`, with an
explicit dependency override for torch/torchvision/torchaudio compatible with the
pod's driver. Do not upgrade/downgrade `/app`'s Klein environment. Record the
resolved versions, override file, and successful forward pass. Treat upstream's
optional FlashAttention package separately; it is not required for the initial
correctness run and its old pin needs Blackwell compatibility verification.

## Measurement sequence

1. Download the pinned 1.3B base/causal checkpoints to the test pod only.
2. Smoke-test official encode_chunk -> denoise_chunk -> decode_chunk API with a
   deterministic waveform video. Retain input and output clips.
3. Measure first output after model load and separately cold load time.
4. Measure sequential chunk processing at 832x480, then matching Klein sizes if
   supported. Report all produced output frames divided by wall time, exact
   output count, chunk-time distribution, and memory. Exclude model loading and
   file writing from steady-state compute time; include VAE encode and decode.
5. Repeat with arrival-paced input at 30 FPS and record capture-to-output age,
   including chunk collection and pipeline fill. Offline processing FPS alone
   does not establish live responsiveness.
6. Compare steps 1/2/3/4, single/single-wo, default VAE/TAEHV. Keep noise scale
   fixed initially; then separately assess waveform influence and continuity.
7. Only investigate 14B after the 1.3B path works and memory/runtime is understood.
8. Any live integration prototype is a separate experimental backend. Do not
   replace the app's default or redesign its UI.

Status: the funded pod now has the isolated Python 3.11.16 environment at
`/workspace/envs/streamv2`. Import passed with torch 2.11.0+cu128; the base Klein
environment is unchanged. Explicit torch/vision/audio overrides resolved the
upstream strict metadata. Both checkpoint downloads completed at pinned revisions:

- Wan 1.3B: `37ec512624d61f7aa208f7ea8140a131f93afc9a`.
- StreamDiffusionV2 causal checkpoint: `2373eb2b39278b3a1aa174964a724ee78ead96f0`.

Source is at `/workspace/streamdiffusionv2-20260917`; download identities are in
its `checkpoint-revisions.json`. The first GPU smoke result is recorded below;
steady-state comparisons and live frame age remain pending.

## First GPU smoke result

The pinned API completed at native 832x480, two steps, single mode, standard VAE,
initial noise scale 0.8, without FlashAttention installed (PyTorch SDPA fallback).
It produced 13 valid RGB frames from 17 input frames: a four-frame output
shortfall. Input/output retention and drain have not been directly verified. Model construction took about 97 seconds after
imports. The first cold forward pass took 3.86 seconds total, with its first
five output frames after 3.02 seconds. This short cold trial is a correctness
result, not a steady-state performance claim. CPU control-flow checks finished
while the model was still loading, before the timed forward pass.

See `streamv2-smoke.json`, `samples/streamv2-smoke-{input,output}.mp4`, and
`samples/streamv2-smoke-quality.jpg`. For this black-background waveform and
abstract-art prompt, the output mostly preserves/recolors the line; it does not
create the rich abstract scene seen from Klein. Follow-up trials should test
higher noise scale and a detailed background as well as the decoder/step modes.
The API adapts noise scale downward based on adjacent-frame changes; the raw
records contain effective values. New trials also record the adaptive timestep.

## Acceleration scope checked in upstream source

The current TensorRT implementation accelerates the TAEHV decoder only, not
Wan's denoising transformer. `fast=True` additionally changes KV-cache/sink
configuration; treat it as a quality/context tradeoff. The current smoke run
uses neither TensorRT nor FlashAttention. A TensorRT installation is not yet
validated on this pod.

TAEHV follow-ups use `taew2_1.pth` from official repository commit
`011dfc2112197741c540e0bdd5b7b67bcc930771`. The download job records its SHA-256
before use. The [official TAEHV documentation](https://github.com/madebyollin/taehv)
identifies these weights for Wan2.1 and notes a quality tradeoff against the full
VAE. Prepared job arguments are in `stream-jobs.json`; preparation is not a
measured outcome.


## Extended queue and compatibility decisions

The complete follow-up is `stream-extended-jobs.json`: standard/TAEHV,
single/single-wo, 1–4 steps, noise strength and detailed input; simulated 30 FPS
arrivals; a separately pinned 14B comparison; decoder TensorRT/fast; and matching
512x288/1024x576 sizes. Job preparation is not a measured result.

Arrival-mode age is tracked through the actual rolling latent positions and
validated decoded counts. It represents simulated input capture to decoded
output, excluding network, browser display and audio acquisition. Until those
checks pass, no numeric capture-age claim is valid.

The 14B base revision is `a064a6c71f5be440641209c07bf2a5ce7a2ff5e4`.
Its approximately 57 GB of base shards use the separate 80 GB container disk;
the approximately 28.6 GB causal checkpoint uses `/workspace`. T5/VAE assets
are shared with 1.3B only after matching actual SHA-256 against the 14B repo's
published LFS hashes. This avoids counting the shared storage server's `df`
capacity as the pod's volume allowance.

TensorRT 11 removed `BuilderFlag.FP16`, which this pinned upstream exporter
uses. The isolated decoder experiment therefore selects the compatible 10.x
release `10.16.1.11`; it does not silently port the upstream exporter or change
Klein's environment. See [NVIDIA's Python migration guide](https://docs.nvidia.com/deeplearning/tensorrt/latest/api/migration/tensorrt-10x-to-11x-python-api-patterns.html).

## Extended measured comparisons

Warm offline 832x480, same one-GPU PRO 6000, two steps:
1.3B standard decoder 13.58–13.84 FPS; TAEHV 20.64–21.06 FPS.
One-step TAEHV reaches 27.33–27.87 FPS; four-step TAEHV 12.94–13.20 FPS.
These counts include pipeline fill/tail shortfalls; they are decoded outputs,
not interpolated frames or browser display rates. Cold first clips are separate.

The 14B model loads successfully. Standard decoder warm throughput is
6.45–6.50 FPS, TAEHV 7.68–7.71 FPS. Peak allocated memory is approximately
61.5 GB / 59.6 GB respectively (decimal GB, reserved memory is higher).
Its noise-0.95 samples transform the simple waveform into stronger flowing
rainbow imagery; 1.3B at 0.8–1.0 mainly recolours/preserves the waveform.
These visual differences are why the model FPS figures are not equal-quality
FLUX speedups. Full raw records are in `stream-results/`.

TAEHV's first decode removes the frame-zero anchor latent. With 65 inputs and
two steps, `single` emits 60 frames (one omitted anchor plus four undrained tail
frames), while `single-wo` emits 64. The paced-input harness initially asserted
the standard VAE's count and failed explicitly; the corrected reruns use
source indices 1–4 for the first TAEHV output and preserve the verified rolling
latent mapping for subsequent chunks.
