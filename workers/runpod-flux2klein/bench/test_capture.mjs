import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fixture(layout) {
  const next = layout === 'next';
  const source = fs.readFileSync(next ? 'app/vj-next/VJNextApp.tsx' : 'app/vj/VJApp.tsx', 'utf8');
  const start = source.indexOf('  const aiFrameLoop = useCallback(() => {');
  const end = source.indexOf('\n  }, [aiTransport, aiFrameRate', start);
  const callback = source.slice(start, source.indexOf(']);', end) + 3);
  const effectStart = source.indexOf(next ? '  useEffect(() => {\n    const sender = senderRef.current;' : '  useEffect(() => {\n    const sender = aiFrameSenderRef.current;', end);
  const effectEnd = source.indexOf(next ? '  }, [generating, aiStatus, aiFrameLoop]);' : '  }, [aiSendFrames, aiShowCaptureDebug, aiStatus, aiFrameLoop, aiTransport]);', effectStart);
  assert.ok(start >= 0 && end > start && effectStart > end && effectEnd > effectStart);
  const effect = source.slice(effectStart, source.indexOf(']);', effectEnd) + 3);
  const rafs = new Map();
  let nextRaf = 0, draws = 0, sends = 0, blobCallback, effectCallback;
  const capture = {width:512, height:288, getContext:() => ({drawImage:() => draws++}), toBlob:fn => {blobCallback=fn;}};
  const sender = {running:true, lastFrameTime:0, pendingEncode:false, captureCanvas:null,
    captureCtx:null, debugCtx:null, resolution:0, frameCount:0, rafId:0, generation:0};
  const ref = {current:sender};
  const transport = {connected:true, admitted:true, isConnected(){return this.connected;},
    canSend(){return this.admitted;}, sendBinary(){sends++;}};
  const context = vm.createContext({
    useCallback:fn => fn, useEffect:fn => {effectCallback=fn;},
    requestAnimationFrame:fn => {rafs.set(++nextRaf,fn);return nextRaf;}, cancelAnimationFrame:id => rafs.delete(id),
    performance:{now:() => 1000}, document:{createElement:() => capture},
    senderRef:ref, aiFrameSenderRef:ref, aiTransport:transport,
    inputCanvasRef:{current:{width:512,height:288}}, canvasRef:{current:{width:512,height:288}}, aiDebugCanvasRef:{current:null},
    aiFrameRate:60, outWidth:512, outHeight:288, aiOutputWidth:512, aiOutputHeight:288,
    aiShowCaptureDebug:false, aiSendFrames:true, generating:true, aiStatus:'connected',
    sentCountRef:{current:0}, recvCountRef:{current:0}, lastSendTimeRef:{current:0}, setAiPending:() => {},
  });
  vm.runInContext(ts.transpileModule(callback + '\n' + effect, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText, context);
  return {sender,transport,rafs,context,run:() => vm.runInContext('aiFrameLoop()',context),
    effect:() => effectCallback(), draws:() => draws, sends:() => sends,
    finishEncode:async () => {blobCallback({arrayBuffer:async () => new ArrayBuffer(4)}); await new Promise(resolve => setImmediate(resolve));}};
}

for (const layout of ['next','legacy']) {
  test(`${layout}: effect cleanup/restart leaves exactly one animation loop`, () => {
    const f=fixture(layout);f.sender.running=false;
    const cleanup=f.effect();assert.equal(f.rafs.size,1);
    cleanup();assert.equal(f.rafs.size,0);
    f.effect();assert.equal(f.rafs.size,1);
  });
  test(`${layout}: congested transport skips the source canvas copy`, () => {
    const f=fixture(layout);f.transport.admitted=false;f.run();assert.equal(f.draws(),0);
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
});
