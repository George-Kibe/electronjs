import { tileRange } from '@shared/iep-schema';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TILE_BYTES, TileGrid } from '../tiles/tile';
import { clipGrid, flipGrid, rotateGrid } from './canvas';

/** A grid whose pixels encode their own position, with transparent holes and pixels off the canvas. */
function pattern(w: number, h: number, extra = true): TileGrid {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if ((x * 3 + y) % 7) rgba.set([x % 256, y % 256, (x ^ y) & 255, 255 - ((x + y) % 50)], (y * w + x) * 4);
  const grid = TileGrid.fromRgba(w, h, rgba);
  if (extra) {
    // A tile left of the canvas: off-canvas pixels rotate with the plane.
    const data = new Uint8ClampedArray(TILE_BYTES).fill(77);
    grid.set('-1,0', { id: -1, data } as never);
  }
  return grid;
}

/** "x,y:rgba" for every non-transparent pixel. */
function pixels(grid: TileGrid): Set<string> {
  const out = new Set<string>();
  for (const [key, tile] of grid.entries()) {
    const [tx, ty] = key.split(',').map(Number) as [number, number];
    for (let i = 0; i < TILE_BYTES; i += 4) {
      if (tile.data[i + 3] === 0) continue;
      const p = i / 4;
      out.add(
        `${tx * 256 + (p % 256)},${ty * 256 + Math.floor(p / 256)}:${tile.data.subarray(i, i + 4).join()}`,
      );
    }
  }
  return out;
}

const map = (set: Set<string>, f: (x: number, y: number) => [number, number]) =>
  new Set(
    [...set].map((s) => {
      const [pos, rgba] = s.split(':') as [string, string];
      const [x, y] = pos.split(',').map(Number) as [number, number];
      return `${f(x, y).join()}:${rgba}`;
    }),
  );

describe('exact canvas operations (FR-TRF-03, T-TRF-01)', () => {
  const W = 300;
  const H = 170;

  it('rotating 90° clockwise maps (x, y) to (H − 1 − y, x)', () => {
    const grid = pattern(W, H);
    const rotated = rotateGrid(grid, W, H, 1, tileRange(H, W));
    expect(pixels(rotated)).toEqual(map(pixels(grid), (x, y) => [H - 1 - y, x]));
  });

  it('180° and 270° match their formulas', () => {
    const grid = pattern(W, H, false);
    expect(pixels(rotateGrid(grid, W, H, 2, tileRange(W, H)))).toEqual(
      map(pixels(grid), (x, y) => [W - 1 - x, H - 1 - y]),
    );
    expect(pixels(rotateGrid(grid, W, H, 3, tileRange(H, W)))).toEqual(
      map(pixels(grid), (x, y) => [y, W - 1 - x]),
    );
  });

  it('property: four quarter turns are bit-exact identity, for any canvas size', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 600 }), fc.integer({ min: 1, max: 600 }), (w, h) => {
        const grid = pattern(Math.min(w, 300), Math.min(h, 300), false);
        let g = grid;
        let [cw, ch] = [w, h];
        for (let i = 0; i < 4; i++) {
          g = rotateGrid(g, cw, ch, 1, tileRange(ch, cw));
          [cw, ch] = [ch, cw];
        }
        expect(pixels(g)).toEqual(pixels(grid));
      }),
      { numRuns: 15 },
    );
  });

  it('flips mirror the plane, and flipping twice is the identity', () => {
    const grid = pattern(W, H);
    const range = tileRange(W, H);
    const h = flipGrid(grid, W, H, 'horizontal', range);
    expect(pixels(h)).toEqual(map(pixels(grid), (x, y) => [W - 1 - x, y]));
    expect(pixels(flipGrid(h, W, H, 'horizontal', range))).toEqual(pixels(grid));
    expect(pixels(flipGrid(grid, W, H, 'vertical', range))).toEqual(
      map(pixels(grid), (x, y) => [x, H - 1 - y]),
    );
  });

  it('clipGrid keeps only pixels inside the canvas and shares untouched tiles', () => {
    const grid = pattern(600, 400, true);
    const clipped = clipGrid(grid, 300, 260);
    expect(pixels(clipped)).toEqual(
      new Set(
        [...pixels(grid)].filter((s) => {
          const [x, y] = s.split(':')[0]!.split(',').map(Number) as [number, number];
          return x >= 0 && y >= 0 && x < 300 && y < 260;
        }),
      ),
    );
    expect(clipped.get('0,0')).toBe(grid.get('0,0'));
  });
});
