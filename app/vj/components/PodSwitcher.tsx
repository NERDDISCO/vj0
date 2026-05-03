"use client";

import React, { useState, useEffect, useCallback } from "react";
import type { PodInfo } from "@/app/api/pods/route";

interface PodSwitcherProps {
  /** Currently selected pod signaling URL (empty if no pod selected). */
  selectedPodUrl: string;
  /** Called when the user picks a pod. Sets backend to "pod" + podUrl. */
  onSelectPod: (signalingUrl: string) => void;
}

/** Location code → flag emoji + readable label. */
const LOCATION_LABELS: Record<string, string> = {
  NO: "🇳🇴 Norway",
  CA: "🇨🇦 Canada",
  US: "🇺🇸 USA",
  RO: "🇷🇴 Romania",
  CZ: "🇨🇿 Czech Republic",
  NL: "🇳🇱 Netherlands",
  IS: "🇮🇸 Iceland",
  SE: "🇸🇪 Sweden",
  DE: "🇩🇪 Germany",
  GB: "🇬🇧 UK",
  FR: "🇫🇷 France",
};

function locationLabel(loc: string): string {
  return LOCATION_LABELS[loc] ?? loc;
}

/**
 * PodSwitcher — fetches live RunPod pods from /api/pods and renders
 * a compact list. Each pod shows GPU type, count, location, readiness,
 * and a one-click "connect" button.
 */
export function PodSwitcher({ selectedPodUrl, onSelectPod }: PodSwitcherProps) {
  const [pods, setPods] = useState<PodInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPods = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pods", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPods(data.pods ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch pods");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchPods();
  }, [fetchPods]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-[color:var(--vj-ink-dim)]">
          Live Pods
        </span>
        <button
          onClick={fetchPods}
          disabled={loading}
          className="text-xs text-[color:var(--vj-accent)] hover:underline disabled:opacity-50"
        >
          {loading ? "loading…" : "refresh"}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400">
          {error}
        </p>
      )}

      {!loading && pods.length === 0 && !error && (
        <p className="text-xs text-[color:var(--vj-ink-dim)]">
          No running pods found
        </p>
      )}

      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {pods.map((pod) => {
          const isSelected = pod.signalingUrl === selectedPodUrl;
          const jpegQ = pod.env?.JPEG_QUALITY ?? "80";

          return (
            <button
              key={pod.id}
              onClick={() => onSelectPod(pod.signalingUrl)}
              className={`
                w-full text-left rounded px-2 py-1.5 text-xs transition-colors
                ${isSelected
                  ? "bg-[color:var(--vj-accent)]/20 ring-1 ring-[color:var(--vj-accent)]"
                  : "bg-white/5 hover:bg-white/10"
                }
              `}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">{pod.name}</span>
                <span
                  className={`flex-shrink-0 w-2 h-2 rounded-full ${
                    pod.inferenceReady
                      ? "bg-green-400"
                      : pod.readyCount > 0
                        ? "bg-yellow-400"
                        : "bg-red-400 animate-pulse"
                  }`}
                />
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-[color:var(--vj-ink-dim)]">
                <span>{pod.gpuCount}× {pod.gpuDisplayName}</span>
                <span>·</span>
                <span>{locationLabel(pod.location)}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-[color:var(--vj-ink-dim)]">
                <span>
                  {pod.inferenceReady
                    ? `✓ ${pod.readyCount}/${pod.workerCount} ready`
                    : pod.readyCount > 0
                      ? `⏳ ${pod.readyCount}/${pod.workerCount} ready`
                      : "⏳ booting…"
                  }
                </span>
                <span>·</span>
                <span>JPEG {jpegQ}</span>
                <span>·</span>
                <span>${pod.costPerHr.toFixed(2)}/hr</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
