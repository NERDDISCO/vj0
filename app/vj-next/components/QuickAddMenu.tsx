"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import type { ElementKind } from "@/src/lib/composer";

interface KindEntry {
  kind: ElementKind;
  label: string;
  description: string;
  icon: React.ReactNode;
}

// Pulled out so the Search-here behavior the user asked for ("good search
// and findability so you can always find what you want, including the
// search here as well") gets a real list to filter against, even before we
// add user-defined element types.
const ELEMENT_LIBRARY: KindEntry[] = [
  {
    kind: "circle",
    label: "circle",
    description: "filled disc",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="9" />
      </svg>
    ),
  },
  {
    kind: "ring",
    label: "ring",
    description: "stroked circle",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
      </svg>
    ),
  },
  {
    kind: "rectangle",
    label: "box",
    description: "rectangle",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="6" width="18" height="12" rx="0.6" />
      </svg>
    ),
  },
  {
    kind: "triangle",
    label: "tri",
    description: "triangle",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 4l9 16H3z" />
      </svg>
    ),
  },
  {
    kind: "line",
    label: "line",
    description: "stroke segment",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 18 21 6" />
      </svg>
    ),
  },
  {
    kind: "text",
    label: "text",
    description: "doto label",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M5 7V5h14v2M12 5v14M9 19h6" />
      </svg>
    ),
  },
  {
    kind: "waveform",
    label: "wave",
    description: "live waveform strip",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M2 12c2 0 2-6 4-6s2 12 4 12 2-9 4-9 2 6 4 6 2-3 4-3" />
      </svg>
    ),
  },
  {
    kind: "image",
    label: "logo",
    description: "uploaded svg / png image",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="4" width="18" height="16" rx="1" />
        <circle cx="9" cy="10" r="2" />
        <path d="M3 18l6-5 4 3 3-2 5 4" />
      </svg>
    ),
  },
];

interface QuickAddMenuProps {
  /** Position in *page* pixels — caller computes from canvas event. */
  pageX: number;
  pageY: number;
  /** Position in scene-space (0..1) for the readout. */
  sceneX: number;
  sceneY: number;
  onPick: (kind: ElementKind) => void;
  onClose: () => void;
}

/**
 * Floating quick-add menu — surfaces over the scene canvas at the spot the
 * user double-clicked. Search is auto-focused so a VJ can keep their hands on
 * the keyboard between sets. Arrow keys + enter for full no-mouse flow.
 */
export function QuickAddMenu({
  pageX,
  pageY,
  sceneX,
  sceneY,
  onPick,
  onClose,
}: QuickAddMenuProps) {
  const [query, setQuery] = useState("");
  const [focusIdx, setFocusIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ELEMENT_LIBRARY;
    return ELEMENT_LIBRARY.filter(
      (e) => e.label.includes(q) || e.kind.includes(q) || e.description.includes(q),
    );
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  // Note: focusIdx reset on query change happens in the input's onChange
  // handler — React 19's lint discourages setState-in-effect for derived
  // state, and "first match becomes focused" is naturally a derived value
  // of the current query (we want it 0 every time the query updates).

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setFocusIdx((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIdx((i) => Math.min(filtered.length - 1, i + 3));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, i - 3));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const picked = filtered[focusIdx];
        if (picked) onPick(picked.kind);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, focusIdx, onClose, onPick]);

  return (
    <div
      className="vp-quickadd"
      style={{ left: pageX, top: pageY }}
      // Stop pointer + mouse propagation so the parent SceneCanvas's
      // onPointerDown handler doesn't fire when the user clicks an item
      // inside the menu. Without this, pointer-down on the button bubbles
      // to the wrapper, which sets `quickAdd` to null, which makes React
      // unmount the menu before the click event lands — meaning the
      // button's onClick never runs and "click circle" silently does
      // nothing. (Enter still worked because keyboard events don't go
      // through the wrapper's pointer chain.)
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="vp-quickadd__head">
        <span className="vp-quickadd__title">+ add element</span>
        <span className="vp-quickadd__coords">
          {(sceneX * 100).toFixed(0)}.{(sceneY * 100).toFixed(0)}
        </span>
      </div>
      <input
        ref={inputRef}
        className="vp-quickadd__search"
        placeholder="search elements…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setFocusIdx(0);
        }}
      />
      <div className="vp-quickadd__list">
        {filtered.map((entry, i) => (
          <button
            key={entry.kind}
            className="vp-quickadd__item"
            data-focus={i === focusIdx ? "true" : undefined}
            onClick={() => onPick(entry.kind)}
            onMouseEnter={() => setFocusIdx(i)}
            type="button"
          >
            {entry.icon}
            <span className="vp-quickadd__label">{entry.label}</span>
          </button>
        ))}
      </div>
      <div className="vp-quickadd__hint">
        ↵ add · ⎋ cancel · type to filter
      </div>
    </div>
  );
}

export { ELEMENT_LIBRARY };
