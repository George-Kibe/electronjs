import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, Viewport } from './viewport';

describe('Viewport', () => {
  it('round-trips screen and document coordinates', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.05, max: 32, noNaN: true }),
        fc.integer({ min: -5000, max: 5000 }),
        (zoom, pan) => {
          const v = new Viewport();
          v.zoom = zoom;
          v.panX = pan;
          v.panY = -pan;
          const [sx, sy] = v.docToScreen(123.5, 456.25);
          const [x, y] = v.screenToDoc(sx, sy);
          expect(x).toBeCloseTo(123.5, 6);
          expect(y).toBeCloseTo(456.25, 6);
        },
      ),
    );
  });

  it('zooms around the cursor and clamps', () => {
    const v = new Viewport();
    v.panX = 10;
    v.panY = 20;
    const before = v.screenToDoc(300, 200);
    v.zoomAt(2, 300, 200);
    expect(v.screenToDoc(300, 200)[0]).toBeCloseTo(before[0]);
    expect(v.screenToDoc(300, 200)[1]).toBeCloseTo(before[1]);
    v.zoomAt(1e9, 0, 0);
    expect(v.zoom).toBe(MAX_ZOOM);
  });

  it('fits a large document and centres a small one at 100 %', () => {
    const v = new Viewport();
    v.fit(6000, 4000, 1248, 848);
    expect(v.zoom).toBeCloseTo(0.2);
    v.fit(100, 100, 1000, 800);
    expect(v.zoom).toBe(1);
    expect([v.panX, v.panY]).toEqual([450, 350]);
  });

  it('maps the document origin to the top-left corner in clip space', () => {
    const v = new Viewport();
    const m = v.docToClip(800, 600);
    const clip = (x: number, y: number) => [m[0]! * x + m[6]!, m[4]! * y + m[7]!];
    const close = ([x, y]: number[], [ex, ey]: [number, number]) => {
      expect(x).toBeCloseTo(ex, 5);
      expect(y).toBeCloseTo(ey, 5);
    };
    close(clip(0, 0), [-1, 1]);
    close(clip(800, 600), [1, -1]);
  });
});
