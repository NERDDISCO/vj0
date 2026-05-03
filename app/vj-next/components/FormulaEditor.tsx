"use client";

import { useEffect, useMemo, useState } from "react";
import {
  compileFormula,
  shortenFeatures,
  AUDIO_FEATURE_KEYS,
  usePresetStore,
  type AudioFeatureKey,
  type AudioPreset,
} from "@/src/lib/composer";
import type { AudioFeatures } from "@/src/lib/audio-features";

interface FormulaEditorProps {
  preset: AudioPreset;
  audioFeaturesRef: React.MutableRefObject<AudioFeatures | null>;
  startedAt: number;
  onClose: () => void;
}

/**
 * FormulaEditor — drawer-mode card for one preset. Handles:
 *   - name + primary-feature picker
 *   - the formula expression box, with live validation
 *   - a quick-insert grid of feature names (cuts down on typos)
 *   - a live readout that evaluates the formula against the current audio
 *     and shows the resulting 0..1 number with a meter bar
 *   - a hint block listing the helpers ("clamp lerp smooth ...")
 *
 * Validation runs on every keystroke (compileFormula is cached). The user
 * gets a precise error message ("unknown identifier: rmss") under the
 * expression box so typos surface immediately rather than silently
 * collapsing the binding to 0.
 */
export function FormulaEditor({
  preset,
  audioFeaturesRef,
  startedAt,
  onClose,
}: FormulaEditorProps) {
  const updatePreset = usePresetStore((s) => s.updatePreset);
  const removePreset = usePresetStore((s) => s.removePreset);

  // Local draft so the user can clear-and-retype without flicker, but commit
  // back into the store on every change so bindings update immediately.
  // Resetting these to a different preset's values is handled by remounting
  // — the parent passes `key={preset.id}`, so a new preset gets fresh state
  // initializers without an effect (avoids React 19's setState-in-effect lint).
  const [name, setName] = useState(preset.name);
  const [primary, setPrimary] = useState<AudioFeatureKey>(preset.primary);
  const [formula, setFormula] = useState(preset.formula);

  // 30 Hz tick that snapshots audio + time into React state so the live
  // readout below can be a pure render of (compiled, tick).
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

  const compiled = useMemo(() => compileFormula(formula), [formula]);
  const isError = typeof compiled === "string";

  const liveValue = useMemo(() => {
    if (isError) return 0;
    const features = shortenFeatures(tick.features);
    try {
      return (compiled as Exclude<typeof compiled, string>).fn({
        ...features,
        t: tick.t,
        v: 0.5,
      });
    } catch {
      return 0;
    }
  }, [compiled, isError, tick]);

  function commitName() {
    const next = name.trim();
    if (next && next !== preset.name) updatePreset(preset.id, { name: next });
  }
  function commitPrimary(p: AudioFeatureKey) {
    setPrimary(p);
    updatePreset(preset.id, { primary: p });
  }
  function commitFormula(value: string) {
    setFormula(value);
    updatePreset(preset.id, { formula: value });
  }
  function insert(token: string) {
    const next = formula.trim().length === 0 ? token : `${formula} ${token}`;
    commitFormula(next);
  }

  return (
    <div className="vp-formula">
      <div className="vp-formula__row">
        <span className="vp-formula__label">name</span>
        <input
          className="vp-formula__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === "Enter" && commitName()}
        />
      </div>

      <div className="vp-formula__row">
        <span className="vp-formula__label">tag</span>
        <div className="vp-formula__feature-grid">
          {AUDIO_FEATURE_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              className="vp-formula__feature"
              aria-pressed={primary === k}
              onClick={() => commitPrimary(k)}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className="vp-formula__row">
        <span className="vp-formula__label">expr</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            className={`vp-formula__expr ${isError ? "vp-formula__expr--err" : ""}`}
            spellCheck={false}
            value={formula}
            onChange={(e) => commitFormula(e.target.value)}
            rows={2}
          />
          {isError && (
            <div className="vp-formula__err">⚠ {compiled as string}</div>
          )}
          <div
            style={{
              display: "flex",
              gap: 4,
              flexWrap: "wrap",
              fontSize: "0.62rem",
              color: "var(--vj-ink-dim)",
            }}
          >
            <span style={{ marginRight: 4 }}>insert:</span>
            {(["rms", "peak", "low", "mid", "high", "bright", "t", "v"] as const).map(
              (tok) => (
                <button
                  key={tok}
                  type="button"
                  onClick={() => insert(tok)}
                  className="vp-formula__feature"
                  style={{ padding: "0.18rem 0.4rem" }}
                >
                  {tok}
                </button>
              ),
            )}
          </div>
          <div
            style={{
              display: "flex",
              gap: 4,
              flexWrap: "wrap",
              fontSize: "0.62rem",
              color: "var(--vj-ink-dim)",
            }}
          >
            <span style={{ marginRight: 4 }}>fns:</span>
            {(["clamp(", "lerp(", "smooth(", "step(", "sin(", "abs(", "min(", "max("] as const).map(
              (tok) => (
                <button
                  key={tok}
                  type="button"
                  onClick={() => insert(tok)}
                  className="vp-formula__feature"
                  style={{ padding: "0.18rem 0.4rem", textTransform: "none" }}
                >
                  {tok}
                </button>
              ),
            )}
          </div>
        </div>
      </div>

      <div className="vp-formula__readout">
        <span className="vp-formula__readout-label">live</span>
        <div
          className="vp-formula__readout-bar"
          style={{ ["--vp-readout" as string]: `${liveValue * 100}%` } as React.CSSProperties}
        />
        <span className="vp-formula__readout-num">{liveValue.toFixed(3)}</span>
      </div>

      <div className="vp-formula__hints">
        Vars: <code>rms peak low mid high bright t v</code><br />
        Fns: <code>clamp lerp smooth step sin cos abs min max pow sqrt mod</code><br />
        Ops: <code>+ - * / % ?: &amp;&amp; ||</code> ·
        Output is auto-clamped 0..1.
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <button
          type="button"
          className="vj-btn vj-btn--danger"
          onClick={() => {
            if (window.confirm(`Delete "${preset.name}"?`)) {
              removePreset(preset.id);
              onClose();
            }
          }}
        >
          delete
        </button>
        <button type="button" className="vj-btn" onClick={onClose}>
          done
        </button>
      </div>
    </div>
  );
}
