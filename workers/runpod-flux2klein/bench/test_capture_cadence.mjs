import test from 'node:test';
import assert from 'node:assert/strict';
import {isCaptureFrameDue,advanceCaptureFrameDeadline} from './capture-diagnostics/load-cadence.mjs';

for(const refresh of [30,59.94,60,120,144])for(const fps of [10,20,30,60,120]){
  test(`${refresh} Hz source targets ${fps} FPS without rounding drift`,()=>{
    let next=0,count=0;
    for(let i=0;i<refresh*10;i++){
      const timestamp=Math.round(i*1000/refresh*10)/10;
      if(!isCaptureFrameDue(timestamp,next))continue;
      count++;next=advanceCaptureFrameDeadline(timestamp,next,fps);
      assert.ok(!isCaptureFrameDue(timestamp,next),'one capture per source tick');
    }
    assert.ok(Math.abs(count-Math.min(fps,refresh)*10)<=1.01,`observed ${count} frames`);
  });
}
test('long suspension discards missed deadlines instead of creating a catch-up burst',()=>{
  let next=advanceCaptureFrameDeadline(0,0,30);
  assert.ok(isCaptureFrameDue(10000,next));
  next=advanceCaptureFrameDeadline(10000,next,30);
  assert.ok(!isCaptureFrameDue(10001,next));
  assert.ok(!isCaptureFrameDue(10016.7,next));
  assert.ok(isCaptureFrameDue(10033.3,next));
});
test('blocked encodes resume at the next available source tick',()=>{
  let next=0,pendingUntil=0,count=0;
  for(let i=0;i<600;i++){
    const timestamp=i*1000/60;
    if(!isCaptureFrameDue(timestamp,next)||timestamp<pendingUntil)continue;
    next=advanceCaptureFrameDeadline(timestamp,next,60);
    pendingUntil=timestamp+20;count++;
  }
  assert.equal(count,300);
});
test('a restarted loop can immediately capture with a new requested rate',()=>{
  advanceCaptureFrameDeadline(2000,0,60);
  const resetDeadline=0;
  assert.ok(isCaptureFrameDue(2001,resetDeadline));
  const next=advanceCaptureFrameDeadline(2001,resetDeadline,20);
  assert.equal(next,2051);
});
