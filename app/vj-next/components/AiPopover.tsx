"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AiTransportStatus } from "@/src/lib/ai/transport";
import type { AiBackend } from "@/src/lib/stores/ai-settings-store";
import type { PodInfo } from "@/app/api/pods/route";
import {
  TelemetryPanel,
  type TelemetrySnapshot,
} from "@/app/vj/components/TelemetryPanel";

interface AiPopoverProps {
  /** Position the popover beneath this element (the AI chip in the bar). */
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;

  // ─── Backend selection
  backend: AiBackend;
  onBackendChange: (b: AiBackend) => void;

  // ─── Pod switcher (for the dynamic "pod" backend)
  selectedPodUrl: string;
  onSelectPod: (signalingUrl: string) => void;

  // ─── Connection
  status: AiTransportStatus;
  onConnect: () => void;
  onDisconnect: () => void;
  /** Persisted "auto-connect on app load + backend switch" setting. */
  autoConnect: boolean;
  onAutoConnectChange: (v: boolean) => void;
  /** Same-origin /telemetry URL — derived from the signaling URL.
   *  When set we poll once on open + every 2 s while open. */
  telemetryUrl: string | null;

  // ─── Live transport stats
  fps: number | null;
  /** Round-trip generation latency in ms, null while not connected. */
  latencyMs: number | null;
  /** Number of in-flight (pending) frames the dispatcher is holding. */
  pending: number | null;
}

/**
 * AiPopover — replaces the old in-bar dropdowns with a real surface.
 *
 * Layout:
 *   - HEADER: title + live status pill
 *   - SECTION 1: Backend select (klein/sdturbo/zimage/pod) + connect/
 *     disconnect button
 *   - SECTION 2: Live pod list (only meaningful when backend === "pod",
 *     but always shown so the user can one-click switch backend + pod)
 *   - SECTION 3: Live transport stats (fps · latency · pending)
 *
 * Anchored to the AI chip via fixed positioning; re-measures on
 * window scroll/resize. Outside-click + Escape close.
 */
export function AiPopover({
  anchorRef,
  onClose,
  backend,
  onBackendChange,
  selectedPodUrl,
  onSelectPod,
  status,
  onConnect,
  onDisconnect,
  autoConnect,
  onAutoConnectChange,
  telemetryUrl,
  fps,
  latencyMs,
  pending,
}: AiPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  // ─── Position relative to anchor ──────────────────────────────────
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    const measure = () => {
      const a = anchorRef.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      // Anchor under the chip's right edge so the popover hugs the
      // bar without straying off-screen on narrower windows. The
      // CSS clamps width to viewport - 16, so right-anchored layout
      // never overflows.
      const left = Math.max(8, r.right - 360);
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

  // ─── Outside-click + Escape close ─────────────────────────────────
  useEffect(() => {
    function onPointer(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      // Don't close if the user clicks the anchor — it owns its own toggle.
      if (anchorRef.current?.contains(t)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    // Defer mousedown registration so the click that opened the popover
    // doesn't immediately close it.
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

  // ─── Pod list ─────────────────────────────────────────────────────
  const [pods, setPods] = useState<PodInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ─── Pod telemetry (only polls while this popover is open + AI is
  // connected — cheap on demand, wasteful as a permanent background
  // poll because /telemetry exec()s nvidia-smi on the worker).
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [telemetryErr, setTelemetryErr] = useState<string | null>(null);
  const [telemetryLastTick, setTelemetryLastTick] = useState<number | null>(
    null,
  );
  useEffect(() => {
    if (!telemetryUrl || status !== "connected") {
      setTelemetry(null);
      setTelemetryErr(null);
      return;
    }
    let cancelled = false;
    setTelemetryLoading(true);
    const tick = async () => {
      try {
        const r = await fetch(telemetryUrl, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as TelemetrySnapshot;
        if (cancelled) return;
        setTelemetry(j);
        setTelemetryErr(null);
        setTelemetryLastTick(Date.now());
      } catch (e) {
        if (cancelled) return;
        setTelemetryErr(e instanceof Error ? e.message : "fetch failed");
      } finally {
        if (!cancelled) setTelemetryLoading(false);
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [telemetryUrl, status]);

  const fetchPods = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/pods", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPods((data.pods ?? []) as PodInfo[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPods();
  }, [fetchPods]);

  if (!pos) return null;

  const isConnected = status === "connected" || status === "connecting";
  const statusColor =
    status === "connected"
      ? "var(--vj-live)"
      : status === "connecting"
        ? "var(--vj-info)"
        : status === "error"
          ? "var(--vj-error)"
          : "var(--vj-ink-dim)";

  return (
    <div
      ref={ref}
      className="vp-ai-popover"
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label="AI transport"
    >
      <div className="vp-ai-popover__head">
        <span className="vp-ai-popover__title">ai · transport</span>
        <span className="vp-ai-popover__status">
          <span className="vj-dot" style={{ color: statusColor }} />
          {status}
        </span>
      </div>

      <div className="vp-ai-popover__body">
        {/* ── Backend picker + connect ─────────────────────────── */}
        <div className="vp-ai-popover__section">
          <div className="vp-ai-popover__section-title">backend</div>
          <div className="vp-ai-backends">
            {(["klein", "sdturbo", "zimage", "pod"] as AiBackend[]).map((b) => (
              <button
                key={b}
                type="button"
                className="vp-ai-backend"
                aria-pressed={backend === b}
                onClick={() => onBackendChange(b)}
              >
                {b}
              </button>
            ))}
          </div>
          <div className="vp-ai-connect">
            {isConnected ? (
              <button
                type="button"
                className="vp-ai-connect__danger"
                onClick={onDisconnect}
              >
                ■ disconnect
              </button>
            ) : (
              <button
                type="button"
                className="vp-ai-connect__primary"
                onClick={onConnect}
              >
                ▶ connect
              </button>
            )}
          </div>
          {/* Auto-connect toggle — persisted in useAiSettingsStore so
              flipping it on here re-enables the boot-time + backend-
              switch auto-connect identical to legacy /vj. */}
          <label className="vp-ai-autoconnect">
            <input
              type="checkbox"
              className="vj-check"
              checked={autoConnect}
              onChange={(e) => onAutoConnectChange(e.target.checked)}
            />
            <span>auto-connect on app load + backend switch</span>
          </label>
        </div>

        {/* ── Pod list ──────────────────────────────────────────── */}
        <div className="vp-ai-popover__section">
          <div className="vp-ai-popover__section-title">
            <span>live pods</span>
            <button
              type="button"
              onClick={fetchPods}
              disabled={loading}
            >
              {loading ? "loading…" : "↻ refresh"}
            </button>
          </div>
          {err && <div className="vp-pods__err">⚠ {err}</div>}
          {!err && loading && pods.length === 0 && (
            <div className="vp-pods__loading">scanning runpod…</div>
          )}
          {!err && !loading && pods.length === 0 && (
            <div className="vp-pods__empty">no running pods</div>
          )}
          {pods.length > 0 && (
            <div className="vp-pods">
              {pods.map((pod) => (
                <PodRow
                  key={pod.id}
                  pod={pod}
                  active={pod.signalingUrl === selectedPodUrl}
                  onClick={() => onSelectPod(pod.signalingUrl)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Live stats ────────────────────────────────────────── */}
        <div className="vp-ai-popover__section">
          <div className="vp-ai-popover__section-title">live</div>
          <div className="vp-ai-stats">
            <Stat
              label="fps"
              value={fps == null ? "—" : fps.toFixed(1)}
              live={fps != null && fps > 5}
            />
            <Stat
              label="latency"
              value={latencyMs == null ? "—" : `${Math.round(latencyMs)}ms`}
              live={latencyMs != null}
            />
            <Stat
              label="pending"
              value={pending == null ? "—" : `${pending}`}
              live={pending != null && pending > 0}
            />
          </div>
        </div>

        {/* ── Pod telemetry ─────────────────────────────────────── */}
        {/* Hardware diagnostics rack — GPU memory + util, CPU load,
            RAM, disk, network volume. Only renders when AI is
            connected (the worker IS the pod). Polls every 2 s while
            the popover is open. */}
        {status === "connected" && telemetryUrl && (
          <div className="vp-ai-popover__section">
            <TelemetryPanel
              snapshot={telemetry}
              loading={telemetryLoading}
              error={telemetryErr}
              lastTick={telemetryLastTick}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  live,
}: {
  label: string;
  value: string;
  live: boolean;
}) {
  return (
    <div className="vp-ai-stat">
      <span className="vp-ai-stat__label">{label}</span>
      <span
        className={`vp-ai-stat__value ${live ? "vp-ai-stat__value--live" : "vp-ai-stat__value--idle"}`}
      >
        {value}
      </span>
    </div>
  );
}

interface PodRowProps {
  pod: PodInfo;
  active: boolean;
  onClick: () => void;
}

const LOCATION_LABELS: Record<string, string> = {
  NO: "🇳🇴 NO",
  CA: "🇨🇦 CA",
  US: "🇺🇸 US",
  RO: "🇷🇴 RO",
  CZ: "🇨🇿 CZ",
  NL: "🇳🇱 NL",
  IS: "🇮🇸 IS",
  SE: "🇸🇪 SE",
  DE: "🇩🇪 DE",
  GB: "🇬🇧 GB",
  FR: "🇫🇷 FR",
};

function PodRow({ pod, active, onClick }: PodRowProps) {
  const dotKind = pod.inferenceReady
    ? "ready"
    : pod.readyCount > 0
      ? "booting"
      : "down";
  return (
    <button
      type="button"
      className="vp-pod"
      data-active={active ? "true" : undefined}
      onClick={onClick}
      title={pod.signalingUrl}
    >
      <span className={`vp-pod__dot vp-pod__dot--${dotKind}`} />
      <span className="vp-pod__main">
        <span className="vp-pod__name">{pod.name}</span>
        <span className="vp-pod__meta">
          <span>
            <b>{pod.gpuCount}×</b> {pod.gpuDisplayName}
          </span>
          <span>· {LOCATION_LABELS[pod.location] ?? pod.location}</span>
          <span>
            ·{" "}
            {pod.inferenceReady
              ? `✓ ${pod.readyCount}/${pod.workerCount}`
              : pod.readyCount > 0
                ? `⏳ ${pod.readyCount}/${pod.workerCount}`
                : "booting"}
          </span>
        </span>
      </span>
      <span className="vp-pod__cost">${pod.costPerHr.toFixed(2)}/h</span>
    </button>
  );
}
