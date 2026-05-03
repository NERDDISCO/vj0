"use client";

import { useEffect, useState } from "react";
import {
  RECORDING_RESOLUTIONS,
  type RecordingResolution,
} from "@/src/lib/stores/ai-settings-store";

interface RecordingChipProps {
  isRecording: boolean;
  isFinalizing: boolean;
  supported: boolean;
  resolution: RecordingResolution;
  onResolutionChange: (r: RecordingResolution) => void;
  onStart: () => void;
  onStop: () => void;
  getElapsedMs: () => number;
}

/**
 * RecordingChip — slimmer port of legacy RecordingControl that lives
 * in the system bar between the AI chip and the drawer toggles. Same
 * three states as legacy (idle / recording / finalizing) plus an
 * inline resolution picker since recording is a session-output action,
 * not a per-cue control.
 *
 * 4 Hz tick force-render while recording so the elapsed timer below
 * picks up fresh values from the engine without the engine having to
 * push to React state every tick.
 */
export function RecordingChip({
  isRecording,
  isFinalizing,
  supported,
  resolution,
  onResolutionChange,
  onStart,
  onStop,
  getElapsedMs,
}: RecordingChipProps) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!isRecording) return;
    const id = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, [isRecording]);

  if (!supported) {
    return (
      <button
        type="button"
        disabled
        className="vj-btn vj-btn--bar"
        title="Recording requires MediaRecorder + a supported MIME type — your browser doesn't expose either."
      >
        ● rec n/a
      </button>
    );
  }

  if (isRecording) {
    return (
      <div className="vp-rec-chip vp-rec-chip--live">
        <button
          type="button"
          onClick={onStop}
          className="vp-rec-chip__btn vp-rec-chip__btn--stop"
          title="Stop and download"
        >
          <span className="vp-rec-chip__dot" />
          <span className="vp-rec-chip__time">
            {formatElapsed(getElapsedMs())}
          </span>
          <span>■ stop</span>
        </button>
      </div>
    );
  }

  if (isFinalizing) {
    return (
      <button type="button" disabled className="vj-btn vj-btn--bar">
        ⏳ saving…
      </button>
    );
  }

  return (
    <div className="vp-rec-chip">
      <button
        type="button"
        onClick={onStart}
        className="vp-rec-chip__btn"
        title="Record output canvas + audio to file"
      >
        ● rec
      </button>
      <select
        className="vp-rec-chip__res"
        value={resolution}
        onChange={(e) =>
          onResolutionChange(e.target.value as RecordingResolution)
        }
        title="Recording resolution"
      >
        {RECORDING_RESOLUTIONS.map((r) => (
          <option key={r.id} value={r.id}>
            {r.shortLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

function formatElapsed(ms: number): string {
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const p = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${p(h)}:${p(m)}:${p(s)}`;
  return `${p(m)}:${p(s)}`;
}
