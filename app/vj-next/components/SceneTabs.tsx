"use client";

import { useEffect, useRef, useState } from "react";
import {
  useSceneStore,
  useUiStore,
  SCENE_TEMPLATES,
} from "@/src/lib/composer";

/**
 * Top scene tabs — one tab per scene. Each tab shows the scene name in the
 * Doto display font (so the strip reads as a row of LED nameplates) plus a
 * tiny placeholder for a future render thumbnail. Click to switch, double
 * click to rename inline. The "+ NEW" tab on the right adds a fresh scene.
 *
 * The cmd+K affordance lives on the right of this strip — it's the entry
 * point to global search across scenes, presets, and commands.
 */
export function SceneTabs() {
  const scenes = useSceneStore((s) => s.scenes);
  const activeId = useSceneStore((s) => s.activeSceneId);
  const setActive = useSceneStore((s) => s.setActiveScene);
  const addScene = useSceneStore((s) => s.addScene);
  const addSceneFromTemplate = useSceneStore((s) => s.addSceneFromTemplate);
  const renameScene = useSceneStore((s) => s.renameScene);

  const togglePalette = useUiStore((s) => s.togglePalette);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const templateBtnRef = useRef<HTMLButtonElement>(null);
  // Outside-click close for the template menu.
  useEffect(() => {
    if (!templateOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!templateBtnRef.current?.parentElement?.contains(e.target as Node)) {
        setTemplateOpen(false);
      }
    };
    const id = window.setTimeout(() => {
      window.addEventListener("mousedown", onClick);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("mousedown", onClick);
    };
  }, [templateOpen]);

  useEffect(() => {
    if (renamingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renamingId]);

  function commitRename() {
    if (renamingId && renameValue.trim()) {
      renameScene(renamingId, renameValue.trim().slice(0, 32));
    }
    setRenamingId(null);
  }

  return (
    <div className="vp-tab-strip" role="tablist" aria-label="Scenes">
      {scenes.map((scene) => {
        const isActive = scene.id === activeId;
        const isRenaming = renamingId === scene.id;
        return (
          <button
            key={scene.id}
            type="button"
            role="tab"
            className="vp-tab"
            aria-selected={isActive}
            onClick={() => {
              if (!isRenaming) setActive(scene.id);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenamingId(scene.id);
              setRenameValue(scene.name);
            }}
          >
            <span className="vp-tab__thumb" aria-hidden>
              {/* The thumb is a stylized swatch of the scene's bg + a
                  hint dot per element so even a thumbnail-less view
                  encodes "is this scene populated". */}
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  background: scene.background,
                }}
              />
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 1,
                  color: "var(--vp-cable-a)",
                  fontSize: 6,
                  letterSpacing: 0,
                  lineHeight: 1,
                }}
              >
                {scene.elements.length === 0 ? "·" : "▮".repeat(Math.min(4, scene.elements.length))}
              </span>
            </span>
            {isRenaming ? (
              <input
                ref={inputRef}
                value={renameValue}
                className="vp-tab__name"
                style={{
                  background: "var(--vp-void)",
                  border: "1px solid var(--vp-cable-b)",
                  color: "var(--vj-ink)",
                  padding: "0.1rem 0.4rem",
                  borderRadius: 3,
                  outline: "none",
                  width: 120,
                }}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setRenamingId(null);
                }}
              />
            ) : (
              <span className="vp-tab__name">{scene.name}</span>
            )}
          </button>
        );
      })}
      <button
        type="button"
        className="vp-tab vp-tab__add"
        onClick={() => addScene()}
        title="New empty scene"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
        new
      </button>
      <div style={{ position: "relative" }}>
        <button
          ref={templateBtnRef}
          type="button"
          className="vp-tab vp-tab__add"
          onClick={() => setTemplateOpen((o) => !o)}
          title="Spawn from template"
          aria-expanded={templateOpen}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6h16M4 12h16M4 18h10" />
          </svg>
          template ▾
        </button>
        {templateOpen && (
          <div className="vp-tpl-menu">
            <div className="vp-tpl-menu__head">scene templates</div>
            {SCENE_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="vp-tpl-menu__item"
                onClick={() => {
                  addSceneFromTemplate(t.id);
                  setTemplateOpen(false);
                }}
              >
                <span className="vp-tpl-menu__name">{t.name}</span>
                <span className="vp-tpl-menu__desc">{t.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="vp-cmdk"
        onClick={togglePalette}
        title="Search scenes, presets, commands (⌘K)"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        find
        <kbd>⌘K</kbd>
      </button>
    </div>
  );
}
