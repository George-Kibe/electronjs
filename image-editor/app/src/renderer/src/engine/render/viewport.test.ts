import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, nextZoomStep, scrollGeometry, Viewport } from './viewport';

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

describe('zoom steps (FR-NAV-01)', () => {
  it('steps through the presets and snaps from in-between zooms', () => {
    expect(nextZoomStep(1, 1)).toBe(2);
    expect(nextZoomStep(1, -1)).toBe(0.6667);
    expect(nextZoomStep(0.7, -1)).toBe(0.6667);
    expect(nextZoomStep(0.7, 1)).toBe(1);
    expect(nextZoomStep(64, 1)).toBe(64);
    expect(nextZoomStep(0.01, -1)).toBe(0.01);
  });
});

describe('scrollGeometry (FR-NAV-02)', () => {
  it('maps the view onto the document plus half a view of margin each side', () => {
    // 1000 px document in a 400 px view, document left edge at the view centre: scrolled to the start.
    expect(scrollGeometry(1000, 200, 400)).toMatchObject({
      total: 1400,
      offset: 0,
      start: 0,
      thumb: 400 / 1400,
    });
    // Right edge at the view centre: scrolled to the end.
    const end = scrollGeometry(1000, 200 - 1000, 400);
    expect(end.offset).toBe(1000);
    expect(end.start + end.thumb).toBeCloseTo(1);
    // Panned beyond the range: clamped.
    expect(scrollGeometry(1000, 900, 400).offset).toBe(0);
  });
});
