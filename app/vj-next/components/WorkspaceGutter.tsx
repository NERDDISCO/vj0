"use client";

import { useCallback, useRef } from "react";
import { useLayoutStore } from "@/src/lib/stores/layout-store";

interface WorkspaceGutterProps {
  /** Which column the gutter sits to the right of. */
  after: "input" | "output";
}

/**
 * WorkspaceGutter — the drag handle between two workspace columns.
 *
 * Dragging converts the pointer's x-delta into a fraction of the
 * workspace width and writes it to the layout store, which persists it.
 * Double-click resets both columns to their defaults.
 */
export function WorkspaceGutter({ after }: WorkspaceGutterProps) {
  const setInputFr = useLayoutStore((s) => s.setInputFr);
  const setOutputFr = useLayoutStore((s) => s.setOutputFr);
  const resetLayout = useLayoutStore((s) => s.resetLayout);
  const drag = useRef<{ startX: number; startFr: number; width: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const workspace = e.currentTarget.parentElement;
      if (!workspace) return;
      const { inputFr, outputFr } = useLayoutStore.getState();
      drag.current = {
        startX: e.clientX,
        startFr: after === "input" ? inputFr : outputFr,
        width: workspace.getBoundingClientRect().width,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.classList.add("vp-resizing");
    },
    [after],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d) return;
      const fr = d.startFr + (e.clientX - d.startX) / d.width;
      if (after === "input") setInputFr(fr);
      else setOutputFr(fr);
    },
    [after, setInputFr, setOutputFr],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.classList.remove("vp-resizing");
  }, []);

  return (
    <div
      className="vp-gutter"
      role="separator"
      aria-orientation="vertical"
      aria-label={`resize ${after} column`}
      title="drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={resetLayout}
    />
  );
}
