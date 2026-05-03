"use client";

import { LightingPanel } from "@/app/vj/components/LightingPanel";
import { useLightingPipeline } from "../hooks/useLightingPipeline";
import { useUiStore } from "@/src/lib/composer";
import type { AudioEngine } from "@/src/lib/audio-engine";

interface LightingModeProps {
  /** Source canvas (input scene canvas, or AI output preview when
   *  connected) — fixtures sample pixels at their mapped coordinates. */
  sourceCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  audioEngineRef: React.MutableRefObject<AudioEngine | null>;
}

/**
 * LightingMode — drawer content for the "lighting" mode. Re-uses the
 * legacy /vj LightingPanel directly: it's already a finished, well-
 * tested ~400-line component with fixture cards, strobe/color/dimmer
 * controls, fog, and a master toggle. Rebuilding it from scratch would
 * just create a second source of truth to keep in sync.
 *
 * This wrapper does only two jobs:
 *   1. Pull state + handlers via useLightingPipeline.
 *   2. Hand them to LightingPanel as flat props.
 *
 * The styling difference (legacy uses .vj-* classes from globals.css,
 * Patch Studio uses .vp-* classes from patch-studio.css) is fine —
 * both class families are loaded and the LightingPanel reads as the
 * legacy "console" inside the new drawer chrome.
 */
export function LightingMode({
  sourceCanvasRef,
  audioEngineRef,
}: LightingModeProps) {
  const lp = useLightingPipeline({ sourceCanvasRef, audioEngineRef });
  const setDrawerOpen = useUiStore((s) => s.setDrawerOpen);

  return (
    <LightingPanel
      enabled={lp.enabled}
      onSetEnabled={lp.setEnabled}
      dmxStatus={lp.dmxStatus}
      dmxSupported={lp.dmxSupported}
      onDmxConnect={lp.handleDmxConnect}
      onDmxDisconnect={lp.handleDmxDisconnect}
      onDmxReconnect={lp.handleDmxReconnect}
      selectedProfileId={lp.selectedProfileId}
      onProfileSelect={lp.setSelectedProfileId}
      onAddFixture={lp.handleAddFixture}
      fixtures={lp.fixtures}
      fixtureValues={lp.fixtureValues}
      dmxActiveCount={lp.dmxActiveCount}
      onFixtureAddressChange={lp.handleFixtureAddressChange}
      onFixtureStrobeModeChange={lp.handleStrobeModeChange}
      onFixtureStrobeThresholdChange={lp.handleStrobeThresholdChange}
      onFixtureStrobeMaxChange={lp.handleStrobeMaxChange}
      onFixtureColorModeChange={lp.handleColorModeChange}
      onFixtureSolidColorChange={lp.handleSolidColorChange}
      onFixtureProfileChange={lp.handleFixtureProfileChange}
      onFixtureRemove={lp.handleRemoveFixture}
      onFixtureDimmerModeChange={lp.handleDimmerModeChange}
      onFixtureManualDimmerChange={lp.handleManualDimmerChange}
      fogIntensity={lp.fogIntensity}
      onFogIntensityChange={lp.setFogIntensity}
      onFogToggle={lp.triggerFog}
      isFogActive={lp.isFogActive}
      onClose={() => setDrawerOpen(false)}
    />
  );
}

// Re-export the pipeline hook so VJNextApp can also reach into it for
// the "0" fog hotkey + the lighting-engine-shared audio reference
// without having to instantiate it twice.
export { useLightingPipeline };
