/**
 * Novation Launchpad Pro MK3 — programmer-mode protocol constants.
 *
 * Everything here is pure data + tiny pure functions; no Web MIDI, no
 * React. The controller (launchpad-controller.ts) turns these into wire
 * bytes, the UI (LaunchpadMode.tsx) turns them into a virtual pad grid.
 *
 * Programmer mode gives us a flat 10×10 address space. Every button has a
 * decimal id `10 * row + col` where row 0 is the bottom edge, row 9 the
 * top edge, col 0 the left edge and col 9 the right edge:
 *
 *        91 92 93 94 95 96 97 98  (99 = logo, LED only)
 *   80   81 82 83 84 85 86 87 88   89
 *   70   71 72 73 74 75 76 77 78   79
 *   60   61 62 63 64 65 66 67 68   69
 *   50   51 52 53 54 55 56 57 58   59
 *   40   41 42 43 44 45 46 47 48   49
 *   30   31 32 33 34 35 36 37 38   39
 *   20   21 22 23 24 25 26 27 28   29
 *   10   11 12 13 14 15 16 17 18   19
 *       101 102 103 104 105 106 107 108
 *
 * The 8×8 grid (11..88) sends Note On/Off on channel 1; every edge button
 * sends CC on channel 1 with the same id as the controller number. LEDs on
 * *all* of them are addressed by id via SysEx, so the app only ever thinks
 * in ids.
 */

/** Device id byte inside the Novation SysEx header (0x0E = Pro MK3). */
export const LAUNCHPAD_PRO_MK3_DEVICE_ID = 0x0e;

/** Matches the port names macOS/Windows/Linux expose for the device. */
export const LAUNCHPAD_PRO_MK3_NAME_RE = /launchpad\s*pro\s*mk3|LPProMK3/i;

const SYSEX_HEADER = [0xf0, 0x00, 0x20, 0x29, 0x02, LAUNCHPAD_PRO_MK3_DEVICE_ID];

/** Enter (true) or leave (false) programmer mode. */
export function programmerModeMessage(on: boolean): Uint8Array {
  return Uint8Array.from([...SYSEX_HEADER, 0x0e, on ? 0x01 : 0x00, 0xf7]);
}

export type Rgb7 = readonly [r: number, g: number, b: number]; // 0..127 each

/**
 * Static RGB LED update for a batch of pads. Each channel is 0..127. The
 * device accepts many colour specs per message — we chunk at 32 to stay
 * well inside any USB packet limits.
 */
export function ledRgbMessage(entries: ReadonlyArray<readonly [id: number, rgb: Rgb7]>): Uint8Array {
  const out: number[] = [...SYSEX_HEADER, 0x03];
  for (const [id, [r, g, b]] of entries) {
    out.push(0x03, id & 0x7f, r & 0x7f, g & 0x7f, b & 0x7f);
  }
  out.push(0xf7);
  return Uint8Array.from(out);
}

export const LED_BATCH_SIZE = 32;

/** Pad ids by physical region. Row 8 is the top grid row, row 1 the bottom. */
export const GRID_ROWS: ReadonlyArray<ReadonlyArray<number>> = [8, 7, 6, 5, 4, 3, 2, 1].map(
  (row) => [1, 2, 3, 4, 5, 6, 7, 8].map((col) => row * 10 + col),
);
export const TOP_ROW: ReadonlyArray<number> = [91, 92, 93, 94, 95, 96, 97, 98];
export const BOTTOM_ROW: ReadonlyArray<number> = [101, 102, 103, 104, 105, 106, 107, 108];
export const LEFT_COLUMN: ReadonlyArray<number> = [80, 70, 60, 50, 40, 30, 20, 10];
export const RIGHT_COLUMN: ReadonlyArray<number> = [89, 79, 69, 59, 49, 39, 29, 19];
export const LOGO_ID = 99;

export const ALL_PAD_IDS: ReadonlyArray<number> = [
  ...TOP_ROW,
  ...GRID_ROWS.flat(),
  ...LEFT_COLUMN,
  ...RIGHT_COLUMN,
  ...BOTTOM_ROW,
];

export function isGridPad(id: number): boolean {
  const row = Math.floor(id / 10);
  const col = id % 10;
  return row >= 1 && row <= 8 && col >= 1 && col <= 8;
}

export interface PadEvent {
  id: number;
  pressed: boolean;
  /** 0..127; 0 on release. */
  velocity: number;
}

/**
 * Parse one raw MIDI message from the device's programmer-mode port.
 * Returns null for anything that isn't a pad/button press or release
 * (aftertouch, clock, sysex replies, …).
 */
export function parsePadMessage(data: Uint8Array): PadEvent | null {
  if (data.length < 3) return null;
  const status = data[0] & 0xf0;
  const id = data[1];
  const value = data[2];
  if (status === 0x90) return { id, pressed: value > 0, velocity: value };
  if (status === 0x80) return { id, pressed: false, velocity: 0 };
  if (status === 0xb0) return { id, pressed: value > 0, velocity: value };
  return null;
}

/** "#rrggbb" → 7-bit RGB the Launchpad wants. */
export function hexToRgb7(hex: string): Rgb7 {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) >> 1, ((n >> 8) & 0xff) >> 1, (n & 0xff) >> 1];
}

/** Scale a 7-bit colour by 0..1 (used for the dim "armed but idle" state). */
export function scaleRgb7(rgb: Rgb7, factor: number): Rgb7 {
  const f = Math.max(0, Math.min(1, factor));
  return [Math.round(rgb[0] * f), Math.round(rgb[1] * f), Math.round(rgb[2] * f)];
}

export function packRgb7(rgb: Rgb7): number {
  return (rgb[0] << 14) | (rgb[1] << 7) | rgb[2];
}
