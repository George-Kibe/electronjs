import { open, readFile, stat } from 'node:fs/promises';
import sharp from 'sharp';
import { MAX_DOCUMENT_SIDE } from '@shared/constants';
import { BmpError, decodeBmp, isBmp } from './bmp';
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
/** EXIF blocks larger than one JPEG APP1 segment are not carried through (they could not be re-embedded). */
const MAX_EXIF_BYTES = 65_533;

async function startsWithBmp(path: string): Promise<boolean> {
  const file = await open(path, 'r');
  try {
    const head = new Uint8Array(2);
    await file.read(head, 0, 2, 0);
    return isBmp(head);
  } finally {
    await file.close();
  }
}

async function decodeBmpFile(
  path: string,
  limitInputPixels: number,
): Promise<{ header: DecodedHeader; data: Buffer }> {
  // Upper bound for a valid BMP within the pixel budget (32 bpp + headers); larger files are rejected unread.
  if ((await stat(path)).size > limitInputPixels * 4 + 1024 * 1024)
    throw new CodecError('TOO_LARGE', 'This image is too large to open.');
  const { width, height, rgba } = decodeBmp(await readFile(path), {
    maxSide: MAX_DOCUMENT_SIDE,
    maxPixels: limitInputPixels,
  });
  const data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  return {
    header: {
      type: 'decoded-header',
      width,
      height,
      byteLength: data.byteLength,
      format: 'bmp',
      sourceProfile: null,
      orientation: 1,
      exif: null,
    },
    data,
  };
}

export async function decodeToRgba(
  path: string,
  limitInputPixels: number,
): Promise<{ header: DecodedHeader; data: Buffer }> {
  try {
    if (await startsWithBmp(path)) return await decodeBmpFile(path, limitInputPixels);
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
        exif: meta.exif && meta.exif.byteLength <= MAX_EXIF_BYTES ? new Uint8Array(meta.exif) : null,
      },
      data,
    };
  } catch (err) {
    throw toCodecError(err);
  }
}

export function toCodecError(err: unknown): CodecError {
  if (err instanceof CodecError) return err;
  if (err instanceof BmpError) return new CodecError(err.code, err.message);
  const message = err instanceof Error ? err.message : String(err);
  if (/exceeds pixel limit/i.test(message))
    return new CodecError('TOO_LARGE', 'This image is too large to open.');
  if (/unsupported image format|Input file is missing|ENOENT/i.test(message)) {
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
