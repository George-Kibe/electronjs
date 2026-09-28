import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createTile, TILE_BYTES, TILE_SIZE } from '../tiles/tile';
import { accumulateDabs, applyStroke, dabCoverage, DabGenerator, DEFAULT_BRUSH } from './brush';

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
