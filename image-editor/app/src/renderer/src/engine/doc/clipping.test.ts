import { describe, expect, it } from 'vitest';
import { createTile, TILE_BYTES, TileGrid } from '../tiles/tile';
import { createGroupLayer, createRasterLayer, Document } from './document';
import { compositePixel, liveLayers } from './flatten';

const W = 300;
const H = 200;

/** A grid with one opaque colour in [x0, x1) of tile 0,0, transparent elsewhere. */
function stripe(x0: number, x1: number, rgb: [number, number, number], alpha = 255): TileGrid {
  const data = new Uint8ClampedArray(TILE_BYTES);
  for (let y = 0; y < 256; y++) for (let x = x0; x < x1; x++) data.set([...rgb, alpha], (y * 256 + x) * 4);
  const grid = new TileGrid();
  grid.set('0,0', createTile(data));
  return grid;
}

const pixel = (d: Document, x: number, y: number) => compositePixel(liveLayers(d.layers), x, y);

describe('clipping masks (FR-LAY-05)', () => {
  const build = (over: { baseVisible?: boolean; baseOpacity?: number } = {}) => {
    const base = createRasterLayer('base', stripe(50, 150, [0, 0, 255]), {
      visible: over.baseVisible ?? true,
      opacity: over.baseOpacity ?? 1,
    });
    const clipped = createRasterLayer('clipped', TileGrid.filled(W, H, [255, 0, 0, 255]), { clipped: true });
    const above = createRasterLayer('above', TileGrid.filled(W, H, [0, 255, 0, 255]), { clipped: true });
    const d = new Document(W, H, [
      createRasterLayer('bg', TileGrid.filled(W, H, [255, 255, 255, 255])),
      base,
      clipped,
    ]);
    return { d, base, clipped, above };
  };

  it('a clipped layer shows only where its base has pixels', () => {
    const { d } = build();
    expect(pixel(d, 100, 10)).toEqual([255, 0, 0, 255]); // over the base
    expect(pixel(d, 20, 10)).toEqual([255, 255, 255, 255]); // outside the base: background
    expect(pixel(d, 280, 190)).toEqual([255, 255, 255, 255]); // the base has no tile here
  });

  it('several clipped layers share the same base', () => {
    const { d, above } = build();
    d.layers.push(above);
    expect(pixel(d, 100, 10)).toEqual([0, 255, 0, 255]);
    expect(pixel(d, 20, 10)).toEqual([255, 255, 255, 255]);
  });

  it('follows the base: hidden hides it, opacity fades it', () => {
    expect(pixel(build({ baseVisible: false }).d, 100, 10)).toEqual([255, 255, 255, 255]);
    // The approximation (docs/02): clipped alpha × base alpha × base opacity, each composited on its own. With a
    // half-faded base, red at 50 % lands on the half-faded blue: (191, 64, 128). Photoshop's isolated clipping
    // group would give (255, 127, 127); the exact model needs source-atop blend modes (a follow-up).
    expect(pixel(build({ baseOpacity: 0.5 }).d, 100, 10)).toEqual([191, 64, 128, 255]);
  });

  it('the bottom layer of a container cannot be clipped (it has no base)', () => {
    const lone = createRasterLayer('lone', TileGrid.filled(W, H, [255, 0, 0, 255]), { clipped: true });
    const d = new Document(W, H, [createGroupLayer('g', [lone])]);
    expect(pixel(d, 10, 10)).toEqual([255, 0, 0, 255]);
  });
});
