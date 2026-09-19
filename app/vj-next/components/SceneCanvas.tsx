"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  PROPERTY_META,
  buildPresetMap,
  renderScene,
  resolveElementProperties,
  selectActiveScene,
  useSceneStore,
  usePresetStore,
  useUiStore,
} from "@/src/lib/composer";
import type { Element, ElementKind, Scene } from "@/src/lib/composer";
import type { AudioFeatures } from "@/src/lib/audio-features";
import { QuickAddMenu } from "./QuickAddMenu";
import { getAssetAspect } from "@/src/lib/assets";

interface SceneCanvasProps {
  /** Latest features from the audio engine, polled by the parent in rAF.
   *  Refs are passed (not props) so we don't re-render at audio rate. */
  audioFeaturesRef: React.MutableRefObject<AudioFeatures | null>;
  /** Live PCM buffer for the waveform element. May be null if the engine
   *  hasn't started yet — waveform falls back to a flat line. */
  timeDomainRef: React.MutableRefObject<Float32Array | null>;
  /** Time origin for the formula `t` variable. */
  startedAt: number;
  /** Receives the raw <canvas> element so the orchestrator's AI send
   *  loop can read pixels off it. The element is mounted lazily, so
   *  callers should treat null as "not yet available". */
  canvasRefCb?: (canvas: HTMLCanvasElement | null) => void;
}

/**
 * SceneCanvas — the input pane.
 *
 * Renders the active Scene's elements (with audio bindings resolved) onto an
 * HTMLCanvas, decorated with a dot-grid backdrop, optional bracket markers,
 * an empty-state hint, and a floating quick-add menu spawned by double-click.
 *
 * Selection is overlaid in DOM (positioned divs over the canvas), not painted
 * into the canvas itself — keeps the source canvas clean for downstream
 * sampling (the AI side reads it as an img2img source) and avoids redrawing
 * the marker every audio frame.
 */
export function SceneCanvas({
  audioFeaturesRef,
  timeDomainRef,
  startedAt,
  canvasRefCb,
}: SceneCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // Subscribe shallowly — re-renders only when scene/element/preset *identity*
  // changes (add/remove/select). Property edits are persisted but the canvas
  // re-reads from the store every frame inside the rAF loop.
  const activeScene = useSceneStore(selectActiveScene);
  const selectedElementId = useSceneStore((s) => s.selectedElementId);
  const presets = usePresetStore((s) => s.presets);
  const showGrid = useUiStore((s) => s.showGrid);
  const canvasLocked = useUiStore((s) => s.canvasLocked);

  const addElement = useSceneStore((s) => s.addElement);
  const selectElement = useSceneStore((s) => s.selectElement);
  const updateElementProp = useSceneStore((s) => s.updateElementProp);
  const removeElement = useSceneStore((s) => s.removeElement);
  const setShowGrid = useUiStore((s) => s.setShowGrid);
  const setCanvasLocked = useUiStore((s) => s.setCanvasLocked);

  // Quick-add menu state
  const [quickAdd, setQuickAdd] = useState<{
    pageX: number;
    pageY: number;
    sceneX: number;
    sceneY: number;
  } | null>(null);

  // Drag indicator + cached wrapper rect — declared up here so the
  // pointer-handler useCallbacks below them can capture stable setters
  // without React's lint flagging "use before declaration".
  const [dragMode, setDragMode] = useState<"move" | "resize" | null>(null);
  const [wrapperRect, setWrapperRect] = useState<DOMRect | null>(null);

  // 30 Hz audio+time snapshot — stored as React state so render and
  // useMemo bodies can read live values without dereferencing refs or
  // calling impure performance.now() during render. Declared up here for
  // the same reason as the drag/rect state.
  const [tick, setTick] = useState<{ t: number; features: AudioFeatures | null }>({
    t: 0,
    features: null,
  });

  // Memo'd preset lookup so we don't rebuild on every frame
  const presetMap = useMemo(() => buildPresetMap(presets), [presets]);

  // ─── Render loop ──────────────────────────────────────────────────
  // Wrapped in try/catch so a stale persisted scene with bad data (e.g.
  // a property like x/size set to NaN by an older store schema, or a
  // formula that throws after a binding loses its preset) can't kill the
  // loop permanently. If render throws we log it once and keep
  // re-scheduling so the next edit can recover.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let lastError: string | null = null;

    function frame() {
      const c = canvas;
      if (!c) return;
      try {
        // Resize the backing buffer if the CSS box changed (window
        // resize, sidebar collapse, etc.). devicePixelRatio is sampled
        // live so a user dragging the window between displays still
        // gets crisp output.
        const rect = c.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const targetW = Math.max(1, Math.round(rect.width * dpr));
        const targetH = Math.max(1, Math.round(rect.height * dpr));
        if (c.width !== targetW || c.height !== targetH) {
          c.width = targetW;
          c.height = targetH;
        }
        const ctx = c.getContext("2d");
        if (!ctx) return;

        // Re-read store state each frame so paint reflects the latest
        // edits without forcing a React re-render.
        const state = useSceneStore.getState();
        const scene = state.scenes.find((s) => s.id === state.activeSceneId);
        if (!scene) {
          ctx.clearRect(0, 0, c.width, c.height);
        } else {
          const tSec = (performance.now() - startedAt) / 1000;
          renderScene(
            ctx,
            scene,
            audioFeaturesRef.current,
            presetMap,
            tSec,
            c.width,
            c.height,
            timeDomainRef.current,
          );
        }
      } catch (err) {
        // Don't spam — log only when the error message changes. The loop
        // keeps running so the user can dismiss / fix / reset state and
        // see results immediately rather than having to reload.
        const msg = (err as Error)?.message ?? String(err);
        if (msg !== lastError) {
          // eslint-disable-next-line no-console
          console.error("[SceneCanvas] render error:", err);
          lastError = msg;
        }
      }
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [audioFeaturesRef, presetMap, startedAt]);

  // ─── Pointer interactions ─────────────────────────────────────────
  // Double-click → open quick-add at click point (in scene space)
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (canvasLocked) return;
      const wrap = wrapperRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const sceneX = clamp01(localX / rect.width);
      const sceneY = clamp01(localY / rect.height);
      setQuickAdd({
        pageX: localX,
        pageY: localY,
        sceneX,
        sceneY,
      });
    },
    [canvasLocked],
  );

  const handleQuickPick = useCallback(
    (kind: ElementKind) => {
      if (!quickAdd) return;
      addElement(kind, quickAdd.sceneX, quickAdd.sceneY);
      setQuickAdd(null);
    },
    [addElement, quickAdd],
  );

  // ─── Element click → select · drag → move · handles → resize ────
  // Hit-testing uses the *same* pixel bounds the selection box is drawn
  // with (elementHalfExtents), so whatever is inside the dashed box is
  // grabbable. Audio-modulated positions still hit because we resolve the
  // element at pointer time. Iterates back-to-front so the top-most wins.
  const dragRef = useRef<DragState | null>(null);

  const hitTestElement = useCallback(
    (px: number, py: number, scene: Scene, rect: DOMRect): Element | null => {
      const features = audioFeaturesRef.current;
      const t = (performance.now() - startedAt) / 1000;
      const minDim = Math.min(rect.width, rect.height);
      for (let i = scene.elements.length - 1; i >= 0; i--) {
        const el = scene.elements[i];
        if (el.props.enabled === false) continue;
        const r = resolveElementProperties(el, features, presetMap, t);
        const { halfW, halfH } = elementHalfExtents(el.kind, r.size, boxAspect(el, r.aspect), minDim);
        const dx = Math.abs(px - r.x * rect.width);
        const dy = Math.abs(py - r.y * rect.height);
        if (dx <= halfW + HIT_PAD_PX && dy <= halfH + HIT_PAD_PX) return el;
      }
      return null;
    },
    [audioFeaturesRef, presetMap, startedAt],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Quick-add menu open? Click outside closes it.
      if (quickAdd) {
        setQuickAdd(null);
      }
      const scene = activeScene;
      if (!scene) return;
      const wrap = wrapperRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const hit = hitTestElement(px, py, scene, rect);
      if (hit) {
        selectElement(hit.id);
        if (canvasLocked) return;
        dragRef.current = {
          mode: "move",
          elementId: hit.id,
          startX: px / rect.width,
          startY: py / rect.height,
          baseX: hit.props.x,
          baseY: hit.props.y,
        };
        setDragMode("move");
        wrap.setPointerCapture(e.pointerId);
      } else {
        selectElement(null);
      }
    },
    [activeScene, canvasLocked, hitTestElement, quickAdd, selectElement],
  );

  // Resize handles live inside the selection box. They stop propagation
  // so the wrapper's hit-test doesn't turn the gesture into a move.
  const handleResizeStart = useCallback(
    (e: React.PointerEvent<HTMLElement>, handle: ResizeHandle) => {
      e.stopPropagation();
      e.preventDefault();
      if (canvasLocked) return;
      const scene = activeScene;
      const wrap = wrapperRef.current;
      if (!scene || !wrap || !selectedElementId) return;
      const el = scene.elements.find((x) => x.id === selectedElementId);
      if (!el) return;
      const rect = wrap.getBoundingClientRect();
      const r = resolveElementProperties(el, audioFeaturesRef.current, presetMap, (performance.now() - startedAt) / 1000);
      const minDim = Math.min(rect.width, rect.height);
      const { halfW, halfH } = elementHalfExtents(el.kind, r.size, boxAspect(el, r.aspect), minDim);
      dragRef.current = {
        mode: "resize",
        elementId: el.id,
        kind: el.kind,
        // Images fold their bitmap's own ratio into the drag box; undo
        // that when writing `aspect` back so the stored value stays a
        // pure stretch factor.
        naturalAspect: el.kind === "image" ? getAssetAspect(el.props.assetId ?? "") : 1,
        handle,
        centerX: r.x * rect.width,
        centerY: r.y * rect.height,
        baseHalfW: halfW,
        baseHalfH: halfH,
      };
      setDragMode("resize");
      wrap.setPointerCapture(e.pointerId);
    },
    [activeScene, audioFeaturesRef, canvasLocked, presetMap, selectedElementId, startedAt],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const wrap = wrapperRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      if (drag.mode === "move") {
        const dx = px / rect.width - drag.startX;
        const dy = py / rect.height - drag.startY;
        updateElementProp(drag.elementId, "x", clamp01(drag.baseX + dx));
        updateElementProp(drag.elementId, "y", clamp01(drag.baseY + dy));
        return;
      }

      // Resize: the dragged handle follows the pointer, the centre stays
      // put, so the new half-extents are just |pointer − centre|.
      const minDim = Math.min(rect.width, rect.height);
      const h = drag.handle;
      const horizontal = h === "e" || h === "w" || h === "ne" || h === "nw" || h === "se" || h === "sw";
      const vertical = h === "n" || h === "s" || h === "ne" || h === "nw" || h === "se" || h === "sw";
      const halfW = horizontal ? Math.max(MIN_HALF_PX, Math.abs(px - drag.centerX)) : drag.baseHalfW;
      const halfH = vertical ? Math.max(MIN_HALF_PX, Math.abs(py - drag.centerY)) : drag.baseHalfH;
      const next = sizeAspectFromExtents(drag.kind, halfW, halfH, minDim);
      updateElementProp(drag.elementId, "size", next.size);
      if (next.aspect !== null) {
        const aspectMeta = PROPERTY_META.aspect;
        const stored = next.aspect / Math.max(0.01, drag.naturalAspect);
        updateElementProp(
          drag.elementId,
          "aspect",
          Math.max(aspectMeta.min, Math.min(aspectMeta.max, stored)),
        );
      }
    },
    [updateElementProp],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const wrap = wrapperRef.current;
      if (wrap?.hasPointerCapture(e.pointerId)) {
        wrap.releasePointerCapture(e.pointerId);
      }
      dragRef.current = null;
      setDragMode(null);
    },
    [],
  );

  // ─── Keyboard: Delete selected element ────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && selectedElementId) {
        e.preventDefault();
        removeElement(selectedElementId);
      } else if (e.key === "Escape") {
        if (quickAdd) {
          setQuickAdd(null);
        } else {
          selectElement(null);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedElementId, quickAdd, removeElement, selectElement]);

  // ─── Live resolved bbox for the selection marker ──────────────────
  // The tick + wrapperRect + dragMode state objects are declared at the
  // top of the component (above the pointer handlers) so callbacks can
  // capture them without lint errors. Below: the effects that drive them.
  useEffect(() => {
    const id = window.setInterval(() => {
      setTick({
        t: (performance.now() - startedAt) / 1000,
        features: audioFeaturesRef.current,
      });
    }, 1000 / 30);
    return () => window.clearInterval(id);
  }, [startedAt, audioFeaturesRef]);

  // Track wrapper size in state so renderers (selection marker) don't have
  // to read refs during render.
  useEffect(() => {
    const wrap = wrapperRef.current;
    if (!wrap) return;
    setWrapperRect(wrap.getBoundingClientRect());
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // entry.contentRect doesn't include the right left/top for fixed
        // positioning math — re-measure with getBoundingClientRect.
        setWrapperRect(entry.target.getBoundingClientRect());
      }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const selectionStyle = useMemo(() => {
    if (!selectedElementId || !activeScene || !wrapperRect) return null;
    const el = activeScene.elements.find((e) => e.id === selectedElementId);
    if (!el) return null;
    const r = resolveElementProperties(el, tick.features, presetMap, tick.t);
    const rect = wrapperRect;
    const minDim = Math.min(rect.width, rect.height);
    const { halfW, halfH } = elementHalfExtents(el.kind, r.size, boxAspect(el, r.aspect), minDim);
    return {
      left: r.x * rect.width - halfW,
      top: r.y * rect.height - halfH,
      width: halfW * 2,
      height: halfH * 2,
    };
  }, [selectedElementId, activeScene, presetMap, tick, wrapperRect]);

  const selectedKind = useMemo(
    () => activeScene?.elements.find((e) => e.id === selectedElementId)?.kind ?? null,
    [activeScene, selectedElementId],
  );

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <>
      <div
        className="vp-stage vp-stage--input"
        ref={wrapperRef}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ cursor: dragMode === "move" ? "grabbing" : dragMode === "resize" ? "inherit" : "crosshair" }}
      >
        <div className="vp-stage__brackets"><b /></div>

        {showGrid && <div className="vp-grid-bg" />}

        <canvas
          ref={(el) => {
            canvasRef.current = el;
            // Surface the raw element to the orchestrator so the AI
            // send loop can read pixels off it. Null on unmount.
            canvasRefCb?.(el);
          }}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            display: "block",
          }}
        />

        {/* Header strip — name + element count */}
        <div className="vp-stage__head">
          <span className="vp-stage__title">{activeScene?.name ?? "no scene"}</span>
          <span className="vp-stage__meta">
            input · <b>{activeScene?.elements.length ?? 0}</b> elements
          </span>
        </div>

        {/* Tool strip */}
        <div className="vp-stage-tools">
          <button
            type="button"
            className="vp-stage-tool"
            aria-pressed={showGrid}
            title="Toggle grid"
            onClick={() => setShowGrid(!showGrid)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="4" y="4" width="6" height="6" />
              <rect x="14" y="4" width="6" height="6" />
              <rect x="4" y="14" width="6" height="6" />
              <rect x="14" y="14" width="6" height="6" />
            </svg>
          </button>
          <button
            type="button"
            className="vp-stage-tool"
            aria-pressed={canvasLocked}
            title={canvasLocked ? "Unlock canvas" : "Lock canvas"}
            onClick={() => setCanvasLocked(!canvasLocked)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              {canvasLocked ? (
                <>
                  <rect x="5" y="11" width="14" height="9" rx="1.2" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </>
              ) : (
                <>
                  <rect x="5" y="11" width="14" height="9" rx="1.2" />
                  <path d="M8 11V8a4 4 0 0 1 7.3-2.3" />
                </>
              )}
            </svg>
          </button>
        </div>

        {activeScene && activeScene.elements.length === 0 && !quickAdd && (
          <div className="vp-canvas-hint">
            <b>EMPTY SCENE</b>
            <span>double-click anywhere to add an element</span>
            <i>or press ⌘K to search</i>
          </div>
        )}

        {selectionStyle && selectedKind && (
          <div
            className={`vp-selection ${canvasLocked ? "vp-selection--locked" : ""}`}
            style={selectionStyle}
          >
            {handlesForKind(selectedKind).map((h) => (
              <i
                key={h}
                className={`vp-selection__handle vp-selection__handle--${h}`}
                onPointerDown={(e) => handleResizeStart(e, h)}
                title="drag to resize"
              />
            ))}
          </div>
        )}

        {quickAdd && (
          <QuickAddMenu
            pageX={quickAdd.pageX}
            pageY={quickAdd.pageY}
            sceneX={quickAdd.sceneX}
            sceneY={quickAdd.sceneY}
            onPick={handleQuickPick}
            onClose={() => setQuickAdd(null)}
          />
        )}
      </div>
    </>
  );
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// ─── Selection geometry ──────────────────────────────────────────────
// One source of truth for "how big is this element on screen", shared by
// the dashed selection box, the pointer hit-test and the resize maths.
// Mirrors the per-kind sizing in composer/render.ts.

type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type DragState =
  | {
      mode: "move";
      elementId: string;
      startX: number;
      startY: number;
      baseX: number;
      baseY: number;
    }
  | {
      mode: "resize";
      naturalAspect: number;
      elementId: string;
      kind: ElementKind;
      handle: ResizeHandle;
      centerX: number;
      centerY: number;
      baseHalfW: number;
      baseHalfH: number;
    };

/** Extra grab margin around an element's box, in CSS px. */
const HIT_PAD_PX = 6;
/** Smallest half-extent a resize can produce, in CSS px. */
const MIN_HALF_PX = 4;

const ALL_HANDLES: ReadonlyArray<ResizeHandle> = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CORNER_HANDLES: ReadonlyArray<ResizeHandle> = ["nw", "ne", "se", "sw"];
const HORIZONTAL_HANDLES: ReadonlyArray<ResizeHandle> = ["nw", "ne", "se", "sw", "e", "w"];

/** Which handles make sense for a kind (lines have no height to drag). */
function handlesForKind(kind: ElementKind): ReadonlyArray<ResizeHandle> {
  if (kind === "line") return HORIZONTAL_HANDLES;
  if (kind === "text") return CORNER_HANDLES;
  return ALL_HANDLES;
}

/**
 * Effective width/height ratio of an element's box. For everything but
 * images that's the `aspect` prop; images also carry the bitmap's own
 * ratio (render.ts derives height from it).
 */
function boxAspect(el: Element, aspect: number): number {
  if (el.kind !== "image") return aspect;
  return aspect * getAssetAspect(el.props.assetId ?? "");
}

function elementHalfExtents(
  kind: ElementKind,
  size: number,
  aspect: number,
  minDim: number,
): { halfW: number; halfH: number } {
  const sizePx = size * minDim;
  const a = Math.max(0.01, aspect);
  switch (kind) {
    case "line":
      return { halfW: sizePx, halfH: Math.max(8, sizePx * 0.05) };
    case "text":
      return { halfW: sizePx * 1.3, halfH: sizePx * 0.5 };
    default:
      // circle / ring (ellipse radii), rectangle / triangle / waveform
      // (width = size×2, height = width / aspect).
      return { halfW: sizePx, halfH: sizePx / a };
  }
}

/**
 * Inverse of elementHalfExtents: given the box the user dragged out,
 * produce the size (and aspect, where the kind has one) that draws it.
 */
function sizeAspectFromExtents(
  kind: ElementKind,
  halfW: number,
  halfH: number,
  minDim: number,
): { size: number; aspect: number | null } {
  const sizeMeta = PROPERTY_META.size;
  const aspectMeta = PROPERTY_META.aspect;
  const clampSize = (v: number) => Math.max(0.005, Math.min(sizeMeta.max, v));
  switch (kind) {
    case "line":
      return { size: clampSize(halfW / minDim), aspect: null };
    case "text":
      // Corners only: take whichever axis the user stretched further.
      return {
        size: clampSize(Math.max(halfW / 1.3, halfH / 0.5) / minDim),
        aspect: null,
      };
    default: {
      const size = clampSize(halfW / minDim);
      const aspect = Math.max(aspectMeta.min, Math.min(aspectMeta.max, halfW / Math.max(1, halfH)));
      return { size, aspect };
    }
  }
}
