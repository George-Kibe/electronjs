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

export const RasterLayerEntry = LayerBase.extend({ type: z.literal('raster'), tiles: EntryPath });
export type RasterLayerEntry = z.infer<typeof RasterLayerEntry>;

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
