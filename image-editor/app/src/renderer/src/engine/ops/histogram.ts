import { compositeTile, type FlatLayer } from '../doc/flatten';
import { parseTileKey, TILE_SIZE, tileKeysInRect } from '../tiles/tile';
import type { AdjustmentOf, LevelsChannel } from './adjust';

/**
 * Histograms (FR-ADJ-03) and the Auto adjustments built from them (FR-ADJ-02). Counts are per 8-bit value;
 * transparent pixels are not counted. Luminosity uses Photoshop's weights (0.30, 0.59, 0.11).
 */
export type Histogram = { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array; count: number };

export function emptyHistogram(): Histogram {
  return {
    r: new Uint32Array(256),
    g: new Uint32Array(256),
    b: new Uint32Array(256),
    l: new Uint32Array(256),
    count: 0,
  };
}

/**
 * The histogram of the composite of `layers` on the canvas, or only within the selection (one-byte
 * coverage tiles; partly selected pixels count when at least half selected). Runs in the ops worker.
 */
export function histogramOf(
  layers: readonly FlatLayer[],
  size: { width: number; height: number },
  selection: ReadonlyMap<string, Uint8Array> | null,
): Histogram {
  const h = emptyHistogram();
  for (const key of tileKeysInRect(0, 0, size.width, size.height)) {
    const sel = selection?.get(key);
    if (selection && !sel) continue;
    const [tx, ty] = parseTileKey(key);
    const t = compositeTile(layers, key);
    const w = Math.min(TILE_SIZE, size.width - tx * TILE_SIZE);
    const rows = Math.min(TILE_SIZE, size.height - ty * TILE_SIZE);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < w; x++) {
        const p = y * TILE_SIZE + x;
        if (sel && sel[p]! < 128) continue;
        const i = p * 4;
        if (t[i + 3] === 0) continue;
        const r = t[i]!;
        const g = t[i + 1]!;
        const b = t[i + 2]!;
        h.r[r]!++;
        h.g[g]!++;
        h.b[b]!++;
        h.l[Math.round(0.3 * r + 0.59 * g + 0.11 * b)]!++;
        h.count++;
      }
  }
  return h;
}

/** Packs a histogram into bytes (for the job result) and back. */
export function packHistogram(h: Histogram): Uint8Array {
  const all = new Uint32Array(1025);
  all.set(h.r, 0);
  all.set(h.g, 256);
  all.set(h.b, 512);
  all.set(h.l, 768);
  all[1024] = h.count;
  return new Uint8Array(all.buffer);
}

export function unpackHistogram(bytes: Uint8Array): Histogram {
  const all = new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + 1025 * 4));
  return {
    r: all.slice(0, 256),
    g: all.slice(256, 512),
    b: all.slice(512, 768),
    l: all.slice(768, 1024),
    count: all[1024]!,
  };
}

/** Mean, standard deviation and median of one channel. */
export function stats(bins: Uint32Array): { mean: number; stdDev: number; median: number; count: number } {
  let count = 0;
  let sum = 0;
  for (let v = 0; v < 256; v++) {
    count += bins[v]!;
    sum += v * bins[v]!;
  }
  if (count === 0) return { mean: 0, stdDev: 0, median: 0, count: 0 };
  const mean = sum / count;
  let sq = 0;
  let seen = 0;
  let median = -1;
  for (let v = 0; v < 256; v++) {
    sq += bins[v]! * (v - mean) ** 2;
    seen += bins[v]!;
    if (median < 0 && seen * 2 >= count) median = v;
  }
  return { mean, stdDev: Math.sqrt(sq / count), median, count };
}

/** The darkest and lightest values after clipping `clip` (a fraction) of the pixels at each end. */
function clipped(bins: Uint32Array, clip: number): [number, number] {
  let count = 0;
  for (const n of bins) count += n;
  const cut = count * clip;
  let lo = 0;
  for (let seen = 0; lo < 255; lo++) if ((seen += bins[lo]!) > cut) break;
  let hi = 255;
  for (let seen = 0; hi > 0; hi--) if ((seen += bins[hi]!) > cut) break;
  return [lo, hi];
}

const IDENTITY: LevelsChannel = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };

/** Stretches [lo, hi] to the full range, or leaves the channel alone when it is (nearly) flat. */
const stretch = ([lo, hi]: [number, number]): LevelsChannel =>
  hi - lo < 2 ? { ...IDENTITY } : { ...IDENTITY, inBlack: lo, inWhite: hi };

/**
 * Image › Auto Tone / Auto Contrast / Auto Color (FR-ADJ-02), as Levels, clipping 0.1 % at each end as
 * Photoshop's defaults do:
 * - tone: each channel stretched on its own (Enhance Per Channel Contrast);
 * - contrast: one stretch for all channels from their pooled histogram (Enhance Monochromatic Contrast), so
 *   colours do not shift;
 * - color: per channel, then each channel's midtone gamma moved so their means meet (Snap Neutral Midtones).
 */
export function autoLevels(
  h: Histogram,
  mode: 'tone' | 'contrast' | 'color',
  clip = 0.001,
): AdjustmentOf<'levels'> {
  const channels = { rgb: { ...IDENTITY }, r: { ...IDENTITY }, g: { ...IDENTITY }, b: { ...IDENTITY } };
  if (h.count === 0) return { kind: 'levels', channels };
  if (mode === 'contrast') {
    const pooled = new Uint32Array(256);
    for (let v = 0; v < 256; v++) pooled[v] = h.r[v]! + h.g[v]! + h.b[v]!;
    channels.rgb = stretch(clipped(pooled, clip));
    return { kind: 'levels', channels };
  }
  for (const c of ['r', 'g', 'b'] as const) channels[c] = stretch(clipped(h[c], clip));
  if (mode === 'color') {
    // Each channel's mean after its stretch, in 0..1; the gamma that moves it to the average of the three.
    const means = (['r', 'g', 'b'] as const).map((c) => {
      const { inBlack, inWhite } = channels[c];
      const m = stats(h[c]).mean;
      return Math.min(0.99, Math.max(0.01, (m - inBlack) / (inWhite - inBlack)));
    });
    const target = means.reduce((a, b) => a + b, 0) / 3;
    (['r', 'g', 'b'] as const).forEach((c, i) => {
      // t^(1/γ) = target where t = mean  ⇒  γ = ln t / ln target.
      const gamma = Math.log(means[i]!) / Math.log(target);
      channels[c] = { ...channels[c], gamma: Math.min(9.99, Math.max(0.1, Math.round(gamma * 100) / 100)) };
    });
  }
  return { kind: 'levels', channels };
}
