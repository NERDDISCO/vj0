import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./barrier_runtime.js',import.meta.url),'utf8');
function fixture(){
  const messages=[],timers=[];let now=0;
  const channel={readyState:'open',bufferedAmount:0,send:s=>messages.push(JSON.parse(s))};
  const c={Date:{now:()=>now},setTimeout:fn=>timers.push(fn),activeChannel:channel,
    activeClientEpoch:7,nextSourceSequence:42,diagStats:{framesFromClient:50},
    pendingBootstrap:[],latestMailboxWaiting:null,
    workers:[{ready:true,framePending:0,latestMailboxFlight:null,compileStartedAt:0}]};
  vm.createContext(c);vm.runInContext(source,c);
  return {c,channel,messages,start:()=>c.beginInputBenchmarkBarrier(channel,7,'test-1'),
    tick(ms=10){now+=ms;const next=timers.shift();if(next)next();}};
}
test('idle barrier acknowledges the exact receive/source watermark',()=>{
  const f=fixture();f.start();assert.equal(f.messages[0].status,'passed');
  assert.equal(f.messages[0].receivedAtBarrier,50);assert.equal(f.messages[0].sourceAtBarrier,42);
});
for(const stage of ['pending','flight','compile','notReady','mailbox','bootstrap','outbound']){
  test('waits for '+stage,()=>{
    const f=fixture(),w=f.c.workers[0];
    if(stage==='pending')w.framePending=1;
    if(stage==='flight')w.latestMailboxFlight={};
    if(stage==='compile')w.compileStartedAt=1;
    if(stage==='notReady')w.ready=false;
    if(stage==='mailbox')f.c.latestMailboxWaiting={};
    if(stage==='bootstrap')f.c.pendingBootstrap.push({});
    if(stage==='outbound')f.channel.bufferedAmount=1;
    f.start();assert.equal(f.messages.length,0);
    Object.assign(w,{ready:true,framePending:0,latestMailboxFlight:null,compileStartedAt:0});
    f.c.latestMailboxWaiting=null;f.c.pendingBootstrap=[];f.channel.bufferedAmount=0;
    f.tick();assert.equal(f.messages[0].status,'passed');
  });
}
test('rejects later input before acknowledging',()=>{
  const f=fixture();f.c.workers[0].framePending=1;f.start();
  f.c.diagStats.framesFromClient++;f.tick();assert.equal(f.messages[0].status,'failed');
});
test('does not acknowledge on a replaced connection',()=>{
  const f=fixture();f.c.workers[0].framePending=1;f.start();
  f.c.activeClientEpoch++;f.tick();assert.equal(f.messages.length,0);
});
test('bounded failure when worker cannot drain',()=>{
  const f=fixture();f.c.workers[0].framePending=1;f.start();f.tick(30000);
  assert.equal(f.messages[0].status,'failed');
});
