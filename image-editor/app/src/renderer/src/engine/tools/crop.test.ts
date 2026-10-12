import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  clampRect,
  CROP_RATIOS,
  dragHandle,
  fitRatio,
  hitHandle,
  ratioValue,
  rectFromDrag,
  roundRect,
  straightenAngle,
  type Handle,
} from './crop';

const canvas = { width: 400, height: 300 };
const full = { x: 0, y: 0, width: 400, height: 300 };
const inside = (r: { x: number; y: number; width: number; height: number }) =>
  r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.width <= 400 + 1e-9 && r.y + r.height <= 300 + 1e-9;

describe('crop rectangle (FR-TRF-01)', () => {
  it('drags edges and corners freely, stopping at the canvas and at 1 px', () => {
    expect(dragHandle(full, 'e', -100, 0, null, canvas)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
    expect(dragHandle(full, 'nw', 50, 40, null, canvas)).toEqual({ x: 50, y: 40, width: 350, height: 260 });
    expect(dragHandle(full, 'w', -50, 0, null, canvas).x).toBe(0);
    expect(dragHandle(full, 'e', -1000, 0, null, canvas).width).toBe(1);
  });

  it('moves the box without leaving the canvas', () => {
    const r = { x: 100, y: 100, width: 100, height: 50 };
    expect(dragHandle(r, 'move', 500, -500, null, canvas)).toEqual({ x: 300, y: 0, width: 100, height: 50 });
  });

  it('property: with any ratio and any drag, the box keeps the ratio and stays inside the canvas', () => {
    const handles: Handle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'move'];
    fc.assert(
      fc.property(
        fc.constantFrom(...handles),
        fc.constantFrom(...CROP_RATIOS.filter((r) => r !== 'free')),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        (handle, preset, dx, dy) => {
          const ratio = ratioValue(preset, canvas)!;
          const start = fitRatio({ x: 50, y: 40, width: 200, height: 150 }, ratio, canvas);
          const r = dragHandle(start, handle, dx, dy, ratio, canvas);
          expect(inside(r)).toBe(true);
          expect(r.width / r.height).toBeCloseTo(ratio, 6);
        },
      ),
    );
  });

  it('fits a ratio inside the current box, centred', () => {
    expect(fitRatio(full, 1, canvas)).toEqual({ x: 50, y: 0, width: 300, height: 300 });
    expect(fitRatio(full, ratioValue('original', canvas), canvas)).toEqual(full);
    expect(fitRatio(full, ratioValue('16:9', canvas), canvas).height).toBeCloseTo(225);
  });

  it('drags out a new box in any direction', () => {
    expect(rectFromDrag({ x: 100, y: 100 }, { x: 50, y: 20 }, null, canvas)).toEqual({
      x: 50,
      y: 20,
      width: 50,
      height: 80,
    });
    const square = rectFromDrag({ x: 100, y: 100 }, { x: 200, y: 150 }, 1, canvas);
    expect(square.width).toBe(square.height);
  });

  it('hit-tests handles with a tolerance, and the inside as move', () => {
    const r = { x: 100, y: 100, width: 100, height: 100 };
    expect(hitHandle(r, { x: 101, y: 99 }, 4)).toBe('nw');
    expect(hitHandle(r, { x: 150, y: 203 }, 4)).toBe('s');
    expect(hitHandle(r, { x: 150, y: 150 }, 4)).toBe('move');
    expect(hitHandle(r, { x: 10, y: 10 }, 4)).toBeNull();
  });

  it('rounds and clamps to whole pixels', () => {
    expect(roundRect({ x: 10.4, y: -0.2, width: 50.3, height: 400 }, canvas)).toEqual({
      x: 10,
      y: 0,
      width: 51,
      height: 300,
    });
    expect(clampRect({ x: 390, y: 290, width: 50, height: 50 }, canvas)).toEqual({
      x: 350,
      y: 250,
      width: 50,
      height: 50,
    });
  });

  it('straighten levels a tilted horizon or a tilted vertical', () => {
    expect(straightenAngle({ x: 0, y: 0 }, { x: 100, y: 10 })).toBeCloseTo(-5.71, 2); // tilted down → rotate CCW
    expect(straightenAngle({ x: 0, y: 0 }, { x: 100, y: -10 })).toBeCloseTo(5.71, 2);
    expect(straightenAngle({ x: 0, y: 0 }, { x: 5, y: 100 })).toBeCloseTo(2.86, 2); // near-vertical line
  });
});
