// Passive CDP logging during app connection only; no app/server behavior change.
import fs from 'node:fs';
const [targetFile,out]=process.argv.slice(2);if(fs.existsSync(out))throw Error('Output exists');
const target=JSON.parse(fs.readFileSync(targetFile,'utf8'));
const socket=new WebSocket(target.url),pending=new Map(),requests=new Set();let id=0,active=false;
const write=(method,params)=>fs.appendFileSync(out,JSON.stringify({at:new Date().toISOString(),method,params})+'\n');
const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const key=++id;
 pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params,sessionId}));});
socket.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);
 if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}
 if(m.method==='Page.frameNavigated'&&!m.params.frame.parentId){active=m.params.frame.url.endsWith('/vj-next');requests.clear();write(m.method,m.params);}
 if(!active)return;
 if(m.method==='Network.requestWillBeSent'&&m.params.request.url.includes('runpod'))requests.add(m.params.requestId);
 if(m.method?.startsWith('Network.')&&requests.has(m.params?.requestId))write(m.method,m.params);
 if(['Log.entryAdded','Runtime.consoleAPICalled','Runtime.exceptionThrown'].includes(m.method)){
  write(m.method,m.params);
  if(m.method==='Runtime.consoleAPICalled'&&m.params.args.some(a=>String(a.value||'').includes('DataChannel OPEN'))){
   write('benchmark.connectionLoggingPaused',{reason:'DataChannel OPEN; timed capture has not been started'});active=false;requests.clear();
  }
 }
});
await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
const {sessionId}=await call('Target.attachToTarget',{targetId:target.targetId,flatten:true});
for(const method of ['Page.enable','Runtime.enable','Network.enable','Log.enable'])await call(method,{},sessionId);
fs.writeFileSync(out+'.ready',JSON.stringify({pid:process.pid,target:target.targetId}));console.log('ready');
await new Promise(resolve=>{for(const sig of ['SIGINT','SIGTERM'])process.once(sig,resolve);});
await call('Target.detachFromTarget',{sessionId}).catch(()=>{});socket.close();
