import { blendInto, blendModeIndex } from '../doc/blend';
import type { BlendMode } from '../doc/document';
import { parseTileKey, TILE_SIZE, tileKeysInRect, type TileKey } from '../tiles/tile';

/**
 * Gradient tool (G; FR-PNT-04): a gradient drawn from `start` to `end` onto one layer, blended with a blend
 * mode at an opacity, within the selection. Colours are interpolated between stops in gamma-encoded sRGB
 * (ADR-0004), and blending is the compositor's CPU reference (`blendInto`), so every blend mode works as it
 * does for layers. Dither adds a fixed per-pixel offset of under half a level before rounding, which breaks
 * up the banding of slow gradients without visible noise.
 */
export type GradientType = 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';
export const GRADIENT_TYPES: readonly GradientType[] = ['linear', 'radial', 'angle', 'reflected', 'diamond'];

/** A colour stop: position 0..1, straight RGB 0..255, alpha 0..1. Stops are sorted by `at`. */
export type GradientStop = { at: number; color: [number, number, number]; alpha: number };

export type GradientSpec = {
  type: GradientType;
  stops: GradientStop[];
  start: { x: number; y: number };
  end: { x: number; y: number };
  reverse: boolean;
};

export type GradientFill = { gradient: GradientSpec; opacity: number; mode: BlendMode; dither: boolean };

/**
 * Where a document point falls along the gradient, 0..1, as a function chosen once per gradient. Linear:
 * projected onto start→end. Radial: distance from start over the length. Angle: the angle from start→end,
 * clockwise on screen, over a turn. Reflected: linear mirrored at the start. Diamond: the L1 distance in the
 * frame of start→end.
 */
export function positionOf(
  type: GradientType,
  start: { x: number; y: number },
  end: { x: number; y: number },
): (px: number, py: number) => number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const inv = 1 / (dx * dx + dy * dy);
  const sx = start.x;
  const sy = start.y;
  const clamp = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
  switch (type) {
    case 'linear':
      return (px, py) => clamp(((px - sx) * dx + (py - sy) * dy) * inv);
    case 'reflected':
      return (px, py) => clamp(Math.abs((px - sx) * dx + (py - sy) * dy) * inv);
    case 'radial':
      return (px, py) => clamp(Math.sqrt(((px - sx) ** 2 + (py - sy) ** 2) * inv));
    case 'diamond':
      return (px, py) => {
        const ux = px - sx;
        const uy = py - sy;
        return clamp((Math.abs(ux * dx + uy * dy) + Math.abs(ux * dy - uy * dx)) * inv);
      };
    case 'angle': {
      const base = Math.atan2(dy, dx);
      return (px, py) => {
        const t = (Math.atan2(py - sy, px - sx) - base) / (2 * Math.PI);
        return t - Math.floor(t);
      };
    }
  }
}

export function gradientPosition(
  type: GradientType,
  start: { x: number; y: number },
  end: { x: number; y: number },
  px: number,
  py: number,
): number {
  return positionOf(type, start, end)(px, py);
}

/** The colour at `t` into out[0..3]: RGB 0..1 and alpha, interpolated linearly between the stops. */
export function sampleStops(stops: readonly GradientStop[], t: number, out: Float32Array): void {
  let hi = 0;
  while (hi < stops.length - 1 && stops[hi]!.at < t) hi++;
  const b = stops[hi]!;
  const a = stops[Math.max(0, hi - 1)]!;
  const span = b.at - a.at;
  const f = span > 0 ? Math.min(1, Math.max(0, (t - a.at) / span)) : 1;
  out[0] = (a.color[0] + (b.color[0] - a.color[0]) * f) / 255;
  out[1] = (a.color[1] + (b.color[1] - a.color[1]) * f) / 255;
  out[2] = (a.color[2] + (b.color[2] - a.color[2]) * f) / 255;
  out[3] = a.alpha + (b.alpha - a.alpha) * f;
}

/** Colours at LUT_SIZE positions: under 0.07 of a level apart for any two stops, far below dither. */
const LUT_SIZE = 4096;

function stopTable(stops: readonly GradientStop[], reverse: boolean): Float32Array {
  const lut = new Float32Array(LUT_SIZE * 4);
  const c = new Float32Array(4);
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1);
    sampleStops(stops, reverse ? 1 - t : t, c);
    lut.set(c, i * 4);
  }
  return lut;
}

const to8 = (v: number) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

/** A fixed offset in [-0.5, 0.5) per document pixel (integer hash, the same on every machine). */
function ditherOffset(x: number, y: number): number {
  let h = (Math.imul(x | 0, 1597334677) ^ Math.imul(y | 0, 3812015801)) | 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h ^= h >>> 13;
  return (h >>> 8) / 16777216 - 0.5;
}

/**
 * Draws `fill` over `layer` (straight RGBA8 tiles) on every canvas pixel, or only within `selection`
 * (one-byte coverage tiles) when there is one. With `preserveAlpha` (transparency locked) only existing
 * pixels change colour and keep their alpha. Returns the tiles that changed.
 */
export function paintGradient(
  layer: ReadonlyMap<TileKey, Uint8Array>,
  size: { width: number; height: number },
  fill: GradientFill,
  selection: ReadonlyMap<TileKey, Uint8Array> | null,
  preserveAlpha: boolean,
  /** Only these tiles (a band of the worker pool); null = every tile of the canvas. */
  keys: readonly TileKey[] | null = null,
): Array<[TileKey, Uint8Array]> {
  const { gradient: g, opacity, dither } = fill;
  const { start, end } = g;
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1 || g.stops.length === 0 || opacity <= 0) return [];
  const mode = blendModeIndex(fill.mode);
  const position = positionOf(g.type, start, end);
  const lut = stopTable(g.stops, g.reverse);
  const acc = new Float32Array(4);
  const out: Array<[TileKey, Uint8Array]> = [];
  for (const key of keys ?? tileKeysInRect(0, 0, size.width, size.height)) {
    const sel = selection ? selection.get(key) : null;
    if (selection && !sel) continue;
    const old = layer.get(key);
    if (!old && preserveAlpha) continue;
    const [tx, ty] = parseTileKey(key);
    const ox = tx * TILE_SIZE;
    const oy = ty * TILE_SIZE;
    const w = Math.min(TILE_SIZE, size.width - ox);
    const h = Math.min(TILE_SIZE, size.height - oy);
    const data = old ? new Uint8Array(old) : new Uint8Array(TILE_SIZE * TILE_SIZE * 4);
    let changed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * TILE_SIZE + x;
        const k = sel ? sel[p]! / 255 : 1;
        if (k === 0) continue;
        const i = p * 4;
        const ba = data[i + 3]! / 255;
        if (preserveAlpha && ba === 0) continue;
        const gx = ox + x;
        const gy = oy + y;
        const c = Math.round(position(gx + 0.5, gy + 0.5) * (LUT_SIZE - 1)) * 4;
        const sa = lut[c + 3]! * opacity * k;
        if (sa <= 0) continue;
        // Transparency locked: the pixel's colour is blended as if opaque and keeps its alpha (source-atop).
        const ab = preserveAlpha ? 1 : ba;
        acc[0] = (data[i]! / 255) * ab;
        acc[1] = (data[i + 1]! / 255) * ab;
        acc[2] = (data[i + 2]! / 255) * ab;
        acc[3] = ab;
        blendInto(acc, 0, mode, lut[c]!, lut[c + 1]!, lut[c + 2]!, sa, gx, gy);
        const a = acc[3]!;
        const d = dither ? ditherOffset(gx, gy) : 0;
        const outA = preserveAlpha ? data[i + 3]! : to8(a * 255);
        const s255 = a > 0 ? 255 / a : 0;
        const r = a > 0 ? to8(acc[0]! * s255 + d) : 0;
        const gg = a > 0 ? to8(acc[1]! * s255 + d) : 0;
        const b = a > 0 ? to8(acc[2]! * s255 + d) : 0;
        if (r === data[i] && gg === data[i + 1] && b === data[i + 2] && outA === data[i + 3]) continue;
        data[i] = r;
        data[i + 1] = gg;
        data[i + 2] = b;
        data[i + 3] = outA;
        changed = true;
      }
    }
    if (changed) out.push([key, data]);
  }
  return out;
}

/** Built-in presets (FR-PNT-04): `fg`/`bg` are the current foreground and background colours. */
export type GradientPreset = 'fg-bg' | 'fg-transparent' | 'black-white' | 'spectrum';
export const GRADIENT_PRESET_LABELS: Record<GradientPreset, string> = {
  'fg-bg': 'Foreground to Background',
  'fg-transparent': 'Foreground to Transparent',
  'black-white': 'Black, White',
  spectrum: 'Spectrum',
};

export function presetStops(
  preset: GradientPreset,
  fg: readonly [number, number, number],
  bg: readonly [number, number, number],
): GradientStop[] {
  const stop = (at: number, color: readonly [number, number, number], alpha = 1): GradientStop => ({
    at,
    color: [color[0], color[1], color[2]],
    alpha,
  });
  switch (preset) {
    case 'fg-bg':
      return [stop(0, fg), stop(1, bg)];
    case 'fg-transparent':
      return [stop(0, fg), stop(1, fg, 0)];
    case 'black-white':
      return [stop(0, [0, 0, 0]), stop(1, [255, 255, 255])];
    case 'spectrum':
      return (
        [
          [255, 0, 0],
          [255, 255, 0],
          [0, 255, 0],
          [0, 255, 255],
          [0, 0, 255],
          [255, 0, 255],
          [255, 0, 0],
        ] as const
      ).map((c, i, all) => stop(i / (all.length - 1), c));
  }
}
