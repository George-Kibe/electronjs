import type { Tile, TileKey } from '../tiles/tile';
import { TILE_BYTES } from '../tiles/tile';
import { createRasterLayer, type Document, type Layer, type LayerProps } from './document';

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

/** Swaps tile references on one raster layer: the core of brush/eraser/fill undo (ADR-0005). */
export class PaintTilesCommand implements Command {
  constructor(
    readonly label: string,
    private readonly layerId: string,
    private readonly before: ReadonlyMap<TileKey, Tile | undefined>,
    private readonly after: ReadonlyMap<TileKey, Tile | undefined>,
  ) {}

  private apply(doc: Document, tiles: ReadonlyMap<TileKey, Tile | undefined>): DirtySet {
    const grid = doc.raster(this.layerId).tiles;
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

/** Inserts a layer (new raster by default) into `parentId`'s children at `index`, and selects it. */
export class AddLayerCommand implements Command {
  readonly label: string;
  private readonly layer: Layer;
  private previousActive = '';

  constructor(
    nameOrLayer: string | Layer,
    private readonly index: number,
    private readonly parentId: string | null = null,
    label = 'New Layer',
  ) {
    this.layer = typeof nameOrLayer === 'string' ? createRasterLayer(nameOrLayer) : nameOrLayer;
    this.label = label;
  }

  get layerId(): string {
    return this.layer.id;
  }

  do(doc: Document): DirtySet {
    this.previousActive = doc.activeLayerId;
    doc.container(this.parentId).splice(this.index, 0, this.layer);
    doc.activeLayerId = this.layer.id;
    return { layerIds: [this.layer.id], tiles: 'all' };
  }

  undo(doc: Document): DirtySet {
    const siblings = doc.container(this.parentId);
    siblings.splice(siblings.indexOf(this.layer), 1);
    doc.activeLayerId = this.previousActive;
    return { layerIds: [this.layer.id], tiles: 'all' };
  }

  sizeBytes(): number {
    return 256 + tileBytes([this.layer]);
  }
}

export class DeleteLayerCommand implements Command {
  readonly label = 'Delete Layer';
  private index = -1;
  private siblings: Layer[] = [];
  private layer: Layer | undefined;
  private previousActive = '';

  constructor(private readonly layerId: string) {}

  do(doc: Document): DirtySet {
    const loc = doc.locate(this.layerId);
    if (loc.parent === null && doc.layers.length <= 1) throw new Error('A document needs at least one layer');
    this.siblings = loc.siblings;
    this.index = loc.index;
    this.previousActive = doc.activeLayerId;
    [this.layer] = loc.siblings.splice(loc.index, 1);
    if (!doc.has(doc.activeLayerId))
      doc.activeLayerId = nearestLayer(doc, loc.siblings, loc.index, loc.parent?.id);
    return { layerIds: [this.layerId], tiles: 'all' };
  }

  undo(doc: Document): DirtySet {
    this.siblings.splice(this.index, 0, this.layer!);
    doc.activeLayerId = this.previousActive;
    return { layerIds: [this.layerId], tiles: 'all' };
  }

  sizeBytes(): number {
    return this.layer ? tileBytes([this.layer]) : 0;
  }
}

/** The layer below the removed position, else the one above, else the parent group. */
function nearestLayer(doc: Document, siblings: Layer[], index: number, parentId: string | undefined): string {
  return (siblings[index - 1] ?? siblings[index])?.id ?? parentId ?? doc.layers.at(-1)!.id;
}

const PROP_LABELS: Record<string, string> = {
  opacity: 'Layer Opacity',
  fillOpacity: 'Fill Opacity',
  visible: 'Layer Visibility',
  name: 'Rename Layer',
  blendMode: 'Blend Mode',
  locks: 'Lock Layer',
  passThrough: 'Blend Mode',
  clipped: 'Clipping Mask',
};

export class SetLayerPropsCommand implements Command {
  readonly label: string;
  private before: Partial<LayerProps> = {};

  constructor(
    private readonly layerId: string,
    private readonly props: Partial<LayerProps>,
  ) {
    this.label = PROP_LABELS[Object.keys(props)[0] ?? ''] ?? 'Layer Properties';
  }

  do(doc: Document): DirtySet {
    const layer = doc.layer(this.layerId) as unknown as Record<string, unknown>;
    this.before = Object.fromEntries(Object.keys(this.props).map((k) => [k, layer[k]]));
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

/** Copies the tree structure (groups and arrays); raster layers and their immutable tiles are shared. */
export function cloneTree(layers: readonly Layer[]): Layer[] {
  return layers.map((l) =>
    l.type === 'group' ? { ...l, locks: { ...l.locks }, children: cloneTree(l.children) } : l,
  );
}

/** Tile bytes held by the raster layers in `layers` (for history accounting). */
export function tileBytes(layers: readonly Layer[]): number {
  let n = 0;
  for (const l of layers) n += l.type === 'group' ? tileBytes(l.children) : l.tiles.size * TILE_BYTES;
  return n;
}

export type TreeEdit = {
  /** The new root level (built from a cloneTree() copy; unchanged raster layers may be shared). */
  root: Layer[];
  activeLayerId: string;
  /** Bytes of tiles created by this edit (merges); they are owned by history. */
  newTileBytes?: number;
};

/**
 * Structural edit of the layer tree as one undo step: group, ungroup, move, duplicate, merge, flatten
 * (docs/04 §2.2). `build` runs once, on the first do(); afterwards do/undo only swap the root contents, so
 * they are exact inverses and cost O(layers), never O(pixels).
 */
export class TreeCommand implements Command {
  private before: { root: Layer[]; active: string } | null = null;
  private after: TreeEdit | null = null;

  constructor(
    readonly label: string,
    private readonly build: (doc: Document) => TreeEdit,
  ) {}

  private install(doc: Document, root: Layer[], active: string): DirtySet {
    doc.layers.splice(0, doc.layers.length, ...root);
    doc.activeLayerId = active;
    return { layerIds: [], tiles: 'all' };
  }

  do(doc: Document): DirtySet {
    if (!this.after) {
      this.before = { root: [...doc.layers], active: doc.activeLayerId };
      this.after = this.build(doc);
      if (this.after.root.length === 0) throw new Error('A document needs at least one layer');
    }
    return this.install(doc, this.after.root, this.after.activeLayerId);
  }

  undo(doc: Document): DirtySet {
    return this.install(doc, this.before!.root, this.before!.active);
  }

  sizeBytes(): number {
    return 512 + (this.after?.newTileBytes ?? 0);
  }
}
