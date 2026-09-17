/* Local-only fixture: real browser WebRTC echoes the exact JPEG bytes.
 * No model, GPU, WAN or synthetic worker timings are involved.
 * Install before app startup in a dedicated benchmark browser.
 */
(() => {
  navigator.mediaDevices.enumerateDevices = async () => [
    {deviceId:'vj0-loopback-audio',kind:'audioinput',label:'Benchmark oscillator',groupId:'vj0-loopback'},
  ];
  const audio = [], NativeAudio = window.AudioContext;
  window.AudioContext = new Proxy(NativeAudio,{construct(target,args){const ctx=Reflect.construct(target,args);audio.push(ctx);return ctx;}});
  window.vj0ResumeLoopbackAudio = () => Promise.all(audio.map(ctx=>ctx.resume()));
  const NativePeer = window.RTCPeerConnection;
  const peers = [];
  window.RTCPeerConnection = new Proxy(NativePeer, {construct(target, args) {
    return Reflect.construct(target, [{...args[0], iceServers: []}]);
  }});
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith('/local-loopback/healthz')) {
      return Response.json({inferenceReady:true,workerCount:1,readyCount:1});
    }
    if (!url.endsWith('/local-loopback/webrtc/offer')) return nativeFetch(input, init);
    const peer = new NativePeer({iceServers: []});
    peers.push(peer);
    peer.addEventListener('datachannel', event => {
      const channel = event.channel;
      channel.binaryType = 'arraybuffer';
      channel.addEventListener('message', message => {
        if (typeof message.data !== 'string' && channel.readyState === 'open') channel.send(message.data);
      });
    });
    await peer.setRemoteDescription(JSON.parse(init.body).sdp);
    await peer.setLocalDescription(await peer.createAnswer());
    if (peer.iceGatheringState !== 'complete') await new Promise((resolve,reject) => {
      const timer = setTimeout(() => reject(new Error('Local ICE timeout')), 5000);
      peer.addEventListener('icegatheringstatechange', () => {
        if (peer.iceGatheringState === 'complete') {clearTimeout(timer);resolve();}
      });
    });
    return Response.json({sdp:peer.localDescription});
  };
  addEventListener('pagehide', () => peers.forEach(peer => peer.close()));
})();
