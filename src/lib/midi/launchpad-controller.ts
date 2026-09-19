/**
 * LaunchpadController — Web MIDI wrapper for the Launchpad Pro MK3.
 *
 * Owns the MIDIAccess handle, finds the device's programmer-mode port
 * ("… LPProMK3 MIDI", not the DAW or DIN ports), flips it into programmer
 * mode, normalises incoming messages into PadEvents and pushes LED colours
 * back out. Hot-plug is handled through `statechange`: unplugging drops to
 * "no-device", re-plugging reconnects and re-sends the full LED state.
 *
 * Framework-agnostic. One shared instance lives in `getLaunchpad()` so the
 * always-mounted hook (useLaunchpad) and the drawer UI (LaunchpadMode) talk
 * to the same device.
 */

import {
  LAUNCHPAD_PRO_MK3_NAME_RE,
  LED_BATCH_SIZE,
  ledRgbMessage,
  packRgb7,
  parsePadMessage,
  programmerModeMessage,
  type PadEvent,
  type Rgb7,
} from "./launchpad-pro-mk3";

export type LaunchpadStatus =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "no-device"
  | "connected"
  | "error";

export interface LaunchpadSnapshot {
  status: LaunchpadStatus;
  deviceName: string | null;
  error: string | null;
  /** LED colour specs pushed to the device since connect (debug aid). */
  ledTx: number;
}

type PadListener = (ev: PadEvent) => void;
type StatusListener = (snap: LaunchpadSnapshot) => void;

export class LaunchpadController {
  private access: MIDIAccess | null = null;
  private input: MIDIInput | null = null;
  private output: MIDIOutput | null = null;
  private snapshot: LaunchpadSnapshot = {
    status: typeof navigator !== "undefined" && "requestMIDIAccess" in navigator
      ? "disconnected"
      : "unsupported",
    deviceName: null,
    error: null,
    ledTx: 0,
  };
  private padListeners = new Set<PadListener>();
  private statusListeners = new Set<StatusListener>();
  /** Last colour we sent per pad id, packed — lets setLeds diff. */
  private ledState = new Map<number, number>();
  /** Full desired LED map, re-sent on (re)connect. */
  private desiredLeds = new Map<number, Rgb7>();
  private repaintTimer: ReturnType<typeof setTimeout> | null = null;
  private flashTimers = new Map<number, ReturnType<typeof setTimeout>>();

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
  }

  getSnapshot(): LaunchpadSnapshot {
    return this.snapshot;
  }

  onPad(listener: PadListener): () => void {
    this.padListeners.add(listener);
    return () => this.padListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /**
   * Request MIDI access (with SysEx — needed for programmer mode + RGB
   * LEDs) and bind to the first Launchpad Pro MK3 found. Safe to call
   * repeatedly; a second call while connected is a no-op.
   */
  async connect(): Promise<void> {
    if (!LaunchpadController.isSupported()) {
      this.setSnapshot({ status: "unsupported", deviceName: null, error: null, ledTx: 0 });
      return;
    }
    if (this.snapshot.status === "connected" || this.snapshot.status === "connecting") return;
    this.setSnapshot({ status: "connecting", deviceName: null, error: null, ledTx: 0 });
    try {
      if (!this.access) {
        this.access = await navigator.requestMIDIAccess({ sysex: true });
        this.access.onstatechange = () => this.bindPorts();
      }
      this.bindPorts();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setSnapshot({
        status: "error",
        deviceName: null,
        error: /sysex|permission|denied|NotAllowed/i.test(msg)
          ? "MIDI + SysEx permission denied — allow it in the browser prompt"
          : msg,
        ledTx: 0,
      });
    }
  }

  /** Leave programmer mode, drop the port bindings. Keeps MIDIAccess. */
  async disconnect(): Promise<void> {
    this.releasePorts(true);
    this.setSnapshot({ status: "disconnected", deviceName: null, error: null, ledTx: 0 });
  }

  /**
   * Set the desired colour for every pad in `leds` (pads not listed keep
   * their previous colour). Only pads whose colour actually changed are
   * sent. Safe to call while disconnected — the map is replayed on connect.
   */
  setLeds(leds: ReadonlyMap<number, Rgb7>): void {
    const dirty: Array<readonly [number, Rgb7]> = [];
    for (const [id, rgb] of leds) {
      this.desiredLeds.set(id, rgb);
      const packed = packRgb7(rgb);
      if (this.ledState.get(id) !== packed) {
        this.ledState.set(id, packed);
        dirty.push([id, rgb]);
      }
    }
    this.flushLeds(dirty);
  }

  /**
   * Light one pad at `rgb` for `ms`, then drop it back to whatever
   * setLeds last asked for. Used for momentary actions (reroll, nudges)
   * that have no on/off state to show.
   */
  flash(id: number, rgb: Rgb7, ms: number): void {
    const prev = this.flashTimers.get(id);
    if (prev) clearTimeout(prev);
    this.ledState.set(id, packRgb7(rgb));
    this.flushLeds([[id, rgb]]);
    this.flashTimers.set(
      id,
      setTimeout(() => {
        this.flashTimers.delete(id);
        const want = this.desiredLeds.get(id) ?? [0, 0, 0];
        this.ledState.set(id, packRgb7(want));
        this.flushLeds([[id, want]]);
      }, ms),
    );
  }

  // ─── internals ───────────────────────────────────────────────────

  private bindPorts(): void {
    if (!this.access) return;
    const input = pickPort(this.access.inputs.values());
    const output = pickPort(this.access.outputs.values());

    // Same ports as before and still open → nothing to do (statechange
    // fires for unrelated devices too).
    if (input && output && input === this.input && output === this.output) return;

    this.releasePorts(false);
    if (!input || !output) {
      this.setSnapshot({ status: "no-device", deviceName: null, error: null, ledTx: 0 });
      return;
    }

    this.input = input;
    this.output = output;
    input.onmidimessage = (ev: MIDIMessageEvent) => {
      if (!ev.data) return;
      const pad = parsePadMessage(ev.data);
      if (pad) for (const l of this.padListeners) l(pad);
    };
    output.send(programmerModeMessage(true));
    this.ledState.clear();
    this.setSnapshot({
      status: "connected",
      deviceName: (input.name ?? "Launchpad Pro MK3").replace(/\s*LPProMK3\s*MIDI\s*/i, "").trim(),
      error: null,
      ledTx: 0,
    });
    // The firmware clears every LED while it switches layout, so a paint
    // sent in the same breath as the mode message gets wiped. Give it a
    // beat, then repaint everything from scratch.
    if (this.repaintTimer) clearTimeout(this.repaintTimer);
    this.repaintTimer = setTimeout(() => {
      this.repaintTimer = null;
      if (this.output !== output) return;
      this.ledState.clear();
      this.flushLeds(Array.from(this.desiredLeds.entries()));
      for (const [id, rgb] of this.desiredLeds) this.ledState.set(id, packRgb7(rgb));
    }, PROGRAMMER_MODE_SETTLE_MS);
  }

  private releasePorts(leaveProgrammerMode: boolean): void {
    if (this.repaintTimer) {
      clearTimeout(this.repaintTimer);
      this.repaintTimer = null;
    }
    for (const t of this.flashTimers.values()) clearTimeout(t);
    this.flashTimers.clear();
    if (this.input) this.input.onmidimessage = null;
    if (this.output && leaveProgrammerMode && this.output.state === "connected") {
      try {
        // Blank every pad we touched, then hand the surface back to the
        // firmware's live mode so the device isn't left dark.
        const off: Array<readonly [number, Rgb7]> = [];
        for (const id of this.ledState.keys()) off.push([id, [0, 0, 0]]);
        this.flushLeds(off);
        this.output.send(programmerModeMessage(false));
      } catch {
        /* device already gone */
      }
    }
    this.input = null;
    this.output = null;
    this.ledState.clear();
  }

  private flushLeds(entries: ReadonlyArray<readonly [number, Rgb7]>): void {
    const out = this.output;
    if (!out || entries.length === 0 || out.state !== "connected") return;
    for (let i = 0; i < entries.length; i += LED_BATCH_SIZE) {
      try {
        out.send(ledRgbMessage(entries.slice(i, i + LED_BATCH_SIZE)));
      } catch (err) {
        // Port closed mid-flight (statechange will follow) or a malformed
        // message — surface it instead of silently dropping LED updates.
        this.setSnapshot({
          ...this.snapshot,
          error: `led send failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
    }
    this.setSnapshot({ ...this.snapshot, ledTx: this.snapshot.ledTx + entries.length });
  }

  private setSnapshot(next: LaunchpadSnapshot): void {
    this.snapshot = next;
    for (const l of this.statusListeners) l(next);
  }
}

/**
 * Pick the programmer-mode port. The Pro MK3 exposes three: "MIDI"
 * (what we want — custom modes + programmer mode), "DIN" (the 5-pin
 * pass-through) and "DAW" (Ableton-style session control). Prefer the one
 * literally named MIDI, then anything that isn't DIN/DAW, then anything.
 */
function pickPort<T extends MIDIPort>(ports: IterableIterator<T>): T | null {
  const candidates = Array.from(ports).filter((p) =>
    LAUNCHPAD_PRO_MK3_NAME_RE.test(p.name ?? ""),
  );
  if (candidates.length === 0) return null;
  return (
    candidates.find((p) => /\bMIDI\b/i.test(p.name ?? "")) ??
    candidates.find((p) => !/\b(DIN|DAW)\b/i.test(p.name ?? "")) ??
    candidates[0]
  );
}

/** How long the firmware needs after a mode switch before LEDs stick. */
const PROGRAMMER_MODE_SETTLE_MS = 250;

// Parked on globalThis so Next's Fast Refresh (which re-evaluates this
// module) can't spawn a second controller that owns no ports while the
// original keeps the device.
const SHARED_KEY = "__vj0Launchpad" as const;
type SharedHost = typeof globalThis & { [SHARED_KEY]?: LaunchpadController };

/** Process-wide controller instance (one physical device, one owner). */
export function getLaunchpad(): LaunchpadController {
  const host = globalThis as SharedHost;
  const cached = host[SHARED_KEY];
  if (!cached) return (host[SHARED_KEY] = new LaunchpadController());
  if (Object.getPrototypeOf(cached) !== LaunchpadController.prototype) {
    // Fast Refresh re-evaluated this module: the surviving instance still
    // owns the MIDI ports but carries the previous class, so any method
    // added since (e.g. flash) is missing on it. Swap in the current
    // prototype and backfill fields the new constructor introduced.
    Object.setPrototypeOf(cached, LaunchpadController.prototype);
    const fresh = new LaunchpadController() as unknown as Record<string, unknown>;
    const target = cached as unknown as Record<string, unknown>;
    for (const key of Object.keys(fresh)) {
      if (!(key in target)) target[key] = fresh[key];
    }
  }
  return cached;
}
