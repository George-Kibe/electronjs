import { describe, expect, it } from 'vitest';
import { TileGrid } from '../tiles/tile';
import { createRasterLayer, Document } from './document';
import { sampleColor } from './sample';

const W = 20;
const H = 10;

/** Red background; a layer with a 3-px blue/green checker at x ≥ 10 and transparency elsewhere. */
function doc(): Document {
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 10; x < W; x++) rgba.set((x + y) % 2 ? [0, 0, 255, 255] : [0, 255, 0, 255], (y * W + x) * 4);
  const bg = createRasterLayer('bg', TileGrid.filled(W, H, [255, 0, 0, 255]));
  const top = createRasterLayer('top', TileGrid.fromRgba(W, H, rgba), { opacity: 0.5 });
  return new Document(W, H, [bg, top]);
}

describe('sampleColor (FR-PNT-06)', () => {
  it('samples a single point of the composite or of the current layer', () => {
    const d = doc();
    expect(sampleColor(d, 12.7, 4.2, 1, 'layer')).toEqual([0, 255, 0]);
    expect(sampleColor(d, 12.7, 4.2, 1, 'all')).toEqual([128, 128, 0]); // 50 % green over red
    expect(sampleColor(d, 3, 3, 1, 'all')).toEqual([255, 0, 0]);
  });

  it('averages 3×3 and 5×5 squares, weighting by alpha', () => {
    const d = doc();
    // 3×3 around (12, 4): 5 green, 4 blue.
    expect(sampleColor(d, 12, 4, 3, 'layer')).toEqual([
      0,
      Math.round((5 * 255) / 9),
      Math.round((4 * 255) / 9),
    ]);
    // Straddling the edge of the layer: transparent pixels don't pull the colour towards black.
    expect(sampleColor(d, 9, 4, 3, 'layer')).toEqual([0, Math.round(255 / 3), Math.round((2 * 255) / 3)]); // column x = 10: blue, green, blue
    expect(sampleColor(d, 2, 2, 5, 'layer')).toBeNull();
  });

  it('clips the square to the canvas and ignores points outside it', () => {
    const d = doc();
    expect(sampleColor(d, 0, 0, 5, 'all')).toEqual([255, 0, 0]);
    expect(sampleColor(d, -1, 0, 1, 'all')).toBeNull();
    expect(sampleColor(d, W, 0, 1, 'all')).toBeNull();
  });
});
