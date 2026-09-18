// Dedicated persistent CDP targets. Only the two fixed admission call sites in
// each built app chunk are rewritten; original/delivered bytes are archived.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [url,output,probeFile,chunksDirectory]=process.argv.slice(2);
if(!url||!output||!probeFile||!chunksDirectory||fs.existsSync(output))throw Error('Need URL, new output, probe, chunks');
fs.mkdirSync(output,{recursive:true});
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const patchMap=new Map(),patchManifest=[];
for(const file of fs.readdirSync(chunksDirectory).filter(f=>f.endsWith('.js'))){
  const original=fs.readFileSync(path.join(chunksDirectory,file),'utf8');
  if(!original.includes('.canSend(262144)'))continue;
  let count=0;
  const delivered=original.replace(/([A-Za-z_$][\w$]*)\.canSend\(262144\)/g,(_,receiver)=>
    `window.__VJ0_INPUT_BENCH.canSend(${receiver},'${++count===1?'before-encode':'before-send'}')`);
  if(count!==2)throw Error('Expected two admission sites in '+file+', got '+count);
  patchMap.set('/_next/static/chunks/'+file,{original,delivered});
  fs.writeFileSync(path.join(output,file+'.original'),original);
  fs.writeFileSync(path.join(output,file+'.delivered'),delivered);
  patchManifest.push({file,count,originalSha256:sha(original),deliveredSha256:sha(delivered)});
}
if(patchMap.size!==2)throw Error('Expected exactly the legacy and next admission chunks');
fs.writeFileSync(path.join(output,'chunk-patches.json'),JSON.stringify(patchManifest,null,2));
const socket=new WebSocket(url),pending=new Map();let id=0;const targets=[];
const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
  const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error(method+' timeout'));},20000);
  pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params,sessionId}));
});
async function intercepted(event){
  const {requestId,request,responseStatusCode,responseHeaders}=event.params;
  const file=new URL(request.url).pathname,patch=patchMap.get(file);
  if(!patch)return call('Fetch.continueRequest',{requestId},event.sessionId);
  if(responseStatusCode!==200)throw Error('Unexpected chunk status '+responseStatusCode+' '+file);
  const body=await call('Fetch.getResponseBody',{requestId},event.sessionId);
  const decoded=body.base64Encoded?Buffer.from(body.body,'base64').toString('utf8'):body.body;
  if(decoded!==patch.original)throw Error('Served chunk differs from pinned build '+file);
  const headers=responseHeaders.filter(h=>!['content-encoding','content-length','etag'].includes(h.name.toLowerCase()));
  headers.push({name:'Cache-Control',value:'no-store'});
  await call('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:headers,
    body:Buffer.from(patch.delivered).toString('base64')},event.sessionId);
  fs.appendFileSync(path.join(output,'interceptions.jsonl'),JSON.stringify({at:new Date().toISOString(),file,sessionId:event.sessionId})+'\n');
}
socket.addEventListener('message',event=>{
  const msg=JSON.parse(event.data),p=pending.get(msg.id);
  if(p){pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(Error(JSON.stringify(msg.error))):p.resolve(msg.result);}
  if(msg.method==='Fetch.requestPaused')intercepted(msg).catch(error=>{
    fs.appendFileSync(path.join(output,'errors.jsonl'),JSON.stringify({at:new Date().toISOString(),error:String(error)})+'\n');
    call('Fetch.failRequest',{requestId:msg.params.requestId,errorReason:'Failed'},msg.sessionId).catch(()=>{});
  });
});
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
const probe=fs.readFileSync(probeFile,'utf8');
try{
  for(const [name,width,height]of [['main',1440,900],['stage',1920,1080]]){
    const {targetId}=await call('Target.createTarget',{url:'about:blank'});targets.push(targetId);
    const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
    await call('Page.enable',{},sessionId);await call('Network.enable',{},sessionId);
    await call('Network.setCacheDisabled',{cacheDisabled:true},sessionId);
    await call('Fetch.enable',{patterns:[{urlPattern:'*/_next/static/chunks/*.js',requestStage:'Response'}]},sessionId);
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessionId);
    await call('Emulation.setFocusEmulationEnabled',{enabled:true},sessionId);
    await call('Page.addScriptToEvaluateOnNewDocument',{source:probe+'\nwindow.vj0AppProbe.installAudioFixture();'},sessionId);
    fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify({url,targetId},null,2));
  }
  fs.writeFileSync(path.join(output,'ready.json'),JSON.stringify({pid:process.pid,targets,started:new Date().toISOString()}));
  console.log(JSON.stringify({ready:true,output,pid:process.pid}));
  await new Promise(resolve=>{for(const signal of ['SIGINT','SIGTERM'])process.once(signal,resolve);});
}finally{
  for(const targetId of targets)await call('Target.closeTarget',{targetId}).catch(()=>{});
  socket.close();
}
