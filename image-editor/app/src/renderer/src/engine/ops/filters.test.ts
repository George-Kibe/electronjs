import { describe, expect, it } from 'vitest';
import { TILE_SIZE, TileGrid } from '../tiles/tile';
import { applyFilter, boxLine, gaussianBoxes, gaussianLine, type Filter } from './filters';

const W = 300;
const H = 280;

function layer(fill: (x: number, y: number) => [number, number, number, number]): Map<string, Uint8Array> {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgba.set(fill(x, y), (y * W + x) * 4);
  const grid = TileGrid.fromRgba(W, H, rgba);
  return new Map([...grid.entries()].map(([k, t]) => [k, new Uint8Array(t.data)]));
}

const run = (
  filter: Filter,
  tiles: Map<string, Uint8Array>,
  opts: { selection?: Map<string, Uint8Array>; keys?: Set<string>; preserveAlpha?: boolean } = {},
) => {
  const out = new Map(tiles);
  for (const [k, t] of applyFilter(filter, {
    tiles,
    size: { width: W, height: H },
    selection: opts.selection ?? null,
    keys: opts.keys ?? null,
    preserveAlpha: opts.preserveAlpha ?? false,
  }))
    if (t.length) out.set(k, t);
    else out.delete(k);
  return out;
};
const at = (tiles: Map<string, Uint8Array>, x: number, y: number) => {
  const t = tiles.get(`${Math.floor(x / TILE_SIZE)},${Math.floor(y / TILE_SIZE)}`);
  const i = ((y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE)) * 4;
  return t ? [...t.subarray(i, i + 4)] : [0, 0, 0, 0];
};

/** Impulse response along a line: its sum and variance. */
function moments(run: (line: Float32Array, tmp: Float32Array, n: number) => Float32Array, n = 801) {
  const input = new Float32Array(n * 4);
  input[(n >> 1) * 4] = 1;
  const line = run(input, new Float32Array(n * 4), n);
  let sum = 0;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    sum += line[i * 4]!;
    varSum += line[i * 4]! * (i - (n >> 1)) ** 2;
  }
  return { sum, variance: varSum / sum };
}

describe('filter lines (FR-FLT-01)', () => {
  it('a box keeps constants, spreads an impulse evenly and repeats the edges', () => {
    const n = 20;
    const line = new Float32Array(n * 4).fill(0.5);
    const out = new Float32Array(n * 4);
    boxLine(line, out, n, 3);
    expect([...out].every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true);
    const imp = new Float32Array(n * 4);
    imp[10 * 4] = 1;
    boxLine(imp, out, n, 2);
    expect(out[8 * 4]).toBeCloseTo(0.2, 6);
    expect(out[12 * 4]).toBeCloseTo(0.2, 6);
    expect(out[13 * 4]).toBeCloseTo(0, 6);
    const edge = new Float32Array(n * 4);
    edge[0] = 1; // the first pixel is repeated beyond the edge
    boxLine(edge, out, n, 2);
    expect(out[0]).toBeCloseTo(3 / 5, 6);
  });

  it('Gaussian: the radius is the standard deviation, exact or as three boxes', () => {
    for (const sigma of [0.7, 2, 5, 25, 50]) {
      const { sum, variance } = moments(gaussianLine(sigma).run);
      expect(sum).toBeCloseTo(1, 4);
      expect(Math.sqrt(variance) / sigma, `σ ${sigma}`).toBeGreaterThan(0.95);
      expect(Math.sqrt(variance) / sigma, `σ ${sigma}`).toBeLessThan(1.05);
    }
    const [a, b, c] = gaussianBoxes(10);
    expect(Math.abs(a - b) + Math.abs(b - c)).toBeLessThanOrEqual(2);
  });
});

describe('applyFilter (FR-FLT-01)', () => {
  const half = layer((x) => (x < 150 ? [0, 0, 0, 255] : [255, 255, 255, 255]));

  it('blurs across tile edges; flat areas and canvas edges stay; only the canvas is touched', () => {
    const out = run({ kind: 'gaussian-blur', radius: 8 }, half);
    expect(at(out, 10, 10)).toEqual([0, 0, 0, 255]);
    expect(at(out, 0, 0)).toEqual([0, 0, 0, 255]); // repeated edge: no fade to transparent
    expect(at(out, 299, 279)).toEqual([255, 255, 255, 255]);
    const mid = at(out, 150, 140)[0]!;
    expect(mid).toBeGreaterThan(100);
    expect(mid).toBeLessThan(160);
    const row = [140, 145, 150, 155, 160].map((x) => at(out, x, 270)[0]!); // second tile row, across tile 0|1
    expect(row).toEqual([...row].sort((p, q) => p - q));
    // The same at a box blur.
    expect(at(run({ kind: 'box-blur', radius: 5 }, half), 152, 20)[0]).toBeGreaterThan(128);
  });

  it('blurs in premultiplied alpha: a red shape on transparency keeps its colour at the soft edge', () => {
    const dot = layer((x, y) => ((x - 100) ** 2 + (y - 100) ** 2 < 900 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
    const out = run({ kind: 'gaussian-blur', radius: 4 }, dot);
    const edge = at(out, 130, 100);
    expect(edge[3]).toBeGreaterThan(20);
    expect(edge[3]).toBeLessThan(235);
    expect(edge.slice(0, 3)).toEqual([255, 0, 0]);
    // Transparency locked: the alpha stays exactly.
    const locked = run({ kind: 'gaussian-blur', radius: 4 }, dot, { preserveAlpha: true });
    expect(at(locked, 135, 100)[3]).toBe(0);
    expect(at(locked, 100, 100)[3]).toBe(255);
  });

  it('respects the selection by coverage and computes only the tiles asked for', () => {
    const sel = new Uint8Array(TILE_SIZE * TILE_SIZE);
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) sel[y * 256 + x] = x >= 140 ? 255 : x >= 130 ? 128 : 0;
    const out = run({ kind: 'gaussian-blur', radius: 8 }, half, { selection: new Map([['0,0', sel]]) });
    expect(at(out, 120, 10)).toEqual([0, 0, 0, 255]); // unselected
    expect(at(out, 149, 10)[0]).toBeGreaterThan(60); // selected, near the edge: blurred
    expect(at(out, 260, 10)).toEqual([255, 255, 255, 255]); // tile 1,0 not selected at all
    const partial = applyFilter(
      { kind: 'gaussian-blur', radius: 8 },
      {
        tiles: half,
        size: { width: W, height: H },
        selection: null,
        keys: new Set(['1,0']),
        preserveAlpha: false,
      },
    );
    expect(partial.map(([k]) => k)).toEqual(['1,0']);
  });

  it('unsharp mask raises local contrast, above the threshold only; Sharpen is a milder fixed one', () => {
    const soft = layer((x) => [100 + Math.round(x / 10), 100, 100, 255]);
    const step = layer((x) => (x < 150 ? [90, 90, 90, 255] : [160, 160, 160, 255]));
    const sharp = run({ kind: 'unsharp-mask', amount: 150, radius: 3, threshold: 0 }, step);
    expect(at(sharp, 148, 50)[0]).toBeLessThan(90);
    expect(at(sharp, 151, 50)[0]).toBeGreaterThan(160);
    expect(at(sharp, 20, 50)[0]).toBe(90); // flat: unchanged
    const held = run({ kind: 'unsharp-mask', amount: 150, radius: 3, threshold: 10 }, soft);
    expect(at(held, 100, 50)).toEqual(at(soft, 100, 50)); // gentle ramp below the threshold
    const mild = run({ kind: 'sharpen' }, step);
    expect(at(mild, 149, 50)[0]).toBeLessThan(90);
    expect(at(mild, 149, 50)[0]).toBeGreaterThan(at(sharp, 149, 50)[0]!);
  });
});
