import { describe, expect, it } from 'vitest';
import {
  ADJUSTMENT_KINDS,
  adjustPixel,
  adjustTiles,
  curveFn,
  defaultAdjustment,
  isNeutral,
  linearToSrgb,
  prepareAdjustment,
  srgbToLinear,
  type Adjustment,
  type RGB,
} from './adjust';

const run = (adj: Adjustment, rgb: RGB): RGB => {
  const p = prepareAdjustment(adj);
  return adjustPixel(p, rgb[0] / 255, rgb[1] / 255, rgb[2] / 255).map((v) => Math.round(v * 255)) as RGB;
};

const samples: RGB[] = [
  [0, 0, 0],
  [255, 255, 255],
  [200, 40, 90],
  [12, 180, 240],
  [128, 128, 128],
  [255, 255, 0],
];

describe('adjustments: CPU reference (FR-ADJ-01)', () => {
  it('the neutral defaults change nothing', () => {
    const neutral = ADJUSTMENT_KINDS.filter((k) => isNeutral(defaultAdjustment(k)));
    expect(neutral).toEqual([
      'brightness-contrast',
      'levels',
      'curves',
      'exposure',
      'vibrance',
      'hue-saturation',
      'color-balance',
    ]);
    for (const kind of neutral)
      for (const s of samples) expect(run(defaultAdjustment(kind), s), kind).toEqual(s);
  });

  it('invert, posterize and threshold', () => {
    expect(run({ kind: 'invert' }, [200, 40, 90])).toEqual([55, 215, 165]);
    expect(run({ kind: 'posterize', levels: 4 }, [10, 70, 200])).toEqual([0, 85, 255]);
    expect(run({ kind: 'posterize', levels: 2 }, [127, 128, 255])).toEqual([0, 255, 255]);
    expect(run({ kind: 'threshold', level: 128 }, [128, 128, 128])).toEqual([255, 255, 255]);
    expect(run({ kind: 'threshold', level: 128 }, [127, 127, 127])).toEqual([0, 0, 0]);
    expect(run({ kind: 'threshold', level: 100 }, [255, 0, 0])).toEqual([0, 0, 0]); // luma 76
  });

  it('levels: input range, gamma and output range, per channel then master', () => {
    const adj = defaultAdjustment('levels');
    adj.channels.rgb = { inBlack: 50, inWhite: 200, gamma: 1, outBlack: 0, outWhite: 255 };
    expect(run(adj, [50, 125, 200])).toEqual([0, 128, 255]);
    adj.channels.rgb = { inBlack: 0, inWhite: 255, gamma: 2, outBlack: 0, outWhite: 255 };
    expect(run(adj, [64, 64, 64])[0]).toBe(Math.round((64 / 255) ** 0.5 * 255));
    const red = defaultAdjustment('levels');
    red.channels.r = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 100, outWhite: 255 };
    expect(run(red, [0, 0, 0])).toEqual([100, 0, 0]);
  });

  it('curves: a smooth spline through the points, flat beyond the ends', () => {
    const f = curveFn([
      [0, 0],
      [128, 160],
      [255, 255],
    ]);
    expect(Math.round(f(128 / 255) * 255)).toBe(160);
    expect(f(0)).toBe(0);
    expect(Math.round(f(64 / 255) * 255)).toBeGreaterThan(64); // bent up between the points
    const g = curveFn([
      [30, 50],
      [200, 220],
    ]);
    expect(Math.round(g(0) * 255)).toBe(50);
    expect(Math.round(g(1) * 255)).toBe(220);
    const adj = defaultAdjustment('curves');
    adj.channels.b = [
      [0, 255],
      [255, 0],
    ];
    expect(run(adj, [10, 20, 30])).toEqual([10, 20, 225]);
  });

  it('exposure works in linear light: +1 stop doubles the light', () => {
    const v = 0.2;
    const doubled = linearToSrgb(Math.min(1, srgbToLinear(v) * 2));
    expect(run({ kind: 'exposure', exposure: 1, offset: 0, gamma: 1 }, [51, 51, 51])[0]).toBe(
      Math.round(doubled * 255),
    );
  });

  it('brightness and contrast', () => {
    const brighter = run(
      { kind: 'brightness-contrast', brightness: 150, contrast: 0, legacy: false },
      [100, 100, 100],
    );
    expect(brighter[0]).toBeGreaterThan(150);
    const flatter = run(
      { kind: 'brightness-contrast', brightness: 0, contrast: -50, legacy: false },
      [20, 128, 235],
    );
    expect(flatter[0]).toBeGreaterThan(20);
    expect(flatter[1]).toBe(128);
    expect(flatter[2]).toBeLessThan(235);
    expect(
      run({ kind: 'brightness-contrast', brightness: 10, contrast: 0, legacy: true }, [100, 100, 100]),
    ).toEqual([110, 110, 110]);
  });

  it('hue/saturation: hue turns, saturation scales, colorize sets one hue', () => {
    expect(
      run({ kind: 'hue-saturation', hue: 180, saturation: 0, lightness: 0, colorize: false }, [255, 0, 0]),
    ).toEqual([0, 255, 255]);
    expect(
      run({ kind: 'hue-saturation', hue: 120, saturation: 0, lightness: 0, colorize: false }, [255, 0, 0]),
    ).toEqual([0, 255, 0]);
    const grey = run(
      { kind: 'hue-saturation', hue: 0, saturation: -100, lightness: 0, colorize: false },
      [200, 40, 90],
    );
    expect(grey[0]).toBe(grey[1]);
    expect(grey[1]).toBe(grey[2]);
    expect(
      run({ kind: 'hue-saturation', hue: 0, saturation: 0, lightness: 100, colorize: false }, [12, 180, 240]),
    ).toEqual([255, 255, 255]);
    const sepia = run(
      { kind: 'hue-saturation', hue: 30, saturation: 50, lightness: 0, colorize: true },
      [128, 128, 128],
    );
    expect(sepia[0]).toBeGreaterThan(sepia[1]);
    expect(sepia[1]).toBeGreaterThan(sepia[2]);
  });

  it('black & white: Photoshop’s default weights', () => {
    const bw = defaultAdjustment('black-white');
    expect(run(bw, [255, 0, 0])).toEqual([102, 102, 102]); // reds 40 %
    expect(run(bw, [255, 255, 0])).toEqual([153, 153, 153]); // yellows 60 %
    expect(run(bw, [0, 0, 255])).toEqual([51, 51, 51]); // blues 20 %
    expect(run(bw, [255, 0, 255])).toEqual([204, 204, 204]); // magentas 80 %
    expect(run(bw, [255, 255, 255])).toEqual([255, 255, 255]);
    const tinted = run({ ...bw, tint: [225, 211, 179] }, [128, 128, 128]);
    expect(tinted[0]).toBeGreaterThan(tinted[2]);
  });

  it('vibrance boosts dull colours more than vivid ones; saturation −100 is grey', () => {
    const dull: RGB = [140, 120, 110];
    const vivid: RGB = [230, 30, 30];
    const spread = (c: RGB) => Math.max(...c) - Math.min(...c);
    const v = { kind: 'vibrance', vibrance: 100, saturation: 0 } as const;
    expect(spread(run(v, dull)) / spread(dull)).toBeGreaterThan(spread(run(v, vivid)) / spread(vivid));
    const grey = run({ kind: 'vibrance', vibrance: 0, saturation: -100 }, [200, 40, 90]);
    expect(new Set(grey).size).toBe(1);
  });

  it('color balance shifts one range; preserving luminosity keeps the lightness', () => {
    const cb = defaultAdjustment('color-balance');
    cb.midtones = [100, 0, 0];
    cb.preserveLuminosity = false;
    const mid = run(cb, [128, 128, 128]);
    expect(mid[0]).toBeGreaterThan(128);
    expect(run(cb, [0, 0, 0])).toEqual([0, 0, 0]); // midtones leave black alone
    cb.preserveLuminosity = true;
    const kept = run(cb, [128, 128, 128]);
    expect(Math.round((Math.max(...kept) + Math.min(...kept)) / 2)).toBe(128);
  });

  it('adjustTiles: within the selection by its coverage, alpha kept, other tiles untouched', () => {
    const tile = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < tile.length; i += 4) tile.set([200, 40, 90, i < 8 ? 0 : 128], i);
    const sel = new Uint8Array(256 * 256).fill(255);
    sel[2] = 128;
    sel[3] = 0;
    const other = new Uint8Array(256 * 256 * 4).fill(7);
    const out = new Map(
      adjustTiles(
        [
          ['0,0', tile],
          ['1,0', other],
        ],
        prepareAdjustment({ kind: 'invert' }),
        new Map([['0,0', sel]]),
      ),
    );
    const px = (i: number) => [...out.get('0,0')!.subarray(i * 4, i * 4 + 4)];
    expect(px(0)).toEqual([200, 40, 90, 0]); // transparent: left alone
    expect(px(2)).toEqual([127, 128, 128, 128]); // 128/255 selected: about halfway to the inverse
    expect(px(3)).toEqual([200, 40, 90, 128]); // not selected
    expect(px(4)).toEqual([55, 215, 165, 128]);
    expect(out.get('1,0')).toBe(other); // outside the selection: the same bytes
    const all = adjustTiles([['0,0', tile]], prepareAdjustment({ kind: 'invert' }), null);
    expect([...all[0]![1].subarray(16, 20)]).toEqual([55, 215, 165, 128]);
  });

  it('photo filter: density 0 changes nothing; a warm filter warms, keeping luma', () => {
    expect(
      run(
        { kind: 'photo-filter', color: [236, 138, 0], density: 0, preserveLuminosity: true },
        [12, 180, 240],
      ),
    ).toEqual([12, 180, 240]);
    const warm = run(
      { kind: 'photo-filter', color: [236, 138, 0], density: 50, preserveLuminosity: true },
      [128, 128, 128],
    );
    expect(warm[0]).toBeGreaterThan(warm[2]);
    const y = (c: RGB) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    expect(Math.abs(y(warm) - 128)).toBeLessThan(1.5);
  });
});
