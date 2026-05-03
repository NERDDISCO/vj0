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
import { SystemBar } from "./components/SystemBar";
import { SceneTabs } from "./components/SceneTabs";
import { AudioMeters } from "./components/AudioMeters";
import { SceneCanvas } from "./components/SceneCanvas";
import { OutputStage } from "./components/OutputStage";
import { OutputOptions } from "./components/OutputOptions";
import { ElementInspector } from "./components/ElementInspector";
import { Drawer } from "./components/Drawer";
import { CommandPalette } from "./components/CommandPalette";

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

  const initAudio = useCallback(async (deviceId?: string) => {
    setAudioStatus("starting");
    try {
      // Tear down any existing engine so we can swap mic devices.
      audioEngineRef.current?.destroy();
      const eng = new AudioEngine();
      await eng.init(deviceId);
      audioEngineRef.current = eng;
      setAudioStatus("running");
    } catch (e) {
      console.error("Audio init failed", e);
      setAudioStatus("error");
    }
  }, []);

  const fetchDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all.filter((d) => d.kind === "audioinput");
      setAudioDevices(
        inputs.map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${d.deviceId.slice(0, 6)}`,
        })),
      );
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
      setSelectedDeviceId(id);
      const dev = audioDevices.find((d) => d.deviceId === id);
      if (dev) setAudioDeviceLabel(dev.label);
      void initAudio(id);
    },
    [audioDevices, initAudio],
  );

  // ─── AI transport (WebRTC) ────────────────────────────────────────
  // Same transport the legacy /vj uses — wired in directly so connect /
  // disconnect / generate / received-frame all work end to end.
  const aiBackend = useAiSettingsStore((s) => s.backend);
  const setAiBackend = useAiSettingsStore((s) => s.setBackend);
  const aiSignalingUrl = useMemo(
    () => AI_BACKEND_URLS[aiBackend] || "/api/webrtc/offer",
    [aiBackend],
  );
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
  const lastFrameTimeRef = useRef<number>(0);
  const frameTimingsRef = useRef<number[]>([]);

  useEffect(() => {
    const onStatus = (s: AiTransportStatus) => setAiStatus(s);
    const onFrame = (frame: AiIncomingFrame) => {
      // Only image frames carry the preview pixels; text frames are
      // log/control messages we don't render.
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
      // Convert frame blob to an object URL for the preview <img> tag.
      // Production code would push into a WebGL renderer; this is fine
      // for the design-iteration phase of /vj-next.
      const url = URL.createObjectURL(frame.blob);
      setAiImageUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    };
    aiTransport.onStatusChange(onStatus);
    aiTransport.onFrame(onFrame);
    return () => {
      aiTransport.offStatusChange(onStatus);
      aiTransport.offFrame(onFrame);
      void aiTransport.stop();
    };
  }, [aiTransport]);

  // ─── Output options ──────────────────────────────────────────────
  const [outWidth, setOutWidth] = useState(512);
  const [outHeight, setOutHeight] = useState(288);
  const [steps, setSteps] = useState(2);
  const [alpha, setAlpha] = useState(0.32);
  const [seed, setSeed] = useState(424242);
  const [generating, setGenerating] = useState(false);
  const outputStatus: "idle" | "running" | "error" =
    aiStatus === "error"
      ? "error"
      : aiStatus === "connected" && generating
        ? "running"
        : "idle";

  // Space toggles generation when not in input
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        setGenerating((g) => !g);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ─── Layout ──────────────────────────────────────────────────────
  return (
    <div className="vp-root">
      <SystemBar
        audioStatus={audioStatus}
        audioDeviceLabel={audioDeviceLabel}
        audioDevices={audioDevices}
        selectedDeviceId={selectedDeviceId}
        onDeviceChange={handleDeviceChange}
        aiStatus={aiStatus}
        aiBackend={aiBackend}
        onAiBackendChange={(b: AiBackend) => {
          void aiTransport.stop();
          setAiBackend(b);
        }}
        onAiConnect={() => void aiTransport.start()}
        onAiDisconnect={() => {
          setGenerating(false);
          void aiTransport.stop();
        }}
        aiFps={aiStatus === "connected" ? aiFps : null}
      />
      <SceneTabs />
      <AudioMeters audioFeaturesRef={audioFeaturesRef} />

      <div className="vp-workspace">
        {/* INPUT column — scene canvas + element inspector */}
        <div className="vp-col">
          <SceneCanvas
            audioFeaturesRef={audioFeaturesRef}
            timeDomainRef={timeDomainRef}
            startedAt={startedAt}
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
          />
          <OutputOptions
            width={outWidth}
            height={outHeight}
            onResolutionChange={(w, h) => {
              setOutWidth(w);
              setOutHeight(h);
            }}
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
        </div>
      </div>

      <Drawer audioFeaturesRef={audioFeaturesRef} startedAt={startedAt} />
      <CommandPalette />

      <div className="vp-tipbar">
        double-click canvas to add · <kbd>⌘K</kbd> search ·{" "}
        <kbd>P</kbd> presets · <kbd>S</kbd> scenes · <kbd>L</kbd> lighting ·{" "}
        <kbd>⌫</kbd> delete · <kbd>esc</kbd> close
      </div>
    </div>
  );
}
