/**
 * Pad actions — what a Launchpad pad (or its on-screen twin) does when
 * pressed, plus how to read back whether it's "on" for LED feedback.
 *
 * Every press is a one-shot: prompts switch on press, toggles flip on
 * press, nudges step on press. Nothing is hold-to-activate. Release events
 * are ignored entirely by the dispatcher.
 *
 * Store-backed actions (stage FX, steps, resolution, scene) are executed
 * straight against the zustand stores so they work identically from the
 * hardware, the virtual grid, and any future surface. Actions that need
 * app-owned state (prompt → active scene + flush, generation, AI
 * connection, recording) go through `PadActionContext`, supplied by the
 * app that mounts the controller.
 */

import { OUTPUT_PRESETS, useAiSettingsStore } from "../stores/ai-settings-store";
import { useSceneStore } from "../composer/scene-store";
import { hexToRgb7, isGridPad, scaleRgb7, type Rgb7 } from "./launchpad-pro-mk3";

export type ToggleKey =
  | "generating"
  | "aiConnect"
  | "recording"
  | "scanlines"
  | "vignette"
  | "pixelate";

export type NudgeKey = "alpha" | "pixelSize" | "sharpen";

export type PadAction =
  | { type: "prompt"; label: string; prompt: string }
  | { type: "random-prompt" }
  | { type: "reroll" }
  | { type: "toggle"; key: ToggleKey }
  | { type: "nudge"; key: NudgeKey; delta: number }
  | { type: "steps"; value: number }
  | { type: "resolution"; w: number; h: number }
  | { type: "scene"; index: number }
  /** Flip an element (typically a logo) on/off by id, in whatever scene it lives. */
  | { type: "logo"; elementId: string };

export type PadActionType = PadAction["type"];

export interface PadBinding {
  action: PadAction;
  /** "#rrggbb" — LED colour on the device and swatch colour in the UI. */
  color: string;
}

export const TOGGLE_LABELS: Record<ToggleKey, string> = {
  generating: "generate",
  aiConnect: "ai link",
  recording: "record",
  scanlines: "scanlines",
  vignette: "vignette",
  pixelate: "pixelate",
};

export const NUDGE_LABELS: Record<NudgeKey, string> = {
  alpha: "α",
  pixelSize: "px",
  sharpen: "sharp",
};

export const ACTION_TYPE_LABELS: Record<PadActionType, string> = {
  prompt: "prompt",
  "random-prompt": "random prompt",
  reroll: "reroll seed",
  toggle: "toggle",
  nudge: "nudge value",
  steps: "set steps",
  resolution: "set resolution",
  scene: "switch scene",
  logo: "toggle logo",
};

/** Short caption shown on the virtual pad. */
export function padActionLabel(action: PadAction): string {
  switch (action.type) {
    case "prompt":
      return action.label;
    case "random-prompt":
      return "random";
    case "reroll":
      return "reroll";
    case "toggle":
      return TOGGLE_LABELS[action.key];
    case "nudge":
      return `${NUDGE_LABELS[action.key]} ${action.delta > 0 ? "+" : "−"}${Math.abs(action.delta)}`;
    case "steps":
      return `steps ${action.value}`;
    case "resolution":
      return `${action.w}×${action.h}`;
    case "scene": {
      const scene = useSceneStore.getState().scenes[action.index];
      return scene ? scene.name : `scene ${action.index + 1}`;
    }
    case "logo":
      return findElement(action.elementId)?.name ?? "logo";
  }
}

function findElement(id: string) {
  for (const sc of useSceneStore.getState().scenes) {
    const el = sc.elements.find((e) => e.id === id);
    if (el) return el;
  }
  return null;
}

/** Longer description for tooltips / the editor header. */
export function padActionDescription(action: PadAction): string {
  switch (action.type) {
    case "prompt":
      return action.prompt;
    case "random-prompt":
      return "fire a random prompt pad";
    case "reroll":
      return "new seed, same prompt";
    case "toggle":
      return `toggle ${TOGGLE_LABELS[action.key]}`;
    case "nudge":
      return `${NUDGE_LABELS[action.key]} ${action.delta > 0 ? "+" : ""}${action.delta}`;
    case "steps":
      return `klein steps → ${action.value}`;
    case "resolution":
      return OUTPUT_PRESETS.find((p) => p.w === action.w && p.h === action.h)?.label ?? `${action.w}×${action.h}`;
    case "scene":
      return `activate scene ${action.index + 1}`;
    case "logo":
      return `show/hide ${findElement(action.elementId)?.name ?? "logo"}`;
  }
}

/** App-owned state the executor can't reach through a store. */
export interface PadActionContext {
  firePrompt: (prompt: string) => void;
  rerollSeed: () => void;
  nudgeAlpha: (delta: number) => void;
  setGenerating: (on: boolean) => void;
  connectAi: () => void;
  disconnectAi: () => void;
  startRecording: () => void;
  stopRecording: () => void;
}

/** Live values the LED/virtual feedback needs. Built by the app. */
export interface PadFeedbackState {
  activePrompt: string;
  generating: boolean;
  aiConnected: boolean;
  recording: boolean;
  scanlines: boolean;
  vignette: boolean;
  pixelate: boolean;
  steps: number;
  outputWidth: number;
  outputHeight: number;
  activeSceneIndex: number;
  /** Comma-joined ids of disabled elements — a string so memo/effect deps stay cheap. */
  disabledElementIds: string;
}

export function executePadAction(
  action: PadAction,
  bindings: Readonly<Record<number, PadBinding>>,
  state: PadFeedbackState,
  ctx: PadActionContext,
): void {
  const ai = useAiSettingsStore.getState();
  switch (action.type) {
    case "prompt":
      ctx.firePrompt(action.prompt);
      return;
    case "random-prompt": {
      const prompts: string[] = [];
      for (const b of Object.values(bindings)) {
        if (b.action.type === "prompt" && b.action.prompt !== state.activePrompt) {
          prompts.push(b.action.prompt);
        }
      }
      if (prompts.length === 0) return;
      ctx.firePrompt(prompts[Math.floor(Math.random() * prompts.length)]);
      return;
    }
    case "reroll":
      ctx.rerollSeed();
      return;
    case "toggle":
      switch (action.key) {
        case "generating":
          ctx.setGenerating(!state.generating);
          return;
        case "aiConnect":
          if (state.aiConnected) ctx.disconnectAi();
          else ctx.connectAi();
          return;
        case "recording":
          if (state.recording) ctx.stopRecording();
          else ctx.startRecording();
          return;
        case "scanlines":
          ai.setStageScanlines(!ai.stageScanlines);
          return;
        case "vignette":
          ai.setStageVignette(!ai.stageVignette);
          return;
        case "pixelate":
          ai.setStagePixelate(!ai.stagePixelate);
          return;
      }
      return;
    case "nudge":
      switch (action.key) {
        case "alpha":
          ctx.nudgeAlpha(action.delta);
          return;
        case "pixelSize":
          ai.setStagePixelateSize(ai.stagePixelateSize + action.delta);
          return;
        case "sharpen":
          ai.setStageSharpen(+(ai.stageSharpen + action.delta).toFixed(2));
          return;
      }
      return;
    case "steps":
      ai.setKleinSteps(action.value);
      return;
    case "resolution":
      ai.setOutputSize(action.w, action.h);
      return;
    case "scene": {
      const scene = useSceneStore.getState().scenes[action.index];
      if (scene) useSceneStore.getState().setActiveScene(scene.id);
      return;
    }
    case "logo":
      useSceneStore.getState().toggleElementEnabled(action.elementId);
      return;
  }
}

/**
 * Whether the pad should read as "on". `null` = momentary action with no
 * on/off state (reroll, nudges, random) — rendered at idle brightness.
 */
export function padActionActive(action: PadAction, state: PadFeedbackState): boolean | null {
  switch (action.type) {
    case "prompt":
      return action.prompt === state.activePrompt;
    case "toggle":
      switch (action.key) {
        case "generating":
          return state.generating;
        case "aiConnect":
          return state.aiConnected;
        case "recording":
          return state.recording;
        case "scanlines":
          return state.scanlines;
        case "vignette":
          return state.vignette;
        case "pixelate":
          return state.pixelate;
      }
      return null;
    case "steps":
      return action.value === state.steps;
    case "resolution":
      return action.w === state.outputWidth && action.h === state.outputHeight;
    case "scene":
      return action.index === state.activeSceneIndex;
    case "logo":
      return !state.disabledElementIds.split(",").includes(action.elementId);
    default:
      return null;
  }
}

/** Default idle glow for grid pads (fraction of full colour). */
export const DEFAULT_GRID_IDLE_LEVEL = 0.05;
export const MAX_GRID_IDLE_LEVEL = 0.4;
/** How long a momentary pad flashes its colour when hit. */
export const FLASH_MS = 140;

/**
 * Hardware LED colour for one pad.
 *
 *   grid pad, active    → full colour
 *   grid pad, idle      → faint glow (`gridIdleLevel`) so the bank is
 *                         findable in a dark booth; never fully off while
 *                         the level is > 0
 *   edge button, on     → full colour
 *   edge button, off    → dark (momentary buttons flash on press instead)
 *   unbound             → dark
 */
export function padLedColor(
  id: number,
  binding: PadBinding | undefined,
  state: PadFeedbackState,
  gridIdleLevel: number,
): Rgb7 {
  if (!binding) return [0, 0, 0];
  const full = hexToRgb7(binding.color);
  const active = padActionActive(binding.action, state);
  if (active === true) return full;
  if (!isGridPad(id) || gridIdleLevel <= 0) return [0, 0, 0];
  const dim = scaleRgb7(full, gridIdleLevel);
  // Keep at least the dominant channel at 1 so a very low slider setting
  // still leaves a visible pinprick instead of switching the pad off.
  if (dim[0] === 0 && dim[1] === 0 && dim[2] === 0) {
    const max = Math.max(full[0], full[1], full[2]);
    return [full[0] === max ? 1 : 0, full[1] === max ? 1 : 0, full[2] === max ? 1 : 0];
  }
  return dim;
}

/** Full LED map for every bound pad. Unbound ids are emitted as off. */
export function computeLeds(
  ids: ReadonlyArray<number>,
  bindings: Readonly<Record<number, PadBinding>>,
  state: PadFeedbackState,
  gridIdleLevel: number,
): Map<number, Rgb7> {
  const out = new Map<number, Rgb7>();
  for (const id of ids) out.set(id, padLedColor(id, bindings[id], state, gridIdleLevel));
  return out;
}
