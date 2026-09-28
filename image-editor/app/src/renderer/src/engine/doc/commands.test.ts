import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { History } from '../history/history';
import { createTile, TILE_BYTES, TileGrid, type Tile } from '../tiles/tile';
import {
  AddLayerCommand,
  DeleteLayerCommand,
  PaintTilesCommand,
  SetActiveLayerCommand,
  SetLayerPropsCommand,
  type Command,
} from './commands';
import { createRasterLayer, Document } from './document';

function tile(value: number): Tile {
  return createTile(new Uint8ClampedArray(TILE_BYTES).fill(value));
}

function newDoc() {
  return new Document(
    512,
    512,
    createRasterLayer('Background', TileGrid.filled(512, 512, [255, 255, 255, 255])),
  );
}

/** Snapshot of everything observable about a document (tile references, not copies). */
function snapshot(doc: Document) {
  return {
    active: doc.activeLayerId,
    layers: doc.layers.map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      tiles: [...l.tiles.entries()].map(([k, t]) => [k, t.id]).sort(),
    })),
  };
}

describe('commands + history', () => {
  it('paints and undoes by swapping tile references', () => {
    const doc = newDoc();
    const history = new History(doc);
    const layer = doc.activeLayer;
    const before = layer.tiles.get('0,0');
    const painted = tile(7);
    history.execute(
      new PaintTilesCommand('Brush', layer.id, new Map([['0,0', before]]), new Map([['0,0', painted]])),
    );
    expect(layer.tiles.get('0,0')).toBe(painted);
    history.undo();
    expect(layer.tiles.get('0,0')).toBe(before);
    history.redo();
    expect(layer.tiles.get('0,0')).toBe(painted);
    expect(history.sizeBytes).toBe(2 * TILE_BYTES);
  });

  it('adds, deletes and reorders layers with correct active layer bookkeeping', () => {
    const doc = newDoc();
    const history = new History(doc);
    const bg = doc.activeLayerId;
    const add = new AddLayerCommand('Layer 1', 1);
    history.execute(add);
    expect(doc.layers.map((l) => l.name)).toEqual(['Background', 'Layer 1']);
    expect(doc.activeLayerId).toBe(add.layerId);
    history.execute(new DeleteLayerCommand(add.layerId));
    expect(doc.layers).toHaveLength(1);
    expect(doc.activeLayerId).toBe(bg);
    history.undo();
    expect(doc.activeLayerId).toBe(add.layerId);
    expect(() => new DeleteLayerCommand(bg).do(new Document(1, 1, createRasterLayer('only')))).toThrow();
  });

  it('coalesces slider changes into one step only while coalescing', () => {
    const doc = newDoc();
    const history = new History(doc);
    const id = doc.activeLayerId;
    for (const opacity of [0.9, 0.8, 0.5])
      history.execute(new SetLayerPropsCommand(id, { opacity }), { coalesce: true });
    history.endCoalesce();
    history.execute(new SetLayerPropsCommand(id, { opacity: 0.2 }), { coalesce: true });
    expect(history.entries()).toHaveLength(2);
    history.undo();
    expect(doc.activeLayer.opacity).toBe(0.5);
    history.undo();
    expect(doc.activeLayer.opacity).toBe(1);
  });

  it('never merges visibility toggles', () => {
    const doc = newDoc();
    const history = new History(doc);
    const id = doc.activeLayerId;
    history.execute(new SetLayerPropsCommand(id, { visible: false }), { coalesce: true });
    history.execute(new SetLayerPropsCommand(id, { visible: true }), { coalesce: true });
    expect(history.entries()).toHaveLength(2);
  });

  it('drops the oldest steps beyond the step and byte budgets', () => {
    const doc = newDoc();
    const history = new History(doc, { maxSteps: 3, maxBytes: 5 * TILE_BYTES });
    const id = doc.activeLayerId;
    for (let i = 0; i < 5; i++)
      history.execute(
        new PaintTilesCommand('Brush', id, new Map([['0,0', undefined]]), new Map([['0,0', tile(i)]])),
      );
    expect(history.entries()).toHaveLength(3);
    expect(history.sizeBytes).toBeLessThanOrEqual(5 * TILE_BYTES);
  });

  it('discards the redo branch on a new action and supports goTo', () => {
    const doc = newDoc();
    const history = new History(doc);
    const id = doc.activeLayerId;
    const paint = (v: number) =>
      new PaintTilesCommand(
        `P${v}`,
        id,
        new Map([['1,1', doc.activeLayer.tiles.get('1,1')]]),
        new Map([['1,1', tile(v)]]),
      );
    history.execute(paint(1));
    history.execute(paint(2));
    history.goTo(-1);
    expect(history.position).toBe(-1);
    expect(history.entries().map((e) => e.label)).toEqual(['P1', 'P2']);
    history.goTo(0);
    history.execute(paint(3));
    expect(history.entries().map((e) => e.label)).toEqual(['P1', 'P3']);
    expect(history.canRedo).toBe(false);
  });

  it('property: any sequence of commands undone completely restores the initial document', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 40 }), (ops) => {
        const doc = newDoc();
        const history = new History(doc);
        const initial = snapshot(doc);
        for (const op of ops) {
          const layer = doc.activeLayer;
          const cmds: Command[] = [
            new AddLayerCommand('L', doc.layers.length),
            new PaintTilesCommand(
              'P',
              layer.id,
              new Map([['0,1', layer.tiles.get('0,1')]]),
              new Map([['0,1', tile(op)]]),
            ),
            new SetLayerPropsCommand(layer.id, { opacity: op / 5 }),
            new SetLayerPropsCommand(layer.id, { visible: op % 2 === 0 }),
            new SetActiveLayerCommand(doc.layers[0]!.id),
            new DeleteLayerCommand(layer.id),
          ];
          const cmd = cmds[op]!;
          if (cmd instanceof DeleteLayerCommand && doc.layers.length === 1) continue;
          history.execute(cmd);
        }
        while (history.undo());
        expect(snapshot(doc)).toEqual(initial);
      }),
    );
  });
});
