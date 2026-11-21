import { describe, expect, it } from 'vitest';
import { createRasterLayer } from '../doc/document';
import { liveLayers } from '../doc/flatten';
import { TileGrid } from '../tiles/tile';
import { magicWand, type MaskTiles } from './wand';

const W = 300;
const H = 200;

/**
 * Known regions (T-SEL-01): white background; two red squares far apart; a slightly different red square
 * (within tolerance 32 of the first); a dark red square (beyond it); a transparent hole in the corner.
 */
function fixture() {
  const rgba = new Uint8ClampedArray(W * H * 4);
  const fill = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number, number]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgba.set(c, (y * W + x) * 4);
  };
  fill(0, 0, W, H, [255, 255, 255, 255]);
  fill(10, 10, 60, 60, [200, 30, 30, 255]); // A: 2500 px
  fill(200, 10, 240, 50, [200, 30, 30, 255]); // B: 1600 px, same colour as A
  fill(100, 100, 130, 130, [220, 50, 40, 255]); // C: 900 px, within 32 of A
  fill(150, 140, 170, 160, [120, 0, 0, 255]); // D: 400 px, beyond 32
  fill(280, 180, 300, 200, [10, 200, 10, 0]); // transparent, with stray RGB
  fill(260, 180, 280, 200, [250, 0, 250, 0]); // transparent, other stray RGB
  return liveLayers([createRasterLayer('fixture', TileGrid.fromRgba(W, H, rgba))]);
}

function area(tiles: MaskTiles): number {
  let sum = 0;
  for (const [, data] of tiles) for (const v of data) sum += v;
  return sum / 255;
}

const opts = { tolerance: 32, contiguous: true, antiAlias: false };

describe('magicWand (T-SEL-01)', () => {
  const layers = fixture();

  it('contiguous: only the clicked region', () => {
    expect(area(magicWand(layers, { width: W, height: H }, { x: 30, y: 30 }, opts))).toBe(2500);
  });

  it('non-contiguous: every pixel within tolerance, wherever it is', () => {
    const all = magicWand(layers, { width: W, height: H }, { x: 30, y: 30 }, { ...opts, contiguous: false });
    expect(area(all)).toBe(2500 + 1600 + 900);
  });

  it('tolerance decides what matches', () => {
    const exact = magicWand(
      layers,
      { width: W, height: H },
      { x: 30, y: 30 },
      { ...opts, tolerance: 0, contiguous: false },
    );
    expect(area(exact)).toBe(2500 + 1600);
    const wide = magicWand(
      layers,
      { width: W, height: H },
      { x: 30, y: 30 },
      { ...opts, tolerance: 80, contiguous: false },
    );
    expect(area(wide)).toBe(2500 + 1600 + 900 + 400);
  });

  it('the background around shapes is one region, and transparent pixels match each other', () => {
    const bg = magicWand(layers, { width: W, height: H }, { x: 150, y: 80 }, opts);
    expect(area(bg)).toBe(W * H - 2500 - 1600 - 900 - 400 - 800);
    const clear = magicWand(layers, { width: W, height: H }, { x: 290, y: 190 }, opts);
    expect(area(clear)).toBe(800); // both transparent patches, despite their different stored RGB
  });

  it('anti-aliasing softens only the edge', () => {
    const soft = magicWand(layers, { width: W, height: H }, { x: 30, y: 30 }, { ...opts, antiAlias: true });
    const [, tile] = soft[0]!;
    expect(tile[30 * 256 + 30]).toBe(255); // inside
    expect(tile[10 * 256 + 30]).toBeGreaterThan(0); // first row of the square
    expect(tile[10 * 256 + 30]).toBeLessThan(255);
    expect(tile[9 * 256 + 30]).toBeGreaterThan(0); // the row above gets a little
    expect(tile[5 * 256 + 30]).toBe(0); // far outside
    expect(Math.abs(area(soft) - 2500)).toBeLessThan(5); // edges move coverage, not area
  });

  it('a click outside the canvas selects nothing', () => {
    expect(magicWand(layers, { width: W, height: H }, { x: -1, y: 5 }, opts)).toEqual([]);
  });
});
