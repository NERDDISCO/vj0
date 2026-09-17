#!/usr/bin/env node
/**
 * WebRTC stress test — synthetic client that connects to server.js
 * like a real browser would, sends frames, and measures throughput + hangs.
 *
 * This isolates the WebRTC/Node.js layer. If inference passes the pipe
 * stress test (bench_pipe_stress.py) but this test hangs, the problem is
 * in the WebRTC/Node.js dispatch layer.
 *
 * The browser sends JPEG-compressed frames (canvas.toBlob("image/jpeg", 0.85))
 * which are typically 30-80KB at 768x448. This test simulates that by sending
 * random bytes of comparable size (the server just base64-encodes whatever
 * binary it receives and forwards to the Python worker, which will fail to
 * decode it — but the point is to stress the WebRTC+dispatch path, not
 * produce valid images).
 *
 * Usage (on the pod, while server.js is running):
 *   node bench_webrtc_stress.js --width 768 --height 448 --frames 5000
 *   node bench_webrtc_stress.js --width 448 --height 768 --frames 5000
 */
const wrtc = require("@roamhq/wrtc");
const crypto = require("crypto");

const args = parseArgs();
const WIDTH = args.width || 768;
const HEIGHT = args.height || 448;
const FRAMES = args.frames || 5000;
const SERVER_URL = args.server || "http://localhost:3000";
const SEND_INTERVAL_MS = args.interval || 50; // ~20 fps send rate
const HANG_TIMEOUT_MS = args.hangTimeout || 30000;
const ALPHA = args.alpha || 0.10;
const N_STEPS = args.nSteps || 4;

function parseArgs() {
  const result = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    result[key] = isNaN(Number(argv[i + 1])) ? argv[i + 1] : Number(argv[i + 1]);
  }
  return result;
}

// Generate a minimal valid JPEG of the right dimensions.
// We create a raw RGB buffer and pipe it through Python's PIL to produce
// an actual JPEG — the worker auto-detects the magic bytes and decodes it.
function makeSyntheticFrame(w, h) {
  const { execSync } = require("child_process");
  const jpegBuf = execSync(
    `python3 -c "
import sys, io, numpy as np
from PIL import Image
arr = np.random.randint(0, 255, (${h}, ${w}, 3), dtype=np.uint8)
img = Image.fromarray(arr)
buf = io.BytesIO()
img.save(buf, format='JPEG', quality=85)
sys.stdout.buffer.write(buf.getvalue())
"`,
    { maxBuffer: 10 * 1024 * 1024 }
  );
  console.log(`  JPEG size: ${(jpegBuf.length / 1024).toFixed(1)} KB`);
  return jpegBuf;
}

async function main() {
  console.log(`=== WebRTC stress test: ${WIDTH}x${HEIGHT}, ${FRAMES} frames ===`);
  console.log(`    server: ${SERVER_URL}`);
  console.log(`    send interval: ${SEND_INTERVAL_MS}ms (~${(1000 / SEND_INTERVAL_MS).toFixed(0)} fps send rate)`);
  console.log(`    hang timeout: ${HANG_TIMEOUT_MS}ms`);
  console.log();

  // Create peer connection
  const pc = new wrtc.RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  // Create data channel (like the browser does — default ordered/reliable)
  const channel = pc.createDataChannel("vj0");
  channel.binaryType = "arraybuffer";

  let framesReceived = 0;
  let framesSent = 0;
  let lastRecvAt = 0;
  let hungAt = null;
  const timings = [];
  const roundTrips = [];
  let settingsSent = false;

  // Track frame receive
  channel.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      // Binary = JPEG frame from server
      framesReceived++;
      lastRecvAt = Date.now();
      const size = ev.data.byteLength;
      if (framesReceived <= 5 || framesReceived % 100 === 0) {
        console.log(`  recv frame ${framesReceived}: ${(size / 1024).toFixed(1)} KB`);
      }
    } else if (typeof ev.data === "string") {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "stats") {
          timings.push(msg.timing || {});
          if (framesReceived <= 5 || framesReceived % 100 === 0) {
            const t = msg.timing || {};
            console.log(`    stats: total=${t.total_ms?.toFixed(1)}ms vae=${t.vae_encode_ms?.toFixed(1)}ms transformer=${t.transformer_plus_decode_ms?.toFixed(1)}ms worker=${msg.worker}`);
          }
        } else if (msg.type === "phase") {
          console.log(`  [server] phase: ${msg.stage}`);
        } else if (msg.type === "compile") {
          console.log(`  [server] compile: ${msg.status} ${msg.width}x${msg.height}`);
        }
      } catch {}
    }
  };

  channel.onopen = () => {
    console.log("DataChannel open");
  };
  channel.onclose = () => {
    console.log("DataChannel closed");
  };

  pc.onconnectionstatechange = () => {
    console.log(`Connection state: ${pc.connectionState}`);
  };
  pc.oniceconnectionstatechange = () => {
    console.log(`ICE state: ${pc.iceConnectionState}`);
  };

  // Create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Wait for ICE gathering
  await new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(resolve, 10000); // timeout
  });

  console.log("Sending offer to server...");

  // Send offer to signaling endpoint
  const resp = await fetch(`${SERVER_URL}/webrtc/offer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sdp: pc.localDescription }),
  });

  if (!resp.ok) {
    console.error(`Signaling failed: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }

  const { sdp: answerSdp } = await resp.json();
  await pc.setRemoteDescription(answerSdp);
  console.log("WebRTC connection established");

  // Wait for data channel to be open
  await new Promise((resolve) => {
    if (channel.readyState === "open") return resolve();
    const origOnOpen = channel.onopen;
    channel.onopen = (...a) => {
      if (origOnOpen) origOnOpen(...a);
      resolve();
    };
    setTimeout(() => {
      if (channel.readyState !== "open") {
        console.error(`DataChannel did not open in time (state=${channel.readyState})`);
        process.exit(1);
      }
      resolve();
    }, 30000);
  });

  console.log("DataChannel ready, sending settings...");

  // Send settings first
  channel.send(JSON.stringify({
    prompt: "vibrant neon cyberpunk city street at night, rain, reflections",
    width: WIDTH,
    height: HEIGHT,
    captureWidth: WIDTH,
    captureHeight: HEIGHT,
    alpha: ALPHA,
    n_steps: N_STEPS,
    seed: 42,
  }));
  settingsSent = true;

  // Wait a moment for settings to propagate
  await new Promise((r) => setTimeout(r, 500));

  // Pre-generate synthetic frame (JPEG-sized, like the browser sends)
  console.log(`Generating synthetic frame (${WIDTH}x${HEIGHT})...`);
  const frameBuffer = makeSyntheticFrame(WIDTH, HEIGHT);
  console.log();

  // Pump frames at a fixed interval
  console.log(`Starting frame pump (${FRAMES} frames at ${SEND_INTERVAL_MS}ms interval)...`);
  const startTime = Date.now();
  lastRecvAt = Date.now();

  const sendFrame = () => {
    if (framesSent >= FRAMES || hungAt !== null) return;

    // Check for hang
    const sinceLast = Date.now() - lastRecvAt;
    if (framesReceived > 0 && sinceLast > HANG_TIMEOUT_MS) {
      hungAt = framesSent;
      console.log(`\n!!! HANG DETECTED at frame ${framesSent} — no response in ${(sinceLast / 1000).toFixed(1)}s !!!`);
      console.log(`  frames sent: ${framesSent}, frames received: ${framesReceived}`);
      finish();
      return;
    }

    // Send frame as binary (like browser does)
    if (channel.readyState === "open") {
      const buffered = channel.bufferedAmount || 0;
      if (buffered < 2 * 1024 * 1024) { // 2MB cap
        channel.send(frameBuffer);
        framesSent++;
        if (framesSent <= 5 || framesSent % 500 === 0) {
          console.log(`  sent frame ${framesSent} (buffered=${(buffered / 1024).toFixed(0)}KB, recv=${framesReceived})`);
        }
      } else {
        // Channel congested, skip this send
        if (framesSent % 100 === 0) {
          console.log(`  [backpressure] buffered=${(buffered / 1024).toFixed(0)}KB, skipping send`);
        }
      }
    }

    setTimeout(sendFrame, SEND_INTERVAL_MS);
  };

  sendFrame();

  // Also check for hang periodically
  const hangChecker = setInterval(() => {
    if (hungAt !== null) { clearInterval(hangChecker); return; }
    if (framesReceived > 0) {
      const sinceLast = Date.now() - lastRecvAt;
      if (sinceLast > HANG_TIMEOUT_MS) {
        hungAt = framesSent;
        console.log(`\n!!! HANG DETECTED — no response in ${(sinceLast / 1000).toFixed(1)}s !!!`);
        console.log(`  frames sent: ${framesSent}, frames received: ${framesReceived}`);
        clearInterval(hangChecker);
        finish();
      }
    }
  }, 5000);

  // Wait for completion
  function finish() {
    clearInterval(hangChecker);
    const elapsed = (Date.now() - startTime) / 1000;

    console.log(`\n${"=".repeat(60)}`);
    if (hungAt) {
      console.log(`RESULT: HUNG at sent frame ${hungAt}/${FRAMES}`);
      console.log(`  Inference is stable (pipe test passed) — this is a WebRTC/Node.js issue.`);
    } else {
      console.log(`RESULT: All ${FRAMES} frames sent, ${framesReceived} received`);
    }

    console.log(`\n  Elapsed: ${elapsed.toFixed(1)}s`);
    console.log(`  Frames sent: ${framesSent}`);
    console.log(`  Frames received: ${framesReceived}`);
    console.log(`  Drop rate: ${((1 - framesReceived / framesSent) * 100).toFixed(1)}%`);

    if (timings.length > 0) {
      const totals = timings.map(t => t.total_ms || 0).filter(v => v > 0);
      if (totals.length > 0) {
        console.log(`\n  Inference timing (ms):`);
        console.log(`    total: mean=${(totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1)}  min=${Math.min(...totals).toFixed(1)}  max=${Math.max(...totals).toFixed(1)}`);
        console.log(`\n  Effective throughput: ${(framesReceived / elapsed).toFixed(1)} fps`);
      }
    }

    try { channel.close(); } catch {}
    try { pc.close(); } catch {}
    process.exit(hungAt ? 1 : 0);
  }

  // Wait for all frames to be sent, then give time for responses
  const waitForDone = setInterval(() => {
    if (hungAt !== null) { clearInterval(waitForDone); return; }
    if (framesSent >= FRAMES) {
      // Wait up to 30s for remaining responses
      setTimeout(() => {
        clearInterval(waitForDone);
        finish();
      }, 10000);
      clearInterval(waitForDone);
    }
  }, 1000);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
