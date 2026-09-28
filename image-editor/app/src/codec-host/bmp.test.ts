import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BmpError, decodeBmp, encodeBmp } from './bmp';

const LIMITS = { maxSide: 20_000, maxPixels: 400_000_000 };

function image(width: number, height: number, alpha = true): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++)
    rgba.set([(i * 37) % 256, (i * 11) % 256, (i * 5) % 256, alpha ? (i * 3) % 256 : 255], i * 4);
  return rgba;
}

/** Hand-built 2×2 8-bit palette BMP, top-down, stride padded to 4 bytes. */
function paletteBmp(): Uint8Array {
  const palette = [0, 0, 255, 0, 0, 255, 0, 0]; // index 0 = red (BGRx), 1 = green
  const pixels = [0, 1, 0, 0, 1, 0, 0, 0];
  const out = new Uint8Array(14 + 40 + palette.length + pixels.length);
  const dv = new DataView(out.buffer);
  out.set([0x42, 0x4d]);
  dv.setUint32(2, out.length, true);
  dv.setUint32(10, 14 + 40 + palette.length, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, 2, true);
  dv.setInt32(22, -2, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 8, true);
  dv.setUint32(46, 2, true);
  out.set(palette, 54);
  out.set(pixels, 54 + palette.length);
  return out;
}

describe('BMP codec (docs/09 §1)', () => {
  it('round-trips 32-bit BGRA exactly, including odd widths', () => {
    const rgba = image(5, 3);
    const back = decodeBmp(encodeBmp(rgba, 5, 3, 32), LIMITS);
    expect([back.width, back.height]).toEqual([5, 3]);
    expect(Buffer.compare(Buffer.from(back.rgba), Buffer.from(rgba))).toBe(0);
  });

  it('round-trips 24-bit (opaque) with row padding', () => {
    const rgba = image(3, 4, false);
    const back = decodeBmp(encodeBmp(rgba, 3, 4, 24), LIMITS);
    expect(Buffer.compare(Buffer.from(back.rgba), Buffer.from(rgba))).toBe(0);
  });

  it('reads 8-bit palette, top-down files', () => {
    const { rgba } = decodeBmp(paletteBmp(), LIMITS);
    expect([...rgba.subarray(0, 8)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
    expect([...rgba.subarray(8, 16)]).toEqual([0, 255, 0, 255, 255, 0, 0, 255]);
  });

  it('treats an all-zero 4th byte in 32-bit BI_RGB as opaque', () => {
    const bmp = encodeBmp(image(2, 2, false), 2, 2, 24);
    // Re-encode as 32-bit BI_RGB with zero alpha bytes.
    const out = new Uint8Array(14 + 40 + 16);
    out.set(bmp.subarray(0, 54));
    const dv = new DataView(out.buffer);
    dv.setUint16(28, 32, true);
    dv.setUint32(10, 54, true);
    out.set([1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0, 10, 11, 12, 0], 54);
    expect(decodeBmp(out, LIMITS).rgba[3]).toBe(255);
  });

  it('rejects oversized, compressed and truncated files with a clear error', () => {
    const big = encodeBmp(image(4, 4), 4, 4, 32);
    new DataView(big.buffer).setInt32(18, 30_000, true);
    expect(() => decodeBmp(big, LIMITS)).toThrow(/too large/);
    const rle = encodeBmp(image(4, 4), 4, 4, 24);
    new DataView(rle.buffer).setUint32(30, 1, true);
    expect(() => decodeBmp(rle, LIMITS)).toThrow(/Compressed/);
    expect(() => decodeBmp(encodeBmp(image(4, 4), 4, 4, 24).subarray(0, 60), LIMITS)).toThrow(/truncated/);
  });

  it('never throws anything but BmpError on random corruption (fuzz)', () => {
    const valid = encodeBmp(image(7, 5), 7, 5, 32);
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat(valid.length - 1), fc.integer({ min: 0, max: 255 })), { maxLength: 6 }),
        (edits) => {
          const bytes = valid.slice();
          for (const [at, v] of edits) bytes[at] = v;
          try {
            decodeBmp(bytes, { maxSide: 20_000, maxPixels: 10_000 });
          } catch (err) {
            expect(err).toBeInstanceOf(BmpError);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });
});
