/* Deterministic scheduler boundary tests, not a substitute for browser FPS. */
import assert from 'node:assert/strict';
import {isCaptureFrameDue,advanceCaptureFrameDeadline} from './load-cadence.mjs';

function run({variant,refresh,fps,seconds=10,encodeMs=0,blocked=[],jitter=false,pause=false}) {
  let last=0,next=0,pendingUntil=0;
  const sends=[],counts={ticks:0,cadence:0,pending:0,backpressure:0};
  const interval=1000/fps;
  for(let i=0;i<refresh*seconds;i++){
    const stamp=1000+i*1000/refresh;
    if(pause&&stamp>=4000&&stamp<7000)continue;
    const now=jitter?Math.round((stamp+(i%7)*.07)*10)/10:stamp;
    counts.ticks++;
    if(variant==='current'){
      if(now-last<interval){counts.cadence++;continue;}
      last=now;
    }else if(!isCaptureFrameDue(stamp,next)){counts.cadence++;continue;}
    if(blocked.some(([a,b])=>stamp>=a&&stamp<b)){counts.backpressure++;continue;}
    if(stamp<pendingUntil){counts.pending++;continue;}
    if(variant==='phase'){
      next=advanceCaptureFrameDeadline(stamp,next,fps);
    }
    pendingUntil=stamp+encodeMs;sends.push(stamp);
  }
  assert.equal(new Set(sends).size,sends.length,'at most one capture per source tick');
  for(const [a,b] of blocked)assert.ok(sends.every(t=>t<a||t>=b),'no capture under backpressure');
  for(let i=1;i<sends.length;i++)assert.ok(sends[i]>sends[i-1],'monotonic capture');
  return {variant,refresh,fps,seconds,encodeMs,blocked,jitter,pause,counts,sent:sends.length,sendFps:sends.length/seconds,sends};
}
const results=[];
for(const refresh of [30,59.94,60,120,144])for(const fps of [10,15,20,30,60,120])for(const jitter of [false,true]){
  for(const variant of ['current','phase']){
    const result=run({variant,refresh,fps,jitter});
    if(variant==='phase')assert.ok(Math.abs(result.sent-Math.min(refresh,fps)*10)<=1.01,JSON.stringify(result));
    results.push(result);
  }
}
for(const options of [{encodeMs:20},{encodeMs:40},{blocked:[[3000,4000],[7000,7350]]},{pause:true}]){
  for(const variant of ['current','phase']){
    const result=run({variant,refresh:60,fps:60,jitter:true,...options});
    if(variant==='phase'&&options.blocked)for(const [,end] of options.blocked){
      const first=result.sends.find(t=>t>=end);assert.ok(first-end<=1000/60+.001,'resume within one available source tick');
    }
    results.push(result);
  }
}
console.log(JSON.stringify({test:'deterministic timing model; excludes browser, JPEG, GPU and network',passed:true,results},null,2));
