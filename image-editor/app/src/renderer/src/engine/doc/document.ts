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

export type LayerProps = Pick<
  RasterLayer,
  'name' | 'visible' | 'opacity' | 'fillOpacity' | 'blendMode' | 'locks' | 'clipped'
>;

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
 * Document model (docs/05 §1), M1 subset: a flat stack of raster layers (bottom → top). Mutated only by
 * Commands (engine/doc/commands.ts).
 */
export class Document {
  readonly layers: RasterLayer[] = [];
  activeLayerId: string;
  readonly meta: DocumentMeta;

  constructor(
    readonly width: number,
    readonly height: number,
    layers: RasterLayer | RasterLayer[],
    meta: Partial<DocumentMeta> = {},
  ) {
    const list = Array.isArray(layers) ? layers : [layers];
    if (list.length === 0) throw new Error('A document needs at least one layer');
    this.layers.push(...list);
    this.activeLayerId = list.at(-1)!.id;
    this.meta = { ...DEFAULT_META, ...meta };
  }

  layer(id: string): RasterLayer {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) throw new Error(`No layer ${id}`);
    return layer;
  }

  get activeLayer(): RasterLayer {
    return this.layer(this.activeLayerId);
  }

  indexOf(id: string): number {
    return this.layers.findIndex((l) => l.id === id);
  }
}
