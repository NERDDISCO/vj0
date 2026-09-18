#!/usr/bin/env python3
"""Local-only 2x2 rAF/JPEG check in explicitly owned browsers; no app or GPU pod."""
import argparse
import json
from pathlib import Path
import subprocess
import urllib.request

EXPRESSION=r'''new Promise(resolve=>{
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=288;
  document.body.append(canvas);const ctx=canvas.getContext('2d');
  let started=0,last=0,pending=false,done=false;const raf=[],encode=[];let sent=0,blocked=0;
  const percentile=(xs,p)=>{const a=xs.slice().sort((x,y)=>x-y);return a.length?a[Math.floor((a.length-1)*p)]:null;};
  function frame(t){
    if(!started)started=t;if(last)raf.push(t-last);last=t;
    if(t-started>=5000){done=true;resolve({userAgent:navigator.userAgent,visibility:document.visibilityState,
      durationMs:t-started,rafFps:raf.length*1000/(t-started),sendFps:sent*1000/(t-started),
      pendingSkips:blocked,rafP50:percentile(raf,.5),rafP95:percentile(raf,.95),
      encodeP50:percentile(encode,.5),encodeP95:percentile(encode,.95),rafMs:raf,encodeMs:encode});return;}
    requestAnimationFrame(frame);
    ctx.fillStyle='#0a0a0a';ctx.fillRect(0,0,512,288);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();
    for(let x=0;x<=512;x+=4){const y=144+Math.sin(x*.03+t*.003)*75;x?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();
    if(pending){blocked++;return;}pending=true;const before=performance.now();
    canvas.toBlob(async blob=>{if(done)return;encode.push(performance.now()-before);
      if(blob){await blob.arrayBuffer();if(!done)sent++;}pending=false;},'image/jpeg',.85);
  }
  requestAnimationFrame(frame);
})'''


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    if a.output.exists():p.error('Use a new result file')
    cdp=Path(__file__).resolve().parents[1]/'cdp.mjs'
    def call(request):
        r=subprocess.run(['node',str(cdp)],input=json.dumps(request),capture_output=True,text=True,check=True)
        return [json.loads(line) for line in r.stdout.splitlines()]
    browsers=[]
    for name,port in [('headed149',18781),('headless149',18779),('headed153',18778),('headless153',18780)]:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version') as r:version=json.load(r)
        browsers.append((name,version['webSocketDebuggerUrl']))
    rows=[]
    for repeat in range(2):
        for name,url in (browsers if repeat==0 else reversed(browsers)):
            target=call({'url':url,'method':'Target.createTarget','params':{'url':'about:blank'}})[0]['targetId']
            try:
                result=call({'url':url,'targetId':target,'commands':[
                    {'method':'Page.enable'},
                    {'method':'Emulation.setDeviceMetricsOverride','params':{'width':1440,'height':900,'deviceScaleFactor':1,'mobile':False}},
                    {'method':'Emulation.setFocusEmulationEnabled','params':{'enabled':True}},
                    {'method':'Runtime.evaluate','params':{'expression':EXPRESSION,'awaitPromise':True,'returnByValue':True}}]})[-1]['result']['value']
                rows.append({'name':name,'repeat':repeat,**result})
                a.output.write_text(json.dumps({'status':'running','rows':rows},indent=2)+'\n')
                print(json.dumps({k:v for k,v in rows[-1].items() if k not in ['rafMs','encodeMs']}),flush=True)
            finally:call({'url':url,'method':'Target.closeTarget','params':{'targetId':target}})
    a.output.write_text(json.dumps({'status':'complete','rows':rows},indent=2)+'\n')


if __name__=='__main__':main()
