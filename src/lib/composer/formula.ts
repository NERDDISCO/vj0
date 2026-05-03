/**
 * Tiny expression language for AudioPresets.
 *
 * The user wrote:
 *
 *   > We can have some if-else stuff there, simple markup, and validators
 *   > so it is always true and working. People can add formulas to make
 *   > sure the value has influence or the audio feature we are connecting
 *   > here has the correct influence for the value they want.
 *
 * So we want:
 *   - Real arithmetic (+, -, *, /, %, parens)
 *   - Comparisons + ternary (`>`, `<`, `>=`, `<=`, `==`, `!=`, `?:`, `&&`, `||`)
 *   - A handful of helpful functions (clamp, lerp, smooth, sin, cos, abs, min, max, pow, sqrt, mod, step)
 *   - Variables: rms, peak, low, mid, high, bright, t, v
 *   - Validation that catches typos *before* the formula gets armed
 *
 * Implementation: regex-based whitelist over the source string, then
 * `new Function()` with the allowed identifier set as parameters. Any
 * character or identifier outside the whitelist gets rejected at compile
 * time. The compiled function is cached so we're not re-parsing every frame.
 *
 * Why not write a full parser: this is a single-user browser app where the
 * formulas live in localStorage. The threat model is "I typo'd a function
 * name and want a clear error", not "an attacker is uploading expressions".
 * The whitelist closes the obvious holes (no `window`, no `document`, no
 * `Function`, no quotes for string injection) without 600 lines of parser.
 */

import type { AudioFeatureKey } from "./types";

// ─── Vocabulary ─────────────────────────────────────────────────────
const ALLOWED_IDENTIFIERS = new Set<string>([
  // audio features (short forms)
  "rms",
  "peak",
  "low",
  "mid",
  "high",
  "bright",
  // contextual
  "t", // time in seconds since session start
  "v", // base property value (0..1 in property-space)
  // helper functions
  "clamp",
  "lerp",
  "smooth",
  "sin",
  "cos",
  "tan",
  "abs",
  "min",
  "max",
  "pow",
  "sqrt",
  "mod",
  "step",
  "floor",
  "ceil",
  "round",
  "PI",
  "TAU",
  // ternary helpers (the reserved words `if`/`else` aren't in JS as keywords here
  // but we let the user use `?:` so they don't collide)
]);

// Forbidden words. JS sneaks a lot in via globals; these are the obvious ones
// to slam shut. The whitelist already rejects them, but explicit is nicer for
// the error message.
const FORBIDDEN_WORDS = new Set<string>([
  "window",
  "document",
  "globalThis",
  "self",
  "Function",
  "eval",
  "constructor",
  "process",
  "require",
  "import",
  "fetch",
  "XMLHttpRequest",
  "localStorage",
  "sessionStorage",
  "this",
  "new",
  "throw",
]);

const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;
// Reject backticks, quotes, semicolons, square brackets, dot member access.
// All can be vectors for sneaky access patterns.
const FORBIDDEN_CHARS_RE = /[`"';\[\]\.]/;

export interface CompiledFormula {
  source: string;
  /** Throws on division-by-zero or whatever; caller catches. */
  fn: (input: FormulaInput) => number;
  /** Identifiers actually referenced. Useful UX: "this preset uses [rms, t]". */
  uses: string[];
}

export interface FormulaInput {
  rms: number;
  peak: number;
  low: number;
  mid: number;
  high: number;
  bright: number;
  /** Time in seconds since session start. */
  t: number;
  /** Base property value (0..1 in property-space). */
  v: number;
}

// ─── Compilation ────────────────────────────────────────────────────
const cache = new Map<string, CompiledFormula | string>();

/** Returns either the compiled formula or an error message string. */
export function compileFormula(source: string): CompiledFormula | string {
  const cached = cache.get(source);
  if (cached !== undefined) return cached;

  const trimmed = source.trim();
  if (!trimmed) {
    const err = "formula is empty";
    cache.set(source, err);
    return err;
  }

  // Cheap structural rejects first — gives a precise error before the
  // identifier scan, which would just say "unknown identifier ;".
  if (FORBIDDEN_CHARS_RE.test(trimmed)) {
    const err = `illegal character: only numbers, identifiers, +-*/%(),?:!<>=&| are allowed`;
    cache.set(source, err);
    return err;
  }

  // Walk the identifiers in the source. Anything not in the allowlist is
  // a hard error — keeps `Math.random` etc. out without a sandbox.
  const used = new Set<string>();
  let m: RegExpExecArray | null;
  IDENT_RE.lastIndex = 0;
  while ((m = IDENT_RE.exec(trimmed)) !== null) {
    const id = m[0];
    if (FORBIDDEN_WORDS.has(id)) {
      const err = `forbidden identifier: ${id}`;
      cache.set(source, err);
      return err;
    }
    if (!ALLOWED_IDENTIFIERS.has(id)) {
      const err = `unknown identifier: ${id}`;
      cache.set(source, err);
      return err;
    }
    used.add(id);
  }

  // Build the compiled function. We hand-pass each binding so the body
  // executes with no implicit access to globals other than what we forward.
  const body = `
    "use strict";
    var clamp = function(x, a, b) { return x < a ? a : x > b ? b : x; };
    var lerp = function(a, b, t) { return a + (b - a) * t; };
    var smooth = function(x) { return x * x * (3 - 2 * x); };
    var step = function(edge, x) { return x < edge ? 0 : 1; };
    var mod = function(a, b) { return ((a % b) + b) % b; };
    var sin = Math.sin, cos = Math.cos, tan = Math.tan;
    var abs = Math.abs, min = Math.min, max = Math.max;
    var pow = Math.pow, sqrt = Math.sqrt;
    var floor = Math.floor, ceil = Math.ceil, round = Math.round;
    var PI = Math.PI, TAU = Math.PI * 2;
    return ( ${trimmed} );
  `;

  let inner: (rms: number, peak: number, low: number, mid: number, high: number, bright: number, t: number, v: number) => number;
  try {
    inner = new Function(
      "rms",
      "peak",
      "low",
      "mid",
      "high",
      "bright",
      "t",
      "v",
      body,
    ) as typeof inner;
  } catch (e) {
    const err = `parse error: ${(e as Error).message}`;
    cache.set(source, err);
    return err;
  }

  const compiled: CompiledFormula = {
    source: trimmed,
    fn: (input) => {
      const out = inner(input.rms, input.peak, input.low, input.mid, input.high, input.bright, input.t, input.v);
      // Coerce to a finite number in 0..1 — formulas can compute anything,
      // but property bindings need a clean range. NaN/Infinity → 0 silently.
      if (typeof out !== "number" || !Number.isFinite(out)) return 0;
      if (out < 0) return 0;
      if (out > 1) return 1;
      return out;
    },
    uses: Array.from(used),
  };

  cache.set(source, compiled);
  return compiled;
}

/** Clear the compile cache. Call when migrating preset formats. */
export function clearFormulaCache(): void {
  cache.clear();
}

/** Quick smoke test — used by the formula editor's "live preview" without
 *  spinning up the audio engine. */
export function dryRunFormula(
  formula: string,
  features: Partial<Record<AudioFeatureKey, number>> = {},
  t = 0,
  v = 0.5,
): number | string {
  const compiled = compileFormula(formula);
  if (typeof compiled === "string") return compiled;
  return compiled.fn({
    rms: features.rms ?? 0,
    peak: features.peak ?? 0,
    low: features.low ?? 0,
    mid: features.mid ?? 0,
    high: features.high ?? 0,
    bright: features.bright ?? 0,
    t,
    v,
  });
}
