/**
 * Scene library — persisted store of user-created Scenes for /vj-next.
 *
 * The current `/vj` route's "scene" concept is a hard-coded class
 * (WaveformScene etc.); the new composer turns scenes into editable
 * documents you build by placing Elements. We keep this in its own store
 * (vj0-composer-scenes) so it can evolve independently and so a future
 * import/export round-trip is a single localStorage blob.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_LOGO_MIX,
  type Element,
  type ElementKind,
  type ElementProperties,
  type PropertyKey,
  type PropertyBinding,
  type Scene,
} from "./types";
import { purgeElementCache } from "./render";
import { getSceneTemplate } from "./scene-templates";
import { selectNewestAssetId, useAssetStore } from "../assets/asset-store";

// ─── Defaults ────────────────────────────────────────────────────────
function defaultProps(
  kind: ElementKind,
  x = 0.5,
  y = 0.5,
  overrides: Partial<ElementProperties> = {},
): ElementProperties {
  // Per-kind initial sizes — a default circle should look chunky, a
  // default text should be readable. Tuned by eye.
  const baseSize: Record<ElementKind, number> = {
    circle: 0.12,
    ring: 0.16,
    rectangle: 0.18,
    triangle: 0.16,
    line: 0.4,
    text: 0.12,
    // Waveform default: half the canvas wide, ~20% tall — a strip the
    // user can place anywhere. Aspect 4 squashes it horizontally so it
    // reads as a strip, not a square scope. Stroke 0 means render uses
    // its sensible default thickness derived from size.
    waveform: 0.45,
    // Logo: ~40% of the short edge wide — big enough to survive the AI
    // restyle, small enough to sit beside other elements.
    image: 0.2,
  };
  // Each kind gets a different default color — keeps a multi-element scene
  // from looking like all-magenta camo. Pulls from the patch palette.
  const baseColor: Record<ElementKind, string> = {
    circle: "#ff00aa",
    ring: "#00e5ff",
    rectangle: "#00ff88",
    triangle: "#ffd700",
    line: "#e9e9f2",
    text: "#ff00aa",
    waveform: "#00e5ff",
    image: "#ffffff",
  };
  return {
    x,
    y,
    size: baseSize[kind],
    aspect: kind === "waveform" ? 4 : 1,
    rotation: 0,
    color: baseColor[kind],
    opacity: 1,
    stroke: 0,
    text: kind === "text" ? "VJ0" : "",
    // A logo dropped via quick-add grabs the newest upload so it shows
    // something immediately; the inspector can swap it.
    assetId: kind === "image" ? selectNewestAssetId(useAssetStore.getState()) : "",
    placement: kind === "image" ? "both" : "source",
    enabled: true,
    mix: DEFAULT_LOGO_MIX,
    ...overrides,
  };
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function defaultElementName(kind: ElementKind, index: number): string {
  return `${kind === "image" ? "logo" : kind} ${index}`;
}

// ─── Store ──────────────────────────────────────────────────────────

interface SceneState {
  scenes: Scene[];
  activeSceneId: string | null;
  selectedElementId: string | null;

  // ─── Scene actions
  addScene: (name?: string) => string;
  /** Create a fresh scene populated with elements from a built-in
   *  template (Waveform / Radial pulse / Spectrum bars / etc). */
  addSceneFromTemplate: (templateId: string) => string;
  duplicateScene: (id: string) => string;
  removeScene: (id: string) => void;
  renameScene: (id: string, name: string) => void;
  setActiveScene: (id: string) => void;
  updateScenePrompt: (id: string, prompt: string) => void;
  updateSceneBackground: (id: string, color: string) => void;

  // ─── Element actions (operate on the active scene)
  addElement: (
    kind: ElementKind,
    x?: number,
    y?: number,
    overrides?: Partial<ElementProperties>,
  ) => string | null;
  removeElement: (id: string) => void;
  selectElement: (id: string | null) => void;
  updateElementProp: <K extends keyof ElementProperties>(
    id: string,
    key: K,
    value: ElementProperties[K],
  ) => void;
  bindElementProperty: (
    id: string,
    key: PropertyKey,
    binding: PropertyBinding | null,
  ) => void;
  /** Move element to top of z-order (last in elements array). */
  bringForward: (id: string) => void;
  /** Flip `enabled` on an element in any scene (pads target by id). */
  toggleElementEnabled: (id: string) => void;
  renameElement: (id: string, name: string) => void;
}

const seedSceneId = uid("scene");
const initialScene: Scene = {
  id: seedSceneId,
  name: "Untitled 01",
  prompt: "neon retro-futuristic dance club, smoke and light",
  background: "#04040a",
  elements: [],
  createdAt: Date.now(),
};

export const useSceneStore = create<SceneState>()(
  persist(
    (set, get) => ({
      scenes: [initialScene],
      activeSceneId: seedSceneId,
      selectedElementId: null,

      addScene: (name) => {
        const id = uid("scene");
        const next: Scene = {
          id,
          name: name ?? `Untitled ${(get().scenes.length + 1).toString().padStart(2, "0")}`,
          prompt: "",
          background: "#04040a",
          elements: [],
          createdAt: Date.now(),
        };
        set((s) => ({
          scenes: [...s.scenes, next],
          activeSceneId: id,
          selectedElementId: null,
        }));
        return id;
      },

      addSceneFromTemplate: (templateId) => {
        const tpl = getSceneTemplate(templateId);
        if (!tpl) return "";
        const id = uid("scene");
        const elements = tpl.elements().map((el, idx) => ({
          ...el,
          id: uid("el"),
          // "circle 1" / "ring 2" naming so the inspector list stays
          // self-describing even after the user reshuffles.
          name: `${el.kind} ${idx + 1}`,
        }));
        const next: Scene = {
          id,
          name: tpl.name,
          prompt: "",
          background: "#04040a",
          elements,
          createdAt: Date.now(),
        };
        set((s) => ({
          scenes: [...s.scenes, next],
          activeSceneId: id,
          selectedElementId: null,
        }));
        return id;
      },

      duplicateScene: (id) => {
        const src = get().scenes.find((s) => s.id === id);
        if (!src) return "";
        const newId = uid("scene");
        const copy: Scene = {
          ...src,
          id: newId,
          name: `${src.name} copy`,
          createdAt: Date.now(),
          elements: src.elements.map((el) => ({
            ...el,
            id: uid("el"),
            props: { ...el.props },
            bindings: { ...el.bindings },
          })),
        };
        set((s) => ({
          scenes: [...s.scenes, copy],
          activeSceneId: newId,
        }));
        return newId;
      },

      removeScene: (id) => {
        set((s) => {
          // Free element render caches for the doomed scene.
          const doomed = s.scenes.find((sc) => sc.id === id);
          if (doomed) doomed.elements.forEach((el) => purgeElementCache(el.id));
          const remaining = s.scenes.filter((sc) => sc.id !== id);
          // Always keep at least one scene around so the workspace doesn't
          // collapse to a confusing empty state. If the user deleted the
          // last one we synthesize a fresh untitled.
          if (remaining.length === 0) {
            const fresh: Scene = {
              id: uid("scene"),
              name: "Untitled 01",
              prompt: "",
              background: "#04040a",
              elements: [],
              createdAt: Date.now(),
            };
            return {
              scenes: [fresh],
              activeSceneId: fresh.id,
              selectedElementId: null,
            };
          }
          const nextActive =
            s.activeSceneId === id ? remaining[remaining.length - 1].id : s.activeSceneId;
          return {
            scenes: remaining,
            activeSceneId: nextActive,
            selectedElementId: null,
          };
        });
      },

      renameScene: (id, name) => {
        set((s) => ({
          scenes: s.scenes.map((sc) => (sc.id === id ? { ...sc, name } : sc)),
        }));
      },

      setActiveScene: (id) => {
        set({ activeSceneId: id, selectedElementId: null });
      },

      updateScenePrompt: (id, prompt) => {
        set((s) => ({
          scenes: s.scenes.map((sc) => (sc.id === id ? { ...sc, prompt } : sc)),
        }));
      },

      updateSceneBackground: (id, color) => {
        set((s) => ({
          scenes: s.scenes.map((sc) => (sc.id === id ? { ...sc, background: color } : sc)),
        }));
      },

      addElement: (kind, x = 0.5, y = 0.5, overrides = {}) => {
        const activeId = get().activeSceneId;
        if (!activeId) return null;
        const newId = uid("el");
        const scene = get().scenes.find((s) => s.id === activeId);
        if (!scene) return null;
        const indexForName = scene.elements.filter((e) => e.kind === kind).length + 1;
        const newEl: Element = {
          id: newId,
          kind,
          name: defaultElementName(kind, indexForName),
          props: defaultProps(kind, x, y, overrides),
          bindings: {},
        };
        set((s) => ({
          scenes: s.scenes.map((sc) =>
            sc.id === activeId ? { ...sc, elements: [...sc.elements, newEl] } : sc,
          ),
          selectedElementId: newId,
        }));
        return newId;
      },

      removeElement: (id) => {
        purgeElementCache(id);
        set((s) => ({
          scenes: s.scenes.map((sc) => ({
            ...sc,
            elements: sc.elements.filter((el) => el.id !== id),
          })),
          selectedElementId: s.selectedElementId === id ? null : s.selectedElementId,
        }));
      },

      selectElement: (id) => {
        set({ selectedElementId: id });
      },

      updateElementProp: (id, key, value) => {
        set((s) => ({
          scenes: s.scenes.map((sc) => ({
            ...sc,
            elements: sc.elements.map((el) =>
              el.id === id ? { ...el, props: { ...el.props, [key]: value } } : el,
            ),
          })),
        }));
      },

      bindElementProperty: (id, key, binding) => {
        set((s) => ({
          scenes: s.scenes.map((sc) => ({
            ...sc,
            elements: sc.elements.map((el) => {
              if (el.id !== id) return el;
              const next = { ...el.bindings };
              if (binding === null) delete next[key];
              else next[key] = binding;
              return { ...el, bindings: next };
            }),
          })),
        }));
      },

      bringForward: (id) => {
        set((s) => ({
          scenes: s.scenes.map((sc) => {
            const idx = sc.elements.findIndex((e) => e.id === id);
            if (idx === -1) return sc;
            const moved = sc.elements[idx];
            const without = sc.elements.filter((_, i) => i !== idx);
            return { ...sc, elements: [...without, moved] };
          }),
        }));
      },

      toggleElementEnabled: (id) => {
        set((s) => ({
          scenes: s.scenes.map((sc) => ({
            ...sc,
            elements: sc.elements.map((el) =>
              el.id === id
                ? { ...el, props: { ...el.props, enabled: !(el.props.enabled ?? true) } }
                : el,
            ),
          })),
        }));
      },

      renameElement: (id, name) => {
        set((s) => ({
          scenes: s.scenes.map((sc) => ({
            ...sc,
            elements: sc.elements.map((el) => (el.id === id ? { ...el, name } : el)),
          })),
        }));
      },
    }),
    {
      name: "vj0-composer-scenes",
      version: 1,
      // Ensure activeSceneId references something real after rehydrate;
      // localStorage data can be edited or come from an older build.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (!state.scenes.find((s) => s.id === state.activeSceneId)) {
          state.activeSceneId = state.scenes[0]?.id ?? null;
        }
        // Backfill props added after a scene was persisted, so the
        // renderer never sees undefined numerics.
        for (const sc of state.scenes) {
          for (const el of sc.elements) {
            const p = el.props;
            if (p.assetId === undefined) p.assetId = "";
            if (p.placement === undefined) p.placement = el.kind === "image" ? "both" : "source";
            if (p.enabled === undefined) p.enabled = true;
            if (typeof p.mix !== "number") p.mix = DEFAULT_LOGO_MIX;
          }
        }
      },
    },
  ),
);

// ─── Helpers (selectors) ─────────────────────────────────────────────

export function selectActiveScene(s: SceneState): Scene | null {
  return s.scenes.find((sc) => sc.id === s.activeSceneId) ?? null;
}

export function selectSelectedElement(s: SceneState): Element | null {
  if (!s.selectedElementId) return null;
  const scene = selectActiveScene(s);
  if (!scene) return null;
  return scene.elements.find((el) => el.id === s.selectedElementId) ?? null;
}
