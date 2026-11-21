/**
 * Adjustments (FR-ADJ-01, docs/02 §5.5, docs/05 §1): the documented model, its defaults, and the CPU
 * reference for `gpu/shaders/adjust.frag`. Colours are gamma-encoded sRGB in 0..1 (ADR-0004).
 *
 * An adjustment runs in two stages, exactly as the shader does:
 * 1. per-channel 256-entry lookup tables (Brightness/Contrast, Levels, Curves, Exposure, Invert, Posterize),
 *    indexed by the nearest 8-bit value;
 * 2. one colour function that mixes channels (Threshold, Hue/Saturation, Vibrance, Color Balance, Black &
 *    White, Photo Filter), with its parameters packed into 16 floats.
 * Formulas follow GIMP's operations where Photoshop's are not published; each is noted below.
 */

export type RGB = [number, number, number];

export type LevelsChannel = {
  inBlack: number;
  inWhite: number;
  gamma: number;
  outBlack: number;
  outWhite: number;
};

export type ChannelKey = 'rgb' | 'r' | 'g' | 'b';

export type Adjustment =
  | { kind: 'brightness-contrast'; brightness: number; contrast: number; legacy: boolean }
  | { kind: 'levels'; channels: Record<ChannelKey, LevelsChannel> }
  | { kind: 'curves'; channels: Record<ChannelKey, Array<[number, number]>> }
  | { kind: 'exposure'; exposure: number; offset: number; gamma: number }
  | { kind: 'vibrance'; vibrance: number; saturation: number }
  | { kind: 'hue-saturation'; hue: number; saturation: number; lightness: number; colorize: boolean }
  | { kind: 'color-balance'; shadows: RGB; midtones: RGB; highlights: RGB; preserveLuminosity: boolean }
  | {
      kind: 'black-white';
      weights: { r: number; y: number; g: number; c: number; b: number; m: number };
      tint?: RGB;
    }
  | { kind: 'photo-filter'; color: RGB; density: number; preserveLuminosity: boolean }
  | { kind: 'invert' }
  | { kind: 'posterize'; levels: number }
  | { kind: 'threshold'; level: number };

export type AdjustmentKind = Adjustment['kind'];
export type AdjustmentOf<K extends AdjustmentKind> = Extract<Adjustment, { kind: K }>;

/** Menu order (Image › Adjustments, docs/03 §5.2). */
export const ADJUSTMENT_KINDS: readonly AdjustmentKind[] = [
  'brightness-contrast',
  'levels',
  'curves',
  'exposure',
  'vibrance',
  'hue-saturation',
  'color-balance',
  'black-white',
  'photo-filter',
  'invert',
  'posterize',
  'threshold',
];

export const ADJUSTMENT_LABELS: Record<AdjustmentKind, string> = {
  'brightness-contrast': 'Brightness/Contrast',
  levels: 'Levels',
  curves: 'Curves',
  exposure: 'Exposure',
  vibrance: 'Vibrance',
  'hue-saturation': 'Hue/Saturation',
  'color-balance': 'Color Balance',
  'black-white': 'Black & White',
  'photo-filter': 'Photo Filter',
  invert: 'Invert',
  posterize: 'Posterize',
  threshold: 'Threshold',
};

const IDENTITY_LEVELS: LevelsChannel = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
const IDENTITY_CURVE: Array<[number, number]> = [
  [0, 0],
  [255, 255],
];

/** A new adjustment of `kind` with Photoshop's defaults (most do nothing until changed). */
export function defaultAdjustment<K extends AdjustmentKind>(kind: K): AdjustmentOf<K> {
  const all: { [P in AdjustmentKind]: AdjustmentOf<P> } = {
    'brightness-contrast': { kind: 'brightness-contrast', brightness: 0, contrast: 0, legacy: false },
    levels: {
      kind: 'levels',
      channels: {
        rgb: { ...IDENTITY_LEVELS },
        r: { ...IDENTITY_LEVELS },
        g: { ...IDENTITY_LEVELS },
        b: { ...IDENTITY_LEVELS },
      },
    },
    curves: {
      kind: 'curves',
      channels: {
        rgb: IDENTITY_CURVE.map((p) => [...p] as [number, number]),
        r: IDENTITY_CURVE.map((p) => [...p] as [number, number]),
        g: IDENTITY_CURVE.map((p) => [...p] as [number, number]),
        b: IDENTITY_CURVE.map((p) => [...p] as [number, number]),
      },
    },
    exposure: { kind: 'exposure', exposure: 0, offset: 0, gamma: 1 },
    vibrance: { kind: 'vibrance', vibrance: 0, saturation: 0 },
    'hue-saturation': { kind: 'hue-saturation', hue: 0, saturation: 0, lightness: 0, colorize: false },
    'color-balance': {
      kind: 'color-balance',
      shadows: [0, 0, 0],
      midtones: [0, 0, 0],
      highlights: [0, 0, 0],
      preserveLuminosity: true,
    },
    'black-white': { kind: 'black-white', weights: { r: 40, y: 60, g: 40, c: 60, b: 20, m: 80 } },
    'photo-filter': { kind: 'photo-filter', color: [236, 138, 0], density: 25, preserveLuminosity: true },
    invert: { kind: 'invert' },
    posterize: { kind: 'posterize', levels: 4 },
    threshold: { kind: 'threshold', level: 128 },
  };
  return structuredClone(all[kind]);
}

/** What the shader needs: per-channel LUTs (256 × RGBA8, or none) and the colour stage's kind and params. */
export type PreparedAdjustment = { lut: Uint8Array | null; stage: number; params: Float32Array };

/** Colour-stage indices; must match adjust.frag. */
export const STAGE = {
  none: 0,
  threshold: 1,
  hueSaturation: 2,
  vibrance: 3,
  colorBalance: 4,
  blackWhite: 5,
  photoFilter: 6,
} as const;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function lutFrom(r: (v: number) => number, g = r, b = r): Uint8Array {
  const lut = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    lut[i * 4] = Math.round(clamp01(r(v)) * 255);
    lut[i * 4 + 1] = Math.round(clamp01(g(v)) * 255);
    lut[i * 4 + 2] = Math.round(clamp01(b(v)) * 255);
    lut[i * 4 + 3] = 255;
  }
  return lut;
}

function levelsFn(c: LevelsChannel): (v: number) => number {
  const span = Math.max(1, c.inWhite - c.inBlack);
  const g = Math.max(0.01, c.gamma);
  return (v) => {
    const t = clamp01((v * 255 - c.inBlack) / span) ** (1 / g);
    return (c.outBlack + t * (c.outWhite - c.outBlack)) / 255;
  };
}

/**
 * A natural cubic spline through the control points (0..255 both axes), flat beyond the end points, as
 * Photoshop's Curves draws it; two points give a straight line.
 */
export function curveFn(points: ReadonlyArray<readonly [number, number]>): (v: number) => number {
  const pts = [...points].sort((a, b) => a[0] - b[0]).filter((p, i, a) => i === 0 || p[0] > a[i - 1]![0]);
  if (pts.length === 0) return (v) => v;
  if (pts.length === 1) return () => pts[0]![1] / 255;
  const n = pts.length;
  const x = pts.map((p) => p[0]);
  const y = pts.map((p) => p[1]);
  // Second derivatives (natural boundary: zero at both ends), by the tridiagonal algorithm.
  const m = new Array<number>(n).fill(0);
  const u = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const sig = (x[i]! - x[i - 1]!) / (x[i + 1]! - x[i - 1]!);
    const p = sig * m[i - 1]! + 2;
    m[i] = (sig - 1) / p;
    const d = (y[i + 1]! - y[i]!) / (x[i + 1]! - x[i]!) - (y[i]! - y[i - 1]!) / (x[i]! - x[i - 1]!);
    u[i] = ((6 * d) / (x[i + 1]! - x[i - 1]!) - sig * u[i - 1]!) / p;
  }
  for (let k = n - 2; k >= 0; k--) m[k] = m[k]! * m[k + 1]! + u[k]!;
  return (v) => {
    const t = v * 255;
    if (t <= x[0]!) return y[0]! / 255;
    if (t >= x[n - 1]!) return y[n - 1]! / 255;
    let k = 0;
    while (t > x[k + 1]!) k++;
    const h = x[k + 1]! - x[k]!;
    const a = (x[k + 1]! - t) / h;
    const b = (t - x[k]!) / h;
    const s = a * y[k]! + b * y[k + 1]! + (((a ** 3 - a) * m[k]! + (b ** 3 - b) * m[k + 1]!) * (h * h)) / 6;
    return s / 255;
  };
}

export const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

const preparedCache = new WeakMap<Adjustment, PreparedAdjustment>();

/** prepareAdjustment, once per adjustment object (they are replaced, never mutated). */
export function preparedFor(adj: Adjustment): PreparedAdjustment {
  let p = preparedCache.get(adj);
  if (!p) preparedCache.set(adj, (p = prepareAdjustment(adj)));
  return p;
}

/** Packs an adjustment for the shader and for adjustPixel. */
export function prepareAdjustment(adj: Adjustment): PreparedAdjustment {
  const params = new Float32Array(16);
  const prep = (lut: Uint8Array | null, stage: number = STAGE.none) => ({ lut, stage, params });
  switch (adj.kind) {
    case 'brightness-contrast': {
      if (adj.legacy) {
        // Legacy: a straight line through mid-grey, shifted by the brightness.
        const k = 1 + adj.contrast / 100;
        return prep(lutFrom((v) => (v - 0.5) * k + 0.5 + adj.brightness / 255));
      }
      // GIMP's brightness-contrast: brightness bends towards black or white, contrast is a slope through
      // mid-grey of tan((c + 1)·π/4). Photoshop's ranges (−150..150, −50..100) map to ±0.5.
      const b = adj.brightness / 300;
      const slope = Math.tan(((adj.contrast / 200 + 1) * Math.PI) / 4);
      return prep(
        lutFrom((v) => {
          const w = b < 0 ? v * (1 + b) : v + (1 - v) * b;
          return (w - 0.5) * slope + 0.5;
        }),
      );
    }
    case 'levels': {
      const master = levelsFn(adj.channels.rgb);
      const [r, g, b] = (['r', 'g', 'b'] as const).map((c) => levelsFn(adj.channels[c]));
      return prep(
        lutFrom(
          (v) => master(clamp01(r!(v))),
          (v) => master(clamp01(g!(v))),
          (v) => master(clamp01(b!(v))),
        ),
      );
    }
    case 'curves': {
      const master = curveFn(adj.channels.rgb);
      const [r, g, b] = (['r', 'g', 'b'] as const).map((c) => curveFn(adj.channels[c]));
      return prep(
        lutFrom(
          (v) => master(clamp01(r!(v))),
          (v) => master(clamp01(g!(v))),
          (v) => master(clamp01(b!(v))),
        ),
      );
    }
    case 'exposure': {
      // In linear light, as Photoshop's Exposure: scale by 2^exposure, add the offset, then the gamma.
      const scale = 2 ** adj.exposure;
      const g = Math.max(0.01, adj.gamma);
      return prep(lutFrom((v) => linearToSrgb(clamp01(srgbToLinear(v) * scale + adj.offset) ** (1 / g))));
    }
    case 'invert':
      return prep(lutFrom((v) => 1 - v));
    case 'posterize': {
      const n = Math.max(2, Math.min(255, Math.round(adj.levels)));
      return prep(lutFrom((v) => Math.min(n - 1, Math.floor(v * n)) / (n - 1)));
    }
    case 'threshold':
      // Halfway between 8-bit steps: luma ≥ level is white, robust to float rounding on both sides.
      params[0] = (adj.level - 0.5) / 255;
      return prep(null, STAGE.threshold);
    case 'hue-saturation':
      params[0] = adj.hue / 360; // a shift of −½..½ turn, or with Colorize the hue itself (0..1)
      params[1] = adj.saturation / 100;
      params[2] = adj.lightness / 100;
      params[3] = adj.colorize ? 1 : 0;
      return prep(null, STAGE.hueSaturation);
    case 'vibrance':
      params[0] = adj.vibrance / 100;
      params[1] = adj.saturation / 100;
      return prep(null, STAGE.vibrance);
    case 'color-balance':
      params.set(
        adj.shadows.map((v) => v / 100),
        0,
      );
      params.set(
        adj.midtones.map((v) => v / 100),
        4,
      );
      params.set(
        adj.highlights.map((v) => v / 100),
        8,
      );
      params[3] = adj.preserveLuminosity ? 1 : 0;
      return prep(null, STAGE.colorBalance);
    case 'black-white': {
      const w = adj.weights;
      params.set(
        [w.r, w.y, w.g, w.c, w.b, w.m].map((v) => v / 100),
        0,
      );
      if (adj.tint) {
        params.set(
          adj.tint.map((v) => v / 255),
          8,
        );
        params[11] = 1;
      }
      return prep(null, STAGE.blackWhite);
    }
    case 'photo-filter':
      params.set(
        adj.color.map((v) => v / 255),
        0,
      );
      params[3] = adj.density / 100;
      params[4] = adj.preserveLuminosity ? 1 : 0;
      return prep(null, STAGE.photoFilter);
  }
}

// ---- the colour stage (mirrors adjust.frag) --------------------------------------------------------

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hueToRgb(p: number, q: number, t: number): number {
  const u = t - Math.floor(t);
  if (u < 1 / 6) return p + (q - p) * 6 * u;
  if (u < 1 / 2) return q;
  if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): RGB {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

/** Rec. 601 luma, as Photoshop's Threshold and Vibrance use. */
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** GIMP's colour-balance transfer: each range's shift fades in and out with the lightness. */
function balance(v: number, l: number, sh: number, mid: number, hi: number): number {
  const a = 0.25;
  const b = 0.333;
  const scale = 0.7;
  const s = sh * clamp01((l - b) / -a + 0.5) * scale;
  const m = mid * clamp01((l - b) / a + 0.5) * clamp01((l + b - 1) / -a + 0.5) * scale;
  const h = hi * clamp01((l + b - 1) / a + 0.5) * scale;
  return clamp01(v + s + m + h);
}

function colorStage(stage: number, p: Float32Array, r: number, g: number, b: number): RGB {
  switch (stage) {
    case STAGE.threshold: {
      const v = luma(r, g, b) >= p[0]! ? 1 : 0;
      return [v, v, v];
    }
    case STAGE.hueSaturation: {
      const [h, s, l] = rgbToHsl(r, g, b);
      const light = p[2]!;
      const shift = (v: number) => (light < 0 ? v * (1 + light) : v + (1 - v) * light);
      // Colorize: one hue and saturation for everything, keeping each pixel's lightness (GIMP).
      if (p[3]! > 0.5) return hslToRgb(p[0]!, clamp01(p[1]!), shift(l));
      return hslToRgb(h + p[0]!, clamp01(s * (1 + p[1]!)), shift(l));
    }
    case STAGE.vibrance: {
      // Saturation scales the distance from the luma; vibrance does the same, less for saturated pixels.
      const y = luma(r, g, b);
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      const k = (1 + p[1]!) * (1 + p[0]! * (1 - sat));
      return [clamp01(y + (r - y) * k), clamp01(y + (g - y) * k), clamp01(y + (b - y) * k)];
    }
    case STAGE.colorBalance: {
      const l = rgbToHsl(r, g, b)[2];
      const out: RGB = [
        balance(r, l, p[0]!, p[4]!, p[8]!),
        balance(g, l, p[1]!, p[5]!, p[9]!),
        balance(b, l, p[2]!, p[6]!, p[10]!),
      ];
      if (p[3]! < 0.5) return out;
      const [h, s] = rgbToHsl(...out);
      return hslToRgb(h, s, l);
    }
    case STAGE.blackWhite: {
      // Each pixel = its minimum (grey) + a secondary colour (mid − min) + a primary (max − mid), weighted.
      // Ties go to red, then green, as in the shader.
      const ch = [r, g, b];
      const i0 = r >= g && r >= b ? 0 : g >= b ? 1 : 2;
      const [j, k] = i0 === 0 ? [1, 2] : i0 === 1 ? [0, 2] : [0, 1];
      const i1 = ch[j]! >= ch[k]! ? j : k;
      const mx = ch[i0]!;
      const md = ch[i1]!;
      const mn = ch[3 - i0 - i1]!;
      const primary = [p[0]!, p[2]!, p[4]!][i0]!;
      // Red + green = yellow (p1), green + blue = cyan (p3), red + blue = magenta (p5).
      const secondary = i0 + i1 === 1 ? p[1]! : i0 + i1 === 3 ? p[3]! : p[5]!;
      const v = clamp01(mn + (md - mn) * secondary + (mx - md) * primary);
      if (p[11]! < 0.5) return [v, v, v];
      const [h, s] = rgbToHsl(p[8]!, p[9]!, p[10]!);
      return hslToRgb(h, s, v);
    }
    case STAGE.photoFilter: {
      // A coloured filter: multiply by the colour, by `density`; optionally keep each pixel's luma.
      const d = p[3]!;
      let o: RGB = [r + (r * p[0]! - r) * d, g + (g * p[1]! - g) * d, b + (b * p[2]! - b) * d];
      if (p[4]! > 0.5) {
        const before = luma(r, g, b);
        const after = luma(...o);
        if (after > 0) o = o.map((v) => (v * before) / after) as RGB;
      }
      return [clamp01(o[0]), clamp01(o[1]), clamp01(o[2])];
    }
    default:
      return [r, g, b];
  }
}

/** The adjusted colour of one straight pixel (0..1): the CPU reference for adjust.frag. */
export function adjustPixel(a: PreparedAdjustment, r: number, g: number, b: number): RGB {
  if (a.lut) {
    const at = (v: number, c: number) => a.lut![Math.round(clamp01(v) * 255) * 4 + c]! / 255;
    r = at(r, 0);
    g = at(g, 1);
    b = at(b, 2);
  }
  return colorStage(a.stage, a.params, r, g, b);
}

/** Kinds whose defaults already change the image (the others do nothing until a control moves). */
const ACTIVE_BY_DEFAULT = new Set<AdjustmentKind>([
  'black-white',
  'photo-filter',
  'invert',
  'posterize',
  'threshold',
]);

/** Leaves every colour as it is (an untouched new adjustment layer): the compositor can skip it. */
export function isNeutral(adj: Adjustment): boolean {
  return (
    !ACTIVE_BY_DEFAULT.has(adj.kind) && JSON.stringify(adj) === JSON.stringify(defaultAdjustment(adj.kind))
  );
}
