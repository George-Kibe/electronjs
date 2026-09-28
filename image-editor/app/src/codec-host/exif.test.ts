import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseExif, sanitizeExif } from './exif';

/** A real camera-like EXIF block written by libvips (big-endian or little-endian as libexif chooses). */
async function sourceExif(): Promise<Uint8Array> {
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#808080' } })
    .withExif({
      IFD0: { Make: 'Acme', Model: 'Shooter 3000', Copyright: 'Jane Doe', Orientation: '6' },
      IFD2: {
        ExposureTime: '1/125',
        FNumber: '28/10',
        DateTimeOriginal: '2026:09:01 10:00:00',
        BodySerialNumber: 'SN-12345',
      },
      IFD3: {
        GPSLatitudeRef: 'S',
        GPSLatitude: '1/1 17/1 0/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '36/1 49/1 0/1',
      },
    })
    .jpeg()
    .toBuffer();
  return new Uint8Array((await sharp(jpeg).metadata()).exif!);
}

const ascii = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

describe('EXIF sanitiser (FR-DOC-09)', () => {
  it('parses the source block', async () => {
    const parsed = parseExif(await sourceExif())!;
    expect(parsed.ifd0.some((e) => e.tag === 0x010f)).toBe(true);
    expect(parsed.gps.length).toBeGreaterThan(0);
  });

  it('removes location by default but keeps camera details, with orientation reset to 1', async () => {
    const out = sanitizeExif(await sourceExif(), 'remove-gps')!;
    const parsed = parseExif(out)!;
    expect(parsed.gps).toEqual([]);
    expect(parsed.ifd0.some((e) => e.tag === 0x8825)).toBe(false);
    const orientation = parsed.ifd0.find((e) => e.tag === 0x0112)!;
    expect(orientation.value[0]).toBe(1);
    expect(ascii(out)).toContain('Acme');
    expect(ascii(out)).toContain('Jane Doe');
    expect(parsed.exif.some((e) => e.tag === 0x829a)).toBe(true); // ExposureTime
    expect(ascii(out)).not.toContain('SN-12345'); // serial numbers only with "Keep"
  });

  it('keeps location and serial numbers only when asked to keep metadata', async () => {
    const out = sanitizeExif(await sourceExif(), 'keep')!;
    const parsed = parseExif(out)!;
    expect(parsed.gps.map((e) => e.tag)).toEqual(expect.arrayContaining([1, 2, 3, 4]));
    expect(ascii(out)).toContain('SN-12345');
    expect(parsed.ifd0.find((e) => e.tag === 0x0112)!.value[0]).toBe(1);
  });

  it('writes nothing for "Remove all" or when there is no source EXIF', async () => {
    expect(sanitizeExif(await sourceExif(), 'remove-all')).toBeNull();
    expect(sanitizeExif(null, 'keep')).toBeNull();
  });

  it('never leaks bytes it did not keep (rebuilds instead of editing in place)', async () => {
    const out = sanitizeExif(await sourceExif(), 'remove-gps')!;
    // Hunt for the GPS rational 36/1 49/1 as it would be stored (either byte order).
    const hay = Buffer.from(out);
    for (const le of [true, false]) {
      const needle = Buffer.alloc(8);
      if (le) {
        needle.writeUInt32LE(36, 0);
        needle.writeUInt32LE(1, 4);
      } else {
        needle.writeUInt32BE(36, 0);
        needle.writeUInt32BE(1, 4);
      }
      expect(hay.includes(needle)).toBe(false);
    }
  });

  it('handles hostile input without throwing (fuzz)', async () => {
    const valid = await sourceExif();
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat(valid.length - 1), fc.integer({ min: 0, max: 255 })), { maxLength: 12 }),
        (edits) => {
          const bytes = valid.slice();
          for (const [at, v] of edits) bytes[at] = v;
          const out = sanitizeExif(bytes, 'keep');
          if (out) expect(parseExif(out)).not.toBeNull();
        },
      ),
      { numRuns: 500 },
    );
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => void sanitizeExif(bytes, 'remove-gps')),
    );
  });
});
