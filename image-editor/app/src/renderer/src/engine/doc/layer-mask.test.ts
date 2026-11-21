import { describe, expect, it } from 'vitest';
import { History } from '../history/history';
import { captureState, restoreState } from '../history/snapshots';
import { createTile, TILE_BYTES, TileGrid } from '../tiles/tile';
import { PaintTilesCommand, SetLayerMaskCommand } from './commands';
import { copyMask, createRasterLayer, Document, maskAt, type LayerMask } from './document';
import { compositePixel, liveLayers } from './flatten';
import { cropDocument, replacePixels, rotateCanvas } from './geometry';
import { fromGrid, runOpsJob, toGrid } from '../ops/jobs';
import { duplicateLayer } from './layer-ops';
import { translateLayer } from './translate';

const W = 300;
const H = 200;

/** A mask tile: coverage `v` in the alpha channel. */
const maskTile = (v: number) => {
  const data = new Uint8ClampedArray(TILE_BYTES);
  for (let i = 3; i < data.length; i += 4) data[i] = v;
  return createTile(data);
};

/** Hide-all mask that shows only the left half of tile 0,0 (x < 128). */
function halfMask(): LayerMask {
  const data = new Uint8ClampedArray(TILE_BYTES);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 128; x++) data[(y * 256 + x) * 4 + 3] = 255;
  const grid = new TileGrid();
  grid.set('0,0', createTile(data));
  return { grid, background: 0, enabled: true, linked: true };
}

function doc() {
  const d = new Document(W, H, [
    createRasterLayer('bg', TileGrid.filled(W, H, [255, 255, 255, 255])),
    createRasterLayer('red', TileGrid.filled(W, H, [255, 0, 0, 255])),
  ]);
  return { d, red: d.layers[1]!.id };
}

const pixel = (d: Document, x: number, y: number) => compositePixel(liveLayers(d.layers), x, y);

describe('layer masks (FR-LAY-04)', () => {
  it('a mask hides the layer where it is 0 and shows it where it is 255', () => {
    const { d, red } = doc();
    new SetLayerMaskCommand('Add Mask', red, halfMask()).do(d);
    expect(pixel(d, 10, 10)).toEqual([255, 0, 0, 255]); // shown
    expect(pixel(d, 200, 10)).toEqual([255, 255, 255, 255]); // hidden (no tile: background 0)
    expect(pixel(d, 290, 190)).toEqual([255, 255, 255, 255]);
  });

  it('partial coverage blends, and a disabled mask shows everything', () => {
    const { d, red } = doc();
    const grid = new TileGrid();
    grid.set('0,0', maskTile(128));
    new SetLayerMaskCommand('Add Mask', red, { grid, background: 255, enabled: true, linked: true }).do(d);
    expect(pixel(d, 10, 10)).toEqual([255, 127, 127, 255]);
    expect(pixel(d, 280, 10)).toEqual([255, 0, 0, 255]); // background 255 outside the tile
    const off = { ...d.raster(red).mask!, enabled: false };
    new SetLayerMaskCommand('Disable Mask', red, off).do(d);
    expect(pixel(d, 10, 10)).toEqual([255, 0, 0, 255]);
  });

  it('commands undo and redo exactly, including mask painting', () => {
    const { d, red } = doc();
    const history = new History(d);
    const mask = halfMask();
    history.execute(new SetLayerMaskCommand('Add Mask', red, mask));
    const before = mask.grid.get('0,0');
    history.execute(
      new PaintTilesCommand(
        'Brush',
        red,
        new Map([['0,0', before]]),
        new Map([['0,0', maskTile(255)]]),
        'mask',
      ),
    );
    expect(maskAt(d.raster(red).mask!, 200, 10)).toBe(255);
    expect(d.raster(red).tiles.get('0,0')!.data[3]).toBe(255); // the pixels are untouched
    history.undo();
    expect(maskAt(d.raster(red).mask!, 200, 10)).toBe(0);
    history.undo();
    expect(d.raster(red).mask).toBeFalsy();
    history.redo();
    history.redo();
    expect(maskAt(d.raster(red).mask!, 200, 10)).toBe(255);
  });

  it('canvas changes transform the mask with the pixels', () => {
    const { d, red } = doc();
    const history = new History(d);
    history.execute(new SetLayerMaskCommand('Add Mask', red, halfMask()));
    history.execute(rotateCanvas(d, 1)); // 90° clockwise: the left half becomes the top half
    expect([d.width, d.height]).toEqual([H, W]);
    expect(maskAt(d.raster(red).mask!, 100, 10)).toBe(255);
    expect(maskAt(d.raster(red).mask!, 100, 250)).toBe(0);
    history.undo();
    history.execute(cropDocument(d, { x: 100, y: 0, width: 100, height: 100 }, true)!);
    expect(maskAt(d.raster(red).mask!, 10, 10)).toBe(255); // was x = 110
    expect(maskAt(d.raster(red).mask!, 40, 10)).toBe(0); // was x = 140
  });

  it('a linked mask moves with the layer; an unlinked one stays', () => {
    const { d, red } = doc();
    new SetLayerMaskCommand('Add Mask', red, halfMask()).do(d);
    translateLayer(d, red, 50, 0)!.do(d);
    expect(maskAt(d.raster(red).mask!, 170, 10)).toBe(255); // was 120
    const unlinked = { ...d.raster(red).mask!, linked: false };
    new SetLayerMaskCommand('Unlink', red, unlinked).do(d);
    translateLayer(d, red, 50, 0)!.do(d);
    expect(maskAt(d.raster(red).mask!, 170, 10)).toBe(255); // unchanged
  });

  it('a duplicate and a snapshot own their mask grids', () => {
    const { d, red } = doc();
    const history = new History(d);
    history.execute(new SetLayerMaskCommand('Add Mask', red, halfMask()));
    const snap = captureState(d);
    history.execute(duplicateLayer(d, red)!);
    const copy = d.activeLayer.id;
    expect(copy).not.toBe(red);
    const paint = (id: string) =>
      history.execute(
        new PaintTilesCommand(
          'Brush',
          id,
          new Map([['0,0', d.raster(id).mask!.grid.get('0,0')]]),
          new Map([['0,0', maskTile(255)]]),
          'mask',
        ),
      );
    paint(copy);
    expect(maskAt(d.raster(copy).mask!, 200, 10)).toBe(255);
    expect(maskAt(d.raster(red).mask!, 200, 10)).toBe(0); // the original is unchanged
    paint(red);
    history.execute(restoreState(snap, 'Snapshot'));
    expect(maskAt(d.raster(red).mask!, 200, 10)).toBe(0); // the snapshot kept its own copy
  });

  it('pixel jobs (Image Size) resample the mask with the pixels', () => {
    const { d, red } = doc();
    const mask = halfMask();
    new SetLayerMaskCommand('Add Mask', red, mask).do(d);
    const result = runOpsJob({
      op: 'resample',
      layers: [fromGrid(red, d.raster(red).tiles), fromGrid(`${red}#mask`, mask.grid)],
      src: { width: W, height: H },
      dst: { width: 150, height: 100 },
      filter: 'bilinear',
    });
    const grids = new Map(result.map((l) => [l.id, toGrid(l.tiles)]));
    replacePixels('Image Size', grids, {
      width: 150,
      height: 100,
      guides: { horizontal: [], vertical: [] },
    }).do(d);
    expect(maskAt(d.raster(red).mask!, 30, 10)).toBe(255); // was x = 60
    expect(maskAt(d.raster(red).mask!, 100, 10)).toBe(0); // was x = 200
  });

  it('copyMask shares tiles but not the grid', () => {
    const m = halfMask();
    const c = copyMask(m);
    expect(c.grid).not.toBe(m.grid);
    expect(c.grid.get('0,0')).toBe(m.grid.get('0,0'));
  });
});
