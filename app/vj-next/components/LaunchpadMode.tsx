"use client";

import { useState } from "react";
import {
  GRID_ROWS,
  LEFT_COLUMN,
  RIGHT_COLUMN,
  TOP_ROW,
  MAX_GRID_IDLE_LEVEL,
  isGridPad,
  ACTION_TYPE_LABELS,
  NUDGE_LABELS,
  TOGGLE_LABELS,
  PAD_COLOR_SWATCHES,
  getLaunchpad,
  padActionActive,
  padActionDescription,
  padActionLabel,
  type NudgeKey,
  type PadAction,
  type PadActionType,
  type PadBinding,
  type PadFeedbackState,
  type ToggleKey,
} from "@/src/lib/midi";
import { useMidiStore } from "@/src/lib/stores/midi-store";
import { OUTPUT_PRESETS } from "@/src/lib/stores/ai-settings-store";
import { useSceneStore } from "@/src/lib/composer";

interface LaunchpadModeProps {
  feedback: PadFeedbackState;
}

/**
 * LaunchpadMode — the always-visible third workspace column. A 1:1 virtual
 * Launchpad Pro MK3: the 8×8 prompt grid plus the four edge rows, laid out
 * exactly like the hardware so the on-screen twin and the device always
 * agree. Click a pad = same as pressing it. The ✎ corner (or right-click)
 * opens the binding editor for that pad.
 */
export function LaunchpadMode({ feedback }: LaunchpadModeProps) {
  const status = useMidiStore((s) => s.status);
  const deviceName = useMidiStore((s) => s.deviceName);
  const error = useMidiStore((s) => s.error);
  const ledTx = useMidiStore((s) => s.ledTx);
  const lastPressed = useMidiStore((s) => s.lastPressed);
  const autoConnect = useMidiStore((s) => s.autoConnect);
  const setAutoConnect = useMidiStore((s) => s.setAutoConnect);
  const gridIdleLevel = useMidiStore((s) => s.gridIdleLevel);
  const setGridIdleLevel = useMidiStore((s) => s.setGridIdleLevel);
  const resetBindings = useMidiStore((s) => s.resetBindings);
  const [editing, setEditing] = useState<number | null>(null);

  const connected = status === "connected";

  return (
    <div className="vp-lp">
      <div className="vp-lp__bar">
        <span className={`vp-lp__status vp-lp__status--${status}`}>
          <i />
          {statusText(status, deviceName, error)}
        </span>
        {status === "unsupported" ? null : connected ? (
          <button
            type="button"
            className="vj-btn vj-btn--bar"
            onClick={() => void getLaunchpad().disconnect()}
          >
            disconnect
          </button>
        ) : (
          <button
            type="button"
            className="vj-btn vj-btn--bar vj-btn--accent"
            onClick={() => void getLaunchpad().connect()}
            disabled={status === "connecting"}
          >
            {status === "connecting" ? "connecting…" : "connect launchpad"}
          </button>
        )}
        <label className="vp-lp__auto">
          <input
            type="checkbox"
            checked={autoConnect}
            onChange={(e) => setAutoConnect(e.target.checked)}
          />
          auto-connect
        </label>
        <label className="vp-lp__auto" title="How faintly inactive grid pads glow on the hardware. 0 = off.">
          idle glow
          <input
            type="range"
            min={0}
            max={MAX_GRID_IDLE_LEVEL}
            step={0.01}
            value={gridIdleLevel}
            onChange={(e) => setGridIdleLevel(Number(e.target.value))}
            style={{ width: 80 }}
          />
          <b>{Math.round(gridIdleLevel * 100)}%</b>
        </label>
        {connected && (
          <span className="vp-lp__hint" title="LED colour specs sent to the device since connect">
            ↑ <b>{ledTx}</b> leds
          </span>
        )}
        <span className="vp-lp__hint">
          click = fire · <kbd>✎</kbd> / right-click = edit
          {lastPressed != null && <> · last pad <b>{lastPressed}</b></>}
        </span>
        <button
          type="button"
          className="vj-btn vj-btn--bar"
          style={{ marginLeft: "auto" }}
          onClick={() => {
            if (window.confirm("reset every pad to the factory layout?")) resetBindings();
          }}
        >
          reset layout
        </button>
      </div>

      <div className="vp-lp__body">
        <PadGrid feedback={feedback} editing={editing} onEdit={setEditing} />
        {editing != null && (
          <PadEditor id={editing} onClose={() => setEditing(null)} />
        )}
      </div>
    </div>
  );
}

function statusText(
  status: string,
  deviceName: string | null,
  error: string | null,
): string {
  switch (status) {
    case "connected":
      return deviceName ?? "launchpad connected";
    case "connecting":
      return "connecting…";
    case "no-device":
      return "no launchpad pro mk3 found — plug it in";
    case "unsupported":
      return "web midi not supported in this browser";
    case "error":
      return error ?? "midi error";
    default:
      return "not connected";
  }
}

// ─── Grid ───────────────────────────────────────────────────────────

function PadGrid({
  feedback,
  editing,
  onEdit,
}: {
  feedback: PadFeedbackState;
  editing: number | null;
  onEdit: (id: number) => void;
}) {
  const bindings = useMidiStore((s) => s.bindings);
  const pressed = useMidiStore((s) => s.pressed);
  const fire = useMidiStore((s) => s.fire);

  const cell = (id: number, round?: boolean) => (
    <Pad
      key={id}
      id={id}
      binding={bindings[id]}
      feedback={feedback}
      held={!!pressed[id]}
      editing={editing === id}
      round={round}
      onFire={() => fire?.(id)}
      onEdit={() => onEdit(id)}
    />
  );

  return (
    <div className="vp-lp__device" role="grid" aria-label="launchpad pro mk3">
      <span className="vp-lp__corner" />
      {TOP_ROW.map((id) => cell(id, true))}
      <span className="vp-lp__corner vp-lp__logo" title="novation">
        ◗
      </span>
      {GRID_ROWS.map((row, r) => (
        <div key={r} className="vp-lp__row">
          {cell(LEFT_COLUMN[r], true)}
          {row.map((id) => cell(id))}
          {cell(RIGHT_COLUMN[r], true)}
        </div>
      ))}
    </div>
  );
}

function Pad({
  id,
  binding,
  feedback,
  held,
  editing,
  round,
  onFire,
  onEdit,
}: {
  id: number;
  binding: PadBinding | undefined;
  feedback: PadFeedbackState;
  held: boolean;
  editing: boolean;
  round?: boolean;
  onFire: () => void;
  onEdit: () => void;
}) {
  const active = binding ? padActionActive(binding.action, feedback) : null;
  // On-screen brightness ladder. Mirrors the hardware: edge buttons are
  // dark unless on; grid pads keep a readable idle tint (the screen has
  // labels to show, the hardware doesn't).
  const level = !binding ? 0 : active === true ? 1 : isGridPad(id) ? 0.22 : 0;
  const color = binding?.color ?? "#000000";
  const label = binding ? padActionLabel(binding.action) : "";
  const title = binding
    ? `${id} · ${label} — ${padActionDescription(binding.action)}`
    : `${id} · unbound`;

  return (
    <div
      className={[
        "vp-lp__pad",
        round ? "vp-lp__pad--round" : "",
        active ? "vp-lp__pad--on" : "",
        held ? "vp-lp__pad--held" : "",
        editing ? "vp-lp__pad--editing" : "",
        binding ? "" : "vp-lp__pad--empty",
        binding && level === 0 ? "vp-lp__pad--off" : "",
      ].join(" ")}
      style={{ "--pad": color, "--lvl": level } as React.CSSProperties}
      title={title}
      onContextMenu={(e) => {
        e.preventDefault();
        onEdit();
      }}
    >
      <button
        type="button"
        className="vp-lp__fire"
        onClick={onFire}
        aria-label={title}
        disabled={!binding}
      >
        <span className="vp-lp__label">{label}</span>
      </button>
      <button
        type="button"
        className="vp-lp__edit"
        onClick={onEdit}
        title="edit binding"
        aria-label={`edit pad ${id}`}
      >
        ✎
      </button>
    </div>
  );
}

// ─── Editor ─────────────────────────────────────────────────────────

const ACTION_TYPES = Object.keys(ACTION_TYPE_LABELS) as PadActionType[];

function defaultActionFor(type: PadActionType, previous?: PadAction): PadAction {
  if (previous && previous.type === type) return previous;
  switch (type) {
    case "prompt":
      return { type, label: "new", prompt: "" };
    case "random-prompt":
    case "reroll":
      return { type };
    case "toggle":
      return { type, key: "scanlines" };
    case "nudge":
      return { type, key: "alpha", delta: 0.02 };
    case "steps":
      return { type, value: 2 };
    case "resolution":
      return { type, w: 512, h: 288 };
    case "scene":
      return { type, index: 0 };
    case "logo": {
      const first = useSceneStore.getState().scenes.flatMap((s) => s.elements).find((e) => e.kind === "image");
      return { type, elementId: first?.id ?? "" };
    }
  }
}

function PadEditor({ id, onClose }: { id: number; onClose: () => void }) {
  const binding = useMidiStore((s) => s.bindings[id]);
  const setBinding = useMidiStore((s) => s.setBinding);
  const clearBinding = useMidiStore((s) => s.clearBinding);
  const scenes = useSceneStore((s) => s.scenes);

  const action: PadAction = binding?.action ?? { type: "prompt", label: "new", prompt: "" };
  const color = binding?.color ?? PAD_COLOR_SWATCHES[0];

  const commit = (next: Partial<PadBinding>) =>
    setBinding(id, { action, color, ...next });
  const setAction = (next: PadAction) => commit({ action: next });

  return (
    <div className="vp-lp__editor">
      <div className="vp-lp__editor-head">
        <span className="vp-lp__swatch" style={{ background: color }} />
        <span>
          pad <b>{id}</b>
          {binding ? "" : " · unbound"}
        </span>
        <button
          type="button"
          className="vp-drawer__close"
          onClick={onClose}
          title="close editor"
          style={{ marginLeft: "auto" }}
        >
          ×
        </button>
      </div>

      <label className="vp-lp__field">
        <span>action</span>
        <select
          value={action.type}
          onChange={(e) =>
            setAction(defaultActionFor(e.target.value as PadActionType, action))
          }
        >
          {ACTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {ACTION_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>

      {action.type === "prompt" && (
        <>
          <label className="vp-lp__field">
            <span>label</span>
            <input
              autoFocus
              value={action.label}
              maxLength={12}
              onChange={(e) =>
                setAction({ ...action, label: e.target.value.slice(0, 12) })
              }
            />
          </label>
          <label className="vp-lp__field">
            <span>prompt</span>
            <textarea
              rows={4}
              value={action.prompt}
              onChange={(e) => setAction({ ...action, prompt: e.target.value })}
              placeholder="short, punchy — subject, modifier, light"
            />
          </label>
        </>
      )}

      {action.type === "toggle" && (
        <label className="vp-lp__field">
          <span>toggles</span>
          <select
            value={action.key}
            onChange={(e) => setAction({ ...action, key: e.target.value as ToggleKey })}
          >
            {(Object.keys(TOGGLE_LABELS) as ToggleKey[]).map((k) => (
              <option key={k} value={k}>
                {TOGGLE_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      )}

      {action.type === "nudge" && (
        <>
          <label className="vp-lp__field">
            <span>value</span>
            <select
              value={action.key}
              onChange={(e) => setAction({ ...action, key: e.target.value as NudgeKey })}
            >
              {(Object.keys(NUDGE_LABELS) as NudgeKey[]).map((k) => (
                <option key={k} value={k}>
                  {NUDGE_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="vp-lp__field">
            <span>delta</span>
            <input
              type="number"
              step="any"
              value={action.delta}
              onChange={(e) =>
                setAction({ ...action, delta: Number(e.target.value) || 0 })
              }
            />
          </label>
        </>
      )}

      {action.type === "steps" && (
        <label className="vp-lp__field">
          <span>steps</span>
          <select
            value={action.value}
            onChange={(e) => setAction({ ...action, value: Number(e.target.value) })}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}

      {action.type === "resolution" && (
        <label className="vp-lp__field">
          <span>resolution</span>
          <select
            value={`${action.w}x${action.h}`}
            onChange={(e) => {
              const p = OUTPUT_PRESETS.find((o) => o.id === e.target.value);
              if (p) setAction({ ...action, w: p.w, h: p.h });
            }}
          >
            {OUTPUT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {action.type === "logo" && (
        <label className="vp-lp__field">
          <span>logo</span>
          <select
            value={action.elementId}
            onChange={(e) => setAction({ ...action, elementId: e.target.value })}
          >
            <option value="">(pick a logo element)</option>
            {scenes.flatMap((sc) =>
              sc.elements
                .filter((el) => el.kind === "image")
                .map((el) => (
                  <option key={el.id} value={el.id}>
                    {sc.name} · {el.name}
                  </option>
                )),
            )}
          </select>
        </label>
      )}

      {action.type === "scene" && (
        <label className="vp-lp__field">
          <span>scene</span>
          <select
            value={action.index}
            onChange={(e) => setAction({ ...action, index: Number(e.target.value) })}
          >
            {Array.from({ length: Math.max(8, scenes.length) }, (_, i) => (
              <option key={i} value={i}>
                {i + 1} · {scenes[i]?.name ?? "(empty slot)"}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="vp-lp__field">
        <span>colour</span>
        <div className="vp-lp__swatches">
          {PAD_COLOR_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              className="vp-lp__swatch"
              aria-pressed={c === color}
              style={{ background: c }}
              onClick={() => commit({ color: c })}
              title={c}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => commit({ color: e.target.value })}
            title="custom colour"
          />
        </div>
      </div>

      <div className="vp-lp__editor-foot">
        {binding && (
          <button
            type="button"
            className="vj-btn vj-btn--bar vj-btn--danger"
            onClick={() => {
              clearBinding(id);
              onClose();
            }}
          >
            clear pad
          </button>
        )}
        <button
          type="button"
          className="vj-btn vj-btn--bar"
          style={{ marginLeft: "auto" }}
          onClick={onClose}
        >
          done
        </button>
      </div>
    </div>
  );
}
