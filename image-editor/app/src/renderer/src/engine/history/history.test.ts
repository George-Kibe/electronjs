import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AddLayerCommand,
  DeleteLayerCommand,
  PaintTilesCommand,
  SetActiveLayerCommand,
  SetLayerPropsCommand,
  SetSelectionCommand,
  type Command,
} from '../doc/commands';
import { createGroupLayer, createRasterLayer, Document, type Layer } from '../doc/document';
import { cropDocument, flipCanvas, resizeCanvas, rotateCanvas } from '../doc/geometry';
import {
  duplicateLayer,
  flattenImage,
  groupLayer,
  mergeDown,
  mergeVisible,
  nudgeLayer,
  ungroupLayer,
} from '../doc/layer-ops';
import { ellipseMask, Mask, rectMask } from '../doc/selection';
import { translateLayer } from '../doc/translate';
import { createTile, TILE_BYTES, TileGrid } from '../tiles/tile';
import { History } from './history';
import { captureState, collectTileIds, restoreState } from './snapshots';

const W = 300;
const H = 200;

const tile = (v: number) => createTile(new Uint8ClampedArray(TILE_BYTES).fill(v));

function newDoc(): Document {
  const d = new Document(W, H, [
    createRasterLayer('bg', TileGrid.filled(W, H, [255, 255, 255, 255])),
    createRasterLayer('ink', TileGrid.filled(120, 90, [10, 20, 30, 200])),
  ]);
  d.meta.guides = { horizontal: [40], vertical: [60] };
  return d;
}

/** Masks are immutable values: undo must bring back the very same object, so compare identities. */
const maskIds = new WeakMap<Mask, number>();
let nextMaskId = 1;
const maskId = (m: Mask | null) => {
  if (!m) return null;
  if (!maskIds.has(m)) maskIds.set(m, nextMaskId++);
  return maskIds.get(m)!;
};

/** Everything observable: size, guides, selection, tree structure, props and tile identities. */
function state(d: Document): unknown {
  const layer = (l: Layer): unknown => {
    const { id, name, visible, opacity, fillOpacity, blendMode, locks } = l;
    const props = { id, name, visible, opacity, fillOpacity, blendMode, locks: { ...locks } };
    if (l.type === 'group') return { ...props, pt: l.passThrough, children: l.children.map(layer) };
    if (l.type === 'adjustment') return { ...props, adjustment: l.adjustment };
    return { ...props, tiles: [...l.tiles.entries()].map(([k, t]) => `${k}=${t.id}`).sort() };
  };
  return {
    size: [d.width, d.height],
    guides: structuredClone(d.meta.guides),
    active: d.activeLayerId,
    selection: maskId(d.selection),
    layers: d.layers.map(layer),
  };
}

/** One of many command kinds against the current document, or null when it does not apply. */
function command(d: Document, op: number, v: number, history: History): Command | null {
  const active = d.activeLayer;
  const raster = active.type === 'raster' ? active : null;
  switch (op % 18) {
    case 0:
      return (
        raster &&
        new PaintTilesCommand(
          'P',
          raster.id,
          new Map([['0,0', raster.tiles.get('0,0')]]),
          new Map([['0,0', tile(v)]]),
        )
      );
    case 1:
      return new AddLayerCommand(`L${v}`, d.layers.length);
    case 2:
      return d.layers.length > 1 && d.locate(active.id).parent === null
        ? new DeleteLayerCommand(active.id)
        : null;
    case 3:
      return new SetLayerPropsCommand(active.id, {
        opacity: (v % 10) / 10,
        blendMode: v % 2 ? 'multiply' : 'normal',
      });
    case 4:
      return new SetActiveLayerCommand(d.allLayers()[v % d.allLayers().length]!.id);
    case 5:
      return duplicateLayer(d, active.id);
    case 6:
      return groupLayer(d, active.id);
    case 7:
      return ungroupLayer(d, active.id);
    case 8:
      return nudgeLayer(d, active.id, v % 2 ? 1 : -1);
    case 9:
      return mergeDown(d, active.id);
    case 10:
      return v % 3
        ? translateLayer(d, active.id, (v % 7) - 3, (v % 5) - 2, v % 2 ? 'Nudge' : 'Move')
        : mergeVisible(d);
    case 11:
      return rotateCanvas(d, ((v % 3) + 1) as 1 | 2 | 3);
    case 12:
      return flipCanvas(d, v % 2 ? 'horizontal' : 'vertical');
    case 13:
      return cropDocument(
        d,
        { x: v % 20, y: v % 15, width: Math.max(10, d.width - 30), height: Math.max(10, d.height - 20) },
        v % 2 === 0,
      );
    case 14:
      return resizeCanvas(d, d.width + (v % 40) - 10, d.height + (v % 30) - 10, { x: 0.5, y: v % 2 ? 0 : 1 });
    case 15:
      return v % 4 === 0 ? flattenImage(d) : null;
    case 16: {
      // Selections: new, combined with the current one, or none (FR-SEL-01..05).
      const shape =
        v % 2
          ? rectMask({ x0: v % 50, y0: v % 40, x1: 60 + (v % 90), y1: 50 + (v % 70) }, d.width, d.height)
          : ellipseMask({ x0: v % 30, y0: v % 20, x1: 80 + (v % 60), y1: 70 + (v % 50) }, d.width, d.height);
      if (v % 5 === 0) return new SetSelectionCommand('Deselect', null);
      const base = d.selection ?? Mask.empty(d.width, d.height);
      return new SetSelectionCommand(
        'Select',
        base.combine((['replace', 'add', 'subtract', 'intersect'] as const)[v % 4]!, shape),
      );
    }
    default:
      // Restoring a snapshot taken a few steps ago.
      return restoreState(snapshotOf(history, d), 'Restore Snapshot');
  }
}

const snapshots = new WeakMap<History, ReturnType<typeof captureState>>();
function snapshotOf(history: History, d: Document) {
  let s = snapshots.get(history);
  if (!s) snapshots.set(history, (s = captureState(d)));
  return s;
}

function run(ops: Array<[number, number]>, undoEvery = 0) {
  const doc = newDoc();
  const history = new History(doc, { maxSteps: 10_000, maxBytes: 1024 ** 4 });
  const initial = state(doc);
  ops.forEach(([op, v], i) => {
    const cmd = command(doc, op, v, history);
    if (cmd) history.execute(cmd, { coalesce: op % 18 === 10 });
    if (undoEvery && i % undoEvery === undoEvery - 1) {
      // Interleave undo/redo: the redo branch must reproduce exactly.
      const before = state(doc);
      if (history.undo()) {
        history.redo();
        expect(state(doc)).toEqual(before);
      }
    }
  });
  const final = state(doc);
  while (history.undo());
  expect(state(doc)).toEqual(initial);
  while (history.redo());
  expect(state(doc)).toEqual(final);
}

describe('history (T-HIS-01)', () => {
  it('property: random command sequences of every kind undo to the initial state and redo to the final one', () => {
    const op = fc.tuple(fc.nat(17), fc.nat(1000));
    fc.assert(
      fc.property(fc.array(op, { maxLength: 40 }), fc.integer({ min: 0, max: 5 }), (ops, undoEvery) =>
        run(ops, undoEvery),
      ),
      { numRuns: 60 },
    );
  }, 60_000);

  it('500 random commands, then undo all, restores the document exactly', () => {
    const ops = fc.sample(fc.tuple(fc.nat(17), fc.nat(1000)), { numRuns: 500, seed: 42 });
    run(ops);
  }, 60_000);

  it('limits can change at runtime and drop the oldest steps', () => {
    const doc = newDoc();
    const history = new History(doc, { maxSteps: 100, maxBytes: 1024 ** 3 });
    for (let i = 0; i < 30; i++)
      history.execute(new SetLayerPropsCommand(doc.activeLayerId, { name: `n${i}` }));
    history.setLimits({ maxSteps: 20 });
    expect(history.entries()).toHaveLength(20);
    expect(history.limits.maxSteps).toBe(20);
  });
});

describe('snapshots (FR-HIS-02)', () => {
  it('restoring is undoable, and later edits never change the snapshot', () => {
    const doc = newDoc();
    const history = new History(doc);
    const snap = captureState(doc);
    const initial = state(doc);
    const ink = doc.layers[1]!.id;
    history.execute(
      new PaintTilesCommand('P', ink, new Map([['0,0', undefined]]), new Map([['0,0', tile(9)]])),
    );
    history.execute(rotateCanvas(doc, 1));
    const edited = state(doc);
    history.execute(restoreState(snap, 'Snapshot 1'));
    expect(state(doc)).toEqual(initial);
    // Painting after the restore mutates the live grid, not the snapshot's copy.
    history.execute(
      new PaintTilesCommand(
        'P',
        ink,
        new Map([['0,0', doc.raster(ink).tiles.get('0,0')]]),
        new Map([['0,0', tile(3)]]),
      ),
    );
    history.execute(restoreState(snap, 'Snapshot 1'));
    expect(state(doc)).toEqual(initial);
    history.undo();
    history.undo();
    history.undo();
    expect(state(doc)).toEqual(edited);
  });
});

describe('memory accounting (FR-NAV-06)', () => {
  it('counts each distinct tile once: pixels, masks and groups, shared tiles once', () => {
    const shared = tile(1);
    const a = createRasterLayer('a');
    a.tiles.set('0,0', shared);
    a.tiles.set('1,0', tile(2));
    const maskGrid = new TileGrid();
    maskGrid.set('0,0', tile(3));
    maskGrid.set('1,0', shared);
    a.mask = { grid: maskGrid, background: 255, enabled: true, linked: true };
    const b = createRasterLayer('b');
    b.tiles.set('0,0', shared);
    const ids = collectTileIds([a, createGroupLayer('g', [b])], new Set());
    expect(ids.size).toBe(3);
  });

  it('a snapshot owns a copy of each mask grid', () => {
    const doc = newDoc();
    const ink = doc.raster(doc.layers[1]!.id);
    ink.mask = { grid: new TileGrid(), background: 0, enabled: true, linked: true };
    const snap = captureState(doc);
    ink.mask.grid.set('0,0', tile(7));
    const copy = snap.layers[1]!;
    expect(copy.type === 'raster' && copy.mask?.grid.get('0,0')).toBeFalsy();
  });
});
