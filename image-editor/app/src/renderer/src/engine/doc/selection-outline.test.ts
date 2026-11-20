import { describe, expect, it } from 'vitest';
import { selectionOutline } from './selection-outline';
import { ellipseMask, Mask, rectMask } from './selection';

/** Total length of the outline's segments. */
function length(path: string): number {
  let total = 0;
  for (const m of path.matchAll(/M(-?\d+) (-?\d+)([HV])(-?\d+)/g)) {
    const [, x, y, dir, to] = m;
    total += Math.abs(Number(to) - Number(dir === 'H' ? x : y));
  }
  return total;
}

describe('selectionOutline (marching ants, FR-SEL-06)', () => {
  it('a rectangle is its four sides', () => {
    const path = selectionOutline(rectMask({ x0: 10, y0: 20, x1: 40, y1: 30 }, 64, 64));
    expect(path).toBe('M10 20H40M10 30H40M10 20V30M40 20V30'); // top, bottom, then the sides
  });

  it('a hole adds an inner outline', () => {
    const ring = rectMask({ x0: 0, y0: 0, x1: 300, y1: 300 }, 300, 300).combine(
      'subtract',
      rectMask({ x0: 100, y0: 100, x1: 200, y1: 200 }, 300, 300),
    );
    expect(length(selectionOutline(ring))).toBe(4 * 300 + 4 * 100);
  });

  it('crosses tile boundaries and full tiles without seams', () => {
    // 600 × 600 spans 3 × 3 tiles, the centre one full: only the outer edge is drawn.
    expect(length(selectionOutline(Mask.all(600, 600)))).toBe(4 * 600);
  });

  it('follows soft edges at half coverage', () => {
    const e = ellipseMask({ x0: 0, y0: 0, x1: 200, y1: 200 }, 256, 256);
    const len = length(selectionOutline(e));
    // A circle drawn along pixel edges is a staircase: its length is the box perimeter, 8r.
    expect(Math.abs(len - 800)).toBeLessThanOrEqual(8);
  });

  it('is empty without a selection, and fast on a large image', () => {
    expect(selectionOutline(Mask.empty(100, 100))).toBe('');
    const start = performance.now();
    selectionOutline(Mask.all(6000, 4000));
    expect(performance.now() - start).toBeLessThan(1500);
  });
});
