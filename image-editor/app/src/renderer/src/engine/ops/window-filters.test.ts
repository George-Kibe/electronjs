import { describe, expect, it } from 'vitest';
import { TILE_SIZE, TileGrid } from '../tiles/tile';
import { applyFilter, defaultFilter, filterReach, type Filter } from './filters';

const W = 300;
const H = 280;

function layer(fill: (x: number, y: number) => [number, number, number, number]): Map<string, Uint8Array> {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgba.set(fill(x, y), (y * W + x) * 4);
  const grid = TileGrid.fromRgba(W, H, rgba);
  return new Map([...grid.entries()].map(([k, t]) => [k, new Uint8Array(t.data)]));
}
const run = (filter: Filter, tiles: Map<string, Uint8Array>) => {
  const out = new Map(tiles);
  for (const [k, t] of applyFilter(filter, {
    tiles,
    size: { width: W, height: H },
    selection: null,
    keys: null,
    preserveAlpha: false,
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
const grey = (v: number): [number, number, number, number] => [v, v, v, 255];

describe('window filters (FR-FLT-01)', () => {
  it('Motion Blur smears along its angle only', () => {
    const vertical = layer((x) => grey(x % 2 ? 255 : 0));
    const across = run({ kind: 'motion-blur', angle: 0, distance: 10 }, vertical);
    expect(Math.abs(at(across, 100, 100)[0]! - 128)).toBeLessThan(20);
    const along = run({ kind: 'motion-blur', angle: 90, distance: 10 }, vertical);
    expect(at(along, 101, 100)[0]).toBeGreaterThan(230);
    expect(filterReach({ kind: 'motion-blur', angle: 0, distance: 10 })).toBe(6);
  });

  it('Add Noise is repeatable, centred, monochromatic on request, and leaves transparency alone', () => {
    const flat = layer((x) => (x < 280 ? grey(128) : [0, 0, 0, 0]));
    const f: Filter = {
      kind: 'add-noise',
      amount: 50,
      distribution: 'gaussian',
      monochromatic: false,
      seed: 3,
    };
    const a = run(f, flat);
    const b = run(f, flat);
    expect(at(a, 77, 33)).toEqual(at(b, 77, 33));
    let sum = 0;
    let sq = 0;
    for (let x = 0; x < 200; x++) {
      const v = at(a, x, 50)[0]!;
      sum += v;
      sq += (v - 128) ** 2;
    }
    expect(Math.abs(sum / 200 - 128)).toBeLessThan(6);
    expect(Math.sqrt(sq / 200)).toBeGreaterThan(15);
    const mono = run({ ...f, monochromatic: true }, flat);
    const [r, g, bl] = at(mono, 40, 40);
    expect(r).toBe(g);
    expect(g).toBe(bl);
    expect(at(a, 290, 10)).toEqual([0, 0, 0, 0]);
  });

  it('Reduce Noise (median) removes specks and keeps edges', () => {
    const specks = layer((x, y) => (x === 100 && y === 100 ? grey(255) : x < 150 ? grey(0) : grey(255)));
    const out = run({ kind: 'reduce-noise', radius: 1 }, specks);
    expect(at(out, 100, 100)).toEqual(grey(0));
    expect(at(out, 149, 50)).toEqual(grey(0));
    expect(at(out, 150, 50)).toEqual(grey(255));
    const ramp = layer((x) => grey(x % 256));
    expect(at(run({ kind: 'reduce-noise', radius: 2 }, ramp), 60, 60)).toEqual(grey(60)); // a ramp is its own median
  });

  it('Mosaic fills canvas-aligned cells with their average, across tile edges', () => {
    const stripes = layer((x) => grey(x % 2 ? 200 : 100));
    const out = run({ kind: 'mosaic', cellSize: 10 }, stripes);
    expect(at(out, 250, 7)).toEqual(at(out, 259, 2)); // one cell over tiles 0 and 1
    expect(at(out, 250, 7)[0]).toBe(150);
    expect(at(out, 15, 15)).toEqual(grey(150));
  });

  it('Emboss is grey where flat and shows edges; Find Edges is white where flat, dark on edges', () => {
    const step = layer((x) => grey(x < 150 ? 40 : 220));
    const emb = run(defaultFilter('emboss'), step);
    expect(Math.abs(at(emb, 50, 50)[0]! - 128)).toBeLessThanOrEqual(1);
    expect(Math.abs(at(emb, 150, 50)[0]! - 128)).toBeGreaterThan(40);
    const edges = run({ kind: 'find-edges' }, step);
    expect(at(edges, 50, 50)).toEqual(grey(255));
    expect(at(edges, 150, 50)[0]).toBeLessThan(100);
  });

  it('Vignette darkens or lightens towards the corners, not the centre', () => {
    const mid = layer(() => grey(128));
    const dark = run({ kind: 'vignette', amount: -80, midpoint: 30 }, mid);
    expect(at(dark, 150, 140)).toEqual(grey(128));
    expect(at(dark, 0, 0)[0]).toBeLessThan(60);
    const light = run({ kind: 'vignette', amount: 80, midpoint: 30 }, mid);
    expect(at(light, 299, 279)[0]).toBeGreaterThan(200);
  });
});
