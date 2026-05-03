"use client";

import { useState } from "react";
import { useSceneStore } from "@/src/lib/composer";

/**
 * SceneLibrary — drawer's "scenes" mode. A grid of scene cards with
 * properties (name, prompt, element count, background swatch). Clicking a
 * card sets it active and closes the drawer.
 */
export function SceneLibrary() {
  const scenes = useSceneStore((s) => s.scenes);
  const activeId = useSceneStore((s) => s.activeSceneId);
  const setActive = useSceneStore((s) => s.setActiveScene);
  const addScene = useSceneStore((s) => s.addScene);
  const duplicateScene = useSceneStore((s) => s.duplicateScene);
  const removeScene = useSceneStore((s) => s.removeScene);
  const renameScene = useSceneStore((s) => s.renameScene);
  const updateBackground = useSceneStore((s) => s.updateSceneBackground);
  const updatePrompt = useSceneStore((s) => s.updateScenePrompt);
  const [query, setQuery] = useState("");
  const filtered = scenes.filter((s) =>
    s.name.toLowerCase().includes(query.trim().toLowerCase()) ||
    s.prompt.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          marginBottom: "0.85rem",
        }}
      >
        <input
          placeholder="search scenes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: 1,
            background: "var(--vp-void)",
            border: "1px solid var(--vp-edge-hot)",
            color: "var(--vj-ink)",
            padding: "0.45rem 0.65rem",
            fontFamily: "inherit",
            fontSize: "0.78rem",
            borderRadius: 4,
            outline: 0,
          }}
        />
        <button type="button" className="vj-btn vj-btn--accent" onClick={() => addScene()}>
          + new scene
        </button>
      </div>

      <div className="vp-presets">
        {filtered.map((scene) => (
          <div
            key={scene.id}
            className="vp-preset"
            data-active={scene.id === activeId ? "true" : undefined}
          >
            <div className="vp-preset__head">
              <input
                value={scene.name}
                onChange={(e) => renameScene(scene.id, e.target.value.slice(0, 32))}
                style={{
                  fontFamily: "var(--font-doto), monospace",
                  fontWeight: 800,
                  fontSize: "0.95rem",
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: "var(--vj-ink)",
                  background: "transparent",
                  border: 0,
                  outline: 0,
                  flex: 1,
                  padding: 0,
                }}
              />
              <span
                className="vp-preset__feature"
                title="element count"
              >
                {scene.elements.length}
              </span>
            </div>
            <textarea
              value={scene.prompt}
              onChange={(e) => updatePrompt(scene.id, e.target.value)}
              placeholder="prompt…"
              rows={2}
              style={{
                width: "100%",
                background: "var(--vp-void)",
                border: "1px solid var(--vp-edge-hot)",
                color: "var(--vj-ink)",
                padding: "0.45rem 0.55rem",
                fontFamily: "inherit",
                fontSize: "0.72rem",
                borderRadius: 4,
                outline: 0,
                resize: "vertical",
                lineHeight: 1.5,
                minHeight: "3rem",
              }}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.45rem",
                fontSize: "0.62rem",
                letterSpacing: "0.1em",
                color: "var(--vj-ink-dim)",
              }}
            >
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                bg
                <input
                  type="color"
                  value={scene.background}
                  onChange={(e) => updateBackground(scene.id, e.target.value)}
                  style={{
                    width: 24,
                    height: 18,
                    border: "1px solid var(--vp-edge-hot)",
                    background: "transparent",
                    padding: 0,
                    borderRadius: 2,
                  }}
                />
              </label>
              <span style={{ marginLeft: "auto" }}>
                {new Date(scene.createdAt).toLocaleDateString()}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                gap: 6,
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                className="vj-btn"
                onClick={() => duplicateScene(scene.id)}
              >
                dup
              </button>
              <button
                type="button"
                className="vj-btn vj-btn--danger"
                onClick={() => {
                  if (window.confirm(`Delete "${scene.name}"?`)) {
                    removeScene(scene.id);
                  }
                }}
              >
                delete
              </button>
              <button
                type="button"
                className={`vj-btn ${scene.id === activeId ? "vj-btn--live" : "vj-btn--accent"}`}
                onClick={() => setActive(scene.id)}
              >
                {scene.id === activeId ? "active" : "load"}
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div
            style={{
              gridColumn: "1 / -1",
              padding: "2.4rem 0",
              textAlign: "center",
              color: "var(--vj-ink-dim)",
              fontSize: "0.7rem",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            no scenes match &ldquo;{query}&rdquo;
          </div>
        )}
      </div>
    </div>
  );
}
