import { describe, expect, it } from 'vitest';
import { tileKey } from '../tiles/tile';
import {
  clipToSelection,
  ellipseMask,
  FULL_TILE,
  Mask,
  polygonMask,
  rectMask,
  type Point,
} from './selection';

/** Selected area in pixels (coverage / 255 summed over the canvas). */
function area(m: Mask): number {
  let sum = 0;
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) sum += m.value(x, y);
  return sum / 255;
}

function same(a: Mask, b: Mask): boolean {
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) if (a.value(x, y) !== b.value(x, y)) return false;
  return true;
}

describe('rectMask and Select All', () => {
  it('selects exactly the pixel rectangle, with shared full tiles inside', () => {
    const m = rectMask({ x0: 10, y0: 20, x1: 600, y1: 530 }, 800, 600);
    expect(m.value(10, 20)).toBe(255);
    expect(m.value(599, 529)).toBe(255);
    expect(m.value(9, 20)).toBe(0);
    expect(m.value(600, 100)).toBe(0);
    expect(m.value(100, 530)).toBe(0);
    expect(m.tile(tileKey(1, 1))).toBe(FULL_TILE);
    expect(m.bounds()).toEqual({ x0: 10, y0: 20, x1: 600, y1: 530 });
    expect(area(m)).toBe(590 * 510);
  });

  it('normalises a rectangle dragged up-left and clips it to the canvas', () => {
    const m = rectMask({ x0: 120, y0: 90, x1: -50, y1: -40 }, 100, 80);
    expect(m.bounds()).toEqual({ x0: 0, y0: 0, x1: 100, y1: 80 });
    expect(rectMask({ x0: 5, y0: 5, x1: 5, y1: 50 }, 100, 80).isEmpty).toBe(true);
  });

  it('Select All covers the canvas only, never the off-canvas part of edge tiles', () => {
    const m = Mask.all(300, 300);
    expect(m.value(299, 299)).toBe(255);
    expect(m.tile(tileKey(1, 1))!.full).toBe(false);
    expect(m.tile(tileKey(1, 1))!.data[50 * 256 + 50]).toBe(0); // pixel (306, 306), outside the canvas
    expect(m.tile(tileKey(0, 0))).toBe(FULL_TILE);
    expect(m.sizeBytes()).toBe(3 * 256 * 256); // three partial edge tiles; the full one is shared
  });
});

describe('polygonMask (lasso)', () => {
  it('a pixel-aligned square equals the rectangle exactly', () => {
    const sq: Point[] = [
      [10, 10],
      [50, 10],
      [50, 40],
      [10, 40],
    ];
    expect(same(polygonMask(sq, 64, 64), rectMask({ x0: 10, y0: 10, x1: 50, y1: 40 }, 64, 64))).toBe(true);
  });

  it('anti-aliased coverage matches the true area', () => {
    const tri: Point[] = [
      [3.3, 2.7],
      [57.1, 9.4],
      [21.8, 60.2],
    ];
    const exact = Math.abs((57.1 - 3.3) * (60.2 - 2.7) - (21.8 - 3.3) * (9.4 - 2.7)) / 2;
    expect(Math.abs(area(polygonMask(tri, 64, 64)) - exact) / exact).toBeLessThan(0.005);
    // Edge pixels are partly selected.
    const m = polygonMask(tri, 64, 64);
    const values = new Set<number>();
    for (let x = 0; x < 64; x++) values.add(m.value(x, 30));
    expect([...values].some((v) => v > 0 && v < 255)).toBe(true);
  });

  it('without anti-aliasing a pixel is in when its centre is', () => {
    const m = polygonMask(
      [
        [0.2, 0.2],
        [4.4, 0.2],
        [4.4, 3.6],
        [0.2, 3.6],
      ],
      8,
      8,
      false,
    );
    expect([0, 1, 2, 3, 4].map((x) => m.value(x, 1))).toEqual([255, 255, 255, 255, 0]);
    expect([0, 1, 2, 3, 4].map((y) => m.value(1, y))).toEqual([255, 255, 255, 255, 0]); // 3.5 < 3.6
  });

  it('uses the even-odd rule: a loop inside a loop leaves a hole', () => {
    const outer: Point[] = [
      [0, 0],
      [40, 0],
      [40, 40],
      [0, 40],
    ];
    const inner: Point[] = [
      [10, 10],
      [30, 10],
      [30, 30],
      [10, 30],
    ];
    // One closed path: outer, a bridge in, the inner loop, back out.
    const m = polygonMask([...outer, [0, 0], ...inner, [10, 10], [0, 0]], 48, 48);
    expect(m.value(5, 5)).toBe(255);
    expect(m.value(20, 20)).toBe(0);
  });

  it('handles shapes partly outside the canvas and degenerate input', () => {
    const m = polygonMask(
      [
        [-20, -20],
        [30, -20],
        [30, 30],
        [-20, 30],
      ],
      64,
      64,
    );
    expect(m.bounds()).toEqual({ x0: 0, y0: 0, x1: 30, y1: 30 });
    expect(
      polygonMask(
        [
          [1, 1],
          [5, 5],
        ],
        8,
        8,
      ).isEmpty,
    ).toBe(true);
    expect(
      polygonMask(
        [
          [100, 100],
          [120, 100],
          [120, 120],
        ],
        8,
        8,
      ).isEmpty,
    ).toBe(true);
  });
});

describe('ellipseMask (elliptical marquee)', () => {
  it('has the area of the inscribed ellipse and stays inside its box', () => {
    const m = ellipseMask({ x0: 10, y0: 20, x1: 210, y1: 120 }, 256, 160);
    const exact = Math.PI * 100 * 50;
    expect(Math.abs(area(m) - exact) / exact).toBeLessThan(0.002);
    expect(m.bounds()).toEqual({ x0: 10, y0: 20, x1: 210, y1: 120 });
    expect(m.value(110, 70)).toBe(255);
    expect(m.value(11, 21)).toBe(0); // corner of the box
  });

  it('is empty when too thin', () => {
    expect(ellipseMask({ x0: 5, y0: 5, x1: 5.5, y1: 40 }, 64, 64).isEmpty).toBe(true);
  });
});

describe('selection modes (FR-SEL-04)', () => {
  const W = 300;
  const H = 300;
  const a = rectMask({ x0: 0, y0: 0, x1: 200, y1: 200 }, W, H);
  const b = rectMask({ x0: 100, y0: 100, x1: 300, y1: 300 }, W, H);

  it('add, subtract and intersect hard shapes', () => {
    expect(area(a.combine('add', b))).toBe(200 * 200 * 2 - 100 * 100);
    expect(area(a.combine('subtract', b))).toBe(200 * 200 - 100 * 100);
    expect(area(a.combine('intersect', b))).toBe(100 * 100);
    expect(a.combine('replace', b)).toBe(b);
    expect(a.combine('subtract', a).isEmpty).toBe(true);
    expect(a.combine('intersect', Mask.empty(W, H)).isEmpty).toBe(true);
    expect(Mask.empty(W, H).combine('add', b)).toEqual(b.combine('add', Mask.empty(W, H)));
  });

  it('combines soft edges like coverage', () => {
    const soft = ellipseMask({ x0: 50.5, y0: 50.5, x1: 250.5, y1: 250.5 }, W, H);
    const edge = { x: 50, y: 150 }; // the rim crosses this pixel at x = 50.5
    const s = soft.value(edge.x, edge.y);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(255);
    expect(a.combine('add', soft).value(edge.x, edge.y)).toBe(255); // inside a
    expect(a.combine('intersect', soft).value(edge.x, edge.y)).toBe(s);
    expect(a.combine('subtract', soft).value(edge.x, edge.y)).toBe(255 - s);
  });

  it('inverse covers the rest of the canvas and undoes itself', () => {
    const inv = a.invert();
    expect(area(inv)).toBe(W * H - 200 * 200);
    expect(same(inv.invert(), a)).toBe(true);
    expect(same(Mask.empty(W, H).invert(), Mask.all(W, H))).toBe(true);
    expect(Mask.all(W, H).invert().isEmpty).toBe(true);
    const soft = ellipseMask({ x0: 10, y0: 10, x1: 290, y1: 200 }, W, H);
    expect(same(soft.invert().invert(), soft)).toBe(true);
  });
});

describe('clipToSelection (copy and cut of a selection, FR-DOC-12)', () => {
  it('crops to the bounds and keeps alpha only where selected', () => {
    const W = 300;
    const H = 200;
    const rgba = new Uint8ClampedArray(W * H * 4).fill(200); // alpha 200 everywhere
    const sel = rectMask({ x0: 10, y0: 20, x1: 280, y1: 120 }, W, H).combine(
      'subtract',
      rectMask({ x0: 100, y0: 50, x1: 120, y1: 70 }, W, H),
    );
    const out = clipToSelection(rgba, W, sel.toClip()!);
    expect([out.width, out.height]).toEqual([270, 100]);
    expect(out.rgba[(5 * 270 + 5) * 4 + 3]).toBe(200); // selected: alpha kept
    expect(out.rgba[((50 - 20) * 270 + (105 - 10)) * 4 + 3]).toBe(0); // the hole: transparent
    expect(out.rgba[((50 - 20) * 270 + (105 - 10)) * 4]).toBe(200); // colour kept (straight alpha)
  });

  it('scales alpha by soft coverage', () => {
    const W = 64;
    const rgba = new Uint8ClampedArray(W * W * 4).fill(255);
    const sel = ellipseMask({ x0: 4.5, y0: 4.5, x1: 60.5, y1: 60.5 }, W, W);
    const out = clipToSelection(rgba, W, sel.toClip()!);
    const b = sel.bounds()!;
    const x = 4; // the anti-aliased left rim at y = 32
    expect(out.rgba[((32 - b.y0) * out.width + (x - b.x0)) * 4 + 3]).toBe(sel.value(x, 32));
    expect(Mask.empty(W, W).toClip()).toBeNull();
  });
});
