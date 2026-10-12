import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hexToRgb, hsbToRgb, rgbToHex, rgbToHsb, type RGB } from './color';

describe('colour conversions (FR-PNT-07)', () => {
  it('formats and parses hex', () => {
    expect(rgbToHex([164, 194, 225])).toBe('#A4C2E1');
    expect(hexToRgb('#a4c2e1')).toEqual([164, 194, 225]);
    expect(hexToRgb('f80')).toEqual([255, 136, 0]);
    expect(hexToRgb('#12345')).toBeNull();
    expect(hexToRgb('zzzzzz')).toBeNull();
  });

  it('converts known HSB values', () => {
    expect(rgbToHsb([255, 0, 0])).toEqual({ h: 0, s: 100, b: 100 });
    expect(rgbToHsb([0, 0, 0])).toEqual({ h: 0, s: 0, b: 0 });
    expect(hsbToRgb({ h: 120, s: 100, b: 50 })).toEqual([0, 128, 0]);
    expect(hsbToRgb({ h: 240, s: 50, b: 100 })).toEqual([128, 128, 255]);
    expect(hsbToRgb({ h: 360, s: 100, b: 100 })).toEqual([255, 0, 0]);
  });

  it('property: RGB → HSB → RGB and RGB → hex → RGB are lossless', () => {
    const channel = fc.integer({ min: 0, max: 255 });
    fc.assert(
      fc.property(fc.tuple(channel, channel, channel), (rgb) => {
        expect(hsbToRgb(rgbToHsb(rgb as RGB))).toEqual(rgb);
        expect(hexToRgb(rgbToHex(rgb as RGB))).toEqual(rgb);
      }),
    );
  });
});
