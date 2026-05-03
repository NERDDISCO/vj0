"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useSceneStore,
  usePresetStore,
  useUiStore,
} from "@/src/lib/composer";

type Item =
  | { type: "scene"; id: string; name: string; meta: string }
  | { type: "preset"; id: string; name: string; meta: string }
  | { type: "command"; id: string; name: string; meta: string; run: () => void };

/**
 * CommandPalette — the cmd+K global search.
 *
 * The user wrote:
 *
 *   > It should be super slick and easy to use, with good search and
 *   > findability so you can always find what you want, including the
 *   > search here as well.
 *
 * So this palette searches across:
 *   - Scenes (jump to)
 *   - Audio presets (open in drawer + edit)
 *   - Commands (toggle grid, open drawer, new scene/preset, etc.)
 *
 * Fuzzy-ish: substring match against name + meta. Arrow keys + enter for
 * full no-mouse flow; click works too.
 */
export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const openDrawer = useUiStore((s) => s.openDrawer);
  const setShowGrid = useUiStore((s) => s.setShowGrid);
  const showGrid = useUiStore((s) => s.showGrid);
  const setCanvasLocked = useUiStore((s) => s.setCanvasLocked);

  const scenes = useSceneStore((s) => s.scenes);
  const setActive = useSceneStore((s) => s.setActiveScene);
  const addScene = useSceneStore((s) => s.addScene);

  const presets = usePresetStore((s) => s.presets);
  const setEditing = usePresetStore((s) => s.setEditing);
  const addPreset = usePresetStore((s) => s.addPreset);

  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K toggle anywhere. We reset query+focus inline on the open
  // transition so we don't need a setState-in-effect (React 19 lint flags
  // that pattern). Same goes for the Escape close — opening always starts
  // from a blank query.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (!open) {
          setQuery("");
          setFocus(0);
          window.setTimeout(() => inputRef.current?.focus(), 0);
        }
        setOpen(!open);
      } else if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // When the palette opens via a button click rather than the keyboard
  // shortcut, focus the input on the next tick so the keyboard lands
  // there immediately.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const sceneItems: Item[] = scenes.map((sc) => ({
      type: "scene",
      id: sc.id,
      name: sc.name,
      meta: `${sc.elements.length} elements`,
    }));
    const presetItems: Item[] = presets.map((p) => ({
      type: "preset",
      id: p.id,
      name: p.name,
      meta: `${p.primary} · ${p.formula.slice(0, 40)}`,
    }));
    const commandItems: Item[] = [
      {
        type: "command",
        id: "cmd:new-scene",
        name: "Create new scene",
        meta: "scene",
        run: () => addScene(),
      },
      {
        type: "command",
        id: "cmd:new-preset",
        name: "Create new audio preset",
        meta: "preset",
        run: () => {
          addPreset();
          openDrawer("presets");
        },
      },
      {
        type: "command",
        id: "cmd:open-presets",
        name: "Open audio preset library",
        meta: "drawer",
        run: () => openDrawer("presets"),
      },
      {
        type: "command",
        id: "cmd:open-scenes",
        name: "Open scene library",
        meta: "drawer",
        run: () => openDrawer("scenes"),
      },
      {
        type: "command",
        id: "cmd:open-lighting",
        name: "Open lighting console",
        meta: "drawer",
        run: () => openDrawer("lighting"),
      },
      {
        type: "command",
        id: "cmd:toggle-grid",
        name: showGrid ? "Hide canvas grid" : "Show canvas grid",
        meta: "view",
        run: () => setShowGrid(!showGrid),
      },
      {
        type: "command",
        id: "cmd:lock-canvas",
        name: "Lock input canvas",
        meta: "view",
        run: () => setCanvasLocked(true),
      },
    ];
    return [...commandItems, ...sceneItems, ...presetItems];
  }, [scenes, presets, showGrid, addScene, addPreset, openDrawer, setShowGrid, setCanvasLocked]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    // Two-pass scoring: name matches rank above meta matches.
    const named = items.filter((i) => i.name.toLowerCase().includes(q));
    const named_ids = new Set(named.map((i) => i.id));
    const meta = items.filter(
      (i) => !named_ids.has(i.id) && i.meta.toLowerCase().includes(q),
    );
    return [...named, ...meta];
  }, [items, query]);

  // focus reset on query change happens inline in the input's onChange,
  // not in an effect — the new query is the source of truth for "first
  // match should be focused".

  function activate(item: Item) {
    if (item.type === "scene") {
      setActive(item.id);
      setOpen(false);
      return;
    }
    if (item.type === "preset") {
      setEditing(item.id);
      openDrawer("presets");
      setOpen(false);
      return;
    }
    if (item.type === "command") {
      item.run();
      setOpen(false);
      return;
    }
  }

  if (!open) return null;

  return (
    <div className="vp-cmd-overlay" onClick={() => setOpen(false)}>
      <div className="vp-cmd" onClick={(e) => e.stopPropagation()}>
        <div className="vp-cmd__input-wrap">
          <span className="vp-cmd__sigil">⌘K</span>
          <input
            ref={inputRef}
            className="vp-cmd__input"
            placeholder="search scenes, presets, commands…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setFocus(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setFocus((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setFocus((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const item = filtered[focus];
                if (item) activate(item);
              }
            }}
          />
          <button type="button" className="vp-cmd__close" onClick={() => setOpen(false)}>
            close <kbd>esc</kbd>
          </button>
        </div>
        <div className="vp-cmd__results">
          {filtered.length === 0 ? (
            <div className="vp-cmd__empty">
              <div className="vp-cmd__empty-display">NO MATCH</div>
              <div className="vp-cmd__empty-sub">try a different keyword</div>
            </div>
          ) : (
            <ResultList items={filtered} focus={focus} onActivate={activate} onHover={setFocus} />
          )}
        </div>
      </div>
    </div>
  );
}

function ResultList({
  items,
  focus,
  onActivate,
  onHover,
}: {
  items: Item[];
  focus: number;
  onActivate: (i: Item) => void;
  onHover: (idx: number) => void;
}) {
  // Group by type for the section labels
  const groups = useMemo(() => {
    const out: Array<{ label: string; rows: Array<{ item: Item; idx: number }> }> = [];
    let last = "";
    let i = 0;
    for (const item of items) {
      if (item.type !== last) {
        out.push({
          label: item.type === "command" ? "commands" : item.type === "scene" ? "scenes" : "audio presets",
          rows: [],
        });
        last = item.type;
      }
      out[out.length - 1].rows.push({ item, idx: i });
      i++;
    }
    return out;
  }, [items]);

  return (
    <>
      {groups.map((group, gi) => (
        <div key={gi}>
          <div className="vp-cmd__group">{group.label}</div>
          {group.rows.map(({ item, idx }) => (
            <div
              key={item.id}
              className="vp-cmd__row"
              data-focus={idx === focus ? "true" : undefined}
              onClick={() => onActivate(item)}
              onMouseEnter={() => onHover(idx)}
            >
              <ItemIcon item={item} />
              <span className="vp-cmd__row-name">{item.name}</span>
              <span className="vp-cmd__row-meta">{item.meta}</span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function ItemIcon({ item }: { item: Item }) {
  if (item.type === "scene") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="6" width="18" height="12" rx="1" />
        <path d="M3 11h18" />
      </svg>
    );
  }
  if (item.type === "preset") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M3 12s2-7 5-7 4 14 7 14 6-7 6-7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 5h14v14H5z" />
      <path d="M9 9h6v6H9z" />
    </svg>
  );
}
