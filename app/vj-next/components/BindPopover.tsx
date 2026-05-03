"use client";

import { useEffect, useRef, useState } from "react";
import {
  groupPresetsByFeature,
  usePresetStore,
  useUiStore,
  AUDIO_FEATURE_KEYS,
  type AudioFeatureKey,
} from "@/src/lib/composer";

interface BindPopoverProps {
  /** Currently bound preset id, if any. */
  currentPresetId: string | null;
  onPick: (presetId: string | null) => void;
  onClose: () => void;
}

/**
 * Popover that lists all audio presets grouped by primary feature, plus a
 * "+ new preset" button that opens the drawer in presets mode focused on
 * formula creation. The "× unbind" option lives at the bottom in muted ink.
 *
 * Closes on outside-click + Escape — same affordance as the global drawer.
 */
export function BindPopover({
  currentPresetId,
  onPick,
  onClose,
}: BindPopoverProps) {
  const presets = usePresetStore((s) => s.presets);
  const setEditing = usePresetStore((s) => s.setEditing);
  const addPreset = usePresetStore((s) => s.addPreset);
  const openDrawer = useUiStore((s) => s.openDrawer);
  const ref = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<AudioFeatureKey | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    // Defer so the click that opened us doesn't immediately close.
    const id = window.setTimeout(() => {
      window.addEventListener("mousedown", onClick);
    }, 0);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const grouped = groupPresetsByFeature(presets);

  return (
    <div className="vp-bind-popover" ref={ref}>
      <div className="vp-bind-popover__title">bind audio preset</div>

      {/* Feature filter pills — lets users narrow the list by which audio
          feature they want to drive this property. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          marginBottom: 8,
        }}
      >
        <button
          type="button"
          className="vj-chip"
          aria-pressed={filter === null}
          onClick={() => setFilter(null)}
          style={{
            padding: "0 0.5rem",
            height: "1.4rem",
            fontSize: "0.6rem",
            cursor: "pointer",
          }}
        >
          <span className="vj-chip__label">all</span>
        </button>
        {AUDIO_FEATURE_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className="vj-chip"
            aria-pressed={filter === k}
            onClick={() => setFilter(k)}
            style={{
              padding: "0 0.5rem",
              height: "1.4rem",
              fontSize: "0.6rem",
              cursor: "pointer",
              borderColor:
                filter === k ? "var(--vp-cable-a)" : undefined,
            }}
          >
            <span className="vj-chip__label">{k}</span>
          </button>
        ))}
      </div>

      <div className="vp-bind-popover__list">
        {(filter ? [filter] : (Object.keys(grouped) as AudioFeatureKey[])).map((feat) => {
          const list = grouped[feat] ?? [];
          if (list.length === 0) return null;
          return (
            <div key={feat}>
              {!filter && (
                <div
                  style={{
                    fontSize: "0.55rem",
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "var(--vj-ink-dim)",
                    padding: "0.4rem 0.2rem 0.2rem",
                  }}
                >
                  {feat}
                </div>
              )}
              {list.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="vp-bind-popover__item"
                  onClick={() => {
                    onPick(p.id);
                    onClose();
                  }}
                  style={
                    p.id === currentPresetId
                      ? { borderColor: "var(--vp-cable-b)" }
                      : undefined
                  }
                >
                  <span>{p.name}</span>
                  <span className="vp-bind-popover__feature">{p.primary}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="vp-bind-popover__new"
        onClick={() => {
          const id = addPreset({ name: "New preset", primary: "rms", formula: "rms" });
          setEditing(id);
          openDrawer("presets");
          onClose();
        }}
      >
        + create new preset
      </button>

      {currentPresetId && (
        <button
          type="button"
          className="vp-bind-popover__none"
          onClick={() => {
            onPick(null);
            onClose();
          }}
        >
          × unbind
        </button>
      )}
    </div>
  );
}
