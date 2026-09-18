#!/usr/bin/env python3
"""Reconnect without capture and prove the isolated server is drained after recovery."""
import argparse
import json
from pathlib import Path
import subprocess
import time
import urllib.request

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--target',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
p.add_argument('--server',required=True)
p.add_argument('--origin',default='http://127.0.0.1:18768')
a=p.parse_args()
if a.output.exists():p.error('Use a new output')
target=json.loads(a.target.read_text());cdp=Path(__file__).resolve().parents[1]/'cdp.mjs'
def call(method,params=None):
 r=subprocess.run(['node',str(cdp)],input=json.dumps({**target,'method':method,'params':params or {}}),capture_output=True,text=True,check=True)
 return json.loads(r.stdout)
def evaluate(expression):return call('Runtime.evaluate',{'expression':expression,'awaitPromise':True,'returnByValue':True})['result'].get('value')
def debug():
 request=urllib.request.Request(a.server.rstrip('/')+'/debug',headers={'User-Agent':'Mozilla/5.0 vj0-performance-benchmark'})
 with urllib.request.urlopen(request,timeout=15) as response:return json.load(response)
def wait(expression,timeout):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  if evaluate(expression):return
  time.sleep(.5)
 raise TimeoutError(expression)
record={'status':'running','purpose':'excluded fresh connection, no image capture, then ordered barrier'}
try:
 record['before']=debug()
 if any(w['framePending'] or w.get('compileStartedAt') or not w['ready'] for w in record['before']['workers']):raise RuntimeError('Server not idle before reconnect')
 call('Page.navigate',{'url':a.origin+'/_not-found'})
 wait('location.pathname==="/_not-found" && !!window.vj0AppProbe',15)
 evaluate('(()=>{const k="vj0-ai-settings-storage",j=JSON.parse(localStorage.getItem(k));Object.assign(j.state,{outputWidth:768,outputHeight:448,sendFrames:false,autoConnect:true,podUrl:'+json.dumps(a.server.rstrip('/')+'/webrtc/offer')+'});localStorage.setItem(k,JSON.stringify(j));return true})()')
 call('Page.navigate',{'url':a.origin+'/vj-next'})
 wait('!!window.vj0AppProbe?.snapshot().channelStates.includes("open")',60)
 record['barrier']=evaluate('window.__VJ0_INPUT_BENCH.barrier()')
 record['after']=debug()
 if record['barrier']['ack']['status']!='passed':raise RuntimeError('Barrier failed')
 if record['before']['stats']['framesFromClient']!=record['after']['stats']['framesFromClient']:raise RuntimeError('Unexpected capture during no-capture reconnect')
 record['status']='passed'
except BaseException as error:
 record.update(status='failed',error=str(error));raise
finally:
 try:call('Page.navigate',{'url':'about:blank'});record['local_cleanup']='navigated-to-blank'
 except Exception as error:record['local_cleanup_error']=str(error)
 a.output.write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'status':record['status'],'framesFromClient':record['after']['stats']['framesFromClient']}))
