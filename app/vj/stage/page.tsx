"use client";

/**
 * Stage (audience) view — fullscreen AI output only, no controls.
 * Subscribes to the stage BroadcastChannel published by the /vj control tab.
 * Run /vj on your laptop (or iPad), drag this tab to the projector screen and
 * hit F11 to go fullscreen.
 *
 * Rendering: WebGL2 unsharp-mask sharpen pass (StageRenderer) brings back
 * edge detail lost when bilinear-upscaling a small generated frame to a
 * projector. CSS overlays add the matching scanline + vignette FX from the
 * preview frame so the projector image has the same visual character as the
 * control panel preview.
 */
import { useEffect, useRef, useState } from "react";
import { createLatestFrameDecoder } from "@/src/lib/ai/latest-frame-decoder";
import {
  openStageChannel,
  type StageMsg,
  type StageOverlayMsg,
} from "@/src/lib/ai/stage-channel";
import { renderOverlayItems } from "@/src/lib/composer";
import { getAssetBitmap, loadAsset } from "@/src/lib/assets";
import { useAiSettingsStore } from "@/src/lib/stores";
import {
  StageRenderer,
  type StageRendererHandle,
} from "../components/StageRenderer";

export default function StagePage() {
  const rendererRef = useRef<StageRendererHandle>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  /** Aspect of the last decoded AI frame — sizes the overlay's contain box. */
  const frameAspectRef = useRef(16 / 9);
  const [hasSignal, setHasSignal] = useState(false);
  const [promptOverlay, setPromptOverlay] = useState<string>("");
  const overlayTimeoutRef = useRef<number | null>(null);

  const sharpen = useAiSettingsStore((s) => s.stageSharpen);
  const scanlines = useAiSettingsStore((s) => s.stageScanlines);
  const vignette = useAiSettingsStore((s) => s.stageVignette);
  const pixelate = useAiSettingsStore((s) => s.stagePixelate);
  const pixelateSize = useAiSettingsStore((s) => s.stagePixelateSize);

  useEffect(() => {
    const ch = openStageChannel();
    if (!ch) return;

    // Announce presence so the control tab can (optionally) re-publish current state
    ch.postMessage({ type: "hello" });

    const decoder = createLatestFrameDecoder((bitmap) => {
      if (bitmap.height > 0) frameAspectRef.current = bitmap.width / bitmap.height;
      rendererRef.current?.drawBitmap(bitmap);
    });

    // Logo overlay: the control tab ships resolved items per frame; we
    // draw them crisp over the StageRenderer's canvas. The renderer is
    // object-fit: contain, so we letterbox the overlay to the same box.
    const drawOverlay = (msg: StageOverlayMsg) => {
      const canvas = overlayRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const aspect = frameAspectRef.current;
      let w = vw;
      let h = vw / aspect;
      if (h > vh) {
        h = vh;
        w = vh * aspect;
      }
      const dpr = window.devicePixelRatio || 1;
      const pw = Math.max(1, Math.round(w * dpr));
      const ph = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.style.left = `${(vw - w) / 2}px`;
      canvas.style.top = `${(vh - h) / 2}px`;
      ctx.clearRect(0, 0, pw, ph);
      for (const it of msg.items) {
        // Same-origin IndexedDB: the stage tab decodes the logo itself the
        // first time it sees an id; until then the item is simply skipped.
        if (!getAssetBitmap(it.assetId)) void loadAsset(it.assetId);
      }
      renderOverlayItems(
        ctx,
        msg.items,
        msg.items.length,
        pw,
        ph,
        rendererRef.current?.getCanvas() ?? null,
      );
    };
    const onMessage = (ev: MessageEvent<StageMsg>) => {
      const msg = ev.data;
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "frame") {
        setHasSignal(true);
        decoder.push(new Blob([msg.bytes], { type: "image/jpeg" }));
      } else if (msg.type === "overlay") {
        drawOverlay(msg);
      } else if (msg.type === "prompt") {
        const p = msg.prompt.trim();
        if (!p) return;
        setPromptOverlay(p);
        if (overlayTimeoutRef.current)
          window.clearTimeout(overlayTimeoutRef.current);
        overlayTimeoutRef.current = window.setTimeout(() => {
          setPromptOverlay("");
          overlayTimeoutRef.current = null;
        }, 2400);
      }
    };

    ch.onmessage = onMessage;
    return () => {
      ch.onmessage = null;
      ch.close();
      decoder.dispose();
      if (overlayTimeoutRef.current)
        window.clearTimeout(overlayTimeoutRef.current);
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        margin: 0,
        padding: 0,
        background: "#000",
        overflow: "hidden",
        cursor: "none",
      }}
    >
      <StageRenderer
        ref={rendererRef}
        sharpen={pixelate ? 0 : sharpen}
        pixelate={pixelate ? pixelateSize : 0}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />

      {/* Crisp logo overlay from the control tab — positioned to the
          frame's contain box by drawOverlay. */}
      <canvas
        ref={overlayRef}
        style={{ position: "absolute", pointerEvents: "none" }}
      />

      {/* Scanlines + vignette FX overlay — same look as the preview frame so
          the projector image has the same visual character. Both can be
          toggled via the persisted prefs (default on). pointer-events: none
          ensures clicks fall through (not that there's anything to click). */}
      {(scanlines || vignette) && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: [
              vignette
                ? "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)"
                : null,
              scanlines
                ? "repeating-linear-gradient(to bottom, transparent 0px, transparent 2px, rgba(0,0,0,0.18) 3px, transparent 4px)"
                : null,
            ]
              .filter(Boolean)
              .join(", "),
            mixBlendMode: "multiply",
          }}
        />
      )}

      {/* Prompt reveal overlay — fades in for ~2.4s on prompt change */}
      <div
        style={{
          position: "absolute",
          left: "4vw",
          bottom: "6vh",
          right: "4vw",
          pointerEvents: "none",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          fontSize: "2vh",
          lineHeight: 1.35,
          letterSpacing: "0.02em",
          color: "rgba(255,255,255,0.88)",
          textShadow:
            "0 0 18px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.95)",
          opacity: promptOverlay ? 1 : 0,
          transform: promptOverlay ? "translateY(0)" : "translateY(8px)",
          transition: "opacity 380ms ease, transform 380ms ease",
        }}
      >
        {promptOverlay}
      </div>

      {/* Idle placeholder before the first frame arrives */}
      {!hasSignal && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#444",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: "1.4vh",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
          }}
        >
          waiting for stage feed from /vj …
        </div>
      )}
    </div>
  );
}
