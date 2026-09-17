/** Decode one JPEG at a time, retaining only the newest waiting frame. */
export function createLatestFrameDecoder(draw: (bitmap: ImageBitmap) => void) {
  let pending: Blob | null = null;
  let busy = false;
  let disposed = false;

  async function drain() {
    busy = true;
    try {
      while (pending && !disposed) {
        const blob = pending;
        pending = null;
        try {
          const bitmap = await createImageBitmap(blob);
          try {
            // Draw the newest decoded result even if another frame is waiting;
            // skipping it would starve rendering under sustained overload.
            if (!disposed) draw(bitmap);
          } finally {
            bitmap.close();
          }
        } catch {
          // A failed decode/render must not stop subsequent live frames.
        }
      }
    } finally {
      busy = false;
    }
  }

  return {
    push(blob: Blob) {
      if (disposed) return;
      pending = blob;
      if (!busy) void drain();
    },
    dispose() {
      disposed = true;
      pending = null;
    },
  };
}
