/**
 * Scene templates — drop a fresh scene populated with elements that
 * mimic each of the 6 hardcoded VisualEngine scenes from legacy /vj.
 * The Patch Studio scene model is freeform (you place elements
 * yourself), but the legacy scenes were what users had been using
 * as starting points. Templates restore that "click and you're set"
 * quick-start while still letting the user customize.
 *
 * Each template returns a list of Element bodies (no id, no name —
 * those get filled in by useSceneStore.addElement). The audio
 * bindings reference seed AudioPreset ids from preset-store so a
 * fresh user gets working audio reactivity on first paint.
 */

import type { Element, ElementProperties, PropertyBinding } from "./types";

export interface SceneTemplate {
  id: string;
  name: string;
  description: string;
  /** Returns the element seed for the scene. The store fills in
   *  id + name on insert. */
  elements(): Array<Omit<Element, "id" | "name">>;
}

// ─── Helpers ────────────────────────────────────────────────────────

function makeProps(overrides: Partial<ElementProperties>): ElementProperties {
  return {
    x: 0.5,
    y: 0.5,
    size: 0.2,
    aspect: 1,
    rotation: 0,
    color: "#ffffff",
    opacity: 1,
    stroke: 0,
    text: "",
    ...overrides,
  };
}

// Convenience for a "size driven by RMS" binding using the seed
// preset that ships with preset-store. Falls back gracefully when
// the preset doesn't exist (binding is silently dropped at render).
const RMS: PropertyBinding = { presetId: "preset_seed_rms", mode: "set" };
const PULSE: PropertyBinding = { presetId: "preset_seed_pulse", mode: "set" };
const HAT: PropertyBinding = { presetId: "preset_seed_hat", mode: "set" };

// ─── Templates ──────────────────────────────────────────────────────

export const SCENE_TEMPLATES: SceneTemplate[] = [
  {
    id: "tpl-waveform",
    name: "Waveform",
    description: "Live PCM waveform across the canvas",
    elements: () => [
      {
        kind: "waveform",
        props: makeProps({
          x: 0.5,
          y: 0.5,
          size: 0.48,
          aspect: 4,
          color: "#00e5ff",
          stroke: 0.012,
        }),
        bindings: { stroke: { presetId: "preset_seed_rms", mode: "add" } },
      },
    ],
  },
  {
    id: "tpl-radial-pulse",
    name: "Radial pulse",
    description: "Concentric rings pulsing with bass",
    elements: () => [
      {
        kind: "ring",
        props: makeProps({
          size: 0.18,
          color: "#ff00aa",
          stroke: 0.025,
        }),
        bindings: { size: PULSE, opacity: RMS },
      },
      {
        kind: "ring",
        props: makeProps({
          size: 0.28,
          color: "#00e5ff",
          stroke: 0.018,
        }),
        bindings: { size: PULSE },
      },
      {
        kind: "ring",
        props: makeProps({
          size: 0.38,
          color: "#00ff88",
          stroke: 0.012,
        }),
        bindings: { size: { presetId: "preset_seed_kick", mode: "set" } },
      },
    ],
  },
  {
    id: "tpl-spectrum-bars",
    name: "Spectrum bars",
    description: "Three vertical bars driven by low / mid / high",
    elements: () => [
      {
        kind: "rectangle",
        props: makeProps({
          x: 0.25,
          y: 0.5,
          size: 0.04,
          aspect: 0.15,
          color: "#ff00aa",
        }),
        bindings: {
          aspect: { presetId: "preset_seed_pulse", mode: "set" },
        },
      },
      {
        kind: "rectangle",
        props: makeProps({
          x: 0.5,
          y: 0.5,
          size: 0.04,
          aspect: 0.15,
          color: "#00e5ff",
        }),
        bindings: { aspect: { presetId: "preset_seed_rms", mode: "set" } },
      },
      {
        kind: "rectangle",
        props: makeProps({
          x: 0.75,
          y: 0.5,
          size: 0.04,
          aspect: 0.15,
          color: "#00ff88",
        }),
        bindings: { aspect: HAT },
      },
    ],
  },
  {
    id: "tpl-particle-field",
    name: "Particle field",
    description: "Scattered dots brightening with mids",
    elements: () => {
      // Hand-tuned 12-particle layout — random would look messy on
      // first paint; deterministic positions read as "composed".
      const positions: Array<[number, number]> = [
        [0.18, 0.25], [0.42, 0.18], [0.65, 0.30], [0.85, 0.22],
        [0.10, 0.55], [0.30, 0.50], [0.55, 0.60], [0.78, 0.55],
        [0.22, 0.78], [0.45, 0.82], [0.68, 0.74], [0.90, 0.80],
      ];
      return positions.map(([x, y], i) => ({
        kind: "circle" as const,
        props: makeProps({
          x,
          y,
          size: 0.03,
          color: i % 2 === 0 ? "#ff00aa" : "#00e5ff",
        }),
        bindings: { opacity: { presetId: "preset_seed_rms", mode: "set" } },
      }));
    },
  },
  {
    id: "tpl-terrain-lines",
    name: "Terrain lines",
    description: "Stacked horizontal lines at varied opacities",
    elements: () => {
      const lines = 7;
      return Array.from({ length: lines }, (_, i) => ({
        kind: "line" as const,
        props: makeProps({
          x: 0.5,
          y: 0.2 + (i / (lines - 1)) * 0.6,
          size: 0.45,
          stroke: 0.004,
          color: "#e9e9f2",
          opacity: 0.5 + i * 0.05,
        }),
        bindings:
          i % 2 === 0
            ? { opacity: { presetId: "preset_seed_pulse", mode: "set" } }
            : { opacity: { presetId: "preset_seed_hat", mode: "set" } },
      }));
    },
  },
  {
    id: "tpl-starfield",
    name: "Starfield",
    description: "Many tiny stars twinkling on highs",
    elements: () => {
      // Deterministic pseudo-random starfield using a fixed seed —
      // same shape every time, no surprises in a live set.
      const stars: Array<Omit<Element, "id" | "name">> = [];
      let seed = 1;
      const next = () => {
        // Simple xorshift32 — fast, deterministic, good enough for
        // visual scatter (no statistical claims being made here).
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return ((seed >>> 0) % 1000) / 1000;
      };
      for (let i = 0; i < 60; i++) {
        stars.push({
          kind: "circle",
          props: makeProps({
            x: next(),
            y: next(),
            size: 0.004 + next() * 0.012,
            color: "#ffffff",
            opacity: 0.4 + next() * 0.6,
          }),
          bindings: { opacity: { presetId: "preset_seed_hat", mode: "set" } },
        });
      }
      return stars;
    },
  },
];

/** Look up a template by id — used by the scene-store action that
 *  actually instantiates one. */
export function getSceneTemplate(id: string): SceneTemplate | null {
  return SCENE_TEMPLATES.find((t) => t.id === id) ?? null;
}
