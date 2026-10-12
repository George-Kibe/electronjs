import { describe, expect, it } from 'vitest';
import { History } from '../history/history';
import { TILE_BYTES, TileGrid } from '../tiles/tile';
import { createGroupLayer, createRasterLayer, Document, type RasterLayer } from './document';
import {
  anchorOffset,
  cropDocument,
  flipCanvas,
  replacePixels,
  resizeCanvas,
  rotateCanvas,
} from './geometry';

const W = 300;
const H = 200;

function layer(name: string, visible = true): RasterLayer {
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if ((x + 2 * y) % 5) rgba.set([x % 256, y, 9, 255], (y * W + x) * 4);
  return createRasterLayer(name, TileGrid.fromRgba(W, H, rgba), { visible });
}

function doc(): Document {
  const d = new Document(W, H, [layer('bg'), createGroupLayer('g', [layer('hidden', false)])]);
  d.meta.guides = { horizontal: [50], vertical: [100] };
  return d;
}

/** Everything a geometry command may change: size, guides and every layer's pixels. */
function state(d: Document): unknown {
  const pixels = (l: RasterLayer) => {
    const out: string[] = [];
    for (const [k, t] of [...l.tiles.entries()].sort()) {
      let sum = 0;
      for (let i = 0; i < TILE_BYTES; i += 97) sum = (sum * 31 + t.data[i]!) >>> 0;
      out.push(`${k}:${sum}`);
    }
    return out;
  };
  return {
    size: [d.width, d.height],
    guides: d.meta.guides,
    layers: d.allLayers().map((l) => (l.type === 'raster' ? [l.name, pixels(l)] : [l.name])),
  };
}

describe('canvas geometry commands (FR-TRF-01..03)', () => {
  it.each([
    ['rotate 90° CW', (d: Document) => rotateCanvas(d, 1)],
    ['rotate 180°', (d: Document) => rotateCanvas(d, 2)],
    ['rotate 90° CCW', (d: Document) => rotateCanvas(d, 3)],
    ['flip horizontal', (d: Document) => flipCanvas(d, 'horizontal')],
    ['canvas size', (d: Document) => resizeCanvas(d, 420, 150, { x: 0.5, y: 1 })!],
    ['crop, keep pixels', (d: Document) => cropDocument(d, { x: 30, y: 20, width: 100, height: 90 }, false)!],
    [
      'crop, delete pixels',
      (d: Document) => cropDocument(d, { x: 30, y: 20, width: 100, height: 90 }, true)!,
    ],
  ])('%s: do → undo → redo is exact', (_name, make) => {
    const d = doc();
    const history = new History(d);
    const before = state(d);
    history.execute(make(d));
    const after = state(d);
    expect(after).not.toEqual(before);
    history.undo();
    expect(state(d)).toEqual(before);
    history.redo();
    expect(state(d)).toEqual(after);
  });

  it('rotating 90° swaps the size, moves guides, and four turns restore everything', () => {
    const d = doc();
    const start = state(d);
    rotateCanvas(d, 1).do(d);
    expect([d.width, d.height]).toEqual([H, W]);
    expect(d.meta.guides).toEqual({ horizontal: [100], vertical: [H - 50] });
    for (let i = 0; i < 3; i++) rotateCanvas(d, 1).do(d);
    expect(state(d)).toEqual(start);
  });

  it('transforms hidden layers inside groups too', () => {
    const d = doc();
    const hidden = () => d.allLayers().find((l) => l.name === 'hidden') as RasterLayer;
    const px = hidden().tiles.pixel(10, 20);
    flipCanvas(d, 'horizontal').do(d);
    expect(hidden().tiles.pixel(W - 1 - 10, 20)).toEqual(px);
  });

  it('crop without deleting keeps the pixels outside, so Canvas Size brings them back', () => {
    const d = doc();
    const bg = () => d.layers[0] as RasterLayer;
    const original = bg().tiles.pixel(5, 6);
    cropDocument(d, { x: 30, y: 20, width: 100, height: 90 }, false)!.do(d);
    expect([d.width, d.height]).toEqual([100, 90]);
    expect(d.meta.guides).toEqual({ horizontal: [30], vertical: [70] });
    expect(bg().tiles.pixel(5 - 30, 6 - 20)).toEqual(original);
    resizeCanvas(d, W, H, { x: 1, y: 1 })!.do(d); // old canvas at bottom-right → offset (200, 110)
    expect(bg().tiles.pixel(5 - 30 + 200, 6 - 20 + 110)).toEqual(original);
  });

  it('crop with "delete cropped pixels" removes everything outside the new canvas', () => {
    const d = doc();
    cropDocument(d, { x: 30, y: 20, width: 100, height: 90 }, true)!.do(d);
    const bg = d.layers[0] as RasterLayer;
    expect(bg.tiles.pixel(-1, 5)[3]).toBe(0);
    expect(bg.tiles.pixel(100, 5)[3]).toBe(0);
    expect([...bg.tiles.keys()]).toEqual(['0,0']);
  });

  it('anchor offsets centre, start or end the old canvas', () => {
    const from = { width: 100, height: 50 };
    const to = { width: 161, height: 40 };
    expect(anchorOffset(from, to, { x: 0, y: 0 })).toEqual([0, 0]);
    expect(anchorOffset(from, to, { x: 0.5, y: 0.5 })).toEqual([31, -5]);
    expect(anchorOffset(from, to, { x: 1, y: 1 })).toEqual([61, -10]);
  });

  it('no-op crop or canvas size returns null (nothing pushed onto history)', () => {
    const d = doc();
    expect(resizeCanvas(d, W, H, { x: 0, y: 0 })).toBeNull();
    expect(cropDocument(d, { x: 0, y: 0, width: W, height: H }, false)).toBeNull();
  });

  it('replacePixels installs worker results with the new size, layers it lacks become empty', () => {
    const d = doc();
    const bg = d.layers[0] as RasterLayer;
    const grid = TileGrid.filled(50, 40, [1, 2, 3, 255]);
    const cmd = replacePixels('Image Size', new Map([[bg.id, grid]]), {
      width: 50,
      height: 40,
      guides: { horizontal: [], vertical: [] },
    });
    const before = state(d);
    cmd.do(d);
    expect([d.width, d.height]).toEqual([50, 40]);
    expect((d.layers[0] as RasterLayer).tiles.pixel(49, 39)).toEqual([1, 2, 3, 255]);
    expect((d.allLayers().find((l) => l.name === 'hidden') as RasterLayer).tiles.size).toBe(0);
    cmd.undo(d);
    expect(state(d)).toEqual(before);
  });
});
