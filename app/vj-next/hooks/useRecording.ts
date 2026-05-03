"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RecordingEngine, type RecordingResult } from "@/src/lib/recording";
import {
  useAiSettingsStore,
  getRecordingResolutionSpec,
} from "@/src/lib/stores/ai-settings-store";
import type { AudioEngine } from "@/src/lib/audio-engine";

interface UseRecordingArgs {
  /** Source canvas to record. Should be the input scene canvas (always
   *  has content) when AI isn't connected, or the AI preview canvas
   *  when it is. We accept a getter so the caller can swap source live. */
  getSourceCanvas: () => HTMLCanvasElement | null;
  /** AudioEngine — recording taps the audio graph for the soundtrack
   *  half of the resulting video. */
  audioEngineRef: React.MutableRefObject<AudioEngine | null>;
}

/**
 * useRecording — wraps RecordingEngine for /vj-next.
 *
 * RecordingEngine is the same one legacy /vj uses (canvas + audio →
 * MediaRecorder → WebM/MP4 blob). We hand it a getCanvas + audioTap
 * pair via getter so swapping source mid-set (e.g. AI preview becomes
 * available) doesn't require rebuilding the engine.
 *
 * Persistence: the resolution selector lives in useAiSettingsStore
 * (1k/2k/4k) so a user's choice carries over from legacy /vj.
 */
export function useRecording({
  getSourceCanvas,
  audioEngineRef,
}: UseRecordingArgs) {
  const engineRef = useRef<RecordingEngine | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recordingResolution = useAiSettingsStore((s) => s.recordingResolution);
  const setRecordingResolution = useAiSettingsStore(
    (s) => s.setRecordingResolution,
  );

  // Probe MediaRecorder support on mount. The engine itself does the
  // probe; we surface it as state so the chip can render "rec n/a"
  // instead of a non-functional record button.
  useEffect(() => {
    setSupported(RecordingEngine.isSupported());
  }, []);

  const start = useCallback(() => {
    setError(null);
    if (!engineRef.current) {
      engineRef.current = new RecordingEngine({
        getCanvas: () => getSourceCanvas(),
        createAudioTap: () =>
          audioEngineRef.current?.createAudioTap() ?? null,
      });
    }
    // Read fresh from the store so picker changes made right before
    // pressing record win over any stale closure value.
    const spec = getRecordingResolutionSpec(
      useAiSettingsStore.getState().recordingResolution,
    );
    try {
      engineRef.current.start({
        outputWidth: spec.width,
        outputHeight: spec.height,
      });
      setIsRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to start recording");
    }
  }, [getSourceCanvas, audioEngineRef]);

  const stop = useCallback(async () => {
    const eng = engineRef.current;
    if (!eng) return;
    setIsFinalizing(true);
    try {
      const result = await eng.stop();
      triggerDownload(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "recording failed");
    } finally {
      setIsRecording(false);
      setIsFinalizing(false);
    }
  }, []);

  // Force-cancel on unmount so an in-flight recording doesn't leak
  // its MediaRecorder + the connected audio destination node when
  // the page navigates away.
  useEffect(() => {
    return () => {
      engineRef.current?.cancel();
    };
  }, []);

  const getElapsedMs = useCallback(
    () => engineRef.current?.getElapsedMs() ?? 0,
    [],
  );

  return {
    isRecording,
    isFinalizing,
    supported,
    error,
    clearError: () => setError(null),
    start,
    stop,
    getElapsedMs,
    resolution: recordingResolution,
    setResolution: setRecordingResolution,
  };
}

/** Save the finished blob via the anchor-with-download trick — works
 *  in every browser, no extra permission prompt, lands in Downloads. */
function triggerDownload(result: RecordingResult): void {
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vj0-${stamp(new Date())}.${result.extension}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give Safari time to start the download before the URL goes away.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function stamp(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  );
}
