import { describe, expect, it } from 'vitest';
import { createRasterLayer } from '../doc/document';
import { liveLayers } from '../doc/flatten';
import { TILE_SIZE, TileGrid } from '../tiles/tile';
import { fillRegion } from './fill';
import { magicWand } from './wand';

const W = 300;
const H = 100;

/** A white canvas with a black vertical bar at x 100..109, and a transparent strip at y ≥ 80. */
function image(): Uint8Array {
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (y >= 80) continue;
      const v = x >= 100 && x < 110 ? 0 : 255;
      rgba.set([v, v, v, 255], i);
    }
  return rgba;
}

function bucket(seed: { x: number; y: number }, opts: { contiguous?: boolean; tolerance?: number } = {}) {
  const grid = TileGrid.fromRgba(W, H, image());
  const layer = createRasterLayer('l', grid);
  const region = magicWand(liveLayers([layer]), { width: W, height: H }, seed, {
    tolerance: opts.tolerance ?? 32,
    contiguous: opts.contiguous ?? true,
    antiAlias: false,
  });
  const tiles = new Map([...grid.entries()].map(([k, t]) => [k, new Uint8Array(t.data)]));
  return { tiles, region, grid };
}

const at = (tiles: Map<string, Uint8Array>, x: number, y: number) => {
  const t = tiles.get(`${Math.floor(x / TILE_SIZE)},${Math.floor(y / TILE_SIZE)}`);
  const i = ((y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE)) * 4;
  return t ? [...t.subarray(i, i + 4)] : [0, 0, 0, 0];
};

describe('Paint Bucket (FR-PNT-03)', () => {
  it('fills the contiguous region of similar colour, and only it', () => {
    const { tiles, region } = bucket({ x: 20, y: 20 });
    const out = new Map([...tiles, ...fillRegion(tiles, region, [255, 0, 0], null, false)]);
    expect(at(out, 20, 20)).toEqual([255, 0, 0, 255]);
    expect(at(out, 99, 79)).toEqual([255, 0, 0, 255]);
    expect(at(out, 105, 20)).toEqual([0, 0, 0, 255]); // the bar stops it
    expect(at(out, 200, 20)).toEqual([255, 255, 255, 255]); // the other side
    expect(at(out, 20, 90)).toEqual([0, 0, 0, 0]); // transparent is another colour
  });

  it('not contiguous: every pixel of similar colour', () => {
    const { tiles, region } = bucket({ x: 20, y: 20 }, { contiguous: false });
    const out = new Map([...tiles, ...fillRegion(tiles, region, [0, 0, 255], null, false)]);
    expect(at(out, 200, 20)).toEqual([0, 0, 255, 255]);
    expect(at(out, 105, 20)).toEqual([0, 0, 0, 255]);
  });

  it('pours into transparency too, making it opaque', () => {
    const { tiles, region } = bucket({ x: 20, y: 90 });
    const out = new Map([...tiles, ...fillRegion(tiles, region, [10, 200, 30], null, false)]);
    expect(at(out, 250, 95)).toEqual([10, 200, 30, 255]);
    expect(at(out, 20, 20)).toEqual([255, 255, 255, 255]);
  });

  it('stays inside the selection, blending by its coverage', () => {
    const { tiles, region } = bucket({ x: 20, y: 20 });
    const sel = new Uint8Array(TILE_SIZE * TILE_SIZE);
    for (let y = 0; y < 50; y++) sel.fill(y < 25 ? 255 : 128, y * TILE_SIZE, y * TILE_SIZE + 50);
    const out = new Map([...tiles, ...fillRegion(tiles, region, [0, 0, 0], new Map([['0,0', sel]]), false)]);
    expect(at(out, 10, 10)).toEqual([0, 0, 0, 255]);
    expect(at(out, 10, 30)).toEqual([127, 127, 127, 255]); // half covered: half way to black
    expect(at(out, 60, 10)).toEqual([255, 255, 255, 255]); // outside the selection
    // A tile without selection coverage is not touched at all.
    expect(fillRegion(tiles, region, [0, 0, 0], new Map(), false)).toEqual([]);
  });

  it('with transparency locked, recolours existing pixels and keeps every alpha', () => {
    const { tiles, region } = bucket({ x: 20, y: 90 }); // the transparent strip
    expect(fillRegion(tiles, region, [255, 0, 0], null, true)).toEqual([]);
    const white = bucket({ x: 20, y: 20 });
    const out = new Map([...white.tiles, ...fillRegion(white.tiles, white.region, [255, 0, 0], null, true)]);
    expect(at(out, 20, 20)).toEqual([255, 0, 0, 255]);
    expect(at(out, 20, 90)).toEqual([0, 0, 0, 0]);
  });

  it('returns only tiles that changed (filling a colour with itself changes nothing)', () => {
    const { tiles, region } = bucket({ x: 20, y: 20 });
    expect(fillRegion(tiles, region, [255, 255, 255], null, false)).toEqual([]);
  });
});
