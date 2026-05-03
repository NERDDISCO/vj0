"use client";

import { useEffect, useRef, useState } from "react";
import type { AudioFeatures } from "@/src/lib/audio-features";

/** Sentinel deviceId for the "system audio" entry — when the user picks
 *  it, the orchestrator triggers getDisplayMedia instead of getUserMedia.
 *  Mirrors the legacy /vj behavior for muscle-memory parity. */
export const SYSTEM_AUDIO_VALUE = "__system__";

export type AudioSource = "device" | "system";
export type AudioStatus = "idle" | "starting" | "running" | "error";

interface AudioPopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;

  /** Current high-level audio engine status. */
  status: AudioStatus;
  /** Human-readable label of the current input ("MacBook Pro Microphone"
   *  or "🖥 System audio"). */
  deviceLabel: string;
  /** All enumerated audio inputs from `mediaDevices.enumerateDevices()`. */
  devices: Array<{ deviceId: string; label: string }>;
  /** Currently selected deviceId (may be SYSTEM_AUDIO_VALUE). */
  selectedDeviceId: string;
  onDeviceChange: (id: string) => void;
  /** True when this browser supports getDisplayMedia (system audio). */
  systemAudioSupported: boolean;

  /** Live audio features for the inline RMS meter — purely visual,
   *  reassures the user that audio is actually flowing. */
  audioFeaturesRef: React.MutableRefObject<AudioFeatures | null>;

  /** Optional error message — surfaces at the top when audio failed
   *  to start (mic permission denied, share-screen with no audio, etc.) */
  errorMessage?: string | null;
}

/**
 * AudioPopover — the audio counterpart to AiPopover. Replaces the
 * cramped inline audio chip with a real surface that fits:
 *
 *   - SOURCE: pill row of [microphone | system audio] (when supported)
 *   - DEVICE: full enumerated input list (mic only — system audio uses
 *     the OS share-picker)
 *   - LIVE: live RMS bar so the user sees the audio is moving
 *
 * Anchored to the audio chip via fixed positioning; outside-click +
 * Escape close.
 */
export function AudioPopover({
  anchorRef,
  onClose,
  status,
  deviceLabel,
  devices,
  selectedDeviceId,
  onDeviceChange,
  systemAudioSupported,
  audioFeaturesRef,
  errorMessage,
}: AudioPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Position relative to anchor — same anchoring math as AiPopover so
  // both popovers feel like the same hardware family.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    const measure = () => {
      const a = anchorRef.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      const width = 340;
      // Anchor under the chip's left edge so the popover sits beneath
      // the system bar at a natural reading position. Clamp to viewport.
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.left));
      setPos({ top: r.bottom + 6, left });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [anchorRef]);

  // Outside-click + Escape close. Defer mousedown registration so the
  // click that opened us doesn't immediately close it.
  useEffect(() => {
    function onPointer(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    const id = window.setTimeout(() => {
      window.addEventListener("mousedown", onPointer);
    }, 0);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [anchorRef, onClose]);

  // 12 Hz live RMS readout for the meter — peripheral indicator,
  // doesn't need 60 Hz.
  const [rms, setRms] = useState(0);
  const [peak, setPeak] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      const f = audioFeaturesRef.current;
      setRms(f?.rms ?? 0);
      setPeak(f?.peak ?? 0);
    }, 1000 / 12);
    return () => window.clearInterval(id);
  }, [audioFeaturesRef]);

  if (!pos) return null;

  const statusColor =
    status === "running"
      ? "var(--vj-live)"
      : status === "starting"
        ? "var(--vj-info)"
        : status === "error"
          ? "var(--vj-error)"
          : "var(--vj-ink-dim)";
  const statusLabel =
    status === "running"
      ? "active"
      : status === "starting"
        ? "starting…"
        : status === "error"
          ? "error"
          : "idle";

  const isSystem = selectedDeviceId === SYSTEM_AUDIO_VALUE;

  return (
    <div
      ref={ref}
      className="vp-ai-popover"
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label="Audio input"
    >
      <div className="vp-ai-popover__head">
        <span className="vp-ai-popover__title">audio · input</span>
        <span className="vp-ai-popover__status">
          <span className="vj-dot" style={{ color: statusColor }} />
          {statusLabel}
        </span>
      </div>

      <div className="vp-ai-popover__body">
        {/* ── Error banner ──────────────────────────────────────── */}
        {errorMessage && (
          <div
            style={{
              padding: "0.55rem 0.85rem",
              fontSize: "0.66rem",
              color: "var(--vj-error)",
              background: "color-mix(in srgb, var(--vj-error) 10%, transparent)",
              borderBottom: "1px solid var(--vp-edge)",
              letterSpacing: "0.04em",
              lineHeight: 1.5,
            }}
          >
            ⚠ {errorMessage}
          </div>
        )}

        {/* ── Source picker (mic vs system) ──────────────────────── */}
        {systemAudioSupported && (
          <div className="vp-ai-popover__section">
            <div className="vp-ai-popover__section-title">source</div>
            <div className="vp-ai-backends" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <button
                type="button"
                className="vp-ai-backend"
                aria-pressed={!isSystem}
                onClick={() => {
                  // Switch back to the first non-system device, or the
                  // empty deviceId (browser default).
                  const first = devices[0]?.deviceId ?? "";
                  if (selectedDeviceId !== first) onDeviceChange(first);
                }}
              >
                🎙 microphone
              </button>
              <button
                type="button"
                className="vp-ai-backend"
                aria-pressed={isSystem}
                onClick={() => onDeviceChange(SYSTEM_AUDIO_VALUE)}
                title="Capture audio from a tab or your full screen"
              >
                🖥 system
              </button>
            </div>
          </div>
        )}

        {/* ── Device list ────────────────────────────────────────── */}
        {!isSystem && (
          <div className="vp-ai-popover__section">
            <div className="vp-ai-popover__section-title">
              <span>device</span>
              <span style={{ color: "var(--vj-ink-dim)", letterSpacing: "0.06em" }}>
                {devices.length} found
              </span>
            </div>
            {devices.length === 0 ? (
              <div className="vp-pods__empty">no input devices</div>
            ) : (
              <div className="vp-pods">
                {devices.map((d) => {
                  const active = d.deviceId === selectedDeviceId;
                  return (
                    <button
                      key={d.deviceId}
                      type="button"
                      className="vp-pod"
                      data-active={active ? "true" : undefined}
                      onClick={() => onDeviceChange(d.deviceId)}
                      title={d.label}
                    >
                      <span
                        className={`vp-pod__dot ${active ? "vp-pod__dot--ready" : ""}`}
                      />
                      <span className="vp-pod__main">
                        <span className="vp-pod__name">{d.label}</span>
                        <span className="vp-pod__meta">
                          <span>{d.deviceId === "" ? "browser default" : "input"}</span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {isSystem && (
          <div className="vp-ai-popover__section">
            <div className="vp-ai-popover__section-title">device</div>
            <div
              style={{
                padding: "0.7rem",
                background: "var(--vp-void)",
                border: "1px solid var(--vp-edge-hot)",
                borderRadius: 5,
                fontSize: "0.7rem",
                color: "var(--vj-ink)",
                lineHeight: 1.5,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-doto), monospace",
                  fontSize: "0.85rem",
                  letterSpacing: "0.16em",
                  color: "var(--vp-cable-a)",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                {deviceLabel || "🖥 System audio"}
              </div>
              <div style={{ fontSize: "0.62rem", color: "var(--vj-ink-dim)" }}>
                Picked via the browser&apos;s share-screen dialog. To change,
                stop sharing and pick a different tab/window.
              </div>
            </div>
          </div>
        )}

        {/* ── Live meter ────────────────────────────────────────── */}
        <div className="vp-ai-popover__section">
          <div className="vp-ai-popover__section-title">live</div>
          <div className="vp-ai-stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <Meter label="rms" value={rms} />
            <Meter label="peak" value={peak} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="vp-ai-stat">
      <span className="vp-ai-stat__label">{label}</span>
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: "color-mix(in srgb, var(--vp-edge) 70%, #000)",
          overflow: "hidden",
          margin: "2px 0 4px",
        }}
      >
        <div
          style={{
            width: `${Math.min(100, value * 100)}%`,
            height: "100%",
            background:
              value > 0.7
                ? "var(--vp-cable-b)"
                : "var(--vp-cable-a)",
            boxShadow:
              value > 0.7
                ? "0 0 8px var(--vp-cable-b)"
                : "0 0 6px var(--vp-cable-a)",
            transition: "width 80ms linear",
          }}
        />
      </div>
      <span
        className="vp-ai-stat__value"
        style={{
          fontSize: "0.7rem",
          color: value > 0.05 ? "var(--vp-cable-a)" : "var(--vj-muted)",
        }}
      >
        {value.toFixed(3)}
      </span>
    </div>
  );
}
