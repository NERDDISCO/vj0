# Next Optimizations — FLUX.2 Klein on RTX 5090

> Current production: **50.67 fps dual-GPU @ 256²/4-step** (39 ms/frame single-GPU)
> VRAM: 12.3 GB / 32 GB per GPU

Everything below is ordered by expected impact / effort ratio.

---

## 1. Worker auto-respawn & deadlock watchdog

**Priority: HIGH (reliability, not speed)**
**Effort: ~2 hours**

The `reduce-overhead` CUDA graph mode can deadlock both Python workers (all threads stuck on `futex_wait_queue`, 0% GPU util). This happened in production on 2026-05-01 — workers went silent after a WebRTC disconnect/reconnect, 20,000+ frames dropped until manual restart.

**What to do:**
- Add a heartbeat/watchdog in `server.js`: if a worker has `framePending > 0` but produces no output for N seconds (e.g. 10s), kill and respawn it
- On worker `close` event, auto-respawn with fresh `spawnWorker(gpu)` instead of just marking `ready = false`
- Log deadlock detection events for post-mortem analysis
- Consider adding a `/restart` HTTP endpoint for remote recovery without SSH

---

## 2. fp8 KV-cache

**Priority: MEDIUM**
**Effort: 1-2 days**
**Expected gain: ~3-5% throughput**

Klein's KV cache is currently bf16. Quantizing it to fp8 would reduce memory bandwidth pressure during attention, especially at higher resolutions where the cache is larger.

**What to do:**
- Patch Klein attention to use fp8 KV storage (torchao or manual cast)
- Quality validation: run the 63-generation correctness suite (3 prompts x 3 inputs x 7 alphas)
- Measure MSE drift vs bf16 baseline — must stay below 0.005 for VJ use
- Benchmark at 256², 384², 512² — gain should be larger at higher res

**Why deferred:** The gain is small at 256² (our production target) where KV is tiny. Worth doing if we move to 384²+ or need the last few percent.

---

## 3. Client-side frame interpolation (RIFE / FILM)

**Priority: MEDIUM (UX improvement)**
**Effort: 2-3 days**
**Expected gain: 2-4x display FPS (100-200 fps perceived)**

The server generates ~25 fps per GPU. Client-side optical flow interpolation can synthesize intermediate frames to hit 60-120 fps display rate. This is a perception win, not a latency win.

**What to do:**
- Evaluate RIFE-lite or FILM WASM/WebGL builds for in-browser interpolation
- Insert between WebRTC frame receive and canvas render in `VJApp.tsx`
- Must run under 8ms per interpolated frame to hit 120fps budget
- Graceful degradation: if interpolation is too slow, pass through raw frames
- Consider Web Workers to keep interpolation off the main thread

**Tradeoff:** Adds 1 frame of display latency (interpolation needs frame N and N+1). Fine for VJ visuals, not for interactive tools.

---

## 4. torch.compile `fullgraph=True`

**Priority: LOW**
**Effort: 1-2 days**
**Expected gain: speculative ~3-5%**

Currently Klein's attention processor causes graph breaks. `fullgraph=True` would eliminate all graph breaks, letting the compiler optimize the entire forward pass as one fused kernel sequence.

**What to do:**
- Profile current graph breaks: `TORCH_LOGS=graph_breaks python3 inference_server.py`
- Refactor Klein attention to be compile-friendly (remove data-dependent branching)
- Benchmark with `fullgraph=True` vs current
- Risk: may expose new shape-specialization issues with CUDA graphs

---

## 5. Persistent CUDA streams — pipeline overlap

**Priority: LOW**
**Effort: 2-3 days**
**Expected gain: uncertain, ~5-15% if it works**

Currently each frame is fully serial: decode input → VAE encode → transformer → VAE decode → JPEG. With persistent streams, we could overlap:
- VAE encode of frame N+1 while transformer processes frame N
- JPEG encoding while VAE decode runs

**What to do:**
- Separate VAE encode, transformer, and VAE decode onto different CUDA streams
- Use stream synchronization (events) to enforce data dependencies
- May conflict with `reduce-overhead` CUDA graphs — needs careful testing
- Benchmark actual overlap vs serialized to measure real gain

**Why uncertain:** The transformer dominates (~24ms of ~30ms total). VAE encode is only ~6ms. Even perfect overlap only saves ~6ms, and CUDA graph mode may prevent it.

---

## 6. AOT-Inductor (ahead-of-time compiled .pt2 artifacts)

**Priority: LOW (operational, not throughput)**
**Effort: 1 day**
**Expected gain: 0% throughput, ~30-60s faster cold start**

AOT-Inductor pre-compiles the torch.compile output into standalone `.pt2` files. Runtime loads them directly, skipping the ~30-150s compile phase on each pod boot.

**What to do:**
- Export `.pt2` for each warmup shape (512x288, 288x512)
- ~3.8 GB per shape on disk
- Load via `torch._export.aot_load()` at startup
- Store on network volume alongside model weights

**Why deferred:** Cold start isn't a bottleneck in our workflow (pod stays warm for hours). Only matters if we move to ephemeral/serverless deploys.

---

## 7. Resolution-adaptive step count

**Priority: LOW (quality tuning)**
**Effort: half day**

Higher resolutions have more redundant computation per step. We could use fewer steps at 512² (2-3) while keeping 4 at 256².

**What to do:**
- Benchmark quality at 512²/2-step vs 512²/4-step — if VJ-acceptable, auto-select
- Add a lookup table in `inference_server.py`: `{256: 4, 384: 3, 512: 2}`
- Client doesn't need to change (server picks optimal steps)

---

## 8. Batch inference (multiple frames per forward pass)

**Priority: EXPERIMENTAL**
**Effort: 2-3 days**
**Expected gain: unknown, may regress**

With 12.3 GB VRAM used out of 32 GB, there's headroom for batch_size=2. If the transformer scales sub-linearly with batch size, we get more throughput.

**What to do:**
- Test batch_size=2 at 256²: does it fit in 32 GB?
- Measure latency per frame in batch vs single — must beat round-robin
- Issue: CUDA graphs (`reduce-overhead`) are shape-specialized; batch=2 needs separate warmup
- Issue: frame pairing — need to buffer 2 input frames before dispatching, adding latency

**Why experimental:** Round-robin across GPUs already achieves near-linear scaling without batching complexity. Batch only wins if kernel utilization is low (unlikely at 256²).

---

## Ruled Out (don't revisit)

| Technique | Verdict | Details |
|---|---|---|
| SageAttention v1/v3 | Dead | Not torch.compile-traceable, -22% to -69% regression |
| TeaCache / FORA / H2-Cache | Dead | Data-dependent skips break CUDA graphs |
| max-autotune compile | Dead | OOM on Blackwell sm_120 (101 KB smem limit) |
| Float8WeightOnlyConfig | Dead | Dequant cost > VRAM savings |
| Pruna smashed model | Dead | Incompatible with transformers 5.x |
| xDiT distributed | Dead | No NVLink, PCIe bottleneck, round-robin already saturates |
| ControlNet + Klein | Dead | 9937 ms/frame due to memory offloading |

---

*Last updated: 2026-05-02*
*See BENCH-2026-04-30.md for full benchmark methodology and raw numbers.*
*See RESULTS.md for the original 11x optimization journey.*
