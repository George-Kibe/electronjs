import { describe, expect, it } from 'vitest';
import { History } from '../history/history';
import { sourceOver } from '../ops/affine';
import { TILE_SIZE, TileGrid } from '../tiles/tile';
import { createRasterLayer, Document } from './document';
import { floatingPreview, gridToSelection, liftedId, selectionToGrid, splitBySelection } from './float';
import { replaceLayers } from './geometry';
import { ellipseMask, rectMask } from './selection';

const W = 600;
const H = 300;
const solid = () => TileGrid.filled(W, H, [200, 100, 50, 255]);

describe('floating a selection (FR-TRF-04)', () => {
  it('splits by coverage: whole tiles are shared, edge tiles divide each pixel', () => {
    const tiles = solid();
    // Tile 0,0 fully selected, tile 1,0 partly, tile 2,0 not at all.
    const sel = rectMask({ x0: 0, y0: 0, x1: 300, y1: 256 }, W, H);
    const { lifted, rest } = splitBySelection(tiles, sel);
    expect(lifted.get('0,0')).toBe(tiles.get('0,0'));
    expect(rest.get('0,0')).toBeUndefined();
    expect(rest.get('2,0')).toBe(tiles.get('2,0'));
    expect(lifted.pixel(299, 10)).toEqual([200, 100, 50, 255]);
    expect(lifted.pixel(300, 10)[3]).toBe(0);
    expect(rest.pixel(300, 10)).toEqual([200, 100, 50, 255]);
    // A soft edge: the two parts share the pixel's alpha.
    const soft = ellipseMask({ x0: 10, y0: 10, x1: 290, y1: 250 }, W, H);
    const parts = splitBySelection(tiles, soft);
    for (let x = 0; x < 20; x++) {
      const a = parts.lifted.pixel(x, 130)[3]! + parts.rest.pixel(x, 130)[3]!;
      expect(a).toBe(255);
    }
  });

  it('the selection survives the trip to RGBA and back; nothing selected is null', () => {
    const sel = ellipseMask({ x0: 20, y0: 30, x1: 400, y1: 280 }, W, H);
    const back = gridToSelection(selectionToGrid(sel), W, H)!;
    for (const [x, y] of [
      [25, 155],
      [210, 155],
      [399, 155],
      [5, 5],
    ] as const)
      expect(back.value(x, y)).toBe(sel.value(x, y));
    expect(gridToSelection(new TileGrid(), W, H)).toBeNull();
    // Outside the canvas nothing stays selected.
    const off = TileGrid.filled(TILE_SIZE, TILE_SIZE, [0, 0, 0, 255]);
    const shifted = new TileGrid();
    shifted.set('-1,0', off.get('0,0')!);
    expect(gridToSelection(shifted, W, H)).toBeNull();
  });

  it('recombines with source-over; a hard selection put back is unchanged', () => {
    const tiles = solid();
    const { lifted, rest } = splitBySelection(tiles, rectMask({ x0: 50, y0: 40, x1: 120, y1: 90 }, W, H));
    const again = sourceOver(lifted, rest);
    for (const [x, y] of [
      [60, 50],
      [10, 10],
      [119, 89],
      [120, 90],
    ] as const)
      expect(again.pixel(x, y)).toEqual(tiles.pixel(x, y));
    // Half-transparent red over opaque blue.
    const top = TileGrid.filled(4, 4, [255, 0, 0, 128]);
    const bottom = TileGrid.filled(4, 4, [0, 0, 255, 255]);
    expect(sourceOver(top, bottom).pixel(1, 1)).toEqual([128, 0, 127, 255]);
  });

  it('previews as an isolated group with the layer’s blend mode, opacity and mask on what stays', () => {
    const base = createRasterLayer('bg', solid());
    const layer = createRasterLayer('top', solid(), { opacity: 0.5, blendMode: 'multiply' });
    layer.mask = { grid: new TileGrid(), background: 255, enabled: true, linked: true };
    const doc = new Document(W, H, [base, layer]);
    const parts = new Map([
      [layer.id, splitBySelection(layer.tiles, rectMask({ x0: 0, y0: 0, x1: 10, y1: 10 }, W, H))],
    ]);
    const preview = floatingPreview(doc, parts);
    expect(preview.layers[0]).toBe(base);
    const group = preview.layers[1]!;
    expect(group).toMatchObject({ type: 'group', opacity: 0.5, blendMode: 'multiply', passThrough: false });
    if (group.type !== 'group') throw new Error('expected a group');
    expect(group.children.map((c) => c.id)).toEqual([`${layer.id}#rest`, liftedId(layer.id)]);
    expect(group.children.map((c) => (c.type === 'raster' ? c.mask : 'group'))).toEqual([layer.mask, null]);
    expect(doc.layers[1]).toBe(layer); // the real document is untouched
  });

  it('replaceLayers with a selection sets it and undo brings the old one back', () => {
    const layer = createRasterLayer('top', solid());
    const doc = new Document(W, H, layer);
    const before = rectMask({ x0: 0, y0: 0, x1: 10, y1: 10 }, W, H);
    const after = rectMask({ x0: 50, y0: 50, x1: 60, y1: 60 }, W, H);
    doc.selection = before;
    const history = new History(doc, { maxSteps: 10, maxBytes: 1e9 }, () => undefined);
    const tiles = new TileGrid();
    history.execute(replaceLayers('Free Transform', new Map([[layer.id, tiles]]), after));
    expect(doc.selection).toBe(after);
    expect(doc.raster(layer.id).tiles).toBe(tiles);
    history.undo();
    expect(doc.selection).toBe(before);
    expect(doc.raster(layer.id).tiles).toBe(layer.tiles);
    history.redo();
    expect(doc.selection).toBe(after);
    // Without one, the selection is kept.
    history.execute(replaceLayers('Free Transform', new Map([[layer.id, new TileGrid()]])));
    expect(doc.selection).toBe(after);
  });
});
