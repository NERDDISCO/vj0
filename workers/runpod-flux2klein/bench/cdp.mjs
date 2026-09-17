/* Small CDP client for installing benchmark probes before the real app starts.
 * Input JSON on stdin: {url: browserWebSocketUrl, targetId?, method, params?}.
 * Does not launch or discover unrelated browsers.
 */
import fs from 'node:fs';
const request=JSON.parse(fs.readFileSync(0,'utf8'));
const socket=new WebSocket(request.url);
const pending=new Map();let next=0,sessionId;
const timer=setTimeout(()=>{console.error('CDP request timed out');process.exit(1);},30000);
socket.addEventListener('message',event=>{
  const message=JSON.parse(event.data);
  if(message.id&&pending.has(message.id)){
    const {resolve,reject}=pending.get(message.id);pending.delete(message.id);
    if(message.error)reject(new Error(JSON.stringify(message.error)));else resolve(message.result);
  }
});
const send=(method,params={},session)=>new Promise((resolve,reject)=>{
  const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,sessionId:session}));
});
try{
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  if(request.targetId)sessionId=(await send('Target.attachToTarget',{targetId:request.targetId,flatten:true})).sessionId;
  const result=await send(request.method,request.params||{},sessionId);
  if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
  console.log(JSON.stringify(result));
}finally{
  if(sessionId)await send('Target.detachFromTarget',{sessionId}).catch(()=>{});
  clearTimeout(timer);socket.close();
}
