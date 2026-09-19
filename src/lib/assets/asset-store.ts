/**
 * Asset library — user-uploaded logos/images for the composer.
 *
 * Metadata (this store, localStorage) + blob (IndexedDB, asset-db.ts) +
 * decoded bitmap (asset-bitmaps.ts). Scenes reference assets by id only,
 * so a scene export stays a small JSON blob and a missing asset degrades
 * to a placeholder box instead of breaking the scene.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { deleteAssetBlob, getAssetBlob, putAssetBlob } from "./asset-db";
import {
  cacheAsset,
  decodeAsset,
  isSvg,
  loadAsset,
  normalizeSvg,
  unloadAsset,
} from "./asset-bitmaps";

export interface AssetMeta {
  id: string;
  name: string;
  /** MIME type of the stored blob. */
  type: string;
  /** Decoded (for SVG: rasterized) pixel dimensions. */
  width: number;
  height: number;
  bytes: number;
  createdAt: number;
}

export const ACCEPTED_ASSET_TYPES = [
  "image/svg+xml",
  "image/png",
  "image/webp",
  "image/jpeg",
  "image/gif",
];

/** Per-file cap — logos should be small; this just stops a 40 MB TIFF. */
const MAX_ASSET_BYTES = 16 * 1024 * 1024;

interface AssetState {
  assets: AssetMeta[];
  /** Import files. Resolves with the ids that were stored (bad files are skipped + warned). */
  addFiles: (files: Iterable<File>) => Promise<string[]>;
  removeAsset: (id: string) => Promise<void>;
  renameAsset: (id: string, name: string) => void;
}

function uid(): string {
  return `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function displayName(file: File): string {
  return file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 40) || "logo";
}

export const useAssetStore = create<AssetState>()(
  persist(
    (set) => ({
      assets: [],

      addFiles: async (files) => {
        const added: string[] = [];
        for (const file of files) {
          const svg = isSvg(file, file.name);
          if (!svg && !ACCEPTED_ASSET_TYPES.includes(file.type)) {
            console.warn(`[assets] skipping ${file.name}: unsupported type ${file.type}`);
            continue;
          }
          if (file.size > MAX_ASSET_BYTES) {
            console.warn(`[assets] skipping ${file.name}: ${file.size} bytes exceeds cap`);
            continue;
          }
          try {
            const blob = svg ? await normalizeSvg(file) : file;
            const decoded = await decodeAsset(blob, file.name);
            const id = uid();
            await putAssetBlob(id, blob);
            cacheAsset(id, blob, decoded);
            const meta: AssetMeta = {
              id,
              name: displayName(file),
              type: svg ? "image/svg+xml" : file.type,
              width: decoded.width,
              height: decoded.height,
              bytes: blob.size,
              createdAt: Date.now(),
            };
            set((s) => ({ assets: [...s.assets, meta] }));
            added.push(id);
          } catch (err) {
            console.warn(`[assets] failed to import ${file.name}`, err);
          }
        }
        return added;
      },

      removeAsset: async (id) => {
        unloadAsset(id);
        set((s) => ({ assets: s.assets.filter((a) => a.id !== id) }));
        try {
          await deleteAssetBlob(id);
        } catch (err) {
          console.warn(`[assets] failed to delete blob ${id}`, err);
        }
      },

      renameAsset: (id, name) => {
        set((s) => ({
          assets: s.assets.map((a) => (a.id === id ? { ...a, name } : a)),
        }));
      },
    }),
    {
      name: "vj0-assets",
      version: 1,
      partialize: (s) => ({ assets: s.assets }),
      // After rehydrate, warm the bitmap cache for every asset and drop
      // metadata whose blob is gone (cleared site data, different
      // browser profile) so the library never lists ghosts.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        void (async () => {
          const missing: string[] = [];
          await Promise.all(
            state.assets.map(async (a) => {
              const blob = await getAssetBlob(a.id).catch(() => null);
              if (!blob) {
                missing.push(a.id);
                return;
              }
              await loadAsset(a.id, a.name);
            }),
          );
          if (missing.length) {
            useAssetStore.setState((s) => ({
              assets: s.assets.filter((a) => !missing.includes(a.id)),
            }));
          }
        })();
      },
    },
  ),
);

/** Newest asset id, used as the default for a freshly added logo element. */
export function selectNewestAssetId(s: AssetState): string {
  return s.assets.length ? s.assets[s.assets.length - 1].id : "";
}
