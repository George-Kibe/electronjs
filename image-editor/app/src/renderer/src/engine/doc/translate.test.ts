import { tileRange } from '@shared/iep-schema';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { History } from '../history/history';
import { createTile, TILE_BYTES, TileGrid } from '../tiles/tile';
import { createGroupLayer, createRasterLayer, Document, type RasterLayer } from './document';
import {
  alignOffset,
  contentBounds,
  layerAt,
  moveBlocker,
  translateGrid,
  translateLayer,
  TranslateCommand,
} from './translate';

const W = 600;
const H = 400;

/** A grid with a w×h rectangle at (x, y) whose pixels encode their own position (so shifts are visible). */
function rect(x: number, y: number, w: number, h: number): TileGrid {
  const rgba = new Uint8Array(W * H * 4);
  for (let py = y; py < y + h; py++)
    for (let px = x; px < x + w; px++)
      rgba.set([px % 256, py % 256, (px + py) % 251, 255], (py * W + px) * 4);
  return TileGrid.fromRgba(W, H, rgba);
}

/** Every non-transparent pixel as "x,y:rgba" (order-independent comparison of grids). */
function pixels(grid: TileGrid): Set<string> {
  const out = new Set<string>();
  for (const [key, tile] of grid.entries()) {
    const [tx, ty] = key.split(',').map(Number) as [number, number];
    for (let i = 0; i < TILE_BYTES; i += 4) {
      if (tile.data[i + 3] === 0) continue;
      const p = i / 4;
      out.add(
        `${tx * 256 + (p % 256)},${ty * 256 + Math.floor(p / 256)}:${tile.data.subarray(i, i + 4).join()}`,
      );
    }
  }
  return out;
}

const shift = (set: Set<string>, dx: number, dy: number) =>
  new Set(
    [...set].map((s) => {
      const [pos, rgba] = s.split(':') as [string, string];
      const [x, y] = pos.split(',').map(Number) as [number, number];
      return `${x + dx},${y + dy}:${rgba}`;
    }),
  );

const range = tileRange(W, H);

describe('translateGrid (FR-TRF-07)', () => {
  it('moves every pixel by the offset, across tile boundaries', () => {
    const grid = rect(250, 10, 20, 300);
    expect(pixels(translateGrid(grid, 13, -7, range))).toEqual(shift(pixels(grid), 13, -7));
  });

  it('keeps pixels moved off the canvas, so moving back restores them exactly', () => {
    const grid = rect(10, 10, 100, 50);
    const away = translateGrid(grid, -60, -30, range);
    expect([...away.keys()].some((k) => k.startsWith('-1,'))).toBe(true);
    expect(pixels(translateGrid(away, 60, 30, range))).toEqual(pixels(grid));
  });

  it('drops pixels beyond one canvas of margin', () => {
    const grid = rect(0, 0, 10, 10);
    expect(translateGrid(grid, -W - 300, 0, range).size).toBe(0);
  });

  it('shares tiles when the offset is a whole number of tiles', () => {
    const grid = rect(0, 0, 300, 300);
    const moved = translateGrid(grid, 256, -256, range);
    expect(moved.get('1,-1')).toBe(grid.get('0,0'));
  });

  it('property: translating by (dx, dy) then (−dx, −dy) is the identity within the margin', () => {
    fc.assert(
      fc.property(fc.integer({ min: -500, max: 500 }), fc.integer({ min: -350, max: 350 }), (dx, dy) => {
        const grid = rect(200, 120, 70, 90);
        const back = translateGrid(translateGrid(grid, dx, dy, range), -dx, -dy, range);
        expect(pixels(back)).toEqual(pixels(grid));
      }),
      { numRuns: 25 },
    );
  });
});

describe('TranslateCommand', () => {
  it('do → undo → redo round trip with pixel equality, and coalesces nudges into one step', () => {
    const layer = createRasterLayer('A', rect(30, 40, 50, 60));
    const d = new Document(W, H, [createRasterLayer('bg'), layer]);
    const original = pixels(layer.tiles);
    const history = new History(d);
    history.execute(translateLayer(d, layer.id, 1, 0, 'Nudge')!, { coalesce: true });
    history.execute(translateLayer(d, layer.id, 10, 0, 'Nudge')!, { coalesce: true });
    history.execute(translateLayer(d, layer.id, 0, -1, 'Nudge')!, { coalesce: true });
    expect(history.entries()).toHaveLength(1);
    const moved = pixels(layer.tiles);
    expect(moved).toEqual(shift(original, 11, -1));
    history.undo();
    expect(pixels(layer.tiles)).toEqual(original);
    history.redo();
    expect(pixels(layer.tiles)).toEqual(moved);
  });

  it('moves every raster layer inside a group, hidden ones included', () => {
    const a = createRasterLayer('a', rect(0, 0, 10, 10));
    const b = createRasterLayer('b', rect(100, 100, 10, 10), { visible: false });
    const g = createGroupLayer('g', [a, b]);
    const d = new Document(W, H, [g]);
    translateLayer(d, g.id, 5, 6)!.do(d);
    expect(contentBounds([a.tiles])).toEqual({ x0: 5, y0: 6, x1: 15, y1: 16 });
    expect(contentBounds([b.tiles])).toEqual({ x0: 105, y0: 106, x1: 115, y1: 116 });
  });

  it('counts only new tiles against the history budget', () => {
    const layer = createRasterLayer('A', rect(0, 0, 300, 300));
    const d = new Document(W, H, layer);
    expect(translateLayer(d, layer.id, 256, 0)!.sizeBytes()).toBeLessThan(TILE_BYTES);
    expect(translateLayer(d, layer.id, 3, 0)!.sizeBytes()).toBeGreaterThanOrEqual(4 * TILE_BYTES);
  });

  it('does not merge moves of different layers', () => {
    const a = createRasterLayer('a', rect(0, 0, 10, 10));
    const b = createRasterLayer('b', rect(0, 0, 10, 10));
    const d = new Document(W, H, [a, b]);
    const ma = translateLayer(d, a.id, 1, 0, 'Nudge') as TranslateCommand;
    expect(ma.mergeWith(translateLayer(d, b.id, 1, 0, 'Nudge')!)).toBeNull();
  });
});

describe('moveBlocker / alignOffset / layerAt', () => {
  it('refuses position-locked layers, groups containing one, and empty layers', () => {
    const locked = createRasterLayer('l', rect(0, 0, 5, 5), {
      locks: { all: false, pixels: false, position: true, transparency: false },
    });
    const g = createGroupLayer('g', [locked]);
    const empty = createRasterLayer('e');
    const d = new Document(W, H, [g, empty]);
    expect(moveBlocker(d, locked.id)).toMatch(/locked/);
    expect(moveBlocker(d, g.id)).toMatch(/in this group is locked/);
    expect(moveBlocker(d, empty.id)).toMatch(/empty/);
    expect(translateLayer(d, locked.id, 1, 1)).toBeNull();
  });

  it('aligns content bounds to the canvas edges and centre', () => {
    const layer = createRasterLayer('A', rect(30, 40, 50, 60));
    const d = new Document(W, H, layer);
    expect(alignOffset(d, layer.id, 'left')).toEqual([-30, 0]);
    expect(alignOffset(d, layer.id, 'right')).toEqual([W - 80, 0]);
    expect(alignOffset(d, layer.id, 'hcenter')).toEqual([(W - 50) / 2 - 30, 0]);
    expect(alignOffset(d, layer.id, 'top')).toEqual([0, -40]);
    expect(alignOffset(d, layer.id, 'bottom')).toEqual([0, H - 100]);
    expect(alignOffset(d, layer.id, 'vcenter')).toEqual([0, (H - 60) / 2 - 40]);
  });

  it('picks the topmost visible layer with a pixel under the pointer', () => {
    const bg = createRasterLayer('bg', TileGrid.filled(W, H, [255, 255, 255, 255]));
    const top = createRasterLayer('top', rect(100, 100, 20, 20));
    const hidden = createRasterLayer('hidden', rect(0, 0, W, H), { visible: false });
    const g = createGroupLayer('g', [top]);
    const d = new Document(W, H, [bg, g, hidden]);
    expect(layerAt(d, 110, 110, 'layer')).toBe(top.id);
    expect(layerAt(d, 110, 110, 'group')).toBe(g.id);
    expect(layerAt(d, 5, 5, 'layer')).toBe(bg.id);
    expect(layerAt(d, -1, 5, 'layer')).toBeNull();
  });

  it('reads pixels at negative coordinates from off-canvas tiles', () => {
    const grid = new TileGrid();
    const data = new Uint8ClampedArray(TILE_BYTES);
    data.set([1, 2, 3, 4], (255 * 256 + 255) * 4);
    grid.set('-1,-1', createTile(data));
    expect(grid.pixel(-1, -1)).toEqual([1, 2, 3, 4]);
    expect((createRasterLayer('x', grid) as RasterLayer).tiles.pixel(0, 0)).toEqual([0, 0, 0, 0]);
  });
});
