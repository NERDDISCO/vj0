/**
 * MIDI store — persisted pad bindings for the Launchpad Pro MK3 plus the
 * runtime connection state the drawer UI renders.
 *
 * Persisted: `bindings`, `autoConnect`. Everything else (status, pressed
 * pads, the `fire` dispatcher installed by useLaunchpad) is runtime-only
 * and reset on reload.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { buildDefaultBindings } from "../midi/default-layout";
import { DEFAULT_GRID_IDLE_LEVEL, MAX_GRID_IDLE_LEVEL } from "../midi/pad-actions";
import type { PadBinding } from "../midi/pad-actions";
import type { LaunchpadSnapshot } from "../midi/launchpad-controller";

interface MidiState extends LaunchpadSnapshot {
  bindings: Record<number, PadBinding>;
  /** Reconnect silently on app load once the user has paired the device. */
  autoConnect: boolean;
  /** Idle glow of inactive grid pads on the hardware, 0..MAX_GRID_IDLE_LEVEL. */
  gridIdleLevel: number;
  /** Last pad id the hardware reported (helps when binding by ear). */
  lastPressed: number | null;
  /** Pads currently held on the hardware — for the virtual grid's glow. */
  pressed: Record<number, true>;
  /** Installed by useLaunchpad: run the binding for `id` as if pressed. */
  fire: ((id: number) => void) | null;

  setBinding: (id: number, binding: PadBinding) => void;
  clearBinding: (id: number) => void;
  resetBindings: () => void;
  setAutoConnect: (v: boolean) => void;
  setGridIdleLevel: (v: number) => void;
  setSnapshot: (snap: LaunchpadSnapshot) => void;
  setPressed: (id: number, down: boolean) => void;
  setFire: (fn: ((id: number) => void) | null) => void;
}

export const useMidiStore = create<MidiState>()(
  persist(
    (set) => ({
      bindings: buildDefaultBindings(),
      autoConnect: false,
      gridIdleLevel: DEFAULT_GRID_IDLE_LEVEL,
      status: "disconnected",
      deviceName: null,
      error: null,
      ledTx: 0,
      lastPressed: null,
      pressed: {},
      fire: null,

      setBinding: (id, binding) =>
        set((s) => ({ bindings: { ...s.bindings, [id]: binding } })),
      clearBinding: (id) =>
        set((s) => {
          const next = { ...s.bindings };
          delete next[id];
          return { bindings: next };
        }),
      resetBindings: () => set({ bindings: buildDefaultBindings() }),
      setAutoConnect: (v) => set({ autoConnect: v }),
      setGridIdleLevel: (v) =>
        set({ gridIdleLevel: Math.max(0, Math.min(MAX_GRID_IDLE_LEVEL, v)) }),
      setSnapshot: (snap) => set(snap),
      setPressed: (id, down) =>
        set((s) => {
          const next = { ...s.pressed };
          if (down) next[id] = true;
          else delete next[id];
          return { pressed: next, lastPressed: down ? id : s.lastPressed };
        }),
      setFire: (fn) => set({ fire: fn }),
    }),
    {
      name: "vj0-midi-storage",
      version: 2,
      // v2 rebuilt the edge layout (no bottom row, new right column).
      // Older persisted layouts are replaced with the new defaults.
      migrate: (persisted: unknown, version: number) => {
        const s = (persisted as Record<string, unknown>) || {};
        if (version < 2) return { ...s, bindings: buildDefaultBindings() };
        return s;
      },
      partialize: (s) => ({
        bindings: s.bindings,
        autoConnect: s.autoConnect,
        gridIdleLevel: s.gridIdleLevel,
      }),
    },
  ),
);
