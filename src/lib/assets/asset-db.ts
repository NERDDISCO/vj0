/**
 * IndexedDB blob store for user-uploaded assets (artist logos etc).
 *
 * localStorage is where every other vj0 store lives, but it caps out at
 * ~5 MB and only holds strings — a handful of PNG logos would blow it.
 * IndexedDB stores Blobs natively with a quota in the hundreds of MB, so
 * the binary lives here and the zustand asset store only keeps metadata
 * (id, name, dimensions) plus the id to look the blob up by.
 */

const DB_NAME = "vj0-assets";
const DB_VERSION = 1;
const STORE = "blobs";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
  // Don't cache a rejected open — the next call gets a fresh attempt.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export async function putAssetBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await request(db.transaction(STORE, "readwrite").objectStore(STORE).put(blob, id));
}

export async function getAssetBlob(id: string): Promise<Blob | null> {
  const db = await openDb();
  const out = await request(db.transaction(STORE, "readonly").objectStore(STORE).get(id));
  return out instanceof Blob ? out : null;
}

export async function deleteAssetBlob(id: string): Promise<void> {
  const db = await openDb();
  await request(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
}
