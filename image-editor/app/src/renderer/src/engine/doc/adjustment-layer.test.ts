import { describe, expect, it } from 'vitest';
import { History } from '../history/history';
import { captureState, restoreState } from '../history/snapshots';
import { defaultAdjustment } from '../ops/adjust';
import { createTile, TILE_BYTES, TileGrid } from '../tiles/tile';
import { SetAdjustmentCommand } from './commands';
import { createAdjustmentLayer, createGroupLayer, createRasterLayer, Document } from './document';
import { compositePixel, liveLayers } from './flatten';
import { cropDocument, replacePixels } from './geometry';
import { duplicateLayer, mergeDown, mergeDownBlocker } from './layer-ops';

const W = 64;
const solid = (rgba: [number, number, number, number]) => TileGrid.filled(W, W, rgba);
const at = (doc: Document, x = 5, y = 5) => compositePixel(liveLayers(doc.layers), x, y);

describe('adjustment layers (FR-ADJ-01)', () => {
  it('adjust everything below, keep alpha, and follow mask and opacity', () => {
    const doc = new Document(W, W, [
      createRasterLayer('ink', solid([200, 40, 90, 128])),
      createAdjustmentLayer('inv', { kind: 'invert' }),
    ]);
    expect(at(doc)).toEqual([55, 215, 165, 128]); // alpha untouched
    const inv = doc.layers[1]!;
    inv.opacity = 0.5;
    expect(at(doc)).toEqual([128, 128, 128, 128]);
    inv.opacity = 1;
    if (inv.type !== 'adjustment') throw new Error('expected an adjustment layer');
    // A hide-all mask with one revealing tile.
    const tile = createTile(new Uint8ClampedArray(TILE_BYTES).map((_, i) => (i % 4 === 3 ? 255 : 0)));
    inv.mask = { grid: new TileGrid(), background: 0, enabled: true, linked: true };
    expect(at(doc)).toEqual([200, 40, 90, 128]);
    inv.mask.grid.set('0,0', tile);
    expect(at(doc)).toEqual([55, 215, 165, 128]);
    inv.mask.enabled = false;
    expect(at(doc)).toEqual([55, 215, 165, 128]);
  });

  it('in an isolated group, adjust only the group; in a pass-through group, everything below', () => {
    const below = createRasterLayer('below', solid([200, 0, 0, 255]));
    const inner = createRasterLayer(
      'inner',
      TileGrid.fromRgba(
        W,
        W,
        new Uint8ClampedArray(W * W * 4).map((_, i) => (i % (W * 4) < 64 ? [0, 0, 255, 255][i % 4]! : 0)),
      ),
    );
    const group = createGroupLayer('g', [inner, createAdjustmentLayer('inv', { kind: 'invert' })], {
      passThrough: false,
    });
    const doc = new Document(W, W, [below, group]);
    expect(at(doc, 5, 5)).toEqual([255, 255, 0, 255]); // the inner blue, inverted
    expect(at(doc, 40, 5)).toEqual([200, 0, 0, 255]); // the red below is outside the group: untouched
    group.passThrough = true;
    expect(at(doc, 40, 5)).toEqual([55, 255, 255, 255]);
  });

  it('settings change by command; a drag is one undo step; snapshots keep them', () => {
    const adj = createAdjustmentLayer('Posterize 1', defaultAdjustment('posterize'));
    const doc = new Document(W, W, [createRasterLayer('bg', solid([100, 150, 200, 255])), adj]);
    const history = new History(doc, { maxSteps: 10, maxBytes: 1e9 }, () => undefined);
    const snap = captureState(doc);
    for (const levels of [3, 5, 8])
      history.execute(new SetAdjustmentCommand(adj.id, { kind: 'posterize', levels }), { coalesce: true });
    expect(history.entries().map((e) => e.label)).toEqual(['Posterize']);
    expect(doc.layer(adj.id)).toMatchObject({ adjustment: { levels: 8 } });
    history.undo();
    expect(doc.layer(adj.id)).toMatchObject({ adjustment: { levels: 4 } });
    history.redo();
    history.execute(restoreState(snap, 'Restore'));
    expect(doc.layer(adj.id)).toMatchObject({ adjustment: { levels: 4 } });
    expect(() => new SetAdjustmentCommand(doc.layers[0]!.id, { kind: 'invert' }).do(doc)).toThrow();
  });

  it('merge down bakes the adjustment into the layer below; nothing merges into an adjustment layer', () => {
    const doc = new Document(W, W, [
      createRasterLayer('bg', solid([200, 40, 90, 255])),
      createAdjustmentLayer('inv', { kind: 'invert' }),
      createRasterLayer('top', solid([0, 0, 0, 255])),
    ]);
    expect(mergeDownBlocker(doc, doc.layers[2]!.id)).toMatch(/adjustment layer/);
    mergeDown(doc, doc.layers[1]!.id)!.do(doc);
    expect(doc.layers.map((l) => l.type)).toEqual(['raster', 'raster']);
    expect(doc.raster(doc.layers[0]!.id).tiles.pixel(3, 3)).toEqual([55, 215, 165, 255]);
  });

  it('masks follow canvas changes: crop moves them, resampled grids replace them', () => {
    const tile = createTile(new Uint8ClampedArray(TILE_BYTES).map((_, i) => (i % 4 === 3 ? 77 : 0)));
    const mask = new TileGrid();
    mask.set('0,0', tile);
    const adj = createAdjustmentLayer(
      'inv',
      { kind: 'invert' },
      { mask: { grid: mask, background: 255, enabled: true, linked: true } },
    );
    const doc = new Document(W, W, [createRasterLayer('bg', solid([1, 2, 3, 255])), adj]);
    cropDocument(doc, { x: 10, y: 0, width: 40, height: 40 }, true)!.do(doc);
    const cropped = doc.masked(adj.id).mask!;
    expect(cropped.background).toBe(255);
    expect(cropped.grid.pixel(0, 0)[3]).toBe(77); // was x = 10
    const resampled = new TileGrid();
    resampled.set('0,0', createTile(new Uint8ClampedArray(TILE_BYTES).fill(200)));
    replacePixels('Image Size', new Map([[`${adj.id}#mask`, resampled]]), {
      width: 20,
      height: 20,
      guides: { horizontal: [], vertical: [] },
    }).do(doc);
    expect(doc.masked(adj.id).mask!.grid.pixel(3, 3)[3]).toBe(200);
  });

  it('duplicates share the settings but own their mask', () => {
    const adj = createAdjustmentLayer('inv', { kind: 'invert' });
    const doc = new Document(W, W, [createRasterLayer('bg', solid([1, 2, 3, 255])), adj]);
    duplicateLayer(doc, adj.id)!.do(doc);
    const copy = doc.layers[2]!;
    if (copy.type !== 'adjustment') throw new Error('expected an adjustment layer');
    expect(copy.adjustment).toBe(adj.adjustment);
    expect(copy.mask!.grid).not.toBe(adj.mask!.grid);
  });
});
