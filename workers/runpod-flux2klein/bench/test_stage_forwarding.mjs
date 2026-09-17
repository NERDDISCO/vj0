import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const settle = () => new Promise(resolve => setImmediate(resolve));
for (const path of ['app/vj-next/VJNextApp.tsx', 'app/vj/VJApp.tsx']) {
  function fixture() {
    const source = fs.readFileSync(path, 'utf8');
    const start = source.indexOf('const stageSeq = ++stageFrameSeqRef.current;');
    const end = source.indexOf('});', source.indexOf('.catch(', start)) + 3;
    assert.ok(start > 0 && end > start);
    const posts = [], conversions = [];
    const channel = {postMessage: message => posts.push(message)};
    const context = vm.createContext({stageFrameSeqRef:{current:0}, stageCh:channel,
      stageChannelRef:{current:channel}, outWidth:512, outHeight:288,
      aiOutputWidth:512, aiOutputHeight:288});
    vm.runInContext('let forwardingActive=true; let publishedStageSeq=0;', context);
    vm.runInContext('globalThis.forward = frame => {' + source.slice(start, end) + '};', context);
    return {posts, conversions, context, send() {
      context.forward({blob:{arrayBuffer:() => new Promise(resolve => conversions.push(resolve))}});
    }};
  }

  test(path + ': continuous arrivals do not starve completed stage conversions', async () => {
    const f=fixture();f.send();
    for (let i=0;i<9;i++) {f.send();f.conversions[i](new ArrayBuffer(1));await settle();}
    assert.equal(f.posts.length,9);
    assert.deepEqual(f.posts.map(p=>p.seq),[1,2,3,4,5,6,7,8,9]);
  });
  test(path + ': old conversion cannot overwrite newer published frame or survive cleanup', async () => {
    const f=fixture();f.send();f.send();
    f.conversions[1](new ArrayBuffer(1));await settle();
    f.conversions[0](new ArrayBuffer(1));await settle();
    assert.deepEqual(f.posts.map(p=>p.seq),[2]);
    f.send();vm.runInContext('forwardingActive=false',f.context);
    f.conversions[2](new ArrayBuffer(1));await settle();assert.equal(f.posts.length,1);
  });
}
