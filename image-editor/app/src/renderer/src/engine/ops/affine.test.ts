import { describe, expect, it } from 'vitest';
import { tileRange } from '@shared/iep-schema';
import { TileGrid } from '../tiles/tile';
import { affineGrid, apply, IDENTITY, invert, invertAlpha, multiply, snapExact, type Affine } from './affine';
import { rotateGrid } from './canvas';

const W = 300;
const H = 200;
const range = tileRange(W, H);

/** A smooth test image: two gradients and a soft blob, fully opaque. */
function smooth(): TileGrid {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const blob = Math.exp(-((x - 150) ** 2 + (y - 100) ** 2) / 2000);
      rgba.set(
        [Math.round((x / W) * 255), Math.round((y / H) * 255), Math.round(blob * 255), 255],
        (y * W + x) * 4,
      );
    }
  return TileGrid.fromRgba(W, H, rgba);
}

/** A sharp test image: hard-edged squares with transparency. */
function sharp(): TileGrid {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 20; y < 120; y++) for (let x = 30; x < 90; x++) rgba.set([200, 30, 60, 255], (y * W + x) * 4);
  for (let y = 60; y < 180; y++)
    for (let x = 150; x < 260; x++) rgba.set([20, 180, 90, 128], (y * W + x) * 4);
  return TileGrid.fromRgba(W, H, rgba);
}

const same = (a: TileGrid, b: TileGrid) => {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (a.pixel(x, y).join() !== b.pixel(x, y).join()) return false;
  return true;
};

describe('affine matrices', () => {
  it('compose, invert and map points', () => {
    const m: Affine = [2, 0.5, -0.3, 1.5, 10, -4];
    const back = multiply(invert(m), m);
    back.forEach((v, i) => expect(v).toBeCloseTo(IDENTITY[i]!, 12));
    const [x, y] = apply(m, 3, 4);
    expect([x, y]).toEqual([2 * 3 - 0.3 * 4 + 10, 0.5 * 3 + 1.5 * 4 - 4]);
    expect(() => invert([1, 2, 2, 4, 0, 0])).toThrow();
  });

  it('snaps flips and quarter turns to whole pixels, and leaves the rest', () => {
    expect(snapExact([6.123e-17, 1, -1, 6.123e-17, 250.5, -0.5])).toEqual([0, 1, -1, 0, 251, 0]);
    expect(snapExact([-1, 0, 0, 1, 99.5000001, 3])).toEqual([-1, 0, 0, 1, 100, 3]);
    const scaled: Affine = [1.5, 0, 0, 1, 0.5, 0];
    expect(snapExact(scaled)).toBe(scaled);
  });

  it('inverts alpha and drops tiles that become empty', () => {
    const full = TileGrid.fromRgba(256, 256, new Uint8ClampedArray(256 * 256 * 4).fill(255));
    expect(invertAlpha(full).size).toBe(0);
    const half = TileGrid.fromRgba(256, 256, new Uint8ClampedArray(256 * 256 * 4).fill(100));
    expect(invertAlpha(half).pixel(3, 4)[3]).toBe(155);
  });
});

describe('affineGrid (T-TRF-01)', () => {
  it('whole-pixel moves, 90° rotations and flips are exact', () => {
    const src = sharp();
    const moved = affineGrid(src, [1, 0, 0, 1, 7, -3], range);
    expect(moved.pixel(37, 17)).toEqual(src.pixel(30, 20));
    expect(moved.pixel(100, 50)).toEqual(src.pixel(93, 53));
    // 90° clockwise about the origin, then back onto the canvas: matches the bit-exact Rotate 90°.
    const square = tileRange(256, 256);
    const sq = TileGrid.fromRgba(
      256,
      256,
      new Uint8ClampedArray(256 * 256 * 4).map((_, i) => ((i * 37) % 256) | 3),
    );
    const rotated = affineGrid(sq, [0, 1, -1, 0, 256, 0], square);
    const reference = rotateGrid(sq, 256, 256, 1, square);
    expect(rotated.pixel(10, 20)).toEqual(reference.pixel(10, 20));
    expect(rotated.pixel(200, 33)).toEqual(reference.pixel(200, 33));
    const flipped = affineGrid(src, [-1, 0, 0, 1, W, 0], range);
    expect(flipped.pixel(W - 1 - 40, 50)).toEqual(src.pixel(40, 50));
    expect(same(affineGrid(src, IDENTITY, range), src)).toBe(true);
  });

  it('scale 50 % then 200 % stays within the bicubic tolerance on a smooth image', () => {
    const src = smooth();
    const half = affineGrid(src, [0.5, 0, 0, 0.5, 0, 0], range);
    const back = affineGrid(half, [2, 0, 0, 2, 0, 0], range);
    let sum = 0;
    let count = 0;
    const errs: number[] = [];
    for (let y = 4; y < H - 4; y += 2)
      for (let x = 4; x < W - 4; x += 2) {
        const a = src.pixel(x, y);
        const b = back.pixel(x, y);
        for (let c = 0; c < 4; c++) {
          const e = Math.abs(a[c]! - b[c]!);
          sum += e;
          count++;
          errs.push(e);
        }
      }
    errs.sort((p, q) => p - q);
    expect(sum / count).toBeLessThan(2);
    expect(errs[Math.floor(errs.length * 0.99)]!).toBeLessThanOrEqual(6);
  });

  it('a reduction averages instead of skipping pixels (no aliasing)', () => {
    // 1-px black/white stripes: point-sampling at 25 % would give solid black or white; filtering gives grey.
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) rgba.set(x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * W + x) * 4);
    const small = affineGrid(TileGrid.fromRgba(W, H, rgba), [0.25, 0, 0, 0.25, 0, 0], range);
    const [r] = small.pixel(30, 20);
    expect(Math.abs(r! - 128)).toBeLessThan(20);
  });

  it('keeps transparency and edges clean', () => {
    const src = sharp();
    const rotated = affineGrid(
      src,
      [Math.cos(0.3), Math.sin(0.3), -Math.sin(0.3), Math.cos(0.3), 40, -10],
      range,
    );
    expect(rotated.pixel(5, 190)).toEqual([0, 0, 0, 0]); // far from any content
    const r = rotated.pixel(
      ...(apply([Math.cos(0.3), Math.sin(0.3), -Math.sin(0.3), Math.cos(0.3), 40, -10], 60, 70).map(
        Math.floor,
      ) as [number, number]),
    );
    expect(r).toEqual([200, 30, 60, 255]); // inside the red square: unchanged colour
  });
});
