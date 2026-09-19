#!/usr/bin/env python3
"""Logo legibility test, driven directly against the worker's own pipeline
code (inference_server.setup_pipeline / encode_image_to_latents / generate)
so the numbers match production, minus torch.compile (eager is fine for a
one-off image dump)."""
import os, sys, json, time
os.environ.setdefault("COMPILE_MODE", "default")
sys.path.insert(0, "/app")
import torch
# Eager: skip the 2-3 min per-shape JIT compile — output pixels are identical.
torch.compile = lambda m, *a, **k: m
import inference_server as srv
from PIL import Image

IN_DIR = "/tmp/logo-frames"; OUT_DIR = "/tmp/logo-out"
W, H, N_STEPS, SEED = 512, 288, 4, 42
ALPHAS = [0.10, 0.20, 0.35, 0.50]
PROMPTS = {
  "neon": "cyberpunk neon abstract waveform, vibrant colors, glowing edges",
  "forest": "misty pine forest in early morning, sunlight filtering through fog, cinematic",
  "chrome": "liquid chrome metallic sculpture, studio lighting, black background, high contrast",
}
os.makedirs(OUT_DIR, exist_ok=True)
pipe = srv.setup_pipeline()
embeds = {}
for tag, p in PROMPTS.items():
    r = pipe.encode_prompt(prompt=p, device="cuda", num_images_per_prompt=1, max_sequence_length=64)
    embeds[tag] = r[0] if isinstance(r, tuple) else r
inputs = sorted(f for f in os.listdir(IN_DIR) if f.endswith(".jpg"))
lat = {}
for f in inputs:
    img = Image.open(os.path.join(IN_DIR, f)).convert("RGB")
    lat[f] = srv.encode_image_to_latents(pipe, img, W, H)
results = []
for tag in PROMPTS:
    for alpha in ALPHAS:
        for f in inputs:
            t0 = time.perf_counter()
            out = srv.generate(pipe, lat[f], embeds[tag], alpha, N_STEPS, H, W, SEED)
            torch.cuda.synchronize()
            ms = (time.perf_counter() - t0) * 1000
            name = f"{f[:-4]}__{tag}__a{alpha:.2f}.jpg"
            out.save(os.path.join(OUT_DIR, name), quality=90)
            results.append({"input": f, "prompt": tag, "alpha": alpha, "out": name, "ms": round(ms, 1)})
            print(name, f"{ms:.0f}ms", flush=True)
json.dump(results, open(os.path.join(OUT_DIR, "results.json"), "w"), indent=1)
print("DONE", len(results), flush=True)
