// Fake WebRTC for the vj0 app: the "pod" answers every binary frame with a
// static JPEG. Inject before pressing connect. Frame served from the local
// helper server so no app code is touched.
(async () => {
  const frameBuf = await (await fetch("http://127.0.0.1:8123/mock-frame.jpg")).arrayBuffer();
  class FakeChannel {
    constructor() { this.readyState = "connecting"; this.bufferedAmount = 0; this.binaryType = "arraybuffer";
      this.onopen = null; this.onclose = null; this.onmessage = null; this.onerror = null; }
    send(data) {
      if (typeof data === "string") return; // settings — ignore
      // Reply async like a real round trip: stats text, then the JPEG.
      setTimeout(() => {
        if (this.readyState !== "open" || !this.onmessage) return;
        this.onmessage({ data: JSON.stringify({ type: "stats", gen_time_ms: 40, width: 512, height: 288, worker: 0 }) });
        this.onmessage({ data: frameBuf.slice(0) });
      }, 30);
    }
    close() { this.readyState = "closed"; this.onclose && this.onclose({}); }
  }
  class FakePC extends EventTarget {
    constructor() { super(); this.connectionState = "new"; this.iceConnectionState = "new"; this.iceGatheringState = "complete";
      this.localDescription = null; this.onconnectionstatechange = null; this.oniceconnectionstatechange = null; this._ch = null; }
    createDataChannel() { this._ch = new FakeChannel(); return this._ch; }
    async createOffer() { return { type: "offer", sdp: "v=0 fake" }; }
    async setLocalDescription(d) { this.localDescription = d; }
    async setRemoteDescription() {
      this.connectionState = "connected"; this.iceConnectionState = "connected";
      this.onconnectionstatechange && this.onconnectionstatechange({});
      const ch = this._ch; setTimeout(() => { ch.readyState = "open"; ch.onopen && ch.onopen({}); this.onconnectionstatechange && this.onconnectionstatechange({}); }, 10);
    }
    getStats() { return Promise.resolve(new Map()); }
    close() { this.connectionState = "closed"; this._ch && this._ch.close(); }
  }
  window.RTCPeerConnection = FakePC;
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, init) => {
    const u = String(url);
    if (u.includes("/webrtc/offer")) return Promise.resolve(new Response(JSON.stringify({ sdp: { type: "answer", sdp: "v=0 fake" } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    if (u.includes("/healthz")) return Promise.resolve(new Response(JSON.stringify({ ok: true, workerCount: 1, readyCount: 1, inferenceReady: true, workers: [{ gpu: 0, ready: true, framePending: 0 }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    if (u.includes("/telemetry")) return Promise.resolve(new Response("{}", { status: 404 }));
    return realFetch(url, init);
  };
  window.__MOCK_RTC = true;
})();
