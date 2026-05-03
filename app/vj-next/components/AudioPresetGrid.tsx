"use client";

import { useEffect, useMemo, useState } from "react";
import {
  presetIsValid,
  shortenFeatures,
  usePresetStore,
  type AudioFeatureKey,
  type AudioPreset,
} from "@/src/lib/composer";
import type { AudioFeatures } from "@/src/lib/audio-features";
import { PresetVisualization } from "./PresetVisualization";
import { FormulaEditor } from "./FormulaEditor";

interface AudioPresetGridProps {
  audioFeaturesRef: React.MutableRefObject<AudioFeatures | null>;
  startedAt: number;
}

/**
 * AudioPresetGrid — the drawer's "presets" mode. A grid of preset cards on
 * the left, with the formula editor for the selected preset rendered to the
 * right (or expanded inline on narrow screens).
 *
 * Cards live-evaluate so a VJ can audition their library in real time —
 * the rolling history scope on each card animates against current audio.
 */
export function AudioPresetGrid({
  audioFeaturesRef,
  startedAt,
}: AudioPresetGridProps) {
  const presets = usePresetStore((s) => s.presets);
  const editingId = usePresetStore((s) => s.editingPresetId);
  const setEditing = usePresetStore((s) => s.setEditing);
  const addPreset = usePresetStore((s) => s.addPreset);
  const duplicatePreset = usePresetStore((s) => s.duplicatePreset);
  const removePreset = usePresetStore((s) => s.removePreset);

  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return presets;
    return presets.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.formula.toLowerCase().includes(q) ||
        p.primary.includes(q),
    );
  }, [presets, query]);

  // 30 Hz audio snapshot — read in render by PresetCard so cards stay
  // pure (no audioFeaturesRef.current reads inside child render).
  const [features, setFeatures] = useState<Record<AudioFeatureKey, number>>(
    () => shortenFeatures(null),
  );
  useEffect(() => {
    const id = window.setInterval(() => {
      setFeatures(shortenFeatures(audioFeaturesRef.current));
    }, 1000 / 30);
    return () => window.clearInterval(id);
  }, [audioFeaturesRef]);

  const editing = useMemo(
    () => presets.find((p) => p.id === editingId) ?? null,
    [editingId, presets],
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: editing ? "minmax(0, 1.2fr) minmax(380px, 0.8fr)" : "minmax(0, 1fr)",
        gap: "1rem",
        alignItems: "start",
      }}
    >
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            marginBottom: "0.85rem",
          }}
        >
          <input
            placeholder="search presets…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              background: "var(--vp-void)",
              border: "1px solid var(--vp-edge-hot)",
              color: "var(--vj-ink)",
              padding: "0.45rem 0.65rem",
              fontFamily: "inherit",
              fontSize: "0.78rem",
              borderRadius: 4,
              outline: 0,
            }}
          />
          <button
            type="button"
            className="vj-btn vj-btn--accent"
            onClick={() => addPreset()}
          >
            + new preset
          </button>
        </div>

        <div className="vp-presets">
          {filtered.map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              liveValue={features[preset.primary] ?? 0}
              isEditing={preset.id === editingId}
              onEdit={() => setEditing(preset.id)}
              onDuplicate={() => duplicatePreset(preset.id)}
              onDelete={() => removePreset(preset.id)}
            />
          ))}
          {filtered.length === 0 && (
            <div
              style={{
                gridColumn: "1 / -1",
                padding: "2.4rem 0",
                textAlign: "center",
                color: "var(--vj-ink-dim)",
                fontSize: "0.7rem",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              no presets match &ldquo;{query}&rdquo; — press <kbd>enter</kbd> to create one
            </div>
          )}
        </div>
      </div>

      {editing && (
        <FormulaEditor
          // key remounts the editor when the user picks a different
          // preset — fresh state initializers avoid a setState-in-effect
          // reset and keep React 19's strict lint happy.
          key={editing.id}
          preset={editing}
          audioFeaturesRef={audioFeaturesRef}
          startedAt={startedAt}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface PresetCardProps {
  preset: AudioPreset;
  /** Live value of the preset's primary feature (0..1) — passed by parent
   *  so the card stays a pure render of (preset, liveValue, isEditing). */
  liveValue: number;
  isEditing: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function PresetCard({
  preset,
  liveValue,
  isEditing,
  onEdit,
  onDuplicate,
  onDelete,
}: PresetCardProps) {
  const live = liveValue;
  const valid = presetIsValid(preset);

  return (
    <div className="vp-preset" data-active={isEditing ? "true" : undefined}>
      <div className="vp-preset__head">
        <span className="vp-preset__name">{preset.name}</span>
        <span className="vp-preset__feature">{preset.primary}</span>
      </div>
      <PresetVisualization formula={preset.formula} liveValue={live} />
      <div
        className={`vp-preset__formula ${valid ? "" : "vp-preset__formula--err"}`}
      >
        {preset.formula}
      </div>
      <div className="vp-preset__foot">
        <span className="vp-preset__output">→ {(live).toFixed(2)}</span>
        <span className="vp-preset__actions">
          <button
            type="button"
            className="vp-preset__act"
            title="Edit"
            onClick={onEdit}
          >
            ✎
          </button>
          <button
            type="button"
            className="vp-preset__act"
            title="Duplicate"
            onClick={onDuplicate}
          >
            ⎘
          </button>
          <button
            type="button"
            className="vp-preset__act vp-preset__act--del"
            title="Delete"
            onClick={onDelete}
          >
            ×
          </button>
        </span>
      </div>
    </div>
  );
}
