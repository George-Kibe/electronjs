import type { BlendMode } from './document';

/**
 * Separable blend functions B(Cb, Cs) on gamma-encoded sRGB in 0..1 (ADR-0004), from the W3C Compositing
 * and Blending Level 1 spec §10.2 ("Separable blend modes"). Linear Dodge (Add) follows Photoshop.
 * The GLSL twin lives in gpu/shaders/blend.glsl; gpu.gpu.test.ts checks they agree.
 *
 * M1 implements Normal plus the 8 most used modes; the rest (FR-LAY-03, M2) render as Normal until then.
 */
export const IMPLEMENTED_BLEND_MODES = [
  'normal',
  'darken',
  'multiply',
  'lighten',
  'screen',
  'overlay',
  'soft-light',
  'hard-light',
  'difference',
] as const satisfies readonly BlendMode[];

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

/** Shader index for each mode (must match blend.glsl). Unimplemented modes map to Normal (0). */
export function blendModeIndex(mode: BlendMode): number {
  const i = (IMPLEMENTED_BLEND_MODES as readonly string[]).indexOf(mode);
  return i < 0 ? 0 : i;
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
    default:
      return cs;
  }
}

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
): void {
  if (sa <= 0) return;
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
  const mix = (cb: number, cs: number) => (1 - ab) * cs + ab * blendChannel(mode, cb, cs);
  acc[i] = mix(br, sr) * sa + acc[i]! * keep;
  acc[i + 1] = mix(bg, sg) * sa + acc[i + 1]! * keep;
  acc[i + 2] = mix(bb, sb) * sa + acc[i + 2]! * keep;
  acc[i + 3] = sa + ab * keep;
}
