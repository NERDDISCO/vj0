/**
 * Audio preset library — persisted store of formula-driven audio mappings.
 *
 * The user wrote:
 *
 *   > This needs to be an audio preset so we can reuse it for different
 *   > kinds of properties or different kinds of elements that we add
 *   > across scenes. The audio presets are actually across scenes and not
 *   > scene-specific because you always want to reuse stuff globally.
 *
 * So presets are a flat library, separate from scenes. Each preset is a
 * (name, primary feature, formula) triple — formula is a string in our
 * mini language (see ./formula.ts).
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AudioPreset, AudioFeatureKey } from "./types";
import { compileFormula } from "./formula";

function uid(): string {
  return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// Five seed presets so a fresh user has something to play with on first
// open. They double as documentation: "this is what a binding looks like".
const SEED_PRESETS: AudioPreset[] = [
  {
    id: "preset_seed_rms",
    name: "Loudness",
    primary: "rms",
    formula: "rms",
    createdAt: 0,
  },
  {
    id: "preset_seed_pulse",
    name: "Bass pulse",
    primary: "low",
    formula: "clamp(low * 1.6, 0, 1)",
    createdAt: 0,
  },
  {
    id: "preset_seed_kick",
    name: "Kick gate",
    primary: "low",
    formula: "low > 0.45 ? 1 : 0",
    createdAt: 0,
  },
  {
    id: "preset_seed_hat",
    name: "Hat shimmer",
    primary: "high",
    formula: "smooth(clamp(high * 1.3, 0, 1))",
    createdAt: 0,
  },
  {
    id: "preset_seed_breathe",
    name: "Slow breathe",
    primary: "rms",
    formula: "lerp(v, 0.5 + sin(t * 2) * 0.4, 0.7)",
    createdAt: 0,
  },
];

interface PresetState {
  presets: AudioPreset[];
  /** UI: the preset currently being edited in the formula editor (if any). */
  editingPresetId: string | null;

  addPreset: (init?: Partial<Omit<AudioPreset, "id" | "createdAt">>) => string;
  duplicatePreset: (id: string) => string;
  removePreset: (id: string) => void;
  updatePreset: (id: string, patch: Partial<Omit<AudioPreset, "id">>) => void;
  setEditing: (id: string | null) => void;
}

export const usePresetStore = create<PresetState>()(
  persist(
    (set, get) => ({
      presets: SEED_PRESETS,
      editingPresetId: null,

      addPreset: (init) => {
        const id = uid();
        const next: AudioPreset = {
          id,
          name: init?.name ?? "New preset",
          primary: init?.primary ?? "rms",
          formula: init?.formula ?? "rms",
          createdAt: Date.now(),
        };
        set((s) => ({ presets: [...s.presets, next], editingPresetId: id }));
        return id;
      },

      duplicatePreset: (id) => {
        const src = get().presets.find((p) => p.id === id);
        if (!src) return "";
        const newId = uid();
        const copy: AudioPreset = {
          ...src,
          id: newId,
          name: `${src.name} copy`,
          createdAt: Date.now(),
        };
        set((s) => ({ presets: [...s.presets, copy], editingPresetId: newId }));
        return newId;
      },

      removePreset: (id) => {
        set((s) => ({
          presets: s.presets.filter((p) => p.id !== id),
          editingPresetId: s.editingPresetId === id ? null : s.editingPresetId,
        }));
      },

      updatePreset: (id, patch) => {
        set((s) => ({
          presets: s.presets.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        }));
      },

      setEditing: (id) => set({ editingPresetId: id }),
    }),
    {
      name: "vj0-composer-presets",
      version: 1,
    },
  ),
);

// ─── Selectors ──────────────────────────────────────────────────────

export function presetIsValid(preset: AudioPreset): boolean {
  return typeof compileFormula(preset.formula) !== "string";
}

export function buildPresetMap(presets: AudioPreset[]): Map<string, AudioPreset> {
  const m = new Map<string, AudioPreset>();
  for (const p of presets) m.set(p.id, p);
  return m;
}

/** Group presets by primary feature for the drawer / command palette. */
export function groupPresetsByFeature(
  presets: AudioPreset[],
): Record<AudioFeatureKey, AudioPreset[]> {
  const out: Record<string, AudioPreset[]> = {};
  for (const p of presets) {
    (out[p.primary] ||= []).push(p);
  }
  return out as Record<AudioFeatureKey, AudioPreset[]>;
}
