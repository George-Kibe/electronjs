import { createTile, TILE_BYTES, TileGrid, tileKey, type TileKey } from '../tiles/tile';
import { cloneTree, TreeCommand, type TreeEdit } from './commands';
import {
  createGroupLayer,
  createRasterLayer,
  isSelfOrDescendant,
  newLayerId,
  walkLayers,
  type Document,
  type Layer,
  type RasterLayer,
} from './document';
import { compositeTile, liveLayers, type FlatLayer } from './flatten';

/**
 * Layer operations of FR-LAY-02 as TreeCommands (docs/04 §2.2). Each returns null when the operation does
 * not apply (the UI disables it), so callers never push a no-op onto history.
 */

function locateIn(root: Layer[], id: string) {
  for (const loc of walkLayers(root)) if (loc.layer.id === id) return loc;
  throw new Error(`No layer ${id}`);
}

const lockedAll = (l: Layer) => l.locks.all;

/** Every tile key used by raster layers under `layers` (visible or not). */
function tileKeys(layers: readonly Layer[], out = new Set<TileKey>()): Set<TileKey> {
  for (const l of layers) {
    if (l.type === 'group') tileKeys(l.children, out);
    else for (const k of l.tiles.keys()) out.add(k);
  }
  return out;
}

function isEmpty(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
  return true;
}

/** Composites `layers` into a new sparse grid (only non-empty tiles). */
function compositeGrid(layers: FlatLayer[], keys: Iterable<TileKey>): { grid: TileGrid; bytes: number } {
  const grid = new TileGrid();
  let bytes = 0;
  for (const key of keys) {
    const data = compositeTile(layers, key);
    if (isEmpty(data)) continue;
    grid.set(key, createTile(data));
    bytes += TILE_BYTES;
  }
  return { grid, bytes };
}

function deepCopy(layer: Layer, suffix: string): Layer {
  const common = {
    ...layer,
    id: newLayerId(),
    locks: { ...layer.locks },
    name: suffix ? `${layer.name}${suffix}` : layer.name,
  };
  if (layer.type === 'group')
    return { ...common, type: 'group', children: layer.children.map((c) => deepCopy(c, '')) } as Layer;
  const grid = new TileGrid();
  for (const [k, t] of layer.tiles.entries()) grid.set(k, t); // tiles are immutable: share them
  return { ...common, type: 'raster', tiles: grid } as RasterLayer;
}

/** Layer › Duplicate (Ctrl+J): a copy above the original, selected. */
export function duplicateLayer(doc: Document, id: string): TreeCommand | null {
  if (!doc.has(id)) return null;
  return new TreeCommand('Duplicate Layer', (d): TreeEdit => {
    const root = cloneTree(d.layers);
    const loc = locateIn(root, id);
    const copy = deepCopy(loc.layer, ' copy');
    loc.siblings.splice(loc.index + 1, 0, copy);
    return { root, activeLayerId: copy.id };
  });
}

/**
 * Moves a layer to `index` in `parentId`'s children (null = root), where `index` counts positions after the
 * layer has been removed. Groups cannot move into themselves.
 */
export function moveLayer(
  doc: Document,
  id: string,
  parentId: string | null,
  index: number,
): TreeCommand | null {
  if (!doc.has(id) || lockedAll(doc.layer(id))) return null;
  if (parentId !== null && (!doc.has(parentId) || doc.layer(parentId).type !== 'group')) return null;
  if (parentId !== null && isSelfOrDescendant(doc.layers, id, parentId)) return null;
  const from = doc.locate(id);
  const sameParent = (from.parent?.id ?? null) === parentId;
  if (sameParent && from.index === index) return null;
  return new TreeCommand('Move Layer', (d): TreeEdit => {
    const root = cloneTree(d.layers);
    const loc = locateIn(root, id);
    loc.siblings.splice(loc.index, 1);
    const target =
      parentId === null ? root : (locateIn(root, parentId).layer as { children: Layer[] }).children;
    target.splice(Math.max(0, Math.min(index, target.length)), 0, loc.layer);
    return { root, activeLayerId: d.activeLayerId };
  });
}

/** Moves a layer one step up (+1) or down (−1) within its container (Ctrl+] / Ctrl+[). */
export function nudgeLayer(doc: Document, id: string, step: 1 | -1): TreeCommand | null {
  if (!doc.has(id)) return null;
  const loc = doc.locate(id);
  const index = loc.index + step;
  if (index < 0 || index >= loc.siblings.length) return null;
  return moveLayer(doc, id, loc.parent?.id ?? null, index);
}

/** Layer › Group (Ctrl+G): wraps the layer in a new pass-through group. */
export function groupLayer(doc: Document, id: string): TreeCommand | null {
  if (!doc.has(id)) return null;
  return new TreeCommand('Group Layers', (d): TreeEdit => {
    const root = cloneTree(d.layers);
    const loc = locateIn(root, id);
    const count = [...walkLayers(root)].filter((l) => l.layer.type === 'group').length;
    const group = createGroupLayer(`Group ${count + 1}`, [loc.layer]);
    loc.siblings.splice(loc.index, 1, group);
    return { root, activeLayerId: group.id };
  });
}

/** Layer › Ungroup (Ctrl+Shift+G): the group's children take its place. */
export function ungroupLayer(doc: Document, id: string): TreeCommand | null {
  if (!doc.has(id) || doc.layer(id).type !== 'group') return null;
  return new TreeCommand('Ungroup Layers', (d): TreeEdit => {
    const root = cloneTree(d.layers);
    const loc = locateIn(root, id);
    const children = (loc.layer as { children: Layer[] }).children;
    loc.siblings.splice(loc.index, 1, ...children);
    return { root, activeLayerId: children.at(-1)?.id ?? loc.siblings[0]?.id ?? root.at(-1)!.id };
  });
}

/** Why Merge Down is not possible for `id`, or null if it is. */
export function mergeDownBlocker(doc: Document, id: string): string | null {
  if (!doc.has(id)) return 'No layer selected.';
  const loc = doc.locate(id);
  const below = loc.siblings[loc.index - 1];
  if (!below) return 'There is no layer below to merge into.';
  if (below.type !== 'raster') return 'The layer below is a group.';
  if (!loc.layer.visible || !below.visible) return 'Both layers must be visible.';
  if (below.locks.all || below.locks.pixels || loc.layer.locks.all) return 'A locked layer cannot be merged.';
  return null;
}

/**
 * Layer › Merge Down (Ctrl+E): the layer (or group) is composited, with its blend mode and opacity, onto
 * the raster layer below. The lower layer keeps its name, opacity, blend mode and locks.
 */
export function mergeDown(doc: Document, id: string): TreeCommand | null {
  if (mergeDownBlocker(doc, id)) return null;
  return new TreeCommand('Merge Down', (d): TreeEdit => {
    const root = cloneTree(d.layers);
    const loc = locateIn(root, id);
    const lower = loc.siblings[loc.index - 1] as RasterLayer;
    const base: FlatLayer = {
      kind: 'raster',
      visible: true,
      opacity: 1,
      fillOpacity: 1,
      blendMode: 'normal',
      tile: (key) => lower.tiles.get(key)?.data,
    };
    const keys = tileKeys([lower, loc.layer]);
    const { grid, bytes } = compositeGrid([base, ...liveLayers([loc.layer])], keys);
    const merged: RasterLayer = { ...lower, locks: { ...lower.locks }, tiles: grid };
    loc.siblings.splice(loc.index - 1, 2, merged);
    return { root, activeLayerId: merged.id, newTileBytes: bytes };
  });
}

/**
 * Layer › Merge Visible (Ctrl+Shift+E): visible top-level layers and groups become one raster layer at the
 * position of the lowest of them. Hidden top-level layers are kept.
 */
export function mergeVisible(doc: Document): TreeCommand | null {
  const visible = doc.layers.filter((l) => l.visible);
  if (visible.length < 2 || visible.some(lockedAll)) return null;
  return new TreeCommand('Merge Visible', (d): TreeEdit => {
    const root = cloneTree(d.layers);
    const shown = root.filter((l) => l.visible);
    const { grid, bytes } = compositeGrid(liveLayers(shown), tileKeys(shown));
    const merged = createRasterLayer(shown[0]!.name, grid);
    const at = root.indexOf(shown[0]!);
    const kept = root.filter((l) => !l.visible);
    kept.splice(root.slice(0, at).filter((l) => !l.visible).length, 0, merged);
    return { root: kept, activeLayerId: merged.id, newTileBytes: bytes };
  });
}

/** Image › Flatten Image: one opaque "Background" of the visible layers over white; hidden layers are discarded. */
export function flattenImage(_doc: Document): TreeCommand {
  return new TreeCommand('Flatten Image', (d): TreeEdit => {
    const white = TileGrid.filled(d.width, d.height, [255, 255, 255, 255]);
    const base: FlatLayer = {
      kind: 'raster',
      visible: true,
      opacity: 1,
      fillOpacity: 1,
      blendMode: 'normal',
      tile: (key) => white.get(key)?.data,
    };
    const keys = new Set<TileKey>();
    for (let ty = 0; ty < Math.ceil(d.height / 256); ty++)
      for (let tx = 0; tx < Math.ceil(d.width / 256); tx++) keys.add(tileKey(tx, ty));
    const { grid, bytes } = compositeGrid([base, ...liveLayers(d.layers)], keys);
    const background = createRasterLayer('Background', grid);
    return { root: [background], activeLayerId: background.id, newTileBytes: bytes };
  });
}
