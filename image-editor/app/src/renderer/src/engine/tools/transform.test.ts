import { describe, expect, it } from 'vitest';
import { apply } from '../ops/affine';
import {
  dragTransform,
  hitTransform,
  NO_TRANSFORM,
  transformCursor,
  transformedHandles,
  transformMatrix,
  type Box,
} from './transform';

const box: Box = { x0: 100, y0: 50, x1: 300, y1: 150 };
const close = (a: [number, number], b: [number, number]) => {
  expect(a[0]).toBeCloseTo(b[0], 6);
  expect(a[1]).toBeCloseTo(b[1], 6);
};

describe('Free Transform geometry (FR-TRF-04)', () => {
  it('no transform is the identity; parameters act about the centre', () => {
    close(apply(transformMatrix(box, NO_TRANSFORM), 123, 77), [123, 77]);
    const half = transformMatrix(box, { ...NO_TRANSFORM, sx: 0.5, sy: 0.5 });
    close(apply(half, 200, 100), [200, 100]); // the centre stays
    close(apply(half, 100, 50), [150, 75]);
    const quarter = transformMatrix(box, { ...NO_TRANSFORM, angle: Math.PI / 2 });
    close(apply(quarter, 300, 100), [200, 200]); // right-middle → below the centre (clockwise)
  });

  it('hit-tests handles, the inside and the outside', () => {
    expect(hitTransform(box, NO_TRANSFORM, [101, 51], 6)).toBe('nw');
    expect(hitTransform(box, NO_TRANSFORM, [200, 150], 6)).toBe('s');
    expect(hitTransform(box, NO_TRANSFORM, [200, 100], 6)).toBe('move');
    expect(hitTransform(box, NO_TRANSFORM, [20, 20], 6)).toBe('rotate');
  });

  it('moves in whole pixels, constrained with Shift', () => {
    const p = dragTransform(box, NO_TRANSFORM, 'move', [200, 100], [212.4, 103.7], {
      shift: false,
      ctrl: false,
    });
    expect([p.tx, p.ty]).toEqual([12, 4]);
    const q = dragTransform(box, NO_TRANSFORM, 'move', [200, 100], [212, 103], { shift: true, ctrl: false });
    expect([q.tx, q.ty]).toEqual([12, 0]);
  });

  it('scales from a corner with the opposite corner fixed, proportionally unless Shift is held', () => {
    const p = dragTransform(box, NO_TRANSFORM, 'se', [300, 150], [400, 200], { shift: true, ctrl: false });
    expect([p.sx, p.sy]).toEqual([1.5, 1.5]);
    const h = transformedHandles(box, p);
    close(h.nw, [100, 50]);
    close(h.se, [400, 200]);
    const q = dragTransform(box, NO_TRANSFORM, 'e', [300, 100], [500, 140], { shift: false, ctrl: false });
    expect([q.sx, q.sy]).toEqual([2, 1]); // an edge scales one axis
    close(transformedHandles(box, q).w, [100, 100]);
    const r = dragTransform(box, NO_TRANSFORM, 'se', [300, 150], [500, 160], { shift: false, ctrl: false });
    expect(r.sx).toBeCloseTo(2, 9);
    expect(r.sy).toBeCloseTo(2, 9);
    const free = dragTransform(box, NO_TRANSFORM, 'se', [300, 150], [500, 160], { shift: true, ctrl: false });
    expect([free.sx, free.sy]).toEqual([2, 1.1]);
  });

  it('scales about the centre with Alt', () => {
    const p = dragTransform(box, NO_TRANSFORM, 'e', [300, 100], [400, 100], {
      shift: false,
      ctrl: false,
      alt: true,
    });
    expect([p.sx, p.sy]).toEqual([2, 1]);
    const h = transformedHandles(box, p);
    close(h.w, [0, 100]); // the centre (200, 100) stays; both edges move
    close(h.e, [400, 100]);
  });

  it('scales correctly when already rotated', () => {
    const rotated = { ...NO_TRANSFORM, angle: Math.PI / 6 };
    const start = transformedHandles(box, rotated);
    const target: [number, number] = [start.se[0] + 30, start.se[1] + 40];
    const p = dragTransform(box, rotated, 'se', start.se, target, { shift: true, ctrl: false });
    const after = transformedHandles(box, p);
    close(after.nw, start.nw); // anchor fixed
    close(after.se, target); // the handle follows the pointer
  });

  it('rotates about the centre, in 15° steps with Shift', () => {
    const p = dragTransform(box, NO_TRANSFORM, 'rotate', [300, 100], [200, 200], {
      shift: false,
      ctrl: false,
    });
    expect(p.angle).toBeCloseTo(Math.PI / 2, 9);
    const q = dragTransform(box, NO_TRANSFORM, 'rotate', [300, 100], [290, 110], {
      shift: true,
      ctrl: false,
    });
    expect((q.angle / (Math.PI / 12)) % 1).toBeCloseTo(0, 9);
  });

  it('picks resize cursors that follow the rotation', () => {
    expect(transformCursor(box, NO_TRANSFORM, 'e')).toBe('ew-resize');
    expect(transformCursor(box, NO_TRANSFORM, 'n')).toBe('ns-resize');
    expect(transformCursor(box, NO_TRANSFORM, 'move')).toBe('move');
    expect(transformCursor(box, { ...NO_TRANSFORM, angle: Math.PI / 2, tx: 40 }, 'e')).toBe('ns-resize');
    expect(transformCursor(box, NO_TRANSFORM, 'rotate')).toMatch(/^url\("data:image\/svg\+xml,/);
  });

  it('skews with Ctrl on an edge', () => {
    const p = dragTransform(box, NO_TRANSFORM, 's', [200, 150], [250, 150], { shift: false, ctrl: true });
    expect(p.skewX).toBeCloseTo(Math.atan2(50, 50), 6);
    expect(p.sx).toBe(1);
  });
});
