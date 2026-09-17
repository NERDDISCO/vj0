import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {isCaptureFrameDue,advanceCaptureFrameDeadline} from './capture-diagnostics/load-cadence.mjs';

function fixture(layout) {
  const next = layout === 'next';
  const source = fs.readFileSync(path.join(process.env.VJ0_CAPTURE_TEST_SOURCE_ROOT || '.',
    next ? 'app/vj-next/VJNextApp.tsx' : 'app/vj/VJApp.tsx'), 'utf8');
  const start = source.indexOf('  const aiFrameLoop = useCallback(');
  const end = source.indexOf('\n  }, [aiTransport, aiFrameRate', start);
  const callback = source.slice(start, source.indexOf(']);', end) + 3);
  const effectStart = source.indexOf(next ? '  useEffect(() => {\n    const sender = senderRef.current;' : '  useEffect(() => {\n    const sender = aiFrameSenderRef.current;', end);
  const effectEnd = source.indexOf(next ? '  }, [generating, aiStatus, aiFrameLoop]);' : '  }, [aiSendFrames, aiShowCaptureDebug, aiStatus, aiFrameLoop, aiTransport]);', effectStart);
  assert.ok(start >= 0 && end > start && effectStart > end && effectEnd > effectStart);
  const effect = source.slice(effectStart, source.indexOf(']);', effectEnd) + 3);
  const rafs = new Map();
  let nextRaf = 0, draws = 0, sends = 0, blobCallback, effectCallback, clock = 1000;
  const capture = {width:512, height:288, getContext:() => ({drawImage:() => draws++}), toBlob:fn => {blobCallback=fn;}};
  const sender = {running:true, nextFrameTime:0, nextDebugFrameTime:0, pendingEncode:false, captureCanvas:null,
    captureCtx:null, debugCtx:null, resolution:0, frameCount:0, rafId:0, generation:0};
  const ref = {current:sender};
  const transport = {connected:true, admitted:true, isConnected(){return this.connected;},
    canSend(){return this.admitted;}, sendBinary(){sends++;}};
  const context = vm.createContext({
    isCaptureFrameDue,advanceCaptureFrameDeadline,
    useCallback:fn => fn, useEffect:fn => {effectCallback=fn;},
    requestAnimationFrame:fn => {rafs.set(++nextRaf,fn);return nextRaf;}, cancelAnimationFrame:id => rafs.delete(id),
    performance:{now:() => clock}, document:{createElement:() => capture},
    senderRef:ref, aiFrameSenderRef:ref, aiTransport:transport,
    inputCanvasRef:{current:{width:512,height:288}}, canvasRef:{current:{width:512,height:288}}, aiDebugCanvasRef:{current:null},
    aiFrameRate:60, outWidth:512, outHeight:288, aiOutputWidth:512, aiOutputHeight:288,
    aiShowCaptureDebug:false, aiSendFrames:true, generating:true, aiStatus:'connected',
    sentCountRef:{current:0}, recvCountRef:{current:0}, lastSendTimeRef:{current:0}, setAiPending:() => {},
  });
  vm.runInContext(ts.transpileModule(callback + '\n' + effect, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText, context);
  return {sender,transport,rafs,context,run:(timestamp=1000) => {clock=timestamp;return vm.runInContext(`aiFrameLoop(${timestamp})`,context);},
    effect:() => effectCallback(), draws:() => draws, sends:() => sends,
    finishEncode:async () => {blobCallback({arrayBuffer:async () => new ArrayBuffer(4)}); await new Promise(resolve => setImmediate(resolve));}};
}

for (const layout of ['next','legacy']) {
  test(`${layout}: healthy 60 Hz input captures all available frames at 60 FPS`, async () => {
    const f=fixture(layout);
    // lastFrameTime is retained only in this fixture so running this regression
    // against the previous app callback demonstrates the old rounding failure.
    f.sender.lastFrameTime=0;
    for(let i=0;i<600;i++){
      const before=f.draws();f.run(1000+Math.round(i*1000/60*10)/10);
      if(f.draws()>before)await f.finishEncode();
    }
    assert.equal(f.sends(),600);
  });
  test(`${layout}: effect cleanup/restart leaves exactly one animation loop`, () => {
    const f=fixture(layout);f.sender.running=false;
    const cleanup=f.effect();assert.equal(f.rafs.size,1);
    cleanup();assert.equal(f.rafs.size,0);
    f.effect();assert.equal(f.rafs.size,1);
  });
  test(`${layout}: congested transport skips the source canvas copy`, () => {
    const f=fixture(layout);f.transport.admitted=false;f.run();assert.equal(f.draws(),0);
    assert.equal(f.sender.nextFrameTime,0);
    f.transport.admitted=true;f.run(1001);assert.equal(f.draws(),1);
  });
  test(`${layout}: pending JPEG does not consume a capture deadline`, () => {
    const f=fixture(layout);f.sender.pendingEncode=true;f.run();assert.equal(f.draws(),0);
    assert.equal(f.sender.nextFrameTime,0);
    f.sender.pendingEncode=false;f.run(1001);assert.equal(f.draws(),1);
  });
  test(`${layout}: an absent source does not consume a capture deadline`, () => {
    const f=fixture(layout),ref=layout==='next'?f.context.inputCanvasRef:f.context.canvasRef;
    const source=ref.current;ref.current=null;f.run();assert.equal(f.draws(),0);
    assert.equal(f.sender.nextFrameTime,0);
    ref.current=source;f.run(1001);assert.equal(f.draws(),1);
  });
  test(`${layout}: congestion arising during JPEG encode prevents sending`, async () => {
    const f=fixture(layout);f.run();f.transport.admitted=false;await f.finishEncode();assert.equal(f.sends(),0);
    assert.equal(f.sender.pendingEncode,false);
  });
  test(`${layout}: an encode from a stopped loop cannot reach its replacement`, async () => {
    const f=fixture(layout);f.sender.running=false;const cleanup=f.effect();f.run();cleanup();f.effect();
    await f.finishEncode();assert.equal(f.sends(),0);
  });
}

test('legacy: capture debug continues updating while transport is congested', () => {
  const f=fixture('legacy');f.context.aiShowCaptureDebug=true;f.transport.admitted=false;f.run();assert.equal(f.draws(),1);
  assert.equal(f.sender.nextFrameTime,0);
  f.run(1001);assert.equal(f.draws(),1,'debug capture keeps its requested cadence');
  f.transport.admitted=true;f.run(1002);assert.equal(f.draws(),2,'debug deadline does not postpone sending');
});
