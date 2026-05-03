"use client";

import { useEffect } from "react";
import { useUiStore, useSceneStore, usePresetStore } from "@/src/lib/composer";
import type { AiTransportStatus } from "@/src/lib/ai/transport";
import type { AiBackend } from "@/src/lib/stores/ai-settings-store";

interface SystemBarProps {
  audioStatus: "idle" | "starting" | "running" | "error";
  audioDeviceLabel: string;
  audioDevices: Array<{ deviceId: string; label: string }>;
  selectedDeviceId: string;
  onDeviceChange: (id: string) => void;
  // ─── AI transport controls — same surface as legacy /vj SystemsBar.
  aiStatus: AiTransportStatus;
  aiBackend: AiBackend;
  onAiBackendChange: (b: AiBackend) => void;
  onAiConnect: () => void;
  onAiDisconnect: () => void;
  /** Live receive FPS while connected, null otherwise. */
  aiFps: number | null;
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
  onAiConnect,
  onAiDisconnect,
  aiFps,
}: SystemBarProps) {
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

      {/* AI chip — backend select + connect/disconnect button + fps readout.
          Same affordances as the legacy /vj SystemsBar so the user has the
          same connection workflow they're already trained on. */}
      <div
        className="vj-chip"
        title={`AI ${aiStatus}${aiFps != null ? ` · ${aiFps.toFixed(1)} fps` : ""}`}
      >
        <span
          className="vj-dot"
          style={{ color: aiStatusColor(aiStatus) }}
        />
        <span className="vj-chip__label">ai</span>
        <select
          className="vj-chip__select"
          value={aiBackend}
          onChange={(e) => onAiBackendChange(e.target.value as AiBackend)}
        >
          <option value="klein">klein</option>
          <option value="sdturbo">sdturbo</option>
          <option value="zimage">zimage</option>
          <option value="pod">pod</option>
        </select>
        {aiStatus === "connected" || aiStatus === "connecting" ? (
          <button
            type="button"
            onClick={onAiDisconnect}
            className="vj-chip__icon"
            title="Disconnect"
            style={{ color: "var(--vj-error)" }}
          >
            ■
          </button>
        ) : (
          <button
            type="button"
            onClick={onAiConnect}
            className="vj-chip__icon"
            title="Connect"
            style={{ color: "var(--vj-live)" }}
          >
            ▶
          </button>
        )}
        {aiFps != null && (
          <span className="vj-chip__value">{aiFps.toFixed(0)}fps</span>
        )}
      </div>

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
