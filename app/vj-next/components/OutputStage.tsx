"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  buildPresetMap,
  collectOverlayItems,
  renderOverlayItems,
  selectActiveScene,
  usePresetStore,
  useSceneStore,
  type OverlayItem,
} from "@/src/lib/composer";
import type { AudioFeatures } from "@/src/lib/audio-features";
import type { AiTransportStatus } from "@/src/lib/ai/transport";
import { CompileOverlay, type AiCompileState } from "./CompileOverlay";

interface OutputStageProps {
  /** When connected, the AI side will stream frames here as a data URL. We
   *  display them as a backing image; null = "show empty preview". */
  aiImageUrl: string | null;
  /** "idle" | "running" | "error" — drives the corner status pill. */
  outputStatus: "idle" | "running" | "error";
  /** Live FPS readout. */
  fps: number;
  /** AI transport status — disambiguates the empty-state messaging
   *  (not connected vs. connected-but-not-generating vs. waiting-for-frame). */
  aiStatus: AiTransportStatus;
  /** Worker readiness from /healthz — drives "preparing workers x/y". */
  aiServer: { workerCount: number; readyCount: number } | null;
  /** Server boot/compile state — drives CompileOverlay. */
  aiCompile: AiCompileState | null;
  /** Whether the user has armed generation (▶ generate). */
  generating: boolean;
  /** Live audio features — resolves audio-bound logo properties for the overlay. */
  audioFeaturesRef: React.MutableRefObject<AudioFeatures | null>;
  startedAt: number;
  /** Called every overlay frame with the resolved items so the app can
   *  forward them to the projector tab. `count` items of `items` are live. */
  onOverlay?: (items: OverlayItem[], count: number) => void;
  /** Receives the offscreen composite (AI frame + logo overlay) while a
   *  frame is showing, null otherwise. The recorder captures from it. */
  outputCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  /** Paint the composite only while recording — it's an extra full pass. */
  recording: boolean;
}

/** Long side the composite is upscaled to (integer multiple of the frame). */
const COMPOSITE_TARGET_LONG_SIDE = 1920;

/**
 * Output stage — the right-column counterpart to the input scene canvas.
 * Same dimensions (16:9 via .vp-stage), magenta-tinted brackets so the two
 * stages read as a stereo pair (cyan = source, magenta = result).
 *
 * In the actual /vj/ route this is the AI preview canvas; here we render
 * either the AI image or a "PASS-THROUGH" mode that mirrors the input scene
 * directly so the design works even before the AI worker is connected. The
 * pass-through path is also genuinely useful as a "no-AI projector mode".
 */
export function OutputStage({
  aiImageUrl,
  outputStatus,
  fps,
  aiStatus,
  aiServer,
  aiCompile,
  generating,
  audioFeaturesRef,
  startedAt,
  onOverlay,
  outputCanvasRef,
  recording,
}: OutputStageProps) {
  const activeScene = useSceneStore(selectActiveScene);
  const presets = usePresetStore((s) => s.presets);
  const presetMap = useMemo(() => buildPresetMap(presets), [presets]);
  const imgRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const onOverlayRef = useRef(onOverlay);
  const recordingRef = useRef(recording);
  useEffect(() => {
    onOverlayRef.current = onOverlay;
    recordingRef.current = recording;
  }, [onOverlay, recording]);
  // Offscreen composite for the recorder: the AI frame drawn at an
  // integer upscale, then the overlay re-rendered at that size on a
  // transparent layer and stamped on top (the mask's black plate must
  // not be painted straight onto the frame, or it would erase it).
  const compositeRef = useRef<HTMLCanvasElement | null>(null);
  const layerRef = useRef<HTMLCanvasElement | null>(null);

  // Crisp logo pass on top of the AI frame. Runs its own rAF while a frame
  // is showing: the <img> below is 16:9 and object-fit: contain inside a
  // 16:9 stage, so a canvas filling the same box lines up with the frame.
  const hasFrame = !!aiImageUrl;
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !hasFrame) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const items: OverlayItem[] = [];
    if (!compositeRef.current) compositeRef.current = document.createElement("canvas");
    if (!layerRef.current) layerRef.current = document.createElement("canvas");
    const composite = compositeRef.current;
    const layer = layerRef.current;
    outputCanvasRef.current = composite;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const scene = useSceneStore.getState().scenes.find(
        (s) => s.id === useSceneStore.getState().activeSceneId,
      );
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);
      if (!scene) return;
      const t = (performance.now() - startedAt) / 1000;
      const n = collectOverlayItems(scene, audioFeaturesRef.current, presetMap, t, items);
      renderOverlayItems(ctx, items, n, w, h, imgRef.current);
      onOverlayRef.current?.(items, n);

      const img = imgRef.current;
      if (recordingRef.current && img && img.naturalWidth > 0) {
        const scale = Math.max(1, Math.ceil(COMPOSITE_TARGET_LONG_SIDE / Math.max(img.naturalWidth, img.naturalHeight)));
        const cw = img.naturalWidth * scale;
        const ch = img.naturalHeight * scale;
        if (composite.width !== cw || composite.height !== ch) {
          composite.width = cw;
          composite.height = ch;
          layer.width = cw;
          layer.height = ch;
        }
        const cctx = composite.getContext("2d");
        const lctx = layer.getContext("2d");
        if (cctx && lctx) {
          cctx.drawImage(img, 0, 0, cw, ch);
          lctx.clearRect(0, 0, cw, ch);
          renderOverlayItems(lctx, items, n, cw, ch, composite);
          cctx.drawImage(layer, 0, 0);
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      outputCanvasRef.current = null;
    };
  }, [hasFrame, audioFeaturesRef, presetMap, startedAt, outputCanvasRef]);

  // Briefly fade the image when a new frame arrives so the static "running"
  // state has visual life. CSS handles the fade; we just reset the key.
  useEffect(() => {
    if (!imgRef.current || !aiImageUrl) return;
    imgRef.current.style.opacity = "0.95";
    const id = window.setTimeout(() => {
      if (imgRef.current) imgRef.current.style.opacity = "1";
    }, 80);
    return () => window.clearTimeout(id);
  }, [aiImageUrl]);

  const statusColor =
    outputStatus === "running"
      ? "var(--vj-live)"
      : outputStatus === "error"
        ? "var(--vj-error)"
        : "var(--vj-ink-dim)";

  return (
    <div className="vp-stage vp-stage--output">
      <div className="vp-stage__brackets"><b /></div>

      {/* Output content: either an AI frame, or an empty hint.
          Plain <img> on purpose — `aiImageUrl` is a base64 stream URL that
          changes ~30 fps; next/image's optimization pass would be a
          per-frame waste. */}
      {aiImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          src={aiImageUrl}
          alt="AI output"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            background: "#000",
            transition: "opacity 80ms linear",
          }}
        />
      )}

      {/* Logo overlay — see effect above. pointer-events none so the
          stage keeps behaving like a passive monitor. */}
      {hasFrame && (
        <canvas
          ref={overlayRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Compile/boot overlay — wins over everything else when the
          server is loading weights or JIT-compiling. The legacy /vj
          render of this overlay sells the cold-boot wait that would
          otherwise look like a frozen preview. */}
      {aiCompile && <CompileOverlay state={aiCompile} />}

      {/* Smart placeholder ladder when no AI frame yet. Each branch
          telegraphs the most-specific true thing the server's doing,
          so the user always knows whether to wait, press ▶, or fix
          a connection — never sees a blank "OUTPUT IDLE" while the
          worker is mid-compile. */}
      {!aiImageUrl && !aiCompile && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {aiStatus === "connecting" ? (
            <div className="vp-canvas-hint">
              <b>NEGOTIATING</b>
              <span>opening webrtc channel…</span>
            </div>
          ) : aiStatus !== "connected" ? (
            <div className="vp-canvas-hint">
              <b>OUTPUT IDLE</b>
              <span>connect ai from the bar above</span>
              <i>scene: {activeScene?.name ?? "—"}</i>
            </div>
          ) : aiServer && aiServer.readyCount < aiServer.workerCount ? (
            <div className="vp-canvas-hint">
              <b>PREPARING WORKERS</b>
              <span>
                {aiServer.readyCount} / {aiServer.workerCount} ready
              </span>
              <i>loading weights · compiling kernels — ~3 min on cold boot</i>
            </div>
          ) : generating ? (
            <div className="vp-canvas-hint">
              <b>GENERATING</b>
              <span>waiting for first frame…</span>
            </div>
          ) : (
            <div className="vp-canvas-hint">
              <b>READY</b>
              <span>
                {aiServer
                  ? `${aiServer.workerCount} ${aiServer.workerCount === 1 ? "worker" : "workers"} ready`
                  : "connected"}
              </span>
              <i>press ▶ generate or hit space</i>
            </div>
          )}
        </div>
      )}

      <div className="vp-stage__head">
        <span className="vp-stage__title">output</span>
        <span className="vp-stage__meta">
          <span style={{ color: statusColor, marginRight: "0.4rem" }}>●</span>
          {outputStatus} · <b>{fps.toFixed(1)}</b> fps
        </span>
      </div>
    </div>
  );
}
