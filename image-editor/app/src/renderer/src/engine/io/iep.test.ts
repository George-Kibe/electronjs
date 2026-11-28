import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createAdjustmentLayer,
  createTextLayer,
  createGroupLayer,
  createRasterLayer,
  Document,
  type RasterLayer,
} from '../doc/document';
import { defaultAdjustment } from '../ops/adjust';
import { ellipseMask, Mask, rectMask } from '../doc/selection';
import { createTile, TILE_BYTES, TileGrid } from '../tiles/tile';
import { DEFAULT_TEXT_STYLE, textModel } from '../text/text';
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

  it('keeps pixels outside the canvas (moved there, FR-TRF-07) within one canvas of margin', () => {
    const tiles = new TileGrid();
    const data = new Uint8ClampedArray(TILE_BYTES).fill(200);
    for (const key of ['-2,-1', '-1,0', '3,1', '0,1'])
      tiles.set(key, createTile(new Uint8ClampedArray(data)));
    const doc = new Document(300, 200, createRasterLayer('Moved', tiles)); // 2×1 tiles → x ∈ [-2, 4), y ∈ [-1, 2)
    const back = roundTrip(doc).doc.layers[0] as RasterLayer;
    expect([...back.tiles.keys()].sort()).toEqual(['-1,0', '-2,-1', '0,1', '3,1']);
    expect(back.tiles.get('-2,-1')!.data).toEqual(data);
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
    const bytes = zip(manifest({}, [layerEntry(), { id: 'S1', type: 'smart-object', name: 'Logo' }]), {
      'layers/0/tiles.bin': oneTile(),
    });
    const { readOnlyReason, doc } = readIep(bytes, BUDGET);
    expect(readOnlyReason).toMatch(/1 layer/);
    expect(doc.layers.map((l) => l.id)).toEqual(['L1']);
  });

  describe('text layers (FR-TXT-01, docs/05 §2)', () => {
    const model = textModel('Sale\nToday', {
      ...DEFAULT_TEXT_STYLE,
      family: 'Noto Sans',
      size: 72,
      color: [200, 30, 40, 1],
    });
    const textDoc = () => {
      const cache = TileGrid.filled(300, 120, [200, 30, 40, 255]);
      const mask = new TileGrid();
      mask.set('0,0', createTile(new Uint8ClampedArray(TILE_BYTES).map((_, i) => (i % 4 === 3 ? 128 : 0))));
      return new Document(512, 512, [
        createRasterLayer('bg', TileGrid.filled(512, 512, [255, 255, 255, 255])),
        createTextLayer('Sale', model, { x: 40, y: 60 }, cache, {
          opacity: 0.8,
          mask: { grid: mask, background: 255, enabled: true, linked: true },
        }),
      ]);
    };

    it('round-trip their text, position, rendering and mask, editable', () => {
      const doc = textDoc();
      const { doc: back, readOnlyReason } = roundTrip(doc);
      expect(readOnlyReason).toBeNull();
      const t = back.layers[1]!;
      expect(t.type).toBe('text');
      if (t.type !== 'text') return;
      expect(t.text).toEqual(model);
      expect(t.transform).toEqual([1, 0, 40, 0, 1, 60, 0, 0, 1]);
      expect(t.opacity).toBe(0.8);
      const orig = doc.layers[1]! as typeof t;
      expect([...t.tiles.keys()].sort()).toEqual([...orig.tiles.keys()].sort());
      for (const [k, tile] of orig.tiles.entries()) expect(t.tiles.get(k)!.data).toEqual(tile.data);
      expect(t.mask?.grid.get('0,0')!.data[3]).toBe(128);
    });

    it('store the rendering as the layer’s cache, so the file shows where the fonts are missing', () => {
      const files = unzipSync(writeIep(toSnapshot(textDoc()), { appVersion: '0.1.0' }));
      const m = JSON.parse(strFromU8(files['manifest.json']!)) as { layers: Array<Record<string, unknown>> };
      const entry = m.layers[1]!;
      expect(entry['type']).toBe('text');
      expect(entry['cache']).toMatch(/^layers\/\d+\/tiles\.bin$/);
      expect(entry['tiles']).toBeUndefined();
      expect(files[entry['cache'] as string]).toBeDefined();
    });

    it('a transform this version cannot edit opens as pixels, read-only', () => {
      const files = unzipSync(writeIep(toSnapshot(textDoc()), { appVersion: '0.1.0' }));
      const m = JSON.parse(strFromU8(files['manifest.json']!)) as { layers: Array<Record<string, unknown>> };
      m.layers[1]!['transform'] = [0, -1, 40, 1, 0, 60, 0, 0, 1]; // rotated 90°
      files['manifest.json'] = strToU8(JSON.stringify(m));
      const { doc, readOnlyReason } = readIep(zipSync(files as Zippable), BUDGET);
      expect(doc.layers[1]!.type).toBe('raster');
      expect(readOnlyReason).toMatch(/text layer is transformed/);
    });

    it.each([
      [
        'a size of 0',
        (t: { paragraphs: Array<{ runs: Array<{ size: number }> }> }) => (t.paragraphs[0]!.runs[0]!.size = 0),
      ],
      [
        'too much text',
        (t: { paragraphs: Array<{ runs: Array<{ text: string }> }> }) =>
          (t.paragraphs[0]!.runs[0]!.text = 'x'.repeat(100_001)),
      ],
      ['a box without its size', (t: { mode: string }) => (t.mode = 'box')],
    ])('refuses text with %s (files are untrusted)', (_, damage) => {
      const files = unzipSync(writeIep(toSnapshot(textDoc()), { appVersion: '0.1.0' }));
      const m = JSON.parse(strFromU8(files['manifest.json']!)) as { layers: Array<Record<string, unknown>> };
      (damage as (t: unknown) => void)(m.layers[1]!['text']);
      files['manifest.json'] = strToU8(JSON.stringify(m));
      expect(() => readIep(zipSync(files as Zippable), BUDGET)).toThrow(IepError);
    });
  });

  it('round-trips adjustment layers with their settings, mask, clipping and blend mode (FR-ADJ-01)', () => {
    const levels = defaultAdjustment('levels');
    levels.channels.rgb = { inBlack: 12, inWhite: 240, gamma: 1.1, outBlack: 0, outWhite: 255 };
    const mask = new TileGrid();
    mask.set('0,0', createTile(new Uint8ClampedArray(TILE_BYTES).map((_, i) => (i % 4 === 3 ? i % 251 : 0))));
    const doc = new Document(256, 256, [
      createRasterLayer('bg', TileGrid.filled(256, 256, [10, 20, 30, 255])),
      createAdjustmentLayer('Levels 1', levels, {
        opacity: 0.6,
        blendMode: 'multiply',
        clipped: true,
        mask: { grid: mask, background: 0, enabled: false, linked: true },
      }),
      createAdjustmentLayer('Invert', { kind: 'invert' }, { mask: null }),
    ]);
    const { doc: back, readOnlyReason } = roundTrip(doc);
    expect(readOnlyReason).toBeNull();
    const [, a, b] = back.layers;
    expect(a).toMatchObject({
      type: 'adjustment',
      name: 'Levels 1',
      opacity: 0.6,
      blendMode: 'multiply',
      clipped: true,
    });
    if (a?.type !== 'adjustment' || b?.type !== 'adjustment') throw new Error('expected adjustment layers');
    expect(a.adjustment).toEqual(levels);
    expect(a.mask).toMatchObject({ background: 0, enabled: false, linked: true });
    expect(sameBytes(a.mask!.grid.get('0,0')!.data, mask.get('0,0')!.data)).toBe(true);
    expect(b.adjustment).toEqual({ kind: 'invert' });
    expect(b.mask ?? null).toBeNull();
  });

  it('checks adjustment settings: a value out of range is a damaged file; an unknown kind is left out', () => {
    const adjustment = (adj: unknown) => ({ id: 'A1', type: 'adjustment', name: 'Adj', adjustment: adj });
    const files = { 'layers/0/tiles.bin': oneTile() };
    const bad = zip(manifest({}, [layerEntry(), adjustment({ kind: 'posterize', levels: 1 })]), files);
    expect(() => readIep(bad, BUDGET)).toThrow(IepError);
    const newer = zip(manifest({}, [layerEntry(), adjustment({ kind: 'gradient-map', stops: [] })]), files);
    const { doc, readOnlyReason } = readIep(newer, BUDGET);
    expect(doc.layers.map((l) => l.id)).toEqual(['L1']);
    expect(readOnlyReason).toMatch(/1 layer/);
    // Missing channels take their defaults (the docs/05 example lists only "rgb").
    const partial = zip(
      manifest({}, [
        layerEntry(),
        adjustment({
          kind: 'levels',
          channels: { rgb: { inBlack: 5, inWhite: 250, gamma: 1, outBlack: 0, outWhite: 255 } },
        }),
      ]),
      files,
    );
    const read = readIep(partial, BUDGET).doc.layers[1];
    expect(
      read?.type === 'adjustment' && read.adjustment.kind === 'levels' && read.adjustment.channels.g,
    ).toEqual({
      inBlack: 0,
      inWhite: 255,
      gamma: 1,
      outBlack: 0,
      outWhite: 255,
    });
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
        'tile beyond the off-canvas margin',
        () => zip(manifest(), { 'layers/0/tiles.bin': encodeTiles([['2,0', new Uint8Array(TILE_BYTES)]]) }),
        /outside the canvas/,
      ],
      [
        'negative tile beyond the off-canvas margin',
        () => zip(manifest(), { 'layers/0/tiles.bin': encodeTiles([['0,-2', new Uint8Array(TILE_BYTES)]]) }),
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
      // ~1 s locally, over 5 s on Windows CI runners: keep all 300 cases, allow the time.
    }, 20_000);
  });

  describe('the saved selection (docs/05 §2, FR-SEL)', () => {
    const same = (a: Mask | null, b: Mask | null) => {
      if (!a || !b) return a === b;
      for (let y = 0; y < a.height; y++)
        for (let x = 0; x < a.width; x++) if (a.value(x, y) !== b.value(x, y)) return false;
      return true;
    };

    it('round-trips a soft-edged selection exactly', () => {
      const doc = sampleDoc();
      doc.selection = rectMask({ x0: 0, y0: 0, x1: doc.width, y1: 20 }, doc.width, doc.height).combine(
        'add',
        ellipseMask({ x0: 10.5, y0: 15.5, x1: doc.width - 10, y1: doc.height - 5 }, doc.width, doc.height),
      );
      const back = roundTrip(doc).doc;
      expect(same(back.selection, doc.selection)).toBe(true);
      const files = unzipSync(writeIep(toSnapshot(doc), { appVersion: '0.1.0' }));
      expect(files['selection/tiles.bin']![6]).toBe(1); // one channel
    });

    it('writes nothing for no selection, and drops a stale reference from another version', () => {
      const doc = sampleDoc();
      doc.meta.extra = { document: { selection: 'selection/tiles.bin' } };
      const files = unzipSync(writeIep(toSnapshot(doc), { appVersion: '0.1.0' }));
      expect(files['selection/tiles.bin']).toBeUndefined();
      expect(JSON.parse(strFromU8(files['manifest.json']!)).document.selection).toBeUndefined();
      expect(roundTrip(doc).doc.selection).toBeNull();
    });

    it('a missing or damaged selection only loses the selection', () => {
      const tiles = { 'layers/0/tiles.bin': oneTile() };
      const withSel = (sel: Uint8Array | undefined) =>
        readIep(
          zip(manifest({ document: { width: 256, height: 256, selection: 'selection/tiles.bin' } }), {
            ...tiles,
            ...(sel ? { 'selection/tiles.bin': sel } : {}),
          }),
          BUDGET,
        );
      expect(withSel(undefined).doc.selection).toBeNull(); // re-saved by an older version: entry gone
      expect(withSel(new Uint8Array([1, 2, 3])).doc.selection).toBeNull(); // garbage
      expect(withSel(oneTile()).doc.selection).toBeNull(); // 4-channel tiles are not a selection
      const offCanvas = encodeTiles([['5,5', new Uint8Array(256 * 256).fill(255)]], 1);
      expect(withSel(offCanvas).doc.selection).toBeNull();
      const good = encodeTiles([['0,0', new Uint8Array(256 * 256).fill(255)]], 1);
      expect(fromSnapshot(withSel(good).doc).selection?.bounds()).toEqual({ x0: 0, y0: 0, x1: 256, y1: 256 });
    });
  });

  describe('layer masks (FR-LAY-04, docs/05 §2.1)', () => {
    const masked = () => {
      const doc = sampleDoc();
      const layer = doc.layers.find((l) => l.type === 'raster')! as RasterLayer;
      const data = new Uint8ClampedArray(TILE_BYTES);
      for (let i = 0; i < 256 * 256; i++) data[i * 4 + 3] = i % 256;
      const grid = new TileGrid();
      grid.set('0,0', createTile(data));
      layer.mask = { grid, background: 0, enabled: false, linked: false };
      return { doc, id: layer.id };
    };

    it('round-trips the mask exactly, stored as one channel', () => {
      const { doc, id } = masked();
      const back = roundTrip(doc).doc.raster(id).mask!;
      expect([back.background, back.enabled, back.linked]).toEqual([0, false, false]);
      expect(sameBytes(back.grid.get('0,0')!.data, doc.raster(id).mask!.grid.get('0,0')!.data)).toBe(true);
      const files = unzipSync(writeIep(toSnapshot(doc), { appVersion: '0.1.0' }));
      const entry = JSON.parse(strFromU8(files['manifest.json']!)).layers.find(
        (l: { id: string }) => l.id === id,
      );
      expect(entry.mask).toMatchObject({ background: 0, enabled: false, linked: false });
      expect(files[entry.mask.tiles]![6]).toBe(1); // one channel
    });

    it('a missing mask opens the layer unmasked and the document read-only; a damaged one fails', () => {
      const mask = { background: 255, tiles: 'masks/0/tiles.bin' };
      const missing = readIep(
        zip(manifest({}, [layerEntry({ mask })]), { 'layers/0/tiles.bin': oneTile() }),
        BUDGET,
      );
      expect(missing.readOnlyReason).toMatch(/mask is missing/);
      expect((missing.doc.layers[0] as { mask?: unknown }).mask).toBeUndefined();
      expect(() =>
        readIep(
          zip(manifest({}, [layerEntry({ mask })]), {
            'layers/0/tiles.bin': oneTile(),
            'masks/0/tiles.bin': oneTile(),
          }),
          BUDGET,
        ),
      ).toThrow(IepError); // 4-channel tiles where a mask belongs
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
