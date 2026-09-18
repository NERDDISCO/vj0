/* Install in a dedicated test browser before connecting the real app.
 * The app and renderer remain the code under test. Frame envelopes and metadata
 * are added/removed by this probe; reported render times are submissions, not
 * physical display latency. Reload the page to remove all instrumentation.
 */
(() => {
  if (window.vj0AppProbe) throw new Error('App probe already installed');
  const epoch = () => performance.timeOrigin + performance.now();
  const meta = new WeakMap(), captures = new Map(), urls = new Map(), glFrames = new WeakMap();
  const channels = [], peers = [], audioContexts = [];
  let id = 0, measuring = false, started = 0, ended = 0, audioLevel = 0;
  let rows = [], events = [], errors = [], rms = [], samples = {};
  let rafDiagnostics = {};
  const rafCount = key => { if (measuring) rafDiagnostics[key]=(rafDiagnostics[key]||0)+1; };
  const record = (kind, extra = {}) => {
    if (measuring) rows.push({kind, at:epoch(), ...extra});
  };
  const eventRecord = value => { if (measuring) events.push(value); };
  const errorRecord = value => { if (measuring) errors.push(value); };
  const nativeBlob = window.Blob;
  window.Blob = new Proxy(nativeBlob, {construct(target, args) {
    const blob = Reflect.construct(target, args);
    const inherited = args[0]?.length === 1 && meta.get(args[0][0]);
    if (inherited) meta.set(blob, inherited);
    return blob;
  }});
  const arrayBuffer = nativeBlob.prototype.arrayBuffer;
  nativeBlob.prototype.arrayBuffer = async function() {
    const result = await arrayBuffer.call(this);
    const value = meta.get(this);
    if (value) meta.set(result, value);
    return result;
  };
  const toBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
    const value = {capture:epoch(), audioLevel, inputRms:window.__VJ0_INPUT_BENCH?.latestRms, audioAt:window.__VJ0_INPUT_BENCH?.latestAudioAt, width:this.width, height:this.height};
    record('encode-start');
    return toBlob.call(this, blob => {
      if (blob) meta.set(blob, value);
      record('encode-done', {ms:epoch()-value.capture, bytes:blob?.size ?? 0});
      callback(blob);
    }, ...args);
  };
  const createObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = blob => {
    const url = createObjectURL(blob);
    const value = meta.get(blob);
    if (value) urls.set(url, value);
    return url;
  };
  const revokeObjectURL = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = url => { urls.delete(url); return revokeObjectURL(url); };
  const loadedImages = new WeakMap(), pendingImageRaf = new WeakSet();
  document.addEventListener('load', event => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const url = img.currentSrc || img.src;
    const value = urls.get(url);
    if (!value?.id) return;
    record('preview-image-loaded', {id:value.id, ageMs:epoch()-value.capture,
      width:img.naturalWidth,height:img.naturalHeight});
    loadedImages.set(img, {...value,url});
    if (pendingImageRaf.has(img)) { rafCount('coalesced'); return; }
    pendingImageRaf.add(img);
    rafCount('scheduled');
    requestAnimationFrame(() => {
      rafCount('callbacks');
      pendingImageRaf.delete(img);
      const loaded = loadedImages.get(img);
      if (!img.isConnected) { rafCount('detached'); return; }
      if ((img.currentSrc || img.src) !== loaded.url) { rafCount('replaced'); return; }
      // Revoking an object URL doesn't remove an already loaded DOM image.
      // Keep its load metadata while still rejecting an unloaded replacement.
      if (!urls.has(loaded.url)) rafCount('revokedButStillLoaded');
      record('preview-image-raf', {id:loaded.id, ageMs:epoch()-loaded.capture});
    });
  }, true);
  const bitmap = window.createImageBitmap.bind(window);
  window.createImageBitmap = async (...args) => {
    const began = epoch();
    const value = meta.get(args[0]);
    const result = await bitmap(...args);
    if (value) meta.set(result, value);
    record('bitmap-decoded', {id:value?.id, ms:epoch()-began,width:result.width,height:result.height});
    return result;
  };
  const texImage = WebGL2RenderingContext.prototype.texImage2D;
  WebGL2RenderingContext.prototype.texImage2D = function(...args) {
    const image = args[args.length-1];
    if (image && typeof image === 'object') {
      const value = meta.get(image);
      if (value?.id) glFrames.set(this, {...value, submitted:false});
    }
    return texImage.apply(this,args);
  };
  const drawArrays = WebGL2RenderingContext.prototype.drawArrays;
  WebGL2RenderingContext.prototype.drawArrays = function(...args) {
    const result = drawArrays.apply(this,args);
    const value = glFrames.get(this);
    if (value && !value.submitted && this.getParameter(this.FRAMEBUFFER_BINDING) === null) {
      value.submitted = true;
      record('webgl-frame-submitted', {id:value.id, ageMs:epoch()-value.capture,
        width:this.drawingBufferWidth,height:this.drawingBufferHeight});
    }
    return result;
  };
  const createChannel = RTCPeerConnection.prototype.createDataChannel;
  RTCPeerConnection.prototype.createDataChannel = function(...args) {
    const channel = createChannel.apply(this,args);
    channels.push(channel);peers.push(this);
    this.addEventListener('connectionstatechange', () => eventRecord({at:epoch(),type:'connection',state:this.connectionState}));
    channel.addEventListener('message', event => {
      if (typeof event.data === 'string') {
        try {
          const data=JSON.parse(event.data);
          if (data.type === 'stats') record('worker-stats',{timing:data.timing,worker:data.worker,width:data.width,height:data.height});
          else if (data.type === 'compile' || data.type === 'error') eventRecord({at:epoch(),...data});
        } catch { /* Other diagnostics are not measurements. */ }
        return;
      }
      const raw = event.data;
      if (!(raw instanceof ArrayBuffer) || raw.byteLength < 8 || new DataView(raw).getUint32(0) !== 0x564a3042) {
        errorRecord('Received image without expected benchmark envelope');return;
      }
      const frameId = new DataView(raw).getUint32(4), value=captures.get(frameId);
      const jpeg = raw.slice(8);
      if (value) meta.set(jpeg,value);
      Object.defineProperty(event,'data',{value:jpeg});
      record('received',{id:frameId,bytes:jpeg.byteLength,ageMs:value ? epoch()-value.capture : null});
      if (value && measuring && !samples['output-'+value.audioLevel]) samples['output-'+value.audioLevel]=new nativeBlob([jpeg],{type:'image/jpeg'});
      captures.delete(frameId);
    });
    const send=channel.send.bind(channel);
    channel.send = data => {
      if (typeof data === 'string') {
        try { eventRecord({at:epoch(),type:'settings-sent',data:JSON.parse(data)}); } catch { /* human log */ }
        return send(data);
      }
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
      const inherited=meta.get(data);
      if (!inherited) errorRecord('Sent image has no capture timestamp');
      const value={...(inherited || {capture:epoch(),audioLevel}),id:++id};
      const tagged=new Uint8Array(bytes.byteLength+8), view=new DataView(tagged.buffer);
      view.setUint32(0,0x564a3042);view.setUint32(4,id);tagged.set(bytes,8);
      captures.set(id,value);
      if (captures.size>4096) captures.delete(captures.keys().next().value);
      if (measuring && !samples['input-'+value.audioLevel]) samples['input-'+value.audioLevel]=new nativeBlob([bytes],{type:'image/jpeg'});
      const result=send(tagged.buffer);
      record('sent',{id,captureAt:value.capture,inputRms:value.inputRms,audioAt:value.audioAt,bytes:tagged.byteLength,buffered:channel.bufferedAmount,audioLevel:value.audioLevel});
      return result;
    };
    return channel;
  };
  const post = BroadcastChannel.prototype.postMessage;
  BroadcastChannel.prototype.postMessage = function(message) {
    if (message?.type === 'frame') {
      const value=meta.get(message.bytes);
      record('stage-post',{id:value?.id});
      return post.call(this,{...message,benchmarkMeta:value});
    }
    return post.call(this,message);
  };
  // Install before app startup so metadata belongs to the bytes on its real
  // channel. Do not add a second JPEG recipient merely for instrumentation.
  const BC=window.BroadcastChannel;
  window.BroadcastChannel=new Proxy(BC,{construct(target,args) {
    const ch=Reflect.construct(target,args);
    ch.addEventListener('message',event => {
      if (event.data?.type==='frame' && event.data.benchmarkMeta) {
        meta.set(event.data.bytes,event.data.benchmarkMeta);
        record('stage-message',{id:event.data.benchmarkMeta.id});
      }
    });
    return ch;
  }});
  const analyser=AnalyserNode.prototype.getFloatTimeDomainData;
  let analyserCalls=0;
  AnalyserNode.prototype.getFloatTimeDomainData=function(array) {
    const result=analyser.call(this,array);
    if (measuring && ++analyserCalls%30===0) {
      rms.push({at:epoch(),level:audioLevel,rms:Math.sqrt(array.reduce((s,x)=>s+x*x,0)/array.length)});
    }
    return result;
  };
  addEventListener('error',event=>errorRecord(String(event.message)));
  addEventListener('unhandledrejection',event=>errorRecord(String(event.reason)));
  window.vj0AppProbe={
    begin() {rows=[];events=[];errors=[];rms=[];samples={};rafDiagnostics={};ended=0;started=epoch();measuring=true;return started;},
    snapshot() {return {started,at:ended || epoch(),measuring,rows:rows.slice(),events:events.slice(),errors:errors.slice(),rms:rms.slice(),
      rafDiagnostics:{...rafDiagnostics},previewRafMeaning:'current loaded image observed at an animation-frame callback; not paint/compositor/display presentation',
      channelStates:channels.map(c=>c.readyState),captureAgeMeaning:'canvas encode start to receive/load/GL submission; excludes audio analyser acquisition and physical presentation'};},
    end() {if (measuring) ended=epoch();measuring=false;return this.snapshot();},
    async sampleImages() {
      const out={};for (const [name,blob] of Object.entries(samples)) {
        out[name]=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(blob);});
      }return out;
    },
    async installAudioFixture() {
      navigator.mediaDevices.getUserMedia=async () => {
        const ctx=new AudioContext(), oscillator=ctx.createOscillator(), gain=ctx.createGain(), destination=ctx.createMediaStreamDestination();
        oscillator.type='sine';oscillator.frequency.value=110;gain.gain.value=audioLevel;
        oscillator.connect(gain);gain.connect(destination);oscillator.start();await ctx.resume();
        audioContexts.push({ctx,oscillator,gain});return destination.stream;
      };
    },
    setAudio(level,frequency=110) {audioLevel=level;for(const a of audioContexts){a.gain.gain.setValueAtTime(level,a.ctx.currentTime);a.oscillator.frequency.setValueAtTime(frequency,a.ctx.currentTime);}eventRecord({at:epoch(),type:'audio-fixture',level,frequency});},
    async rtcStats() {return Promise.all(peers.filter(p=>p.connectionState==='connected').map(async p=>Array.from((await p.getStats()).values()).filter(s=>s.type==='candidate-pair'&&s.state==='succeeded')));},
  };
  return {installed:true};
})()

// Appended to the existing source-ID/audio probe in an isolated browser only.
(() => {
  const config=JSON.parse(localStorage.getItem('vj0-input-benchmark')||'{}');
  const thresholdBytes=config.thresholdBytes??262144;
  if(![262144,65536,16384].includes(thresholdBytes))throw Error('Unsupported input threshold');
  const channels=[],acks=new Map();let recording=false,samples=[],checks={},impulses=[],pulseTimers=[],audioRms=[];
  let latestRms=null,latestAudioAt=null;
  const epoch=()=>performance.timeOrigin+performance.now();
  const channelState=()=>channels.map(c=>({readyState:c.readyState,bufferedAmount:c.bufferedAmount,
    ordered:c.ordered,maxRetransmits:c.maxRetransmits,maxPacketLifeTime:c.maxPacketLifeTime}));
  const previousCreate=RTCPeerConnection.prototype.createDataChannel;
  RTCPeerConnection.prototype.createDataChannel=function(...args){
    const ch=previousCreate.apply(this,args);channels.push(ch);
    ch.addEventListener('message',event=>{
      if(typeof event.data!=='string')return;
      try{const m=JSON.parse(event.data);if(m.type==='vj0-input-barrier-ack'&&acks.has(m.nonce)){
        const callback=acks.get(m.nonce);acks.delete(m.nonce);callback(m);
      }}catch{}
    });
    return ch;
  };
  const previousAnalyser=AnalyserNode.prototype.getFloatTimeDomainData;
  AnalyserNode.prototype.getFloatTimeDomainData=function(array){
    const result=previousAnalyser.call(this,array);
    let sum=0;for(let i=0;i<array.length;i++)sum+=array[i]*array[i];
    latestRms=Math.sqrt(sum/array.length);latestAudioAt=epoch();
    if(recording)audioRms.push({at:latestAudioAt,rms:latestRms});
    return result;
  };
  function stopImpulses(){for(const timer of pulseTimers)clearTimeout(timer);pulseTimers=[];}
  const api={thresholdBytes,get latestRms(){return latestRms;},get latestAudioAt(){return latestAudioAt;},
    canSend(transport,phase){
      const buffered=transport.getBufferedAmount(),allowed=transport.canSend(thresholdBytes);
      if(recording){const c=checks[phase]??={calls:0,rejected:0,maxBufferedBytes:0};c.calls++;
        if(!allowed)c.rejected++;c.maxBufferedBytes=Math.max(c.maxBufferedBytes,buffered);}
      return allowed;
    },
    begin(){stopImpulses();samples=[];checks={};impulses=[];audioRms=[];recording=true;},
    end(){recording=false;stopImpulses();return api.snapshot();},
    snapshot(){return {thresholdBytes,channels:channelState(),checks:structuredClone(checks),
      samples:samples.slice(),impulses:impulses.slice(),audioRms:audioRms.slice()};},
    startImpulses(seconds){
      const start=epoch();
      for(let i=0;2500+i*3000+100<seconds*1000;i++){
        const delay=2500+i*3000,duration=i%2?100:40;
        pulseTimers.push(setTimeout(()=>{const onAt=epoch();
          window.vj0AppProbe.setAudio(0.65,220);
          impulses.push({index:i,kind:'on',plannedAt:start+delay,at:onAt,durationMs:duration,level:0.65});
          pulseTimers.push(setTimeout(()=>{window.vj0AppProbe.setAudio(0.2,110);
            impulses.push({index:i,kind:'off',at:epoch(),level:0.2});},duration));
        },delay));
      }
    },
    barrier(){
      const live=channels.filter(c=>c.readyState==='open');
      if(live.length!==1)throw Error('Barrier requires exactly one open channel');
      const ch=live[0];
      if(!ch.ordered||ch.maxRetransmits!==null||ch.maxPacketLifeTime!==null)
        throw Error('Barrier requires the unchanged reliable ordered channel');
      const nonce='input-'+Date.now()+'-'+Math.random().toString(36).slice(2);
      const before={at:epoch(),channels:channelState()};
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{acks.delete(nonce);reject(Error('Ordered input barrier timed out'));},35000);
        acks.set(nonce,ack=>{clearTimeout(timer);if(ack.status!=='passed')reject(Error(JSON.stringify(ack)));
          else resolve({before,ack,receivedAt:epoch(),after:channelState()});});
        ch.send(JSON.stringify({type:'vj0-input-barrier',nonce}));
      });
    }
  };
  Object.defineProperty(window,'__VJ0_INPUT_BENCH',{value:api,writable:false});
  setInterval(()=>{if(recording)samples.push({at:epoch(),channels:channelState()});},100);
})();
