import { z } from 'zod';
import { MAX_DOCUMENT_SIDE } from './constants';

/** `.iep` project format v1 (docs/05 §2, ADR-0007). Zod-validated on load; unknown fields are preserved. */
export const IEP_MIMETYPE = 'application/x-imageeditor-project';
export const IEP_VERSION = 1;

/** Safety limits on load (docs/05 §2.4). */
export const IEP_LIMITS = {
  maxLayers: 1000,
  maxGroupDepth: 32,
  maxTilesPerLayer: 10_000,
  maxManifestBytes: 16 * 1024 * 1024,
} as const;

/**
 * Tiles a raster layer may hold, in tile coordinates [tx0, tx1) × [ty0, ty1). Pixels can lie outside the
 * canvas (moved there with the Move tool, FR-TRF-07, and kept so moving back restores them), up to one
 * canvas width/height beyond each edge. The Move tool discards pixels beyond that, and the reader rejects them.
 */
export function tileRange(
  width: number,
  height: number,
  tileSize = 256,
): { tx0: number; ty0: number; tx1: number; ty1: number } {
  const cols = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);
  return { tx0: -cols, ty0: -rows, tx1: 2 * cols, ty1: 2 * rows };
}

const unit = z.number().min(0).max(1);
const side = z.number().int().min(1).max(MAX_DOCUMENT_SIDE);

export const BlendModeSchema = z.enum([
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
]);

const Locks = z.object({
  all: z.boolean(),
  pixels: z.boolean(),
  position: z.boolean(),
  transparency: z.boolean(),
});

/** Zip entry path inside the project: relative, no `..`, no backslashes or drive letters. */
export const EntryPath = z
  .string()
  .min(1)
  .max(512)
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._\-/]+$/, 'Invalid entry path');

export const LayerBase = z.looseObject({
  id: z.string().min(1).max(128),
  type: z.string().min(1).max(64),
  name: z.string().max(1024).default('Layer'),
  visible: z.boolean().default(true),
  opacity: unit.default(1),
  fillOpacity: unit.default(1),
  blendMode: BlendModeSchema.catch('normal').default('normal'),
  locks: Locks.default({ all: false, pixels: false, position: false, transparency: false }),
  clipped: z.boolean().default(false),
});

/** A raster layer's mask (docs/05 §2.1): one-channel tiles, `background` outside them. */
export const LayerMaskEntry = z.object({
  background: z.union([z.literal(0), z.literal(255)]),
  enabled: z.boolean().default(true),
  linked: z.boolean().default(true),
  tiles: EntryPath,
});

export const RasterLayerEntry = LayerBase.extend({
  type: z.literal('raster'),
  tiles: EntryPath,
  mask: LayerMaskEntry.optional(),
});
export type RasterLayerEntry = z.infer<typeof RasterLayerEntry>;

const range = (min: number, max: number) => z.number().min(min).max(max);
const rgb255 = z.tuple([range(0, 255), range(0, 255), range(0, 255)]);
const shift = z.tuple([range(-100, 100), range(-100, 100), range(-100, 100)]);
const levelsChannel = z.object({
  inBlack: range(0, 253),
  inWhite: range(2, 255),
  gamma: range(0.01, 9.99),
  outBlack: range(0, 255),
  outWhite: range(0, 255),
});
const IDENTITY_LEVELS = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
const curve = z
  .array(z.tuple([range(0, 255), range(0, 255)]))
  .min(2)
  .max(16);
const IDENTITY_CURVE: Array<[number, number]> = [
  [0, 0],
  [255, 255],
];

/** The adjustment kinds this version knows (an adjustment layer of another kind is left out, not an error). */
export const ADJUSTMENT_KIND_NAMES = [
  'brightness-contrast',
  'levels',
  'curves',
  'exposure',
  'vibrance',
  'hue-saturation',
  'color-balance',
  'black-white',
  'photo-filter',
  'invert',
  'posterize',
  'threshold',
] as const;

/** An adjustment layer's settings (docs/05 §1, FR-ADJ-01), range-checked: files are untrusted. */
export const AdjustmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('brightness-contrast'),
    brightness: range(-150, 150),
    contrast: range(-100, 100),
    legacy: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('levels'),
    channels: z.object({
      rgb: levelsChannel.default(IDENTITY_LEVELS),
      r: levelsChannel.default(IDENTITY_LEVELS),
      g: levelsChannel.default(IDENTITY_LEVELS),
      b: levelsChannel.default(IDENTITY_LEVELS),
    }),
  }),
  z.object({
    kind: z.literal('curves'),
    channels: z.object({
      rgb: curve.default(IDENTITY_CURVE),
      r: curve.default(IDENTITY_CURVE),
      g: curve.default(IDENTITY_CURVE),
      b: curve.default(IDENTITY_CURVE),
    }),
  }),
  z.object({
    kind: z.literal('exposure'),
    exposure: range(-20, 20),
    offset: range(-0.5, 0.5),
    gamma: range(0.01, 9.99),
  }),
  z.object({ kind: z.literal('vibrance'), vibrance: range(-100, 100), saturation: range(-100, 100) }),
  z.object({
    kind: z.literal('hue-saturation'),
    hue: range(-180, 360),
    saturation: range(-100, 100),
    lightness: range(-100, 100),
    colorize: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('color-balance'),
    shadows: shift,
    midtones: shift,
    highlights: shift,
    preserveLuminosity: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('black-white'),
    weights: z.object({
      r: range(-200, 300),
      y: range(-200, 300),
      g: range(-200, 300),
      c: range(-200, 300),
      b: range(-200, 300),
      m: range(-200, 300),
    }),
    tint: rgb255.optional(),
  }),
  z.object({
    kind: z.literal('photo-filter'),
    color: rgb255,
    density: range(0, 100),
    preserveLuminosity: z.boolean().default(true),
  }),
  z.object({ kind: z.literal('invert') }),
  z.object({ kind: z.literal('posterize'), levels: z.number().int().min(2).max(255) }),
  z.object({ kind: z.literal('threshold'), level: z.number().int().min(1).max(255) }),
]);

export const AdjustmentLayerEntry = LayerBase.extend({
  type: z.literal('adjustment'),
  adjustment: AdjustmentSchema,
  mask: LayerMaskEntry.optional(),
});
export type AdjustmentLayerEntry = z.infer<typeof AdjustmentLayerEntry>;

/** Children are validated recursively by the reader (depth and total count are limited). */
export const GroupLayerEntry = LayerBase.extend({
  type: z.literal('group'),
  passThrough: z.boolean().default(true),
  collapsed: z.boolean().default(false),
  children: z.array(z.unknown()).max(IEP_LIMITS.maxLayers),
});
export type GroupLayerEntry = z.infer<typeof GroupLayerEntry>;

export const DocumentEntry = z.looseObject({
  width: side,
  height: side,
  ppi: z.number().min(1).max(10_000).default(72),
  colorSpace: z.literal('sRGB').default('sRGB'),
  guides: z
    .object({
      horizontal: z.array(z.number()).max(1000),
      vertical: z.array(z.number()).max(1000),
    })
    .default({ horizontal: [], vertical: [] }),
  activeLayerId: z.string().max(128).optional(),
  name: z.string().max(1024).optional(),
  sourceProfile: z.string().max(1024).nullable().optional(),
  /** Raw EXIF of the source image (our addition; optional). */
  exif: EntryPath.optional(),
  /** The saved selection (docs/05 §2): one-channel tiles. Optional; a missing or damaged entry is ignored. */
  selection: EntryPath.optional(),
});
export type DocumentEntry = z.infer<typeof DocumentEntry>;

export const Manifest = z.looseObject({
  format: z.literal('iep'),
  version: z.number().int().min(1),
  app: z.looseObject({ name: z.string().max(256), version: z.string().max(64) }).optional(),
  document: DocumentEntry,
  /** Bottom → top. Entries are validated per type by the reader (unknown types keep the file read-only). */
  layers: z.array(LayerBase).min(1).max(IEP_LIMITS.maxLayers),
});
export type Manifest = z.infer<typeof Manifest>;
