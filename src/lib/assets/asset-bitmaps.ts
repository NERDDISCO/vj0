/**
 * Runtime bitmap cache for assets.
 *
 * The composer's render loop is synchronous and allocation-free, so it
 * can't await a blob decode mid-frame. This module owns the decoded
 * `ImageBitmap` per asset id and exposes a sync `getAssetBitmap()` for
 * the hot path; misses draw a placeholder until the async load lands.
 *
 * SVGs are rasterized once at load time (max edge RASTER_MAX px) rather
 * than handed to drawImage as an <img>, because Chrome re-rasterizes an
 * SVG image element on every drawImage — far too slow at 60 fps. The
 * rasterized size comfortably covers the largest AI output preset
 * (1280×720) and a 4K projector stage.
 */

import { getAssetBlob } from "./asset-db";

const RASTER_MAX = 2048;
/** Fallback when an SVG carries neither width/height nor a viewBox. */
const SVG_FALLBACK_SIZE = 512;

const bitmaps = new Map<string, ImageBitmap>();
const previewUrls = new Map<string, string>();
const pending = new Map<string, Promise<ImageBitmap | null>>();

export interface DecodedAsset {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

/** Sync lookup for the render loop. Null while loading or if missing. */
export function getAssetBitmap(id: string): ImageBitmap | null {
  return bitmaps.get(id) ?? null;
}

/** Natural width/height ratio of a loaded asset; 1 while unknown. */
export function getAssetAspect(id: string): number {
  const b = bitmaps.get(id);
  return b && b.height > 0 ? b.width / b.height : 1;
}

/** Object URL for thumbnails in the UI. Null until the blob is loaded. */
export function getAssetPreviewUrl(id: string): string | null {
  return previewUrls.get(id) ?? null;
}

export function isSvg(blob: Blob, name = ""): boolean {
  return blob.type === "image/svg+xml" || /\.svg$/i.test(name);
}

/**
 * Chrome reports naturalWidth 300×150 for an SVG with only a viewBox, so
 * a logo exported without explicit dimensions would rasterize at the
 * wrong aspect. Copy viewBox dimensions onto the root element when
 * width/height are missing.
 */
export async function normalizeSvg(blob: Blob): Promise<Blob> {
  const text = await blob.text();
  const rootMatch = text.match(/<svg\b[^>]*>/i);
  if (!rootMatch) return blob;
  const root = rootMatch[0];
  const hasW = /\swidth\s*=/.test(root);
  const hasH = /\sheight\s*=/.test(root);
  if (hasW && hasH) return new Blob([text], { type: "image/svg+xml" });
  const vb = root.match(/viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)\s*["']/i);
  let w = SVG_FALLBACK_SIZE;
  let h = SVG_FALLBACK_SIZE;
  if (vb) {
    w = Math.max(1, parseFloat(vb[3]));
    h = Math.max(1, parseFloat(vb[4]));
  }
  const patched = root.replace(
    /<svg\b/i,
    `<svg${hasW ? "" : ` width="${w}"`}${hasH ? "" : ` height="${h}"`}`,
  );
  return new Blob([text.replace(root, patched)], { type: "image/svg+xml" });
}

async function rasterizeSvg(blob: Blob): Promise<DecodedAsset> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const nw = img.naturalWidth || SVG_FALLBACK_SIZE;
    const nh = img.naturalHeight || SVG_FALLBACK_SIZE;
    const scale = Math.min(1e6, RASTER_MAX / Math.max(nw, nh));
    const w = Math.max(1, Math.round(nw * scale));
    const h = Math.max(1, Math.round(nh * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable");
    ctx.drawImage(img, 0, 0, w, h);
    return { bitmap: canvas.transferToImageBitmap(), width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decode any supported image blob to an ImageBitmap (alpha preserved). */
export async function decodeAsset(blob: Blob, name = ""): Promise<DecodedAsset> {
  if (isSvg(blob, name)) return rasterizeSvg(blob);
  const bitmap = await createImageBitmap(blob);
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

/** Put an already-decoded asset into the cache (used right after upload). */
export function cacheAsset(id: string, blob: Blob, decoded: DecodedAsset): void {
  unloadAsset(id);
  bitmaps.set(id, decoded.bitmap);
  previewUrls.set(id, URL.createObjectURL(blob));
}

/** Load an asset from IndexedDB into the cache. Idempotent + coalesced. */
export function loadAsset(id: string, name = ""): Promise<ImageBitmap | null> {
  const have = bitmaps.get(id);
  if (have) return Promise.resolve(have);
  const inflight = pending.get(id);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const blob = await getAssetBlob(id);
      if (!blob) return null;
      const decoded = await decodeAsset(blob, name);
      cacheAsset(id, blob, decoded);
      return decoded.bitmap;
    } catch (err) {
      console.warn(`[assets] failed to load ${id}`, err);
      return null;
    } finally {
      pending.delete(id);
    }
  })();
  pending.set(id, p);
  return p;
}

export function unloadAsset(id: string): void {
  bitmaps.get(id)?.close();
  bitmaps.delete(id);
  const url = previewUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  previewUrls.delete(id);
}
