/* Same-pod WebRTC measurement using pre-encoded synthetic JPEG inputs.
 * Usage: NODE_PATH=... node samehost_transport.cjs config.json
 * This measures receive throughput and send-to-receive age, NOT browser display
 * or capture/encode latency. Run with no other inference client attached.
 */
const fs=require('node:fs');
const {performance}=require('node:perf_hooks');
const {RTCPeerConnection}=require('@roamhq/wrtc');
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(!['stream','single'].includes(c.mode)||!(c.seconds>0)||!(c.sendFps>0)||!(c.maxBufferedBytes>0))throw new Error('Invalid mode/duration/send/buffer configuration');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const summary=values=>{
  if(!values.length)return {count:0};
  const s=[...values].sort((a,b)=>a-b);
  const p=q=>{const x=(s.length-1)*q;return s[Math.floor(x)]+(s[Math.ceil(x)]-s[Math.floor(x)])*(x%1);};
  return {count:s.length,mean:s.reduce((a,b)=>a+b,0)/s.length,p50:p(.5),p95:p(.95),p99:p(.99)};
};
async function until(check,seconds,description){
  const end=performance.now()+seconds*1000;
  while(!check()){if(performance.now()>end)throw new Error('Timeout: '+description);await wait(10);}
}
async function main(){
  const inputs=c.inputs.map(p=>fs.readFileSync(p));
  if(inputs.length<2)throw new Error('Multiple animated input fixtures required');
  const pc=new RTCPeerConnection({iceServers:[]});
  const channel=pc.createDataChannel('frames');channel.binaryType='arraybuffer';
  const pending=new Map(), ages=[], sizes=[], errors=[], workerMs=[], queueMs=[], telemetryMs=[], telemetrySnapshots=[];
  let id=0,phase='warmup',sent=0,received=0,bytesSent=0,bytesReceived=0,skips=0,warmReceived=0,timer;
  let lastReceivedAt=null,confirmedVariant=false,warmStats=0;
  let telemetryTimer;
  let telemetryPending=Promise.resolve();
  const telemetryPolls={attempted:0,completedWithinWindow:0,failedWithinWindow:0,censored:0};
  channel.onclose=()=>{if(phase==='measure')errors.push('Data channel closed during measurement');};
  channel.onerror=event=>{if(phase==='measure')errors.push('Data channel error: '+String(event));};
  pc.onconnectionstatechange=()=>{
    if(phase==='measure'&&['failed','disconnected','closed'].includes(pc.connectionState))errors.push('Peer became '+pc.connectionState);
  };
  const send=()=>{
    if(channel.readyState!=='open'||(c.mode==='single'&&pending.size))return;
    if(channel.bufferedAmount>=c.maxBufferedBytes){if(phase==='measure')skips++;return;}
    const input=inputs[id%inputs.length],packet=Buffer.allocUnsafe(input.length+8);
    packet.writeUInt32BE(0x564a3042,0);packet.writeUInt32BE(++id,4);input.copy(packet,8);
    pending.set(id,{at:performance.now(),phase});
    if(pending.size>4096)pending.delete(pending.keys().next().value);
    channel.send(packet);
    if(phase==='measure'){sent++;bytesSent+=packet.length;}
  };
  channel.onmessage=event=>{
    if(phase==='drain'||phase==='finished')return;
    if(typeof event.data==='string'){
      try{const m=JSON.parse(event.data);if(phase==='warmup'&&m.type==='stats')warmStats++;
        if(phase==='measure'&&m.type==='stats'&&m.timing){
          workerMs.push(m.timing.total_ms);
          if(Number.isFinite(m.timing.queue_wait_ms))queueMs.push(m.timing.queue_wait_ms);
          else if(c.requireQueueTiming)errors.push('Missing queue timing');
        }
        if(m.type==='stats'&&c.serverConfig?.benchmarkVariant){
          const expected=c.serverConfig.benchmarkVariant;
          if(m.timing?.benchmark_variant!==expected||m.timing?.stage_clock!==(expected==='baseline'?'wall-clock':'cuda-events')||
             m.width!==c.width||m.height!==c.height)errors.push('Worker variant, timing clock or dimensions mismatch');
          else confirmedVariant=true;
        }
        if(m.type==='compile'&&m.status!=='warmed'&&phase==='measure')errors.push('Compilation overlapped measurement');
        if((m.type==='error'||m.status==='error')&&phase==='measure')errors.push('Worker error: '+String(m.message));
      }catch{}return;
    }
    const bytes=Buffer.from(event.data);
    if(bytes.length<10||bytes.readUInt32BE(0)!==0x564a3042){errors.push('Missing ID envelope');return;}
    const frameId=bytes.readUInt32BE(4),capture=pending.get(frameId);pending.delete(frameId);
    if(bytes[8]!==0xff||bytes[9]!==0xd8){errors.push('Output is not JPEG');return;}
    if(phase==='warmup')warmReceived++;
    if(phase==='measure'&&capture?.phase==='measure'){
      received++;bytesReceived+=bytes.length;ages.push(performance.now()-capture.at);sizes.push(bytes.length);
      lastReceivedAt=performance.now();
    }
  };
  try{
    if(c.serverConfig){
      const response=await fetch(c.server+'/benchmark/config',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(c.serverConfig),signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error('Could not configure benchmark server');
      const applied=await response.json();
      for(const key of Object.keys(c.serverConfig))if(applied[key]!==c.serverConfig[key])throw new Error('Configuration acknowledgement mismatch: '+key);
    }
    const debug=await (await fetch(c.server+'/debug',{signal:AbortSignal.timeout(10000)})).json();
    if(debug.protocol?.benchmarkFrameIds!==1)throw new Error('Server does not advertise IDs');
    await pc.setLocalDescription(await pc.createOffer());
    await until(()=>pc.iceGatheringState==='complete',10,'local candidates');
    const response=await fetch(c.server+'/webrtc/offer',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({sdp:pc.localDescription}),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error('Signaling failed '+response.status);
    const answer=await response.json();await pc.setRemoteDescription(answer.sdp);
    await until(()=>channel.readyState==='open',30,'data channel');
    channel.send(JSON.stringify({prompt:c.prompt,seed:42,alpha:.1,n_steps:2,width:c.width,height:c.height,
      captureWidth:c.width,captureHeight:c.height,jpegQuality:80}));
    // Single-flight warmup cannot leave unacknowledged input in the pipe.
    for(let n=0;n<20;n++){const before=warmReceived;send();await until(()=>warmReceived>before,30,'warmup frame');}
    await until(()=>pending.size===0,10,'warmup completion');
    if(c.serverConfig?.benchmarkVariant)await until(()=>warmStats===warmReceived,10,'warmup stats completion');
    if(errors.length||c.serverConfig?.benchmarkVariant&&!confirmedVariant)throw new Error('Warmup validation failed: '+errors.join('; '));
    phase='measure';const begin=performance.now();
    if(c.telemetryEveryMs>0){
      let busy=false;
      telemetryTimer=setInterval(()=>{
        if(busy||phase!=='measure')return;
        busy=true;const start=performance.now();
        telemetryPolls.attempted++;
        telemetryPending=(async()=>{
        try{
          const response=await fetch(c.server+'/telemetry',{signal:AbortSignal.timeout(5000)});
          if(!response.ok)throw new Error('HTTP '+response.status);
          const snapshot=await response.json();
          if(phase==='measure'){
            telemetryPolls.completedWithinWindow++;
            telemetryMs.push(performance.now()-start);
            telemetrySnapshots.push({elapsedMs:performance.now()-begin,gpus:snapshot.gpus,workers:snapshot.workers});
          }else telemetryPolls.censored++;
        }catch(e){
          if(phase==='measure'){errors.push('Telemetry: '+e.message);telemetryPolls.failedWithinWindow++;}
          else telemetryPolls.censored++;
        }
        finally{busy=false;}
        })();
      },c.telemetryEveryMs);
    }
    timer=setInterval(send,1000/c.sendFps);send();
    await wait(c.seconds*1000);
    const stopped=performance.now(),elapsed=(stopped-begin)/1000;
    if(channel.readyState!=='open'||pc.connectionState!=='connected')errors.push('Connection not active at measurement end');
    if(lastReceivedAt===null||stopped-lastReceivedAt>2000)errors.push('No output in the final two seconds');
    phase='drain';clearInterval(timer);clearInterval(telemetryTimer);
    await telemetryPending;
    if(c.requireQueueTiming&&!queueMs.length)errors.push('No worker queue measurements');
    if(c.telemetryEveryMs>0&&(!telemetrySnapshots.length||telemetrySnapshots.some(s=>!s.gpus?.length||s.gpus.some(g=>!Number.isFinite(g.utilPct)))))errors.push('Incomplete GPU telemetry');
    let statsTimeout;
    const stats=Array.from((await Promise.race([pc.getStats(),new Promise((_,reject)=>{
      statsTimeout=setTimeout(()=>reject(new Error('RTC stats timed out')),5000);
    })]).finally(()=>clearTimeout(statsTimeout))).values()).filter(s=>s.type==='candidate-pair'&&s.state==='succeeded');
    const report={status:received>0&&!errors.length?'measured':'invalid',config:c,date:new Date().toISOString(),
      measurement:'same-pod pre-encoded JPEG send to receive; no browser encode/decode/display',
      elapsedSeconds:elapsed,sent,received,receivedFps:received/elapsed,
      outboundMbps:bytesSent*8/elapsed/1e6,inboundMbps:bytesReceived*8/elapsed/1e6,
      sendToReceiveMs:summary(ages),outputBytes:summary(sizes),workerMs:summary(workerMs),workerQueueMs:summary(queueMs),
      telemetryMs:summary(telemetryMs),telemetrySnapshots,telemetryPolls,bufferSkips:skips,errors,transport:stats};
    fs.writeFileSync(c.output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
    if(report.status!=='measured')throw new Error('Invalid measurement');
  }finally{phase='finished';clearInterval(timer);clearInterval(telemetryTimer);await telemetryPending;channel.close();pc.close();}
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.stack);process.exit(1);});
