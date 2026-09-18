// One excluded app connection; record browser network/console evidence, no Generate.
import fs from 'node:fs';
const [targetFile,out]=process.argv.slice(2);if(fs.existsSync(out))throw Error('Output exists');
const target=JSON.parse(fs.readFileSync(targetFile,'utf8'));
const socket=new WebSocket(target.url),pending=new Map(),rows=[],requests=new Set();let id=0;
const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
 const key=++id,timer=setTimeout(()=>reject(Error(method+' timeout')),20000);
 pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params,sessionId}));
});
socket.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);
 if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}
 if(m.method==='Network.requestWillBeSent'&&m.params.request.url.includes('runpod'))requests.add(m.params.requestId);
 if(m.method?.startsWith('Network.')&&requests.has(m.params?.requestId))rows.push({at:new Date().toISOString(),method:m.method,params:m.params});
 if(['Log.entryAdded','Runtime.consoleAPICalled','Runtime.exceptionThrown'].includes(m.method))rows.push({at:new Date().toISOString(),method:m.method,params:m.params});
});
await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
const {sessionId}=await call('Target.attachToTarget',{targetId:target.targetId,flatten:true});
try{
 for(const method of ['Page.enable','Runtime.enable','Network.enable','Log.enable'])await call(method,{},sessionId);
 await call('Page.navigate',{url:'http://127.0.0.1:18768/vj-next'},sessionId);
 await new Promise(resolve=>setTimeout(resolve,22000));
 const snapshot=await call('Runtime.evaluate',{expression:'({href:location.href,text:document.body.innerText,probe:window.vj0AppProbe?.snapshot()})',returnByValue:true},sessionId);
 fs.writeFileSync(out,JSON.stringify({kind:'excluded-one-connection-diagnostic',snapshot,rows},null,2)+'\n');
 console.log(JSON.stringify(rows.filter(r=>r.method==='Network.loadingFailed'||r.method==='Log.entryAdded'||r.method==='Runtime.exceptionThrown')));
}finally{
 await call('Page.navigate',{url:'about:blank'},sessionId).catch(()=>{});socket.close();
}
