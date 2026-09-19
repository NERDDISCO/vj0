"use client";

import { useEffect, useRef } from "react";
import {
  ALL_PAD_IDS,
  FLASH_MS,
  computeLeds,
  executePadAction,
  getLaunchpad,
  hexToRgb7,
  padActionActive,
  type PadActionContext,
  type PadFeedbackState,
} from "@/src/lib/midi";
import { useMidiStore } from "@/src/lib/stores/midi-store";

interface UseLaunchpadArgs {
  ctx: PadActionContext;
  feedback: PadFeedbackState;
}

/**
 * useLaunchpad — mounts the shared Launchpad controller for the lifetime
 * of the app (not just while the MIDI drawer is open).
 *
 *   - forwards hardware presses to executePadAction (press only — release
 *     is used solely for the on-screen "held" glow)
 *   - installs `fire(id)` in the midi store so the virtual grid can trigger
 *     the exact same path as the hardware
 *   - mirrors connection status into the store
 *   - re-computes the LED map whenever bindings or feedback state change
 *     and sends only the diff to the device
 *   - auto-connects on load once the user has paired the device before
 *
 * `ctx` and `feedback` are read through refs so the pad listener never
 * goes stale and never needs re-subscribing.
 */
export function useLaunchpad({ ctx, feedback }: UseLaunchpadArgs): void {
  const ctxRef = useRef(ctx);
  const feedbackRef = useRef(feedback);
  useEffect(() => {
    ctxRef.current = ctx;
    feedbackRef.current = feedback;
  }, [ctx, feedback]);

  const bindings = useMidiStore((s) => s.bindings);
  const autoConnect = useMidiStore((s) => s.autoConnect);
  const gridIdleLevel = useMidiStore((s) => s.gridIdleLevel);

  useEffect(() => {
    const lp = getLaunchpad();
    const store = useMidiStore.getState();

    const fire = (id: number) => {
      const binding = useMidiStore.getState().bindings[id];
      if (!binding) return;
      // Momentary actions have no on/off state to show — blink the pad so
      // the hit still reads on the hardware.
      if (padActionActive(binding.action, feedbackRef.current) === null) {
        lp.flash(id, hexToRgb7(binding.color), FLASH_MS);
      }
      executePadAction(
        binding.action,
        useMidiStore.getState().bindings,
        feedbackRef.current,
        ctxRef.current,
      );
    };
    store.setFire(fire);
    store.setSnapshot(lp.getSnapshot());

    const offPad = lp.onPad((ev) => {
      useMidiStore.getState().setPressed(ev.id, ev.pressed);
      if (ev.pressed) fire(ev.id);
    });
    const offStatus = lp.onStatus((snap) => {
      const s = useMidiStore.getState();
      s.setSnapshot(snap);
      if (snap.status === "connected" && !s.autoConnect) s.setAutoConnect(true);
    });

    return () => {
      offPad();
      offStatus();
      useMidiStore.getState().setFire(null);
    };
  }, []);

  // One-shot auto-connect. Chrome remembers the MIDI+SysEx grant per
  // origin, so this is silent after the first manual pairing.
  useEffect(() => {
    if (autoConnect) void getLaunchpad().connect();
  }, [autoConnect]);

  useEffect(() => {
    getLaunchpad().setLeds(computeLeds(ALL_PAD_IDS, bindings, feedback, gridIdleLevel));
  }, [bindings, feedback, gridIdleLevel]);
}
