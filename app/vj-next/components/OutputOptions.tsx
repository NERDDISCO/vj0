"use client";

import { selectActiveScene, useSceneStore } from "@/src/lib/composer";
import { OUTPUT_PRESETS } from "@/src/lib/stores/ai-settings-store";

interface OutputOptionsProps {
  /** Output resolution. */
  width: number;
  height: number;
  onResolutionChange: (w: number, h: number) => void;

  /** Generation steps (Klein 1..4). */
  steps: number;
  onStepsChange: (v: number) => void;

  /** Strength (alpha) — 0..0.5 in the existing AI Console. */
  alpha: number;
  onAlphaChange: (v: number) => void;

  /** Generation seed. */
  seed: number;
  onSeedChange: (v: number) => void;

  /** Currently sending frames? */
  generating: boolean;
  onGeneratingChange: (v: boolean) => void;
  canGenerate: boolean;
}

/**
 * Output options card — sits below the OUTPUT stage in the right column,
 * matching the user's layout request:
 *
 *   > Put the input and output fields side by side with the options for the
 *   > output field below them in the same column.
 *
 * The options are scoped to *generation* parameters: prompt (read from the
 * active scene), resolution, alpha, steps, seed. Per-element parameters live
 * in the inspector under the input canvas — that keeps the right column
 * "what comes out" and the left column "what goes in".
 */
export function OutputOptions({
  width,
  height,
  onResolutionChange,
  steps,
  onStepsChange,
  alpha,
  onAlphaChange,
  seed,
  onSeedChange,
  generating,
  onGeneratingChange,
  canGenerate,
}: OutputOptionsProps) {
  const activeScene = useSceneStore(selectActiveScene);
  const updatePrompt = useSceneStore((s) => s.updateScenePrompt);
  // Use the canonical resolution table from /vj — every entry is
  // div-by-16 and integer-upscale-friendly to QHD/4K. Keeps both routes
  // in sync so a user switching between them gets the same options.
  const currentResId = `${width}x${height}`;

  return (
    <div className="vp-options">
      <div className="vp-options__head">
        <span className="vp-options__title">output options</span>
        <span className="vp-options__meta">prompt · model · cue</span>
      </div>

      <div>
        <label
          style={{
            display: "block",
            fontSize: "0.6rem",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--vj-ink-dim)",
            marginBottom: "0.35rem",
          }}
        >
          prompt
        </label>
        <textarea
          className="vp-prompt"
          placeholder="describe the output style…"
          value={activeScene?.prompt ?? ""}
          onChange={(e) =>
            activeScene && updatePrompt(activeScene.id, e.target.value)
          }
          rows={2}
        />
      </div>

      <div className="vp-options__row">
        <button
          type="button"
          className={`vj-btn ${generating ? "vj-btn--live" : "vj-btn--accent"}`}
          onClick={() => onGeneratingChange(!generating)}
          disabled={!canGenerate}
          title={canGenerate ? "Toggle generation (space)" : "Connect AI first"}
        >
          {generating ? "■ stop" : "▶ generate"}
        </button>

        <label
          className="vj-chip"
          title={
            OUTPUT_PRESETS.find((p) => `${p.w}x${p.h}` === currentResId)?.label ||
            "Output resolution"
          }
        >
          <span className="vj-chip__label">res</span>
          <select
            className="vj-chip__select"
            value={currentResId}
            onChange={(e) => {
              const [w, h] = e.target.value.split("x").map(Number);
              onResolutionChange(w, h);
            }}
          >
            <optgroup label="16:9 horizontal">
              {OUTPUT_PRESETS.filter((p) => p.w >= p.h).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.w}×{p.h}
                </option>
              ))}
            </optgroup>
            <optgroup label="9:16 vertical">
              {OUTPUT_PRESETS.filter((p) => p.w < p.h).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.w}×{p.h}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        <label className="vj-chip" title="Klein steps — 1 fast, 4 quality">
          <span className="vj-chip__label">steps</span>
          <select
            className="vj-chip__select"
            value={steps}
            onChange={(e) => onStepsChange(Number(e.target.value))}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </label>

        <div
          className="vj-chip"
          title="0 = pure prompt · 0.5 = source dominates"
        >
          <span className="vj-chip__label">α</span>
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.01}
            value={alpha}
            onChange={(e) => onAlphaChange(Number(e.target.value))}
            className="vj-range vj-chip__range"
            style={
              {
                ["--vj-range-fill" as string]: `${(alpha / 0.5) * 100}%`,
              } as React.CSSProperties
            }
          />
          <span className="vj-chip__value">{alpha.toFixed(2)}</span>
        </div>

        <label className="vj-chip" title="Generation seed">
          <span className="vj-chip__label">seed</span>
          <input
            className="vj-chip__input"
            type="number"
            value={seed}
            onChange={(e) =>
              onSeedChange(Math.max(0, Math.floor(Number(e.target.value))))
            }
          />
          <button
            type="button"
            className="vj-chip__icon"
            title="Randomize"
            onClick={() => onSeedChange(Math.floor(Math.random() * 1_000_000))}
          >
            ⟲
          </button>
        </label>
      </div>
    </div>
  );
}
