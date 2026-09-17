/**
 * fMP4 → flat MP4 remux, via ffmpeg.wasm.
 *
 * MediaRecorder produces FRAGMENTED MP4 (a `moof` + `mdat` chunk for every
 * dataavailable event) because it has to stream output before knowing the
 * final length, frame count, or duration of the recording. NLEs — DaVinci
 * Resolve, Final Cut, Premiere, Avid — refuse fragmented MP4. They expect
 * a single `moov` atom describing the whole file at the front. Without a
 * remux, fragmented recordings show up as "Media Offline" on import (and
 * macOS Finder won't even render a thumbnail for them).
 *
 * We run ffmpeg in WebAssembly with the same `-c copy -movflags +faststart`
 * incantation that works from the terminal. `-c copy` rewraps streams
 * without re-encoding (lossless, byte-identical video / audio data), and
 * `+faststart` puts the moov atom at the front of the file for instant
 * seek + thumbnail generation.
 *
 * Why ffmpeg.wasm and not pure-JS muxers (mp4box.js, etc.):
 *   - Pure-JS muxers want you to extract every sample from the input and
 *     hand-feed them into a fresh output file along with codec config
 *     boxes. That's a long road of subtle gotchas — sample_description
 *     indexing, edit list preservation, AAC's esds vs avcC handling, B-
 *     frame DTS/CTS reconstruction. The mp4box.js attempts produced files
 *     macOS Finder couldn't even thumbnail.
 *   - ffmpeg.wasm runs the actual battle-tested ffmpeg `-c copy` code
 *     path. Same binary that the user just ran on their broken file from
 *     the terminal — known-good output, every time.
 *
 * Cost: ~32 MB WASM (lazy-loaded on first record stop, cached by browser
 * thereafter). First remux of a session pays the load (~500 ms — 1 s on a
 * fast connection). Subsequent remuxes use the warm-loaded engine and
 * complete in ~500 ms — 2 s for a typical 30 s clip.
 *
 * Single-threaded build (no SharedArrayBuffer required), so we don't need
 * to set the COOP/COEP cross-origin-isolated headers on the dev server.
 */

import type { FFmpeg } from "@ffmpeg/ffmpeg";

// Module-scoped singleton so the engine stays warm across multiple stops
// in one session. Reused on every remux after the first; the WASM module
// is expensive to instantiate but cheap to call.
let ffmpegPromise: Promise<FFmpeg> | null = null;

/**
 * Lazily load ffmpeg.wasm and return a ready-to-use FFmpeg instance.
 *
 * Files are served from `/ffmpeg/` (copied into `public/ffmpeg/` from
 * @ffmpeg/core at install time). Loading from same-origin avoids a CDN
 * dependency for offline VJ sets.
 */
function loadFfmpeg(): Promise<FFmpeg> {
  if (ffmpegPromise) return ffmpegPromise;
  ffmpegPromise = (async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const ffmpeg = new FFmpeg();
    // Hush the firehose of decoder/timestamp logs ffmpeg emits at INFO —
    // we only want to surface WARNING and above so genuine remux failures
    // make it to the console.
    ffmpeg.on("log", ({ type, message }) => {
      if (type === "fferr" || /(warning|error)/i.test(message)) {
        console.warn("[ffmpeg]", message);
      }
    });
    await ffmpeg.load({
      coreURL: "/ffmpeg/ffmpeg-core.js",
      wasmURL: "/ffmpeg/ffmpeg-core.wasm",
    });
    return ffmpeg;
  })();
  // If the load fails, drop the cached promise so the next call retries
  // instead of permanently rejecting.
  ffmpegPromise.catch(() => {
    ffmpegPromise = null;
  });
  return ffmpegPromise;
}

/**
 * Remux a fragmented MP4 Blob into a non-fragmented one. Returns a fresh
 * Blob with the same MIME type. Lossless byte-for-byte at the codec level
 * — only the container layout changes.
 *
 * Rejects on ffmpeg failure (corrupt input, unsupported codec, etc.) —
 * callers should fall back to handing the user the raw fMP4 Blob rather
 * than failing the whole recording.
 */
export async function remuxFmp4ToFlatMp4(blob: Blob): Promise<Blob> {
  const ffmpeg = await loadFfmpeg();

  // Use unique temp paths so concurrent remuxes (rare, but possible if
  // the user starts a new recording while a previous one is finalising)
  // don't collide on ffmpeg's in-memory virtual filesystem.
  const tag = Math.random().toString(36).slice(2, 10);
  const inputPath = `in-${tag}.mp4`;
  const outputPath = `out-${tag}.mp4`;

  try {
    const inputBytes = new Uint8Array(await blob.arrayBuffer());
    await ffmpeg.writeFile(inputPath, inputBytes);

    // -c copy        rewrap without re-encoding (lossless, fast)
    // -movflags +faststart   put moov atom at the front of the file so
    //                        editors / players can read the index without
    //                        scanning the whole mdat
    const exitCode = await ffmpeg.exec([
      "-i",
      inputPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
    if (exitCode !== 0) {
      throw new Error(`ffmpeg exited with code ${exitCode}`);
    }

    const outputData = await ffmpeg.readFile(outputPath);
    // readFile returns Uint8Array | string depending on encoding flag;
    // we always read binary, so it's Uint8Array. Defensive cast keeps
    // strict-mode TS happy.
    if (typeof outputData === "string") {
      throw new Error("ffmpeg produced a string output (expected binary)");
    }
    // Wrap the Uint8Array's underlying buffer (correctly sized) in a Blob.
    // Cast: stricter lib.dom types want Uint8Array<ArrayBuffer> specifically
    // (excluding SharedArrayBuffer-backed); the buffer here is plain
    // ArrayBuffer at runtime.
    return new Blob([outputData as Uint8Array<ArrayBuffer>], {
      type: blob.type || "video/mp4",
    });
  } finally {
    // Clean up the virtual filesystem so we don't leak memory across
    // multiple remuxes in the same session. Best-effort: ignore errors
    // (the next remux will overwrite the path anyway).
    try {
      await ffmpeg.deleteFile(inputPath);
    } catch {
      // ignore
    }
    try {
      await ffmpeg.deleteFile(outputPath);
    } catch {
      // ignore
    }
  }
}

/**
 * True when the given MIME type is one we can remux (currently MP4 only).
 * WebM doesn't suffer from the same fragmentation issue — its cluster /
 * block layout is what every WebM player expects, and Resolve doesn't
 * support WebM regardless, so there's nothing to fix.
 */
export function canRemux(mimeType: string): boolean {
  return /^video\/mp4(\b|;)/i.test(mimeType);
}
