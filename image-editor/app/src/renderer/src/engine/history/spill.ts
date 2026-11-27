import type { Document } from '../doc/document';
import { layerGrids, type TileHolder } from '../doc/commands';
import { createTile, type Tile, type TileKey } from '../tiles/tile';

/**
 * History spill (FR-HIS-03, ADR-0005, docs/02 §4): tiles that only history keeps go to a scratch store, and
 * come back before an undo or redo needs them.
 *
 * Safety comes from what is never done: a Tile object is never changed (whoever else holds one keeps its
 * pixels), and a grid of the live document is never touched. Spilling only swaps history's own references
 * for placeholders; a placeholder keeps a weak reference to the tile, so if anything else still holds it,
 * it comes back as the very same object without reading the disk.
 */

/** Where spilled tiles go: the OPFS scratch file in the app (lib/scratch.ts), memory in tests. */
export interface SpillStore {
  /** Stores a copy of `data`; resolves with a record id once it is written. */
  put(data: Uint8ClampedArray): Promise<number>;
  /** The tile bytes of a record (rejects if it cannot be read back intact). */
  get(record: number): Promise<Uint8ClampedArray>;
  /** The record is no longer needed. */
  free(record: number): void;
  /** Bytes the records take on disk (for the status bar). */
  readonly bytesOnDisk: number;
}

type Ref = { deref(): Tile | undefined };
const GONE: Ref = { deref: () => undefined };

/**
 * Stands in for a tile whose pixels are in the store. Its `data` throws: history restores every placeholder
 * of a command before running it, so reading one means a bug, and failing loudly beats wrong pixels.
 */
export class SpilledTile implements Tile {
  constructor(
    /** The original tile's id. */
    readonly id: number,
    readonly record: number,
    /** The original tile while it is still in memory. */
    public ref: Ref,
  ) {}

  get data(): Uint8ClampedArray {
    throw new Error(`Tile ${this.id} is in the history scratch file; history must restore it first`);
  }
}

export const isSpilled = (t: Tile | undefined): t is SpilledTile => t instanceof SpilledTile;

export type VaultOptions = {
  /**
   * Keep weak references to the originals (true in the app). Tests turn it off, so every restore reads the
   * store, as if the originals had been garbage-collected.
   */
  weakRefs?: boolean;
};

/** Writes each tile to the store once, however many holders spill it, and brings tiles back. */
export class TileVault {
  /** The placeholder of each tile already in the store (alive while the tile is). */
  private readonly stored = new WeakMap<Tile, SpilledTile>();
  private readonly writing = new Map<Tile, Promise<SpilledTile>>();
  private readonly reading = new Map<SpilledTile, Promise<Tile>>();
  /** A record is freed when no holder keeps its placeholder any more. */
  private readonly registry = new FinalizationRegistry<number>((record) => this.store.free(record));
  private readonly weakRefs: boolean;

  constructor(
    readonly store: SpillStore,
    options: VaultOptions = {},
  ) {
    this.weakRefs = options.weakRefs ?? true;
  }

  /** The placeholder for `tile`, writing it first unless it is already in the store. */
  stash(tile: Tile): Promise<SpilledTile> {
    const known = this.stored.get(tile);
    if (known) return Promise.resolve(known);
    const pending = this.writing.get(tile);
    if (pending) return pending;
    const p = this.store
      .put(tile.data)
      .then((record) => {
        const s = new SpilledTile(tile.id, record, this.refTo(tile));
        this.stored.set(tile, s);
        this.registry.register(s, record);
        return s;
      })
      .finally(() => this.writing.delete(tile));
    this.writing.set(tile, p);
    return p;
  }

  /** The tile behind a placeholder: the original if it is still in memory, else read from the store. */
  revive(s: SpilledTile): Promise<Tile> {
    const alive = s.ref.deref();
    if (alive) return Promise.resolve(alive);
    const pending = this.reading.get(s);
    if (pending) return pending;
    const p = this.store
      .get(s.record)
      .then((data) => {
        const again = s.ref.deref();
        if (again) return again;
        const tile = createTile(data);
        // Other holders of this placeholder get the same tile, and spilling it again writes nothing.
        s.ref = this.refTo(tile);
        this.stored.set(tile, s);
        return tile;
      })
      .finally(() => this.reading.delete(s));
    this.reading.set(s, p);
    return p;
  }

  private refTo(tile: Tile): Ref {
    return this.weakRefs ? new WeakRef(tile) : GONE;
  }
}

/** The grids of the live document: spilling never touches them. */
export function liveGrids(doc: Document): Set<TileHolder> {
  return new Set<TileHolder>(layerGrids(doc.layers));
}

export type Slot = [holder: TileHolder, key: TileKey, tile: Tile];

/** The placeholders among `holders`. */
export function spilledSlots(holders: Iterable<TileHolder>): Array<[TileHolder, TileKey, SpilledTile]> {
  const out: Array<[TileHolder, TileKey, SpilledTile]> = [];
  for (const h of holders) for (const [k, t] of h.entries()) if (isSpilled(t)) out.push([h, k, t]);
  return out;
}

/** The resident tiles among `holders`, leaving out the live document's grids. */
export function residentSlots(holders: Iterable<TileHolder>, live: ReadonlySet<TileHolder>): Slot[] {
  const out: Slot[] = [];
  for (const h of holders) {
    if (live.has(h)) continue;
    for (const [k, t] of h.entries()) if (t && !isSpilled(t)) out.push([h, k, t]);
  }
  return out;
}
