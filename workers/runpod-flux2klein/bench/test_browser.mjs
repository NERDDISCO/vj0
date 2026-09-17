// Dependency-free regression checks for browser benchmark measurement failures.
// Run: node --test workers/runpod-flux2klein/bench/test_browser.mjs
// Override source: VJ0_BROWSER_BENCH_SOURCE=/path/to/browser.js node --test ...
// Tests modify browser globals; keep them sequential.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = process.env.VJ0_BROWSER_BENCH_SOURCE ??
  new URL('./browser.js', import.meta.url);
const { runBenchmark } = await import('data:text/javascript;base64,' +
  Buffer.from(await readFile(source)).toString('base64'));

function installBrowser({ decodeFails = false, responseDelay = () => 0,
  inputDelay = () => 0, lateStats = false } = {}) {
  const decodedRequestNumbers = [];
  const timers = new Set();
  let framePending = 0, framesToClient = 0, framesFromClient = 0, activeChannel;
  const context = {
    fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, drawImage() {},
  };
  globalThis.OffscreenCanvas = class {
    getContext() { return context; }
    async convertToBlob() { return new Blob(['fake-input-jpeg']); }
  };
  globalThis.createImageBitmap = async (blob) => {
    if (decodeFails) throw new Error('Invalid JPEG');
    decodedRequestNumbers.push(Number(await blob.text()));
    return { width: 512, height: 288, close() {} };
  };
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => url.endsWith('/debug') ? {
      stats: { framesToClient, framesFromClient }, workers: [{ ready: true, framePending }],
      channel: { bufferedAmount: 0 },
    } : { sdp: { type: 'answer', sdp: 'fake' } },
  });
  globalThis.RTCPeerConnection = class {
    iceGatheringState = 'complete';
    localDescription = { type: 'offer', sdp: 'fake' };
    createDataChannel() {
      let count = 0;
      const channel = {
        readyState: 'open', bufferedAmount: 0,
        close() {
          this.readyState = 'closed';
          for (const timer of timers) clearTimeout(timer);
          timers.clear();
        },
        send(bytes) {
          if (typeof bytes === 'string') return;
          const number = ++count;
          const intakeTimer = setTimeout(() => {
            timers.delete(intakeTimer);
            if (channel.readyState !== 'open') return;
            framesFromClient++;
            framePending++;
            const responseTimer = setTimeout(() => {
              timers.delete(responseTimer);
              if (channel.readyState === 'open') {
                framePending--;
                framesToClient++;
                channel.onmessage({ data: new TextEncoder().encode(String(number)).buffer });
              }
            }, responseDelay(number));
            timers.add(responseTimer);
          }, inputDelay(number));
          timers.add(intakeTimer);
        },
      };
      activeChannel = channel;
      return channel;
    }
    async createOffer() { return this.localDescription; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    async getStats() {
      if (lateStats) {
        activeChannel.onmessage({ data: JSON.stringify({ type: 'stats', timing: { total_ms: 999999 } }) });
        activeChannel.onmessage({ data: JSON.stringify({ type: 'compile', status: 'compiling', worker: 0 }) });
      }
      return new Map();
    }
    close() {}
  };
  return { decodedRequestNumbers };
}

await test('all JPEG decodes failing cannot be a successful measured run', async () => {
  installBrowser({ decodeFails: true });
  const result = await runBenchmark({
    server: 'https://mock', warmupFrames: 1, sendFps: 1000, seconds: 0.03,
  });
  console.log('Decode reproduction:', JSON.stringify({
    status: result.status,
    received: result.counts.received,
    decoded: result.counts.decodedDrawn,
    decodeErrors: result.counts.decodeErrors,
  }));
  assert.ok(result.counts.received > 0, 'fixture must deliver image payloads');
  assert.equal(result.counts.decodedDrawn, 0);
  assert.notEqual(result.status, 'measured', 'decode failure must invalidate the run');
});

await test('single mode excludes outstanding warmup responses from measured latency', async () => {
  const { decodedRequestNumbers } = installBrowser({
    // Request 1 finishes immediately. Request 2 starts during warmup, remains
    // outstanding past the old two-second silence check, then contaminates the
    // measured window. Later requests cannot return within its 600 ms window.
    responseDelay: (number) => number === 1 ? 0 : number === 2 ? 2400 : 1000,
  });
  const result = await runBenchmark({
    server: 'https://mock', warmupFrames: 1, sendFps: 1000,
    seconds: 0.6, mode: 'single',
  });
  console.log('Drain reproduction:', JSON.stringify({
    status: result.status, decodedRequestNumbers,
    sent: result.counts.sent, received: result.counts.received,
    claimedLatency: result.distributions.requestResponseMs.mean,
    frameAge: result.frameAge,
  }));
  assert.equal(decodedRequestNumbers.includes(2), false,
    'warmup request 2 must not be decoded or assigned latency in the measured window');
  assert.equal(result.distributions.requestResponseMs.count, 0);
});

await test('late control messages cannot alter a closed measurement window', async () => {
  installBrowser({ lateStats: true });
  const result = await runBenchmark({ server: 'https://mock', warmupFrames: 1,
    sendFps: 1000, seconds: 0.05, mode: 'single' });
  assert.equal(result.status, 'measured');
  assert.equal(result.counts.compileDuringMeasurement, false);
  assert.equal(result.distributions.workerTimingMs.count, 0);
});

await test('stream mode waits for remote receipt of all warmup inputs', async () => {
  const { decodedRequestNumbers } = installBrowser({
    // bufferedAmount is already zero while ordered inputs are still in transit.
    inputDelay: (number) => number === 1 ? 0 : 2400,
  });
  const result = await runBenchmark({ server: 'https://mock', warmupFrames: 1,
    sendFps: 1000, seconds: 0.6, mode: 'stream' });
  assert.equal(decodedRequestNumbers.includes(2), false,
    'delayed warmup input must not produce a measured output');
  assert.equal(result.counts.received, 0,
    'actual measured requests cannot arrive within this short measurement window');
});
