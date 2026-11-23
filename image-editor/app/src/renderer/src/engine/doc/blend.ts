import { BLEND_MODES, type BlendMode } from './document';

/**
 * Blend functions B(Cb, Cs) on gamma-encoded sRGB in 0..1 (ADR-0004), from the W3C Compositing and Blending
 * Level 1 spec: §10.2 separable modes and §10.3 non-separable ones (Hue, Saturation, Color, Luminosity).
 * Linear Dodge (Add) and Dissolve follow Photoshop. The GLSL twin lives in gpu/shaders/blend.glsl;
 * gpu.gpu.test.ts checks they agree (T-BLD-01).
 */

/** All 18 modes of FR-LAY-03, in Photoshop's menu order (the Layers panel lists them so). */
export const IMPLEMENTED_BLEND_MODES = BLEND_MODES;

/**
 * Shader indices. The M1 modes keep their numbers (saved shaders and tests rely on them); the M2 modes
 * follow. Indices 14+ are the non-separable modes.
 */
const SHADER_ORDER = [
  'normal',
  'darken',
  'multiply',
  'lighten',
  'screen',
  'overlay',
  'soft-light',
  'hard-light',
  'difference',
  'dissolve',
  'color-burn',
  'color-dodge',
  'linear-dodge',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const satisfies readonly BlendMode[];

/** Dissolve's shader index: drawn like Normal, but each pixel shows fully or not at all. */
export const DISSOLVE = 9;
const NON_SEPARABLE = 14;

export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  normal: 'Normal',
  dissolve: 'Dissolve',
  darken: 'Darken',
  multiply: 'Multiply',
  'color-burn': 'Color Burn',
  lighten: 'Lighten',
  screen: 'Screen',
  'color-dodge': 'Color Dodge',
  'linear-dodge': 'Linear Dodge (Add)',
  overlay: 'Overlay',
  'soft-light': 'Soft Light',
  'hard-light': 'Hard Light',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
};

/** Shader index for each mode (must match blend.glsl). */
export function blendModeIndex(mode: BlendMode): number {
  const i = (SHADER_ORDER as readonly string[]).indexOf(mode);
  return i < 0 ? 0 : i;
}

/**
 * Dissolve's noise in 0..1 for a document pixel: a 32-bit integer hash, top 24 bits (exact in float32, so
 * blend.glsl's twin gives the same value). Fixed, so a dissolved layer looks the same every time.
 */
export function dissolveNoise(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 8) / 16777216;
}

function hardLight(cb: number, cs: number): number {
  return cs <= 0.5 ? cb * 2 * cs : screen(cb, 2 * cs - 1);
}

function screen(cb: number, cs: number): number {
  return cb + cs - cb * cs;
}

function softLight(cb: number, cs: number): number {
  if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
  const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
  return cb + (2 * cs - 1) * (d - cb);
}

/** B(Cb, Cs) for one channel; index as returned by blendModeIndex. */
export function blendChannel(mode: number, cb: number, cs: number): number {
  switch (mode) {
    case 1: // darken
      return Math.min(cb, cs);
    case 2: // multiply
      return cb * cs;
    case 3: // lighten
      return Math.max(cb, cs);
    case 4:
      return screen(cb, cs);
    case 5: // overlay = HardLight with the layers swapped
      return hardLight(cs, cb);
    case 6:
      return softLight(cb, cs);
    case 7:
      return hardLight(cb, cs);
    case 8: // difference
      return Math.abs(cb - cs);
    case 10: // color burn
      return cb >= 1 ? 1 : cs <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs);
    case 11: // color dodge
      return cb <= 0 ? 0 : cs >= 1 ? 1 : Math.min(1, cb / (1 - cs));
    case 12: // linear dodge (add)
      return Math.min(1, cb + cs);
    case 13: // exclusion
      return cb + cs - 2 * cb * cs;
    default:
      return cs;
  }
}

const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;

/** W3C §10.3 ClipColor ∘ SetLum, into `out`. */
function setLum(r: number, g: number, b: number, l: number, out: Float64Array): void {
  const d = l - lum(r, g, b);
  r += d;
  g += d;
  b += d;
  const L = lum(r, g, b);
  const n = Math.min(r, g, b);
  const x = Math.max(r, g, b);
  if (n < 0 && L - n > 0) {
    r = L + ((r - L) * L) / (L - n);
    g = L + ((g - L) * L) / (L - n);
    b = L + ((b - L) * L) / (L - n);
  }
  if (x > 1 && x - L > 0) {
    r = L + ((r - L) * (1 - L)) / (x - L);
    g = L + ((g - L) * (1 - L)) / (x - L);
    b = L + ((b - L) * (1 - L)) / (x - L);
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
}

/** W3C §10.3 SetSat, into `out`: the channels stretched so max − min = s, the minimum at 0. */
function setSat(r: number, g: number, b: number, s: number, out: Float64Array): void {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const k = mx > mn ? s / (mx - mn) : 0;
  out[0] = (r - mn) * k;
  out[1] = (g - mn) * k;
  out[2] = (b - mn) * k;
}

const sat = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b);
const tmp = new Float64Array(3);

/** B(Cb, Cs) for a whole colour, into `out` (straight 0..1): separable or not. Dissolve blends as Normal. */
export function blendRGB(
  mode: number,
  br: number,
  bg: number,
  bb: number,
  sr: number,
  sg: number,
  sb: number,
  out: Float64Array,
): void {
  switch (mode) {
    case 14: // hue: the source's hue, the backdrop's saturation and luminosity
      setSat(sr, sg, sb, sat(br, bg, bb), tmp);
      return setLum(tmp[0]!, tmp[1]!, tmp[2]!, lum(br, bg, bb), out);
    case 15: // saturation
      setSat(br, bg, bb, sat(sr, sg, sb), tmp);
      return setLum(tmp[0]!, tmp[1]!, tmp[2]!, lum(br, bg, bb), out);
    case 16: // color: the source's hue and saturation, the backdrop's luminosity
      return setLum(sr, sg, sb, lum(br, bg, bb), out);
    case 17: // luminosity
      return setLum(br, bg, bb, lum(sr, sg, sb), out);
    default:
      out[0] = blendChannel(mode, br, sr);
      out[1] = blendChannel(mode, bg, sg);
      out[2] = blendChannel(mode, bb, sb);
  }
}

export const isNonSeparable = (mode: number) => mode >= NON_SEPARABLE;
const mixed = new Float64Array(3);

/**
 * Composites a straight-alpha source pixel (cs, αs already including opacity) onto a premultiplied backdrop
 * `acc[i..i+3]` in place (W3C §5.2 general formula with the backdrop's alpha):
 *   Cs' = (1 − αb)·Cs + αb·B(Cb, Cs);   co = αs·Cs' + (1 − αs)·cb;   αo = αs + αb·(1 − αs)
 */
export function blendInto(
  acc: Float32Array,
  i: number,
  mode: number,
  sr: number,
  sg: number,
  sb: number,
  sa: number,
  /** The document pixel (Dissolve's noise). */
  x = 0,
  y = 0,
): void {
  if (sa <= 0) return;
  if (mode === DISSOLVE) {
    // Each pixel is either the source at full strength (with probability αs) or untouched.
    if (dissolveNoise(x, y) >= sa) return;
    sa = 1;
    mode = 0;
  }
  const ab = acc[i + 3]!;
  const keep = 1 - sa;
  if (mode === 0 || ab === 0) {
    acc[i] = sr * sa + acc[i]! * keep;
    acc[i + 1] = sg * sa + acc[i + 1]! * keep;
    acc[i + 2] = sb * sa + acc[i + 2]! * keep;
    acc[i + 3] = sa + ab * keep;
    return;
  }
  const br = acc[i]! / ab;
  const bg = acc[i + 1]! / ab;
  const bb = acc[i + 2]! / ab;
  blendRGB(mode, br, bg, bb, sr, sg, sb, mixed);
  acc[i] = ((1 - ab) * sr + ab * mixed[0]!) * sa + acc[i]! * keep;
  acc[i + 1] = ((1 - ab) * sg + ab * mixed[1]!) * sa + acc[i + 1]! * keep;
  acc[i + 2] = ((1 - ab) * sb + ab * mixed[2]!) * sa + acc[i + 2]! * keep;
  acc[i + 3] = sa + ab * keep;
}
