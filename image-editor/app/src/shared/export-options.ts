import { z } from 'zod';
import { MAX_DOCUMENT_SIDE } from './constants';

/** Export formats and options (FR-DOC-05, docs/09 §5). Validated in codec-host before encoding. */
export const ExportFormat = z.enum(['png', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'tiff']);
export type ExportFormat = z.infer<typeof ExportFormat>;

export const MetadataPolicy = z.enum(['keep', 'remove-gps', 'remove-all']);
export type MetadataPolicy = z.infer<typeof MetadataPolicy>;

const byte = z.number().int().min(0).max(255);

export const ExportOptions = z.object({
  format: ExportFormat,
  /** JPEG 85, WebP 80, AVIF 60 by default (see defaultOptions). */
  quality: z.number().int().min(1).max(100),
  lossless: z.boolean(),
  progressive: z.boolean(),
  /** 'auto' = 4:2:0 below quality 90, 4:4:4 from 90. */
  chroma: z.enum(['auto', '4:2:0', '4:4:4']),
  compressionLevel: z.number().int().min(0).max(9),
  palette: z.boolean(),
  colours: z.number().int().min(2).max(256),
  dither: z.number().min(0).max(1),
  effort: z.number().int().min(0).max(9),
  bmpBits: z.union([z.literal(24), z.literal(32)]),
  /** Background for formats without alpha (JPEG, 24-bit BMP). */
  matte: z.tuple([byte, byte, byte]),
  embedIcc: z.boolean(),
  metadata: MetadataPolicy,
  resize: z
    .object({
      width: z.number().int().min(1).max(MAX_DOCUMENT_SIDE),
      height: z.number().int().min(1).max(MAX_DOCUMENT_SIDE),
    })
    .nullable(),
});
export type ExportOptions = z.infer<typeof ExportOptions>;

export const FORMAT_INFO: Record<
  ExportFormat,
  { label: string; extensions: string[]; alpha: boolean; metadata: boolean; icc: boolean }
> = {
  png: { label: 'PNG', extensions: ['png'], alpha: true, metadata: true, icc: true },
  jpeg: { label: 'JPEG', extensions: ['jpg', 'jpeg'], alpha: false, metadata: true, icc: true },
  webp: { label: 'WebP', extensions: ['webp'], alpha: true, metadata: false, icc: true },
  avif: { label: 'AVIF', extensions: ['avif'], alpha: true, metadata: false, icc: true },
  gif: { label: 'GIF', extensions: ['gif'], alpha: true, metadata: false, icc: false },
  bmp: { label: 'BMP', extensions: ['bmp'], alpha: true, metadata: false, icc: false },
  tiff: { label: 'TIFF', extensions: ['tif', 'tiff'], alpha: true, metadata: false, icc: true },
};

export function defaultOptions(format: ExportFormat): ExportOptions {
  return {
    format,
    quality: format === 'webp' ? 80 : format === 'avif' ? 60 : 85,
    lossless: false,
    progressive: true,
    chroma: 'auto',
    compressionLevel: 6,
    palette: format === 'gif',
    colours: 256,
    dither: 1,
    effort: 4,
    bmpBits: 24,
    matte: [255, 255, 255],
    embedIcc: true,
    metadata: 'remove-gps',
    resize: null,
  };
}
