/**
 * Small BMP codec (docs/09 §1): sharp/libvips has no BMP support. The decoder reads untrusted input, so
 * every field is validated before any pixel is touched. Supports 1/4/8-bit palettes and 16/24/32-bit
 * BI_RGB / BI_BITFIELDS, bottom-up and top-down. RLE and embedded JPEG/PNG are rejected.
 */
export class BmpError extends Error {
  constructor(
    readonly code: 'UNSUPPORTED_FORMAT' | 'CORRUPT_IMAGE' | 'TOO_LARGE',
    message: string,
  ) {
    super(message);
  }
}

export function isBmp(head: Uint8Array): boolean {
  return head.length >= 2 && head[0] === 0x42 && head[1] === 0x4d;
}

type Masks = [number, number, number, number];

function channel(value: number, mask: number): number {
  if (mask === 0) return 255;
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) shift++;
  const max = mask >>> shift;
  return Math.round((((value & mask) >>> shift) / max) * 255);
}

export function decodeBmp(
  buf: Uint8Array,
  limits: { maxSide: number; maxPixels: number },
): { width: number; height: number; rgba: Uint8Array } {
  if (!isBmp(buf) || buf.length < 26) throw new BmpError('CORRUPT_IMAGE', 'The BMP file is truncated.');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dataOffset = dv.getUint32(10, true);
  const headerSize = dv.getUint32(14, true);
  const core = headerSize === 12;
  if (![12, 40, 52, 56, 108, 124].includes(headerSize) || 14 + headerSize > buf.length)
    throw new BmpError('UNSUPPORTED_FORMAT', 'This BMP variant is not supported.');
  const width = core ? dv.getUint16(18, true) : dv.getInt32(18, true);
  const rawHeight = core ? dv.getInt16(20, true) : dv.getInt32(22, true);
  const bpp = core ? dv.getUint16(24, true) : dv.getUint16(28, true);
  const compression = core ? 0 : dv.getUint32(30, true);
  const topDown = rawHeight < 0;
  const height = Math.abs(rawHeight);
  if (width <= 0 || height <= 0) throw new BmpError('CORRUPT_IMAGE', 'The BMP has no dimensions.');
  if (width > limits.maxSide || height > limits.maxSide || width * height > limits.maxPixels)
    throw new BmpError('TOO_LARGE', 'This image is too large to open.');
  if (![1, 4, 8, 16, 24, 32].includes(bpp))
    throw new BmpError('UNSUPPORTED_FORMAT', 'This BMP bit depth is not supported.');
  if (compression !== 0 && compression !== 3 && compression !== 6)
    throw new BmpError('UNSUPPORTED_FORMAT', 'Compressed BMP files are not supported.');

  let masks: Masks | null = null;
  if (compression === 3 || compression === 6) {
    if (bpp !== 16 && bpp !== 32) throw new BmpError('CORRUPT_IMAGE', 'The BMP bit fields are invalid.');
    const at = 14 + 40; // masks live after the 40-byte header, or inside V4/V5 headers at the same place
    if (at + 12 > buf.length) throw new BmpError('CORRUPT_IMAGE', 'The BMP file is truncated.');
    const alpha = compression === 6 || headerSize >= 56 ? dv.getUint32(at + 12, true) : 0;
    masks = [dv.getUint32(at, true), dv.getUint32(at + 4, true), dv.getUint32(at + 8, true), alpha];
  } else if (bpp === 16) {
    masks = [0x7c00, 0x03e0, 0x001f, 0];
  }

  let palette: Uint8Array | null = null;
  if (bpp <= 8) {
    const used = core ? 0 : dv.getUint32(46, true);
    const count = used === 0 ? 1 << bpp : used;
    const entry = core ? 3 : 4;
    const at = 14 + headerSize;
    if (count > 256 || at + count * entry > buf.length)
      throw new BmpError('CORRUPT_IMAGE', 'The BMP palette is invalid.');
    palette = new Uint8Array(256 * 3);
    for (let i = 0; i < count; i++)
      palette.set([buf[at + i * entry + 2]!, buf[at + i * entry + 1]!, buf[at + i * entry]!], i * 3);
  }

  const stride = Math.floor((bpp * width + 31) / 32) * 4;
  if (dataOffset < 14 + headerSize || dataOffset + stride * height > buf.length)
    throw new BmpError('CORRUPT_IMAGE', 'The BMP file is truncated.');

  const rgba = new Uint8Array(width * height * 4);
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const row = dataOffset + (topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (palette) {
        const bit = x * bpp;
        const byte = buf[row + (bit >> 3)]!;
        const index = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        rgba.set([palette[index * 3]!, palette[index * 3 + 1]!, palette[index * 3 + 2]!, 255], o);
      } else if (bpp === 24 || (bpp === 32 && !masks)) {
        const p = row + x * (bpp / 8);
        const a = bpp === 32 ? buf[p + 3]! : 255;
        if (bpp === 32 && a !== 0) anyAlpha = true;
        rgba.set([buf[p + 2]!, buf[p + 1]!, buf[p]!, a], o);
      } else {
        const p = row + x * (bpp / 8);
        const v = bpp === 16 ? dv.getUint16(p, true) : dv.getUint32(p, true);
        const [rm, gm, bm, am] = masks!;
        rgba.set([channel(v, rm), channel(v, gm), channel(v, bm), am ? channel(v, am) : 255], o);
      }
    }
  }
  // 32-bit BI_RGB files usually leave the 4th byte zero: that means "no alpha", not "fully transparent".
  if (bpp === 32 && !masks && !anyAlpha) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { width, height, rgba };
}

/** Encodes straight RGBA as a 24-bit (alpha dropped) or 32-bit BGRA (BITMAPV4HEADER bit fields) BMP. */
export function encodeBmp(rgba: Uint8Array, width: number, height: number, bits: 24 | 32): Uint8Array {
  const headerSize = bits === 32 ? 108 : 40;
  const stride = Math.floor((bits * width + 31) / 32) * 4;
  const dataOffset = 14 + headerSize;
  const size = dataOffset + stride * height;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set([0x42, 0x4d]);
  dv.setUint32(2, size, true);
  dv.setUint32(10, dataOffset, true);
  dv.setUint32(14, headerSize, true);
  dv.setInt32(18, width, true);
  dv.setInt32(22, height, true); // bottom-up
  dv.setUint16(26, 1, true);
  dv.setUint16(28, bits, true);
  dv.setUint32(30, bits === 32 ? 3 : 0, true);
  dv.setUint32(34, stride * height, true);
  dv.setInt32(38, 2835, true); // 72 ppi
  dv.setInt32(42, 2835, true);
  if (bits === 32) {
    dv.setUint32(54, 0x00ff0000, true);
    dv.setUint32(58, 0x0000ff00, true);
    dv.setUint32(62, 0x000000ff, true);
    dv.setUint32(66, 0xff000000, true);
    dv.setUint32(70, 0x73524742, true); // LCS_sRGB ('sRGB')
  }
  for (let y = 0; y < height; y++) {
    let p = dataOffset + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[p++] = rgba[i + 2]!;
      out[p++] = rgba[i + 1]!;
      out[p++] = rgba[i]!;
      if (bits === 32) out[p++] = rgba[i + 3]!;
    }
  }
  return out;
}
