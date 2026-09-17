import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(process.env.VJ0_SERVER_SOURCE || new URL('../server.js', import.meta.url), 'utf8');

test('dispatcher keeps per-frame IDs separate from broadcast settings', () => {
  const frames = [], states = [];
  const context = vm.createContext({ workers: [{ ready: true }], pendingBootstrap: [],
    activeClientEpoch: 2, nextSourceSequence: 0,
    STATE_FIELDS: ['width', 'n_steps', 'jpegQuality'],
    broadcastState: state => states.push(state), dispatchFrame: frame => frames.push(frame) });
  vm.runInContext(source.slice(source.indexOf('function sendToInference('),
    source.indexOf('// Drop pending frames buffered')), context);
  context.sendToInference({ width: 512, jpegQuality: 60, client_epoch: 2, frame_id: 0, image_base64: 'image' });
  assert.equal(frames[0].client_epoch, 2);
  assert.equal(frames[0].frame_id, 0);
  assert.equal(frames[0].image_base64, 'image');
  assert.equal(frames[0].source_seq, 1);
  assert.equal(states[0].jpegQuality, 60);
  assert.equal('frame_id' in states[0], false);
  context.sendToInference({ image_base64: 'plain' });
  assert.equal('frame_id' in frames[1], false);
  assert.equal(frames[1].source_seq, 2, 'untagged traffic has internal source order');
  context.sendToInference({ client_epoch: 1, image_base64: 'stale' });
  assert.equal(frames.length, 2, 'stale buffered requests cannot reach a replacement client');
});

for (const tagged of [false, true]) test(`late GPU output cannot reverse ${tagged ? 'tagged' : 'raw JPEG'} source order`, () => {
  const sent = [];
  const context = vm.createContext({ Buffer, Date, console: { log() {}, error() {} },
    process: { env: {} }, BENCH_FRAME_MAGIC: 0x564a3042, MAX_OUTBOUND_BUFFER: 1024,
    droppedOutbound: 0, activeClientEpoch: 2, lastSentSourceSequence: 0,
    diagStats: { framesFromWorker: 0, framesToClient: 0, droppedOutbound: 0 },
    activeChannel: { readyState: 'open', bufferedAmount: 0, send: value => sent.push(value) } });
  vm.runInContext(source.slice(source.indexOf('function handleWorkerLine('),
    source.indexOf('// Pending requests buffered')), context);
  const workers = [{ gpu: 0, framePending: 3 }, { gpu: 1, framePending: 3 }];
  function complete(gpu, sequence, epoch = 2) {
    const image = Buffer.from([0xff, 0xd8, sequence, 0xff, 0xd9]);
    context.handleWorkerLine(workers[gpu], JSON.stringify({ status: 'frame',
      client_epoch: epoch, source_seq: sequence, image_base64: image.toString('base64'),
      ...(tagged ? { frame_id: sequence } : {}) }));
  }
  complete(1, 2);
  complete(0, 1);
  assert.equal(sent.filter(Buffer.isBuffer).length, 1, 'late older image is dropped');
  assert.equal(workers[0].framePending, 2, 'discarded output still releases pending capacity');
  assert.equal(workers[0].framesProduced, 1);
  assert.ok(workers[0].lastFrameAt > 0, 'discarded output is worker liveness');
  assert.equal(context.diagStats.framesFromWorker, 2);
  assert.equal(context.diagStats.droppedStaleSource, 1);
  complete(0, 200, 1);
  assert.equal(workers[0].framePending, 2, 'old epoch neither consumes new capacity nor poisons source order');
  context.activeChannel.bufferedAmount = 2048;
  complete(1, 4);
  context.activeChannel.bufferedAmount = 0;
  complete(0, 3);
  const images = sent.filter(Buffer.isBuffer);
  assert.equal(images.length, 2, 'congestion discard does not reject a still-newer deliverable source');
  assert.deepEqual(images.map(b => tagged ? b.readUInt32BE(4) : b[2]), [2, 3]);
  assert.equal(sent.filter(v => typeof v === 'string').length, 2, 'no orphan stats for discarded images');
  assert.equal(context.diagStats.framesToClient, 2);
  assert.equal(context.diagStats.droppedOutbound, 1);
  const channelSend = context.activeChannel.send;
  context.activeChannel.send = value => {
    if (typeof value === 'string') throw new Error('stats send failed');
    channelSend(value);
  };
  assert.throws(() => complete(1, 5), /stats send failed/);
  context.activeChannel.send = channelSend;
  complete(0, 4);
  assert.equal(sent.filter(Buffer.isBuffer).length, 3, 'successful JPEG advances order even if later stats send fails');
  context.handleWorkerLine(workers[0], JSON.stringify({status:'frame', client_epoch:2, image_base64:'/9j/2Q=='}));
  assert.equal(context.diagStats.invalidSourceSequence, 1, 'mismatched worker protocol is counted and rejected');
  assert.equal(sent.filter(Buffer.isBuffer).length, 3);
});

test('tagged responses echo IDs while ordinary clients still receive raw JPEG', () => {
  const sent = [];
  const context = vm.createContext({ Buffer, Date, console: { log() {}, error() {} },
    process: { env: {} }, BENCH_FRAME_MAGIC: 0x564a3042, MAX_OUTBOUND_BUFFER: 1048576,
    activeClientEpoch: 2, lastSentSourceSequence: 0, diagStats: { framesFromWorker: 0, framesToClient: 0, droppedByWorker: 0 },
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
  context.handleWorkerLine(worker, JSON.stringify({ ...frame, frame_id: 42, source_seq: 1 }));
  assert.equal(sent[0].readUInt32BE(0), 0x564a3042);
  assert.equal(sent[0].readUInt32BE(4), 42);
  assert.deepEqual(sent[0].subarray(8), jpeg);
  context.handleWorkerLine(worker, JSON.stringify({ ...frame, source_seq: 2 }));
  assert.deepEqual(sent[2], jpeg);
  assert.equal(worker.framePending, 0);
  worker.framePending = 1;
  context.handleWorkerLine(worker, JSON.stringify({ status: 'frame_dropped', client_epoch: 2 }));
  assert.equal(worker.framePending, 0, 'Python queue eviction must be acknowledged');
});
