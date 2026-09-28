import { describe, expect, it } from 'vitest';
import { createTile, parseTileKey, TILE_BYTES, TILE_SIZE, TileGrid, tileKey, tileKeysInRect } from './tile';

describe('tiles', () => {
  it('creates immutable tiles with unique ids', () => {
    const a = createTile(new Uint8ClampedArray(TILE_BYTES));
    const b = createTile(new Uint8ClampedArray(TILE_BYTES));
    expect(a.id).not.toBe(b.id);
    expect(Object.isFrozen(a)).toBe(true);
    expect(() => createTile(new Uint8ClampedArray(10))).toThrow(RangeError);
  });

  it('computes keys covering a rectangle', () => {
    expect(tileKeysInRect(0, 0, 256, 256)).toEqual(['0,0']);
    expect(tileKeysInRect(255, 0, 257, 1)).toEqual(['0,0', '1,0']);
    expect(tileKeysInRect(-1, -1, 1, 1)).toEqual(['-1,-1', '0,-1', '-1,0', '0,0']);
    expect(parseTileKey(tileKey(3, -2))).toEqual([3, -2]);
  });

  it('round-trips an RGBA buffer that is not a multiple of the tile size, skipping empty tiles', () => {
    const w = 300;
    const h = 260;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const set = (x: number, y: number, v: [number, number, number, number]) => rgba.set(v, (y * w + x) * 4);
    set(0, 0, [255, 0, 0, 255]);
    set(299, 259, [1, 2, 3, 4]);
    const grid = TileGrid.fromRgba(w, h, rgba);
    expect([...grid.keys()].sort()).toEqual(['0,0', '1,1']);
    expect(grid.pixel(0, 0)).toEqual([255, 0, 0, 255]);
    expect(grid.pixel(299, 259)).toEqual([1, 2, 3, 4]);
    expect(grid.pixel(100, 100)).toEqual([0, 0, 0, 0]);
    expect(grid.pixel(TILE_SIZE + 5, 5)).toEqual([0, 0, 0, 0]);
  });

  it('fills only the document area', () => {
    const grid = TileGrid.filled(300, 10, [255, 255, 255, 255]);
    expect(grid.size).toBe(2);
    expect(grid.pixel(299, 9)).toEqual([255, 255, 255, 255]);
    expect(grid.get('1,0')!.data[(0 * TILE_SIZE + 44) * 4 + 3]).toBe(0); // x = 300 is outside
    expect(TileGrid.filled(10, 10, [0, 0, 0, 0]).size).toBe(0);
  });
});
