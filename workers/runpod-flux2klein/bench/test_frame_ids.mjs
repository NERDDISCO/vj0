import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('dispatcher keeps per-frame IDs separate from broadcast settings', () => {
  const frames = [], states = [];
  const context = vm.createContext({ workers: [{ ready: true }], pendingBootstrap: [],
    activeClientEpoch: 2,
    STATE_FIELDS: ['width', 'n_steps', 'jpegQuality'],
    broadcastState: state => states.push(state), dispatchFrame: frame => frames.push(frame) });
  vm.runInContext(source.slice(source.indexOf('function sendToInference('),
    source.indexOf('// Drop pending frames buffered')), context);
  context.sendToInference({ width: 512, jpegQuality: 60, client_epoch: 2, frame_id: 0, image_base64: 'image' });
  assert.equal(frames[0].client_epoch, 2);
  assert.equal(frames[0].frame_id, 0);
  assert.equal(frames[0].image_base64, 'image');
  assert.equal(states[0].jpegQuality, 60);
  assert.equal('frame_id' in states[0], false);
  context.sendToInference({ image_base64: 'plain' });
  assert.equal('frame_id' in frames[1], false);
  context.sendToInference({ client_epoch: 1, image_base64: 'stale' });
  assert.equal(frames.length, 2, 'stale buffered requests cannot reach a replacement client');
});

test('tagged responses echo IDs while ordinary clients still receive raw JPEG', () => {
  const sent = [];
  const context = vm.createContext({ Buffer, Date, console: { log() {}, error() {} },
    process: { env: {} }, BENCH_FRAME_MAGIC: 0x564a3042, MAX_OUTBOUND_BUFFER: 1048576,
    activeClientEpoch: 2, diagStats: { framesFromWorker: 0, framesToClient: 0, droppedByWorker: 0 },
    activeChannel: { readyState: 'open', bufferedAmount: 0, send: value => sent.push(value) } });
  vm.runInContext(source.slice(source.indexOf('function handleWorkerLine('),
    source.indexOf('// Pending requests buffered')), context);
  const worker = { gpu: 0, framePending: 2 };
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const frame = { status: 'frame', image_base64: jpeg.toString('base64') };
  context.handleWorkerLine(worker, JSON.stringify({ ...frame, frame_id: 42, client_epoch: 1 }));
  assert.equal(sent.length, 0, 'old tagged frames must not be sent to a replacement raw client');
  assert.equal(worker.framePending, 2, 'old output must not decrement new-session pending frames');
  context.handleWorkerLine(worker, JSON.stringify({ status: 'frame_dropped', client_epoch: 1 }));
  assert.equal(worker.framePending, 2, 'old queue drops must not affect the new session');
  context.handleWorkerLine(worker, JSON.stringify({ ...frame, frame_id: 42 }));
  assert.equal(sent[0].readUInt32BE(0), 0x564a3042);
  assert.equal(sent[0].readUInt32BE(4), 42);
  assert.deepEqual(sent[0].subarray(8), jpeg);
  context.handleWorkerLine(worker, JSON.stringify(frame));
  assert.deepEqual(sent[2], jpeg);
  assert.equal(worker.framePending, 0);
  worker.framePending = 1;
  context.handleWorkerLine(worker, JSON.stringify({ status: 'frame_dropped', client_epoch: 2 }));
  assert.equal(worker.framePending, 0, 'Python queue eviction must be acknowledged');
});
