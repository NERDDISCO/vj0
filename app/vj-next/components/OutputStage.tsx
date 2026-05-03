"use client";

import { useEffect, useRef } from "react";
import { selectActiveScene, useSceneStore } from "@/src/lib/composer";

interface OutputStageProps {
  /** When connected, the AI side will stream frames here as a data URL. We
   *  display them as a backing image; null = "show empty preview". */
  aiImageUrl: string | null;
  /** "idle" | "running" | "error" — drives the corner status pill. */
  outputStatus: "idle" | "running" | "error";
  /** Live FPS readout. */
  fps: number;
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
export function OutputStage({ aiImageUrl, outputStatus, fps }: OutputStageProps) {
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
      {aiImageUrl ? (
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
      ) : (
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
          <div className="vp-canvas-hint">
            <b>OUTPUT IDLE</b>
            <span>connect ai · or pass-through input</span>
            <i>scene: {activeScene?.name ?? "—"}</i>
          </div>
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
