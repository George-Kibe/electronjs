import { TILE_SIZE, tileKey, TileGrid } from '../tiles/tile';
import type { Mask } from './selection';
import type { Adjustment } from '../ops/adjust';

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

/**
 * A layer mask (FR-LAY-04): coverage (0 hides, 255 shows) in the alpha channel of RGBA tiles, RGB 0, so every
 * tile operation (move, crop, rotate, flip, resample) applies to masks unchanged. Outside its tiles the mask
 * is `background` (255 after Reveal All, 0 after Hide All). Like a layer's tiles, the grid is changed in
 * place by commands only; copy it with copyMask when a layer is duplicated or snapshotted.
 */
export type LayerMask = {
  grid: TileGrid;
  background: 0 | 255;
  /** Off: the layer shows as if it had no mask (Shift-click the thumbnail). */
  enabled: boolean;
  /** Linked: the mask moves with the layer's pixels. */
  linked: boolean;
};

/** The same mask with its own grid (tiles are immutable and shared). */
export function copyMask(m: LayerMask): LayerMask {
  const grid = new TileGrid();
  for (const [k, t] of m.grid.entries()) grid.set(k, t);
  return { ...m, grid };
}

/** Mask coverage 0..255 at a document pixel (integer coordinates). */
export function maskAt(m: LayerMask, x: number, y: number): number {
  const tile = m.grid.get(tileKey(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)));
  if (!tile) return m.background;
  return tile.data[
    ((y - Math.floor(y / TILE_SIZE) * TILE_SIZE) * TILE_SIZE + (x - Math.floor(x / TILE_SIZE) * TILE_SIZE)) *
      4 +
      3
  ]!;
}

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
  /** Layer mask (FR-LAY-04); absent or null = none. */
  mask?: LayerMask | null;
  /** Manifest fields this version does not understand, kept so saving does not drop them (docs/05 §2.1). */
  extra?: Record<string, unknown>;
};

/**
 * A folder of layers (FR-LAY-01). Pass-through groups (the default, as in Photoshop) let children blend
 * with everything below; otherwise the group is composited on its own first ("isolated") and the result is
 * blended with the group's mode and opacity.
 */
export type GroupLayer = Omit<RasterLayer, 'type' | 'tiles' | 'mask'> & {
  readonly type: 'group';
  children: Layer[];
  passThrough: boolean;
  /** Collapsed in the Layers panel (view state; not an undo step). */
  collapsed: boolean;
};

/**
 * An adjustment layer (FR-ADJ-01, docs/05 §1): no pixels; the compositor adjusts everything below it in its
 * container, through its mask and opacity. The `adjustment` object is replaced, never mutated, by commands.
 */
export type AdjustmentLayer = Omit<RasterLayer, 'type' | 'tiles'> & {
  readonly type: 'adjustment';
  adjustment: Adjustment;
};

/** Straight RGB 0..255 and alpha 0..1. */
export type RGBA = [number, number, number, number];

/** One stretch of text with one style (docs/05 §1 TextModel). */
export type TextRun = {
  text: string;
  font: { family: string; postscriptName?: string; weight: number; style: 'normal' | 'italic' };
  /** Font size in document px. */
  size: number;
  color: RGBA;
  /** Extra space between letters, in document px. */
  letterSpacing: number;
  underline: boolean;
  strike: boolean;
};

export type TextParagraph = {
  align: 'left' | 'center' | 'right' | 'justify';
  /** Line height as a multiple of the font size. */
  lineHeight: number;
  runs: TextRun[];
};

/** Point text grows with its lines; box (paragraph) text wraps inside `box` (FR-TXT-01). */
export type TextModel = {
  mode: 'point' | 'box';
  box?: { w: number; h: number };
  paragraphs: TextParagraph[];
};

/**
 * A text layer (FR-LAY-01, FR-TXT-01, docs/05 §1). `tiles` is its rendering (docs/05's `cache`), so it
 * composites, masks and clips exactly like a raster layer; editing the text renders it again. `transform`
 * is a row-major 3×3 matrix; this version uses only its translation (the text block's top-left corner).
 * Tools that change pixels ask for Layer › Rasterize Type first.
 */
export type TextLayer = Omit<RasterLayer, 'type'> & {
  readonly type: 'text';
  text: TextModel;
  transform: number[];
};

export type ShapeKind = 'rect' | 'rounded-rect' | 'ellipse' | 'line' | 'polygon' | 'star';

/**
 * A shape (docs/05 §1 ShapeModel, FR-PNT-08), in px from the layer's origin. `params`: `w`, `h` (the box
 * the shape fills from the origin; any kind), `radius` (rounded-rect), `sides` (polygon), `points` and
 * `inner` (star: the inner radius as a fraction of the outer), `x2`, `y2`, `arrowStart`, `arrowEnd` (line:
 * from the origin to (x2, y2), arrowheads 0 or 1).
 */
export type ShapeModel = {
  kind: ShapeKind;
  params: Record<string, number>;
  fill: { type: 'none' | 'solid'; color?: RGBA };
  stroke: { color: RGBA; width: number; align: 'inside' | 'center' | 'outside'; dash?: number[] } | null;
};

/**
 * A shape layer (FR-PNT-08, docs/05 §1): an editable shape and its rendering in `tiles` (docs/05's
 * `cache`), like a text layer: it composites, masks and clips as pixels; editing renders it again.
 */
export type ShapeLayer = Omit<RasterLayer, 'type'> & {
  readonly type: 'shape';
  shape: ShapeModel;
  transform: number[];
};

export type Layer = RasterLayer | GroupLayer | AdjustmentLayer | TextLayer | ShapeLayer;

/** Layers drawn from a description (text, shapes): they keep it, a transform and their rendering. */
export type VectorLayer = TextLayer | ShapeLayer;
export const isVector = (l: Layer): l is VectorLayer => l.type === 'text' || l.type === 'shape';

/** Layers whose pixels live in tiles: raster layers, and text and shape layers (their rendering). */
export const hasPixels = (l: Layer): l is RasterLayer | VectorLayer =>
  l.type === 'raster' || l.type === 'text' || l.type === 'shape';

/** The plain text of a model, paragraphs joined by newlines. */
export function plainText(model: TextModel): string {
  return model.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
}

/** The text block's top-left corner (the transform's translation). */
export const textOrigin = (l: VectorLayer): { x: number; y: number } => ({
  x: l.transform[2]!,
  y: l.transform[5]!,
});

export const translation = (x: number, y: number): number[] => [1, 0, x, 0, 1, y, 0, 0, 1];

/** Layer › Rasterize Type: the text layer as the raster layer it draws (same id, props, pixels and mask). */
export function rasterize(l: VectorLayer): RasterLayer {
  if (l.type === 'text') {
    const { text: _text, transform: _transform, ...rest } = l;
    return { ...rest, type: 'raster' };
  }
  const { shape: _shape, transform: _transform, ...rest } = l;
  return { ...rest, type: 'raster' };
}

/** The text layer moved by (dx, dy): its rendering is moved by the caller; the text follows. */
export function shiftText(l: VectorLayer, dx: number, dy: number): number[] {
  const t = l.transform.slice();
  t[2] = t[2]! + dx;
  t[5] = t[5]! + dy;
  return t;
}

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
  props: Partial<LayerProps> & { id?: string; extra?: Record<string, unknown>; mask?: LayerMask | null } = {},
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

/** A new text layer with `tiles` as its rendering (FR-TXT-01). */
export function createTextLayer(
  name: string,
  text: TextModel,
  origin: { x: number; y: number },
  tiles = new TileGrid(),
  props: Partial<LayerProps> & { id?: string; extra?: Record<string, unknown>; mask?: LayerMask | null } = {},
): TextLayer {
  const { id, extra, ...rest } = props;
  return {
    id: id ?? newLayerId(),
    type: 'text',
    name,
    visible: true,
    opacity: 1,
    fillOpacity: 1,
    blendMode: 'normal',
    locks: { ...NO_LOCKS },
    clipped: false,
    tiles,
    text,
    transform: translation(origin.x, origin.y),
    ...rest,
    ...(extra ? { extra } : {}),
  };
}

/** A new shape layer with `tiles` as its rendering (FR-PNT-08). */
export function createShapeLayer(
  name: string,
  shape: ShapeModel,
  origin: { x: number; y: number },
  tiles = new TileGrid(),
  props: Partial<LayerProps> & { id?: string; extra?: Record<string, unknown>; mask?: LayerMask | null } = {},
): ShapeLayer {
  const { id, extra, ...rest } = props;
  return {
    id: id ?? newLayerId(),
    type: 'shape',
    name,
    visible: true,
    opacity: 1,
    fillOpacity: 1,
    blendMode: 'normal',
    locks: { ...NO_LOCKS },
    clipped: false,
    tiles,
    shape,
    transform: translation(origin.x, origin.y),
    ...rest,
    ...(extra ? { extra } : {}),
  };
}

/** A new adjustment layer (FR-ADJ-01); Photoshop gives it a reveal-all mask, so painting can hide it. */
export function createAdjustmentLayer(
  name: string,
  adjustment: Adjustment,
  props: Partial<LayerProps> & { id?: string; extra?: Record<string, unknown>; mask?: LayerMask | null } = {},
): AdjustmentLayer {
  const { id, extra, ...rest } = props;
  return {
    id: id ?? newLayerId(),
    type: 'adjustment',
    name,
    visible: true,
    opacity: 1,
    fillOpacity: 1,
    blendMode: 'normal',
    locks: { ...NO_LOCKS },
    clipped: false,
    adjustment,
    mask: { grid: new TileGrid(), background: 255, enabled: true, linked: true },
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
  /**
   * The selection (FR-SEL-01..06); null = nothing selected, so every pixel is editable. Changed only by
   * SetSelectionCommand and by commands that change the canvas size (which drop it).
   */
  selection: Mask | null = null;

  constructor(
    /** Canvas size in px. Changed only by commands (crop, image/canvas size, rotate: TreeCommand). */
    public width: number,
    public height: number,
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

  /** A layer that can have a mask: a raster, text or adjustment layer (FR-LAY-04). */
  masked(id: string): RasterLayer | AdjustmentLayer | VectorLayer {
    const layer = this.layer(id);
    if (layer.type === 'group') throw new Error(`Layer ${id} cannot have a mask`);
    return layer;
  }

  /** The layer `id` with pixels (raster or text); throws for groups and adjustment layers. */
  pixels(id: string): RasterLayer | VectorLayer {
    const layer = this.layer(id);
    if (!hasPixels(layer)) throw new Error(`Layer ${id} has no pixels`);
    return layer;
  }

  /** The raster layer `id`; throws for others (text must be rasterized before its pixels are edited). */
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
