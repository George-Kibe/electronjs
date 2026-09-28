import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TileGrid } from '../tiles/tile';
import { createRasterLayer, Document } from './document';
import { compositePixel, flatten, flattenPreview, liveLayers } from './flatten';

function doc(): Document {
  return new Document(
    300,
    270,
    createRasterLayer('Background', TileGrid.filled(300, 270, [255, 255, 255, 255])),
  );
}

describe('CPU compositor (reference for GPU, export and previews)', () => {
  it('composites visible layers with opacity and fill opacity', () => {
    const d = doc();
    const top = createRasterLayer('top', TileGrid.filled(300, 270, [255, 0, 0, 255]), { opacity: 0.5 });
    d.layers.push(top);
    expect(compositePixel(liveLayers(d.layers), 10, 10)).toEqual([255, 128, 128, 255]);
    top.opacity = 1;
    top.fillOpacity = 0.5;
    expect(compositePixel(liveLayers(d.layers), 10, 10)).toEqual([255, 128, 128, 255]);
    top.visible = false;
    expect(compositePixel(liveLayers(d.layers), 10, 10)).toEqual([255, 255, 255, 255]);
  });

  it('keeps straight colour under partial transparency', () => {
    const d = new Document(10, 10, createRasterLayer('only', TileGrid.filled(10, 10, [10, 200, 30, 128])));
    expect(compositePixel(liveLayers(d.layers), 3, 3)).toEqual([10, 200, 30, 128]);
  });

  it('flatten() equals compositePixel() everywhere, including partial edge tiles', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 255 }),
            fc.integer({ min: 0, max: 255 }),
            fc.double({ min: 0, max: 1, noNaN: true }),
          ),
          {
            minLength: 1,
            maxLength: 3,
          },
        ),
        (specs) => {
          const d = doc();
          for (const [v, a, opacity] of specs) {
            const rgba = new Uint8Array(300 * 270 * 4);
            for (let i = 0; i < rgba.length; i += 4)
              rgba.set([v, (i / 4) % 256, 255 - v, (a + i / 4) % 256], i);
            d.layers.push(createRasterLayer('l', TileGrid.fromRgba(300, 270, rgba), { opacity }));
          }
          const layers = liveLayers(d.layers);
          const out = flatten(layers, 300, 270);
          for (const [x, y] of [
            [0, 0],
            [299, 269],
            [256, 256],
            [255, 0],
            [123, 45],
          ] as const) {
            const i = (y * 300 + x) * 4;
            expect([...out.subarray(i, i + 4)]).toEqual(compositePixel(layers, x, y));
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('reports progress per tile row', () => {
    const rows: number[] = [];
    flatten(liveLayers(doc().layers), 300, 270, (done, total) => rows.push(done / total));
    expect(rows).toEqual([0.5, 1]);
  });

  it('previews fit the requested size and keep the aspect ratio', () => {
    const p = flattenPreview(liveLayers(doc().layers), 300, 270, 100);
    expect([p.width, p.height]).toEqual([100, 90]);
    expect([...p.rgba.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
    const small = flattenPreview(liveLayers(doc().layers), 300, 270, 1024);
    expect([small.width, small.height]).toEqual([300, 270]); // never upscales
  });
});
