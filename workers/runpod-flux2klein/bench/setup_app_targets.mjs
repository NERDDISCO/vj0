// Keep two owned app benchmark targets, probes, focus and viewport attached.
// Usage: node setup_app_targets.mjs browser-websocket-url new-output-directory
// The browser must allow autoplay and expose an audio input device. The probe
// replaces that device's stream with the same synthetic WebAudio fixture.
import fs from 'node:fs';
import path from 'node:path';
const [url, output] = process.argv.slice(2);
if(!url||!output||fs.existsSync(output))throw Error('Browser URL and new output directory required');
fs.mkdirSync(output,{recursive:true});
const socket=new WebSocket(url),pending=new Map();let id=0;
socket.addEventListener('message',event=>{
  const msg=JSON.parse(event.data),p=pending.get(msg.id);
  if(p){pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(Error(JSON.stringify(msg.error))):p.resolve(msg.result);}
});
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
  const key=++id,timer=setTimeout(()=>reject(Error(method+' timeout')),15000);
  pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params,sessionId}));
});
const probe=fs.readFileSync(new URL('./app_probe.js',import.meta.url),'utf8');
const targets=[];
try{
  for(const [name,width,height]of [['main',1440,900],['stage',1920,1080]]){
    const {targetId}=await call('Target.createTarget',{url:'about:blank'});targets.push(targetId);
    const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
    await call('Page.enable',{},sessionId);
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessionId);
    await call('Emulation.setFocusEmulationEnabled',{enabled:true},sessionId);
    await call('Page.addScriptToEvaluateOnNewDocument',{source:probe+'\nwindow.vj0AppProbe.installAudioFixture();'},sessionId);
    fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify({url,targetId},null,2));
  }
  fs.writeFileSync(path.join(output,'ready.json'),JSON.stringify({pid:process.pid,targets,started:new Date().toISOString()}));
  console.log(JSON.stringify({ready:true,output,pid:process.pid}));
  await new Promise(resolve=>{
    const timer=setTimeout(resolve,90*60*1000);
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{clearTimeout(timer);resolve();});
  });
}finally{
  for(const targetId of targets)await call('Target.closeTarget',{targetId}).catch(()=>{});
  socket.close();
}
