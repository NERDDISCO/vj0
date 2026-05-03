"use client";

import { useEffect, useMemo, useState } from "react";
import {
  NUMERIC_PROPERTY_KEYS,
  PROPERTY_META,
  buildPresetMap,
  resolveElementProperties,
  selectActiveScene,
  selectSelectedElement,
  useSceneStore,
  usePresetStore,
  type Element,
  type ElementProperties,
  type PropertyKey,
} from "@/src/lib/composer";
import type { AudioFeatures } from "@/src/lib/audio-features";
import { BindPopover } from "./BindPopover";

interface ElementInspectorProps {
  audioFeaturesRef: React.MutableRefObject<AudioFeatures | null>;
  startedAt: number;
}

/**
 * ElementInspector — the property+binding editor for the selected element.
 * Sits below the input canvas in the left column. Empty state surfaces a
 * list of all elements in the active scene so the user can re-select after
 * clicking off; this also doubles as the "z-order" affordance.
 *
 * Each numeric property gets:
 *   1. A slider/number input (the *base* value)
 *   2. A live readout (the *resolved* value, post-binding)
 *   3. A bind chip — pressing it opens the BindPopover.
 *
 * Color/text are special — non-numeric, no audio binding (yet).
 */
export function ElementInspector({
  audioFeaturesRef,
  startedAt,
}: ElementInspectorProps) {
  const scene = useSceneStore(selectActiveScene);
  const selected = useSceneStore(selectSelectedElement);
  const presets = usePresetStore((s) => s.presets);
  const updateProp = useSceneStore((s) => s.updateElementProp);
  const bindProperty = useSceneStore((s) => s.bindElementProperty);
  const removeElement = useSceneStore((s) => s.removeElement);
  const renameElement = useSceneStore((s) => s.renameElement);
  const selectElement = useSceneStore((s) => s.selectElement);
  const bringForward = useSceneStore((s) => s.bringForward);
  const presetMap = useMemo(() => buildPresetMap(presets), [presets]);

  const [bindingKey, setBindingKey] = useState<PropertyKey | null>(null);

  // 30 Hz audio+time snapshot — read in render to keep components pure
  // (no ref dereferences, no impure performance.now() calls in render).
  // Mutating React state from a setInterval is the supported way to bring
  // wall-clock data into React's render path.
  const [tick, setTick] = useState<{ t: number; features: AudioFeatures | null }>({
    t: 0,
    features: null,
  });
  useEffect(() => {
    const id = window.setInterval(() => {
      setTick({
        t: (performance.now() - startedAt) / 1000,
        features: audioFeaturesRef.current,
      });
    }, 1000 / 30);
    return () => window.clearInterval(id);
  }, [audioFeaturesRef, startedAt]);

  if (!scene) {
    return (
      <div className="vp-card">
        <div className="vp-card__head">
          <span className="vp-card__title">inspector</span>
        </div>
        <div style={{ color: "var(--vj-ink-dim)", fontSize: "0.7rem" }}>
          no scene loaded
        </div>
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="vp-card">
        <div className="vp-card__head">
          <span className="vp-card__title">scene · {scene.elements.length} elements</span>
          <span className="vp-card__sub">double-click canvas to add</span>
        </div>
        {scene.elements.length === 0 ? (
          <div
            style={{
              padding: "1.4rem 0",
              fontSize: "0.7rem",
              color: "var(--vj-ink-dim)",
              textAlign: "center",
              letterSpacing: "0.04em",
            }}
          >
            empty scene — start by double-clicking anywhere on the input canvas
          </div>
        ) : (
          <div className="vp-element-list">
            {scene.elements.map((el) => (
              // Use a div with role=button to host the click target so the
              // inner delete <button> isn't nested inside another <button>
              // (HTML doesn't allow that → React hydration error).
              <div
                key={el.id}
                role="button"
                tabIndex={0}
                className="vp-element-pill"
                onClick={() => selectElement(el.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectElement(el.id);
                  }
                }}
              >
                <ElementGlyph kind={el.kind} />
                <span>{el.name}</span>
                <button
                  type="button"
                  className="vp-element-pill__rm"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeElement(el.id);
                  }}
                  title="Delete"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Resolved values for the currently-selected element so we can show the
  // live "post-binding" readout next to each slider. Uses the 30 Hz tick
  // snapshot so render stays pure.
  const resolved = resolveElementProperties(
    selected,
    tick.features,
    presetMap,
    tick.t,
  );

  return (
    <div className="vp-card">
      <div className="vp-card__head">
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem" }}>
          <ElementGlyph kind={selected.kind} />
          <input
            value={selected.name}
            onChange={(e) =>
              renameElement(selected.id, e.target.value.slice(0, 40))
            }
            style={{
              fontFamily: "var(--font-doto), monospace",
              fontWeight: 800,
              fontSize: "0.85rem",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--vj-ink)",
              background: "transparent",
              border: 0,
              outline: 0,
              padding: 0,
              minWidth: 0,
            }}
          />
        </div>
        <div style={{ display: "inline-flex", gap: "0.3rem", alignItems: "center" }}>
          <button
            type="button"
            className="vj-icon-btn"
            title="Bring forward"
            onClick={() => bringForward(selected.id)}
          >
            ▲
          </button>
          <button
            type="button"
            className="vj-icon-btn"
            title="Delete element"
            onClick={() => removeElement(selected.id)}
          >
            ×
          </button>
        </div>
      </div>

      {/* Numeric properties */}
      {NUMERIC_PROPERTY_KEYS.map((key) => {
        const meta = PROPERTY_META[key];
        const baseValue = selected.props[key];
        const resolvedValue = resolved[key];
        const binding = selected.bindings[key];
        const fillPct = ((baseValue - meta.min) / (meta.max - meta.min)) * 100;
        return (
          <div key={key} className="vp-prop" data-bound={binding ? "true" : undefined}>
            <span className="vp-prop__label">
              {binding && <span className="vp-prop__cable" />}
              {meta.label}
            </span>
            <div className="vp-prop__control">
              <div className="vp-num">
                <input
                  type="range"
                  min={meta.min}
                  max={meta.max}
                  step={meta.step}
                  value={baseValue}
                  onChange={(e) =>
                    updateProp(selected.id, key, Number(e.target.value))
                  }
                  style={
                    {
                      ["--vp-num-fill" as string]: `${fillPct}%`,
                    } as React.CSSProperties
                  }
                />
              </div>
              <span className="vp-prop__readout">
                {formatPropValue(resolvedValue)}
              </span>
            </div>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="vp-prop__bind"
                onClick={() => setBindingKey(bindingKey === key ? null : key)}
              >
                {binding
                  ? presetMap.get(binding.presetId)?.name ?? "unknown"
                  : "+ bind"}
              </button>
              {bindingKey === key && (
                <BindPopover
                  currentPresetId={binding?.presetId ?? null}
                  onPick={(presetId) => {
                    if (presetId === null) {
                      bindProperty(selected.id, key, null);
                    } else {
                      bindProperty(selected.id, key, {
                        presetId,
                        mode: "set",
                      });
                    }
                  }}
                  onClose={() => setBindingKey(null)}
                />
              )}
            </div>
          </div>
        );
      })}

      {/* Color row — special-cased, no audio binding */}
      <div className="vp-prop">
        <span className="vp-prop__label">color</span>
        <div className="vp-prop__control">
          <label className="vp-swatch">
            <input
              type="color"
              value={selected.props.color}
              onChange={(e) => updateProp(selected.id, "color", e.target.value)}
            />
          </label>
          <span
            className="vp-prop__readout"
            style={{ color: selected.props.color }}
          >
            {selected.props.color.toUpperCase()}
          </span>
        </div>
        <span style={{ width: "1.55rem" }} />
      </div>

      {/* Text-only row for text element kind */}
      {selected.kind === "text" && (
        <div className="vp-prop">
          <span className="vp-prop__label">text</span>
          <div className="vp-prop__control">
            <input
              type="text"
              value={selected.props.text}
              onChange={(e) =>
                updateProp(selected.id, "text", e.target.value.slice(0, 32))
              }
              style={{
                flex: 1,
                background: "var(--vp-void)",
                border: "1px solid var(--vp-edge-hot)",
                color: "var(--vj-ink)",
                padding: "0.4rem 0.55rem",
                fontFamily: "var(--font-doto), monospace",
                fontSize: "0.8rem",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                borderRadius: 4,
                outline: 0,
              }}
            />
          </div>
          <span style={{ width: "1.55rem" }} />
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatPropValue(v: number): string {
  if (Math.abs(v) >= 10) return v.toFixed(1);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

function ElementGlyph({ kind }: { kind: Element["kind"] }) {
  const icon = {
    circle: <circle cx="9" cy="9" r="6.5" />,
    ring: (
      <>
        <circle cx="9" cy="9" r="6.5" />
        <circle cx="9" cy="9" r="3" />
      </>
    ),
    rectangle: <rect x="2.5" y="4.5" width="13" height="9" rx="0.5" />,
    triangle: <path d="M9 2.5 16 15.5H2z" />,
    line: <path d="M2.5 13.5 15.5 4.5" />,
    text: <path d="M4 5.5V4.5h10v1M9 4.5v9M7 13.5h4" />,
    waveform: <path d="M1 9c1.5 0 1.5-4.5 3-4.5s1.5 9 3 9 1.5-7 3-7 1.5 4.5 3 4.5 1.5-2 3-2" />,
  }[kind];
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      style={{ color: "var(--vp-cable-a)", flexShrink: 0 }}
    >
      {icon}
    </svg>
  );
}

// (Re-export ElementProperties so consumers can grab the type from this
// module without reaching into the composer barrel.)
export type { ElementProperties };
