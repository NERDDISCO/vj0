"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LightingEngine,
  DmxOutput,
  type FixtureInstance,
  type LightingFrame,
  type StrobeMode,
  type ColorMode,
  type DimmerMode,
} from "@/src/lib/lighting";
import {
  useLightingStore,
  useFixtures,
  useAiSettingsStore,
} from "@/src/lib/stores";
import { AudioEngine } from "@/src/lib/audio-engine";

type DmxStatus = "disconnected" | "connecting" | "connected" | "unsupported";

interface UseLightingPipelineArgs {
  /** Source canvas to sample fixture pixels from. Should be the input
   *  scene canvas while no AI is connected, the AI output preview when
   *  it is. We accept a function so the caller can swap source live
   *  without re-creating this hook. */
  sourceCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  /** AudioEngine instance — gives the LightingEngine access to live
   *  audio features for strobe modulation. */
  audioEngineRef: React.MutableRefObject<AudioEngine | null>;
}

/**
 * useLightingPipeline — owns the LightingEngine + DmxOutput refs and
 * exposes every prop the legacy LightingPanel needs. Lifted into its
 * own hook so VJNextApp doesn't bloat with ~150 lines of DMX glue.
 *
 * Lifecycle:
 *   - On first render, allocates a LightingEngine bound to the source
 *     canvas. Re-creates it whenever the fixture list changes (so a
 *     freshly added fixture immediately starts pushing).
 *   - LightingEngine ticks at 30 Hz and emits a LightingFrame each
 *     tick. We forward to the DmxOutput when connected.
 *   - DmxOutput is lazily allocated on first connect attempt — no
 *     WebUSB device requested until the user explicitly asks.
 */
export function useLightingPipeline({
  sourceCanvasRef,
  audioEngineRef,
}: UseLightingPipelineArgs) {
  const lightingEngineRef = useRef<LightingEngine | null>(null);
  const dmxOutputRef = useRef<DmxOutput | null>(null);

  const [dmxStatus, setDmxStatus] = useState<DmxStatus>("disconnected");
  const [dmxSupported, setDmxSupported] = useState(true);
  const [fixtureValues, setFixtureValues] = useState<Map<string, Uint8Array>>(
    new Map(),
  );
  const [dmxActiveCount, setDmxActiveCount] = useState(0);

  // Persisted fixture list + master enable from the lighting store.
  const fixtures = useFixtures();
  const lightingEnabled = useLightingStore((s) => s.enabled);
  const setLightingEnabled = useLightingStore((s) => s.setEnabled);
  const {
    addFixture,
    removeFixture,
    updateFixtureAddress,
    updateFixtureStrobeMode,
    updateFixtureStrobeThreshold,
    updateFixtureStrobeMax,
    updateFixtureColorMode,
    updateFixtureSolidColor,
    updateFixtureProfile,
    updateFixtureDimmerMode,
    updateFixtureManualDimmer,
  } = useLightingStore.getState();

  // Selected fixture profile (for the "+ add" picker). Persisted via
  // ai-settings-store so the picker remembers across reloads.
  const persistedProfileId = useAiSettingsStore(
    (s) => s.selectedFixtureProfileId,
  );
  const setPersistedProfileId = useAiSettingsStore(
    (s) => s.setSelectedFixtureProfileId,
  );

  // Fog state — also persisted.
  const fogIntensity = useAiSettingsStore((s) => s.fogIntensity);
  const setFogIntensity = useAiSettingsStore((s) => s.setFogIntensity);

  // ─── WebUSB support probe ───────────────────────────────────────
  useEffect(() => {
    const supported =
      typeof navigator !== "undefined" && "usb" in navigator;
    setDmxSupported(supported);
    if (!supported) setDmxStatus("unsupported");
  }, []);

  // ─── Frame handlers ─────────────────────────────────────────────
  // Slice the universe into per-fixture views the inspector can render,
  // and count how many fixtures are pushing non-zero DMX (any channel
  // > 0) for the live activity counter.
  const handleLightingFrame = useCallback(
    (frame: LightingFrame) => {
      const next = new Map<string, Uint8Array>();
      let active = 0;
      for (const fx of fixtures) {
        const base = fx.address - 1;
        const ch = fx.profile.channels.length;
        const slice = new Uint8Array(ch);
        let anyOn = false;
        for (let i = 0; i < ch; i++) {
          slice[i] = frame.universe[base + i] ?? 0;
          if (slice[i] > 0) anyOn = true;
        }
        next.set(fx.id, slice);
        if (anyOn) active += 1;
      }
      setFixtureValues(next);
      setDmxActiveCount(active);
    },
    [fixtures],
  );
  const handleDmxFrame = useCallback((frame: LightingFrame) => {
    if (!lightingEnabledRef.current) return;
    const dmx = dmxOutputRef.current;
    if (dmx && dmx.isConnected()) dmx.sendUniverse(frame.universe);
  }, []);
  // Track lightingEnabled in a ref so handleDmxFrame doesn't have to
  // be rebuilt on every toggle (would tear down the engine).
  const lightingEnabledRef = useRef(lightingEnabled);
  useEffect(() => {
    lightingEnabledRef.current = lightingEnabled;
  }, [lightingEnabled]);

  // ─── Engine lifecycle ───────────────────────────────────────────
  // Re-create the engine when the source canvas, fixture list, or
  // audio engine identity changes. Stop + recreate is intentional —
  // the engine pre-allocates fixture state at construction.
  useEffect(() => {
    const source = sourceCanvasRef.current;
    if (!source) return;
    const eng = new LightingEngine(source, fixtures, { tickHz: 30 });
    const audio = audioEngineRef.current;
    if (audio) eng.setAudioEngine(audio);
    eng.onFrame(handleLightingFrame);
    eng.onFrame(handleDmxFrame);
    eng.start();
    lightingEngineRef.current = eng;
    return () => {
      eng.stop();
      if (lightingEngineRef.current === eng) lightingEngineRef.current = null;
    };
  }, [
    sourceCanvasRef,
    fixtures,
    audioEngineRef,
    handleLightingFrame,
    handleDmxFrame,
  ]);

  // ─── DMX connect/disconnect ─────────────────────────────────────
  const handleDmxConnect = useCallback(async () => {
    if (!dmxOutputRef.current) dmxOutputRef.current = new DmxOutput();
    setDmxStatus("connecting");
    try {
      await dmxOutputRef.current.connect();
      setDmxStatus("connected");
    } catch {
      setDmxStatus("disconnected");
    }
  }, []);
  const handleDmxDisconnect = useCallback(async () => {
    const dmx = dmxOutputRef.current;
    if (dmx) {
      await dmx.disconnect();
      setDmxStatus("disconnected");
    }
  }, []);
  const handleDmxReconnect = useCallback(async () => {
    const dmx = dmxOutputRef.current;
    if (!dmx) return;
    setDmxStatus("connecting");
    const ok = await dmx.reconnect();
    setDmxStatus(ok ? "connected" : "disconnected");
  }, []);

  // ─── Fixture mutation handlers ──────────────────────────────────
  // Each one updates the persisted store AND pokes the live engine so
  // the change takes effect on the next tick without a full restart.
  const handleFixtureAddressChange = useCallback(
    (id: string, addr: number) => {
      updateFixtureAddress(id, addr);
      lightingEngineRef.current?.updateFixtureAddress(id, addr);
    },
    [updateFixtureAddress],
  );
  const handleStrobeModeChange = useCallback(
    (id: string, mode: StrobeMode) => {
      updateFixtureStrobeMode(id, mode);
      lightingEngineRef.current?.updateFixtureStrobeMode(id, mode);
    },
    [updateFixtureStrobeMode],
  );
  const handleStrobeThresholdChange = useCallback(
    (id: string, t: number) => {
      updateFixtureStrobeThreshold(id, t);
      lightingEngineRef.current?.updateFixtureStrobeThreshold(id, t);
    },
    [updateFixtureStrobeThreshold],
  );
  const handleStrobeMaxChange = useCallback(
    (id: string, m: number) => {
      updateFixtureStrobeMax(id, m);
      lightingEngineRef.current?.updateFixtureStrobeMax(id, m);
    },
    [updateFixtureStrobeMax],
  );
  const handleColorModeChange = useCallback(
    (id: string, mode: ColorMode) => {
      updateFixtureColorMode(id, mode);
      lightingEngineRef.current?.updateFixtureColorMode(id, mode);
    },
    [updateFixtureColorMode],
  );
  const handleSolidColorChange = useCallback(
    (id: string, color: { r: number; g: number; b: number }) => {
      updateFixtureSolidColor(id, color);
      lightingEngineRef.current?.updateFixtureSolidColor(id, color);
    },
    [updateFixtureSolidColor],
  );
  const handleDimmerModeChange = useCallback(
    (id: string, mode: DimmerMode) => {
      updateFixtureDimmerMode(id, mode);
      lightingEngineRef.current?.updateFixtureDimmerMode(id, mode);
    },
    [updateFixtureDimmerMode],
  );
  const handleManualDimmerChange = useCallback(
    (id: string, v: number) => {
      updateFixtureManualDimmer(id, v);
      lightingEngineRef.current?.updateFixtureManualDimmer(id, v);
    },
    [updateFixtureManualDimmer],
  );
  const handleAddFixture = useCallback(() => {
    addFixture(persistedProfileId);
  }, [addFixture, persistedProfileId]);
  const handleRemoveFixture = useCallback(
    (id: string) => removeFixture(id),
    [removeFixture],
  );
  const handleFixtureProfileChange = useCallback(
    (id: string, pid: string) => updateFixtureProfile(id, pid),
    [updateFixtureProfile],
  );

  // ─── Fog ────────────────────────────────────────────────────────
  // Toggles the engine's fog override. 150 ms debounce so a held key
  // doesn't oscillate. setFogActive() flips state; the engine's tick
  // forces every fog-channel to fogIntensity while active.
  const lastFogToggleRef = useRef(0);
  const triggerFog = useCallback(() => {
    const now = performance.now();
    if (now - lastFogToggleRef.current < 150) return;
    lastFogToggleRef.current = now;
    const eng = lightingEngineRef.current;
    if (!eng) return;
    eng.setFogActive(!eng.isFogActive(), fogIntensity);
  }, [fogIntensity]);
  const isFogActive = useCallback(
    () => lightingEngineRef.current?.isFogActive() ?? false,
    [],
  );

  return {
    // master
    enabled: lightingEnabled,
    setEnabled: setLightingEnabled,
    // dmx
    dmxStatus,
    dmxSupported,
    handleDmxConnect,
    handleDmxDisconnect,
    handleDmxReconnect,
    // fixtures
    fixtures: fixtures as FixtureInstance[],
    fixtureValues,
    dmxActiveCount,
    handleFixtureAddressChange,
    handleStrobeModeChange,
    handleStrobeThresholdChange,
    handleStrobeMaxChange,
    handleColorModeChange,
    handleSolidColorChange,
    handleDimmerModeChange,
    handleManualDimmerChange,
    handleFixtureProfileChange,
    handleAddFixture,
    handleRemoveFixture,
    selectedProfileId: persistedProfileId,
    setSelectedProfileId: setPersistedProfileId,
    // fog
    fogIntensity,
    setFogIntensity,
    triggerFog,
    isFogActive,
  };
}
