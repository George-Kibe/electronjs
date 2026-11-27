import { describe, expect, it } from 'vitest';
import { TILE_SIZE, TileGrid } from '../tiles/tile';
import { cloneTile } from './clone';

const W = 600;
const H = 300;

/** White, with a 20 px red square at (270..290, 100..120): inside tile 1,0. */
function image(): TileGrid {
  const rgba = new Uint8Array(W * H * 4).fill(255);
  for (let y = 100; y < 120; y++) for (let x = 270; x < 290; x++) rgba.set([255, 0, 0, 255], (y * W + x) * 4);
  return TileGrid.fromRgba(W, H, rgba);
}

const full = () => new Float32Array(TILE_SIZE * TILE_SIZE).fill(1);
const px = (t: { data: Uint8ClampedArray } | undefined, x: number, y: number) =>
  t ? [...t.data.subarray((y * TILE_SIZE + x) * 4, (y * TILE_SIZE + x) * 4 + 4)] : [0, 0, 0, 0];

describe('Clone Stamp (FR-PNT-05)', () => {
  const grid = image();
  const source = (k: string) => grid.get(k)?.data;
  const bounds = { tileX: 0, tileY: 0, docWidth: W, docHeight: H };

  it('copies the source pixels exactly, offset by whole pixels, across tile edges', () => {
    // Target (20, 100) takes source (280, 100): the square lands at x 10..30 of tile 0,0.
    const out = cloneTile(grid.get('0,0'), full(), source, { dx: 260, dy: 0 }, { opacity: 1 }, bounds);
    expect(px(out, 10, 100)).toEqual([255, 0, 0, 255]);
    expect(px(out, 29, 119)).toEqual([255, 0, 0, 255]);
    expect(px(out, 30, 100)).toEqual([255, 255, 255, 255]);
    expect(px(out, 9, 100)).toEqual([255, 255, 255, 255]);
  });

  it('blends by coverage × opacity, and leaves uncovered pixels as they were', () => {
    const cov = new Float32Array(TILE_SIZE * TILE_SIZE);
    cov[100 * TILE_SIZE + 15] = 1;
    cov[100 * TILE_SIZE + 16] = 0.5;
    const out = cloneTile(grid.get('0,0'), cov, source, { dx: 260, dy: 0 }, { opacity: 0.5 }, bounds);
    expect(px(out, 15, 100)).toEqual([255, 128, 128, 255]);
    expect(px(out, 16, 100)).toEqual([255, 191, 191, 255]);
    expect(px(out, 17, 100)).toEqual([255, 255, 255, 255]);
  });

  it('a source outside the canvas or transparent changes nothing', () => {
    const before = grid.get('0,0');
    expect(cloneTile(before, full(), source, { dx: -1000, dy: 0 }, { opacity: 1 }, bounds)).toBe(before);
    expect(cloneTile(before, full(), () => undefined, { dx: 5, dy: 5 }, { opacity: 1 }, bounds)).toBe(before);
  });

  it('onto transparency, and with transparency locked only existing pixels change', () => {
    const onto = cloneTile(undefined, full(), source, { dx: 260, dy: 0 }, { opacity: 1 }, bounds);
    expect(px(onto, 10, 100)).toEqual([255, 0, 0, 255]);
    expect(
      cloneTile(undefined, full(), source, { dx: 260, dy: 0 }, { opacity: 1 }, bounds, true),
    ).toBeUndefined();
    const half = new TileGrid();
    const data = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
    for (let i = 0; i < data.length; i += 4) data.set([0, 0, 255, 100], i);
    half.set('0,0', { id: -1, data });
    const locked = cloneTile(
      half.get('0,0'),
      full(),
      source,
      { dx: 260, dy: 0 },
      { opacity: 1 },
      bounds,
      true,
    );
    expect(px(locked, 10, 100)).toEqual([255, 0, 0, 100]);
  });
});
