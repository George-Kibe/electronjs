import { tileRange } from '@shared/iep-schema';
import { describe, expect, it } from 'vitest';
import { TileGrid } from '../tiles/tile';
import {
  axisWeights,
  inscribedSize,
  RESAMPLE_FILTERS,
  resampleGrid,
  rotateArbitraryGrid,
  rotatedCanvasSize,
} from './resample';

const solid = (w: number, h: number, rgba: [number, number, number, number]) => TileGrid.filled(w, h, rgba);

/** Straight RGBA of every canvas pixel, row-major. */
function read(grid: TileGrid, w: number, h: number): number[][] {
  const out: number[][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push(grid.pixel(x, y));
  return out;
}

describe('axisWeights', () => {
  it('normalises weights and keeps taps inside the source', () => {
    for (const f of RESAMPLE_FILTERS) {
      const w = axisWeights(0, 37, 0, 100, 0.37, f);
      for (let i = 0; i < 37; i++) {
        let sum = 0;
        for (let j = 0; j < w.count[i]!; j++) sum += w.weights[i * w.stride + j]!;
        expect(sum, f).toBeCloseTo(1, 5);
        expect(w.first[i]!).toBeGreaterThanOrEqual(0);
        expect(w.first[i]! + w.count[i]!).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('Image Size resampling (FR-TRF-02)', () => {
  it('keeps a solid opaque layer solid with no fringe at the canvas edges, for every filter', () => {
    for (const f of RESAMPLE_FILTERS) {
      for (const [w, h] of [
        [123, 77],
        [700, 530],
      ] as const) {
        const out = resampleGrid(
          solid(300, 200, [40, 120, 200, 255]),
          { width: 300, height: 200 },
          { width: w, height: h },
          f,
          tileRange(w, h),
        );
        const wrong = read(out, w, h).filter((px) => px.join() !== '40,120,200,255');
        expect(wrong.slice(0, 3), `${f} ${w}×${h}`).toEqual([]);
        // Nothing outside the new canvas.
        expect(out.pixel(w, 0)[3], f).toBe(0);
        expect(out.pixel(0, h)[3], f).toBe(0);
      }
    }
  });

  it('nearest neighbour at 2× duplicates pixels exactly', () => {
    const rgba = new Uint8Array(3 * 2 * 4);
    for (let i = 0; i < 6; i++) rgba.set([i * 40, 255 - i * 40, 7, 255], i * 4);
    const out = resampleGrid(
      TileGrid.fromRgba(3, 2, rgba),
      { width: 3, height: 2 },
      { width: 6, height: 4 },
      'nearest',
      tileRange(6, 4),
    );
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 6; x++)
        expect(out.pixel(x, y)).toEqual([
          ...rgba.subarray(((y >> 1) * 3 + (x >> 1)) * 4, ((y >> 1) * 3 + (x >> 1)) * 4 + 4),
        ]);
  });

  it('downscaling averages detail instead of aliasing (1-px stripes → mid grey)', () => {
    const w = 64;
    const rgba = new Uint8Array(w * w * 4);
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++) rgba.set(x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * w + x) * 4);
    for (const f of ['bilinear', 'bicubic', 'lanczos'] as const) {
      const out = resampleGrid(
        TileGrid.fromRgba(w, w, rgba),
        { width: w, height: w },
        { width: 16, height: 16 },
        f,
        tileRange(16, 16),
      );
      for (const [r] of read(out, 16, 16).slice(8 * 16 + 2, 8 * 16 + 14))
        expect(Math.abs(r! - 128), f).toBeLessThanOrEqual(3);
    }
  });

  it('does not bleed the colour of transparent pixels (premultiplied)', () => {
    const rgba = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < 64; i++) rgba.set(i % 8 < 4 ? [255, 0, 0, 255] : [0, 255, 0, 0], i * 4);
    const out = resampleGrid(
      TileGrid.fromRgba(8, 8, rgba),
      { width: 8, height: 8 },
      { width: 5, height: 5 },
      'bicubic',
      tileRange(5, 5),
    );
    for (const [r, g, , a] of read(out, 5, 5)) if (a! > 0) expect([r, g]).toEqual([255, 0]);
  });
});

describe('arbitrary rotation (FR-TRF-03)', () => {
  it('sizes the canvas to hold the rotated image', () => {
    expect(rotatedCanvasSize(300, 200, 90)).toEqual({ width: 200, height: 300 });
    expect(rotatedCanvasSize(300, 200, 0)).toEqual({ width: 300, height: 200 });
    expect(rotatedCanvasSize(100, 100, 45)).toEqual({ width: 142, height: 142 });
  });

  it('keeps the centre, makes the corners transparent, and the interior solid', () => {
    const dst = rotatedCanvasSize(200, 100, 30);
    const out = rotateArbitraryGrid(
      solid(200, 100, [10, 200, 30, 255]),
      { width: 200, height: 100 },
      dst,
      30,
      tileRange(dst.width, dst.height),
    );
    expect(out.pixel(Math.floor(dst.width / 2), Math.floor(dst.height / 2))).toEqual([10, 200, 30, 255]);
    expect(out.pixel(0, 0)[3]).toBe(0);
    expect(out.pixel(dst.width - 1, dst.height - 1)[3]).toBe(0);
  });

  it('rotating by 90° with bicubic equals the exact quarter turn', () => {
    const w = 40;
    const h = 24;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([(i * 13) % 256, (i * 7) % 256, i % 256, 255], i * 4);
    const out = rotateArbitraryGrid(
      TileGrid.fromRgba(w, h, rgba),
      { width: w, height: h },
      { width: h, height: w },
      90,
      tileRange(h, w),
    );
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const want = [...rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];
        const got = out.pixel(h - 1 - y, x);
        // Interior pixels are exact; the outermost ring blends with the transparent outside.
        if (x > 1 && y > 1 && x < w - 2 && y < h - 2) expect(got).toEqual(want);
      }
  });

  it('inscribed rectangle fits inside the rotated canvas', () => {
    expect(inscribedSize(300, 200, 0)).toEqual({ width: 300, height: 200 });
    const { width, height } = inscribedSize(300, 200, 10);
    expect(width).toBeLessThan(300);
    expect(height).toBeLessThan(200);
    // The corners of the inscribed rect, rotated back, lie inside the original 300×200 rectangle.
    const t = (10 * Math.PI) / 180;
    for (const [x, y] of [
      [width / 2, height / 2],
      [-width / 2, height / 2],
    ] as const) {
      const u = Math.abs(x * Math.cos(t) + y * Math.sin(t));
      const v = Math.abs(-x * Math.sin(t) + y * Math.cos(t));
      expect(u).toBeLessThanOrEqual(150);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});
