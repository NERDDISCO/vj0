// Exercise the actual dispatcher handlers without spawning GPU workers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
function fixture() {
  const messages = [], memo = new Map();
  let now = 100_000, killed = false, watchdog;
  const worker = { gpu: 0, ready: true, framePending: 1, lastFrameAt: now,
    compileStartedAt: 0, compileFinishedAt: 0, stdoutBuf: '',
    proc: { stdin: { write() { return true; } }, kill() { killed = true; } } };
  const context = vm.createContext({ console: { log() {}, error() {} },
    Date: { now: () => now }, workers: [worker], latestCompileByWorker: memo,
    activeChannel: { readyState: 'open', send: s => messages.push(JSON.parse(s)) },
    setInterval: fn => { watchdog = fn; }, process: { env: {} },
    nextReadyWorker: () => worker, MAX_PENDING_PER_WORKER: 3,
    diagStats: { framesToWorker: 0, droppedInbound: 0 }, droppedInbound: 0 });
  vm.runInContext(source.slice(source.indexOf('function dispatchFrame('),
    source.indexOf('// Public: send a client request')), context);
  vm.runInContext(source.slice(source.indexOf('function handleWorkerLine('),
    source.indexOf('// Pending requests buffered')), context);
  vm.runInContext(source.slice(source.indexOf('const WATCHDOG_INTERVAL_MS'),
    source.indexOf('// Graceful shutdown')), context);
  return { worker, messages, memo, send: msg => context.handleWorkerLine(worker, JSON.stringify(msg)),
    dispatch: () => context.dispatchFrame({ frame: 'fixture' }),
    tick: ms => { now += ms; watchdog(); }, killed: () => killed };
}

test('long compilation survives the frame watchdog and success grants a fresh frame deadline', () => {
  const f = fixture();
  f.send({ status: 'compiling', width: 768, height: 448 });
  f.tick(200_000);
  assert.equal(f.killed(), false);
  f.send({ status: 'warmed', width: 768, height: 448 });
  assert.equal(f.memo.size, 0);
  assert.equal(f.worker.lastFrameAt, 100_000, 'compile must not invent a generated frame');
  f.tick(29_000);
  assert.equal(f.killed(), false);
  f.tick(2_000);
  assert.equal(f.killed(), true, 'a subsequent real frame stall must still restart');
});

test('compile failure ends replay and watchdog exemption and accounts for a dropped live frame', () => {
  const f = fixture();
  f.worker.framePending = 2;
  f.send({ status: 'compiling', width: 768, height: 448 });
  f.tick(60_000);
  f.send({ status: 'compile_failed', width: 768, height: 448, frame_dropped: true, message: 'fixture' });
  assert.equal(f.memo.size, 0);
  assert.equal(f.worker.compileStartedAt, 0);
  assert.equal(f.worker.framePending, 1);
  assert.equal(f.messages.at(-1).status, 'compile_failed');
  assert.equal(f.messages.at(-1).message, 'fixture');
  f.tick(31_000);
  assert.equal(f.killed(), true);
});

test('progress cannot extend an indefinitely stalled compilation', () => {
  const f = fixture();
  f.send({ status: 'compiling' });
  f.tick(500_000);
  f.send({ status: 'compiling_progress' });
  f.tick(101_000);
  assert.equal(f.killed(), true);
});

test('compile timeout applies during boot and idle startup warmup without pending frames', () => {
  for (const [ready, pending] of [[false, 0], [false, 1], [true, 0]]) {
    const f = fixture();
    f.worker.ready = ready;
    f.worker.framePending = pending;
    f.send({ status: 'compiling' });
    f.tick(601_000);
    assert.equal(f.killed(), true, `ready=${ready} pending=${pending}`);
  }
});

test('an idle worker gets a full processing deadline when frames resume', () => {
  const f = fixture();
  f.worker.framePending = 0;
  f.tick(90_000);
  assert.equal(f.killed(), false);
  f.dispatch();
  f.tick(5_000);
  assert.equal(f.killed(), false, 'idle time must not count as a stalled request');
  f.tick(24_000);
  assert.equal(f.killed(), false);
  f.dispatch();
  f.tick(2_000);
  assert.equal(f.killed(), true, 'additional queued input must not extend a stalled request');
});

test('the first request to a ready worker is also bounded without a prior output', () => {
  const f = fixture();
  f.worker.framePending = 0;
  f.worker.lastFrameAt = 0;
  f.dispatch();
  f.tick(31_000);
  assert.equal(f.killed(), true);
});
