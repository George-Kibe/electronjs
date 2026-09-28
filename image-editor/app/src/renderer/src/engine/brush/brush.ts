import { createTile, TILE_BYTES, TILE_SIZE, type Tile } from '../tiles/tile';

export type BrushMode = 'paint' | 'erase';

export type BrushSettings = {
  /** Diameter in document pixels. */
  size: number;
  /** 0 (soft) … 1 (hard). */
  hardness: number;
  /** Caps the whole stroke, 0..1 (Photoshop "Opacity"). */
  opacity: number;
  /** Per-dab strength, 0..1 (Photoshop "Flow"). */
  flow: number;
  /** Dab spacing as a fraction of the diameter. */
  spacing: number;
  /** Straight sRGB, 0..255. */
  color: [number, number, number];
  mode: BrushMode;
  /** Pen pressure scales the diameter (FR-PNT-01). */
  pressureSize: boolean;
};

export const DEFAULT_BRUSH: BrushSettings = {
  size: 30,
  hardness: 0.8,
  opacity: 1,
  flow: 1,
  spacing: 0.1,
  color: [0, 0, 0],
  mode: 'paint',
  pressureSize: true,
};

export type Dab = { x: number; y: number; radius: number; alpha: number };
export type BrushPoint = { x: number; y: number; pressure: number };

/**
 * Coverage of a round dab at distance `d` from its centre (sampled at pixel centres). The GLSL version in
 * gpu/shaders/dab.frag must stay identical (checked by brush.gpu.test.ts).
 */
export function dabCoverage(d: number, radius: number, hardness: number): number {
  const feather = Math.max(0.5, radius * (1 - hardness));
  const inner = Math.max(0, radius - feather);
  if (d <= inner) return 1;
  if (d >= radius) return 0;
  const t = (d - inner) / (radius - inner);
  return 1 - t * t * (3 - 2 * t);
}

/** Turns pointer samples into evenly spaced dabs (spacing independent of pointer speed and zoom). */
export class DabGenerator {
  private last: BrushPoint | null = null;
  /** Distance travelled since the last dab. */
  private carry = 0;

  constructor(private readonly settings: BrushSettings) {}

  private dab(p: BrushPoint): Dab {
    const scale = this.settings.pressureSize ? Math.max(0.05, p.pressure) : 1;
    return {
      x: p.x,
      y: p.y,
      radius: Math.max(0.5, (this.settings.size * scale) / 2),
      alpha: this.settings.flow,
    };
  }

  private step(p: BrushPoint): number {
    const scale = this.settings.pressureSize ? Math.max(0.05, p.pressure) : 1;
    return Math.max(0.5, this.settings.size * scale * this.settings.spacing);
  }

  begin(p: BrushPoint): Dab[] {
    this.last = p;
    this.carry = 0;
    return [this.dab(p)];
  }

  moveTo(p: BrushPoint): Dab[] {
    const from = this.last;
    if (!from) return this.begin(p);
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    const dist = Math.hypot(dx, dy);
    const dabs: Dab[] = [];
    if (dist === 0) return dabs;
    // Distance (along this segment) of the next dab, and of the last dab placed so far.
    let next = this.step(from) - this.carry;
    let lastDab = -this.carry;
    while (next <= dist) {
      const t = next / dist;
      const q = {
        x: from.x + dx * t,
        y: from.y + dy * t,
        pressure: from.pressure + (p.pressure - from.pressure) * t,
      };
      dabs.push(this.dab(q));
      lastDab = next;
      next += this.step(q);
    }
    this.carry = dist - lastDab;
    this.last = p;
    return dabs;
  }
}

/** Accumulates dabs into a coverage buffer: s' = s + c·flow·(1 − s) (CPU reference of the GPU stroke buffer). */
export function accumulateDabs(
  coverage: Float32Array,
  tileX: number,
  tileY: number,
  dabs: readonly Dab[],
  hardness: number,
): void {
  const ox = tileX * TILE_SIZE;
  const oy = tileY * TILE_SIZE;
  for (const dab of dabs) {
    const x0 = Math.max(0, Math.floor(dab.x - dab.radius - ox));
    const x1 = Math.min(TILE_SIZE, Math.ceil(dab.x + dab.radius - ox));
    const y0 = Math.max(0, Math.floor(dab.y - dab.radius - oy));
    const y1 = Math.min(TILE_SIZE, Math.ceil(dab.y + dab.radius - oy));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const c =
          dabCoverage(Math.hypot(ox + x + 0.5 - dab.x, oy + y + 0.5 - dab.y), dab.radius, hardness) *
          dab.alpha;
        if (c <= 0) continue;
        const i = y * TILE_SIZE + x;
        coverage[i] = c + coverage[i]! * (1 - c);
      }
    }
  }
}

/**
 * Commits a stroke's coverage into a layer tile (CPU, exact, straight alpha). Pixels with zero coverage or
 * outside the document stay byte-identical. Returns undefined for a fully transparent result (sparse grid).
 */
export function applyStroke(
  before: Tile | undefined,
  coverage: Float32Array,
  settings: Pick<BrushSettings, 'color' | 'opacity' | 'mode'>,
  bounds: { tileX: number; tileY: number; docWidth: number; docHeight: number },
  /** Transparency lock (FR-LAY-02): paint recolours existing pixels only; the eraser does nothing. */
  preserveAlpha = false,
): Tile | undefined {
  if (preserveAlpha && (!before || settings.mode === 'erase')) return before;
  const out = before ? new Uint8ClampedArray(before.data) : new Uint8ClampedArray(TILE_BYTES);
  const w = Math.min(TILE_SIZE, bounds.docWidth - bounds.tileX * TILE_SIZE);
  const h = Math.min(TILE_SIZE, bounds.docHeight - bounds.tileY * TILE_SIZE);
  const [cr, cg, cb] = settings.color;
  let changed = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * TILE_SIZE + x;
      const as = coverage[i]! * settings.opacity;
      if (as <= 0) continue;
      changed = true;
      const p = i * 4;
      const ad = out[p + 3]! / 255;
      if (preserveAlpha) {
        if (ad === 0) continue;
        out[p] = out[p]! + (cr - out[p]!) * as;
        out[p + 1] = out[p + 1]! + (cg - out[p + 1]!) * as;
        out[p + 2] = out[p + 2]! + (cb - out[p + 2]!) * as;
        continue;
      }
      if (settings.mode === 'erase') {
        out[p + 3] = ad * (1 - as) * 255;
        continue;
      }
      const ao = as + ad * (1 - as);
      out[p] = (cr * as + out[p]! * ad * (1 - as)) / ao;
      out[p + 1] = (cg * as + out[p + 1]! * ad * (1 - as)) / ao;
      out[p + 2] = (cb * as + out[p + 2]! * ad * (1 - as)) / ao;
      out[p + 3] = ao * 255;
    }
  }
  if (!changed) return before;
  for (let p = 3; p < out.length; p += 4) if (out[p] !== 0) return createTile(out);
  return undefined;
}
