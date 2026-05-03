/**
 * Composer renderer — paints a Scene's Elements onto a CanvasRenderingContext2D
 * each frame, applying any audio-preset bindings to property values first.
 *
 * Designed to be called from a single rAF loop owned by the React component.
 * No allocations in the hot path: the resolved-properties object is reused.
 */

import type { AudioFeatures } from "../audio-features";
import {
  shortenFeatures,
  type Element,
  type ElementProperties,
  type AudioPreset,
  type Scene,
  PROPERTY_META,
  NUMERIC_PROPERTY_KEYS,
} from "./types";
import { compileFormula, type FormulaInput } from "./formula";

// Reuse one "resolved properties" object per element to avoid GC pressure.
// Keyed by element id.
const resolvedCache = new Map<string, ElementProperties>();

const formulaInput: FormulaInput = {
  rms: 0,
  peak: 0,
  low: 0,
  mid: 0,
  high: 0,
  bright: 0,
  t: 0,
  v: 0,
};

export function resolveElementProperties(
  el: Element,
  features: AudioFeatures | null,
  presets: Map<string, AudioPreset>,
  tSeconds: number,
): ElementProperties {
  let target = resolvedCache.get(el.id);
  if (!target) {
    target = { ...el.props };
    resolvedCache.set(el.id, target);
  }

  // Copy non-numeric props as-is, then resolve each numeric prop with binding.
  target.color = el.props.color;
  target.text = el.props.text;

  const short = shortenFeatures(features);
  formulaInput.rms = short.rms;
  formulaInput.peak = short.peak;
  formulaInput.low = short.low;
  formulaInput.mid = short.mid;
  formulaInput.high = short.high;
  formulaInput.bright = short.bright;
  formulaInput.t = tSeconds;

  for (const key of NUMERIC_PROPERTY_KEYS) {
    const base = el.props[key];
    const binding = el.bindings[key];
    if (!binding) {
      target[key] = base;
      continue;
    }
    const preset = presets.get(binding.presetId);
    if (!preset) {
      target[key] = base;
      continue;
    }
    const compiled = compileFormula(preset.formula);
    if (typeof compiled === "string") {
      // Formula has an error — fall back to base so the element doesn't
      // disappear or freeze. The preset card in the drawer surfaces the err.
      target[key] = base;
      continue;
    }
    const meta = PROPERTY_META[key];
    // `v` is the property's *normalized* base — i.e. base mapped into 0..1
    // of its own range. Lets formulas like `v + rms * 0.3` work uniformly
    // across properties that have different natural ranges.
    formulaInput.v = (base - meta.min) / (meta.max - meta.min);
    const out = compiled.fn(formulaInput); // 0..1

    let resolved01: number;
    switch (binding.mode) {
      case "set":
        resolved01 = out;
        break;
      case "add":
        resolved01 = formulaInput.v + out;
        break;
      case "multiply":
        // 0.5 + out lets a binding actually modulate around v rather than
        // collapse to 0 when the audio's quiet.
        resolved01 = formulaInput.v * (0.5 + out);
        break;
    }
    if (resolved01 < 0) resolved01 = 0;
    if (resolved01 > 1) resolved01 = 1;

    target[key] = meta.min + resolved01 * (meta.max - meta.min);
  }

  return target;
}

/** Render one element using resolved properties.
 *
 *  `timeDomain` is the live waveform buffer from the AudioEngine — only
 *  the `waveform` kind reads it. Pass null when not available; the
 *  waveform renderer will draw a flat zero line (still visible, useful
 *  empty-state cue). */
export function renderElement(
  ctx: CanvasRenderingContext2D,
  el: Element,
  resolved: ElementProperties,
  width: number,
  height: number,
  timeDomain: Float32Array | null = null,
): void {
  const cx = resolved.x * width;
  const cy = resolved.y * height;
  // Size in pixels — based on the smaller dimension so a square preview at
  // any aspect feels right.
  const minDim = Math.min(width, height);
  const sizePx = resolved.size * minDim;
  const aspect = resolved.aspect;
  const strokePx = resolved.stroke * minDim;
  const rotationRad = resolved.rotation * Math.PI * 2;

  ctx.save();
  ctx.globalAlpha = resolved.opacity;
  ctx.translate(cx, cy);
  if (rotationRad !== 0) ctx.rotate(rotationRad);
  ctx.fillStyle = resolved.color;
  ctx.strokeStyle = resolved.color;
  ctx.lineWidth = strokePx;

  switch (el.kind) {
    case "circle": {
      ctx.beginPath();
      ctx.ellipse(0, 0, sizePx, sizePx / aspect, 0, 0, Math.PI * 2);
      if (strokePx > 0) ctx.stroke();
      else ctx.fill();
      break;
    }
    case "ring": {
      ctx.lineWidth = Math.max(1, strokePx > 0 ? strokePx : sizePx * 0.08);
      ctx.beginPath();
      ctx.ellipse(0, 0, sizePx, sizePx / aspect, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "rectangle": {
      const w = sizePx * 2;
      const h = (sizePx * 2) / aspect;
      if (strokePx > 0) {
        ctx.strokeRect(-w / 2, -h / 2, w, h);
      } else {
        ctx.fillRect(-w / 2, -h / 2, w, h);
      }
      break;
    }
    case "triangle": {
      const w = sizePx * 2;
      const h = (sizePx * 2) / aspect;
      ctx.beginPath();
      ctx.moveTo(0, -h / 2);
      ctx.lineTo(w / 2, h / 2);
      ctx.lineTo(-w / 2, h / 2);
      ctx.closePath();
      if (strokePx > 0) ctx.stroke();
      else ctx.fill();
      break;
    }
    case "line": {
      const w = sizePx * 2;
      ctx.lineWidth = Math.max(1, strokePx > 0 ? strokePx : sizePx * 0.05);
      ctx.beginPath();
      ctx.moveTo(-w / 2, 0);
      ctx.lineTo(w / 2, 0);
      ctx.stroke();
      break;
    }
    case "text": {
      const fontSize = sizePx * 0.8;
      ctx.font = `800 ${fontSize}px var(--font-doto), monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const text = resolved.text || "TEXT";
      if (strokePx > 0) ctx.strokeText(text, 0, 0);
      else ctx.fillText(text, 0, 0);
      break;
    }
    case "waveform": {
      // The "old" WaveformScene drew across the full canvas. Here it's
      // an Element bounded by size×aspect so the user can have several
      // waveforms in one scene (e.g. one per stage area). Width = size×2,
      // height = (size×2)/aspect. Stroke width modulates with audio
      // when bound to rms via a preset.
      const w = sizePx * 2;
      const h = (sizePx * 2) / Math.max(0.01, aspect);
      const lineWidth = Math.max(1, strokePx > 0 ? strokePx : Math.max(1.5, sizePx * 0.04));
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      const samples = timeDomain;
      if (!samples || samples.length === 0) {
        // Empty-state — flat line so the user sees where they put it.
        ctx.moveTo(-w / 2, 0);
        ctx.lineTo(w / 2, 0);
      } else {
        const step = w / (samples.length - 1);
        for (let i = 0; i < samples.length; i++) {
          const x = -w / 2 + i * step;
          // Time-domain values are -1..1 — map to ±h/2.
          const y = (samples[i] || 0) * (h / 2);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

/** Wipe the cache for a removed element so we don't grow unbounded. */
export function purgeElementCache(elementId: string): void {
  resolvedCache.delete(elementId);
}

/**
 * Convenience: paint a whole scene. Used by both the input canvas and the
 * preset preview. The caller controls clearing — usually the scene's own
 * background. `timeDomain` is forwarded to renderElement so waveform
 * elements can draw the live PCM buffer.
 */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  features: AudioFeatures | null,
  presetMap: Map<string, AudioPreset>,
  tSeconds: number,
  width: number,
  height: number,
  timeDomain: Float32Array | null = null,
): void {
  ctx.save();
  ctx.fillStyle = scene.background;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  for (const el of scene.elements) {
    const resolved = resolveElementProperties(el, features, presetMap, tSeconds);
    renderElement(ctx, el, resolved, width, height, timeDomain);
  }
}
