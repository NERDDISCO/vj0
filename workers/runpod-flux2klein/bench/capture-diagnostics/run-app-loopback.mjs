// Usage: node run-app-loopback.mjs browser-websocket-url output-directory
// Keeps probe, viewport and focus CDP sessions attached throughout each trial.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [url, output] = process.argv.slice(2);
if (!url || !output || fs.existsSync(output)) throw Error('New output directory required');
fs.mkdirSync(output, {recursive:true});
const here = path.dirname(new URL(import.meta.url).pathname);
const origin = process.env.VJ0_BENCH_ORIGIN || 'http://127.0.0.1:18766';
const fixture = JSON.parse(fs.readFileSync('docs/performance/2026-09-17/app-source-order/identity.json')).fixture;
const probe = fs.readFileSync(path.join(here,'../app_probe.js'),'utf8');
const loopback = fs.readFileSync(path.join(here,'app-loopback.js'),'utf8');
const socket = new WebSocket(url), pending = new Map();
let id = 0;
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data), item = pending.get(message.id);
  if (item) {pending.delete(message.id); clearTimeout(item.timer);message.error?item.reject(Error(JSON.stringify(message.error))):item.resolve(message.result);}
});
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
const call = (method,params={},sessionId) => new Promise((resolve,reject)=>{
  const key = ++id, timer=setTimeout(()=>{pending.delete(key);reject(Error(method+' timeout'));},45000);
  pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params,sessionId}));
});
const sessions = {}, targets = {};
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const evaluate = async (target,expression) => {
  const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true},sessions[target]);
  if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const wait = async (target,expression) => {
  for(let i=0;i<100;i++){if(await evaluate(target,expression))return;await sleep(200);}
  throw Error('Wait failed: '+expression);
};
try {
  fs.writeFileSync(path.join(output,'identity.json'),JSON.stringify({boundary:'Actual app with local browser WebRTC JPEG echo; no GPU/model/WAN. Unique submissions, not physical display FPS.',
    buildId:fs.readFileSync(path.join(process.env.VJ0_BENCH_BUILD_DIR || '.next','BUILD_ID'),'utf8').trim(),origin,fixture,
    runnerSha:crypto.createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex'),
    probeSha:crypto.createHash('sha256').update(probe).digest('hex'),
    loopbackSha:crypto.createHash('sha256').update(loopback).digest('hex')},null,2));
  for(const [name,width,height] of [['main',1440,900],['stage',1920,1080]]){
    targets[name]=(await call('Target.createTarget',{url:'about:blank'})).targetId;
    sessions[name]=(await call('Target.attachToTarget',{targetId:targets[name],flatten:true})).sessionId;
    await call('Page.enable',{},sessions[name]);
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessions[name]);
    await call('Emulation.setFocusEmulationEnabled',{enabled:true},sessions[name]);
    await call('Page.addScriptToEvaluateOnNewDocument',{source:loopback+'\n'+probe+'\nwindow.vj0AppProbe.installAudioFixture();'},sessions[name]);
    await call('Page.navigate',{url:origin+'/_not-found'},sessions[name]);
    await wait(name,'!!window.vj0AppProbe');
  }
  for(const [width,height] of [[512,288],[768,448],[1024,576]]){
    await call('Page.navigate',{url:origin+'/_not-found'},sessions.main);
    await wait('main','location.pathname === "/_not-found" && !!window.vj0AppProbe');
    const state=structuredClone(fixture);
    Object.assign(state['vj0-ai-settings-storage'].state,{autoConnect:true,sendFrames:true,frameRate:60,outputWidth:width,outputHeight:height,podUrl:origin+'/local-loopback/webrtc/offer'});
    await evaluate('main','(()=>{const f='+JSON.stringify(state)+';for(const[k,v]of Object.entries(f))localStorage.setItem(k,JSON.stringify(v));})()');
    await call('Page.navigate',{url:origin+'/vj/stage'},sessions.stage);
    await wait('stage','!!window.vj0AppProbe && !!document.querySelector("canvas")');
    await call('Page.navigate',{url:origin+'/vj-next'},sessions.main);
    await wait('main','!!window.vj0AppProbe && window.vj0AppProbe.snapshot().channelStates.includes("open")');
    await wait('main','Array.from(document.querySelectorAll("button")).some(b=>/generate/i.test(b.textContent)&&!b.disabled)');
    await evaluate('main','window.vj0AppProbe.setAudio(0.2,110);window.vj0AppProbe.begin();Array.from(document.querySelectorAll("button")).find(b=>/generate/i.test(b.textContent)&&!b.disabled).click()');
    await evaluate('main','window.vj0ResumeLoopbackAudio()');
    await wait('main','window.vj0AppProbe.snapshot().rms.some(r=>r.level===0.2&&r.rms>0.01)');
    await wait('main','window.vj0AppProbe.snapshot().rows.filter(r=>r.kind==="received").length>60');
    await evaluate('stage','window.vj0AppProbe.begin()');
    await evaluate('main','window.vj0AppProbe.begin()');
    await sleep(30000);
    const raw={main:await evaluate('main','window.vj0AppProbe.end()'),stage:await evaluate('stage','window.vj0AppProbe.end()')};
    const start=Math.max(raw.main.started,raw.stage.started),end=Math.min(raw.main.at,raw.stage.at),seconds=(end-start)/1000;
    const summary={width,height,seconds,targets:{}};
    for(const [name,data]of Object.entries(raw)){
      const rows=data.rows.filter(r=>r.at>=start&&r.at<=end),counts={};
      for(const row of rows)counts[row.kind]=(counts[row.kind]||0)+1;
      summary.targets[name]={fps:Object.fromEntries(Object.entries(counts).map(([k,n])=>[k,n/seconds])),errors:data.errors,channelStates:data.channelStates};
      const selected=rows.filter(r=>r.kind===(name==='main'?'received':'webgl-frame-submitted'));
      summary.targets[name].sourceOrderValid=selected.length>20&&selected.every((r,i)=>Number.isInteger(r.id)&&r.id>0&&(!i||r.id>selected[i-1].id));
      summary.targets[name].visible=await evaluate(name,'document.visibilityState === "visible"');
      fs.writeFileSync(path.join(output,`${width}-${name}.json`),JSON.stringify(data));
    }
    summary.audioActive=raw.main.rms.some(r=>r.level===0.2&&r.rms>0.01);
    summary.status=Object.values(summary.targets).every(r=>!r.errors.length&&r.sourceOrderValid&&r.visible)&&summary.audioActive&&raw.main.channelStates.includes('open')?'passed':'failed';
    fs.writeFileSync(path.join(output,`${width}-summary.json`),JSON.stringify(summary,null,2));
    console.log(JSON.stringify(summary));
    if(summary.status!=='passed')throw Error('App loopback acceptance failed');
    await call('Page.navigate',{url:'about:blank'},sessions.main);
    await call('Page.navigate',{url:'about:blank'},sessions.stage);
  }
} finally {
  for(const targetId of Object.values(targets))await call('Target.closeTarget',{targetId}).catch(()=>{});
  socket.close();
}
