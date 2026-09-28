import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGroupLayer, createRasterLayer, Document } from '../doc/document';
import { TILE_BYTES, TileGrid } from '../tiles/tile';
import { encodeTiles, IepError, readIep, writeIep } from './iep';
import { fromSnapshot, toSnapshot } from './snapshot';

const BUDGET = { maxTileBytes: 512 * 1024 * 1024 };

function sampleDoc(): Document {
  const bg = createRasterLayer('Background', TileGrid.filled(300, 200, [255, 255, 255, 255]));
  const rgba = new Uint8Array(300 * 200 * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = (i / 4) % 251;
    rgba[i + 1] = 40;
    rgba[i + 2] = 200;
    rgba[i + 3] = (i / 4) % 7 === 0 ? 0 : 180;
  }
  const paint = createRasterLayer('Paint “ü” 🎨', TileGrid.fromRgba(300, 200, rgba), {
    opacity: 0.5,
    fillOpacity: 0.75,
    blendMode: 'multiply',
    visible: false,
    locks: { all: false, pixels: true, position: false, transparency: true },
    clipped: true,
  });
  const doc = new Document(300, 200, [bg, paint], {
    name: 'Holiday',
    ppi: 300,
    guides: { horizontal: [10], vertical: [20.5] },
    sourceProfile: 'Display P3',
    exif: new Uint8Array([0x4d, 0x4d, 0, 42, 1, 2, 3]),
  });
  doc.activeLayerId = bg.id;
  return doc;
}

function roundTrip(doc: Document): { doc: Document; readOnlyReason: string | null } {
  const bytes = writeIep(toSnapshot(doc), { appVersion: '0.1.0' });
  const read = readIep(bytes, BUDGET);
  return { doc: fromSnapshot(read.doc), readOnlyReason: read.readOnlyReason };
}

/** Builds a project zip by hand, for malformed-input tests. */
function zip(
  manifest: unknown,
  files: Zippable = {},
  mimetype = 'application/x-imageeditor-project',
): Uint8Array {
  return zipSync({
    mimetype: [strToU8(mimetype), { level: 0 }],
    'manifest.json': strToU8(JSON.stringify(manifest)),
    ...files,
  });
}

const layerEntry = (over: Record<string, unknown> = {}) => ({
  id: 'L1',
  type: 'raster',
  name: 'Layer',
  tiles: 'layers/0/tiles.bin',
  ...over,
});
const manifest = (over: Record<string, unknown> = {}, layers: unknown[] = [layerEntry()]) => ({
  format: 'iep',
  version: 1,
  document: { width: 256, height: 256 },
  layers,
  ...over,
});
const oneTile = () => encodeTiles([['0,0', new Uint8Array(TILE_BYTES).fill(9)]]);
const noisyTile = () => encodeTiles([['0,0', new Uint8Array(TILE_BYTES).map((_, i) => (i * 7919) % 256)]]);
const sameBytes = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Buffer.compare(Buffer.from(a as Uint8Array), Buffer.from(b as Uint8Array)) === 0;

describe('.iep writer/reader (FR-DOC-04, docs/05 §2)', () => {
  it('round-trips pixels, layer properties and document metadata exactly', () => {
    const original = sampleDoc();
    const { doc, readOnlyReason } = roundTrip(original);
    expect(readOnlyReason).toBeNull();
    expect(doc.width).toBe(300);
    expect(doc.height).toBe(200);
    expect(doc.activeLayerId).toBe(original.activeLayerId);
    expect(doc.meta).toMatchObject({
      name: 'Holiday',
      ppi: 300,
      guides: { horizontal: [10], vertical: [20.5] },
      sourceProfile: 'Display P3',
    });
    expect([...doc.meta.exif!]).toEqual([0x4d, 0x4d, 0, 42, 1, 2, 3]);
    expect(doc.layers.length).toBe(2);
    for (const src of original.layers) {
      if (src.type !== 'raster') continue;
      const layer = doc.raster(src.id);
      const { tiles: _a, ...props } = layer;
      const { tiles: _b, ...srcProps } = src;
      expect(props).toEqual(srcProps);
      expect([...layer.tiles.keys()].sort()).toEqual([...src.tiles.keys()].sort());
      for (const [key, tile] of src.tiles.entries())
        expect(sameBytes(layer.tiles.get(key)!.data, tile.data)).toBe(true);
    }
  });

  it('writes the mimetype first and uncompressed so the type can be sniffed', () => {
    const bytes = writeIep(toSnapshot(sampleDoc()), { appVersion: '0.1.0' });
    // Local file header: signature, …, name length at 26, name at 30, then the stored data.
    expect(strFromU8(bytes.subarray(30, 38))).toBe('mimetype');
    expect(bytes[8]).toBe(0); // compression method 0 = stored
    expect(strFromU8(bytes.subarray(38, 38 + 33))).toBe('application/x-imageeditor-project');
  });

  it('stores uniform tiles compactly (a white background costs bytes, not 256 KB per tile)', () => {
    const doc = new Document(
      2560,
      2560,
      createRasterLayer('Background', TileGrid.filled(2560, 2560, [255, 255, 255, 255])),
    );
    const bytes = writeIep(toSnapshot(doc), { appVersion: '0.1.0' });
    expect(bytes.byteLength).toBeLessThan(10_000);
    const back = fromSnapshot(readIep(bytes, BUDGET).doc);
    expect(back.raster(back.layers[0]!.id).tiles.pixel(2559, 2559)).toEqual([255, 255, 255, 255]);
  });

  it('round-trips nested groups with their pass-through, collapsed and blend settings', () => {
    const inner = createRasterLayer('Inner', TileGrid.filled(300, 200, [0, 0, 255, 255]), {
      blendMode: 'screen',
    });
    const sub = createGroupLayer('Sub', [inner], { passThrough: false, blendMode: 'multiply', opacity: 0.5 });
    const outer = createGroupLayer('Outer', [sub], { collapsed: true });
    const d = new Document(300, 200, [
      createRasterLayer('Background', TileGrid.filled(300, 200, [255, 255, 255, 255])),
      outer,
    ]);
    d.activeLayerId = inner.id;
    const back = fromSnapshot(readIep(writeIep(toSnapshot(d), { appVersion: '0.1.0' }), BUDGET).doc);
    expect(back.activeLayerId).toBe(inner.id);
    const o = back.layer(outer.id);
    const s = back.layer(sub.id);
    expect(o).toMatchObject({ type: 'group', name: 'Outer', collapsed: true, passThrough: true });
    expect(s).toMatchObject({ type: 'group', passThrough: false, blendMode: 'multiply', opacity: 0.5 });
    expect(back.raster(inner.id).blendMode).toBe('screen');
    expect(back.raster(inner.id).tiles.pixel(10, 10)).toEqual([0, 0, 255, 255]);
    expect(back.locate(inner.id).parent?.id).toBe(sub.id);
  });

  it('rejects groups nested too deeply and ids repeated inside groups', () => {
    let nested: unknown = layerEntry();
    for (let i = 0; i < 40; i++) nested = { id: `G${i}`, type: 'group', name: 'g', children: [nested] };
    expect(() => readIep(zip(manifest({}, [nested]), { 'layers/0/tiles.bin': oneTile() }), BUDGET)).toThrow(
      /nested too deeply/,
    );
    const dup = { id: 'L1', type: 'group', name: 'g', children: [layerEntry()] };
    expect(() => readIep(zip(manifest({}, [dup]), { 'layers/0/tiles.bin': oneTile() }), BUDGET)).toThrow(
      /duplicate layer ids/,
    );
  });

  it('preserves unknown manifest, document and layer fields on re-save (forward compatibility)', () => {
    const bytes = zip(
      manifest({ future: { a: 1 }, document: { width: 256, height: 256, rulers: 'cm' } }, [
        layerEntry({ glow: { size: 3 } }),
      ]),
      { 'layers/0/tiles.bin': oneTile() },
    );
    const again = writeIep(toSnapshot(fromSnapshot(readIep(bytes, BUDGET).doc)), { appVersion: '0.1.0' });
    const m = JSON.parse(strFromU8(unzipSync(again)['manifest.json']!));
    expect(m.future).toEqual({ a: 1 });
    expect(m.document.rulers).toBe('cm');
    expect(m.layers[0].glow).toEqual({ size: 3 });
    expect(m.version).toBe(1);
  });

  it('opens files from a newer version read-only', () => {
    const bytes = zip(manifest({ version: 2 }), { 'layers/0/tiles.bin': oneTile() });
    const { readOnlyReason, doc } = readIep(bytes, BUDGET);
    expect(readOnlyReason).toMatch(/newer version/);
    expect(doc.layers).toHaveLength(1);
  });

  it('leaves out layer types it cannot show, and opens read-only so they are not lost by saving over', () => {
    const bytes = zip(manifest({}, [layerEntry(), { id: 'T1', type: 'text', name: 'Title' }]), {
      'layers/0/tiles.bin': oneTile(),
    });
    const { readOnlyReason, doc } = readIep(bytes, BUDGET);
    expect(readOnlyReason).toMatch(/1 layer/);
    expect(doc.layers.map((l) => l.id)).toEqual(['L1']);
  });

  it('falls back to Normal for an unknown blend mode instead of failing', () => {
    const bytes = zip(manifest({}, [layerEntry({ blendMode: 'vivid-light-2030' })]), {
      'layers/0/tiles.bin': oneTile(),
    });
    expect(readIep(bytes, BUDGET).doc.layers[0]!.blendMode).toBe('normal');
  });

  describe('rejects malformed or hostile files (docs/05 §2.4)', () => {
    const cases: Array<[string, () => Uint8Array, RegExp]> = [
      ['not a zip', () => strToU8('hello'), /not a valid project/],
      ['wrong mimetype', () => zip(manifest(), {}, 'text/plain'), /not an ImageEditor project/],
      [
        'no manifest',
        () => zipSync({ mimetype: strToU8('application/x-imageeditor-project') }),
        /no readable manifest/,
      ],
      [
        'bad JSON',
        () =>
          zipSync({ mimetype: strToU8('application/x-imageeditor-project'), 'manifest.json': strToU8('{') }),
        /damaged manifest/,
      ],
      [
        'document too large',
        () => zip(manifest({ document: { width: 20_001, height: 10 } })),
        /invalid manifest/,
      ],
      [
        'too many layers',
        () =>
          zip(
            manifest(
              {},
              Array.from({ length: 1001 }, (_, i) => layerEntry({ id: `L${i}` })),
            ),
          ),
        /invalid manifest/,
      ],
      [
        'traversal in a tiles path',
        () => zip(manifest({}, [layerEntry({ tiles: '../../etc/passwd' })])),
        /invalid layer/,
      ],
      [
        'traversal in a zip entry name',
        () => zip(manifest(), { '../evil': strToU8('x'), 'layers/0/tiles.bin': oneTile() }),
        /invalid file names/,
      ],
      ['missing tiles', () => zip(manifest()), /missing its pixels/],
      [
        'duplicate layer ids',
        () => zip(manifest({}, [layerEntry(), layerEntry()]), { 'layers/0/tiles.bin': oneTile() }),
        /duplicate layer ids/,
      ],
      [
        'tile outside the canvas',
        () => zip(manifest(), { 'layers/0/tiles.bin': encodeTiles([['1,0', new Uint8Array(TILE_BYTES)]]) }),
        /outside the canvas/,
      ],
      [
        'negative tile coordinate',
        () => zip(manifest(), { 'layers/0/tiles.bin': encodeTiles([['-1,0', new Uint8Array(TILE_BYTES)]]) }),
        /outside the canvas/,
      ],
      [
        'duplicate tile',
        () =>
          zip(manifest({ document: { width: 512, height: 256 } }), {
            'layers/0/tiles.bin': duplicateTileBin(),
          }),
        /duplicate tile/,
      ],
      [
        'truncated tile data',
        () => zip(manifest(), { 'layers/0/tiles.bin': noisyTile().subarray(0, 40) }),
        /truncated/,
      ],
      [
        'tile that inflates beyond one tile (bomb)',
        () => zip(manifest(), { 'layers/0/tiles.bin': bombTileBin() }),
        /damaged/,
      ],
      [
        'tile that inflates short',
        () => zip(manifest(), { 'layers/0/tiles.bin': shortTileBin() }),
        /damaged/,
      ],
    ];
    it.each(cases)('%s', (_name, make, message) => {
      expect(() => readIep(make(), BUDGET)).toThrow(IepError);
      expect(() => readIep(make(), BUDGET)).toThrow(message);
    });

    it('checks the memory budget before inflating any tile', () => {
      const bytes = writeIep(toSnapshot(sampleDoc()), { appVersion: '0.1.0' });
      expect(() => readIep(bytes, { maxTileBytes: TILE_BYTES })).toThrow(/too large/);
    });

    it('never throws anything but IepError on random corruption (fuzz)', () => {
      const valid = writeIep(toSnapshot(sampleDoc()), { appVersion: '0.1.0' });
      fc.assert(
        fc.property(
          fc.array(fc.tuple(fc.nat(valid.length - 1), fc.integer({ min: 0, max: 255 })), { maxLength: 8 }),
          (edits) => {
            const bytes = valid.slice();
            for (const [at, value] of edits) bytes[at] = value;
            try {
              readIep(bytes, BUDGET);
            } catch (err) {
              expect(err).toBeInstanceOf(IepError);
            }
          },
        ),
        { numRuns: 300 },
      );
    });
  });

  it('loads the committed v1 golden fixture (must load forever, docs/05 §2.3)', () => {
    const bytes = readFileSync(
      join(import.meta.dirname, '../../../../../test/fixtures/iep/v1/two-layers.iep'),
    );
    const { doc, readOnlyReason } = readIep(new Uint8Array(bytes), BUDGET);
    expect(readOnlyReason).toBeNull();
    const live = fromSnapshot(doc);
    expect(live.width).toBe(300);
    expect(live.layers.map((l) => l.name)).toEqual(['Background', 'Red dot']);
    expect(live.raster('bg').tiles.pixel(0, 0)).toEqual([255, 255, 255, 255]);
    expect(live.raster('dot').tiles.pixel(150, 100)).toEqual([255, 0, 0, 255]);
    expect(live.raster('dot').tiles.pixel(0, 0)).toEqual([0, 0, 0, 0]);
    expect(live.layers[1]!.opacity).toBe(0.5);
  });
});

function duplicateTileBin(): Uint8Array {
  const one = oneTile();
  const entry = one.subarray(16);
  const out = new Uint8Array(16 + entry.length * 2);
  out.set(one.subarray(0, 16));
  new DataView(out.buffer).setUint32(10, 2, true);
  out.set(entry, 16);
  out.set(entry, 16 + entry.length);
  return out;
}

function withPayload(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(16 + 13 + payload.length);
  out.set(oneTile().subarray(0, 16));
  const dv = new DataView(out.buffer);
  dv.setInt32(16, 0, true);
  dv.setInt32(20, 0, true);
  dv.setUint8(24, 0);
  dv.setUint32(25, payload.length, true);
  out.set(payload, 29);
  return out;
}

const bombTileBin = () => withPayload(deflateSync(new Uint8Array(TILE_BYTES * 64)));
const shortTileBin = () => withPayload(deflateSync(new Uint8Array(100)));
