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
import { getAssetBitmap } from "../assets/asset-bitmaps";

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
  target.assetId = el.props.assetId;
  target.placement = el.props.placement;
  target.enabled = el.props.enabled ?? true;

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
    case "image": {
      // Width = size×2 like a rectangle; height follows the bitmap's own
      // aspect, with `aspect` as an extra stretch on top. Alpha in the
      // bitmap composites over whatever is already on the canvas.
      const w = sizePx * 2;
      const bmp = resolved.assetId ? getAssetBitmap(resolved.assetId) : null;
      if (bmp) {
        const h = (w * bmp.height) / bmp.width / Math.max(0.01, aspect);
        ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
      } else {
        // Placeholder: dashed box + cross so the user sees where the logo
        // will land while it loads or if the asset was deleted.
        const h = w / Math.max(0.01, aspect);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(-w / 2, -h / 2, w, h);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(-w / 2, -h / 2);
        ctx.lineTo(w / 2, h / 2);
        ctx.moveTo(w / 2, -h / 2);
        ctx.lineTo(-w / 2, h / 2);
        ctx.stroke();
      }
      break;
    }
  }

  ctx.restore();
}

/** Wipe the cache for a removed element so we don't grow unbounded. */
export function purgeElementCache(elementId: string): void {
  resolvedCache.delete(elementId);
}

/** Does this element belong in the source canvas (the AI's input)? */
function inSourcePass(el: Element): boolean {
  if (el.props.enabled === false) return false;
  if (el.kind !== "image") return true;
  const p = el.props.placement ?? "both";
  return p === "source" || p === "both";
}

/** Does this element get drawn crisp on top of the AI output? */
function inOverlayPass(el: Element): boolean {
  if (el.props.enabled === false) return false;
  if (el.kind !== "image") return false;
  const p = el.props.placement ?? "both";
  return p === "overlay" || p === "both" || p === "mask";
}

/**
 * Convenience: paint a whole scene. Used by both the input canvas and the
 * preset preview. The caller controls clearing — usually the scene's own
 * background. `timeDomain` is forwarded to renderElement so waveform
 * elements can draw the live PCM buffer. Image elements placed
 * "overlay" are skipped here — see collectOverlayItems.
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
    if (!inSourcePass(el)) continue;
    const resolved = resolveElementProperties(el, features, presetMap, tSeconds);
    renderElement(ctx, el, resolved, width, height, timeDomain);
  }
}

// ─── Overlay pass ────────────────────────────────────────────────────
//
// Logos that must stay legible can't survive the img2img restyle (tested
// on FLUX.2 Klein: at alpha ≤ 0.2 text scrambles or dissolves; at ≥ 0.35
// the AI barely changes the frame). So they get a second, crisp pass on
// top of the AI output. The pass is expressed as a flat list of resolved
// items so the same data can be drawn on the preview and posted over the
// BroadcastChannel to the projector tab (which has no audio features).

export interface OverlayItem {
  assetId: string;
  /** Centre, scene-space 0..1. */
  x: number;
  y: number;
  /** Half-width as a fraction of min(width, height) — matches `size`. */
  size: number;
  aspect: number;
  /** Turns. */
  rotation: number;
  opacity: number;
  /** 0 = window into the AI frame, 1 = flat logo. */
  mix: number;
  /** Rim-glow colour, "#rrggbb". */
  color: string;
  /** Full-frame mask: black outside the logo, backdrop inside. */
  mask: boolean;
}

const overlayPool: OverlayItem[] = [];

/**
 * Resolve every overlay-placed image element into `out` (reused, no
 * allocations once the pool has grown to the scene's size). Returns the
 * number of live items.
 */
export function collectOverlayItems(
  scene: Scene,
  features: AudioFeatures | null,
  presetMap: Map<string, AudioPreset>,
  tSeconds: number,
  out: OverlayItem[] = overlayPool,
): number {
  let n = 0;
  for (const el of scene.elements) {
    if (!inOverlayPass(el) || !el.props.assetId) continue;
    const r = resolveElementProperties(el, features, presetMap, tSeconds);
    let item = out[n];
    if (!item) {
      item = {
        assetId: "", x: 0, y: 0, size: 0, aspect: 1, rotation: 0, opacity: 1, mix: 1, color: "#ffffff",
        mask: false,
      };
      out[n] = item;
    }
    item.assetId = r.assetId;
    item.x = r.x;
    item.y = r.y;
    item.size = r.size;
    item.aspect = r.aspect;
    item.rotation = r.rotation;
    item.opacity = r.opacity;
    item.mix = r.mix;
    item.color = r.color;
    item.mask = (r.placement ?? "both") === "mask";
    n++;
  }
  return n;
}

// Scratch canvases for the cutout compositing. Grow-only, shared by every
// item and every frame — no per-frame allocation once warm.
let scratchA: OffscreenCanvas | HTMLCanvasElement | null = null;
let scratchB: OffscreenCanvas | HTMLCanvasElement | null = null;
let scratchACtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
let scratchBCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

function scratch(
  which: "a" | "b",
  w: number,
  h: number,
): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null {
  let c = which === "a" ? scratchA : scratchB;
  let ctx = which === "a" ? scratchACtx : scratchBCtx;
  if (!c) {
    c = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(w, h)
      : document.createElement("canvas");
    ctx = c.getContext("2d") as typeof ctx;
    if (which === "a") { scratchA = c; scratchACtx = ctx; } else { scratchB = c; scratchBCtx = ctx; }
  }
  if (c.width < w || c.height < h) {
    c.width = Math.max(c.width, w);
    c.height = Math.max(c.height, h);
  }
  return ctx;
}

function sourceSize(src: CanvasImageSource): { w: number; h: number } {
  if (src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
  const any = src as { width: number; height: number };
  return { w: any.width, h: any.height };
}

/**
 * Draw `count` overlay items from `items` onto a (cleared) canvas.
 *
 * With a `backdrop` (the AI frame: <img> on the preview, WebGL canvas on
 * the projector) each logo becomes a window: the frame shows through the
 * logo shape, boosted and tinted toward the logo by `mix`, with a soft
 * dark halo outside and a rim glow in `color`. Without a backdrop, or at
 * mix = 1, the flat logo is drawn. Compositing happens in a scratch
 * canvas the size of the logo's bounding box, so cost scales with logo
 * area, not stage area.
 */
export function renderOverlayItems(
  ctx: CanvasRenderingContext2D,
  items: OverlayItem[],
  count: number,
  width: number,
  height: number,
  backdrop: CanvasImageSource | null = null,
): void {
  const minDim = Math.min(width, height);
  const src = backdrop ? sourceSize(backdrop) : null;
  const hasBackdrop = !!backdrop && !!src && src.w > 0 && src.h > 0;

  // Mask pass first: one black plate for the whole frame, then every
  // mask logo punches its shape out of it (destination-out honours the
  // logo's alpha, so soft edges stay soft). The backdrop underneath the
  // overlay canvas shows through the holes. `mix` fades the flat logo
  // back in on top of the hole.
  let anyMask = false;
  for (let i = 0; i < count; i++) if (items[i].mask && getAssetBitmap(items[i].assetId)) anyMask = true;
  if (anyMask) {
    ctx.save();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < count; i++) {
      const it = items[i];
      if (!it.mask) continue;
      const bmp = getAssetBitmap(it.assetId);
      if (!bmp) continue;
      const w = it.size * minDim * 2;
      const h = (w * bmp.height) / bmp.width / Math.max(0.01, it.aspect);
      ctx.save();
      ctx.translate(it.x * width, it.y * height);
      if (it.rotation !== 0) ctx.rotate(it.rotation * Math.PI * 2);
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = it.opacity;
      ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
      const mix = it.mix < 0 ? 0 : it.mix > 1 ? 1 : it.mix;
      if (mix > 0) {
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = it.opacity * mix;
        ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  for (let i = 0; i < count; i++) {
    const it = items[i];
    if (it.mask) continue;
    const bmp = getAssetBitmap(it.assetId);
    if (!bmp) continue;
    const w = it.size * minDim * 2;
    const h = (w * bmp.height) / bmp.width / Math.max(0.01, it.aspect);
    const mix = it.mix < 0 ? 0 : it.mix > 1 ? 1 : it.mix;

    if (!hasBackdrop || mix >= 1) {
      ctx.save();
      ctx.globalAlpha = it.opacity;
      ctx.translate(it.x * width, it.y * height);
      if (it.rotation !== 0) ctx.rotate(it.rotation * Math.PI * 2);
      ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
      ctx.restore();
      continue;
    }

    // Bounding box of the (possibly rotated) logo plus glow margin, in
    // overlay pixels. All scratch work happens in this box.
    const blur = Math.max(4, w * 0.06);
    const pad = Math.ceil(blur * 3);
    const cos = Math.abs(Math.cos(it.rotation * Math.PI * 2));
    const sin = Math.abs(Math.sin(it.rotation * Math.PI * 2));
    const bw = Math.ceil(w * cos + h * sin) + pad * 2;
    const bh = Math.ceil(w * sin + h * cos) + pad * 2;
    const bx = Math.round(it.x * width - bw / 2);
    const by = Math.round(it.y * height - bh / 2);
    const a = scratch("a", bw, bh);
    const b = scratch("b", bw, bh);
    if (!a || !b) continue;
    const drawLogo = (c: typeof a) => {
      c.save();
      c.translate(bw / 2, bh / 2);
      if (it.rotation !== 0) c.rotate(it.rotation * Math.PI * 2);
      c.drawImage(bmp, -w / 2, -h / 2, w, h);
      c.restore();
    };

    // 1. Dark halo: blurred black logo minus the logo itself.
    b.save();
    b.clearRect(0, 0, bw, bh);
    b.globalCompositeOperation = "source-over";
    b.shadowColor = "rgba(0,0,0,1)";
    b.shadowBlur = blur * 2.5;
    drawLogo(b);
    drawLogo(b);
    b.shadowBlur = 0;
    b.globalCompositeOperation = "destination-out";
    drawLogo(b);
    b.restore();
    ctx.save();
    ctx.globalAlpha = it.opacity * 0.75;
    ctx.drawImage(b.canvas, 0, 0, bw, bh, bx, by, bw, bh);
    ctx.restore();

    // 2. Window: the backdrop through the logo shape, boosted, then the
    //    flat logo blended in at `mix` (source-atop keeps the shape).
    a.save();
    a.clearRect(0, 0, bw, bh);
    a.globalCompositeOperation = "source-over";
    drawLogo(a);
    a.globalCompositeOperation = "source-in";
    a.filter = "brightness(2) saturate(1.6) contrast(1.2)";
    const sx = src!.w / width;
    const sy = src!.h / height;
    a.drawImage(backdrop!, bx * sx, by * sy, bw * sx, bh * sy, 0, 0, bw, bh);
    a.filter = "none";
    if (mix > 0) {
      a.globalCompositeOperation = "source-atop";
      a.globalAlpha = mix;
      drawLogo(a);
    }
    a.restore();
    ctx.save();
    ctx.globalAlpha = it.opacity;
    ctx.drawImage(a.canvas, 0, 0, bw, bh, bx, by, bw, bh);
    ctx.restore();

    // 3. Rim glow in the logo colour, additive.
    b.save();
    b.clearRect(0, 0, bw, bh);
    b.globalCompositeOperation = "source-over";
    b.shadowColor = it.color;
    b.shadowBlur = blur;
    drawLogo(b);
    b.shadowBlur = 0;
    b.globalCompositeOperation = "destination-out";
    drawLogo(b);
    b.restore();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = it.opacity * 0.9;
    ctx.drawImage(b.canvas, 0, 0, bw, bh, bx, by, bw, bh);
    ctx.restore();
  }
}
