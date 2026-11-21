import { describe, expect, it } from 'vitest';
import { Mask, maskTile, rectMask } from '../doc/selection';
import { TILE_SIZE } from '../tiles/tile';
import { applySelectionStroke } from './brush';

describe('Quick Mask strokes (FR-SEL-06)', () => {
  const coverage = (x0: number, x1: number, a = 1) => {
    const c = new Float32Array(TILE_SIZE * TILE_SIZE);
    for (let y = 0; y < 256; y++) for (let x = x0; x < x1; x++) c[y * 256 + x] = a;
    return c;
  };

  it('moves coverage toward the painted grey, from a stored or uniform tile', () => {
    const fromNothing = applySelectionStroke(null, 0, coverage(10, 20), 255, { opacity: 1, aliased: true });
    expect([fromNothing[5 * 256 + 15], fromNothing[5 * 256 + 30]]).toEqual([255, 0]);
    const fromAll = applySelectionStroke(null, 255, coverage(10, 20, 0.5), 0, { opacity: 1, aliased: true });
    expect([fromAll[5 * 256 + 15], fromAll[5 * 256 + 30]]).toEqual([128, 255]); // half way to black
    const stored = new Uint8ClampedArray(256 * 256).fill(100);
    const out = applySelectionStroke(stored, 0, coverage(0, 256), 200, { opacity: 0.5, aliased: true });
    expect(out[0]).toBe(150);
    expect(stored[0]).toBe(100); // the input is not changed
  });

  it('replaces only the painted tiles of an immutable selection', () => {
    const sel = rectMask({ x0: 0, y0: 0, x1: 512, y1: 256 }, 600, 300);
    const painted = sel.withTiles(
      new Map([
        ['1,0', undefined],
        ['0,1', maskTile(new Uint8ClampedArray(256 * 256).fill(255))],
      ]),
    );
    expect(painted.value(300, 10)).toBe(0); // removed
    expect(painted.value(10, 270)).toBe(255); // added
    expect(painted.tile('0,1')?.full).toBe(false); // an edge tile: clipped to the canvas, so not shared
    expect(sel.value(300, 10)).toBe(255); // the original selection is unchanged
    expect(Mask.empty(10, 10).withTiles(new Map()).isEmpty).toBe(true);
  });
});
