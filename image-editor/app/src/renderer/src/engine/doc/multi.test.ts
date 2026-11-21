import { describe, expect, it } from 'vitest';
import { History } from '../history/history';
import { contentBounds } from '../ops/canvas';
import { createTile, TILE_BYTES, TileGrid } from '../tiles/tile';
import { createGroupLayer, createRasterLayer, Document, type Layer } from './document';
import { alignLayers, deleteLayers, distributeLayers, groupLayers, topSelected } from './multi';
import { translateMoves } from './translate';

/** A layer with an opaque box at [x0, x1) × [y0, y1) inside tile 0,0. */
function box(name: string, x0: number, y0: number, x1: number, y1: number) {
  const data = new Uint8ClampedArray(TILE_BYTES);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([0, 0, 0, 255], (y * 256 + x) * 4);
  const grid = new TileGrid();
  grid.set('0,0', createTile(data));
  return createRasterLayer(name, grid);
}

const bounds = (d: Document, id: string) => contentBounds([d.raster(id).tiles]);
const names = (layers: Layer[]): unknown[] =>
  layers.map((l) => (l.type === 'group' ? { [l.name]: names(l.children) } : l.name));

function doc() {
  const a = box('a', 10, 10, 30, 30);
  const b = box('b', 60, 40, 100, 60);
  const c = box('c', 200, 20, 220, 40);
  const d = new Document(256, 256, [createRasterLayer('bg'), a, b, c]);
  return { d, a: a.id, b: b.id, c: c.id };
}

describe('several layers at once (FR-LAY-08)', () => {
  it('ignores children of selected groups and keeps stacking order', () => {
    const inner = box('inner', 0, 0, 5, 5);
    const g = createGroupLayer('g', [inner]);
    const top = box('top', 0, 0, 5, 5);
    const d = new Document(64, 64, [g, top]);
    expect(topSelected(d, [top.id, inner.id, g.id])).toEqual([g.id, top.id]);
  });

  it('moves several layers by their own offsets in one undo step', () => {
    const { d, a, b } = doc();
    const history = new History(d);
    history.execute(
      translateMoves(d, [
        { id: a, dx: 5, dy: 0 },
        { id: b, dx: 0, dy: 7 },
      ])!,
    );
    expect(bounds(d, a)!.x0).toBe(15);
    expect(bounds(d, b)!.y0).toBe(47);
    history.undo();
    expect([bounds(d, a)!.x0, bounds(d, b)!.y0]).toEqual([10, 40]);
  });

  it('aligns to the edges and centres of the selection', () => {
    const { d, a, b, c } = doc();
    // a spans y 10–30 and b 40–60: centred on their combined bounds (10–60), both span 25–45.
    alignLayers(d, [a, b], 'vcenter')!.do(d);
    expect([bounds(d, a)!.y0, bounds(d, b)!.y0]).toEqual([25, 25]);
    alignLayers(d, [a, b, c], 'left')!.do(d);
    expect([a, b, c].map((id) => bounds(d, id)!.x0)).toEqual([10, 10, 10]);
    alignLayers(d, [a, b, c], 'bottom')!.do(d);
    expect([a, b, c].map((id) => bounds(d, id)!.y1)).toEqual([45, 45, 45]); // the lowest bottom after centring
    expect(alignLayers(d, [a, b, c], 'bottom')).toBeNull(); // already aligned: nothing moves
    expect(alignLayers(d, [a], 'left')).toBeNull(); // needs two
  });

  it('distributes the middle layers evenly between the outer two', () => {
    const { d, a, b, c } = doc();
    distributeLayers(d, [c, a, b], 'left')!.do(d);
    // left edges at 10 … 200: b goes to 105
    expect([a, b, c].map((id) => bounds(d, id)!.x0)).toEqual([10, 105, 200]);
    distributeLayers(d, [a, b, c], 'vcenter')!.do(d);
    // Centres: a 20, c 30, b 50: the outer two stay, c moves to the middle.
    const centre = (id: string) => (bounds(d, id)!.y0 + bounds(d, id)!.y1) / 2;
    expect([centre(a), centre(c), centre(b)]).toEqual([20, 35, 50]);
    expect(distributeLayers(d, [a, b], 'left')).toBeNull(); // needs three
  });

  it('groups several layers where the topmost was, keeping their order', () => {
    const { d, a, c } = doc();
    groupLayers(d, [c, a])!.do(d);
    expect(names(d.layers)).toEqual(['bg', 'b', { 'Group 1': ['a', 'c'] }]);
    expect(d.activeLayer.name).toBe('Group 1');
  });

  it('deletes several layers, never all of them', () => {
    const { d, a, b, c } = doc();
    const history = new History(d);
    history.execute(deleteLayers(d, [a, c])!);
    expect(names(d.layers)).toEqual(['bg', 'b']);
    history.undo();
    expect(names(d.layers)).toEqual(['bg', 'a', 'b', 'c']);
    expect(
      deleteLayers(
        d,
        d.layers.map((l) => l.id),
      ),
    ).toBeNull();
    expect(b).toBeTruthy();
  });
});
