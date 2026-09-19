"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSceneStore, useUiStore } from "@/src/lib/composer";
import {
  ACCEPTED_ASSET_TYPES,
  getAssetPreviewUrl,
  loadAsset,
  useAssetStore,
} from "@/src/lib/assets";

/**
 * LogoLibrary — drawer's "logos" mode. Upload artist logos (SVG / PNG
 * with alpha / WebP / JPEG), see them as a grid, and drop any of them
 * into the active scene as an `image` element. Assets are global like
 * audio presets: one upload, reuse across every scene of the night.
 */
export function LogoLibrary() {
  const assets = useAssetStore((s) => s.assets);
  const addFiles = useAssetStore((s) => s.addFiles);
  const removeAsset = useAssetStore((s) => s.removeAsset);
  const renameAsset = useAssetStore((s) => s.renameAsset);
  const addElement = useSceneStore((s) => s.addElement);
  const setDrawerOpen = useUiStore((s) => s.setDrawerOpen);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  // Bumped when an async preview lands so thumbnails re-read the cache.
  const [, setPreviewTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    for (const a of assets) {
      if (getAssetPreviewUrl(a.id)) continue;
      void loadAsset(a.id, a.name).then(() => {
        if (!cancelled) setPreviewTick((t) => t + 1);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [assets]);

  const importFiles = useCallback(
    async (files: Iterable<File>) => {
      setBusy(true);
      try {
        await addFiles(files);
      } finally {
        setBusy(false);
      }
    },
    [addFiles],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files);
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          marginBottom: "0.85rem",
        }}
      >
        <div
          style={{
            flex: 1,
            padding: "0.55rem 0.75rem",
            border: `1px dashed ${dragOver ? "var(--vp-cable-b)" : "var(--vp-edge-hot)"}`,
            borderRadius: 4,
            fontSize: "0.7rem",
            letterSpacing: "0.06em",
            color: dragOver ? "var(--vj-ink)" : "var(--vj-ink-dim)",
            background: dragOver
              ? "color-mix(in srgb, var(--vp-cable-b) 10%, transparent)"
              : "var(--vp-void)",
            transition: "border-color 120ms, background 120ms",
          }}
        >
          {busy
            ? "importing…"
            : "drop svg / png (alpha) / webp / jpg here — svg is rasterized once at 2048px"}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={[...ACCEPTED_ASSET_TYPES, ".svg"].join(",")}
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.length) void importFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="vj-btn vj-btn--accent"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          + upload logo
        </button>
      </div>

      <div className="vp-presets">
        {assets.map((asset) => {
          const url = getAssetPreviewUrl(asset.id);
          const isSvg = asset.type === "image/svg+xml";
          return (
            <div key={asset.id} className="vp-preset">
              <div className="vp-preset__head">
                <input
                  value={asset.name}
                  onChange={(e) => renameAsset(asset.id, e.target.value.slice(0, 40))}
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
                    minWidth: 0,
                  }}
                />
                <span className="vp-preset__feature" title="format">
                  {isSvg ? "svg" : asset.type.replace("image/", "")}
                </span>
              </div>
              {/* Checkerboard so alpha edges are visible in the thumbnail. */}
              <div
                style={{
                  height: 120,
                  borderRadius: 4,
                  border: "1px solid var(--vp-edge)",
                  backgroundColor: "#111",
                  backgroundImage:
                    "linear-gradient(45deg, #1c1c22 25%, transparent 25%, transparent 75%, #1c1c22 75%), linear-gradient(45deg, #1c1c22 25%, transparent 25%, transparent 75%, #1c1c22 75%)",
                  backgroundSize: "16px 16px",
                  backgroundPosition: "0 0, 8px 8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={asset.name}
                    style={{ maxWidth: "92%", maxHeight: "92%", objectFit: "contain" }}
                  />
                ) : (
                  <span style={{ fontSize: "0.65rem", color: "var(--vj-ink-dim)" }}>
                    loading…
                  </span>
                )}
              </div>
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
                <span>
                  {asset.width}×{asset.height}
                </span>
                <span>·</span>
                <span>{formatBytes(asset.bytes)}</span>
                <span style={{ marginLeft: "auto" }}>
                  {new Date(asset.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="vj-btn vj-btn--danger"
                  onClick={() => {
                    if (window.confirm(`Delete "${asset.name}"? Scenes using it will show a placeholder.`)) {
                      void removeAsset(asset.id);
                    }
                  }}
                >
                  delete
                </button>
                <button
                  type="button"
                  className="vj-btn vj-btn--accent"
                  onClick={() => {
                    addElement("image", 0.5, 0.5, { assetId: asset.id });
                    setDrawerOpen(false);
                  }}
                >
                  add to scene
                </button>
              </div>
            </div>
          );
        })}
        {assets.length === 0 && (
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
            no logos yet — upload the artists&apos; svg or png files
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} b`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kb`;
  return `${(n / (1024 * 1024)).toFixed(1)} mb`;
}
