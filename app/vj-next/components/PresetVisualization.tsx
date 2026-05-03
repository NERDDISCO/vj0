"use client";

import { useEffect, useRef } from "react";
import { compileFormula } from "@/src/lib/composer";

interface PresetVisualizationProps {
  formula: string;
  /** Single-value live readout that gets fed in alongside the rolling
   *  history. Pass current `rms` when the preset's primary feature is rms,
   *  etc. The viz uses it both for the "now" indicator and to seed the
   *  rolling history with realistic values. */
  liveValue: number;
  /** Compact mode: smaller bar instead of waveform. */
  compact?: boolean;
}

/**
 * Tiny per-preset visualization. Two modes:
 *   1. Compact (used in chips):  a single horizontal bar.
 *   2. Expanded (used in cards): a rolling history scope of resolved
 *      preset values, scaled 0..1, drawn into a canvas.
 *
 * Both modes use the patch palette gradient so they read as part of the
 * "audio side" of the visual language.
 */
export function PresetVisualization({
  formula,
  liveValue,
  compact = false,
}: PresetVisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<Float32Array>(new Float32Array(120));
  const headRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const compiled = compileFormula(formula);

    function draw() {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      const hist = historyRef.current;
      // Push the latest formula output into the history.
      let value = liveValue;
      if (typeof compiled !== "string") {
        try {
          value = compiled.fn({
            rms: liveValue,
            peak: liveValue,
            low: liveValue,
            mid: liveValue,
            high: liveValue,
            bright: liveValue,
            t: performance.now() / 1000,
            v: 0.5,
          });
        } catch {
          value = 0;
        }
      }
      hist[headRef.current] = value;
      headRef.current = (headRef.current + 1) % hist.length;

      // Draw a stroked envelope of the rolling history.
      ctx.strokeStyle = "#ff00aa";
      ctx.lineWidth = 1.2 * dpr;
      ctx.shadowColor = "#ff00aa";
      ctx.shadowBlur = 6 * dpr;
      ctx.beginPath();
      for (let i = 0; i < hist.length; i++) {
        const idx = (headRef.current + i) % hist.length;
        const x = (i / (hist.length - 1)) * w;
        const y = h - hist[idx] * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      rafRef.current = requestAnimationFrame(draw);
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [formula, liveValue]);

  if (compact) {
    return (
      <span
        className="vp-preset-chip__viz"
        style={{ ["--vp-viz" as string]: `${liveValue * 100}%` } as React.CSSProperties}
      />
    );
  }

  return (
    <div className="vp-preset__viz">
      <canvas ref={canvasRef} />
    </div>
  );
}
