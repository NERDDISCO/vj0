/**
 * Layout store — persisted column split for the /vj-next workspace.
 *
 * The workspace is three columns: input · output · launchpad. The first
 * two are stored as fractions of the workspace width, the launchpad takes
 * whatever is left and scales its pads to fit. Dragging a gutter updates
 * the fractions; the values survive reloads via localStorage.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Smallest a single column may get, as a fraction of the workspace. */
export const MIN_COLUMN_FR = 0.12;

interface LayoutState {
  /** Width of the input column, 0..1 of the workspace. */
  inputFr: number;
  /** Width of the output column, 0..1 of the workspace. */
  outputFr: number;

  /** Resize by dragging the gutter between input and output. */
  setInputFr: (fr: number) => void;
  /** Resize by dragging the gutter between output and launchpad. */
  setOutputFr: (fr: number) => void;
  resetLayout: () => void;
}

const DEFAULT_INPUT_FR = 0.3;
const DEFAULT_OUTPUT_FR = 0.3;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      inputFr: DEFAULT_INPUT_FR,
      outputFr: DEFAULT_OUTPUT_FR,

      setInputFr: (fr) => {
        const { outputFr } = get();
        // Input can't eat into the launchpad's minimum either.
        const max = 1 - outputFr - MIN_COLUMN_FR;
        set({ inputFr: clamp(fr, MIN_COLUMN_FR, max) });
      },
      setOutputFr: (fr) => {
        const { inputFr } = get();
        const max = 1 - inputFr - MIN_COLUMN_FR;
        set({ outputFr: clamp(fr, MIN_COLUMN_FR, max) });
      },
      resetLayout: () =>
        set({ inputFr: DEFAULT_INPUT_FR, outputFr: DEFAULT_OUTPUT_FR }),
    }),
    {
      name: "vj0-layout-storage",
      version: 1,
      partialize: (s) => ({ inputFr: s.inputFr, outputFr: s.outputFr }),
    },
  ),
);
