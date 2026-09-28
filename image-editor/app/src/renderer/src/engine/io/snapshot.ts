import {
  createGroupLayer,
  createRasterLayer,
  Document,
  type BlendMode,
  type Layer,
  type LayerLocks,
} from '../doc/document';
import { createTile, TILE_BYTES, TileGrid, type TileKey } from '../tiles/tile';

/**
 * Plain, structured-cloneable copy of a document: what crosses to the file worker (save, export flatten)
 * and comes back from it (open). Tile bytes are shared with the live tiles, never mutated.
 */
type SnapshotBase = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  fillOpacity: number;
  blendMode: BlendMode;
  locks: LayerLocks;
  clipped: boolean;
  extra?: Record<string, unknown>;
};

export type LayerSnapshot =
  | (SnapshotBase & { type: 'raster'; tiles: Array<[TileKey, Uint8Array]> })
  | (SnapshotBase & { type: 'group'; passThrough: boolean; collapsed: boolean; children: LayerSnapshot[] });

export type DocSnapshot = {
  width: number;
  height: number;
  ppi: number;
  guides: { horizontal: number[]; vertical: number[] };
  name: string;
  sourceProfile: string | null;
  exif: Uint8Array | null;
  activeLayerId: string;
  /** Root level, bottom → top. */
  layers: LayerSnapshot[];
  /** Unknown manifest fields, preserved on save (docs/05 §2.1). */
  extra?: { manifest?: Record<string, unknown>; document?: Record<string, unknown> };
};

function layerToSnapshot(l: Layer): LayerSnapshot {
  const base: SnapshotBase = {
    id: l.id,
    name: l.name,
    visible: l.visible,
    opacity: l.opacity,
    fillOpacity: l.fillOpacity,
    blendMode: l.blendMode,
    locks: { ...l.locks },
    clipped: l.clipped,
    ...(l.extra ? { extra: l.extra } : {}),
  };
  if (l.type === 'group')
    return {
      ...base,
      type: 'group',
      passThrough: l.passThrough,
      collapsed: l.collapsed,
      children: l.children.map(layerToSnapshot),
    };
  return {
    ...base,
    type: 'raster',
    tiles: [...l.tiles.entries()].map(([key, tile]) => [
      key,
      new Uint8Array(tile.data.buffer, tile.data.byteOffset, tile.data.byteLength),
    ]),
  };
}

export function toSnapshot(doc: Document): DocSnapshot {
  return {
    width: doc.width,
    height: doc.height,
    ppi: doc.meta.ppi,
    guides: doc.meta.guides,
    name: doc.meta.name,
    sourceProfile: doc.meta.sourceProfile,
    exif: doc.meta.exif,
    activeLayerId: doc.activeLayerId,
    layers: doc.layers.map(layerToSnapshot),
    ...(doc.meta.extra ? { extra: doc.meta.extra } : {}),
  };
}

function layerFromSnapshot(l: LayerSnapshot): Layer {
  if (l.type === 'group') {
    const { children, type: _type, ...props } = l;
    return createGroupLayer(l.name, children.map(layerFromSnapshot), props);
  }
  const grid = new TileGrid();
  for (const [key, bytes] of l.tiles) {
    if (bytes.byteLength !== TILE_BYTES) throw new RangeError(`Tile ${key} has the wrong size`);
    grid.set(key, createTile(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
  }
  const { tiles: _tiles, type: _type, ...props } = l;
  return createRasterLayer(l.name, grid, props);
}

export function fromSnapshot(s: DocSnapshot): Document {
  const layers = s.layers.map(layerFromSnapshot);
  const doc = new Document(s.width, s.height, layers, {
    name: s.name,
    sourceProfile: s.sourceProfile,
    ppi: s.ppi,
    guides: s.guides,
    exif: s.exif,
    ...(s.extra ? { extra: s.extra } : {}),
  });
  if (doc.has(s.activeLayerId)) doc.activeLayerId = s.activeLayerId;
  return doc;
}

/** Adapts a snapshot tree to the CPU compositor (in the file worker). */
export function snapshotLayers(layers: readonly LayerSnapshot[]): import('../doc/flatten').FlatLayer[] {
  return layers.map((l) => {
    if (l.type === 'group') return { ...l, kind: 'group', children: snapshotLayers(l.children) };
    const tiles = new Map(l.tiles);
    return { ...l, kind: 'raster', tile: (key: TileKey) => tiles.get(key) };
  });
}
