"use client";

import { useEffect, useState } from "react";
import type { AudioFeatures } from "@/src/lib/audio-features";
import { shortenFeatures, AUDIO_FEATURE_KEYS } from "@/src/lib/composer";

interface AudioMetersProps {
  audioFeaturesRef: React.MutableRefObject<AudioFeatures | null>;
}

/**
 * AudioMeters — strip of live mini meters for each audio feature.
 *
 * Sits between the system bar and the workspace. The point isn't precision
 * — it's "VJ glances down, sees rms is moving and bright is high, knows
 * their bound presets will be reading sensible values".
 *
 * Throttled to 12 fps via setInterval — we don't need 60 Hz on a peripheral
 * indicator strip and it keeps React re-renders cheap.
 */
export function AudioMeters({ audioFeaturesRef }: AudioMetersProps) {
  const [snapshot, setSnapshot] = useState<Record<string, number>>({});

  useEffect(() => {
    const id = window.setInterval(() => {
      setSnapshot(shortenFeatures(audioFeaturesRef.current));
    }, 1000 / 12);
    return () => window.clearInterval(id);
  }, [audioFeaturesRef]);

  return (
    <div className="vp-meters">
      {AUDIO_FEATURE_KEYS.map((key) => {
        const value = snapshot[key] ?? 0;
        return (
          <span key={key} className="vp-meter">
            <span style={{ minWidth: "2.4rem", textAlign: "right" }}>{key}</span>
            <span className="vp-meter__bar">
              <span
                className="vp-meter__fill"
                style={{
                  width: `${Math.min(100, value * 100)}%`,
                  background: value > 0.7 ? "var(--vp-cable-b)" : "var(--vp-cable-a)",
                  boxShadow:
                    value > 0.7
                      ? "0 0 8px var(--vp-cable-b)"
                      : "0 0 6px var(--vp-cable-a)",
                }}
              />
            </span>
            <span
              className="vp-meter__num"
              style={{
                color: value > 0.7 ? "var(--vp-cable-b)" : "var(--vp-cable-a)",
              }}
            >
              {value.toFixed(2)}
            </span>
          </span>
        );
      })}
    </div>
  );
}
