import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { FORMAT_INFO, type ExportOptions } from '@shared/export-options';
import { encodeBmp } from './bmp';
import { CodecError } from './decode';
import { sanitizeExif } from './exif';

/**
 * Encodes straight RGBA8 sRGB pixels for export (docs/09 §2 "Export pipeline"): optional resize → matte for
 * formats without alpha → format options → sRGB ICC → metadata per policy. Returns the file bytes; main
 * writes them atomically. codec-host never writes user files itself.
 */
export async function encodeRgba(
  rgba: Uint8Array,
  width: number,
  height: number,
  options: ExportOptions,
  sourceExif: Uint8Array | null,
): Promise<Uint8Array> {
  if (rgba.byteLength !== width * height * 4)
    throw new CodecError('INTERNAL', 'Pixel data has the wrong size.');
  try {
    let image = sharp(rgba, { raw: { width, height, channels: 4 } });
    if (options.resize && (options.resize.width !== width || options.resize.height !== height)) {
      image = sharp(
        await image
          .resize(options.resize.width, options.resize.height, { fit: 'fill', kernel: 'lanczos3' })
          .raw()
          .toBuffer(),
        { raw: { width: options.resize.width, height: options.resize.height, channels: 4 } },
      );
    }
    const [r, g, b] = options.matte;
    const flattenAlpha = options.format === 'jpeg' || (options.format === 'bmp' && options.bmpBits === 24);
    if (flattenAlpha) image = image.flatten({ background: { r, g, b } });

    if (options.format === 'bmp') {
      const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return encodeBmp(data, info.width, info.height, options.bmpBits);
    }

    const chroma = options.chroma === 'auto' ? (options.quality >= 90 ? '4:4:4' : '4:2:0') : options.chroma;
    switch (options.format) {
      case 'png':
        image = image.png({
          compressionLevel: options.compressionLevel,
          palette: options.palette,
          ...(options.palette ? { colours: options.colours, dither: options.dither } : {}),
        });
        break;
      case 'jpeg':
        image = image.jpeg({
          quality: options.quality,
          progressive: options.progressive,
          chromaSubsampling: chroma,
          mozjpeg: true,
        });
        break;
      case 'webp':
        image = image.webp({
          quality: options.quality,
          lossless: options.lossless,
          effort: Math.min(6, options.effort),
        });
        break;
      case 'avif':
        image = image.avif({ quality: options.quality, effort: options.effort, chromaSubsampling: '4:2:0' });
        break;
      case 'gif':
        image = image.gif({ colours: options.colours, dither: options.dither });
        break;
      case 'tiff':
        image = image.tiff({ compression: 'lzw' });
        break;
    }
    if (options.embedIcc && FORMAT_INFO[options.format].icc) image = image.withIccProfile('srgb');
    let bytes: Uint8Array = await image.toBuffer();
    const exif = FORMAT_INFO[options.format].metadata ? sanitizeExif(sourceExif, options.metadata) : null;
    if (exif) bytes = options.format === 'jpeg' ? injectJpegExif(bytes, exif) : injectPngExif(bytes, exif);
    return bytes;
  } catch (err) {
    if (err instanceof CodecError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (/memory/i.test(message))
      throw new CodecError('OUT_OF_MEMORY', 'Not enough memory to export this image.');
    throw new CodecError('INTERNAL', 'The image could not be encoded.');
  }
}

/** Inserts an APP1 Exif segment after SOI (and after a JFIF APP0, if present). */
export function injectJpegExif(jpeg: Uint8Array, exif: Uint8Array): Uint8Array {
  if (exif.length + 2 > 0xffff || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4]! << 8) | jpeg[5]!);
  const segment = new Uint8Array(4 + exif.length);
  segment.set([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff]);
  segment.set(exif, 4);
  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, at));
  out.set(segment, at);
  out.set(jpeg.subarray(at), at + segment.length);
  return out;
}

/** Inserts an eXIf chunk (TIFF data, without the "Exif\0\0" prefix) right after IHDR. */
export function injectPngExif(png: Uint8Array, exif: Uint8Array): Uint8Array {
  const tiff = exif.subarray(6);
  const ihdrEnd = 8 + 8 + 13 + 4; // signature + IHDR (length, type, 13 data bytes, CRC)
  if (png.length < ihdrEnd || String.fromCharCode(...png.subarray(12, 16)) !== 'IHDR') return png;
  const chunk = new Uint8Array(12 + tiff.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, tiff.length);
  chunk.set([0x65, 0x58, 0x49, 0x66], 4); // "eXIf"
  chunk.set(tiff, 8);
  dv.setUint32(8 + tiff.length, crc32(chunk.subarray(4, 8 + tiff.length)));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd));
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}
