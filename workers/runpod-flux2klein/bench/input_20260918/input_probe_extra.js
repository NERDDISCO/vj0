// Appended to the existing source-ID/audio probe in an isolated browser only.
(() => {
  const config=JSON.parse(localStorage.getItem('vj0-input-benchmark')||'{}');
  const thresholdBytes=config.thresholdBytes??262144;
  if(![262144,65536,16384].includes(thresholdBytes))throw Error('Unsupported input threshold');
  const channels=[],acks=new Map();let recording=false,samples=[],checks={},impulses=[],pulseTimers=[],audioRms=[],plannedImpulses=[];
  let latestRms=null,latestAudioAt=null;
  const epoch=()=>performance.timeOrigin+performance.now();
  const channelState=()=>channels.map(c=>({readyState:c.readyState,bufferedAmount:c.bufferedAmount,
    ordered:c.ordered,maxRetransmits:c.maxRetransmits,maxPacketLifeTime:c.maxPacketLifeTime}));
  const previousCreate=RTCPeerConnection.prototype.createDataChannel;
  RTCPeerConnection.prototype.createDataChannel=function(...args){
    const ch=previousCreate.apply(this,args);channels.push(ch);
    ch.addEventListener('message',event=>{
      if(typeof event.data!=='string')return;
      try{const m=JSON.parse(event.data);if(m.type==='vj0-input-barrier-ack'&&acks.has(m.nonce)){
        const callback=acks.get(m.nonce);acks.delete(m.nonce);callback(m);
      }}catch{}
    });
    return ch;
  };
  const previousAnalyser=AnalyserNode.prototype.getFloatTimeDomainData;
  AnalyserNode.prototype.getFloatTimeDomainData=function(array){
    const result=previousAnalyser.call(this,array);
    let sum=0;for(let i=0;i<array.length;i++)sum+=array[i]*array[i];
    latestRms=Math.sqrt(sum/array.length);latestAudioAt=epoch();
    if(recording)audioRms.push({at:latestAudioAt,rms:latestRms});
    return result;
  };
  function stopImpulses(){for(const timer of pulseTimers)clearTimeout(timer);pulseTimers=[];}
  const api={thresholdBytes,get latestRms(){return latestRms;},get latestAudioAt(){return latestAudioAt;},
    canSend(transport,phase){
      const buffered=transport.getBufferedAmount(),allowed=transport.canSend(thresholdBytes);
      if(recording){const c=checks[phase]??={calls:0,rejected:0,maxBufferedBytes:0};c.calls++;
        if(!allowed)c.rejected++;c.maxBufferedBytes=Math.max(c.maxBufferedBytes,buffered);}
      return allowed;
    },
    begin(){stopImpulses();samples=[];checks={};impulses=[];audioRms=[];plannedImpulses=[];recording=true;},
    end(){recording=false;stopImpulses();return api.snapshot();},
    snapshot(){return {thresholdBytes,channels:channelState(),checks:structuredClone(checks),
      samples:samples.slice(),impulses:impulses.slice(),plannedImpulses:plannedImpulses.slice(),audioRms:audioRms.slice()};},
    startImpulses(seconds){
      const start=epoch();
      for(let i=0;2500+i*3000+100+1500<seconds*1000;i++){
        const delay=2500+i*3000,duration=i%2?100:40;
        plannedImpulses.push({index:i,plannedAt:start+delay,durationMs:duration});
        pulseTimers.push(setTimeout(()=>{const onAt=epoch();
          window.vj0AppProbe.setAudio(0.65,220);
          impulses.push({index:i,kind:'on',plannedAt:start+delay,at:onAt,durationMs:duration,level:0.65});
          pulseTimers.push(setTimeout(()=>{window.vj0AppProbe.setAudio(0.2,110);
            impulses.push({index:i,kind:'off',at:epoch(),level:0.2});},duration));
        },delay));
      }
    },
    barrier(){
      const live=channels.filter(c=>c.readyState==='open');
      if(live.length!==1)throw Error('Barrier requires exactly one open channel');
      const ch=live[0];
      if(!ch.ordered||ch.maxRetransmits!==null||ch.maxPacketLifeTime!==null)
        throw Error('Barrier requires the unchanged reliable ordered channel');
      const nonce='input-'+Date.now()+'-'+Math.random().toString(36).slice(2);
      const before={at:epoch(),channels:channelState()};
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{acks.delete(nonce);reject(Error('Ordered input barrier timed out'));},35000);
        acks.set(nonce,ack=>{clearTimeout(timer);if(ack.status!=='passed')reject(Error(JSON.stringify(ack)));
          else resolve({before,ack,receivedAt:epoch(),after:channelState()});});
        ch.send(JSON.stringify({type:'vj0-input-barrier',nonce}));
      });
    }
  };
  Object.defineProperty(window,'__VJ0_INPUT_BENCH',{value:api,writable:false});
  setInterval(()=>{if(recording)samples.push({at:epoch(),channels:channelState()});},100);
})();
