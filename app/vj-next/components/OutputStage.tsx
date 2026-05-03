"use client";

import { useEffect, useRef } from "react";
import { selectActiveScene, useSceneStore } from "@/src/lib/composer";
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
}

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
}: OutputStageProps) {
  const activeScene = useSceneStore(selectActiveScene);
  const imgRef = useRef<HTMLImageElement>(null);

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
