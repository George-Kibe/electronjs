import { describe, expect, it } from 'vitest';
import { createRasterLayer, Document } from '../doc/document';
import { liveLayers } from '../doc/flatten';
import { Mask, maskTile } from '../doc/selection';
import { TileGrid } from '../tiles/tile';
import { trimContent, type TrimBasis } from './trim';

const W = 300;
const H = 280; // two tile rows

/** Bounds of what Trim keeps. */
function kept(doc: Document, basis: TrimBasis) {
  const tiles = new Map(
    trimContent(liveLayers(doc.layers), { width: W, height: H }, basis).map(([k, d]) => [
      k,
      maskTile(new Uint8ClampedArray(d))!,
    ]),
  );
  return Mask.fromTiles(tiles, W, H).bounds();
}

function rect(x0: number, y0: number, x1: number, y1: number, rgba: number[]): TileGrid {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px.set(rgba, (y * W + x) * 4);
  return TileGrid.fromRgba(W, H, px);
}

describe('Image › Trim (FR-TRF-06)', () => {
  it('keeps the non-transparent composite, across tiles and layers; hidden layers do not count', () => {
    const doc = new Document(W, H, [
      createRasterLayer('a', rect(40, 30, 60, 50, [255, 0, 0, 255])),
      createRasterLayer('b', rect(200, 250, 270, 262, [0, 0, 255, 10])),
      createRasterLayer('hidden', rect(0, 0, 5, 5, [0, 0, 0, 255]), { visible: false }),
    ]);
    expect(kept(doc, 'transparent')).toEqual({ x0: 40, y0: 30, x1: 270, y1: 262 });
  });

  it('keeps what differs from a corner colour', () => {
    const doc = new Document(W, H, [
      createRasterLayer('bg', TileGrid.filled(W, H, [255, 255, 255, 255])),
      createRasterLayer('mark', rect(100, 120, 140, 270, [0, 0, 0, 255])),
      createRasterLayer('corner', rect(290, 270, 300, 280, [9, 9, 9, 255])),
    ]);
    expect(kept(doc, 'topLeft')).toEqual({ x0: 100, y0: 120, x1: 300, y1: 280 });
    // Against the bottom-right colour, the white background is content too.
    expect(kept(doc, 'bottomRight')).toEqual({ x0: 0, y0: 0, x1: 300, y1: 280 });
  });

  it('an image that is all one colour keeps nothing', () => {
    const doc = new Document(W, H, createRasterLayer('bg', TileGrid.filled(W, H, [10, 20, 30, 255])));
    expect(kept(doc, 'topLeft')).toBeNull();
    expect(kept(new Document(W, H, createRasterLayer('empty', new TileGrid())), 'transparent')).toBeNull();
  });
});
