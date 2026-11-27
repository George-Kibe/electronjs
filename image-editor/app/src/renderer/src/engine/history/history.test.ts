import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AddLayerCommand,
  DeleteLayerCommand,
  PaintTilesCommand,
  SetActiveLayerCommand,
  SetLayerPropsCommand,
  SetSelectionCommand,
  layerGrids,
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
import { createTile, TILE_BYTES, TileGrid, type Tile } from '../tiles/tile';
import { History, SPILL_READ_FAILED, SPILL_WRITE_FAILED } from './history';
import { isSpilled, TileVault, type SpillStore } from './spill';
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
function state(d: Document, tileLabel: (t: Tile) => string | number = (t) => t.id): unknown {
  const layer = (l: Layer): unknown => {
    const { id, name, visible, opacity, fillOpacity, blendMode, locks } = l;
    const props = { id, name, visible, opacity, fillOpacity, blendMode, locks: { ...locks } };
    if (l.type === 'group') return { ...props, pt: l.passThrough, children: l.children.map(layer) };
    if (l.type === 'adjustment') return { ...props, adjustment: l.adjustment };
    const mask = l.mask ? [...l.mask.grid.entries()].map(([k, t]) => `${k}=${tileLabel(t)}`).sort() : null;
    return { ...props, mask, tiles: [...l.tiles.entries()].map(([k, t]) => `${k}=${tileLabel(t)}`).sort() };
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

// ---- spill (FR-HIS-03, T-HIS-02) ----------------------------------------------------------------

/** The scratch store in memory, with knobs for failures and slow writes or reads. */
class MemoryStore implements SpillStore {
  readonly records = new Map<number, Uint8ClampedArray>();
  puts = 0;
  gets = 0;
  failPut = false;
  failGet = false;
  /** While set, writes (or reads) wait for it. */
  putGate: Promise<void> | null = null;
  getGate: Promise<void> | null = null;
  private next = 1;

  get bytesOnDisk(): number {
    return this.records.size * TILE_BYTES;
  }

  async put(data: Uint8ClampedArray): Promise<number> {
    this.puts++;
    if (this.putGate) await this.putGate;
    if (this.failPut) throw new Error('QuotaExceededError');
    const id = this.next++;
    this.records.set(id, data.slice());
    return id;
  }

  async get(record: number): Promise<Uint8ClampedArray> {
    this.gets++;
    if (this.getGate) await this.getGate;
    if (this.failGet) throw new Error('NotReadableError');
    const data = this.records.get(record);
    if (!data) throw new Error(`No record ${record}`);
    return data.slice();
  }

  free(record: number): void {
    this.records.delete(record);
  }
}

function gate(): [Promise<void>, () => void] {
  let open!: () => void;
  return [new Promise<void>((resolve) => (open = resolve)), () => open()];
}

/** Tiles by content (a tile read back from disk is a new object with the same pixels). */
function digest(t: Tile): string {
  const words = new Int32Array(t.data.buffer, t.data.byteOffset, t.data.length / 4);
  let h = 2166136261;
  for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i]!, 16777619);
  return `${t.data[0]}/${t.data[3]}:${h >>> 0}`;
}

function expectResident(d: Document): void {
  for (const grid of layerGrids(d.layers))
    for (const [k, t] of grid.entries()) expect(isSpilled(t), k).toBe(false);
}

function spillHistory(doc: Document, maxBytes: number, store = new MemoryStore(), weakRefs = false) {
  const errors: string[] = [];
  const history = new History(doc, { maxSteps: 10_000, maxBytes }, undefined, {
    vault: new TileVault(store, { weakRefs }),
    onError: (m) => errors.push(m),
  });
  return { history, store, errors };
}

/** Paints a new tile over `key` of the ink layer. */
function paint(history: History, doc: Document, v: number, key = '0,0'): void {
  const ink = doc.layers[1]!.id;
  const before = doc.raster(ink).tiles.get(key);
  history.execute(new PaintTilesCommand('P', ink, new Map([[key, before]]), new Map([[key, tile(v)]])));
}

async function undoAll(history: History, doc: Document): Promise<void> {
  while (history.canUndo) {
    expect(history.undo()).toBe(true);
    await history.idle();
    expectResident(doc);
  }
}

async function redoAll(history: History, doc: Document): Promise<void> {
  while (history.canRedo) {
    expect(history.redo()).toBe(true);
    await history.idle();
    expectResident(doc);
  }
}

describe('history spill (FR-HIS-03, T-HIS-02)', () => {
  it.each([
    ['read back from the store', false],
    ['still in memory', true],
  ])(
    'over the budget, old steps spill and undo past them restores the pixels exactly (tiles %s)',
    async (_, weakRefs) => {
      const doc = newDoc();
      const budget = 3 * TILE_BYTES;
      const { history, store } = spillHistory(doc, budget, new MemoryStore(), weakRefs);
      const initial = state(doc, digest);
      for (let i = 0; i < 12; i++) paint(history, doc, 10 + i, i % 2 ? '1,0' : '0,0');
      await history.idle();
      const final = state(doc, digest);
      expect(history.entries()).toHaveLength(12); // nothing dropped
      expect(history.sizeBytes).toBeLessThanOrEqual(budget);
      expect(store.records.size).toBeGreaterThan(0);
      await undoAll(history, doc);
      expect(state(doc, digest)).toEqual(initial);
      if (!weakRefs) expect(store.gets).toBeGreaterThan(0);
      await redoAll(history, doc);
      expect(state(doc, digest)).toEqual(final);
    },
  );

  it('property: every command kind, spilling after each step, undoes to the oldest kept state and redoes to the final one', async () => {
    const op = fc.tuple(fc.nat(17), fc.nat(1000));
    await fc.assert(
      fc.asyncProperty(
        fc.array(op, { maxLength: 30 }),
        fc.integer({ min: 0, max: 4 }),
        fc.constantFrom(0, TILE_BYTES, 4 * TILE_BYTES),
        async (ops, undoEvery, budget) => {
          const doc = newDoc();
          // A budget of 0 spills every step but the newest. Steps without tiles (props, selections) cannot
          // spill and are dropped instead, oldest first. `states[0]` is the state before the oldest kept step.
          const { history } = spillHistory(doc, budget);
          const states = [state(doc, digest)];
          for (const [i, [o, v]] of ops.entries()) {
            const cmd = command(doc, o, v, history);
            if (cmd) {
              history.execute(cmd, { coalesce: o % 18 === 10 });
              // A coalesced step replaces the newest one (the top is then the merged command).
              if (history.top === cmd) states.push(state(doc, digest));
              else states[states.length - 1] = state(doc, digest);
            }
            await history.idle();
            states.splice(0, states.length - 1 - history.entries().length);
            expectResident(doc);
            if (undoEvery && i % undoEvery === undoEvery - 1) {
              const before = state(doc, digest);
              if (history.undo()) {
                await history.idle();
                history.redo();
                await history.idle();
                expect(state(doc, digest)).toEqual(before);
              }
            }
          }
          const final = state(doc, digest);
          expect(final).toEqual(states.at(-1));
          await undoAll(history, doc);
          expect(state(doc, digest)).toEqual(states[0]);
          await redoAll(history, doc);
          expect(state(doc, digest)).toEqual(final);
        },
      ),
      { numRuns: 40 },
    );
  }, 120_000);

  it('a tile still in memory comes back as the same object, without reading the disk', async () => {
    const doc = newDoc();
    const original = doc.raster(doc.layers[1]!.id).tiles.get('0,0')!;
    const { history, store } = spillHistory(doc, 0, new MemoryStore(), true);
    paint(history, doc, 5);
    paint(history, doc, 6);
    await history.idle();
    expect(store.puts).toBeGreaterThan(0);
    await undoAll(history, doc);
    expect(doc.raster(doc.layers[1]!.id).tiles.get('0,0')).toBe(original);
    expect(store.gets).toBe(0);
  });

  it('a spill never reports a document change (a job running meanwhile would drop its result)', async () => {
    const doc = newDoc();
    let changes = 0;
    let statuses = 0;
    const history = new History(doc, { maxSteps: 100, maxBytes: 0 }, () => changes++, {
      vault: new TileVault(new MemoryStore()),
      onStatus: () => statuses++,
    });
    for (let v = 1; v <= 4; v++) paint(history, doc, v);
    await history.idle();
    expect(changes).toBe(4); // one per step, none for the spills
    expect(statuses).toBeGreaterThan(0);
  });

  it('writes each tile once, however many steps hold it, and never spills the newest step', async () => {
    const doc = newDoc();
    const { history, store } = spillHistory(doc, 0);
    paint(history, doc, 1);
    await history.idle();
    expect(store.puts).toBe(0); // the newest step may still coalesce
    for (let v = 2; v <= 6; v++) paint(history, doc, v);
    await history.idle();
    // Steps 1–5 spilled: the original tile and tiles 1–5, each shared by two neighbouring steps.
    expect(store.puts).toBe(6);
  });

  it('goTo across spilled steps reads them all back before applying any', async () => {
    const doc = newDoc();
    const { history } = spillHistory(doc, 0);
    const initial = state(doc, digest);
    for (let v = 1; v <= 6; v++) paint(history, doc, v);
    await history.idle();
    const final = state(doc, digest);
    history.goTo(-1);
    expect(history.loading).toBe(true);
    expect(history.undo()).toBe(false); // waits for the restore
    await history.idle();
    expect(state(doc, digest)).toEqual(initial);
    history.goTo(5);
    await history.idle();
    expect(state(doc, digest)).toEqual(final);
  });

  it('a failed write keeps the steps in memory, says so once, and drops the oldest steps instead', async () => {
    const doc = newDoc();
    const store = new MemoryStore();
    store.failPut = true;
    const budget = 3 * TILE_BYTES;
    const { history, errors } = spillHistory(doc, budget, store);
    for (let v = 1; v <= 10; v++) {
      paint(history, doc, v);
      await history.idle();
    }
    expect(errors).toEqual([SPILL_WRITE_FAILED]);
    expect(history.sizeBytes).toBeLessThanOrEqual(budget);
    expect(history.entries().length).toBeLessThan(10);
    const top = state(doc, digest);
    await undoAll(history, doc);
    await redoAll(history, doc);
    expect(state(doc, digest)).toEqual(top);
  });

  it('a failed read leaves the document as it was and removes only the steps it made unreachable', async () => {
    const doc = newDoc();
    const { history, store, errors } = spillHistory(doc, 0);
    for (let v = 1; v <= 5; v++) paint(history, doc, v);
    await history.idle();
    const final = state(doc, digest);
    store.failGet = true;
    history.undo(); // the newest step is in memory
    await history.idle();
    const afterOne = state(doc, digest);
    history.undo(); // this one is on disk
    await history.idle();
    expect(state(doc, digest)).toEqual(afterOne);
    expect(errors).toEqual([SPILL_READ_FAILED]);
    expect(history.canUndo).toBe(false);
    expect(history.entries()).toHaveLength(1);
    history.redo();
    await history.idle();
    expect(state(doc, digest)).toEqual(final);
  });

  it('a step undone while its tiles are being written stays in memory where it is live again', async () => {
    const doc = newDoc();
    const store = new MemoryStore();
    const [writes, open] = gate();
    store.putGate = writes;
    const { history } = spillHistory(doc, 0, store);
    const initial = state(doc, digest);
    history.execute(flattenImage(doc));
    const flat = state(doc, digest);
    history.execute(new SetLayerPropsCommand(doc.activeLayerId, { opacity: 0.5 }));
    // The flatten is spilling (its layers before and after are not live); undo it meanwhile.
    history.undo();
    history.undo();
    expect(state(doc, digest)).toEqual(initial);
    open();
    await history.idle();
    expectResident(doc);
    expect(state(doc, digest)).toEqual(initial);
    history.redo();
    await history.idle();
    expect(state(doc, digest)).toEqual(flat);
  });

  it('a spill that finishes during a restore leaves its tiles in memory', async () => {
    const doc = newDoc();
    const store = new MemoryStore();
    const { history } = spillHistory(doc, 0, store);
    const initial = state(doc, digest);
    paint(history, doc, 1);
    const afterOne = state(doc, digest);
    paint(history, doc, 2);
    paint(history, doc, 3);
    await history.idle(); // steps 1 and 2 are spilled
    const [writes, openWrites] = gate();
    const [reads, openReads] = gate();
    store.putGate = writes;
    store.getGate = reads;
    paint(history, doc, 4); // step 3 starts spilling, held at the write
    history.undo(); // 4, in memory
    history.undo(); // 3, not swapped yet
    history.undo(); // 2, read back (held)
    expect(history.loading).toBe(true);
    openWrites(); // step 3's swap must not happen during the restore
    await Promise.resolve();
    openReads();
    await history.idle();
    expectResident(doc);
    expect(state(doc, digest)).toEqual(afterOne);
    store.putGate = store.getGate = null;
    await redoAll(history, doc);
    await undoAll(history, doc);
    expect(state(doc, digest)).toEqual(initial);
  });

  it('when nothing more can be spilled, the oldest steps are dropped, spilled ones only as far as needed', async () => {
    const doc = newDoc();
    const { history } = spillHistory(doc, 4 * TILE_BYTES);
    const big = (label: string): Command => ({
      label,
      do: () => ({ layerIds: [], tiles: [] }),
      undo: () => ({ layerIds: [], tiles: [] }),
      sizeBytes: () => 3 * TILE_BYTES,
    });
    paint(history, doc, 1);
    paint(history, doc, 2);
    await history.idle(); // step 1 spilled
    expect(history.entries()).toHaveLength(2);
    history.execute(big('a')); // 2 spills; a is newest
    await history.idle();
    expect(history.entries()).toHaveLength(3);
    history.execute(big('b')); // a (no tiles) cannot spill: drop 1, 2 and a
    await history.idle();
    expect(history.entries().map((e) => e.label)).toEqual(['b']);
  });
});
