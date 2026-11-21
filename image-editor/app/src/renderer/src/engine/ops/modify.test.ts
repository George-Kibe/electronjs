import { describe, expect, it } from 'vitest';
import { Mask, rectMask, type Bounds } from '../doc/selection';
import { tileKey } from '../tiles/tile';
import { modifySelection, type ModifyOp } from './modify';

const W = 300;
const H = 200;

function apply(m: Mask, op: ModifyOp): Mask {
  const clip = m.toClip()!;
  const tiles = modifySelection(clip.tiles, clip.bounds, { width: W, height: H }, op);
  return Mask.fromTiles(
    new Map(tiles.map(([k, d]) => [k, { data: new Uint8ClampedArray(d), full: false }])),
    W,
    H,
  );
}

function area(m: Mask): number {
  let s = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) s += m.value(x, y);
  return s / 255;
}

const box: Bounds = { x0: 100, y0: 60, x1: 200, y1: 140 };
const rect = () => rectMask(box, W, H);

describe('Select › Modify (FR-SEL-05)', () => {
  it('expand grows by the distance, rounding the corners', () => {
    const m = apply(rect(), { kind: 'expand', by: 10 });
    expect(m.bounds()).toEqual({ x0: 90, y0: 50, x1: 210, y1: 150 });
    expect(m.value(95, 100)).toBe(255); // 5 px out from the left edge
    expect(m.value(91, 51)).toBe(0); // the corner is round, not square
    const exact = 100 * 80 + 2 * 10 * (100 + 80) + Math.PI * 100;
    expect(Math.abs(area(m) - exact) / exact).toBeLessThan(0.01);
  });

  it('contract shrinks by the distance, also from the canvas edge', () => {
    expect(apply(rect(), { kind: 'contract', by: 10 }).bounds()).toEqual({
      x0: 110,
      y0: 70,
      x1: 190,
      y1: 130,
    });
    expect(apply(Mask.all(W, H), { kind: 'contract', by: 5 }).bounds()).toEqual({
      x0: 5,
      y0: 5,
      x1: 295,
      y1: 195,
    });
    expect(apply(rect(), { kind: 'contract', by: 50 }).isEmpty).toBe(true);
  });

  it('feather softens the edge but keeps the area', () => {
    const m = apply(rect(), { kind: 'feather', radius: 8 });
    expect(m.value(150, 100)).toBe(255); // centre stays selected
    const edge = m.value(100, 100); // the old edge: about half
    expect(edge).toBeGreaterThan(100);
    expect(edge).toBeLessThan(155);
    expect(m.value(92, 100)).toBeGreaterThan(0); // spills outside
    expect(Math.abs(area(m) - 8000) / 8000).toBeLessThan(0.01);
  });

  it('border is a band around the old edge', () => {
    const m = apply(rect(), { kind: 'border', width: 10 });
    expect(m.value(150, 100)).toBe(0); // the inside is gone
    expect(m.value(100, 100)).toBe(255); // on the edge
    expect(m.value(150, 60)).toBe(255);
    expect(m.value(80, 100)).toBe(0);
    expect(m.bounds()!.x0).toBeGreaterThanOrEqual(92);
  });

  it('smooth removes specks and fills pinholes', () => {
    const specks = rect()
      .combine('add', rectMask({ x0: 20, y0: 20, x1: 22, y1: 22 }, W, H)) // a 2 px speck
      .combine('subtract', rectMask({ x0: 150, y0: 100, x1: 151, y1: 101 }, W, H)); // a pinhole
    const m = apply(specks, { kind: 'smooth', radius: 2 });
    expect(m.value(21, 21)).toBe(0);
    expect(m.value(150, 100)).toBe(255);
    expect(m.value(120, 100)).toBe(255);
  });

  it('only touches tiles near the selection', () => {
    const tiles = modifySelection(
      rect().toClip()!.tiles,
      box,
      { width: 3000, height: 2000 },
      { kind: 'expand', by: 4 },
    );
    expect(tiles.map(([k]) => k).sort()).toEqual([tileKey(0, 0)]);
  });
});
