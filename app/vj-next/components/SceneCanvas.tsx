"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
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
  const [isDragging, setIsDragging] = useState(false);
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

  // ─── Element click → select; element drag → reposition ─────────
  // Hit-testing is done at click time using the *current* resolved bounding
  // box of each element (so audio-modulated positions still hit). We loop
  // back to front so top-most element wins.
  const dragRef = useRef<{
    elementId: string;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  const hitTestElement = useCallback(
    (sceneX: number, sceneY: number, scene: Scene): Element | null => {
      const features = audioFeaturesRef.current;
      const t = (performance.now() - startedAt) / 1000;
      // Iterate in reverse z-order
      for (let i = scene.elements.length - 1; i >= 0; i--) {
        const el = scene.elements[i];
        const r = resolveElementProperties(el, features, presetMap, t);
        const dx = sceneX - r.x;
        const dy = sceneY - r.y;
        // Approximate bounding box. Size in scene-space derived from the
        // canvas's smaller dim — but we don't have access to dims here, so
        // use an aspect-aware square hit using the larger of the two.
        const radius = Math.max(0.02, r.size * 0.55); // a forgiving target
        if (Math.abs(dx) <= radius * (el.kind === "line" ? 1.6 : 1) &&
            Math.abs(dy) <= radius / Math.max(0.6, r.aspect)) {
          return el;
        }
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
      const sceneX = clamp01((e.clientX - rect.left) / rect.width);
      const sceneY = clamp01((e.clientY - rect.top) / rect.height);
      const hit = hitTestElement(sceneX, sceneY, scene);
      if (hit) {
        selectElement(hit.id);
        dragRef.current = {
          elementId: hit.id,
          startX: sceneX,
          startY: sceneY,
          baseX: hit.props.x,
          baseY: hit.props.y,
        };
        setIsDragging(true);
        wrap.setPointerCapture(e.pointerId);
      } else {
        selectElement(null);
      }
    },
    [activeScene, hitTestElement, quickAdd, selectElement],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const wrap = wrapperRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const sceneX = (e.clientX - rect.left) / rect.width;
      const sceneY = (e.clientY - rect.top) / rect.height;
      const dx = sceneX - drag.startX;
      const dy = sceneY - drag.startY;
      updateElementProp(drag.elementId, "x", clamp01(drag.baseX + dx));
      updateElementProp(drag.elementId, "y", clamp01(drag.baseY + dy));
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
      setIsDragging(false);
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
  // The tick + wrapperRect + isDragging state objects are declared at the
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
    const sizePx = r.size * minDim;
    let halfW = sizePx;
    let halfH = sizePx / r.aspect;
    if (el.kind === "rectangle" || el.kind === "triangle") {
      halfW = sizePx;
      halfH = sizePx / r.aspect;
    } else if (el.kind === "line") {
      halfW = sizePx;
      halfH = Math.max(8, sizePx * 0.05);
    } else if (el.kind === "text") {
      halfW = sizePx * 1.3;
      halfH = sizePx * 0.5;
    }
    return {
      left: r.x * rect.width - halfW,
      top: r.y * rect.height - halfH,
      width: halfW * 2,
      height: halfH * 2,
    };
  }, [selectedElementId, activeScene, presetMap, tick, wrapperRect]);

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
        style={{ cursor: isDragging ? "grabbing" : "crosshair" }}
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

        {selectionStyle && (
          <div className="vp-selection" style={selectionStyle}>
            <b />
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
