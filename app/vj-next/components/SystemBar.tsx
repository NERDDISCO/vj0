"use client";

import { useEffect, useRef, useState } from "react";
import { useUiStore, useSceneStore, usePresetStore } from "@/src/lib/composer";
import type { AiTransportStatus } from "@/src/lib/ai/transport";
import type { AiBackend } from "@/src/lib/stores/ai-settings-store";
import { AiPopover } from "./AiPopover";

interface SystemBarProps {
  audioStatus: "idle" | "starting" | "running" | "error";
  audioDeviceLabel: string;
  audioDevices: Array<{ deviceId: string; label: string }>;
  selectedDeviceId: string;
  onDeviceChange: (id: string) => void;
  // ─── AI transport controls
  aiStatus: AiTransportStatus;
  aiBackend: AiBackend;
  onAiBackendChange: (b: AiBackend) => void;
  /** Selected dynamic-pod signaling URL (when backend === "pod"). */
  aiPodUrl: string;
  onAiPodSelect: (signalingUrl: string) => void;
  onAiConnect: () => void;
  onAiDisconnect: () => void;
  /** Live receive FPS while connected, null otherwise. */
  aiFps: number | null;
  /** Round-trip generation latency in ms while connected. */
  aiLatencyMs: number | null;
  /** Pending in-flight frames (dispatcher backlog). */
  aiPending: number | null;
}

/**
 * SystemBar — top of the workspace.
 *
 * Slim bar with the four "where am I plugged in" affordances on the left
 * (audio status, audio device picker, drawer toggles for presets / scenes /
 * lighting), and a tiny live composition counter on the right (scene count,
 * preset count, element count in the active scene). Reads as a status rack,
 * not a hero element — the workspace itself is the hero.
 */
export function SystemBar({
  audioStatus,
  audioDeviceLabel,
  audioDevices,
  selectedDeviceId,
  onDeviceChange,
  aiStatus,
  aiBackend,
  onAiBackendChange,
  aiPodUrl,
  onAiPodSelect,
  onAiConnect,
  onAiDisconnect,
  aiFps,
  aiLatencyMs,
  aiPending,
}: SystemBarProps) {
  // AI chip toggles a floating popover anchored to itself.
  const aiChipRef = useRef<HTMLButtonElement>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const openDrawer = useUiStore((s) => s.openDrawer);
  const drawerMode = useUiStore((s) => s.drawerMode);
  const drawerOpen = useUiStore((s) => s.drawerOpen);
  const togglePalette = useUiStore((s) => s.togglePalette);
  const sceneCount = useSceneStore((s) => s.scenes.length);
  const elementCount = useSceneStore(
    (s) => s.scenes.find((sc) => sc.id === s.activeSceneId)?.elements.length ?? 0,
  );
  const presetCount = usePresetStore((s) => s.presets.length);

  // Keyboard shortcut: P = presets, S = scenes, L = lighting (when not in input)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (e.key.toLowerCase() === "p" && !e.metaKey && !e.ctrlKey) openDrawer("presets");
      if (e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey) openDrawer("scenes");
      if (e.key.toLowerCase() === "l" && !e.metaKey && !e.ctrlKey) openDrawer("lighting");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDrawer]);

  const statusColor =
    audioStatus === "running"
      ? "var(--vj-live)"
      : audioStatus === "error"
        ? "var(--vj-error)"
        : audioStatus === "starting"
          ? "var(--vj-info)"
          : "var(--vj-ink-dim)";

  function aiStatusColor(s: AiTransportStatus): string {
    return s === "connected"
      ? "var(--vj-live)"
      : s === "connecting"
        ? "var(--vj-info)"
        : s === "error"
          ? "var(--vj-error)"
          : "var(--vj-ink-dim)";
  }

  return (
    <div
      className="vp-rail"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.6rem",
        padding: "0.55rem 1rem",
      }}
    >
      <span
        className="vp-display"
        style={{
          fontSize: "1rem",
          color: "var(--vp-cable-a)",
          letterSpacing: "0.22em",
          textShadow: "0 0 14px var(--vp-cable-a)",
        }}
      >
        VJ0
      </span>
      <span
        style={{
          fontSize: "0.58rem",
          letterSpacing: "0.3em",
          color: "var(--vj-ink-dim)",
          textTransform: "uppercase",
        }}
      >
        / patch studio
      </span>

      <span
        style={{
          height: "1rem",
          width: 1,
          background: "var(--vp-edge-hot)",
          margin: "0 0.4rem",
        }}
      />

      {/* Audio chip */}
      <div className="vj-chip" title={`Audio · ${audioStatus}`}>
        <span
          className="vj-dot"
          style={{ color: statusColor }}
        />
        <span className="vj-chip__label">audio</span>
        <select
          className="vj-chip__select"
          value={selectedDeviceId}
          onChange={(e) => onDeviceChange(e.target.value)}
          style={{ maxWidth: 200 }}
        >
          {audioDevices.length === 0 ? (
            <option value="">{audioDeviceLabel || "no input"}</option>
          ) : (
            audioDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label.slice(0, 28)}
              </option>
            ))
          )}
        </select>
      </div>

      {/* AI chip — clickable, opens the AiPopover with backend picker,
          live pod switcher, connect/disconnect, and live transport stats.
          The chip itself shows status dot + current backend + (when
          connected) a live FPS readout, so a stage tech glancing at
          the bar gets the answers they need without opening anything. */}
      <button
        type="button"
        ref={aiChipRef}
        className="vp-ai-chip"
        aria-expanded={aiOpen}
        onClick={() => setAiOpen((o) => !o)}
        title={`AI · ${aiStatus}${aiFps != null ? ` · ${aiFps.toFixed(1)} fps` : ""}`}
      >
        <span className="vj-dot" style={{ color: aiStatusColor(aiStatus) }} />
        <span className="vp-ai-chip__label">ai</span>
        <span className="vp-ai-chip__backend">{aiBackend}</span>
        {aiFps != null && (
          <span className="vp-ai-chip__fps">{aiFps.toFixed(0)}fps</span>
        )}
        <svg
          className="vp-ai-chip__chev"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden
        >
          <path d="M2 4l3 3 3-3" />
        </svg>
      </button>
      {aiOpen && (
        <AiPopover
          anchorRef={aiChipRef}
          onClose={() => setAiOpen(false)}
          backend={aiBackend}
          onBackendChange={onAiBackendChange}
          selectedPodUrl={aiPodUrl}
          onSelectPod={onAiPodSelect}
          status={aiStatus}
          onConnect={onAiConnect}
          onDisconnect={onAiDisconnect}
          fps={aiFps}
          latencyMs={aiLatencyMs}
          pending={aiPending}
        />
      )}

      <span
        style={{
          height: "1rem",
          width: 1,
          background: "var(--vp-edge-hot)",
          margin: "0 0.4rem",
        }}
      />

      {/* Drawer mode toggles */}
      <button
        type="button"
        className="vj-btn vj-btn--bar"
        onClick={() => openDrawer("presets")}
        style={
          drawerOpen && drawerMode === "presets"
            ? { borderColor: "var(--vp-cable-b)", color: "var(--vp-cable-b)" }
            : undefined
        }
      >
        ◊ presets <span style={{ opacity: 0.5, marginLeft: 4 }}>{presetCount}</span>
      </button>
      <button
        type="button"
        className="vj-btn vj-btn--bar"
        onClick={() => openDrawer("scenes")}
        style={
          drawerOpen && drawerMode === "scenes"
            ? { borderColor: "var(--vp-cable-b)", color: "var(--vp-cable-b)" }
            : undefined
        }
      >
        ▥ scenes <span style={{ opacity: 0.5, marginLeft: 4 }}>{sceneCount}</span>
      </button>
      <button
        type="button"
        className="vj-btn vj-btn--bar"
        onClick={() => openDrawer("lighting")}
        style={
          drawerOpen && drawerMode === "lighting"
            ? { borderColor: "var(--vp-cable-b)", color: "var(--vp-cable-b)" }
            : undefined
        }
      >
        ✷ lighting
      </button>

      <span style={{ flex: 1 }} />

      {/* Active scene element count — a live tap on what's loaded */}
      <span
        className="vp-display"
        style={{
          fontSize: "0.7rem",
          color: "var(--vp-cable-b)",
          letterSpacing: "0.18em",
          textShadow: "0 0 10px color-mix(in srgb, var(--vp-cable-b) 50%, transparent)",
        }}
      >
        {elementCount.toString().padStart(2, "0")} elements
      </span>

      <button
        type="button"
        className="vp-cmdk"
        onClick={togglePalette}
        style={{ marginRight: 0 }}
      >
        find
        <kbd>⌘K</kbd>
      </button>
    </div>
  );
}
