import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { defaultOptions, type ExportFormat, type ExportOptions } from '@shared/export-options';
import { decodeBmp } from './bmp';
import { encodeRgba } from './encode';
import { parseExif } from './exif';

const W = 40;
const H = 30;
/** Left half opaque red, right half 50 % transparent blue. */
function pixels(): Uint8Array {
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) rgba.set(x < W / 2 ? [255, 0, 0, 255] : [0, 0, 255, 128], (y * W + x) * 4);
  return rgba;
}
const opts = (format: ExportFormat, patch: Partial<ExportOptions> = {}): ExportOptions => ({
  ...defaultOptions(format),
  ...patch,
});

async function exifSource(): Promise<Uint8Array> {
  const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })
    .withExif({ IFD0: { Make: 'Acme' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '1/1 2/1 3/1' } })
    .jpeg()
    .toBuffer();
  return new Uint8Array((await sharp(jpeg).metadata()).exif!);
}

describe('export encoder (FR-DOC-05, docs/09 §2)', () => {
  it.each(['png', 'jpeg', 'webp', 'avif', 'gif', 'tiff'] as const)(
    '%s decodes back at the right size',
    async (format) => {
      const bytes = await encodeRgba(pixels(), W, H, opts(format), null);
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe(format === 'avif' ? 'heif' : format);
      expect([meta.width, meta.height]).toEqual([W, H]);
    },
  );

  it('PNG is lossless and keeps alpha', async () => {
    const bytes = await encodeRgba(pixels(), W, H, opts('png'), null);
    const { data } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...data.subarray((W - 1) * 4, W * 4)]).toEqual([0, 0, 255, 128]);
  });

  it('JPEG flattens transparency onto the matte colour', async () => {
    const bytes = await encodeRgba(pixels(), W, H, opts('jpeg', { quality: 100, matte: [0, 0, 0] }), null);
    const { data } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    const [r, g, b] = data.subarray((5 * W + W - 5) * 3, (5 * W + W - 5) * 3 + 3);
    expect(Math.abs(r! - 0) + Math.abs(g! - 0) + Math.abs(b! - 128)).toBeLessThan(12); // 50 % blue over black
  });

  it('embeds the sRGB profile unless told not to', async () => {
    expect((await sharp(await encodeRgba(pixels(), W, H, opts('png'), null)).metadata()).icc).toBeDefined();
    expect(
      (await sharp(await encodeRgba(pixels(), W, H, opts('png', { embedIcc: false }), null)).metadata()).icc,
    ).toBeUndefined();
  });

  it('resizes on export', async () => {
    const bytes = await encodeRgba(pixels(), W, H, opts('png', { resize: { width: 20, height: 15 } }), null);
    const meta = await sharp(bytes).metadata();
    expect([meta.width, meta.height]).toEqual([20, 15]);
  });

  it('writes 24-bit BMP with matte and 32-bit BMP with alpha', async () => {
    const b24 = decodeBmp(await encodeRgba(pixels(), W, H, opts('bmp'), null), {
      maxSide: 100,
      maxPixels: 10_000,
    });
    expect([...b24.rgba.subarray((W - 1) * 4, W * 4)]).toEqual([127, 127, 255, 255]); // 50 % blue on white
    const b32 = decodeBmp(await encodeRgba(pixels(), W, H, opts('bmp', { bmpBits: 32 }), null), {
      maxSide: 100,
      maxPixels: 10_000,
    });
    expect([...b32.rgba.subarray((W - 1) * 4, W * 4)]).toEqual([0, 0, 255, 128]);
  });

  it.each(['jpeg', 'png'] as const)(
    '%s: applies the metadata policy (GPS removed by default)',
    async (format) => {
      const exif = await exifSource();
      const def = await sharp(await encodeRgba(pixels(), W, H, opts(format), exif)).metadata();
      const parsed = parseExif(new Uint8Array(def.exif!))!;
      expect(Buffer.from(def.exif!).toString('latin1')).toContain('Acme');
      expect(parsed.gps).toEqual([]);
      expect(def.orientation).toBe(1);

      const kept = await sharp(
        await encodeRgba(pixels(), W, H, opts(format, { metadata: 'keep' }), exif),
      ).metadata();
      expect(parseExif(new Uint8Array(kept.exif!))!.gps.length).toBeGreaterThan(0);

      const none = await sharp(
        await encodeRgba(pixels(), W, H, opts(format, { metadata: 'remove-all' }), exif),
      ).metadata();
      expect(none.exif).toBeUndefined();
    },
  );

  it('rejects mismatched pixel data', async () => {
    await expect(encodeRgba(new Uint8Array(10), W, H, opts('png'), null)).rejects.toThrow(/wrong size/);
  });
});
