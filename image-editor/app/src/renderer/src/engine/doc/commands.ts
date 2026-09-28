import type { Tile, TileKey } from '../tiles/tile';
import { TILE_BYTES } from '../tiles/tile';
import { createRasterLayer, type Document, type RasterLayer } from './document';

export type DirtySet = { layerIds: string[]; tiles: TileKey[] | 'all' };

/** Every document mutation is a Command (docs/04 §2.1). do/undo must be exact inverses. */
export interface Command {
  readonly label: string;
  do(doc: Document): DirtySet;
  undo(doc: Document): DirtySet;
  /** Bytes owned by this history entry (for the memory budget). */
  sizeBytes(): number;
  /** Coalescing (e.g. opacity slider drags) — return the merged command or null. */
  mergeWith?(next: Command): Command | null;
}

/** Swaps tile references on one layer: the core of brush/eraser/fill undo (ADR-0005). */
export class PaintTilesCommand implements Command {
  constructor(
    readonly label: string,
    private readonly layerId: string,
    private readonly before: ReadonlyMap<TileKey, Tile | undefined>,
    private readonly after: ReadonlyMap<TileKey, Tile | undefined>,
  ) {}

  private apply(doc: Document, tiles: ReadonlyMap<TileKey, Tile | undefined>): DirtySet {
    const grid = doc.layer(this.layerId).tiles;
    for (const [key, tile] of tiles) grid.set(key, tile);
    return { layerIds: [this.layerId], tiles: [...tiles.keys()] };
  }

  do(doc: Document): DirtySet {
    return this.apply(doc, this.after);
  }

  undo(doc: Document): DirtySet {
    return this.apply(doc, this.before);
  }

  sizeBytes(): number {
    let n = 0;
    for (const t of this.before.values()) if (t) n += TILE_BYTES;
    for (const t of this.after.values()) if (t) n += TILE_BYTES;
    return n;
  }
}

export class AddLayerCommand implements Command {
  readonly label = 'New Layer';
  private readonly layer: RasterLayer;
  private previousActive = '';

  constructor(
    name: string,
    private readonly index: number,
  ) {
    this.layer = createRasterLayer(name);
  }

  get layerId(): string {
    return this.layer.id;
  }

  do(doc: Document): DirtySet {
    this.previousActive = doc.activeLayerId;
    doc.layers.splice(this.index, 0, this.layer);
    doc.activeLayerId = this.layer.id;
    return { layerIds: [this.layer.id], tiles: 'all' };
  }

  undo(doc: Document): DirtySet {
    doc.layers.splice(doc.indexOf(this.layer.id), 1);
    doc.activeLayerId = this.previousActive;
    return { layerIds: [this.layer.id], tiles: 'all' };
  }

  sizeBytes(): number {
    return 256;
  }
}

export class DeleteLayerCommand implements Command {
  readonly label = 'Delete Layer';
  private index = -1;
  private layer: RasterLayer | undefined;
  private previousActive = '';

  constructor(private readonly layerId: string) {}

  do(doc: Document): DirtySet {
    if (doc.layers.length <= 1) throw new Error('A document needs at least one layer');
    this.index = doc.indexOf(this.layerId);
    this.previousActive = doc.activeLayerId;
    [this.layer] = doc.layers.splice(this.index, 1);
    if (doc.activeLayerId === this.layerId) doc.activeLayerId = doc.layers[Math.max(0, this.index - 1)]!.id;
    return { layerIds: [this.layerId], tiles: 'all' };
  }

  undo(doc: Document): DirtySet {
    doc.layers.splice(this.index, 0, this.layer!);
    doc.activeLayerId = this.previousActive;
    return { layerIds: [this.layerId], tiles: 'all' };
  }

  sizeBytes(): number {
    let n = 0;
    for (const _ of this.layer?.tiles.keys() ?? []) n += TILE_BYTES;
    return n;
  }
}

type LayerProps = Partial<Pick<RasterLayer, 'name' | 'visible' | 'opacity'>>;

export class SetLayerPropsCommand implements Command {
  readonly label: string;
  private before: LayerProps = {};

  constructor(
    private readonly layerId: string,
    private readonly props: LayerProps,
  ) {
    this.label =
      'opacity' in props ? 'Layer Opacity' : 'visible' in props ? 'Layer Visibility' : 'Rename Layer';
  }

  do(doc: Document): DirtySet {
    const layer = doc.layer(this.layerId);
    this.before = Object.fromEntries(Object.keys(this.props).map((k) => [k, layer[k as keyof LayerProps]]));
    Object.assign(layer, this.props);
    return { layerIds: [this.layerId], tiles: 'all' };
  }

  undo(doc: Document): DirtySet {
    Object.assign(doc.layer(this.layerId), this.before);
    return { layerIds: [this.layerId], tiles: 'all' };
  }

  sizeBytes(): number {
    return 64;
  }

  /** Consecutive changes of the same property on the same layer become one undo step. */
  mergeWith(next: Command): Command | null {
    if (!(next instanceof SetLayerPropsCommand) || next.layerId !== this.layerId) return null;
    const keys = Object.keys(this.props).join();
    if (keys !== Object.keys(next.props).join() || keys === 'visible') return null;
    const merged = new SetLayerPropsCommand(this.layerId, next.props);
    merged.before = this.before;
    return merged;
  }
}

export class SetActiveLayerCommand implements Command {
  readonly label = 'Select Layer';
  private previous = '';
  constructor(private readonly layerId: string) {}
  do(doc: Document): DirtySet {
    this.previous = doc.activeLayerId;
    doc.activeLayerId = this.layerId;
    return { layerIds: [], tiles: [] };
  }
  undo(doc: Document): DirtySet {
    doc.activeLayerId = this.previous;
    return { layerIds: [], tiles: [] };
  }
  sizeBytes(): number {
    return 32;
  }
}
