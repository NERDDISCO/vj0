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
its `checkpoint-revisions.json`. No StreamDiffusionV2 GPU forward pass, FPS or
quality result has been measured here yet.
