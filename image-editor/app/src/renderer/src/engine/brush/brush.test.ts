import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createTile, TILE_BYTES, TILE_SIZE } from '../tiles/tile';
import {
  accumulateDabs,
  applyStroke,
  dabCoverage,
  DabGenerator,
  DEFAULT_BRUSH,
  PulledString,
  type BrushPoint,
} from './brush';
import { BRUSH_TIPS, GRAIN_SIZE, tipGrain } from './tips';

const bounds = { tileX: 0, tileY: 0, docWidth: 1000, docHeight: 1000 };

describe('dabCoverage', () => {
  it('is 1 inside, 0 outside and monotonic in between', () => {
    expect(dabCoverage(0, 10, 0.5)).toBe(1);
    expect(dabCoverage(10, 10, 0.5)).toBe(0);
    let last = 1;
    for (let d = 0; d <= 10; d += 0.25) {
      const c = dabCoverage(d, 10, 0.5);
      expect(c).toBeLessThanOrEqual(last);
      last = c;
    }
  });

  it('keeps a thin anti-aliased edge for hard brushes', () => {
    expect(dabCoverage(9.4, 10, 1)).toBe(1);
    expect(dabCoverage(9.75, 10, 1)).toBeGreaterThan(0);
    expect(dabCoverage(9.75, 10, 1)).toBeLessThan(1);
  });
});

describe('DabGenerator', () => {
  const settings = { ...DEFAULT_BRUSH, size: 20, spacing: 0.25, pressureSize: false }; // 5 px spacing

  it('spaces dabs evenly along a line', () => {
    const gen = new DabGenerator(settings);
    const dabs = [...gen.begin({ x: 0, y: 0, pressure: 1 }), ...gen.moveTo({ x: 50, y: 0, pressure: 1 })];
    expect(dabs.map((d) => d.x)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
  });

  it('property: spacing does not depend on how the pointer path is split into events', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.1, max: 30, noNaN: true }), { minLength: 1, maxLength: 30 }),
        (steps) => {
          const whole = new DabGenerator(settings);
          const split = new DabGenerator(settings);
          const end = steps.reduce((a, b) => a + b, 0);
          const a = [
            ...whole.begin({ x: 0, y: 0, pressure: 1 }),
            ...whole.moveTo({ x: end, y: 0, pressure: 1 }),
          ];
          const b = [...split.begin({ x: 0, y: 0, pressure: 1 })];
          let x = 0;
          for (const s of steps) b.push(...split.moveTo({ x: (x += s), y: 0, pressure: 1 }));
          expect(b.map((d) => d.x)).toHaveLength(a.length);
          b.forEach((d, i) => expect(d.x).toBeCloseTo(a[i]!.x, 6));
        },
      ),
    );
  });

  it('scales the dab with pen pressure', () => {
    const gen = new DabGenerator({ ...settings, pressureSize: true });
    expect(gen.begin({ x: 0, y: 0, pressure: 0.5 })[0]!.radius).toBe(5);
  });
});

describe('accumulateDabs + applyStroke (CPU reference)', () => {
  it('paints opaque colour where coverage is full and leaves other pixels byte-identical', () => {
    const cov = new Float32Array(TILE_SIZE * TILE_SIZE);
    accumulateDabs(cov, 0, 0, [{ x: 50, y: 50, radius: 10, alpha: 1 }], 1);
    const base = new Uint8ClampedArray(TILE_BYTES);
    for (let i = 0; i < base.length; i += 4) base.set([10, 20, 30, 7], i); // low-alpha pixels must survive exactly
    const before = createTile(base);
    const after = applyStroke(before, cov, { color: [255, 0, 0], opacity: 1, mode: 'paint' }, bounds)!;
    const px = (x: number, y: number) => [
      ...after.data.subarray((y * TILE_SIZE + x) * 4, (y * TILE_SIZE + x) * 4 + 4),
    ];
    expect(px(50, 50)).toEqual([255, 0, 0, 255]);
    expect(px(100, 100)).toEqual([10, 20, 30, 7]);
    expect(after).not.toBe(before);
  });

  it('flow accumulates, opacity caps the stroke', () => {
    const cov = new Float32Array(TILE_SIZE * TILE_SIZE);
    const dab = { x: 10, y: 10, radius: 5, alpha: 0.5 };
    accumulateDabs(cov, 0, 0, [dab, dab], 1);
    expect(cov[10 * TILE_SIZE + 10]).toBeCloseTo(0.75);
    const after = applyStroke(undefined, cov, { color: [0, 0, 255], opacity: 0.5, mode: 'paint' }, bounds)!;
    expect(after.data[(10 * TILE_SIZE + 10) * 4 + 3]).toBe(Math.round(0.375 * 255));
  });

  it('erases to transparency and returns undefined for an empty tile', () => {
    const cov = new Float32Array(TILE_SIZE * TILE_SIZE).fill(1);
    const full = createTile(new Uint8ClampedArray(TILE_BYTES).fill(255));
    expect(applyStroke(full, cov, { color: [0, 0, 0], opacity: 1, mode: 'erase' }, bounds)).toBeUndefined();
  });

  it('never paints outside the document', () => {
    const cov = new Float32Array(TILE_SIZE * TILE_SIZE).fill(1);
    const after = applyStroke(
      undefined,
      cov,
      { color: [0, 0, 0], opacity: 1, mode: 'paint' },
      {
        tileX: 0,
        tileY: 0,
        docWidth: 100,
        docHeight: 50,
      },
    )!;
    expect(after.data[(10 * TILE_SIZE + 99) * 4 + 3]).toBe(255);
    expect(after.data[(10 * TILE_SIZE + 100) * 4 + 3]).toBe(0);
    expect(after.data[(50 * TILE_SIZE + 10) * 4 + 3]).toBe(0);
  });

  it('returns the same tile when the stroke does not touch it', () => {
    const before = createTile(new Uint8ClampedArray(TILE_BYTES));
    expect(
      applyStroke(
        before,
        new Float32Array(TILE_SIZE * TILE_SIZE),
        { color: [0, 0, 0], opacity: 1, mode: 'paint' },
        bounds,
      ),
    ).toBe(before);
  });
});

describe('pencil (FR-PNT-02)', () => {
  const pencil = { ...DEFAULT_BRUSH, aliased: true, pressureSize: false, spacing: 0.1 };

  const covered = (size: number, x: number, y: number) => {
    const gen = new DabGenerator({ ...pencil, size });
    const cov = new Float32Array(TILE_SIZE * TILE_SIZE);
    accumulateDabs(cov, 0, 0, gen.begin({ x, y, pressure: 1 }), 1, true);
    const out: string[] = [];
    cov.forEach((c, i) => {
      expect(c === 0 || c === 1).toBe(true); // aliased: no partial pixels
      if (c) out.push(`${i % TILE_SIZE},${Math.floor(i / TILE_SIZE)}`);
    });
    return out;
  };

  it('paints exactly one pixel at size 1, wherever the pointer is inside it', () => {
    expect(covered(1, 10.1, 20.9)).toEqual(['10,20']);
    expect(covered(1, 10.99, 20)).toEqual(['10,20']);
  });

  it('paints whole-pixel squares and discs at small sizes', () => {
    expect(covered(2, 10.4, 20.6)).toEqual(['9,20', '10,20', '9,21', '10,21']);
    expect(covered(3, 10.5, 20.5)).toHaveLength(9);
    expect(covered(5, 10.5, 20.5)).toHaveLength(21); // 5×5 minus the 4 corners
  });

  it('leaves no gaps along a 1-px diagonal line', () => {
    const gen = new DabGenerator({ ...pencil, size: 1 });
    const cov = new Float32Array(TILE_SIZE * TILE_SIZE);
    const dabs = [
      ...gen.begin({ x: 0.5, y: 0.5, pressure: 1 }),
      ...gen.moveTo({ x: 40.5, y: 20.5, pressure: 1 }),
    ];
    accumulateDabs(cov, 0, 0, dabs, 1, true);
    for (let x = 0; x <= 40; x++) {
      const column = [...Array(TILE_SIZE).keys()].filter((y) => cov[y * TILE_SIZE + x]);
      expect(column.length, `column ${x}`).toBeGreaterThan(0);
    }
  });
});

describe('pressure and smoothing (FR-PNT-01)', () => {
  it('scales dab strength with pressure when pressure → opacity is on', () => {
    const gen = new DabGenerator({ ...DEFAULT_BRUSH, flow: 0.8, pressureSize: false, pressureOpacity: true });
    expect(gen.begin({ x: 0, y: 0, pressure: 0.25 })[0]!.alpha).toBeCloseTo(0.2);
    const off = new DabGenerator({ ...DEFAULT_BRUSH, flow: 0.8, pressureOpacity: false });
    expect(off.begin({ x: 0, y: 0, pressure: 0.25 })[0]!.alpha).toBeCloseTo(0.8);
  });

  it('a pulled string stays put within its length, then trails the pointer at that distance', () => {
    const s = new PulledString(10);
    const p = (x: number, y = 0): BrushPoint => ({ x, y, pressure: 1 });
    s.begin(p(0));
    expect(s.move(p(6))).toBeNull();
    expect(s.move(p(25))).toEqual(p(15));
    expect(s.move(p(25, 30))!.x).toBeCloseTo(25 - 10 * (10 / Math.hypot(10, 30)));
  });

  it('property: the trailing brush is never more than the string length from the pointer', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.double({ min: -200, max: 200, noNaN: true }),
            fc.double({ min: -200, max: 200, noNaN: true }),
          ),
          {
            minLength: 1,
            maxLength: 40,
          },
        ),
        (pts) => {
          const s = new PulledString(12);
          let brush = s.begin({ x: 0, y: 0, pressure: 1 });
          for (const [x, y] of pts) {
            brush = s.move({ x, y, pressure: 1 }) ?? brush;
            expect(Math.hypot(x - brush.x, y - brush.y)).toBeLessThanOrEqual(12 + 1e-9);
          }
        },
      ),
    );
  });
});

describe('textured tips (FR-PNT-01)', () => {
  it('generates deterministic grain maps with real texture', () => {
    for (const tip of BRUSH_TIPS) {
      const grain = tipGrain(tip);
      if (tip === 'round') {
        expect(grain).toBeNull();
        continue;
      }
      expect(grain).toHaveLength(GRAIN_SIZE * GRAIN_SIZE);
      const holes = grain!.filter((v) => v === 0).length / grain!.length;
      const solid = grain!.filter((v) => v === 255).length / grain!.length;
      expect(holes, tip).toBeGreaterThan(0.05);
      expect(solid, tip).toBeGreaterThan(0.05);
    }
  });

  it('applyStroke multiplies coverage by the grain at document pixels (tileable across tiles)', () => {
    const grain = tipGrain('chalk')!;
    const cov = new Float32Array(TILE_SIZE * TILE_SIZE).fill(1);
    const settings = {
      color: [0, 0, 0] as [number, number, number],
      opacity: 1,
      mode: 'paint' as const,
      tip: 'chalk' as const,
    };
    const a = applyStroke(undefined, cov, settings, { ...bounds, tileX: 0 })!;
    const b = applyStroke(undefined, cov, settings, { tileX: 1, tileY: 0, docWidth: 1000, docHeight: 1000 })!;
    for (const [x, y] of [
      [0, 0],
      [5, 77],
      [130, 3],
      [255, 255],
    ] as const) {
      const g = grain[(y % GRAIN_SIZE) * GRAIN_SIZE + (x % GRAIN_SIZE)]!;
      expect(a.data[(y * TILE_SIZE + x) * 4 + 3]).toBe(g);
      expect(b.data[(y * TILE_SIZE + x) * 4 + 3]).toBe(g);
    }
  });
});
