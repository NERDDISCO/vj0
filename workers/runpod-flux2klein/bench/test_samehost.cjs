// CPU-only whole-script regression checks; all I/O and WebRTC are mocked.
// Usage: node workers/runpod-flux2klein/bench/test_samehost.cjs [repository-root]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = process.argv[2] || process.cwd();
const source = fs.readFileSync(path.join(root, 'workers/runpod-flux2klein/bench/samehost_transport.cjs'), 'utf8');

async function scenario(failure) {
  let now = 0, channel, peer, report, exitCode, interval, timeoutId = 0;
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const timers = new Map(), calls = [], messages = [];
  const config = {
    inputs: ['one.jpg', 'two.jpg'], server: 'http://mock', mode: 'single',
    sendFps: 30, seconds: 10, maxBufferedBytes: 65536, width: 512, height: 288,
    prompt: 'test', output: 'result.json',
  };
  class Peer {
    constructor() { peer = this; this.iceGatheringState = 'complete'; this.connectionState = 'connected'; }
    createDataChannel() {
      channel = {
        readyState: 'open', bufferedAmount: 0,
        send(data) {
          if (typeof data !== 'string' && !(failure === 'silence' && now >= 5000)) {
            this.onmessage({ data });
          }
        },
        close() { this.readyState = 'closed'; this.onclose?.(); },
      };
      return channel;
    }
    async createOffer() { return {}; }
    async setLocalDescription() { this.localDescription = {}; }
    async setRemoteDescription() {}
    getStats() { return failure === 'stats-timeout' ? new Promise(() => {}) : Promise.resolve(new Map()); }
    close() { this.connectionState = 'closed'; this.onconnectionstatechange?.(); }
  }
  const mockfs = {
    readFileSync(p) { return p === 'config.json' ? JSON.stringify(config) : Buffer.from([255, 216, 255, 217]); },
    writeFileSync(p, text) { assert.equal(p, 'result.json'); report = JSON.parse(text); },
  };
  const context = {
    require(name) {
      if (name === 'node:fs') return mockfs;
      if (name === 'node:perf_hooks') return { performance: { now: () => now } };
      if (name === '@roamhq/wrtc') return { RTCPeerConnection: Peer };
      throw Error('Unexpected module: ' + name);
    },
    process: { argv: ['node', 'test', 'config.json'], exit(code) { exitCode = code; finish(); } },
    console: { log() {}, error(message) { messages.push(String(message)); } },
    Buffer, AbortSignal: { timeout: timeoutMs => ({ timeoutMs }) },
    setInterval(fn) { interval = fn; return 1; },
    clearInterval() { interval = null; },
    clearTimeout(id) { timers.delete(id); },
    setTimeout(fn, ms) {
      if (ms === config.seconds * 1000) {
        for (let tick = 1; tick <= 100; tick++) {
          now = tick * 100;
          if (tick === 50) {
            if (failure === 'closed' || failure === 'transient-close') {
              channel.readyState = 'closed'; channel.onclose?.();
            } else if (failure === 'worker-error') {
              channel.onmessage({ data: JSON.stringify({ type: 'error', message: 'GPU failure' }) });
            } else if (failure === 'worker-status-error') {
              channel.onmessage({ data: JSON.stringify({ status: 'error', message: 'GPU failure' }) });
            } else if (failure === 'peer-failed') {
              peer.connectionState = 'failed'; peer.onconnectionstatechange?.();
            }
          }
          if (tick === 51 && failure === 'transient-close') channel.readyState = 'open';
          interval?.();
        }
        queueMicrotask(fn);
        return 0;
      }
      const id = ++timeoutId;
      timers.set(id, fn);
      setImmediate(() => {
        if (timers.has(id)) { timers.delete(id); now += ms; fn(); }
      });
      return id;
    },
    fetch: async (url, options) => {
      calls.push({ url, timeoutMs: options?.signal?.timeoutMs });
      return { ok: true, json: async () => url.endsWith('/debug') ? { protocol: { benchmarkFrameIds: 1 } } : { sdp: {} } };
    },
  };
  vm.runInNewContext(source, context);
  await finished;
  assert.equal(calls[0].timeoutMs, 10000, '/debug must supply an abort deadline');
  assert.equal(calls[1].timeoutMs, 20000, 'Signaling must supply an abort deadline');
  assert.equal(channel.readyState, 'closed', 'Finally must close the channel');
  assert.equal(peer.connectionState, 'closed', 'Finally must close the peer');
  return { failure, report, exitCode, messages };
}

(async () => {
  const good = await scenario('none');
  assert.equal(good.exitCode, 0);
  assert.equal(good.report.status, 'measured');
  assert.equal(good.report.elapsedSeconds, 10);
  assert.equal(good.report.receivedFps, good.report.received / 10);
  console.log(JSON.stringify({ scenario: 'success control', status: good.report.status, received: good.report.received }));
  for (const failure of ['closed', 'transient-close', 'worker-error', 'worker-status-error', 'peer-failed', 'silence']) {
    const result = await scenario(failure);
    assert.ok(result.report.received > 0, 'Failure must be tested after some successful traffic');
    assert.equal(result.exitCode, 1, failure);
    assert.equal(result.report.status, 'invalid', failure);
    assert.ok(result.report.errors.length > 0, failure);
    console.log(JSON.stringify({ scenario: failure, status: result.report.status, errors: result.report.errors }));
  }
  const timeout = await scenario('stats-timeout');
  assert.equal(timeout.exitCode, 1);
  assert.ok(timeout.messages.some(message => message.includes('RTC stats timed out')));
  console.log('PASS: getStats timeout exits unsuccessfully and closes transport');
})().catch(error => { console.error(error); process.exitCode = 1; });
