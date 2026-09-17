/* Isolated real-browser reproduction of the app's capture scheduler.
 * Load through agent-browser eval --stdin. runCaptureDiagnostics starts a
 * sequential matrix; poll captureDiagnosticResults. No GPU or app transport.
 * The only A/B difference is cadence/admission timing; JPEG stays at 0.85.
 */
(() => {
  const {isCaptureFrameDue,advanceCaptureFrameDeadline}=window.vj0CaptureCadence;
  const percentile = (values, p) => values.length ? [...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))] : null;
  const distribution = values => ({n:values.length,p50:percentile(values,.5),p95:percentile(values,.95),p99:percentile(values,.99),max:values.length?Math.max(...values):null});
  const source = document.createElement('canvas');
  source.width=1280;source.height=720;document.body.append(source);
  const sourceCtx=source.getContext('2d');
  window.captureDiagnosticResults={done:false,rows:[],userAgent:navigator.userAgent,dpr:devicePixelRatio};
  const trial = ({variant,width,height,seconds=10,fps=60}) => new Promise(resolve => {
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');
    const rows=[],counts={raf:0,cadence:0,pending:0,encoded:0,sent:0};
    let last=0,next=0,pending=false,started=0,previousRaf=0,stopped=false;
    const frame = rafTime => {
      if(!started)started=rafTime;
      if(rafTime-started>=seconds*1000){
        stopped=true;
        const durationMs=rafTime-started;
        resolve({variant,width,height,fps,durationMs,counts,sendFps:counts.sent/(durationMs/1000),
          rafDt:distribution(rows.filter(r=>r.kind==='raf').map(r=>r.dt)),
          copyMs:distribution(rows.filter(r=>r.kind==='copy').map(r=>r.ms)),
          encodeMs:distribution(rows.filter(r=>r.kind==='encode').map(r=>r.ms)),
          arrayBufferMs:distribution(rows.filter(r=>r.kind==='send').map(r=>r.arrayBufferMs)),rows});return;
      }
      requestAnimationFrame(frame);counts.raf++;
      if(previousRaf)rows.push({kind:'raf',at:rafTime,dt:rafTime-previousRaf});previousRaf=rafTime;
      sourceCtx.fillStyle='#000';sourceCtx.fillRect(0,0,1280,720);
      sourceCtx.strokeStyle='#fff';sourceCtx.lineWidth=3;sourceCtx.beginPath();
      for(let x=0;x<=1280;x+=4){const y=360+Math.sin(x*.025+rafTime*.004)*120; if(x===0)sourceCtx.moveTo(x,y);else sourceCtx.lineTo(x,y);}
      sourceCtx.stroke();
      const now=performance.now(),interval=1000/fps;
      if(variant==='current'){
        if(now-last<interval){counts.cadence++;return;}
        last=now;
        if(pending){counts.pending++;return;}
      }else{
        if(!isCaptureFrameDue(rafTime,next)){counts.cadence++;return;}
        if(pending){counts.pending++;return;}
        next=advanceCaptureFrameDeadline(rafTime,next,fps);
      }
      const copied=performance.now();ctx.drawImage(source,0,0,width,height);
      rows.push({kind:'copy',at:copied,ms:performance.now()-copied});
      pending=true;const encodeStarted=performance.now();
      canvas.toBlob(async blob=>{
        const encoded=performance.now();
        if(stopped){pending=false;return;}
        counts.encoded++;rows.push({kind:'encode',at:encoded,ms:encoded-encodeStarted,bytes:blob?.size||0});
        if(blob){const bytes=await blob.arrayBuffer();if(!stopped){counts.sent++;rows.push({kind:'send',at:performance.now(),arrayBufferMs:performance.now()-encoded,bytes:bytes.byteLength});}}
        pending=false;
      },'image/jpeg',.85);
    };
    requestAnimationFrame(frame);
  });
  window.runCaptureDiagnostics=async (seconds=10,repeats=2,fps=60)=>{
    for(let repeat=0;repeat<repeats;repeat++)for(const [width,height] of [[512,288],[768,448],[1024,576]])
      for(const variant of (repeat%2 ? ['phase','current'] : ['current','phase'])){
        const result=await trial({variant,width,height,seconds,fps});result.repeat=repeat;
        window.captureDiagnosticResults.rows.push(result);
      }
    window.captureDiagnosticResults.done=true;
  };
  return 'capture diagnostic loaded';
})();
