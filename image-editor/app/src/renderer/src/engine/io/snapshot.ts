import { Mask, MASK_TILE_BYTES, maskTile, type MaskTile } from '../doc/selection';
import { preparedFor, type Adjustment } from '../ops/adjust';
import {
  createAdjustmentLayer,
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

/** A layer mask as plain data: RGBA tiles with coverage in alpha (see document.ts LayerMask). */
export type MaskSnapshot = {
  background: 0 | 255;
  enabled: boolean;
  linked: boolean;
  tiles: Array<[TileKey, Uint8Array]>;
};

export type LayerSnapshot =
  | (SnapshotBase & { type: 'raster'; tiles: Array<[TileKey, Uint8Array]>; mask?: MaskSnapshot | null })
  | (SnapshotBase & { type: 'group'; passThrough: boolean; collapsed: boolean; children: LayerSnapshot[] })
  | (SnapshotBase & { type: 'adjustment'; adjustment: Adjustment; mask?: MaskSnapshot | null });

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
  /** The selection as one-byte coverage tiles (FR-SEL-01..06); absent or null = nothing selected. */
  selection?: Array<[TileKey, Uint8Array]> | null;
  /** Unknown manifest fields, preserved on save (docs/05 §2.1). */
  extra?: { manifest?: Record<string, unknown>; document?: Record<string, unknown> };
};

/** One layer (and its children) as plain data, for workers. */
export function layerToSnapshot(l: Layer): LayerSnapshot {
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
  const mask = l.mask
    ? {
        mask: {
          background: l.mask.background,
          enabled: l.mask.enabled,
          linked: l.mask.linked,
          tiles: gridEntries(l.mask.grid),
        },
      }
    : {};
  if (l.type === 'adjustment') return { ...base, type: 'adjustment', adjustment: l.adjustment, ...mask };
  return {
    ...base,
    type: 'raster',
    tiles: gridEntries(l.tiles),
    ...(l.mask
      ? {
          mask: {
            background: l.mask.background,
            enabled: l.mask.enabled,
            linked: l.mask.linked,
            tiles: gridEntries(l.mask.grid),
          },
        }
      : {}),
  };
}

function gridEntries(grid: TileGrid): Array<[TileKey, Uint8Array]> {
  return [...grid.entries()].map(([key, tile]) => [
    key,
    new Uint8Array(tile.data.buffer, tile.data.byteOffset, tile.data.byteLength),
  ]);
}

function gridFrom(tiles: ReadonlyArray<[TileKey, Uint8Array]>): TileGrid {
  const grid = new TileGrid();
  for (const [key, bytes] of tiles) {
    if (bytes.byteLength !== TILE_BYTES) throw new RangeError(`Tile ${key} has the wrong size`);
    grid.set(key, createTile(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
  }
  return grid;
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
    selection: doc.selection
      ? [...doc.selection.entries()].map(([key, t]) => [
          key,
          new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength),
        ])
      : null,
    ...(doc.meta.extra ? { extra: doc.meta.extra } : {}),
  };
}

function layerFromSnapshot(l: LayerSnapshot): Layer {
  if (l.type === 'group') {
    const { children, type: _type, ...props } = l;
    return createGroupLayer(l.name, children.map(layerFromSnapshot), props);
  }
  const maskOf = (mask: MaskSnapshot | null | undefined) => ({
    mask: mask
      ? {
          grid: gridFrom(mask.tiles),
          background: mask.background,
          enabled: mask.enabled,
          linked: mask.linked,
        }
      : null,
  });
  if (l.type === 'adjustment') {
    const { adjustment, type: _type, mask, ...props } = l;
    return createAdjustmentLayer(l.name, adjustment, { ...props, ...maskOf(mask) });
  }
  const { tiles, type: _type, mask, ...props } = l;
  return createRasterLayer(l.name, gridFrom(tiles), { ...props, ...(mask ? maskOf(mask) : {}) });
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
  if (s.selection?.length) {
    const tiles = new Map<TileKey, MaskTile>();
    for (const [key, bytes] of s.selection) {
      if (bytes.byteLength !== MASK_TILE_BYTES) continue; // a damaged tile is dropped, not fatal
      const t = maskTile(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      if (t) tiles.set(key, t);
    }
    const mask = Mask.fromTiles(tiles, s.width, s.height);
    doc.selection = mask.isEmpty ? null : mask;
  }
  return doc;
}

/** Adapts a snapshot tree to the CPU compositor (in the file worker). */
export function snapshotLayers(layers: readonly LayerSnapshot[]): import('../doc/flatten').FlatLayer[] {
  return layers.map((l) => {
    if (l.type === 'group') return { ...l, kind: 'group', children: snapshotLayers(l.children) };
    const m = l.mask?.enabled ? l.mask : null;
    const maskTiles = m ? new Map(m.tiles) : null;
    const mask =
      m && maskTiles ? { tile: (key: TileKey) => maskTiles.get(key), background: m.background } : null;
    if (l.type === 'adjustment')
      return { ...l, kind: 'adjustment', prepared: preparedFor(l.adjustment), mask, clipped: l.clipped };
    const tiles = new Map(l.tiles);
    return { ...l, kind: 'raster', tile: (key: TileKey) => tiles.get(key), mask, clipped: l.clipped };
  });
}
