/* Standalone browser benchmark for the existing raw-JPEG WebRTC protocol.
 * No application UI changes. Load with dynamic import from an HTTP origin.
 * Streaming frame age is deliberately unknown until the server echoes IDs.
 */
export function summarize(values) {
  if (!values.length) return { count: 0, mean: null, p50: null, p95: null, p99: null };
  const sorted = [...values].sort((a, b) => a - b);
  const p = (q) => {
    const i = (sorted.length - 1) * q;
    return sorted[Math.floor(i)] + (sorted[Math.ceil(i)] - sorted[Math.floor(i)]) * (i % 1);
  };
  return { count: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length,
    p50: p(0.5), p95: p(0.95), p99: p(0.99) };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(test, milliseconds, description) {
  const started = performance.now();
  while (!test()) {
    if (performance.now() - started > milliseconds) throw new Error(`Timeout: ${description}`);
    await delay(25);
  }
}

export async function runBenchmark(options) {
  const c = { width: 512, height: 288, steps: 2, alpha: 0.10, seed: 42,
    prompt: "colorful abstract art, vibrant neon lights, psychedelic patterns",
    inputQuality: 0.85, outputQuality: null, sendFps: 60, seconds: 30,
    warmupFrames: 20, maxBufferedBytes: 256 * 1024, telemetryEveryMs: 0,
    mode: "stream", frameIds: false, channelOptions: {}, inputScene: 'waveform', ...options };
  if (c.frameIds && c.outputQuality === null) c.outputQuality = 80;
  if (!c.server || !["stream", "single"].includes(c.mode) || c.seconds <= 0 || c.sendFps <= 0 ||
      c.warmupFrames < 1 || c.width % 16 || c.height % 16 || Math.min(c.width, c.height) < 16) {
    throw new Error("A server URL, valid dimensions, positive duration/FPS/warmup, and stream/single mode are required");
  }
  const server = c.server.replace(/\/$/, "");
  if (c.serverConfig) {
    const response = await fetch(`${server}/benchmark/config`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(c.serverConfig), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Could not apply test-only server configuration");
    const applied = await response.json();
    if (applied.maxPending !== c.serverConfig.maxPending ||
        applied.maxOutboundBytes !== c.serverConfig.maxOutboundBytes ||
        (c.serverConfig.benchmarkVariant && applied.benchmarkVariant !== c.serverConfig.benchmarkVariant) ||
        (c.serverConfig.activeWorkers && applied.activeWorkers !== c.serverConfig.activeWorkers)) {
      throw new Error("Server did not confirm requested queue/buffer settings");
    }
  }
  if (c.frameIds) {
    const response = await fetch(`${server}/debug`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok || (await response.json()).protocol?.benchmarkFrameIds !== 1) {
      throw new Error("Server does not advertise benchmark frame ID support");
    }
  }
  const canvas = new OffscreenCanvas(c.width, c.height);
  const ctx = canvas.getContext("2d");
  if (!['waveform', 'high-entropy'].includes(c.inputScene)) throw new Error('Unknown input scene');
  let stressBackground;
  if (c.inputScene === 'high-entropy') {
    stressBackground = ctx.createImageData(c.width, c.height);
    let random = 42;
    for (let i=0; i<stressBackground.data.length; i+=4) {
      for (let color=0; color<3; color++) {
        random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
        stressBackground.data[i+color] = random & 255;
      }
      stressBackground.data[i+3] = 255;
    }
  }
  const output = new OffscreenCanvas(c.width, c.height);
  const outCtx = output.getContext("2d");
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  // Baseline must use the same reliability as the shipped application.
  const ch = pc.createDataChannel("frames", c.channelOptions);
  ch.binaryType = "arraybuffer";
  let phase = "warmup", stopped = false, measuring = false, warmReceived = 0, warmSent = 0;
  let inFlight = false, lastCapture = null, pendingDecode = false, encodePending = false;
  let frameIndex = 0, receiveIndex = 0, lastPainted = 0, latestWarmReceive = 0;
  const measurements = { sent: 0, received: 0, decodedDrawn: 0,
    sendBufferSkips: 0, encodeSkips: 0, decodeSkips: 0, sendErrors: 0,
    decodeErrors: 0, bytesSent: 0, bytesReceived: 0, telemetryErrors: 0,
    compileDuringMeasurement: false, errors: [],
    encodeMs: [], decodeDrawMs: [], requestResponseMs: [], captureToDrawMs: [],
    inputBytes: [], outputBytes: [], workerTimingMs: [], telemetryMs: [],
    maxBufferedBytes: 0 };
  const workerFrameCounts = {};
  const workerLastActivity = {}, workerMaxGapMs = {};
  let measurementStarted = 0;
  let telemetryTimer, sendTimer;
  const compilingWorkers = new Set();
  const observedVariants = new Map();
  let serverFramesBeforeWarmup = null;
  let serverInputsBeforeWarmup = null;
  let nextFrameId = 0;
  const captures = new Map();

  function drawInput(index) {
    if (stressBackground) ctx.putImageData(stressBackground, 0, 0);
    else {
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, c.width, c.height);
    }
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(2, c.width / 128);
    ctx.beginPath();
    for (let x = 0; x < c.width; x++) {
      const y = c.height * (0.5 + 0.24 * Math.sin(x / c.width * Math.PI * 4 + index * 0.25)
        + 0.07 * Math.sin(x / c.width * Math.PI * 19 - index * 0.17));
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  async function send() {
    if (stopped || ch.readyState !== "open" || (c.mode === "single" && inFlight)) return;
    measurements.maxBufferedBytes = Math.max(measurements.maxBufferedBytes, ch.bufferedAmount);
    if (ch.bufferedAmount >= c.maxBufferedBytes) {
      if (measuring) measurements.sendBufferSkips++;
      return;
    }
    if (encodePending) { if (measuring) measurements.encodeSkips++; return; }
    encodePending = true;
    const thisPhase = phase;
    const capture = performance.now();
    try {
      drawInput(frameIndex++);
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: c.inputQuality });
      let bytes = await blob.arrayBuffer();
      if (stopped || ch.readyState !== "open" || phase !== thisPhase) return;
      // Explicit admission after async encode; its cost is reported separately.
      if (ch.bufferedAmount >= c.maxBufferedBytes) {
        if (measuring) measurements.sendBufferSkips++;
        return;
      }
      if (c.frameIds) {
        const tagged = new Uint8Array(bytes.byteLength + 8);
        const view = new DataView(tagged.buffer);
        view.setUint32(0, 0x564a3042);
        const id = ++nextFrameId;
        view.setUint32(4, id);
        tagged.set(new Uint8Array(bytes), 8);
        bytes = tagged.buffer;
        captures.set(id, capture);
        // Dropped frames never return. Keep only recent outstanding IDs.
        if (captures.size > 4096) captures.delete(captures.keys().next().value);
      }
      ch.send(bytes);
      if (thisPhase === "warmup") warmSent++;
      inFlight = true;
      lastCapture = capture;
      if (measuring) {
        measurements.sent++;
        measurements.bytesSent += bytes.byteLength;
        measurements.inputBytes.push(bytes.byteLength);
        measurements.encodeMs.push(performance.now() - capture);
      }
    } catch (e) {
      if (measuring) { measurements.sendErrors++; measurements.errors.push(String(e)); }
    } finally { encodePending = false; }
  }

  ch.onmessage = (event) => {
    if (stopped) return;
    if (typeof event.data === "string") {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "compile") {
          if (message.status === "warmed" || message.status === "compile_failed") compilingWorkers.delete(message.worker);
          else compilingWorkers.add(message.worker);
          if (message.status === "compile_failed") {
            measurements.errors.push(`Worker ${message.worker} compile failed: ${message.message || "unknown error"}`);
          }
        }
        if (measuring && message.type === "stats") {
          if (c.serverConfig?.activeWorkers && (!Number.isInteger(message.worker) ||
              message.worker < 0 || message.worker >= c.serverConfig.activeWorkers)) {
            measurements.errors.push('An unexpected worker produced a measured frame');
          }
          if (Number.isFinite(message.timing?.total_ms)) {
            measurements.workerTimingMs.push(message.timing.total_ms);
            workerFrameCounts[message.worker] = (workerFrameCounts[message.worker] || 0) + 1;
            const now = performance.now();
            workerMaxGapMs[message.worker] = Math.max(workerMaxGapMs[message.worker] || 0,
              now - (workerLastActivity[message.worker] ?? measurementStarted));
            workerLastActivity[message.worker] = now;
          } else if (c.serverConfig?.activeWorkers) {
            measurements.errors.push('Malformed worker timing in scaling trial');
          }
        }
        if (message.type === "stats" && c.serverConfig?.benchmarkVariant) {
          observedVariants.set(message.worker, {variant:message.timing?.benchmark_variant, clock:message.timing?.stage_clock});
          if (message.timing?.benchmark_variant !== c.serverConfig.benchmarkVariant ||
              message.timing?.stage_clock !== (c.serverConfig.benchmarkVariant === 'baseline' ? 'wall-clock' : 'cuda-events')) {
            measurements.errors.push('Worker did not apply requested compute variant and timing clock');
          }
        }
        if (measuring && message.type === "compile" && message.status !== "warmed") {
          measurements.compileDuringMeasurement = true;
        }
      } catch { /* The worker also sends human-readable progress. */ }
      return;
    }
    let captured = lastCapture;
    let bytes = event.data;
    const wireBytes = bytes.byteLength;
    if (c.frameIds) {
      const view = new DataView(bytes);
      if (bytes.byteLength < 8 || view.getUint32(0) !== 0x564a3042) {
        measurements.errors.push("Missing benchmark frame ID envelope");
        return;
      }
      const frameId = view.getUint32(4);
      captured = captures.get(frameId);
      captures.delete(frameId);
      if (captured === undefined) {
        measurements.errors.push(`Unknown returned frame ID ${frameId}`);
        return;
      }
      bytes = bytes.slice(8);
    }
    inFlight = false;
    if (stopped) return;
    if (!measuring) { warmReceived++; latestWarmReceive = performance.now(); return; }
    const receivedAt = performance.now();
    const id = ++receiveIndex;
    measurements.received++;
    measurements.bytesReceived += wireBytes;
    measurements.outputBytes.push(bytes.byteLength);
    if ((c.mode === "single" || c.frameIds) && captured !== null) measurements.requestResponseMs.push(receivedAt - captured);
    if (pendingDecode) { measurements.decodeSkips++; return; }
    pendingDecode = true;
    createImageBitmap(new Blob([bytes], { type: "image/jpeg" })).then((bitmap) => {
      try {
        if (stopped || id <= lastPainted) return;
        if (bitmap.width !== c.width || bitmap.height !== c.height) throw new Error(`Unexpected output size ${bitmap.width}x${bitmap.height}`);
        outCtx.drawImage(bitmap, 0, 0);
        lastPainted = id;
        measurements.decodedDrawn++;
        measurements.decodeDrawMs.push(performance.now() - receivedAt);
        if ((c.mode === "single" || c.frameIds) && captured !== null) measurements.captureToDrawMs.push(performance.now() - captured);
      } finally { bitmap.close(); }
    }).catch((error) => {
      if (!stopped) { measurements.decodeErrors++; measurements.errors.push(String(error)); }
    }).finally(() => { pendingDecode = false; });
  };
  ch.onerror = (event) => { if (!stopped) measurements.errors.push(event.error?.message || "DataChannel error"); };
  ch.onclose = () => { if (!stopped) measurements.errors.push("DataChannel closed during run"); };

  try {
    await pc.setLocalDescription(await pc.createOffer());
    await waitUntil(() => pc.iceGatheringState === "complete", 15000, "ICE gathering");
    const response = await fetch(`${server}/webrtc/offer`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sdp: pc.localDescription }), signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Signaling returned ${response.status}`);
    await pc.setRemoteDescription((await response.json()).sdp);
    await waitUntil(() => ch.readyState === "open", 30000, "DataChannel open");
    if (c.mode === "stream") {
      const response = await fetch(`${server}/debug`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("Streaming isolation requires the server /debug counters");
      const debug = await response.json();
      serverFramesBeforeWarmup = debug.stats?.framesToClient;
      serverInputsBeforeWarmup = debug.stats?.framesFromClient;
      if (!Number.isSafeInteger(serverFramesBeforeWarmup) || !Number.isSafeInteger(serverInputsBeforeWarmup)) {
        throw new Error("Missing server input/output frame counters");
      }
    }
    ch.send(JSON.stringify({ prompt: c.prompt, seed: c.seed, width: c.width, height: c.height,
      captureWidth: c.width, captureHeight: c.height, alpha: c.alpha, n_steps: c.steps,
      ...(c.outputQuality !== null ? { jpegQuality: c.outputQuality } : {}) }));
    sendTimer = setInterval(send, Math.max(1, 1000 / c.sendFps));
    await waitUntil(() => {
      if (measurements.errors.length) throw new Error(measurements.errors.join("; "));
      return warmReceived >= c.warmupFrames;
    }, 600000, "warmup image responses");
    clearInterval(sendTimer);
    // Stop input and drain all accepted warmup frames. Any slow compile/startup
    // belongs outside the measurement. Single mode has at most one outstanding.
    await waitUntil(() => !encodePending, 10000, "pending input encode");
    if (c.mode === "single") {
      // Silence cannot prove completion: a slow request may still be computing.
      await waitUntil(() => !inFlight && !compilingWorkers.size &&
        performance.now() - latestWarmReceive > 2000 && ch.bufferedAmount === 0,
        60000, "outstanding warmup request and compile completion");
    } else {
      const deadline = performance.now() + 60000;
      for (;;) {
        if (measurements.errors.length) throw new Error(measurements.errors.join("; "));
        const response = await fetch(`${server}/debug`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error("Could not verify server warmup drain");
        const debug = await response.json();
        const idle = debug.workers?.length && debug.workers.every((w) => w.ready && w.framePending === 0);
        const delivered = debug.stats?.framesToClient - serverFramesBeforeWarmup === warmReceived;
        // A drained local SCTP buffer does not prove remote input delivery.
        const allInputsReceived = debug.stats?.framesFromClient - serverInputsBeforeWarmup === warmSent;
        if (allInputsReceived && idle && delivered && debug.channel?.bufferedAmount === 0 && !compilingWorkers.size &&
            ch.bufferedAmount === 0 && performance.now() - latestWarmReceive > 2000) break;
        if (performance.now() > deadline) throw new Error("Timeout verifying server/transport warmup drain");
        await delay(100);
      }
    }
    frameIndex = 0;
    if (c.serverConfig?.benchmarkVariant && !observedVariants.size) {
      throw new Error('No worker telemetry confirmed the requested compute variant');
    }
    if (c.serverConfig?.activeWorkers && observedVariants.size !== c.serverConfig.activeWorkers) {
      throw new Error('Not all requested active workers produced warmup frames');
    }
    phase = "measure";
    measuring = true;
    measurements.maxBufferedBytes = 0;
    const started = performance.now();
    measurementStarted = started;
    if (c.telemetryEveryMs > 0) {
      let busy = false;
      telemetryTimer = setInterval(async () => {
        if (busy || stopped) return;
        busy = true;
        const start = performance.now();
        try {
          const r = await fetch(`${server}/telemetry`, { signal: AbortSignal.timeout(5000) });
          if (!r.ok) throw new Error(`Telemetry HTTP ${r.status}`);
          await r.json();
          if (!stopped) measurements.telemetryMs.push(performance.now() - start);
        } catch { if (!stopped) measurements.telemetryErrors++; }
        finally { busy = false; }
      }, c.telemetryEveryMs);
    }
    sendTimer = setInterval(send, Math.max(1, 1000 / c.sendFps));
    await delay(c.seconds * 1000);
    stopped = true;
    measuring = false;
    phase = "finished";
    clearInterval(sendTimer);
    clearInterval(telemetryTimer);
    const elapsed = (performance.now() - started) / 1000;
    const measurementEnded = started + elapsed * 1000;
    let finalWorkerHealth = null;
    if (c.serverConfig?.activeWorkers) {
      const response = await fetch(`${server}/debug`, {cache:'no-store', signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error('Could not verify final scaling worker health');
      finalWorkerHealth = (await response.json()).workers;
      for (let worker=0; worker<c.serverConfig.activeWorkers; worker++) {
        workerMaxGapMs[worker] = Math.max(workerMaxGapMs[worker] || 0,
          measurementEnded - (workerLastActivity[worker] ?? started));
        if (workerMaxGapMs[worker] > 2000 || !finalWorkerHealth?.find(w=>w.gpu===worker)?.ready) {
          measurements.errors.push(`Worker ${worker} had an output gap over two seconds or was not ready at completion`);
        }
      }
    }
    const stats = await pc.getStats();
    const transport = [];
    stats.forEach((s) => {
      if (s.type === "candidate-pair" && s.state === "succeeded" && s.nominated) {
        transport.push({ currentRoundTripTime: s.currentRoundTripTime,
          availableOutgoingBitrate: s.availableOutgoingBitrate,
          localCandidate: stats.get(s.localCandidateId)?.candidateType,
          remoteCandidate: stats.get(s.remoteCandidateId)?.candidateType });
      }
    });
    const arrays = {};
    const counts = {};
    for (const [key, value] of Object.entries(measurements)) {
      if (Array.isArray(value) && key !== "errors") arrays[key] = summarize(value);
      else counts[key] = value;
    }
    const invalidReasons = [];
    if (measurements.compileDuringMeasurement) invalidReasons.push("compilation overlapped measurement");
    if (!measurements.received) invalidReasons.push("no image responses");
    if (!measurements.decodedDrawn) invalidReasons.push("no successfully decoded/drawn images");
    if (measurements.decodeErrors) invalidReasons.push("JPEG decode failures");
    if (measurements.sendErrors || measurements.errors.length) invalidReasons.push("transport or encode errors");
    if (c.serverConfig?.activeWorkers && Object.keys(workerFrameCounts).length !== c.serverConfig.activeWorkers) {
      invalidReasons.push('Not all requested active workers produced measured frames');
    }
    return { status: invalidReasons.length ? "invalid" : "measured", invalidReasons,
      date: new Date().toISOString(), config: c, userAgent: navigator.userAgent,
      measurement: "browser receive/decode/offscreen 2D draw; excludes application upscaler/projector and audio capture",
      sourceCapture: "OffscreenCanvas.convertToBlob; production uses HTMLCanvasElement.toBlob",
      frameAge: c.frameIds ? "correlated by echoed frame ID; measured on client clock"
        : c.mode === "single" ? "one request in flight; measured on client clock" : "unknown: baseline does not echo frame IDs",
      workerVariants: Array.from(observedVariants, ([worker, value]) => ({worker, ...value})),
      workerFrameCounts,
      workerMaxGapMs, finalWorkerHealth,
      elapsedSeconds: elapsed, receivedFps: measurements.received / elapsed,
      decodedDrawnFps: measurements.decodedDrawn / elapsed,
      outboundMbps: measurements.bytesSent * 8 / elapsed / 1e6,
      inboundMbps: measurements.bytesReceived * 8 / elapsed / 1e6,
      counts, distributions: arrays, transport };
  } finally {
    stopped = true;
    clearInterval(sendTimer);
    clearInterval(telemetryTimer);
    ch.close();
    pc.close();
  }
}
