/**
 * UI state for /vj-next — drawer mode, command palette, etc.
 *
 * The user wrote:
 *
 *   > Maybe use the same container we use for lightning because I think
 *   > having this floating thing that just comes in when we need it makes
 *   > sense. We should use this as a global component and show different
 *   > things based on whatever we are on the page right now.
 *
 * So the drawer is *one* component with a `mode` field — the mode picks
 * what to render inside. This store owns that mode + the open/closed flag
 * so any button anywhere in the UI can ask the drawer to surface a
 * particular pane.
 *
 * Not persisted — the drawer should always boot closed.
 */

import { create } from "zustand";

export type DrawerMode = "presets" | "scenes" | "lighting";

interface UiState {
  /** Drawer is open at all. Closed = transform translateY(100%). */
  drawerOpen: boolean;
  /** Which view to render inside the drawer. */
  drawerMode: DrawerMode;
  /** Cmd+K palette is open. */
  paletteOpen: boolean;
  /** Show the dot-grid inside the input canvas. */
  showGrid: boolean;
  /** Lock the input canvas — disables double-click-to-add. Useful when
   *  you just want to inspect an existing scene without poking it. */
  canvasLocked: boolean;

  setDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;
  setDrawerMode: (mode: DrawerMode) => void;
  /** Open the drawer to a specific mode in one shot — what most call sites want. */
  openDrawer: (mode: DrawerMode) => void;

  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;

  setShowGrid: (v: boolean) => void;
  setCanvasLocked: (v: boolean) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  drawerOpen: false,
  drawerMode: "presets",
  paletteOpen: false,
  showGrid: true,
  canvasLocked: false,

  setDrawerOpen: (open) => set({ drawerOpen: open }),
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
  setDrawerMode: (mode) => set({ drawerMode: mode }),
  openDrawer: (mode) => set({ drawerOpen: true, drawerMode: mode }),

  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),

  setShowGrid: (v) => set({ showGrid: v }),
  setCanvasLocked: (v) => set({ canvasLocked: v }),
}));
