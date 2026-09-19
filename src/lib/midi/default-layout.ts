/**
 * Factory pad layout for the Launchpad Pro MK3.
 *
 * 8×8 grid = 64 prompt pads, one theme per row (top row first). Prompts
 * are deliberately terse — a subject, one or two modifiers, a lighting
 * cue — so the model reacts fast and the label still tells you what you
 * just hit mid-set. Each row shares an LED colour so the grid reads as
 * eight coloured "banks" from across the booth.
 *
 * Edge buttons carry the non-prompt controls:
 *   top row       → seed / random / α nudges / klein steps 1-4
 *   right column  → toggles (generate, ai link, record, stage fx) + px size
 *   left column   → scenes 1-8
 *   bottom row    → 16:9 resolution ladder + sharpen nudges + random
 */

import type { PadBinding } from "./pad-actions";
import {
  GRID_ROWS,
  TOP_ROW,
  RIGHT_COLUMN,
  LEFT_COLUMN,
} from "./launchpad-pro-mk3";

interface PromptRow {
  color: string;
  pads: ReadonlyArray<readonly [label: string, prompt: string]>;
}

// Top grid row (81-88) first, bottom grid row (11-18) last.
const PROMPT_ROWS: ReadonlyArray<PromptRow> = [
  {
    // neon / cyber
    color: "#00e5ff",
    pads: [
      ["cyber", "neon cyberpunk street at night, rain, reflections"],
      ["synthwave", "synthwave grid horizon, neon sun, purple sky"],
      ["chrome", "liquid chrome sculpture, holographic reflections"],
      ["glitch", "glitch art, rgb split, scanlines, corrupted signal"],
      ["lasers", "laser beams through thick smoke, dark club"],
      ["led tunnel", "infinite led tunnel, cyan and magenta, motion blur"],
      ["circuit", "glowing circuit board macro, blue traces"],
      ["vapor", "vaporwave palms at dusk, pink and teal gradient"],
    ],
  },
  {
    // cosmic
    color: "#9b5cff",
    pads: [
      ["galaxy", "spiral galaxy, pink and blue nebula, deep space"],
      ["black hole", "black hole accretion disk, orange glow, lensing"],
      ["warp", "star field at warp speed, streaking light"],
      ["rings", "gas giant with ice rings, cinematic space"],
      ["flare", "solar flare, plasma loops, extreme close-up"],
      ["aurora", "aurora borealis over snowy mountains, green and purple"],
      ["moon", "moon surface, harsh sunlight, craters, black sky"],
      ["wormhole", "blue wormhole tunnel, swirling light, sci-fi"],
    ],
  },
  {
    // fluid
    color: "#ff00aa",
    pads: [
      ["ink", "black ink dropping into water, macro, white background"],
      ["oil", "abstract oil paint swirling, vivid colors, macro"],
      ["mercury", "liquid mercury ripples, silver, studio light"],
      ["magma", "flowing magma, glowing cracks, black rock"],
      ["bubble", "soap bubble iridescence, macro, rainbow film"],
      ["smoke", "smoke tendrils, backlit, black background"],
      ["ferro", "ferrofluid spikes, black glossy, magnetic"],
      ["wax", "melting wax in candy colors, drips, macro"],
    ],
  },
  {
    // nature
    color: "#2eea7a",
    pads: [
      ["ocean", "underwater caustics, sun rays in blue water, dreamy"],
      ["jelly", "bioluminescent jellyfish, deep ocean, ethereal"],
      ["forest", "forest floor after rain, moss, golden hour, macro"],
      ["wave", "crashing wave, slow motion, spray, backlit"],
      ["dunes", "desert dunes, long shadows, golden light"],
      ["storm", "lightning storm, purple sky, dramatic clouds"],
      ["blossom", "cherry blossoms in wind, petals flying, soft light"],
      ["ice", "frozen lake, deep cracks, blue ice, aerial"],
    ],
  },
  {
    // fire / energy
    color: "#ff6a00",
    pads: [
      ["fire", "flames dancing in the dark, high speed photo"],
      ["sparks", "sparks explosion, embers flying, black background"],
      ["tesla", "electric arcs, tesla coil, purple lightning"],
      ["burn", "burning paper, glowing edges, ash, macro"],
      ["fireworks", "fireworks bursting, night sky, long exposure"],
      ["gold", "molten gold pouring, glowing, dark background"],
      ["plasma", "plasma ball tendrils, pink and blue, glass"],
      ["corona", "sun corona close-up, solar surface, orange"],
    ],
  },
  {
    // structure / urban
    color: "#4d8dff",
    pads: [
      ["brutal", "brutalist concrete architecture in fog, moody"],
      ["mirrors", "infinite mirror hallway, neon lights, reflections"],
      ["cathedral", "gothic cathedral interior, light shafts, dust"],
      ["wireframe", "glowing wireframe city, dark, neon grid"],
      ["fractal", "fractal geometry, gold and black, infinite zoom"],
      ["kaleido", "kaleidoscope of crystals, symmetrical, vivid"],
      ["tokyo", "tokyo alley at night, neon signs, wet street"],
      ["ruins", "gothic ruins under moonlight, mist, dramatic"],
    ],
  },
  {
    // organic / bio
    color: "#c6ff33",
    pads: [
      ["coral", "coral reef macro, vivid colors, soft light"],
      ["mycelium", "glowing mycelium network, dark, bioluminescent"],
      ["iris", "human eye iris macro, extreme detail, colorful"],
      ["crystal", "crystal cave, purple amethyst, glowing"],
      ["peacock", "peacock feathers macro, iridescent, detailed"],
      ["scales", "iridescent snake scales macro, shimmering"],
      ["neurons", "neurons firing, blue electric, dark background"],
      ["wing", "butterfly wing macro, scales, vivid pattern"],
    ],
  },
  {
    // mono / texture
    color: "#f2f2f2",
    pads: [
      ["mono", "black and white, high contrast, dramatic shadows"],
      ["noir", "film noir, venetian blind shadows, smoke, cinematic"],
      ["charcoal", "rough charcoal sketch, textured paper, expressive"],
      ["chrome ball", "chrome sphere in studio, reflections, minimal"],
      ["marble", "black marble with gold veins, polished, macro"],
      ["rust", "rusted metal decay, peeling paint, texture"],
      ["static", "analog static noise, film grain, monochrome"],
      ["silhouette", "silhouette figure, red backlight, fog, minimal"],
    ],
  },
];

export function buildDefaultBindings(): Record<number, PadBinding> {
  const out: Record<number, PadBinding> = {};

  GRID_ROWS.forEach((ids, rowIdx) => {
    const row = PROMPT_ROWS[rowIdx];
    ids.forEach((id, colIdx) => {
      const [label, prompt] = row.pads[colIdx];
      out[id] = { action: { type: "prompt", label, prompt }, color: row.color };
    });
  });

  // Top row — seed + α + klein steps.
  const top: PadBinding[] = [
    { action: { type: "reroll" }, color: "#ffffff" },
    { action: { type: "random-prompt" }, color: "#ff00aa" },
    { action: { type: "nudge", key: "alpha", delta: -0.02 }, color: "#ffb300" },
    { action: { type: "nudge", key: "alpha", delta: 0.02 }, color: "#ffb300" },
    { action: { type: "steps", value: 1 }, color: "#00e5ff" },
    { action: { type: "steps", value: 2 }, color: "#00e5ff" },
    { action: { type: "steps", value: 3 }, color: "#00e5ff" },
    { action: { type: "steps", value: 4 }, color: "#00e5ff" },
  ];
  TOP_ROW.forEach((id, i) => (out[id] = top[i]));

  // Right column (top → bottom) — random · sharpen ± · generate · record.
  // The remaining three pads stay unbound (dark) until the user binds them.
  const right: PadBinding[] = [
    { action: { type: "random-prompt" }, color: "#ff00aa" },
    { action: { type: "nudge", key: "sharpen", delta: -0.2 }, color: "#ffb300" },
    { action: { type: "nudge", key: "sharpen", delta: 0.2 }, color: "#ffb300" },
    { action: { type: "toggle", key: "generating" }, color: "#2eea7a" },
    { action: { type: "toggle", key: "recording" }, color: "#ff2d2d" },
  ];
  RIGHT_COLUMN.forEach((id, i) => {
    if (right[i]) out[id] = right[i];
  });

  // Left column — scenes 1-8 (top → bottom).
  LEFT_COLUMN.forEach((id, i) => {
    out[id] = { action: { type: "scene", index: i }, color: "#ff00aa" };
  });

  // Bottom row is intentionally unbound — it isn't shown on screen and
  // the hardware LEDs stay dark.
  return out;
}

/** Swatches offered in the pad editor. */
export const PAD_COLOR_SWATCHES: ReadonlyArray<string> = [
  "#00e5ff",
  "#4d8dff",
  "#9b5cff",
  "#ff00aa",
  "#ff2d2d",
  "#ff6a00",
  "#ffb300",
  "#c6ff33",
  "#2eea7a",
  "#f2f2f2",
];
