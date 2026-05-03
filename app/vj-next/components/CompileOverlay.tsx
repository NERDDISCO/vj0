"use client";

import { useEffect, useState } from "react";

/**
 * Server-emitted boot phases. Map directly to messages from
 * inference_server.py — the worker walks this list once at startup
 * (cold boot) and again every time it sees a new (width, height)
 * shape that hasn't been JIT-compiled yet.
 */
export type BootPhase =
  | "loading_weights"
  | "applying_fp8"
  | "registering_compile_stubs"
  | "warming_up";

const BOOT_PHASE_TITLE: Record<BootPhase, string> = {
  loading_weights: "Loading the AI model",
  applying_fp8: "Optimising for speed",
  registering_compile_stubs: "Almost there",
  warming_up: "Warming up",
};

export interface AiCompileState {
  phase: BootPhase;
  width?: number;
  height?: number;
  n_steps?: number;
  iter?: number;
  total_iters?: number;
  elapsed_ms?: number;
  est_seconds?: number;
  started_at: number;
}

interface CompileOverlayProps {
  state: AiCompileState;
}

/**
 * Overlay shown when the AI worker is loading weights, applying fp8, or
 * JIT-compiling for a new (width, height). The compile phase itself is a
 * single ~150 s torch.compile call that emits no per-step progress, so
 * we estimate elapsed/remaining locally from `startedAt` and the
 * server-reported `estSeconds`. Re-rendered at 4 Hz so the bar moves
 * smoothly even when the network is silent for tens of seconds.
 *
 * Visually re-themed for Patch Studio — Doto display font for the big
 * size readout, cyan/magenta cable accents instead of the legacy mono.
 */
export function CompileOverlay({ state }: CompileOverlayProps) {
  const { phase, width, height, est_seconds, iter, total_iters } = state;
  // Field name on the wire is `started_at` (snake_case from Python),
  // mirrored 1:1 in AiCompileState. Local alias for readability.
  const startedAt = state.started_at;
  const estSec = est_seconds ?? 150;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const elapsed = Math.max(0, (now - startedAt) / 1000);
  const pct = Math.min(0.99, elapsed / Math.max(1, estSec));
  const remaining = Math.max(0, Math.ceil(estSec - elapsed));
  const showSize = phase === "warming_up" && width && height;

  return (
    <div className="vp-compile-overlay">
      <div className="vp-compile-overlay__title">{BOOT_PHASE_TITLE[phase]}</div>
      {showSize && (
        <div className="vp-compile-overlay__size">
          {width}×{height}
        </div>
      )}
      <div className="vp-compile-overlay__bar">
        <div
          className="vp-compile-overlay__bar-fill"
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <div className="vp-compile-overlay__meta">
        {Math.round(elapsed)}s elapsed · ~{remaining}s left
      </div>
      {phase === "warming_up" && iter && total_iters && (
        <div className="vp-compile-overlay__meta">
          step {iter} of {total_iters}
        </div>
      )}
    </div>
  );
}
