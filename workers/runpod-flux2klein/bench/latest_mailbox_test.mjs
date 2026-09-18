import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const directory = mkdtempSync(join(tmpdir(), 'vj0-latest-mailbox-'));
const output = join(directory, 'server.js');
execFileSync('python3', [new URL('latest_mailbox.py', import.meta.url).pathname,
  '--source', new URL('../server.js', import.meta.url).pathname, '--output', output]);
const source = readFileSync(output, 'utf8');
execFileSync('node', ['--check', output]);
rmSync(directory, { recursive: true });

function setup(count = 1) {
  const sent = [], writes = [];
  const workers = Array.from({ length: count }, (_, gpu) => ({ gpu, ready: true,
    framePending: 0, compileStartedAt: 0, lastFrameAt: 0,
    proc: { stdin: { write(line) { writes.push({ gpu, ...JSON.parse(line) }); return true; } } } }));
  const context = vm.createContext({ workers, Buffer, Date, Object,
    process: { env: {} }, console: { log() {}, error() {} },
    STATE_FIELDS: ['prompt', 'seed', 'alpha', 'n_steps', 'width', 'height', 'jpegQuality'],
    latestState: {}, latestCompileByWorker: new Map(), roundRobinIdx: 0,
    activeClientEpoch: 1, nextSourceSequence: 0, lastSentSourceSequence: 0,
    BENCH_FRAME_MAGIC: 0x564a3042, MAX_OUTBOUND_BUFFER: 1048576, droppedOutbound: 0,
    diagStats: { framesToWorker: 0, framesFromWorker: 0, framesToClient: 0,
      droppedInbound: 0, droppedOutbound: 0, droppedByWorker: 0 },
    activeChannel: { readyState: 'open', bufferedAmount: 0, send(v) { sent.push(v); }, close() {} },
    activePc: null, disconnectTimer: null, clearTimeout() {} });
  vm.runInContext(source.slice(source.indexOf('// Latest-input mailbox experiment:'),
    source.indexOf('// ---------------- WebRTC layer')), context);
  vm.runInContext(source.slice(source.indexOf('function closeActivePc()'),
    source.indexOf('function waitForIceGatheringComplete(')), context);
  const frames = () => writes.filter(x => x.image_base64);
  function input(id, extra = {}) {
    context.sendToInference({ image_base64: Buffer.from([255,216,id,255,217]).toString('base64'),
      frame_id: id, client_epoch: context.activeClientEpoch, ...extra });
  }
  function complete(gpu = 0, extra = {}) {
    const flight = workers[gpu].latestMailboxFlight;
    context.handleWorkerLine(workers[gpu], JSON.stringify({ status: 'frame',
      ...flight, width: 512, height: 288, ...extra }));
  }
  function message(gpu, msg) { context.handleWorkerLine(workers[gpu], JSON.stringify(msg)); }
  return { context, workers, sent, writes, frames, input, complete, message };
}

test('one active request plus one global latest input; completion flushes without another browser tick', () => {
  const h = setup();
  h.input(1); h.input(2); h.input(3);
  assert.deepEqual(h.frames().map(x => x.frame_id), [1]);
  assert.equal(h.workers[0].framePending, 1);
  assert.equal(h.context.diagStats.mailboxReplaced, 1);
  h.complete();
  assert.deepEqual(h.frames().map(x => x.frame_id), [1, 3]);
  assert.equal(h.workers[0].framePending, 1);
  assert.equal(h.frames()[1].source_seq, 3, 'arrival identity is not reassigned at dispatch');
  assert.ok(Object.isFrozen(h.workers[0].latestMailboxFlight));
  h.complete();
  assert.equal(h.workers[0].framePending, 0);
});

test('two GPUs share only one waiting image and retain monotonic delivered source order', () => {
  const h = setup(2);
  for (let i = 1; i <= 5; i++) h.input(i);
  assert.deepEqual(h.frames().map(x => x.frame_id), [1, 2]);
  h.complete(1);
  assert.deepEqual(h.frames().map(x => x.frame_id), [1, 2, 5]);
  h.complete(0);
  assert.equal(h.context.diagStats.droppedStaleSource, 1);
  h.complete(1);
  const images = h.sent.filter(Buffer.isBuffer);
  assert.deepEqual(images.map(x => x.readUInt32BE(4)), [2, 5]);
  assert.equal(h.workers.every(x => x.framePending === 0), true);
});

test('all settings invalidate waiting input while in-flight accounting survives', () => {
  for (const field of ['prompt', 'seed', 'alpha', 'n_steps', 'width', 'height', 'jpegQuality']) {
    const h = setup();
    h.input(1); h.input(2);
    h.context.sendToInference({ [field]: field === 'prompt' ? 'new prompt' : 2, client_epoch: 1 });
    h.complete();
    assert.equal(h.frames().length, 1, field);
    h.input(3);
    assert.equal(h.frames().length, 2, field);
  }
});

test('reconnect preserves physical occupancy, clears waiting input, and old completion releases exactly once', () => {
  const h = setup();
  h.input(1); h.input(2);
  const old = { ...h.workers[0].latestMailboxFlight };
  h.context.closeActivePc();
  assert.equal(h.workers[0].framePending, 1, 'old GPU work remains physically in flight');
  h.context.activeChannel = { readyState: 'open', bufferedAmount: 0, send(v) { h.sent.push(v); } };
  h.input(3); h.input(4);
  assert.equal(h.frames().length, 1);
  h.message(0, { status: 'frame', ...old });
  assert.deepEqual(h.frames().map(x => x.frame_id), [1, 4]);
  assert.equal(h.workers[0].framePending, 1);
  assert.equal(h.sent.filter(Buffer.isBuffer).length, 0, 'old epoch output never reaches replacement channel');
  h.message(0, { status: 'frame', ...old });
  assert.equal(h.workers[0].framePending, 1, 'duplicate old result does not free new work');
  h.complete();
  assert.equal(h.workers[0].framePending, 0);
});

test('frame drop, per-frame error, and compile failure release capacity immediately after accounting', () => {
  for (const msg of [{ status: 'frame_dropped' }, { status: 'error', frame_dropped: true },
    { status: 'compile_failed', frame_dropped: true }]) {
    const h = setup();
    h.input(1); h.input(2);
    h.message(0, { ...msg, client_epoch: 1 });
    assert.deepEqual(h.frames().map(x => x.frame_id), [1, 2]);
    assert.equal(h.workers[0].framePending, 1);
    h.complete();
    assert.equal(h.workers[0].framePending, 0);
  }
});

test('compile start invalidates waiting input, excludes busy compiler, and warmed dispatches the newly arrived latest', () => {
  const h = setup();
  h.workers[0].ready = false;
  h.input(1); h.input(2);
  assert.equal(h.frames().length, 0);
  h.message(0, { status: 'compiling', width: 512, height: 288 });
  h.message(0, { status: 'ready' });
  assert.equal(h.frames().length, 0);
  h.input(3); h.input(4);
  h.message(0, { status: 'warmed', width: 512, height: 288 });
  assert.deepEqual(h.frames().map(x => x.frame_id), [4]);
});

test('failed stdin write tries another worker and backpressured accepted writes stay occupied', () => {
  const h = setup(2);
  h.workers[0].proc.stdin.write = () => { throw new Error('closed pipe'); };
  const write = h.workers[1].proc.stdin.write;
  h.workers[1].proc.stdin.write = line => { write(line); return false; };
  h.input(1); h.input(2);
  assert.deepEqual(h.frames().map(x => [x.gpu, x.frame_id]), [[1, 1]]);
  assert.equal(h.workers[0].ready, false);
  assert.equal(h.workers[1].framePending, 1);
  h.complete(1);
  assert.deepEqual(h.frames().map(x => [x.gpu, x.frame_id]), [[1, 1], [1, 2]]);
});

test('closed or congested outbound channel never breaks pending accounting or monotonic output', () => {
  const h = setup();
  h.input(1); h.input(2);
  h.context.activeChannel.bufferedAmount = 2 * 1048576;
  h.complete();
  assert.deepEqual(h.frames().map(x => x.frame_id), [1, 2]);
  h.context.activeChannel.readyState = 'closed';
  h.input(3);
  h.complete();
  assert.equal(h.frames().length, 2);
  assert.equal(h.workers[0].framePending, 0);
  assert.equal(h.sent.filter(Buffer.isBuffer).length, 0);
});

test('switching policy requires drain; disabled mode preserves original pending-three admission', () => {
  const h = setup();
  h.input(1);
  assert.throws(() => h.context.configureLatestMailbox(false), /Drain/);
  h.complete();
  assert.equal(h.context.configureLatestMailbox(false).enabled, false);
  for (let i = 2; i <= 5; i++) h.input(i);
  assert.deepEqual(h.frames().map(x => x.frame_id), [1, 2, 3, 4]);
  assert.equal(h.workers[0].framePending, 3);
  assert.equal(h.context.diagStats.droppedInbound, 1);
});

test('policy switching rejects bootstrap images and settings before they can overwrite newer mailbox input', () => {
  for (const kind of ['image', 'settings']) {
    const h = setup();
    h.context.configureLatestMailbox(false);
    h.workers[0].ready = false;
    if (kind === 'image') h.input(1);
    else h.context.sendToInference({ prompt: 'old bootstrap prompt', client_epoch: 1 });
    assert.equal(h.workers[0].framePending, 0, 'bootstrap requests are not physical worker requests yet');
    assert.throws(() => h.context.configureLatestMailbox(true), /Drain all bootstrap requests/, kind);

    // Finish bootstrap under its original policy, including the actual image
    // request if present; only then can the switch safely accept new input.
    h.message(0, { status: 'ready' });
    if (kind === 'image') {
      h.message(0, { status: 'frame', ...h.frames()[0], width: 512, height: 288 });
    }
    assert.equal(h.context.configureLatestMailbox(true).enabled, true);
    h.input(2, { prompt: 'new mailbox prompt' });
    h.input(3);
    h.complete();
    h.complete();
    assert.deepEqual(h.frames().map(x => x.frame_id), kind === 'image' ? [1, 2, 3] : [2, 3]);
    assert.equal(h.context.latestState.prompt, 'new mailbox prompt');
    assert.equal(h.workers[0].framePending, 0);
  }
});

test('duplicate source response cannot consume another frame slot; invalid source still reports protocol error', () => {
  for (const invalid of [null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const h = setup();
    h.input(1); h.input(2);
    const old = { ...h.workers[0].latestMailboxFlight };
    h.complete();
    h.message(0, { status: 'frame', ...old });
    assert.equal(h.workers[0].framePending, 1);
    h.complete(0, { source_seq: invalid });
    assert.equal(h.workers[0].framePending, 0, `invalid source ${invalid}`);
    assert.equal(h.context.diagStats.invalidSourceSequence, 1);
  }
});
