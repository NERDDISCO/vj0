// Run with a generated extended dispatcher path as the first argument.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(process.argv[2], 'utf8');
let route;
const modes = [];
const context = vm.createContext({
  app:{get:(_path, handler)=>{route=handler;}},
  BENCH_TELEMETRY_MODE:'async', console,
  benchSync_buildTelemetrySnapshot:()=>{modes.push('sync');return {mode:'sync'};},
  getTelemetrySnapshotCached:async()=>{modes.push('async');return {mode:'async'};},
});
vm.runInContext(source.slice(source.indexOf('app.get("/telemetry",'),
  source.indexOf('async function getTelemetrySnapshotCached()')),context);
for (const mode of ['async','sync','async']) {
  context.BENCH_TELEMETRY_MODE=mode;
  let result;
  await route({}, {json:value=>{result=value;}});
  assert.equal(result.mode,mode);
}
assert.deepEqual(modes,['async','sync','async']);

function frameTest({frames,bytes,buffered,fixed}) {
  const sent=[];
  const c=vm.createContext({Buffer,Date,console:{log(){},error(){}},process:{env:{}},
    BENCH_FRAME_MAGIC:0x564a3042,MAX_OUTBOUND_BUFFER:fixed,BENCH_OUTBOUND_FRAMES:frames,
    activeClientEpoch:1,droppedOutbound:0,diagStats:{framesFromWorker:0,framesToClient:0,droppedOutbound:0},
    activeChannel:{readyState:'open',bufferedAmount:buffered,send:value=>sent.push(value)}});
  vm.runInContext(source.slice(source.indexOf('function handleWorkerLine('),
    source.indexOf('// Pending requests buffered')),c);
  c.handleWorkerLine({gpu:0,framePending:1},JSON.stringify({status:'frame',frame_id:1,
    client_epoch:1,image_base64:Buffer.alloc(bytes).toString('base64')}));
  return {sent:sent.some(Buffer.isBuffer),budget:c.diagStats.outboundBudgetBytes};
}
assert.equal(frameTest({frames:0,bytes:131072,buffered:65536,fixed:16384}).sent,false);
assert.deepEqual(frameTest({frames:1,bytes:131072,buffered:65536,fixed:16384}),
  {sent:true,budget:131080});
assert.equal(frameTest({frames:1,bytes:16384,buffered:65536,fixed:131072}).sent,false);
assert.equal(frameTest({frames:0,bytes:16384,buffered:65536,fixed:131072}).sent,true);
assert.equal(frameTest({frames:2,bytes:4,buffered:0,fixed:131072}).budget,16384);
console.log('Passed telemetry route selection and frame-size-aware admission controls');
