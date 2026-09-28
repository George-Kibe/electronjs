import sharp from 'sharp';
import { MAX_DOCUMENT_SIDE } from '@shared/constants';
import type { DecodedHeader } from '@shared/codec-protocol';
import type { CodecErrorCode } from '@shared/schemas';

export class CodecError extends Error {
  constructor(
    public readonly code: CodecErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CodecError';
  }
}

/**
 * Decodes an image file to straight RGBA8 in sRGB (docs/09 §2): EXIF orientation applied, embedded ICC
 * profile converted to sRGB, first frame/page only. The pixel limit is checked from the header before
 * decoding (decompression-bomb guard, docs/06 §3).
 */
export async function decodeToRgba(
  path: string,
  limitInputPixels: number,
): Promise<{ header: DecodedHeader; data: Buffer }> {
  try {
    const image = sharp(path, { limitInputPixels, failOn: 'error', sequentialRead: true, pages: 1 });
    const meta = await image.metadata();
    const orientation = meta.orientation ?? 1;
    const rotated = orientation >= 5; // orientations 5–8 swap width and height
    const width = rotated ? meta.height : meta.width;
    const height = rotated ? meta.width : meta.height;
    if (!width || !height) throw new CodecError('CORRUPT_IMAGE', 'The image has no dimensions.');
    if (width > MAX_DOCUMENT_SIDE || height > MAX_DOCUMENT_SIDE) {
      throw new CodecError(
        'TOO_LARGE',
        `Images larger than ${MAX_DOCUMENT_SIDE} pixels per side are not supported.`,
      );
    }
    const { data, info } = await image
      .rotate()
      .toColourspace('srgb')
      .ensureAlpha()
      .raw({ depth: 'uchar' })
      .toBuffer({ resolveWithObject: true });
    return {
      header: {
        type: 'decoded-header',
        width: info.width,
        height: info.height,
        byteLength: data.byteLength,
        format: meta.format ?? 'unknown',
        sourceProfile: meta.icc ? iccDescription(meta.icc) : null,
        orientation,
      },
      data,
    };
  } catch (err) {
    throw toCodecError(err);
  }
}

export function toCodecError(err: unknown): CodecError {
  if (err instanceof CodecError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/exceeds pixel limit/i.test(message))
    return new CodecError('TOO_LARGE', 'This image is too large to open.');
  if (/unsupported image format|Input file is missing/i.test(message)) {
    return new CodecError('UNSUPPORTED_FORMAT', 'This file is not a supported image.');
  }
  if (/memory/i.test(message))
    return new CodecError('OUT_OF_MEMORY', 'Not enough memory to open this image.');
  return new CodecError('CORRUPT_IMAGE', 'The image appears to be damaged and could not be read.');
}

/** Reads the ICC 'desc' tag (v2 'desc' or v4 'mluc') for display, e.g. "Display P3". */
export function iccDescription(icc: Buffer): string {
  try {
    const count = icc.readUInt32BE(128);
    for (let i = 0; i < count; i++) {
      const at = 132 + i * 12;
      if (icc.toString('ascii', at, at + 4) !== 'desc') continue;
      const offset = icc.readUInt32BE(at + 4);
      const type = icc.toString('ascii', offset, offset + 4);
      if (type === 'desc') {
        const len = icc.readUInt32BE(offset + 8);
        return icc.toString('latin1', offset + 12, offset + 12 + len).replace(/\0+$/, '');
      }
      if (type === 'mluc') {
        const recLen = icc.readUInt32BE(offset + 16 + 4);
        const recOffset = icc.readUInt32BE(offset + 16 + 8);
        return icc
          .subarray(offset + recOffset, offset + recOffset + recLen)
          .swap16()
          .toString('utf16le');
      }
    }
  } catch {
    // fall through
  }
  return 'Embedded ICC profile';
}
