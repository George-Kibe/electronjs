import { TileGrid } from '../tiles/tile';

/** The 18 blend modes of FR-LAY-03 (docs/05 §1). The compositor implements them per milestone. */
export const BLEND_MODES = [
  'normal',
  'dissolve',
  'darken',
  'multiply',
  'color-burn',
  'lighten',
  'screen',
  'color-dodge',
  'linear-dodge',
  'overlay',
  'soft-light',
  'hard-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export type LayerLocks = { all: boolean; pixels: boolean; position: boolean; transparency: boolean };

export const NO_LOCKS: LayerLocks = Object.freeze({
  all: false,
  pixels: false,
  position: false,
  transparency: false,
});

export type RasterLayer = {
  readonly id: string;
  readonly type: 'raster';
  name: string;
  visible: boolean;
  /** 0..1, applies to the whole layer. */
  opacity: number;
  /** 0..1, applies to the pixels but not to layer styles (docs/05 §1). */
  fillOpacity: number;
  blendMode: BlendMode;
  locks: LayerLocks;
  clipped: boolean;
  readonly tiles: TileGrid;
  /** Manifest fields this version does not understand, kept so saving does not drop them (docs/05 §2.1). */
  extra?: Record<string, unknown>;
};

/**
 * A folder of layers (FR-LAY-01). Pass-through groups (the default, as in Photoshop) let children blend
 * with everything below; otherwise the group is composited on its own first ("isolated") and the result is
 * blended with the group's mode and opacity.
 */
export type GroupLayer = Omit<RasterLayer, 'type' | 'tiles'> & {
  readonly type: 'group';
  children: Layer[];
  passThrough: boolean;
  /** Collapsed in the Layers panel (view state; not an undo step). */
  collapsed: boolean;
};

export type Layer = RasterLayer | GroupLayer;

export type LayerProps = Pick<
  RasterLayer,
  'name' | 'visible' | 'opacity' | 'fillOpacity' | 'blendMode' | 'locks' | 'clipped'
> & { passThrough?: boolean };

let layerSeq = 1;

/** A layer id unique within this renderer (documents loaded from disk keep their own ids). */
export function newLayerId(): string {
  return `L${Date.now().toString(36)}${(layerSeq++).toString(36)}`;
}

export function createRasterLayer(
  name: string,
  tiles = new TileGrid(),
  props: Partial<LayerProps> & { id?: string; extra?: Record<string, unknown> } = {},
): RasterLayer {
  const { id, extra, ...rest } = props;
  return {
    id: id ?? newLayerId(),
    type: 'raster',
    name,
    visible: true,
    opacity: 1,
    fillOpacity: 1,
    blendMode: 'normal',
    locks: { ...NO_LOCKS },
    clipped: false,
    tiles,
    ...rest,
    ...(extra ? { extra } : {}),
  };
}

export function createGroupLayer(
  name: string,
  children: Layer[] = [],
  props: Partial<LayerProps> & { id?: string; collapsed?: boolean; extra?: Record<string, unknown> } = {},
): GroupLayer {
  const { id, extra, passThrough, collapsed, ...rest } = props;
  return {
    id: id ?? newLayerId(),
    type: 'group',
    name,
    visible: true,
    opacity: 1,
    fillOpacity: 1,
    blendMode: 'normal',
    locks: { ...NO_LOCKS },
    clipped: false,
    children,
    passThrough: passThrough ?? true,
    collapsed: collapsed ?? false,
    ...rest,
    ...(extra ? { extra } : {}),
  };
}

/** Where a layer sits: its container array (root or a group's children), index in it, and parent group. */
export type LayerLocation = {
  layer: Layer;
  siblings: Layer[];
  index: number;
  parent: GroupLayer | null;
  depth: number;
};

/** Depth-first, bottom → top within each container; groups are visited before their children. */
export function* walkLayers(
  layers: Layer[],
  parent: GroupLayer | null = null,
  depth = 0,
): Generator<LayerLocation> {
  for (const [index, layer] of layers.entries()) {
    yield { layer, siblings: layers, index, parent, depth };
    if (layer.type === 'group') yield* walkLayers(layer.children, layer, depth + 1);
  }
}

/** True if `ancestorId` is `id` itself or one of its enclosing groups. */
export function isSelfOrDescendant(layers: Layer[], ancestorId: string, id: string): boolean {
  for (const loc of walkLayers(layers)) {
    if (loc.layer.id !== ancestorId) continue;
    if (ancestorId === id) return true;
    return loc.layer.type === 'group' && [...walkLayers(loc.layer.children)].some((l) => l.layer.id === id);
  }
  return false;
}

export type DocumentMeta = {
  name: string;
  sourceProfile: string | null;
  /** Pixels per inch, metadata only (FR-DOC-01). */
  ppi: number;
  guides: { horizontal: number[]; vertical: number[] };
  /**
   * Raw EXIF block of the source image. Opaque to the renderer: only codec-host parses it, when exporting
   * with a metadata policy (FR-DOC-09).
   */
  exif: Uint8Array | null;
  /** Unknown `.iep` manifest fields from a file written by another version, preserved on save. */
  extra?: { manifest?: Record<string, unknown>; document?: Record<string, unknown> };
};

export const DEFAULT_META: DocumentMeta = {
  name: 'Untitled',
  sourceProfile: null,
  ppi: 72,
  guides: { horizontal: [], vertical: [] },
  exif: null,
};

/**
 * Document model (docs/05 §1), M1 subset: a tree of raster layers and groups. `layers` holds the root level
 * (bottom → top). Mutated only by Commands (engine/doc/commands.ts).
 */
export class Document {
  readonly layers: Layer[] = [];
  activeLayerId: string;
  readonly meta: DocumentMeta;

  constructor(
    readonly width: number,
    readonly height: number,
    layers: Layer | Layer[],
    meta: Partial<DocumentMeta> = {},
  ) {
    const list = Array.isArray(layers) ? layers : [layers];
    if (list.length === 0) throw new Error('A document needs at least one layer');
    this.layers.push(...list);
    this.activeLayerId = list.at(-1)!.id;
    this.meta = { ...DEFAULT_META, ...meta };
  }

  locate(id: string): LayerLocation {
    for (const loc of walkLayers(this.layers)) if (loc.layer.id === id) return loc;
    throw new Error(`No layer ${id}`);
  }

  has(id: string): boolean {
    for (const loc of walkLayers(this.layers)) if (loc.layer.id === id) return true;
    return false;
  }

  layer(id: string): Layer {
    return this.locate(id).layer;
  }

  /** The raster layer `id`; throws for groups (pixels live only in raster layers). */
  raster(id: string): RasterLayer {
    const layer = this.layer(id);
    if (layer.type !== 'raster') throw new Error(`Layer ${id} is not a raster layer`);
    return layer;
  }

  get activeLayer(): Layer {
    return this.layer(this.activeLayerId);
  }

  /** Every layer in the tree, depth-first. */
  allLayers(): Layer[] {
    return [...walkLayers(this.layers)].map((l) => l.layer);
  }

  /** The children array of `parentId`, or the root when null. */
  container(parentId: string | null): Layer[] {
    if (parentId === null) return this.layers;
    const group = this.layer(parentId);
    if (group.type !== 'group') throw new Error(`Layer ${parentId} is not a group`);
    return group.children;
  }
}
