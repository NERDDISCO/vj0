// CPU-only regression checks; no browser, network, GPU, or repository writes.
// Usage: node workers/runpod-flux2klein/bench/test_app_probe.mjs [repository-root]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = process.argv[2] || process.cwd();
let now = 0, urlId = 0, bcCount = 0;
const loads = [], rafs = [], globals = {};
class FakeBlob {
  constructor(parts = []) { this.parts = parts; this.size = 4; }
  async arrayBuffer() { return new ArrayBuffer(4); }
}
class Canvas {
  constructor() { this.width = 512; this.height = 288; }
  toBlob(callback) { callback(new FakeBlob()); }
}
class Image { isConnected = true; }
class GL {
  texImage2D() {}
  drawArrays() {}
  getParameter() { return null; }
}
class Channel {
  constructor() { this.listeners = []; this.readyState = 'open'; }
  addEventListener(type, fn) { if (type === 'message') this.listeners.push(fn); }
  send(data) { this.lastSent = data; }
  receive(data) {
    const event = { data };
    for (const fn of this.listeners) fn(event);
    return event;
  }
}
class PC {
  createDataChannel() { return new Channel(); }
  addEventListener() {}
}
class BC {
  constructor(name) { bcCount++; this.name = name; this.listeners = []; }
  addEventListener(kind, fn) { this.listeners.push(fn); }
  postMessage() {}
  receive(data) { for (const fn of this.listeners) fn({ data }); }
}
class Analyser { getFloatTimeDomainData() {} }
const context = {
  performance: { timeOrigin: 1000, now: () => now },
  Blob: FakeBlob, HTMLCanvasElement: Canvas, HTMLImageElement: Image,
  WebGL2RenderingContext: GL, RTCPeerConnection: PC, BroadcastChannel: BC,
  AnalyserNode: Analyser,
  URL: { createObjectURL: () => `blob:${++urlId}`, revokeObjectURL() {} },
  document: { addEventListener: (kind, fn) => { if (kind === 'load') loads.push(fn); } },
  createImageBitmap: async () => ({}),
  addEventListener: (name, fn) => { globals[name] = fn; },
  requestAnimationFrame: fn => rafs.push(fn),
  navigator: {}, ArrayBuffer, DataView, Uint8Array,
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'workers/runpod-flux2klein/bench/app_probe.js'), 'utf8'), context);
assert.equal(bcCount, 0, 'Installing the probe must not add a JPEG subscriber');
const probe = context.vj0AppProbe;
const ch = new context.RTCPeerConnection().createDataChannel('frames');
const canvas = new context.HTMLCanvasElement();
const img = new context.HTMLImageElement();
probe.begin();
async function imageUrl() {
  let blob;
  canvas.toBlob(b => { blob = b; });
  ch.send(await blob.arrayBuffer());
  return context.URL.createObjectURL(new context.Blob([ch.receive(ch.lastSent).data]));
}
const rafRows = () => probe.snapshot().rows.filter(r => r.kind === 'preview-image-raf');
for (let i = 0; i < 2; i++) {
  img.src = img.currentSrc = await imageUrl();
  loads[0]({ target: img });
  now += 5;
}
assert.equal(rafs.length, 1, 'Coalesce two loads of one element before RAF');
now = 16;
rafs.shift()();
assert.deepEqual(Array.from(rafRows(), r => r.id), [2]);
img.src = img.currentSrc = await imageUrl();
loads[0]({ target: img });
img.isConnected = false;
rafs.shift()();
assert.equal(rafRows().length, 1, 'Detached images cannot count as RAF-visible');
img.isConnected = true;
img.src = img.currentSrc = await imageUrl();
loads[0]({ target: img });
img.src = img.currentSrc = await imageUrl();
rafs.shift()();
assert.equal(rafRows().length, 1, 'A replacement without a load event cannot count');
img.src = img.currentSrc = await imageUrl();
loads[0]({ target: img });
context.URL.revokeObjectURL(img.src);
rafs.shift()();
assert.equal(rafRows().length, 2, 'Revoking a still-loaded URL must not erase its RAF metadata');
assert.equal(probe.snapshot().rafDiagnostics.revokedButStillLoaded, 1);
const bc = new context.BroadcastChannel('vj0-stage');
bc.receive({ type: 'frame', bytes: new ArrayBuffer(1), benchmarkMeta: { id: 99, capture: 1000 } });
assert.equal(probe.snapshot().rows.filter(r => r.kind === 'stage-message').length, 1);
const earlier = probe.snapshot();
const earlierRows = earlier.rows.length;
await imageUrl();
assert.equal(earlier.rows.length, earlierRows, 'Snapshots must copy collection arrays');
now = 100;
const ended = probe.end(), frozen = JSON.stringify(ended);
now = 200;
probe.setAudio(.2);
globals.error({ message: 'late' });
globals.unhandledrejection({ reason: 'late rejection' });
assert.equal(probe.snapshot().at, 1100);
assert.equal(probe.end().at, 1100, 'Repeated end must preserve its timestamp');
assert.equal(JSON.stringify(ended), frozen);
assert.equal(probe.snapshot().errors.length, 0);
assert.deepEqual(Array.from(probe.snapshot().events), Array.from(ended.events));
console.log('PASS: probe RAF coalescing, replacement/disposal guards, real channel only, copied snapshots, and frozen completion');
