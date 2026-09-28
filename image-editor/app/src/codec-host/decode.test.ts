import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_INPUT_PIXELS } from '@shared/constants';
import { decodeToRgba, iccDescription } from './decode';

const dir = mkdtempSync(join(tmpdir(), 'ie-codec-'));
const f = (name: string) => join(dir, name);
const px = (data: Buffer, width: number, x: number, y: number) => [
  ...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
];

beforeAll(async () => {
  // 4×2 image, left half red, right half blue, stored with EXIF orientation 6 (rotate 90° CW to display).
  const raw = Buffer.alloc(4 * 2 * 3);
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 4; x++) raw.set(x < 2 ? [255, 0, 0] : [0, 0, 255], (y * 4 + x) * 3);
  await sharp(raw, { raw: { width: 4, height: 2, channels: 3 } })
    .png()
    .withMetadata({ orientation: 6 })
    .toFile(f('rotated.png'));
  // Display P3 tagged image with a colour that differs in sRGB.
  await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 160, b: 0 } } })
    .withIccProfile('p3')
    .png()
    .toFile(f('p3.png'));
  await sharp({
    create: { width: 3, height: 3, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } },
  })
    .png()
    .toFile(f('alpha.png'));
  await sharp({ create: { width: 20_001, height: 2, channels: 3, background: '#fff' } })
    .png()
    .toFile(f('too-wide.png'));
  writeFileSync(f('junk.jpg'), 'definitely not an image');
  const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#888' } })
    .jpeg()
    .toBuffer();
  writeFileSync(f('truncated.jpg'), jpeg.subarray(0, jpeg.length / 2));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('decodeToRgba (real sharp/libvips)', () => {
  it('applies EXIF orientation', async () => {
    const { header, data } = await decodeToRgba(f('rotated.png'), MAX_INPUT_PIXELS);
    expect(header).toMatchObject({
      width: 2,
      height: 4,
      orientation: 6,
      format: 'png',
      byteLength: 2 * 4 * 4,
    });
    expect(px(data, 2, 0, 0)).toEqual([255, 0, 0, 255]); // top after rotation = former left
    expect(px(data, 2, 0, 3)).toEqual([0, 0, 255, 255]);
  });

  it('converts embedded ICC profiles to sRGB and names the source profile', async () => {
    const { header, data } = await decodeToRgba(f('p3.png'), MAX_INPUT_PIXELS);
    expect(header.sourceProfile).toMatch(/P3/i);
    const [r, g, b] = px(data, 2, 0, 0);
    expect([r, g, b]).not.toEqual([0, 160, 0]); // converted
    expect(g).toBeGreaterThan(150);
  });

  it('keeps straight (unpremultiplied) alpha', async () => {
    const { data } = await decodeToRgba(f('alpha.png'), MAX_INPUT_PIXELS);
    expect(px(data, 3, 1, 1)).toEqual([10, 20, 30, 128]);
  });

  it('rejects documents beyond the maximum side', async () => {
    await expect(decodeToRgba(f('too-wide.png'), MAX_INPUT_PIXELS)).rejects.toMatchObject({
      code: 'TOO_LARGE',
    });
  });

  it('enforces the pixel budget before decoding (bomb guard)', async () => {
    await expect(decodeToRgba(f('p3.png'), 3)).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('maps unreadable input to clear codes', async () => {
    await expect(decodeToRgba(f('junk.jpg'), MAX_INPUT_PIXELS)).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
    });
    await expect(decodeToRgba(f('truncated.jpg'), MAX_INPUT_PIXELS)).rejects.toMatchObject({
      code: 'CORRUPT_IMAGE',
    });
    await expect(decodeToRgba(f('missing.png'), MAX_INPUT_PIXELS)).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
    });
  });

  it('falls back to a generic ICC description for malformed profiles', () => {
    expect(iccDescription(Buffer.alloc(10))).toBe('Embedded ICC profile');
  });
});
