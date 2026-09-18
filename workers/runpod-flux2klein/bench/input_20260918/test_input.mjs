import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('./input_probe_extra.js',import.meta.url),'utf8');
function fixture(thresholdBytes=65536){
  const listeners={},sent=[],intervals=[],timers=new Map();let timerId=0;
  const ch={readyState:'open',bufferedAmount:32768,ordered:true,maxRetransmits:null,maxPacketLifeTime:null,
    addEventListener:(type,fn)=>listeners[type]=fn,send:data=>sent.push(JSON.parse(data))};
  function Peer(){};Peer.prototype.createDataChannel=()=>ch;
  function Analyser(){};Analyser.prototype.getFloatTimeDomainData=array=>array.fill(0.3);
  const c={window:{vj0AppProbe:{setAudio(){}}},localStorage:{getItem:()=>JSON.stringify({thresholdBytes})},
    RTCPeerConnection:Peer,AnalyserNode:Analyser,performance:{timeOrigin:0,now:()=>1000},structuredClone,
    setInterval:fn=>intervals.push(fn),setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},
    clearTimeout:id=>timers.delete(id)};
  vm.createContext(c);vm.runInContext(source,c);
  return {api:c.window.__VJ0_INPUT_BENCH,ch,listeners,sent,peer:new c.RTCPeerConnection(),intervals};
}
test('same requested threshold reaches both unchanged transport checks',()=>{
  const f=fixture(),seen=[];f.api.begin();
  const transport={getBufferedAmount:()=>70000,canSend:n=>{seen.push(n);return 70000<n;}};
  assert.equal(f.api.canSend(transport,'before-encode'),false);
  assert.equal(f.api.canSend(transport,'before-send'),false);
  assert.deepEqual(seen,[65536,65536]);assert.equal(f.api.snapshot().checks['before-send'].rejected,1);
});
test('records current rather than last-send buffer bytes',()=>{
  const f=fixture();f.peer.createDataChannel();f.api.begin();f.intervals[0]();
  f.ch.bufferedAmount=0;f.intervals[0]();
  assert.deepEqual(Array.from(f.api.snapshot().samples,x=>x.channels[0].bufferedAmount),[32768,0]);
});
test('ordered barrier waits for matching acknowledged nonce',async()=>{
  const f=fixture();f.peer.createDataChannel();const promise=f.api.barrier();
  assert.equal(f.sent[0].type,'vj0-input-barrier');
  f.listeners.message({data:JSON.stringify({type:'vj0-input-barrier-ack',nonce:f.sent[0].nonce,status:'passed'})});
  assert.equal((await promise).ack.status,'passed');
});
test('rejects partial reliability instead of claiming ordered drain',()=>{
  const f=fixture();f.peer.createDataChannel();f.ch.maxRetransmits=0;
  assert.throws(()=>f.api.barrier(),/reliable ordered/);
});
test('rejects unsupported threshold',()=>assert.throws(()=>fixture(1),/Unsupported input threshold/));
