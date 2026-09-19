/**
 * Patch Studio — data model
 *
 * The composer turns the input pane from "one of N hard-coded scenes" into
 * a freeform composition surface. A Scene is now a bag of Elements (vector
 * primitives placed by the user) plus a prompt that the AI side reads when
 * generating. Each Element exposes Properties (size, x, y, color, …) and any
 * numeric Property can be bound to an AudioPreset, which is a saved formula
 * that maps audio features to a 0..1 modulation value.
 *
 * AudioPresets are global on purpose. The user spelled this out:
 *
 *   > The audio presets are actually across scenes and not scene-specific
 *   > because you always want to reuse stuff globally.
 *
 * So we keep two stores: one for scenes (which only references presets by id)
 * and one for the preset library itself.
 */

import type { AudioFeatures } from "../audio-features";

// ─────────────────────────────────────────────────────────────────
// Audio feature short-names — match what the formula language exposes.
// Keeping the formula vocabulary tight (6 features + t, v) means the
// expression box can autocomplete and validate without becoming an IDE.
// ─────────────────────────────────────────────────────────────────
export const AUDIO_FEATURE_KEYS = [
  "rms",
  "peak",
  "low",
  "mid",
  "high",
  "bright",
] as const;
export type AudioFeatureKey = (typeof AUDIO_FEATURE_KEYS)[number];

/** Map AudioFeatures (full names) → formula-friendly short keys. */
export function shortenFeatures(f: AudioFeatures | null): Record<AudioFeatureKey, number> {
  if (!f) {
    return { rms: 0, peak: 0, low: 0, mid: 0, high: 0, bright: 0 };
  }
  return {
    rms: f.rms,
    peak: f.peak,
    low: f.energyLow,
    mid: f.energyMid,
    high: f.energyHigh,
    bright: f.spectralCentroid,
  };
}

// ─────────────────────────────────────────────────────────────────
// Element model
// ─────────────────────────────────────────────────────────────────

export type ElementKind =
  | "circle"
  | "rectangle"
  | "line"
  | "text"
  | "ring"
  | "triangle"
  | "waveform"
  | "image";

/**
 * Properties that drive an Element. We keep the schema flat (no nested
 * objects) so the inspector can iterate properties uniformly and any one of
 * them can be bound to an AudioPreset by id.
 *
 * Position + size are normalized 0..1 in scene-space so a scene renders
 * identically at any output resolution.
 */
export interface ElementProperties {
  /** Center X in scene-space, 0..1 */
  x: number;
  /** Center Y in scene-space, 0..1 */
  y: number;
  /** Size in scene-space, 0..1. Means radius for circles, width for boxes. */
  size: number;
  /** Aspect ratio multiplier — width/height stretch for rect/triangle/text */
  aspect: number;
  /** Rotation in turns (0..1, full circle = 1). */
  rotation: number;
  /** Fill color, "#rrggbb" */
  color: string;
  /** 0..1 opacity */
  opacity: number;
  /** 0..1 stroke width relative to size; 0 = no stroke, fill only. */
  stroke: number;
  /** Free text — only meaningful for `text` element kind. */
  text: string;
  /** Off = not drawn anywhere (source, overlay, hit-test). Toggle from the
   *  inspector or a Launchpad pad — lets a logo be armed for a drop. */
  enabled: boolean;
  /**
   * Overlay blend for `image` kind, 0..1. 0 = pure window: the AI frame
   * shows through the logo shape (boosted + rim glow). 1 = the flat logo.
   * Bindable, so a kick can pulse the logo solid.
   */
  mix: number;
  /** Asset id (uploaded logo/image) — only meaningful for `image` kind. */
  assetId: string;
  /**
   * Where an `image` element is drawn — only meaningful for `image` kind.
   *   source  → into the input canvas the AI restyles (logo dissolves at
   *             low alpha, but the model riffs on its silhouette)
   *   overlay → crisp on top of the AI output (preview, projector)
   *   both    → the two combined (default for logos)
   *   mask    → the logo is a window over the whole output: black
   *             everywhere, the AI visuals only inside the logo shape.
   *             Not fed to the AI. Toggle the element to drop in/out.
   */
  placement: ImagePlacement;
}

export type ImagePlacement = "source" | "overlay" | "both" | "mask";

/** Default overlay mix for a new logo — picked from mockups on 2026-09-19. */
export const DEFAULT_LOGO_MIX = 0.45;

export type PropertyKey =
  | "x"
  | "y"
  | "size"
  | "aspect"
  | "rotation"
  | "opacity"
  | "stroke"
  | "mix";
// Note: `color`, `text` and `assetId` aren't in PropertyKey because they
// can't be audio-bound — they have non-scalar values. We could add
// hue-shift later.

export const NUMERIC_PROPERTY_KEYS: PropertyKey[] = [
  "x",
  "y",
  "size",
  "aspect",
  "rotation",
  "opacity",
  "stroke",
  "mix",
];

/** Numeric keys that only make sense for a given kind (hidden elsewhere). */
export const KIND_ONLY_PROPERTY_KEYS: Partial<Record<PropertyKey, ElementKind>> = {
  mix: "image",
};

/**
 * Range and stepping for each numeric property. The formula language always
 * outputs 0..1 — we then linearly map that into the property's natural range.
 * This lets the same preset ("size from rms") drive both a position (0..1)
 * and a stroke (0..1) without surprises.
 */
export const PROPERTY_META: Record<
  PropertyKey,
  { min: number; max: number; step: number; label: string }
> = {
  x:        { min: 0,    max: 1,    step: 0.001, label: "x" },
  y:        { min: 0,    max: 1,    step: 0.001, label: "y" },
  size:     { min: 0,    max: 1,    step: 0.001, label: "size" },
  aspect:   { min: 0.1,  max: 4,    step: 0.01,  label: "aspect" },
  rotation: { min: 0,    max: 1,    step: 0.001, label: "rot" },
  opacity:  { min: 0,    max: 1,    step: 0.01,  label: "opacity" },
  stroke:   { min: 0,    max: 0.4,  step: 0.001, label: "stroke" },
  mix:      { min: 0,    max: 1,    step: 0.01,  label: "mix" },
};

/**
 * Property-level binding to an AudioPreset. Stored on the Element itself, by
 * preset id. The Element also remembers each property's "base" value so that
 * unbinding a preset restores what the user had set manually.
 */
export interface PropertyBinding {
  /** AudioPreset id. */
  presetId: string;
  /**
   * How the preset's 0..1 output combines with the property's base value.
   *
   *   - "set":      output replaces base (mapped into the property range)
   *   - "add":      base + output * range
   *   - "multiply": base * (0.5 + output) — useful for size pulsing
   *
   * Default is "set" because that's what users mean 80% of the time
   * ("size = rms"), and we want bindings to feel snappy.
   */
  mode: "set" | "add" | "multiply";
}

export interface Element {
  id: string;
  kind: ElementKind;
  /** Display name — used in the inspector and command palette. */
  name: string;
  props: ElementProperties;
  /** Property bindings keyed by property name. Properties without a
   *  binding read straight from `props` each frame. */
  bindings: Partial<Record<PropertyKey, PropertyBinding>>;
}

// ─────────────────────────────────────────────────────────────────
// Scene model
// ─────────────────────────────────────────────────────────────────

export interface Scene {
  id: string;
  name: string;
  /** AI prompt for this scene. Empty allowed — element composition is
   *  meaningful even without an AI model attached. */
  prompt: string;
  /** RGBA backing color for the scene canvas. */
  background: string;
  /** Z-order is the order in this array (later = on top). */
  elements: Element[];
  createdAt: number;
}

// ─────────────────────────────────────────────────────────────────
// AudioPreset model
// ─────────────────────────────────────────────────────────────────

export interface AudioPreset {
  id: string;
  name: string;
  /**
   * The "primary" feature this preset is built around — used as a tag in
   * the UI and for grouping in the command palette ("RMS presets",
   * "Bright presets"). The formula can reference any features regardless.
   */
  primary: AudioFeatureKey;
  /**
   * Expression body — a string in the mini formula language. Receives the
   * audio-feature shortcuts plus `t` (time in seconds) and `v` (the
   * property's base value, 0..1 in property-space). Returns 0..1.
   *
   * Examples:
   *   "rms"
   *   "clamp(rms * 1.5, 0, 1)"
   *   "low > 0.4 ? 1 : 0"
   *   "lerp(v, rms, 0.7)"
   *   "sin(t * 2) * 0.5 + 0.5"
   */
  formula: string;
  createdAt: number;
}
