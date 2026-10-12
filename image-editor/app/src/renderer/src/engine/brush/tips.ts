/**
 * Brush tips (FR-PNT-01): round, plus a few textured presets. A textured tip is the round dab with a grain
 * map multiplied into the finished stroke coverage (like Photoshop's Texture with "texture each tip" off),
 * so the grain stays visible however much the dabs overlap.
 *
 * Grain maps are 128×128 bytes, generated here deterministically and tileable. They are sampled at integer
 * document pixels (x mod 128, y mod 128) by both the CPU commit (brush.ts applyStroke) and the GPU preview
 * (layer.frag), so the two agree exactly. 128 divides the 256 px tile size, so tile origins line up.
 */
export const BRUSH_TIPS = ['round', 'chalk', 'charcoal', 'sponge'] as const;
export type BrushTip = (typeof BRUSH_TIPS)[number];

export const TIP_LABELS: Record<BrushTip, string> = {
  round: 'Round',
  chalk: 'Chalk',
  charcoal: 'Charcoal',
  sponge: 'Sponge',
};

export const GRAIN_SIZE = 128;

/** Small seeded PRNG (mulberry32): the same maps on every machine. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tileable value noise: random values on a lattice of `cellX × cellY` px cells (both divide GRAIN_SIZE),
 * smoothly interpolated. Returns GRAIN_SIZE² values in 0..1.
 */
function valueNoise(seed: number, cellX: number, cellY: number): Float32Array {
  const rand = random(seed);
  const nx = GRAIN_SIZE / cellX;
  const ny = GRAIN_SIZE / cellY;
  const lattice = Float32Array.from({ length: nx * ny }, rand);
  const at = (ix: number, iy: number) => lattice[(iy % ny) * nx + (ix % nx)]!;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const out = new Float32Array(GRAIN_SIZE * GRAIN_SIZE);
  for (let y = 0; y < GRAIN_SIZE; y++) {
    const iy = Math.floor(y / cellY);
    const fy = smooth((y % cellY) / cellY);
    for (let x = 0; x < GRAIN_SIZE; x++) {
      const ix = Math.floor(x / cellX);
      const fx = smooth((x % cellX) / cellX);
      const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx;
      const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
      out[y * GRAIN_SIZE + x] = top + (bottom - top) * fy;
    }
  }
  return out;
}

/** Maps noise to coverage: 0 below `lo`, 1 above `hi`, linear in between. */
function toGrain(noise: Float32Array, lo: number, hi: number): Uint8Array {
  return Uint8Array.from(noise, (v) => Math.round(Math.min(1, Math.max(0, (v - lo) / (hi - lo))) * 255));
}

function mix(a: Float32Array, b: Float32Array, wb: number): Float32Array {
  return a.map((v, i) => v * (1 - wb) + b[i]! * wb);
}

const generators: Record<Exclude<BrushTip, 'round'>, () => Uint8Array> = {
  // Fine paper tooth: small speckles with a little larger-scale variation.
  chalk: () => toGrain(mix(valueNoise(11, 2, 2), valueNoise(12, 8, 8), 0.35), 0.22, 0.42),
  // Horizontal fibre streaks.
  charcoal: () => toGrain(mix(valueNoise(21, 32, 2), valueNoise(22, 4, 2), 0.4), 0.35, 0.6),
  // Open, blotchy cells.
  sponge: () => toGrain(mix(valueNoise(31, 8, 8), valueNoise(32, 4, 4), 0.3), 0.42, 0.56),
};

const cache = new Map<BrushTip, Uint8Array>();

/** The tip's grain map (GRAIN_SIZE² bytes, 255 = full coverage), or null for the plain round tip. */
export function tipGrain(tip: BrushTip): Uint8Array | null {
  if (tip === 'round') return null;
  let grain = cache.get(tip);
  if (!grain) cache.set(tip, (grain = generators[tip]()));
  return grain;
}
