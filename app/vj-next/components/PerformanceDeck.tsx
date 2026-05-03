"use client";

import { useState } from "react";
import { useAiSettingsStore } from "@/src/lib/stores/ai-settings-store";

interface PerformanceDeckProps {
  /** Currently active prompt — used to highlight the active preset
   *  card so the user always knows which one is "live". */
  activePrompt: string;
  /** Fire a preset by index (0-8) — wired to keyboard 1-9 too. */
  onFirePreset: (index: number) => void;
  /** Re-roll seed only, keep prompt — wired to spacebar. */
  onReroll: () => void;
  /** α nudge for klein backend, only enabled when backend is "klein". */
  onAlphaNudge: ((delta: number) => void) | null;
  alpha: number | null;
}

/**
 * PerformanceDeck — live-trigger surface for the set. Replaces the
 * legacy /vj's PerformanceDeckCard + HotkeyBoard with a tighter
 * single-row layout that fits underneath the OutputOptions card
 * without taking a full secondary column.
 *
 * Surfaces:
 *   - 9 prompt preset cards with hotkey badges (1-9)
 *   - Re-roll (space) + α nudge (←/↑/↓/→) hint chips
 *   - Inline editor — click a preset's pencil icon to swap label/prompt
 *
 * The cards use the same .vj-btn--accent + .vj-btn--live family as
 * the rest of the app so an "armed" preset reads as "this is live".
 */
export function PerformanceDeck({
  activePrompt,
  onFirePreset,
  onReroll,
  onAlphaNudge,
  alpha,
}: PerformanceDeckProps) {
  const presets = useAiSettingsStore((s) => s.promptPresets);
  const updatePreset = useAiSettingsStore((s) => s.updatePromptPreset);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  return (
    <div className="vp-deck">
      <div className="vp-deck__head">
        <span className="vp-deck__title">performance · keys 1–9</span>
        <span className="vp-deck__hint">
          <kbd>space</kbd> reroll
          {onAlphaNudge && (
            <>
              {" · "}
              <kbd>↑↓←→</kbd> α {alpha != null ? alpha.toFixed(2) : ""}
            </>
          )}
        </span>
      </div>
      <div className="vp-deck__grid">
        {presets.slice(0, 9).map((p, idx) => {
          const isActive = p.prompt === activePrompt;
          const isEditing = editingIdx === idx;
          return (
            <div
              key={idx}
              className={`vp-deck__cell ${isActive ? "vp-deck__cell--live" : ""}`}
            >
              <button
                type="button"
                className="vp-deck__fire"
                onClick={() => onFirePreset(idx)}
                title={p.prompt}
              >
                <span className="vp-deck__hot">{idx + 1}</span>
                <span className="vp-deck__label">{p.label}</span>
              </button>
              <button
                type="button"
                className="vp-deck__edit"
                title="Edit preset"
                onClick={() => setEditingIdx(isEditing ? null : idx)}
              >
                ✎
              </button>
              {isEditing && (
                <div className="vp-deck__editor">
                  <label>
                    <span>label</span>
                    <input
                      autoFocus
                      value={p.label}
                      onChange={(e) =>
                        updatePreset(idx, { label: e.target.value.slice(0, 12) })
                      }
                    />
                  </label>
                  <label>
                    <span>prompt</span>
                    <textarea
                      rows={3}
                      value={p.prompt}
                      onChange={(e) =>
                        updatePreset(idx, { prompt: e.target.value })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="vj-btn vj-btn--bar"
                    onClick={() => setEditingIdx(null)}
                  >
                    done
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button
          type="button"
          className="vj-btn vj-btn--bar"
          onClick={onReroll}
          title="Reroll seed (Space)"
        >
          ⟲ reroll seed
        </button>
      </div>
    </div>
  );
}
