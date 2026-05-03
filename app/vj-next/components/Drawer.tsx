"use client";

import { useEffect } from "react";
import { useUiStore, type DrawerMode } from "@/src/lib/composer";
import { AudioPresetGrid } from "./AudioPresetGrid";
import { SceneLibrary } from "./SceneLibrary";
import { LightingMode } from "./LightingMode";
import type { AudioFeatures } from "@/src/lib/audio-features";
import type { AudioEngine } from "@/src/lib/audio-engine";

interface DrawerProps {
  audioFeaturesRef: React.MutableRefObject<AudioFeatures | null>;
  startedAt: number;
  /** Source canvas the lighting engine samples from. Same canvas the
   *  AI send loop reads — keeps lighting and AI in sync visually. */
  inputCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  audioEngineRef: React.MutableRefObject<AudioEngine | null>;
}

/**
 * Drawer — the global floating panel.
 *
 * The user wrote:
 *
 *   > Maybe use the same container we use for lightning because I think
 *   > having this floating thing that just comes in when we need it makes
 *   > sense. We should use this as a global component and show different
 *   > things based on whatever we are on the page right now.
 *
 * So one drawer, three modes (presets / scenes / lighting). Mode switcher
 * pill row in the header so a VJ can hop between contexts without closing
 * the drawer. Lighting mode is intentionally a stub here — the existing
 * /vj DMX panel is fully featured and large; wiring it in would take this
 * design away from "demonstrate the new pattern" into "rebuild lighting".
 * The slot is real, the pattern is enforced.
 */
export function Drawer({
  audioFeaturesRef,
  startedAt,
  inputCanvasRef,
  audioEngineRef,
}: DrawerProps) {
  const open = useUiStore((s) => s.drawerOpen);
  const mode = useUiStore((s) => s.drawerMode);
  const setOpen = useUiStore((s) => s.setDrawerOpen);
  const setMode = useUiStore((s) => s.setDrawerMode);

  // Esc closes the drawer (matches the existing DMX drawer behavior).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) {
        // Don't grab esc if a modal/popover already has it (palette, bind…).
        // Those handlers run first because we attach in capture phase only
        // when needed. Simpler: only close if the active element isn't
        // inside one of those containers.
        const active = document.activeElement;
        if (active && active.closest(".vp-bind-popover, .vp-cmd, .vp-quickadd")) {
          return;
        }
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <aside
      className={`vp-drawer ${open ? "" : "vp-drawer--closed"}`}
      aria-hidden={!open}
      aria-label="patch studio drawer"
    >
      <div className="vp-drawer__head">
        <span className="vp-drawer__title">
          {modeTitle(mode)}
          <small>{modeSubtitle(mode)}</small>
        </span>
        <div className="vp-drawer__modes" role="tablist">
          <ModePill mode="presets" current={mode} onChange={setMode}>
            audio presets
          </ModePill>
          <ModePill mode="scenes" current={mode} onChange={setMode}>
            scene library
          </ModePill>
          <ModePill mode="lighting" current={mode} onChange={setMode}>
            lighting
          </ModePill>
        </div>
        <button
          type="button"
          className="vp-drawer__close"
          onClick={() => setOpen(false)}
          title="Close (Esc)"
        >
          ×
        </button>
      </div>

      <div className="vp-drawer__body">
        {mode === "presets" && (
          <AudioPresetGrid
            audioFeaturesRef={audioFeaturesRef}
            startedAt={startedAt}
          />
        )}
        {mode === "scenes" && <SceneLibrary />}
        {mode === "lighting" && (
          <LightingMode
            sourceCanvasRef={inputCanvasRef}
            audioEngineRef={audioEngineRef}
          />
        )}
      </div>
    </aside>
  );
}

function ModePill({
  mode,
  current,
  onChange,
  children,
}: {
  mode: DrawerMode;
  current: DrawerMode;
  onChange: (m: DrawerMode) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="vp-drawer__mode"
      aria-pressed={current === mode}
      onClick={() => onChange(mode)}
    >
      {children}
    </button>
  );
}

function modeTitle(mode: DrawerMode): string {
  return mode === "presets"
    ? "audio presets"
    : mode === "scenes"
      ? "scene library"
      : "lighting";
}

function modeSubtitle(mode: DrawerMode): string {
  return mode === "presets"
    ? "global · cross-scene · formula-driven"
    : mode === "scenes"
      ? "manage compositions"
      : "DMX fixtures · fog · cues";
}

