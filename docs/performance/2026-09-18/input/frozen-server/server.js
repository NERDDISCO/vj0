process.env.WARMUP_SHAPES ||= "512x288,768x448,1024x576";
/**
 * WebRTC server with FLUX.2 Klein img2img inference.
 *
 * Spawns N Python `inference_server.py` workers (one per GPU). Frame requests
 * are round-robined; state changes (prompt/seed/resolution/etc.) are broadcast
 * to every worker so they all stay in sync. Each worker is pinned to its own
 * GPU via CUDA_VISIBLE_DEVICES.
 *
 * env vars:
 *   PORT              — HTTP signaling port (default 3000)
 *   INFERENCE_SCRIPT  — path to Python worker (default ./inference_server.py)
 *   WORKER_COUNT      — number of inference workers; defaults to torch's
 *                       cuda.device_count (auto-detected on startup; capped to 8).
 *                       Set to "1" to force the legacy single-GPU behavior.
 *   ICE_SERVERS_JSON  — STUN/TURN servers for WebRTC
 *   ICE_GATHER_TIMEOUT_MS
 */
const express = require("express");
const wrtc = require("@roamhq/wrtc");
const { spawn, execSync, exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const os = require("os");

// Async siblings of the sync helpers we use in the /telemetry path. The
// telemetry endpoint MUST NOT use execSync / readFileSync / statSync —
// the dispatcher and the WebRTC data channel share this event loop, and
// nvidia-smi under inference load can take 200–500 ms per call. A
// blocked event loop = stalled frame relay = visible fps drop. Use
// these async versions exclusively in /telemetry.
const execAsync = promisify(exec);
const readFileAsync = promisify(fs.readFile);
const statAsync = promisify(fs.stat);

// Prevent node from crashing on unhandled errors — log and continue.
// WebRTC peer teardown and worker pipe errors are the usual culprits.
process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT]", err.message, err.stack);
});
process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED_REJECTION]", reason);
});

const PORT = Number(process.env.PORT || 3000);
const INFERENCE_SCRIPT = process.env.INFERENCE_SCRIPT || "./inference_server.py";
const ICE_GATHER_TIMEOUT_MS = Number(process.env.ICE_GATHER_TIMEOUT_MS || 10000);

// Auto-detect GPU count if WORKER_COUNT not set
function detectGpuCount() {
  if (process.env.WORKER_COUNT) {
    const n = Number(process.env.WORKER_COUNT);
    if (Number.isFinite(n) && n >= 1) return Math.min(n, 8);
  }
  try {
    const out = execSync("nvidia-smi --query-gpu=index --format=csv,noheader", {
      encoding: "utf8",
      timeout: 5000,
    });
    const n = out.trim().split("\n").filter(Boolean).length;
    return Math.max(1, Math.min(n, 8));
  } catch {
    console.warn("nvidia-smi not available; defaulting to 1 worker");
    return 1;
  }
}

const WORKER_COUNT = detectGpuCount();
let BENCH_ACTIVE_WORKERS = WORKER_COUNT;

// State-changing fields a client message may set on a worker. If a message
// carries any of these, we broadcast that subset to ALL workers so they stay
// in sync. Frame data (`image_base64`) is the only field that gets routed
// round-robin to a single worker.
const STATE_FIELDS = ["prompt", "seed", "alpha", "n_steps", "width", "height",
                      "captureWidth", "captureHeight", "jpegQuality"];

// Optional benchmark envelope: "VJ0B" + uint32 frame ID + JPEG. Ordinary JPEG
// clients retain their existing wire format. Echo IDs only for tagged requests.
const BENCH_FRAME_MAGIC = 0x564a3042;

// Drop outbound frames if the WebRTC DataChannel buffer exceeds this many bytes.
// Live VJ wants newest-wins; stale frames in flight clog the channel.
// 1MB ≈ 30 frames of buffered output at 256² JPEG.
let MAX_OUTBOUND_BUFFER = Number(process.env.MAX_OUTBOUND_BUFFER || 1024 * 1024);
let droppedOutbound = 0;
// Internal capture order applies to raw JPEG clients as well as tagged probes.
// Independent GPUs can finish in the opposite order to dispatch. Never deliver
// an older source after a newer one; keep the counter across client epochs.
let nextSourceSequence = 0;
let lastSentSourceSequence = 0;

// Latest known compile status per worker. Used to replay state to a client
// that connects mid-compile (so the overlay shows up immediately instead of
// staring at a frozen "connected" canvas with no idea why nothing is happening).
const latestCompileByWorker = new Map();

function getIceServers() {
  const raw = process.env.ICE_SERVERS_JSON;
  if (!raw) return [{ urls: "stun:stun.l.google.com:19302" }];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

// ---------------- worker pool ---------------- //

/** @type {Array<{proc: any, gpu: number, ready: boolean, stdoutBuf: string, framePending: number}>} */
const workers = [];
let roundRobinIdx = 0;

// Latest known state, accumulated from broadcasts. Replayed to each worker
// when it transitions to READY so workers that come up late don't end up
// stuck at default state while their peers are at the user's actual config.
// Without this, worker A and worker B can drift if the client sends a state
// change between A.READY and B.READY — round-robin dispatch then alternates
// good/bad frames.
const latestState = {};

function spawnWorker(gpu) {
  console.log(`[worker ${gpu}] spawning (CUDA_VISIBLE_DEVICES=${gpu})`);
  const env = { ...process.env, CUDA_VISIBLE_DEVICES: String(gpu), WORKER_ID: String(gpu) };
  const proc = spawn("python3", [INFERENCE_SCRIPT], {
    stdio: ["pipe", "pipe", "inherit"],
    env,
  });
  const w = { proc, gpu, ready: false, stdoutBuf: "", framePending: 0, lastFrameAt: 0,
    compileStartedAt: 0, compileFinishedAt: 0, pendingStartedAt: 0 };
  workers.push(w);

  proc.stdout.on("data", (chunk) => {
    w.stdoutBuf += chunk.toString();
    let nl;
    // Process complete lines only — frames are large base64 payloads,
    // chunks may split mid-line.
    while ((nl = w.stdoutBuf.indexOf("\n")) >= 0) {
      const line = w.stdoutBuf.slice(0, nl);
      w.stdoutBuf = w.stdoutBuf.slice(nl + 1);
      if (!line) continue;
      handleWorkerLine(w, line);
    }
  });

  proc.on("close", (code) => {
    w.ready = false;
    w.latestMailboxFlight = null;
    console.log(`[worker ${gpu}] exited code=${code}, respawning in 3s...`);
    if (latestCompileByWorker.has(w.gpu)) {
      handleWorkerLine(w, JSON.stringify({ status: "compile_failed", message: `worker exited (${code})` }));
    }
    w.ready = false;
    w.framePending = 0;
    flushLatestMailbox();
    // Auto-respawn: remove dead worker, spawn fresh one after a brief delay
    // so the GPU has time to release resources.
    setTimeout(() => {
      const idx = workers.indexOf(w);
      if (idx >= 0) workers.splice(idx, 1);
      console.log(`[worker ${gpu}] respawning now`);
      spawnWorker(gpu);
    }, 3000);
  });

  proc.on("error", (err) => {
    console.error(`[worker ${gpu}] error:`, err);
    w.ready = false;
  });
}

// Latest-input mailbox experiment: one physical request per worker and one
// newest waiting input globally. Included only by latest_mailbox.py.
let latestMailboxEnabled = process.env.LATEST_INPUT_MAILBOX !== '0';
let latestMailboxWaiting = null;
let latestMailboxFlushing = false;

function clearLatestMailbox(reason) {
  if (latestMailboxWaiting) {
    diagStats.mailboxCleared = (diagStats.mailboxCleared || 0) + 1;
    diagStats.mailboxLastClearReason = reason;
  }
  latestMailboxWaiting = null;
}

function configureLatestMailbox(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
  // Baseline boot requests can contain both old images and old settings. A
  // later READY replay must not overwrite newer mailbox-era input or state.
  if (pendingBootstrap.length > 0) {
    throw new Error('Drain all bootstrap requests before changing mailbox policy');
  }
  if (workers.some(w => w.framePending > 0 || w.latestMailboxFlight)) {
    throw new Error('Drain all worker requests before changing mailbox policy');
  }
  clearLatestMailbox('policy changed');
  latestMailboxEnabled = enabled;
  return { enabled, effectiveMaxPending: enabled ? 1 : MAX_PENDING_PER_WORKER,
    waitingCapacity: enabled ? 1 : 0 };
}

function flushLatestMailbox() {
  if (!latestMailboxEnabled || latestMailboxFlushing || !latestMailboxWaiting) return;
  if (latestMailboxWaiting.client_epoch !== activeClientEpoch || activeChannel?.readyState !== 'open') {
    clearLatestMailbox('client unavailable');
    return;
  }
  latestMailboxFlushing = true;
  try {
    // A failed stdin write marks that worker unavailable. Try another worker
    // without admitting another frame or waiting for a future browser tick.
    for (let attempt = 0; attempt < workers.length && latestMailboxWaiting; attempt++) {
      const w = nextReadyWorker();
      if (!w) return;
      const frame = latestMailboxWaiting;
      w.latestMailboxFlight = frame;
      if (dispatchFrameUnbuffered(frame, w)) {
        latestMailboxWaiting = null;
        diagStats.mailboxDispatched = (diagStats.mailboxDispatched || 0) + 1;
      } else {
        w.latestMailboxFlight = null;
      }
    }
  } finally {
    latestMailboxFlushing = false;
  }
}

function dispatchFrame(frameMsg) {
  if (!latestMailboxEnabled) return dispatchFrameUnbuffered(frameMsg);
  if (frameMsg.client_epoch !== activeClientEpoch) return false;
  if (latestMailboxWaiting) {
    diagStats.mailboxReplaced = (diagStats.mailboxReplaced || 0) + 1;
  }
  latestMailboxWaiting = Object.freeze({ ...frameMsg });
  flushLatestMailbox();
  return true;
}

function sendToLatestMailbox(req) {
  // State is retained even before the first worker is ready, while image
  // memory stays bounded. The ordinary bootstrap array remains unused here.
  const stateOnly = {};
  for (const key of STATE_FIELDS) if (key in req) stateOnly[key] = req[key];
  if (Object.keys(stateOnly).length) broadcastState(stateOnly);
  if (req.image_base64) {
    dispatchFrame({ image_base64: req.image_base64, source_seq: ++nextSourceSequence,
      client_epoch: req.client_epoch ?? activeClientEpoch,
      ...(req.frame_id !== undefined ? { frame_id: req.frame_id } : {}) });
  }
}

function isMailboxCompletion(msg) {
  return msg.status === 'frame' || msg.status === 'frame_dropped' ||
    (msg.frame_dropped && (msg.status === 'error' || msg.status === 'compile_failed'));
}

function mailboxMessageMatches(w, msg) {
  const flight = w.latestMailboxFlight;
  if (!flight || msg.client_epoch !== flight.client_epoch) return false;
  // Existing worker error/drop messages have an epoch but no source_seq.
  // The one-request invariant makes that acknowledgement unambiguous.
  // Invalid/missing source on a frame is still passed to the ordinary handler
  // to count/reject the protocol violation and release this occupied slot.
  return !Number.isSafeInteger(msg.source_seq) || msg.source_seq < 1 || msg.source_seq === flight.source_seq;
}

function finishLatestMailboxMessage(w, msg) {
  if (!latestMailboxEnabled) return;
  if (msg.status === 'compiling') clearLatestMailbox('compile started');
  if (isMailboxCompletion(msg) && mailboxMessageMatches(w, msg)) {
    const flight = w.latestMailboxFlight;
    w.latestMailboxFlight = null;
    // Ordinary handling deliberately ignores old-client accounting. During
    // reconnect we preserve physical occupancy until its real completion.
    if (flight.client_epoch !== activeClientEpoch) {
      w.framePending = Math.max(0, w.framePending - 1);
    }
  }
  if (msg.status === 'shutdown') w.latestMailboxFlight = null;
  if (isMailboxCompletion(msg) || ['ready', 'warmed', 'compile_failed', 'shutdown'].includes(msg.status)) {
    flushLatestMailbox();
  }
}

function handleWorkerLine(w, line) {
  let msg;
  try { msg = JSON.parse(line); }
  catch {
    console.log(`[worker ${w.gpu} raw]`, line.slice(0, 200));
    return;
  }

  if (latestMailboxEnabled && isMailboxCompletion(msg) && !mailboxMessageMatches(w, msg)) {
    diagStats.mailboxUnmatched = (diagStats.mailboxUnmatched || 0) + 1;
    return;
  }
  try {
  if (msg.log) {
    console.log(`[worker ${w.gpu}]`, msg.log);
    return;
  }
  // Boot phase events from inference_server.py (loading_weights, applying_fp8,
  // registering_compile_stubs, loaded). Forward to the WebRTC client so the
  // overlay can show "Loading the AI model" during the ~140s safetensors load
  // instead of a silent "preparing workers" placeholder.
  if (msg.status === "phase") {
    console.log(`[worker ${w.gpu}] phase=${msg.stage} est=${msg.est_seconds || "?"}s`);
    if (activeChannel?.readyState === "open") {
      activeChannel.send(JSON.stringify({
        type: "phase",
        stage: msg.stage,
        est_seconds: msg.est_seconds,
        elapsed_ms: msg.elapsed_ms,
        worker: w.gpu,
      }));
    }
    return;
  }
  if (msg.status === "ready") {
    console.log(`[worker ${w.gpu}] READY`);
    w.ready = true;
    // Replay the latest known state into this worker. Without this, a worker
    // that came up after its peer received a state change is stuck at default
    // settings (e.g. 256x256) while peers are at the user's actual config
    // (e.g. 288x512), and round-robin dispatch alternates good/bad frames.
    if (Object.keys(latestState).length > 0) {
      try {
        w.proc.stdin.write(JSON.stringify(latestState) + "\n");
        console.log(`[worker ${w.gpu}] replayed latest state: ${Object.keys(latestState).join(",")}`);
      } catch (e) {
        console.error(`[worker ${w.gpu}] state replay failed:`, e.message);
      }
    }
    flushPendingForWorker(w);
    return;
  }
  // Compile status messages — forward to WebRTC client so the UI can show
  // a "compiling 512x288..." overlay during the ~150s JIT cost on shape change.
  // Also remember the latest status per worker so a client that connects
  // mid-compile gets the overlay immediately (replayed in pc.ondatachannel).
  if (["compiling", "compiling_progress", "warmed", "compile_failed"].includes(msg.status)) {
    const terminal = msg.status === "warmed" || msg.status === "compile_failed";
    if (terminal) {
      w.compileStartedAt = 0;
      w.compileFinishedAt = Date.now();
    } else if (!w.compileStartedAt) {
      w.compileStartedAt = Date.now();
    }
    if (msg.status === "compiling") {
      console.log(`[worker ${w.gpu}] compiling ${msg.width}x${msg.height} (~${msg.est_seconds}s)`);
    } else if (msg.status === "warmed") {
      console.log(`[worker ${w.gpu}] warmed ${msg.width}x${msg.height} in ${msg.total_ms}ms`);
    } else if (msg.status === "compile_failed") {
      console.error(`[worker ${w.gpu}] compile failed ${msg.width}x${msg.height}: ${msg.message}`);
      if (msg.frame_dropped && (msg.client_epoch == null || msg.client_epoch === activeClientEpoch)) {
        w.framePending = Math.max(0, w.framePending - 1);
      }
    }
    const payload = {
      type: "compile",
      status: msg.status,
      message: msg.message,
      width: msg.width,
      height: msg.height,
      n_steps: msg.n_steps,
      iter: msg.iter,
      total_iters: msg.total_iters,
      elapsed_ms: msg.elapsed_ms,
      iter_ms: msg.iter_ms,
      total_ms: msg.total_ms,
      est_seconds: msg.est_seconds,
      worker: w.gpu,
    };
    if (terminal) {
      // Success and failure both end this compile attempt.
      latestCompileByWorker.delete(w.gpu);
    } else {
      latestCompileByWorker.set(w.gpu, payload);
    }
    if (activeChannel?.readyState === "open") {
      activeChannel.send(JSON.stringify(payload));
    }
    return;
  }

  if (msg.status === "frame") {
    // In-flight results from a replaced connection belong to that connection,
    // including its pending count and optional benchmark wire format.
    if (msg.client_epoch != null && msg.client_epoch !== activeClientEpoch) return;
    w.framePending = Math.max(0, w.framePending - 1);
    w.framesProduced = (w.framesProduced || 0) + 1;
    w.lastFrameAt = Date.now();
    diagStats.framesFromWorker++;
    diagStats.lastWorkerFrameAt = Date.now();
    if (!Number.isSafeInteger(msg.source_seq) || msg.source_seq < 1) {
      diagStats.invalidSourceSequence = (diagStats.invalidSourceSequence || 0) + 1;
      if (diagStats.invalidSourceSequence % 100 === 1) {
        console.error(`[worker ${w.gpu}] missing/invalid source sequence; deploy matching dispatcher and worker`);
      }
      return;
    }
    if (msg.source_seq <= lastSentSourceSequence) {
      diagStats.droppedStaleSource = (diagStats.droppedStaleSource || 0) + 1;
      return;
    }
    if (process.env.DEBUG_FRAMES) {
      console.log(`[worker ${w.gpu}] frame ${w.framesProduced} ${msg.gen_time_ms}ms ${msg.width}x${msg.height}`);
    }
    // Drop frame if WebRTC channel is congested. Live VJ wants the freshest
    // frame; stale frames in flight are useless and would wedge the channel.
    if (activeChannel?.readyState === "open") {
      const buffered = activeChannel.bufferedAmount || 0;
      diagStats.channelBufferedAmount = buffered;
      diagStats.channelState = activeChannel.readyState;
      if (buffered > MAX_OUTBOUND_BUFFER) {
        droppedOutbound++;
        diagStats.droppedOutbound++;
        if (droppedOutbound % 10 === 1) {
          console.log(`[dispatch] dropped frame from worker ${w.gpu} (channel buffer ${buffered} > ${MAX_OUTBOUND_BUFFER}; total dropped=${droppedOutbound})`);
        }
        return;
      }
      const imgBuffer = Buffer.from(msg.image_base64, "base64");
      if (Number.isInteger(msg.frame_id) && msg.frame_id >= 0 && msg.frame_id <= 0xffffffff) {
        const header = Buffer.alloc(8);
        header.writeUInt32BE(BENCH_FRAME_MAGIC, 0);
        header.writeUInt32BE(msg.frame_id, 4);
        activeChannel.send(Buffer.concat([header, imgBuffer]));
      } else {
        activeChannel.send(imgBuffer);
      }
      lastSentSourceSequence = msg.source_seq;
      activeChannel.send(JSON.stringify({
        type: "stats",
        gen_time_ms: msg.gen_time_ms,
        width: msg.width,
        height: msg.height,
        worker: w.gpu,
        // Per-stage breakdown from inference_server.py — lets the UI show
        // where the latency budget is going (vae encode vs transformer vs jpeg).
        timing: msg.timing,
      }));
      diagStats.framesToClient++;
      diagStats.lastSentToClientAt = Date.now();
    } else {
      // Channel not open — log it so we can see if frames are being produced
      // but can't be delivered.
      if ((w.framesProduced % 50) === 1) {
        console.log(`[DIAG] frame from worker ${w.gpu} but channel=${activeChannel?.readyState || "null"}`);
      }
    }
    return;
  }
  if (msg.status === "frame_dropped" || msg.status === "error") {
    if ((msg.status === "frame_dropped" || msg.frame_dropped) &&
        (msg.client_epoch == null || msg.client_epoch === activeClientEpoch)) {
      w.framePending = Math.max(0, w.framePending - 1);
      diagStats.droppedByWorker++;
    }
    if (msg.status === "frame_dropped") return;
    console.error(`[worker ${w.gpu} ERROR]`, msg.message);
    return;
  }
  if (msg.status === "shutdown") {
    console.log(`[worker ${w.gpu}] shutdown`);
    w.ready = false;
    return;
  }
  } finally {
    finishLatestMailboxMessage(w, msg);
  }
}

// Pending requests buffered until at least one worker is ready
const pendingBootstrap = [];

function flushPendingForWorker(w) {
  if (pendingBootstrap.length === 0) return;
  console.log(`[dispatch] flushing ${pendingBootstrap.length} pending requests`);
  // On first-ready-worker, replay buffered state changes to all ready workers.
  // Pending frames just get sent normally (we may lose a few that piled up
  // during startup — that's OK, frames are idempotent).
  const buf = pendingBootstrap.splice(0);
  for (const r of buf) sendToInference(r);
}

// Per-worker dispatch limit. Worker's internal request_queue is maxsize=2,
// so anything past 2 in flight gets silently dropped at the worker. Setting
// Dispatcher cap: how many frames can be pending per worker (one in flight +
// N-1 queued). Lower = less pipeline latency but more dropped frames.
// Default 3 (good throughput). Set to 1 for lowest latency (each worker only
// processes the freshest frame). Configurable via env for live tuning.
let MAX_PENDING_PER_WORKER = parseInt(process.env.MAX_PENDING_PER_WORKER || "3", 10);
let droppedInbound = 0;

// Load-aware "next worker" selector. Strict round-robin starves the dispatcher
// when one worker is briefly slower (recompile, GPU contention) — the slow
// worker's stdin queue grows while the other sits idle. Picking the worker
// with the FEWEST pending frames is robust to those transients. Tie-break
// preserves round-robin so equal-load workers still alternate predictably.
function nextReadyWorker() {
  if (workers.length === 0) return null;
  let best = null;
  let bestIdx = -1;
  for (let i = 0; i < workers.length; i++) {
    const idx = (roundRobinIdx + i) % workers.length;
    const w = workers[idx];
    if (latestMailboxEnabled && (w.latestMailboxFlight || w.framePending > 0 || w.compileStartedAt)) continue;
    if (!w.ready || w.gpu >= BENCH_ACTIVE_WORKERS) continue;
    if (best === null || w.framePending < best.framePending) {
      best = w;
      bestIdx = idx;
    }
  }
  if (best !== null) {
    // Advance the round-robin head past the winner so equal-load ties
    // alternate next time we're called.
    roundRobinIdx = (bestIdx + 1) % workers.length;
  }
  return best;
}

function broadcastState(stateOnly) {
  if (Object.keys(stateOnly).length === 0) return;
  if (latestMailboxEnabled) clearLatestMailbox('settings changed');
  // Remember every state field we've ever seen so a worker that comes up
  // late can be brought up to spec on its READY event (see handleWorkerLine).
  Object.assign(latestState, stateOnly);
  const line = JSON.stringify(stateOnly) + "\n";
  for (const w of workers) {
    if (w.ready) {
      try { w.proc.stdin.write(line); }
      catch (e) { console.error(`[worker ${w.gpu}] stdin write failed:`, e.message); }
    }
  }
}

function dispatchFrameUnbuffered(frameMsg, forcedWorker = null) {
  const w = forcedWorker || nextReadyWorker();
  if (!w) return false;
  // Drop early if the chosen worker is already at saturation. Worker's
  // request_queue (maxsize=2) would silently drop this anyway — better to
  // skip the JSON encode + stdin round-trip + bytes over the pipe.
  if (w.framePending >= MAX_PENDING_PER_WORKER) {
    droppedInbound++;
    diagStats.droppedInbound++;
    if (droppedInbound % 10 === 1) {
      console.log(`[dispatch] dropped frame (worker ${w.gpu} saturated, pending=${w.framePending}, total dropped=${droppedInbound})`);
    }
    return false;
  }
  try {
    const ok = w.proc.stdin.write(JSON.stringify(frameMsg) + "\n");
    // Idle time is not request processing time. Start a fresh deadline only
    // when work resumes; additional queued input must not mask a real stall.
    if (w.framePending === 0) w.pendingStartedAt = Date.now();
    w.framePending++;
    w.framesDispatched = (w.framesDispatched || 0) + 1;
    diagStats.framesToWorker++;
    if (process.env.DEBUG_FRAMES) {
      console.log(`[dispatch] frame ${w.framesDispatched} → worker ${w.gpu} (pending=${w.framePending}${ok ? '' : ', backpressured'})`);
    }
    return true;
  } catch (e) {
    console.error(`[worker ${w.gpu}] stdin write failed:`, e.message);
    w.ready = false;
    return false;
  }
}

// Public: send a client request through the dispatcher. Splits state vs frame.
function sendToInference(req) {
  if (!req || typeof req !== "object") return;
  if (req.client_epoch != null && req.client_epoch !== activeClientEpoch) return;

  if (latestMailboxEnabled) {
    sendToLatestMailbox(req);
    return;
  }

  // Buffer until a worker is ready
  if (!workers.some(w => w.ready)) {
    pendingBootstrap.push(req);
    return;
  }

  // Extract state fields. Broadcast to all workers so each stays in sync.
  const stateOnly = {};
  for (const k of STATE_FIELDS) {
    if (k in req) stateOnly[k] = req[k];
  }
  if (Object.keys(stateOnly).length > 0) {
    broadcastState(stateOnly);
  }

  if (req.image_base64) {
    // Frame data — route to one worker round-robin.
    // The state was already broadcast above, so we send frame-only to avoid
    // redundant state updates eating stdin bandwidth.
    const frameMsg = { image_base64: req.image_base64, source_seq: ++nextSourceSequence,
      ...(req.client_epoch !== undefined ? { client_epoch: req.client_epoch } : {}),
      ...(req.frame_id !== undefined ? { frame_id: req.frame_id } : {}) };
    dispatchFrame(frameMsg);
  }
}

// Drop pending frames buffered before any worker was ready (used when
// settings change to avoid stale frame replay).
function clearPendingFrames() {
  clearLatestMailbox('pending frames cleared');
  const before = pendingBootstrap.length;
  for (let i = pendingBootstrap.length - 1; i >= 0; i--) {
    if (pendingBootstrap[i].image_base64) pendingBootstrap.splice(i, 1);
  }
  const dropped = before - pendingBootstrap.length;
  if (dropped > 0) console.log(`[dispatch] dropped ${dropped} pending frames (settings changed)`);
}

// ---------------- WebRTC layer (unchanged) ---------------- //

let activePc = null;
let activeChannel = null;
let disconnectTimer = null;
let activeClientEpoch = 0;

function closeActivePc() {
  activeClientEpoch++;
  clearPendingFrames();
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
  // Reset worker pending counts — in-flight frames from the dying connection
  // are stale. Their echoed connection epoch prevents them from decrementing
  // the replacement connection's pending count. Without this reset, workers stay at
  // MAX_PENDING and dispatchFrame() drops every new frame → deadlock.
  for (const w of workers) {
    if (latestMailboxEnabled && w.latestMailboxFlight) continue;
    if (w.framePending > 0) {
      console.log(`[worker ${w.gpu}] reset framePending ${w.framePending} → 0 (connection replaced)`);
      w.framePending = 0;
    }
  }
  if (activeChannel) {
    try { activeChannel.close(); } catch {}
    activeChannel = null;
  }
  if (activePc) {
    try { activePc.close(); } catch {}
    activePc = null;
  }
}

function waitForIceGatheringComplete(pc, timeoutMs) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener("icegatheringstatechange", onState);
      clearTimeout(timer);
      resolve();
    };
    const onState = () => { if (pc.iceGatheringState === "complete") finish(); };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener("icegatheringstatechange", onState);
  });
}

const app = express();
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: "10mb" }));

app.get("/healthz", (_req, res) => {
  const readyCount = workers.filter(w => w.ready).length;
  res.json({
    ok: true,
    workerCount: workers.length,
    readyCount,
    inferenceReady: readyCount > 0,
    workers: workers.map(w => ({ gpu: w.gpu, ready: w.ready, framePending: w.framePending })),
  });
});

// /telemetry endpoint — pod hardware snapshot for the in-app telemetry
// section (lives inside the SystemsBar AI pop-over).
//
// CRITICAL: this handler shares an event loop with the WebRTC dispatcher
// and the worker stdout parser that relays inference frames to the
// browser. Any sync I/O here (execSync, readFileSync, statSync) blocks
// frame flow for the duration of the call — and nvidia-smi under
// inference load is 200–500 ms per invocation. The first version of
// this endpoint was sync, polled at 2 s, and dropped 50 fps → 9 fps
// the moment the user opened the telemetry pop-over.
//
// Fix: every probe is async (no event-loop blocking), and a 1.5 s
// in-memory cache means even a too-aggressive client poll only hits
// nvidia-smi once per cache window. The UI already polls at 2 s, so
// the cache is essentially "warm hit on every poll" while still being
// fresh enough to feel live.
const TELEMETRY_CACHE_MS = 1500;
let telemetryCache = { at: 0, snapshot: null };
let telemetryInflight = null;

app.get("/telemetry", async (_req, res) => {
  try {
    const snap = await getTelemetrySnapshotCached();
    res.json(snap);
  } catch (err) {
    console.error("[/telemetry] error:", err && err.message);
    res.status(500).json({ error: String(err && err.message) || "fail" });
  }
});

async function getTelemetrySnapshotCached() {
  const now = Date.now();
  if (telemetryCache.snapshot && now - telemetryCache.at < TELEMETRY_CACHE_MS) {
    return telemetryCache.snapshot;
  }
  // De-dupe concurrent requests — without this, two near-simultaneous
  // /telemetry calls (e.g. dev tools auto-reload + UI poll) both fire
  // their own nvidia-smi. Coalesce onto the first inflight build.
  if (telemetryInflight) return telemetryInflight;
  telemetryInflight = (async () => {
    try {
      const snap = await buildTelemetrySnapshot();
      telemetryCache = { at: Date.now(), snapshot: snap };
      return snap;
    } finally {
      telemetryInflight = null;
    }
  })();
  return telemetryInflight;
}

async function buildTelemetrySnapshot() {
  // Fire all probes in parallel — total wall time ≈ slowest probe
  // (usually nvidia-smi at ~50–200 ms idle, ~200–500 ms under load).
  // Crucially, each is async so the event loop stays free during the
  // wait — frame relay and channel send keep happening normally.
  const [cpu, ram, disk, networkVolume, gpus] = await Promise.all([
    readCpuInfo(),
    readRamInfo(),
    readDiskInfo("/workspace"),
    readNetworkVolumeInfo(),
    readGpuInfo(),
  ]);
  return {
    pod: readPodInfo(),
    cpu,
    ram,
    disk,
    networkVolume,
    gpus,
    workers: workers.map(w => ({
      gpu: w.gpu,
      ready: w.ready,
      framePending: w.framePending,
      framesProduced: w.framesProduced || 0,
      lastFrameAt: w.lastFrameAt || 0,
    })),
    serverUptimeS: Math.round(process.uptime()),
  };
}

function readPodInfo() {
  // Pure env / os reads — non-blocking, no I/O, leave sync.
  return {
    id: process.env.RUNPOD_POD_ID || null,
    hostname: process.env.RUNPOD_POD_HOSTNAME || os.hostname() || null,
    datacenter: process.env.RUNPOD_DC_ID || null,
    image: process.env.RUNPOD_IMAGE_NAME || null,
    publicIp: process.env.RUNPOD_PUBLIC_IP || null,
  };
}

async function readCpuInfo() {
  try {
    const cpus = os.cpus();
    const load = os.loadavg();
    return {
      model: cpus[0]?.model?.trim() || null,
      cores: cpus.length,
      loadAvg1: Number((load[0] || 0).toFixed(2)),
      loadAvg5: Number((load[1] || 0).toFixed(2)),
    };
  } catch {
    return null;
  }
}

async function readRamInfo() {
  // Prefer /proc/meminfo MemAvailable (matches what `free` shows users) over
  // os.freemem() — the latter under-reports because Linux counts buffers
  // and page cache as "used".
  try {
    const mi = await readFileAsync("/proc/meminfo", "utf8");
    const totalKb = Number((mi.match(/MemTotal:\s+(\d+)/) || [])[1] || 0);
    const availKb = Number((mi.match(/MemAvailable:\s+(\d+)/) || [])[1] || 0);
    if (totalKb > 0) {
      const totalBytes = totalKb * 1024;
      const usedBytes = (totalKb - availKb) * 1024;
      return { totalBytes, usedBytes };
    }
  } catch {}
  // Fallback for non-Linux dev (no /proc): close-enough numbers from os.
  return {
    totalBytes: os.totalmem(),
    usedBytes: os.totalmem() - os.freemem(),
  };
}

async function readDiskInfo(mount) {
  try {
    const { stdout } = await execAsync(
      `df -B1 --output=size,used,target ${JSON.stringify(mount)}`,
      { timeout: 2000 }
    );
    const lines = stdout.trim().split("\n");
    const last = lines[lines.length - 1].trim().split(/\s+/);
    const totalBytes = Number(last[0]);
    const usedBytes = Number(last[1]);
    const target = last[2] || mount;
    if (Number.isFinite(totalBytes) && Number.isFinite(usedBytes)) {
      return { mount: target, totalBytes, usedBytes };
    }
  } catch {}
  return null;
}

async function readNetworkVolumeInfo() {
  // RunPod attaches network volumes at /workspace and exports RUNPOD_VOLUME_ID.
  // If the env var's set, the volume is present; if /workspace is on its own
  // device (different from /), that's a secondary signal we surface too.
  const volumeId = process.env.RUNPOD_VOLUME_ID || null;
  let mountedSeparately = false;
  try {
    const [root, ws] = await Promise.all([statAsync("/"), statAsync("/workspace")]);
    mountedSeparately = root.dev !== ws.dev;
  } catch {}
  return {
    present: Boolean(volumeId) || mountedSeparately,
    id: volumeId,
    mount: "/workspace",
  };
}

async function readGpuInfo() {
  try {
    // nounits drops the trailing " MiB" / " %" / " W" — easier to parse.
    const { stdout } = await execAsync(
      "nvidia-smi --query-gpu=index,name,memory.total,memory.used,utilization.gpu,temperature.gpu,power.draw " +
      "--format=csv,noheader,nounits",
      { timeout: 3000 }
    );
    return stdout.trim().split("\n").filter(Boolean).map(line => {
      const [index, name, vramTotalMb, vramUsedMb, utilPct, tempC, powerW] =
        line.split(",").map(s => s.trim());
      return {
        index: Number(index),
        name: name || null,
        vramTotalMb: Number(vramTotalMb) || null,
        vramUsedMb: Number(vramUsedMb) || null,
        utilPct: Number(utilPct) || 0,
        tempC: Number(tempC) || null,
        powerW: Number(powerW) || null,
      };
    });
  } catch {
    return [];
  }
}

app.post("/webrtc/offer", async (req, res) => {
  const body = req.body || {};
  console.log("POST /webrtc/offer");
  if (body?.sdp?.sdp && typeof body.sdp.sdp === "string") {
    const offerSdp = body.sdp.sdp;
    const lines = offerSdp.split("\n");
    let host = 0, srflx = 0, relay = 0;
    for (const l of lines) {
      if (!l.startsWith("a=candidate:")) continue;
      if (l.includes(" typ host")) host++;
      else if (l.includes(" typ srflx")) srflx++;
      else if (l.includes(" typ relay")) relay++;
    }
    console.log(`Offer candidates host=${host} srflx=${srflx} relay=${relay}`);
  }
  if (!body.sdp || typeof body.sdp.type !== "string" || typeof body.sdp.sdp !== "string") {
    res.status(400).send("Expected body: { sdp: RTCSessionDescriptionInit }");
    return;
  }

  closeActivePc();

  const pc = new wrtc.RTCPeerConnection({ iceServers: getIceServers() });
  activePc = pc;

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    console.log(`[DIAG] Connection state: ${s} (channel=${activeChannel?.readyState || "none"} buf=${activeChannel?.bufferedAmount || 0})`);
    if (s === "connected" || s === "completed") {
      if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
      return;
    }
    if (s === "disconnected") {
      if (disconnectTimer) clearTimeout(disconnectTimer);
      disconnectTimer = setTimeout(() => {
        if (activePc === pc && pc.connectionState === "disconnected") {
          console.log("Connection remained disconnected, closing peer");
          closeActivePc();
        }
        disconnectTimer = null;
      }, 5000);
      return;
    }
    if (s === "failed" || s === "closed") {
      if (activePc === pc) closeActivePc();
    }
  };

  pc.oniceconnectionstatechange = () => console.log("ICE connection state:", pc.iceConnectionState);
  pc.onicegatheringstatechange = () => console.log("ICE gathering state:", pc.iceGatheringState);

  pc.ondatachannel = (event) => {
    const channel = event.channel;
    if (activePc !== pc) { channel.close(); return; }
    const clientEpoch = activeClientEpoch;
    channel.binaryType = "arraybuffer";
    activeChannel = channel;
    console.log("DataChannel opened:", channel.label);

    channel.onmessage = (ev) => {
      if (activeChannel !== channel) return;
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'vj0-input-barrier') {
            beginInputBenchmarkBarrier(channel, clientEpoch, msg.nonce);
            return;
          }
          if (msg.prompt || msg.seed != null || msg.width || msg.height) clearPendingFrames();
          sendToInference({ ...msg, client_epoch: clientEpoch });
        } catch {
          console.log("Invalid JSON from client");
        }
      } else {
        diagStats.framesFromClient++;
        diagStats.lastClientFrameAt = Date.now();
        let buffer = Buffer.from(ev.data);
        let frame_id;
        if (buffer.length >= 8 && buffer.readUInt32BE(0) === BENCH_FRAME_MAGIC) {
          frame_id = buffer.readUInt32BE(4);
          buffer = buffer.subarray(8);
        }
        const base64 = buffer.toString("base64");
        sendToInference({ image_base64: base64, client_epoch: clientEpoch,
          ...(frame_id !== undefined ? { frame_id } : {}) });
      }
    };
    channel.onclose = () => {
      console.log(`[DIAG] DataChannel CLOSED (was ${diagStats.channelState})`);
      diagStats.channelState = "closed";
      if (activeChannel === channel) activeChannel = null;
    };
    channel.onerror = (err) => {
      console.log(`[DIAG] DataChannel ERROR: ${err?.error?.message || err?.message || err}`);
    };
  };

  try {
    await pc.setRemoteDescription(body.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGatheringComplete(pc, ICE_GATHER_TIMEOUT_MS);
    if (!pc.localDescription) {
      res.status(500).send("Missing localDescription");
      return;
    }
    console.log("Sending SDP answer");
    res.json({ sdp: pc.localDescription });
  } catch (err) {
    if (activePc === pc) closeActivePc();
    res.status(500).send(err instanceof Error ? err.message : "WebRTC error");
  }
});

// ---------------- diagnostics ---------------- //
// Tracks frame flow, event loop health, memory, and DataChannel state.
// All data exposed via /debug endpoint and logged every DIAG_INTERVAL_MS.

const DIAG_INTERVAL_MS = 5000; // dump stats every 5s
const diagStats = {
  framesFromClient: 0,       // binary frames received from WebRTC client
  framesToWorker: 0,         // frames dispatched to worker stdin
  framesFromWorker: 0,       // frame results from worker stdout
  framesToClient: 0,         // frames sent back over WebRTC channel
  droppedByWorker: 0,        // explicitly acknowledged Python queue/error drops
  droppedInbound: 0,         // dropped because worker saturated
  droppedOutbound: 0,        // dropped because channel congested
  lastClientFrameAt: 0,      // when we last got a frame from the client
  lastWorkerFrameAt: 0,      // when a worker last produced a frame
  lastSentToClientAt: 0,     // when we last sent a frame to the client
  channelBufferedAmount: 0,  // latest DataChannel bufferedAmount
  channelState: "none",      // latest DataChannel readyState
  eventLoopLagMs: 0,         // max event loop lag since last dump
  eventLoopLagTotal: 0,      // accumulated lag for average
  eventLoopChecks: 0,
  startedAt: Date.now(),
};

// Event loop lag detector — fires every 500ms, measures actual vs expected delay.
// If the event loop is blocked (GC, large JSON parse, etc.), the delay exceeds 500ms.
let _lastLoopCheck = Date.now();
setInterval(() => {
  const now = Date.now();
  const expected = 500;
  const actual = now - _lastLoopCheck;
  const lag = Math.max(0, actual - expected);
  if (lag > diagStats.eventLoopLagMs) diagStats.eventLoopLagMs = lag;
  diagStats.eventLoopLagTotal += lag;
  diagStats.eventLoopChecks++;
  _lastLoopCheck = now;
  // Alert on severe lag (>500ms = half-second event loop stall)
  if (lag > 500) {
    console.log(`[DIAG] ⚠️  EVENT LOOP LAG ${lag}ms`);
  }
}, 500);

// Periodic state dump
setInterval(() => {
  const now = Date.now();
  const uptimeS = ((now - diagStats.startedAt) / 1000).toFixed(0);
  const mem = process.memoryUsage();
  const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
  const rssMB = (mem.rss / 1024 / 1024).toFixed(1);
  const avgLag = diagStats.eventLoopChecks > 0
    ? (diagStats.eventLoopLagTotal / diagStats.eventLoopChecks).toFixed(1)
    : "0";

  const workerSummary = workers.map(w =>
    `gpu${w.gpu}:${w.ready ? "R" : "x"} pend=${w.framePending} frames=${w.framesProduced || 0} buf=${w.stdoutBuf.length}`
  ).join(" | ");

  const sinceClient = diagStats.lastClientFrameAt ? ((now - diagStats.lastClientFrameAt) / 1000).toFixed(1) : "never";
  const sinceWorker = diagStats.lastWorkerFrameAt ? ((now - diagStats.lastWorkerFrameAt) / 1000).toFixed(1) : "never";
  const sinceSent = diagStats.lastSentToClientAt ? ((now - diagStats.lastSentToClientAt) / 1000).toFixed(1) : "never";

  console.log(
    `[DIAG] t=${uptimeS}s ` +
    `in=${diagStats.framesFromClient} →wk=${diagStats.framesToWorker} ←wk=${diagStats.framesFromWorker} →cl=${diagStats.framesToClient} ` +
    `drop_in=${diagStats.droppedInbound} drop_out=${diagStats.droppedOutbound} | ` +
    `since: client=${sinceClient}s worker=${sinceWorker}s sent=${sinceSent}s | ` +
    `ch=${diagStats.channelState} buf=${diagStats.channelBufferedAmount} | ` +
    `lag: max=${diagStats.eventLoopLagMs}ms avg=${avgLag}ms | ` +
    `heap=${heapMB}MB rss=${rssMB}MB | ` +
    `${workerSummary}`
  );

  // Reset per-interval peaks
  diagStats.eventLoopLagMs = 0;
}, DIAG_INTERVAL_MS);

// /debug endpoint — live JSON snapshot for quick checks
app.get("/debug", (_req, res) => {
  const now = Date.now();
  res.json({
    protocol: { benchmarkFrameIds: 1 },
    uptime_s: ((now - diagStats.startedAt) / 1000).toFixed(0),
    stats: { ...diagStats },
    memory: process.memoryUsage(),
    workers: workers.map(w => ({
      gpu: w.gpu,
      ready: w.ready,
      framePending: w.framePending,
      framesProduced: w.framesProduced || 0,
      framesDispatched: w.framesDispatched || 0,
      compileStartedAt: w.compileStartedAt,
      mailboxFlightSource: w.latestMailboxFlight?.source_seq ?? null,
      lastFrameAt: w.lastFrameAt,
      stdoutBufLen: w.stdoutBuf.length,
    })),
    channel: activeChannel ? {
      readyState: activeChannel.readyState,
      bufferedAmount: activeChannel.bufferedAmount,
      label: activeChannel.label,
    } : null,
    connection: activePc ? {
      connectionState: activePc.connectionState,
      iceConnectionState: activePc.iceConnectionState,
    } : null,
  });
});

// Test-only controls: the ordinary image protocol and defaults are unchanged.
app.post('/benchmark/config', (req, res) => {
  const {maxPending, maxOutboundBytes, benchmarkVariant = 'baseline', activeWorkers = WORKER_COUNT, benchmarkThreads = 128} = req.body || {};
  if (!Number.isInteger(benchmarkThreads) || benchmarkThreads < 1 || benchmarkThreads > 256) return res.status(400).json({error:'Invalid benchmark thread count'});
  if (![1, 2].includes(activeWorkers) || activeWorkers > WORKER_COUNT) {
    return res.status(400).json({error:'Invalid active worker count'});
  }
  if (!['baseline', 'events', 'combined', 'terminal-noop'].includes(benchmarkVariant)) {
    return res.status(400).json({error:'Invalid benchmark compute variant'});
  }
  if (![1, 2, 3].includes(maxPending) || !Number.isInteger(maxOutboundBytes) ||
      maxOutboundBytes < 16384 || maxOutboundBytes > 1024 * 1024) {
    return res.status(400).json({error:'Invalid benchmark queue/buffer configuration'});
  }
  MAX_PENDING_PER_WORKER = maxPending;
  MAX_OUTBOUND_BUFFER = maxOutboundBytes;
  BENCH_ACTIVE_WORKERS = activeWorkers;
  broadcastState({benchmarkVariant, benchmarkThreads});
  res.json({maxPending:MAX_PENDING_PER_WORKER, maxOutboundBytes:MAX_OUTBOUND_BUFFER, benchmarkVariant, benchmarkThreads, activeWorkers:BENCH_ACTIVE_WORKERS, loadedWorkers:WORKER_COUNT});
});

// Explicit test-only control; switching requires a drained dispatcher.
app.post('/benchmark/mailbox', (req, res) => {
  try { res.json(configureLatestMailbox(req.body?.enabled)); }
  catch (error) { res.status(409).json({error: error.message}); }
});

// ---------------- bootstrap ---------------- //

console.log(`VJ FLUX.2 Klein WebRTC server starting (workers=${WORKER_COUNT})`);
for (let i = 0; i < WORKER_COUNT; i++) spawnWorker(i);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Listening on 0.0.0.0:${PORT} (workers=${WORKER_COUNT})`);
});

// ---------------- watchdog ---------------- //
// If a worker has pending frames but hasn't produced output in 30s, it's hung
// (typically a CUDA graph stall). Kill the process — the "close" handler
// auto-respawns it on the same GPU. The other worker keeps serving while the
// dead one reboots (~30-60s warm, ~3 min cold).
const WATCHDOG_INTERVAL_MS = 5000;
const WATCHDOG_STALL_MS = 30000;
const WATCHDOG_COMPILE_MS = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const w of workers) {
    // Compilation legitimately exceeds the frame timeout, but must be bounded.
    const compileExpired = w.compileStartedAt && now - w.compileStartedAt >= WATCHDOG_COMPILE_MS;
    if (!compileExpired && (!w.ready || w.framePending === 0)) continue;
    if (w.compileStartedAt && now - w.compileStartedAt < WATCHDOG_COMPILE_MS) continue;
    if (!w.compileStartedAt && w.lastFrameAt === 0 && !w.compileFinishedAt && !w.pendingStartedAt) continue;
    const stalled = w.compileStartedAt
      ? now - w.compileStartedAt
      : now - Math.max(w.lastFrameAt, w.compileFinishedAt, w.pendingStartedAt || 0);
    if (stalled > WATCHDOG_STALL_MS) {
      console.log(`[watchdog] worker ${w.gpu} stalled ${(stalled / 1000).toFixed(1)}s with pending=${w.framePending} stdoutBuf=${w.stdoutBuf.length}, killing for respawn`);
      w.ready = false;
      w.framePending = 0;
      try { w.proc.kill("SIGKILL"); } catch {}
    }
    // Warn if stdout buffer is growing — means worker is writing faster than
    // we parse, or a partial JSON line is stuck (incomplete newline = pipe stall)
    if (w.stdoutBuf.length > 512 * 1024) {
      console.log(`[DIAG] ⚠️  worker ${w.gpu} stdoutBuf=${(w.stdoutBuf.length / 1024).toFixed(0)}KB — possible pipe stall`);
    }
  }
}, WATCHDOG_INTERVAL_MS);

// Graceful shutdown
function shutdown() {
  console.log("Shutting down...");
  for (const w of workers) {
    try { w.proc.stdin.write(JSON.stringify({ command: "shutdown" }) + "\n"); }
    catch {}
  }
  setTimeout(() => process.exit(0), 2000);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Test-only ordered SCTP barrier. Called by the ordinary channel's JSON handler.
// The acknowledgement follows all earlier inputs and their completed output
// messages on that same reliable, ordered channel. Never run in a timed window.
function beginInputBenchmarkBarrier(channel, clientEpoch, nonce) {
  if (typeof nonce !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(nonce)) {
    throw new Error('Invalid input benchmark barrier nonce');
  }
  const started = Date.now();
  const receivedAtBarrier = diagStats.framesFromClient;
  const sourceAtBarrier = nextSourceSequence;
  const finish = (status, detail) => {
    if (channel.readyState !== 'open') return;
    channel.send(JSON.stringify({type:'vj0-input-barrier-ack', nonce, status,
      detail, client_epoch:clientEpoch, receivedAtBarrier, sourceAtBarrier,
      elapsedMs:Date.now()-started}));
  };
  const poll = () => {
    if (channel !== activeChannel || clientEpoch !== activeClientEpoch || channel.readyState !== 'open') return;
    if (diagStats.framesFromClient !== receivedAtBarrier) {
      finish('failed', 'Input arrived after the stop/barrier boundary');
      return;
    }
    const idle = pendingBootstrap.length === 0 && !latestMailboxWaiting &&
      workers.every(w => w.ready && w.framePending === 0 &&
        !w.latestMailboxFlight && !w.compileStartedAt);
    if (idle && channel.bufferedAmount === 0) {
      finish('passed', 'All prior inputs admitted/dropped and workers idle; prior output precedes this ordered ack');
      return;
    }
    if (Date.now()-started >= 30000) {
      finish('failed', 'Worker/mailbox/output buffer did not drain within 30 seconds');
      return;
    }
    setTimeout(poll, 10);
  };
  poll();
}
