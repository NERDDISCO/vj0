"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioEngine } from "@/src/lib/audio-engine";
import type { AudioFeatures } from "@/src/lib/audio-features";
import { WebRtcAiTransport } from "@/src/lib/ai/webrtc-transport";
import type {
  AiTransportStatus,
  AiIncomingFrame,
} from "@/src/lib/ai/transport";
import {
  AI_BACKEND_URLS,
  useAiSettingsStore,
  type AiBackend,
} from "@/src/lib/stores/ai-settings-store";
import { useSceneStore } from "@/src/lib/composer";
import {
  openStageChannel,
  type StageMsg,
} from "@/src/lib/ai/stage-channel";
import { SystemBar } from "./components/SystemBar";
import { SceneTabs } from "./components/SceneTabs";
import { AudioMeters } from "./components/AudioMeters";
import { SceneCanvas } from "./components/SceneCanvas";
import { OutputStage } from "./components/OutputStage";
import { OutputOptions } from "./components/OutputOptions";
import { ElementInspector } from "./components/ElementInspector";
import { Drawer } from "./components/Drawer";
import { CommandPalette } from "./components/CommandPalette";
import type { AiCompileState, BootPhase } from "./components/CompileOverlay";
import { SYSTEM_AUDIO_VALUE } from "./components/AudioPopover";
import { PerformanceDeck } from "./components/PerformanceDeck";
import { useRecording } from "./hooks/useRecording";

/**
 * VJNextApp — orchestrator for /vj-next.
 *
 * Pares the original 1.8k-line VJApp down to the bones the new design
 * needs: an AudioEngine for live features, the workspace layout, and a
 * minimal AI-output stub (the scene's prompt, output resolution, alpha,
 * steps, seed). The actual WebRTC AI transport is deliberately not wired
 * here — this route is a design demo and a working composition tool. When
 * the team is happy with the design, the existing AiTransport drops into
 * this orchestrator behind the same OutputStage + OutputOptions props.
 */
export function VJNextApp() {
  // ─── Audio ────────────────────────────────────────────────────────
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const audioFeaturesRef = useRef<AudioFeatures | null>(null);
  // Live PCM time-domain buffer — read by the waveform element. The
  // engine fills this in-place each frame; we hold one shared
  // Float32Array across the session to avoid re-allocating at audio rate.
  const timeDomainRef = useRef<Float32Array | null>(null);
  // Audio source picker — "device" (mic from enumerateDevices) vs
  // "system" (getDisplayMedia capture of a tab/screen, audio only).
  const [audioSource, setAudioSource] = useState<"device" | "system">("device");
  const [audioErrorMessage, setAudioErrorMessage] = useState<string | null>(null);
  const [systemAudioSupported, setSystemAudioSupported] = useState(false);
  useEffect(() => {
    setSystemAudioSupported(
      typeof navigator !== "undefined" &&
        typeof navigator.mediaDevices?.getDisplayMedia === "function",
    );
  }, []);
  const [audioStatus, setAudioStatus] = useState<
    "idle" | "starting" | "running" | "error"
  >("idle");
  const [audioDevices, setAudioDevices] = useState<
    Array<{ deviceId: string; label: string }>
  >([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [audioDeviceLabel, setAudioDeviceLabel] = useState("default");
  const [startedAt] = useState(() => performance.now());

  // Pull features + time-domain into refs each frame so the canvas +
  // meters + waveform element can read them without React updates.
  useEffect(() => {
    let raf = 0;
    function pump() {
      const eng = audioEngineRef.current;
      if (eng) {
        audioFeaturesRef.current = eng.getLatestFeatures();
        // The engine exposes a getTimeDomainData(buf) shim that fills the
        // buffer in place. Allocate once on first call (size = analyser
        // FFT size / 2 = 1024 samples in the existing engine).
        if (!timeDomainRef.current) {
          timeDomainRef.current = new Float32Array(1024);
        }
        try {
          eng.getTimeDomainData(timeDomainRef.current);
        } catch {
          // Engine may not be fully initialized yet — silently skip.
        }
      }
      raf = requestAnimationFrame(pump);
    }
    raf = requestAnimationFrame(pump);
    return () => cancelAnimationFrame(raf);
  }, []);

  const initAudio = useCallback(
    async (source?: string | MediaStream) => {
      setAudioStatus("starting");
      setAudioErrorMessage(null);
      try {
        // Tear down any existing engine so we can swap mic devices /
        // toggle between mic and system-audio capture.
        audioEngineRef.current?.destroy();
        const eng = new AudioEngine();
        await eng.init(source);
        audioEngineRef.current = eng;
        setAudioStatus("running");
      } catch (e) {
        console.error("Audio init failed", e);
        setAudioStatus("error");
        setAudioErrorMessage(
          e instanceof Error ? e.message : "audio init failed",
        );
      }
    },
    [],
  );

  // System audio capture via getDisplayMedia. Browser shows its
  // share-picker → user selects a tab/window/screen → we drop the
  // video track (asked for it because Chrome requires it; we don't
  // need it) and feed the audio track into the engine. When the user
  // clicks "Stop sharing" the track ends and we auto-fall-back to the
  // last selected mic device.
  const initSystemAudio = useCallback(async () => {
    try {
      const constraints = {
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          suppressLocalAudioPlayback: false,
        },
        systemAudio: "include",
        windowAudio: "system",
      } as DisplayMediaStreamOptions;
      const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      // Drop the video tracks Chrome forced on us.
      for (const t of stream.getVideoTracks()) {
        stream.removeTrack(t);
        t.stop();
      }
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        stream.getTracks().forEach((t) => t.stop());
        setAudioStatus("error");
        setAudioErrorMessage(
          "No audio in the shared source — re-share and tick the audio box (only available for tabs and full screen).",
        );
        return;
      }
      // Auto-fall-back to last device when user clicks "Stop sharing".
      audioTracks[0].addEventListener("ended", () => {
        const fallback = audioDevicesRef.current[0]?.deviceId ?? "";
        setSelectedDeviceId(fallback);
        setAudioSource("device");
        void initAudio(fallback || undefined);
      });
      setSelectedDeviceId(SYSTEM_AUDIO_VALUE);
      setAudioSource("system");
      await initAudio(stream);
    } catch (err) {
      // NotAllowedError = user dismissed the picker. Quietly revert.
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setSelectedDeviceId(audioDevicesRef.current[0]?.deviceId ?? "");
        return;
      }
      setAudioStatus("error");
      setAudioErrorMessage(
        err instanceof Error ? err.message : "system audio unavailable",
      );
    }
  }, [initAudio]);

  // Keep a ref of the latest devices list so the system-audio
  // "ended" handler can fall back without re-creating the callback.
  const audioDevicesRef = useRef<Array<{ deviceId: string; label: string }>>([]);

  const fetchDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all.filter((d) => d.kind === "audioinput");
      const mapped = inputs.map((d) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${d.deviceId.slice(0, 6)}`,
      }));
      setAudioDevices(mapped);
      audioDevicesRef.current = mapped;
      if (!selectedDeviceId && inputs.length > 0) {
        setSelectedDeviceId(inputs[0].deviceId);
        setAudioDeviceLabel(inputs[0].label || "default");
      }
    } catch (e) {
      console.warn("enumerateDevices failed", e);
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    void initAudio();
    void fetchDevices();
    return () => {
      audioEngineRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDeviceChange = useCallback(
    (id: string) => {
      // Sentinel "system audio" → kick the OS share-picker. Don't
      // persist it (getDisplayMedia must be re-triggered each session).
      if (id === SYSTEM_AUDIO_VALUE) {
        setSelectedDeviceId(SYSTEM_AUDIO_VALUE);
        setAudioDeviceLabel("🖥 System audio");
        void initSystemAudio();
        return;
      }
      setAudioSource("device");
      setSelectedDeviceId(id);
      const dev = audioDevices.find((d) => d.deviceId === id);
      if (dev) setAudioDeviceLabel(dev.label);
      void initAudio(id || undefined);
    },
    [audioDevices, initAudio, initSystemAudio],
  );

  // ─── AI transport (WebRTC) ────────────────────────────────────────
  // Same transport the legacy /vj uses — wired in directly so connect /
  // disconnect / generate / received-frame all work end to end.
  //
  // Backend resolution mirrors legacy /vj: built-in backends use
  // AI_BACKEND_URLS, the dynamic "pod" backend uses the URL the user
  // picked from the live pod list. Falls back to /api/webrtc/offer if
  // neither resolves so dev still has something to point at.
  const aiBackend = useAiSettingsStore((s) => s.backend);
  const setAiBackend = useAiSettingsStore((s) => s.setBackend);
  const aiPodUrl = useAiSettingsStore((s) => s.podUrl);
  const setAiPodUrl = useAiSettingsStore((s) => s.setPodUrl);
  // Auto-connect setting — persisted in the same store as backend +
  // podUrl so a user who flipped this on in legacy /vj keeps the same
  // behaviour here (and vice versa). Triggered below in a useEffect
  // that watches autoConnect + the transport identity.
  const aiAutoConnect = useAiSettingsStore((s) => s.autoConnect);
  const setAiAutoConnect = useAiSettingsStore((s) => s.setAutoConnect);
  const aiSignalingUrl = useMemo(() => {
    if (aiBackend === "pod" && aiPodUrl) return aiPodUrl;
    return AI_BACKEND_URLS[aiBackend] || "/api/webrtc/offer";
  }, [aiBackend, aiPodUrl]);
  // Same-origin /healthz sibling of the signaling URL — used to poll
  // worker readiness while connected so the UI can say "preparing
  // workers 2/4" instead of staring at an empty preview.
  const aiHealthUrl = useMemo(() => {
    try {
      const u = new URL(aiSignalingUrl, window.location.href);
      u.pathname = "/healthz";
      u.search = "";
      return u.toString();
    } catch {
      return null;
    }
  }, [aiSignalingUrl]);
  // Same-origin /telemetry sibling — the AI popover polls this when
  // open + connected to render pod hardware stats (GPU, CPU, RAM, disk).
  const aiTelemetryUrl = useMemo(() => {
    try {
      const u = new URL(aiSignalingUrl, window.location.href);
      u.pathname = "/telemetry";
      u.search = "";
      return u.toString();
    } catch {
      return null;
    }
  }, [aiSignalingUrl]);
  const aiTransport = useMemo(
    () =>
      new WebRtcAiTransport({
        signalingUrl: aiSignalingUrl,
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      }),
    [aiSignalingUrl],
  );
  const [aiStatus, setAiStatus] = useState<AiTransportStatus>("disconnected");
  const [aiImageUrl, setAiImageUrl] = useState<string | null>(null);
  const [aiFps, setAiFps] = useState(0);
  // Latency = time between sending a frame and receiving one back.
  // Approximated as `last-receive - last-send`. Pending = how many
  // outgoing frames we've buffered minus how many we've received.
  const [aiLatencyMs, setAiLatencyMs] = useState<number | null>(null);
  const [aiPending, setAiPending] = useState<number>(0);
  // Worker-readiness from /healthz — "preparing workers 2/4 ready" UX.
  const [aiServer, setAiServer] = useState<{
    workerCount: number;
    readyCount: number;
  } | null>(null);
  // Boot/compile phase from server text-frame events. Drives CompileOverlay.
  const [aiCompile, setAiCompile] = useState<AiCompileState | null>(null);
  // Per-frame stats from the server's "stats" message — used for the
  // popover's latency readout (much more accurate than wall-clock send/recv).
  const [aiServerLatency, setAiServerLatency] = useState<number | null>(null);
  // Server-emitted text frames that aren't structured (compile/phase/stats)
  // get appended here as a rolling 20-line log. Surfaced at the bottom of
  // the AiPopover diagnostics section so the user can debug a stuck pod
  // without opening devtools.
  const [aiLogs, setAiLogs] = useState<string[]>([]);
  const lastFrameTimeRef = useRef<number>(0);
  const lastSendTimeRef = useRef<number>(0);
  const sentCountRef = useRef<number>(0);
  const recvCountRef = useRef<number>(0);
  const frameTimingsRef = useRef<number[]>([]);

  // Forwarded from SceneCanvas — the actual <canvas> element the send
  // loop reads pixels from. Stored as a ref (not state) so changing it
  // doesn't trigger re-renders during the rAF send loop.
  const inputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleInputCanvas = useCallback((el: HTMLCanvasElement | null) => {
    inputCanvasRef.current = el;
  }, []);

  // ─── Stage / projector channel ────────────────────────────────────
  // BroadcastChannel published to the /vj/stage tab — same channel name
  // legacy /vj uses, so opening /vj/stage in a separate window receives
  // frames + prompt + connection messages from this control tab.
  const stageChannelRef = useRef<BroadcastChannel | null>(null);
  const stageFrameSeqRef = useRef(0);
  useEffect(() => {
    const ch = openStageChannel();
    stageChannelRef.current = ch;
    if (!ch) return;
    const onMsg = (ev: MessageEvent<StageMsg>) => {
      // Re-publish a fresh prompt if the stage just woke up — without
      // this, opening the stage tab mid-set leaves it without context
      // until the user changes the prompt.
      if (ev.data?.type === "hello") {
        const prompt = activePromptRef.current;
        if (prompt) ch.postMessage({ type: "prompt", prompt });
      }
    };
    ch.onmessage = onMsg;
    return () => {
      ch.onmessage = null;
      ch.close();
      stageChannelRef.current = null;
    };
  }, []);

  // ─── Recording ────────────────────────────────────────────────────
  // For now we record the input scene canvas — always has content even
  // when AI isn't connected. When the WebGL StageRenderer for the AI
  // preview lands (Batch 5), getSourceCanvas can switch to the AI
  // canvas while connected so the recording captures the actual stage
  // output rather than the source.
  const recording = useRecording({
    getSourceCanvas: () => inputCanvasRef.current,
    audioEngineRef,
  });

  useEffect(() => {
    let forwardingActive = true;
    let publishedStageSeq = 0;
    const onStatus = (s: AiTransportStatus) => {
      setAiStatus(s);
      // Telegraph status to the stage tab so it can show "waiting" /
      // "connected" / "error" in its idle banner without having to poll.
      stageChannelRef.current?.postMessage({ type: "connection", status: s });
      // Reset stats on any non-connected state so the popover doesn't
      // show stale FPS / pending counts after a disconnect. Also clear
      // server boot/compile state so we don't show "preparing workers"
      // forever after a disconnect.
      if (s !== "connected") {
        setAiFps(0);
        setAiLatencyMs(null);
        setAiPending(0);
        setAiServer(null);
        setAiCompile(null);
        setAiServerLatency(null);
        lastFrameTimeRef.current = 0;
        lastSendTimeRef.current = 0;
        sentCountRef.current = 0;
        recvCountRef.current = 0;
        frameTimingsRef.current = [];
      }
    };
    const onFrame = (frame: AiIncomingFrame) => {
      // ─── Text frames: server status / compile progress / per-frame
      // timing. These are the events the user used to see in the legacy
      // /vj's CompileOverlay + chip readouts. Without them, "connected"
      // looks identical to "frozen".
      if (frame.kind === "text") {
        try {
          const data = JSON.parse(frame.message) as Record<string, unknown>;
          // Per-frame timing report from the worker.
          if (data.type === "stats" && typeof data.gen_time_ms === "number") {
            setAiServerLatency(data.gen_time_ms);
            return;
          }
          // Pre-warmup phases: weights, fp8 quant, compile-stub registration.
          if (data.type === "phase") {
            const stage = data.stage as string | undefined;
            const PHASE_MAP: Record<string, BootPhase> = {
              loading_weights: "loading_weights",
              applying_fp8: "applying_fp8",
              registering_compile_stubs: "registering_compile_stubs",
            };
            if (stage && PHASE_MAP[stage]) {
              setAiCompile({
                phase: PHASE_MAP[stage],
                est_seconds:
                  typeof data.est_seconds === "number" ? data.est_seconds : 30,
                started_at: Date.now(),
              });
            }
            return;
          }
          // Warmup phase: torch.compile per (W,H) shape. Fires once on
          // "compiling", periodically on "compiling_progress", clears on
          // "warmed". Back-calc started_at from the server's elapsed_ms
          // when we missed the initial event (mid-warmup connect).
          if (data.type === "compile") {
            const status = data.status as string | undefined;
            if (status === "compiling" || status === "compiling_progress") {
              setAiCompile((prev) => ({
                phase: "warming_up",
                width: data.width as number | undefined,
                height: data.height as number | undefined,
                n_steps: data.n_steps as number | undefined,
                iter: data.iter as number | undefined,
                total_iters: data.total_iters as number | undefined,
                elapsed_ms: data.elapsed_ms as number | undefined,
                est_seconds: data.est_seconds as number | undefined,
                started_at:
                  prev?.phase === "warming_up" && prev?.started_at
                    ? prev.started_at
                    : Date.now() -
                      (typeof data.elapsed_ms === "number" ? data.elapsed_ms : 0),
              }));
            } else if (status === "warmed" || status === "compile_failed") {
              setAiCompile(null);
            }
            return;
          }
        } catch {
          // Not JSON — fall through to log it.
        }
        // Anything we didn't structurally consume goes into the log
        // panel so the user can see worker stdout / unstructured server
        // notes without opening devtools.
        setAiLogs((prev) => [...prev, `← ${frame.message}`].slice(-20));
        return;
      }
      // ─── Image frames below.
      if (frame.kind !== "image") return;
      // Keep a rolling 30-frame window of inter-frame deltas → smooth FPS.
      const now = performance.now();
      if (lastFrameTimeRef.current > 0) {
        const dt = now - lastFrameTimeRef.current;
        const arr = frameTimingsRef.current;
        arr.push(dt);
        if (arr.length > 30) arr.shift();
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        if (avg > 0) setAiFps(1000 / avg);
      }
      lastFrameTimeRef.current = now;
      recvCountRef.current += 1;
      setAiPending(Math.max(0, sentCountRef.current - recvCountRef.current));
      // Latency approx: gap between last-send and now. Not RTT-precise
      // (we don't tag frames), but good enough for "is the dispatcher
      // backed up" telemetry. Smooth over the same 30-sample window.
      if (lastSendTimeRef.current > 0) {
        const dt = now - lastSendTimeRef.current;
        setAiLatencyMs(dt);
      }
      // Convert frame blob to an object URL for the preview <img> tag.
      const url = URL.createObjectURL(frame.blob);
      setAiImageUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      // Re-publish on the stage channel so /vj/stage (in a second
      // window/projector) receives the same frame. We send the raw
      // bytes — the stage tab decodes via createImageBitmap and pushes
      // through StageRenderer with sharpen/pixelate FX applied.
      const stageCh = stageChannelRef.current;
      if (stageCh) {
        const stageSeq = ++stageFrameSeqRef.current;
        frame.blob
          .arrayBuffer()
          .then((buf) => {
            if (!forwardingActive || stageSeq <= publishedStageSeq) return;
            publishedStageSeq = stageSeq;
            stageCh.postMessage({
              type: "frame",
              bytes: buf,
              width: outWidth,
              height: outHeight,
              seq: stageSeq,
            });
          })
          .catch(() => {
            /* ignore */
          });
      }
    };
    aiTransport.onStatusChange(onStatus);
    aiTransport.onFrame(onFrame);
    return () => {
      forwardingActive = false;
      aiTransport.offStatusChange(onStatus);
      aiTransport.offFrame(onFrame);
      void aiTransport.stop();
    };
  }, [aiTransport]);

  // Auto-connect on app load + on every backend / pod switch when the
  // user has it enabled. Mirrors the legacy /vj behaviour 1:1: the
  // useMemo above rebuilds aiTransport whenever signaling URL changes,
  // so this effect fires with a fresh transport for every URL flip.
  useEffect(() => {
    if (!aiAutoConnect) return;
    if (aiTransport.isConnected()) return;
    void aiTransport.start();
  }, [aiAutoConnect, aiTransport]);

  // ─── Output options ──────────────────────────────────────────────
  // Output res, klein α, klein steps, seed all live in useAiSettingsStore
  // so they stay in sync with the legacy /vj route AND so they survive
  // reload like every other live-set setting. Local component-state
  // versions removed — this was a divergence bug between the two routes.
  const outWidth = useAiSettingsStore((s) => s.outputWidth);
  const outHeight = useAiSettingsStore((s) => s.outputHeight);
  const setOutSize = useAiSettingsStore((s) => s.setOutputSize);
  const steps = useAiSettingsStore((s) => s.kleinSteps);
  const setSteps = useAiSettingsStore((s) => s.setKleinSteps);
  const alpha = useAiSettingsStore((s) => s.kleinAlpha);
  const setAlpha = useAiSettingsStore((s) => s.setKleinAlpha);
  const seed = useAiSettingsStore((s) => s.seed);
  const setSeed = useAiSettingsStore((s) => s.setSeed);
  const [generating, setGenerating] = useState(false);
  // Frame rate is persisted in useAiSettingsStore — the OutputOptions
  // FX disclosure has the selector (10/20/24/30/60). Subscribed here
  // so the rAF send loop's interval picks up changes immediately.
  const aiFrameRate = useAiSettingsStore((s) => s.frameRate);
  const outputStatus: "idle" | "running" | "error" =
    aiStatus === "error"
      ? "error"
      : aiStatus === "connected" && generating
        ? "running"
        : "idle";

  // The active scene's prompt — sent to the worker via flushSettingsNow.
  const activePromptRef = useRef<string>("");
  const activeScene = useSceneStore((s) =>
    s.scenes.find((sc) => sc.id === s.activeSceneId) ?? null,
  );
  useEffect(() => {
    activePromptRef.current = activeScene?.prompt ?? "";
    // Push prompt updates out to the stage tab so the projector overlay
    // shows the new prompt for ~2.4s before fading.
    if (activeScene?.prompt) {
      stageChannelRef.current?.postMessage({
        type: "prompt",
        prompt: activeScene.prompt,
      });
    }
  }, [activeScene?.prompt]);

  // ─── Settings flush ──────────────────────────────────────────────
  // Builds the settings payload and pushes it down the data channel.
  // The worker reads the latest values on every frame, so this is the
  // only path that lets prompt / seed / α / steps / resolution actually
  // affect generation. Without this, the worker uses its defaults and
  // the user has no way to change anything.
  const flushSettingsNow = useCallback(() => {
    if (!aiTransport.isConnected()) return;
    const payload: Record<string, unknown> = {
      prompt: activePromptRef.current,
      seed,
      captureWidth: outWidth,
      captureHeight: outHeight,
      width: outWidth,
      height: outHeight,
    };
    if (aiBackend === "klein" || aiBackend === "pod") {
      payload.alpha = alpha;
      payload.n_steps = steps;
    }
    aiTransport.sendText(JSON.stringify(payload));
  }, [aiTransport, seed, outWidth, outHeight, aiBackend, alpha, steps]);

  // Re-flush whenever any setting changes. Also re-flushes on connect
  // (aiStatus dep) so a freshly opened channel immediately gets the
  // current prompt/res/seed instead of falling back to worker defaults.
  useEffect(() => {
    flushSettingsNow();
  }, [
    flushSettingsNow,
    aiStatus,
    activeScene?.prompt,
  ]);

  // ─── /healthz polling ─────────────────────────────────────────────
  // While connected (or attempting), poll worker readiness every 2 s.
  // The output stage uses this to render "preparing workers 2/4 ready"
  // instead of a blank canvas during cold boot.
  useEffect(() => {
    if (!aiHealthUrl) return;
    if (aiStatus !== "connected" && aiStatus !== "connecting") {
      setAiServer(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(aiHealthUrl, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as {
          workerCount?: number;
          readyCount?: number;
        };
        if (cancelled) return;
        if (
          typeof j.workerCount === "number" &&
          typeof j.readyCount === "number"
        ) {
          setAiServer({ workerCount: j.workerCount, readyCount: j.readyCount });
        }
      } catch {
        if (!cancelled) setAiServer(null);
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [aiHealthUrl, aiStatus]);

  // ─── Frame send loop ─────────────────────────────────────────────
  // Captures the input scene canvas at `aiFrameRate`, encodes as JPEG,
  // ships down the data channel via sendBinary. Backpressure-safe:
  // skips when the channel buffer is high or a previous encode is
  // still in flight. This is what actually makes the worker generate
  // images — without it, the worker has no source to img2img against.
  const senderRef = useRef<{
    running: boolean;
    lastFrameTime: number;
    pendingEncode: boolean;
    captureCanvas: HTMLCanvasElement | null;
    captureCtx: CanvasRenderingContext2D | null;
    resolution: number;
    rafId: number;
    generation: number;
  }>({
    running: false,
    lastFrameTime: 0,
    pendingEncode: false,
    captureCanvas: null,
    captureCtx: null,
    resolution: 0,
    rafId: 0,
    generation: 0,
  });

  const aiFrameLoop = useCallback(() => {
    const sender = senderRef.current;
    if (!sender.running) return;
    sender.rafId = requestAnimationFrame(aiFrameLoop);

    const now = performance.now();
    const frameInterval = 1000 / aiFrameRate;
    if (now - sender.lastFrameTime < frameInterval) return;

    const src = inputCanvasRef.current;
    if (!src || src.width === 0 || src.height === 0) return;
    sender.lastFrameTime = now;
    if (!aiTransport.isConnected() || !aiTransport.canSend(256 * 1024) || sender.pendingEncode) return;

    const capW = outWidth;
    const capH = outHeight;
    const resolutionKey = capW * 10000 + capH;
    if (!sender.captureCanvas || sender.resolution !== resolutionKey) {
      sender.captureCanvas = document.createElement("canvas");
      sender.captureCanvas.width = capW;
      sender.captureCanvas.height = capH;
      sender.captureCtx = sender.captureCanvas.getContext("2d");
      sender.resolution = resolutionKey;
    }
    const ctx = sender.captureCtx;
    if (!ctx) return;

    ctx.drawImage(src, 0, 0, capW, capH);

    sender.pendingEncode = true;
    const generation = sender.generation;
    sender.captureCanvas.toBlob(
      (blob) => {
        if (!blob || !sender.running || generation !== sender.generation) {
          sender.pendingEncode = false;
          return;
        }
        blob
          .arrayBuffer()
          .then((buf) => {
            if (!sender.running || generation !== sender.generation ||
                !aiTransport.isConnected() || !aiTransport.canSend(256 * 1024)) return;
            aiTransport.sendBinary(buf);
            sentCountRef.current += 1;
            lastSendTimeRef.current = performance.now();
            setAiPending(
              Math.max(0, sentCountRef.current - recvCountRef.current),
            );
          })
          .catch(() => {
            /* network hiccup; next frame will try again */
          })
          .finally(() => { sender.pendingEncode = false; });
      },
      "image/jpeg",
      0.85,
    );
  }, [aiTransport, aiFrameRate, outWidth, outHeight]);

  // Start/stop the send loop based on `generating`. Tearing down also
  // cancels the in-flight rAF so a quick toggle doesn't leak frames.
  useEffect(() => {
    const sender = senderRef.current;
    if (generating && aiStatus === "connected") {
      if (!sender.running) {
        sender.running = true;
        sender.lastFrameTime = 0;
        sender.rafId = requestAnimationFrame(aiFrameLoop);
      }
    } else {
      sender.running = false;
      if (sender.rafId) cancelAnimationFrame(sender.rafId);
    }
    return () => {
      sender.running = false;
      sender.generation++;
      if (sender.rafId) cancelAnimationFrame(sender.rafId);
    };
  }, [generating, aiStatus, aiFrameLoop]);

  // ─── Live performance hotkeys ────────────────────────────────────
  // Mirrors legacy /vj's hotkey map so muscle memory carries over:
  //   1-9         → fire prompt preset (replaces scene prompt + reroll seed)
  //   space       → reroll seed only (keep prompt — fresh noise variation)
  //   ↑ / ↓       → klein α ±0.02 (when backend === klein)
  //   ← / →       → klein α ±0.01 (fine)
  //   ⌘K          → command palette (handled in CommandPalette itself)
  //   p / s / l   → drawer modes (handled in SystemBar)
  // We intentionally do NOT bind 0 → fog yet because DMX isn't wired
  // here — that lights up in Batch 3.
  const updateScenePrompt = useSceneStore((s) => s.updateScenePrompt);
  const setActiveScenePrompt = useCallback(
    (next: string) => {
      const id = useSceneStore.getState().activeSceneId;
      if (id) updateScenePrompt(id, next);
    },
    [updateScenePrompt],
  );

  // Fire a preset by index — set the active scene's prompt to the
  // preset's prompt, reroll the seed, then flush. Same shape as legacy.
  const promptPresets = useAiSettingsStore((s) => s.promptPresets);
  const firePresetByIndex = useCallback(
    (idx: number) => {
      const preset = promptPresets[idx];
      if (!preset) return;
      setActiveScenePrompt(preset.prompt);
      setSeed(Math.floor(Math.random() * 1_000_000));
      // flushSettingsNow runs from the prompt-change effect below, but
      // we fire it directly too so the wire-payload lands in the same
      // event tick as the keypress (no React-scheduler delay → no
      // perceptible "click did nothing" lag).
      window.queueMicrotask(() => flushSettingsNow());
    },
    [promptPresets, setActiveScenePrompt, setSeed, flushSettingsNow],
  );
  const rerollSeed = useCallback(() => {
    setSeed(Math.floor(Math.random() * 1_000_000));
    window.queueMicrotask(() => flushSettingsNow());
  }, [setSeed, flushSettingsNow]);
  const adjustAlpha = useCallback(
    (delta: number) => {
      const next = Math.max(0, Math.min(0.5, +(alpha + delta).toFixed(2)));
      setAlpha(next);
    },
    [alpha, setAlpha],
  );

  useEffect(() => {
    function isTyping() {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const t = el.tagName;
      if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    }
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping()) return;
      if (/^[1-9]$/.test(e.key)) {
        firePresetByIndex(parseInt(e.key, 10) - 1);
        e.preventDefault();
        return;
      }
      if (e.code === "Space") {
        // Spacebar = reroll seed only (matches legacy — was changed
        // from "fire random preset" because that was disorienting
        // mid-set when you've already dialed in a vibe).
        rerollSeed();
        e.preventDefault();
        return;
      }
      if (aiBackend === "klein") {
        if (e.key === "ArrowUp") {
          adjustAlpha(0.02);
          e.preventDefault();
        } else if (e.key === "ArrowDown") {
          adjustAlpha(-0.02);
          e.preventDefault();
        } else if (e.key === "ArrowRight") {
          adjustAlpha(0.01);
          e.preventDefault();
        } else if (e.key === "ArrowLeft") {
          adjustAlpha(-0.01);
          e.preventDefault();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [firePresetByIndex, rerollSeed, adjustAlpha, aiBackend]);

  // ▶ generate is wired to the OutputOptions button + the explicit
  // generate ▶ inside the popover. Spacebar above no longer toggles
  // generation (it reroll-seeds) — much more useful in a live set.
  // To stop generation use the button or hit ■ stop.

  // ─── Layout ──────────────────────────────────────────────────────
  // Global error banners for the two error sources in /vj-next:
  //   - Audio init failure (mic permission denied, no audio in shared
  //     source, etc.)
  //   - Recording failure (MediaRecorder unsupported, encoder error)
  // Click to dismiss. Same red-bordered chrome as legacy /vj.
  const dismissAudioError = () => setAudioErrorMessage(null);
  return (
    <div className="vp-root">
      <SystemBar
        audioStatus={audioStatus}
        audioDeviceLabel={audioDeviceLabel}
        audioDevices={audioDevices}
        selectedDeviceId={selectedDeviceId}
        onDeviceChange={handleDeviceChange}
        systemAudioSupported={systemAudioSupported}
        audioErrorMessage={audioErrorMessage}
        audioFeaturesRef={audioFeaturesRef}
        aiStatus={aiStatus}
        aiBackend={aiBackend}
        onAiBackendChange={(b: AiBackend) => {
          // Switching backend tears down the current channel — the
          // useMemo that builds aiTransport rebuilds it on the new URL.
          void aiTransport.stop();
          setAiBackend(b);
        }}
        aiPodUrl={aiPodUrl}
        onAiPodSelect={(url) => {
          // setPodUrl in the store also flips backend to "pod".
          void aiTransport.stop();
          setAiPodUrl(url);
        }}
        onAiConnect={() => void aiTransport.start()}
        onAiDisconnect={() => {
          setGenerating(false);
          void aiTransport.stop();
        }}
        aiAutoConnect={aiAutoConnect}
        onAiAutoConnectChange={setAiAutoConnect}
        recording={recording}
        aiTelemetryUrl={aiTelemetryUrl}
        aiLogs={aiLogs}
        aiFps={aiStatus === "connected" ? aiFps : null}
        // Prefer the server-reported per-frame gen time when we have
        // it (precise), fall back to the wall-clock send→recv estimate
        // (rough but always populated). Either way the popover shows
        // *something* the moment frames start flowing.
        aiLatencyMs={
          aiStatus === "connected"
            ? aiServerLatency ?? aiLatencyMs
            : null
        }
        aiPending={aiStatus === "connected" ? aiPending : null}
      />
      <SceneTabs />
      <AudioMeters audioFeaturesRef={audioFeaturesRef} />

      {audioErrorMessage && (
        <button
          type="button"
          className="vp-error-banner"
          onClick={dismissAudioError}
          title="click to dismiss"
        >
          ⚠ audio: {audioErrorMessage}
        </button>
      )}
      {recording.error && (
        <button
          type="button"
          className="vp-error-banner"
          onClick={recording.clearError}
          title="click to dismiss"
        >
          ⚠ recording: {recording.error}
        </button>
      )}

      <div className="vp-workspace">
        {/* INPUT column — scene canvas + element inspector */}
        <div className="vp-col">
          <SceneCanvas
            audioFeaturesRef={audioFeaturesRef}
            timeDomainRef={timeDomainRef}
            startedAt={startedAt}
            canvasRefCb={handleInputCanvas}
          />
          <ElementInspector
            audioFeaturesRef={audioFeaturesRef}
            startedAt={startedAt}
          />
        </div>

        {/* OUTPUT column — preview + options */}
        <div className="vp-col">
          <OutputStage
            aiImageUrl={aiImageUrl}
            outputStatus={outputStatus}
            fps={aiStatus === "connected" ? aiFps : 0}
            aiStatus={aiStatus}
            aiServer={aiServer}
            aiCompile={aiCompile}
            generating={generating}
          />
          <OutputOptions
            width={outWidth}
            height={outHeight}
            onResolutionChange={(w, h) => setOutSize(w, h)}
            steps={steps}
            onStepsChange={setSteps}
            alpha={alpha}
            onAlphaChange={setAlpha}
            seed={seed}
            onSeedChange={setSeed}
            generating={generating}
            onGeneratingChange={setGenerating}
            canGenerate={aiStatus === "connected"}
          />
          <PerformanceDeck
            activePrompt={activeScene?.prompt ?? ""}
            onFirePreset={firePresetByIndex}
            onReroll={rerollSeed}
            onAlphaNudge={aiBackend === "klein" ? adjustAlpha : null}
            alpha={aiBackend === "klein" ? alpha : null}
          />
        </div>
      </div>

      <Drawer
        audioFeaturesRef={audioFeaturesRef}
        startedAt={startedAt}
        inputCanvasRef={inputCanvasRef}
        audioEngineRef={audioEngineRef}
      />
      <CommandPalette />

      <div className="vp-tipbar">
        double-click canvas to add · <kbd>⌘K</kbd> search ·{" "}
        <kbd>P</kbd> presets · <kbd>S</kbd> scenes · <kbd>L</kbd> lighting ·{" "}
        <kbd>⌫</kbd> delete · <kbd>esc</kbd> close
      </div>
    </div>
  );
}
