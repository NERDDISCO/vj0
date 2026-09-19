# Logo legibility through FLUX.2 Klein img2img — 2026-09-18

**Question:** if an artist logo (SVG or PNG with alpha) is composited into
the source canvas, does it survive the img2img restyle well enough to read
on stage?

**Answer: no, not at the alpha range that produces AI visuals.** Logos need
a second, crisp overlay pass on top of the AI output. The source pass is
still worth keeping because the model riffs on the logo's silhouette.

## Setup

- Pod: 1× RTX 5090, EU-RO-1, image `nerddisco/vj0-flux2klein-worker:latest`
  (fp8 transformer + VAE, same code path as production via
  `inference_server.setup_pipeline / encode_image_to_latents / generate`,
  eager instead of `torch.compile` — pixels are identical).
- Resolution 512×288 (shipped default), 4 steps, seed 42.
- Inputs: a scene-like background (magenta ring + cyan/amber bars) with a
  logo composited at "large" (≈70 % of frame height) and "small"
  (≈25 %, bottom-right corner). Three logos: a white geometric monogram
  (SVG), a `NERDDISCO` wordmark with a magenta pill outline (SVG), and a
  cyan glow badge with soft alpha edges (PNG).
- Sweep: alpha ∈ {0.10, 0.20, 0.35, 0.50} × prompts {neon waveform, misty
  forest, liquid chrome}. 84 generations, ~110 ms each eager.
- Driver: `logo_direct.py` (runs on the pod, needs `/tmp/logo-frames/*.jpg`).

## Results

| alpha | what happens to the logo |
|---|---|
| 0.10 (default) | Fully absorbed. The ring becomes an ECG scope, the wordmark pill becomes a waveform box, the forest prompt fills the ring with trees. Only the coarse silhouette position survives. |
| 0.20 | Shapes survive, text scrambles (`IERDDISCI`, `IBRODISCL`), colours shift. Reads as "a logo-shaped thing", not the logo. |
| 0.35 | Legible — but the frame is essentially the input with a colour cast. The AI is no longer doing anything useful. |
| 0.50 | Pass-through. |
| small logos | Destroyed at 0.10–0.20; text still garbled at 0.35–0.50 (too few latent pixels at 512×288). |

Contact sheets (rows: prompt, columns: source, α0.10, α0.20, α0.35, α0.50):

- `sheet-monogram_large.jpg`
- `sheet-wordmark_large.jpg`
- `sheet-wordmark_small.jpg`
- `sheet-glow-badge_large.jpg`

End-to-end from the app (three logos, placement `both`, α0.10, neon prompt):

- `e2e-ai-frame-raw.jpg` — what the worker returns: neon silhouettes.
- `e2e-ai-frame-with-overlay.jpg` — what the output stage shows: the
  same frame with the overlay pass drawn on top.

## What shipped because of this

`image` elements in the composer carry a `placement` property:

- `source` — drawn into the input canvas only (restyled, silhouette only)
- `overlay` — drawn crisp on top of the AI output only
- `both` — default for logos; the model riffs on the shape and the crisp
  logo sits on top

The overlay is rendered on the output stage (`OutputStage.tsx`) and
forwarded to the projector tab as resolved items on the stage
BroadcastChannel (`StageOverlayMsg`), so audio-bound logo properties stay
in sync with the preview.

## Pod gotchas hit during the run

- The `WARMUP_SHAPES` background warmup holds the GPU lock per shape.
  On a pod with no network volume the remaining 8 shapes compile for
  ~20 min after `inferenceReady:true`, and frames queue behind each
  compile. The parent process shows 0 % GPU and frozen CPU time because
  Inductor compiles in subprocesses — it looks hung but is not.
- The `jtgc1lxkx3` network volume referenced in `snipe-pod.sh` no longer
  exists on the account; pods start from a cold cache.

## Cutout overlay (2026-09-19)

The flat overlay looked like a sticker. Replaced with a cutout: the AI
frame shows through the logo shape (boosted, tinted toward the logo by
the element's `mix` property), soft dark halo outside, rim glow in the
element colour. `mix` is audio-bindable; 0 = pure window, 1 = flat logo,
default 0.45 (`cutout-mix-variants.jpg` shows 0.25 / 0.45 / 0.65).

- `cutout-output-stage.jpg` — real code path on the output stage
- `cutout-projector-stage.jpg` — same overlay on `/vj/stage`, letterboxed
  to the frame's contain box

Verified without a pod: `mock-rtc.js` replaces `RTCPeerConnection` in the
page with a fake that answers every frame with a static JPEG served from
a local helper. Inject it, then connect + generate as normal. Use this for
any UI work over AI output; only boot a pod when the question is about
what the model produces.

### Mask placement

`placement: mask` turns the logo into a window over the whole output:
black plate, logo shape punched out (destination-out, alpha-aware), AI
visuals only inside the logo. `mix` fades the flat logo back in. Not fed
to the AI. Enabling/disabling the element (inspector, pill, Launchpad
`toggle logo` pad) drops the whole output into and out of the logo.
`mask-output-stage.jpg` is the real code path with the mocked frame.

### Recording

Recordings capture the output composite (AI frame at an integer upscale
to ≥1920 long side + the overlay re-rendered at that size) whenever AI
frames are showing, and the input canvas otherwise. `mask-recording-frame.png`
is a frame from a 1920×1080 MP4 recorded through the mock.
