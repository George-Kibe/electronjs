import { describe, expect, it } from 'vitest';
import { createRasterLayer, Document } from '../doc/document';
import { liveLayers } from '../doc/flatten';
import { TileGrid } from '../tiles/tile';
import { adjustPixel, prepareAdjustment } from './adjust';
import { autoLevels, histogramOf, packHistogram, stats, unpackHistogram } from './histogram';

const W = 300;
const H = 40;

/** A horizontal ramp from `lo` to `hi` in each channel, scaled per channel by `cast`. */
function ramp(lo: number, hi: number, cast: [number, number, number] = [1, 1, 1], alpha = 255) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = lo + ((hi - lo) * x) / (W - 1);
      rgba.set([v * cast[0], v * cast[1], v * cast[2], alpha], (y * W + x) * 4);
    }
  return new Document(W, H, createRasterLayer('ramp', TileGrid.fromRgba(W, H, rgba)));
}
const hist = (doc: Document, selection: Map<string, Uint8Array> | null = null) =>
  histogramOf(liveLayers(doc.layers), { width: W, height: H }, selection);

describe('histograms (FR-ADJ-03)', () => {
  it('counts every opaque pixel per channel, not transparent ones, and only within the selection', () => {
    const h = hist(ramp(50, 200));
    expect(h.count).toBe(W * H);
    expect(h.r.reduce((a, b) => a + b, 0)).toBe(W * H);
    expect(h.r[49]).toBe(0);
    expect(h.r[50]).toBeGreaterThan(0);
    expect(h.l[200]).toBeGreaterThan(0);
    const empty = new Document(W, H, createRasterLayer('none', new TileGrid()));
    expect(hist(empty).count).toBe(0);
    // Only the left tile, and in it only pixels at least half selected.
    const sel = new Uint8Array(256 * 256);
    sel.fill(255, 0, 256 * 10);
    sel.fill(127, 256 * 10, 256 * 20);
    expect(hist(ramp(50, 200), new Map([['0,0', sel]])).count).toBe(256 * 10);
  });

  it('packs into bytes and back; stats are mean, standard deviation and median', () => {
    const h = hist(ramp(0, 255));
    const back = unpackHistogram(packHistogram(h));
    expect([...back.g]).toEqual([...h.g]);
    expect(back.count).toBe(h.count);
    const s = stats(h.r);
    expect(s.mean).toBeCloseTo(127.5, 0);
    expect(s.median).toBeGreaterThanOrEqual(127);
    expect(s.median).toBeLessThanOrEqual(128);
    expect(s.stdDev).toBeGreaterThan(70);
  });
});

describe('Auto Tone / Contrast / Color (FR-ADJ-02)', () => {
  const apply = (levels: ReturnType<typeof autoLevels>, rgb: [number, number, number]) =>
    adjustPixel(prepareAdjustment(levels), ...(rgb.map((v) => v / 255) as [number, number, number])).map(
      (v) => Math.round(v * 255),
    );

  it('Auto Tone stretches each channel to the full range (0.1 % clipped)', () => {
    const levels = autoLevels(hist(ramp(60, 180, [1, 0.8, 0.6])), 'tone');
    expect(levels.channels.r.inBlack).toBeGreaterThanOrEqual(60);
    expect(levels.channels.r.inWhite).toBeLessThanOrEqual(180);
    expect(levels.channels.b.inWhite).toBeLessThanOrEqual(108);
    expect(levels.channels.rgb).toEqual({ inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 });
    expect(apply(levels, [180, 144, 108])).toEqual([255, 255, 255]); // the brightest pixel becomes white
  });

  it('Auto Contrast stretches all channels together, so colours keep their balance', () => {
    const levels = autoLevels(hist(ramp(60, 180, [1, 0.8, 0.6])), 'contrast');
    expect(levels.channels.r).toEqual({ inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 });
    const [r, g, b] = apply(levels, [180, 144, 108]);
    expect(r).toBe(255);
    expect(g!).toBeLessThan(r!);
    expect(b!).toBeLessThan(g!);
  });

  it('Auto Color also brings the channels’ midtones together (removes a colour cast)', () => {
    const doc = ramp(30, 220, [1, 0.85, 0.7]);
    const tone = autoLevels(hist(doc), 'tone');
    const color = autoLevels(hist(doc), 'color');
    const meanAfter = (levels: typeof tone) => {
      const sums = [0, 0, 0];
      for (let x = 0; x < W; x++) {
        const v = 30 + (190 * x) / (W - 1);
        apply(levels, [v, v * 0.85, v * 0.7]).forEach((c, i) => (sums[i] = sums[i]! + c));
      }
      return sums.map((s) => s / W);
    };
    const spread = (m: number[]) => Math.max(...m) - Math.min(...m);
    expect(spread(meanAfter(color))).toBeLessThanOrEqual(spread(meanAfter(tone)) + 0.5);
    expect(spread(meanAfter(color))).toBeLessThan(4);
  });

  it('leaves flat channels and empty images alone', () => {
    const flat = autoLevels(hist(ramp(100, 100)), 'tone');
    expect(flat.channels.g).toEqual({ inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 });
    const none = autoLevels(hist(new Document(W, H, createRasterLayer('n', new TileGrid()))), 'color');
    expect(none.channels.r.gamma).toBe(1);
  });
});
