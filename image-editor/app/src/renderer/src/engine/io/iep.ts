import { deflateSync, inflateSync, strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import {
  DocumentEntry,
  GroupLayerEntry,
  IEP_LIMITS,
  LayerBase,
  IEP_MIMETYPE,
  IEP_VERSION,
  Manifest,
  RasterLayerEntry,
} from '@shared/iep-schema';
import { TILE_BYTES, TILE_SIZE, parseTileKey, tileKey, type TileKey } from '../tiles/tile';
import type { DocSnapshot, LayerSnapshot } from './snapshot';

/** Thrown for files that are not valid projects; `message` is shown to the user. */
export class IepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IepError';
  }
}

export type IepReadResult = {
  doc: DocSnapshot;
  /**
   * Set when the file was written by a newer version or contains layer types this version cannot edit.
   * The document opens, but saving must go to a new file (docs/05 §2.3).
   */
  readOnlyReason: string | null;
};

export type IepReadOptions = {
  /** Total inflated tile bytes allowed (memory budget), checked before inflating (docs/05 §2.4). */
  maxTileBytes: number;
};

// ---- tiles.bin (docs/05 §2.2) --------------------------------------------------------------------

const MAGIC = [0x49, 0x45, 0x50, 0x54]; // "IEPT"
const HEADER_BYTES = 16;
const ENTRY_HEADER_BYTES = 13;
const KIND_DATA = 0;
const KIND_UNIFORM = 1;

/** The packed RGBA value if every pixel of the tile is identical, else null. */
function uniformValue(data: Uint8Array): number | null {
  const v = new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  const first = v[0]!;
  for (let i = 1; i < v.length; i++) if (v[i] !== first) return null;
  return first;
}

export function encodeTiles(tiles: ReadonlyArray<[TileKey, Uint8Array]>): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = HEADER_BYTES;
  for (const [key, data] of tiles) {
    const [tx, ty] = parseTileKey(key);
    const uniform = uniformValue(data);
    let payload: Uint8Array;
    if (uniform !== null) {
      payload = new Uint8Array(4);
      new DataView(payload.buffer).setUint32(0, uniform, true);
    } else {
      payload = deflateSync(data, { level: 6 });
    }
    const head = new Uint8Array(ENTRY_HEADER_BYTES);
    const dv = new DataView(head.buffer);
    dv.setInt32(0, tx, true);
    dv.setInt32(4, ty, true);
    dv.setUint8(8, uniform !== null ? KIND_UNIFORM : KIND_DATA);
    dv.setUint32(9, payload.byteLength, true);
    parts.push(head, payload);
    total += head.byteLength + payload.byteLength;
  }
  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  const dv = new DataView(out.buffer);
  dv.setUint16(4, 1, true); // version
  dv.setUint8(6, 4); // channels
  dv.setUint8(7, 0); // alpha mode: straight
  dv.setUint16(8, TILE_SIZE, true);
  dv.setUint32(10, tiles.length, true);
  // bytes 14..15 reserved (zero)
  let at = HEADER_BYTES;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

type TileIndex = { tx: number; ty: number; kind: number; offset: number; length: number };

/** Parses entry headers without inflating anything, so limits can be checked first. */
function indexTiles(bin: Uint8Array, cols: number, rows: number): TileIndex[] {
  if (bin.byteLength < HEADER_BYTES || MAGIC.some((m, i) => bin[i] !== m))
    throw new IepError('A layer in this project is damaged (bad tile header).');
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  if (dv.getUint16(4, true) !== 1 || dv.getUint8(6) !== 4 || dv.getUint16(8, true) !== TILE_SIZE)
    throw new IepError('A layer in this project uses an unsupported tile format.');
  const count = dv.getUint32(10, true);
  if (count > IEP_LIMITS.maxTilesPerLayer || count > cols * rows)
    throw new IepError('A layer in this project has too many tiles.');
  const out: TileIndex[] = [];
  const seen = new Set<string>();
  let at = HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    if (at + ENTRY_HEADER_BYTES > bin.byteLength) throw new IepError('A layer in this project is truncated.');
    const tx = dv.getInt32(at, true);
    const ty = dv.getInt32(at + 4, true);
    const kind = dv.getUint8(at + 8);
    const length = dv.getUint32(at + 9, true);
    at += ENTRY_HEADER_BYTES;
    if (tx < 0 || ty < 0 || tx >= cols || ty >= rows)
      throw new IepError('A layer in this project has tiles outside the canvas.');
    if (kind !== KIND_DATA && kind !== KIND_UNIFORM)
      throw new IepError('A layer in this project is damaged.');
    if ((kind === KIND_UNIFORM && length !== 4) || at + length > bin.byteLength)
      throw new IepError('A layer in this project is truncated.');
    const k = `${tx},${ty}`;
    if (seen.has(k)) throw new IepError('A layer in this project is damaged (duplicate tile).');
    seen.add(k);
    out.push({ tx, ty, kind, offset: at, length });
    at += length;
  }
  return out;
}

function decodeTile(bin: Uint8Array, e: TileIndex): Uint8Array {
  const payload = bin.subarray(e.offset, e.offset + e.length);
  if (e.kind === KIND_UNIFORM) {
    const data = new Uint8Array(TILE_BYTES);
    const value = new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0, true);
    new Uint32Array(data.buffer).fill(value);
    return data;
  }
  // Inflate into a fixed buffer one byte larger than a tile. fflate stops (without an error) when the
  // buffer is full, so memory stays bounded, and a stream that fills the extra byte is too long: a bomb.
  const buffer = new Uint8Array(TILE_BYTES + 1);
  let out: Uint8Array;
  try {
    out = inflateSync(payload, { out: buffer });
  } catch {
    throw new IepError('A layer in this project is damaged (bad compressed tile).');
  }
  if (out.byteLength !== TILE_BYTES)
    throw new IepError('A layer in this project is damaged (wrong tile size).');
  return buffer.subarray(0, TILE_BYTES);
}

// ---- project zip ---------------------------------------------------------------------------------

const KNOWN_DOC_KEYS = new Set(Object.keys(DocumentEntry.shape));
const KNOWN_MANIFEST_KEYS = new Set(['format', 'version', 'app', 'document', 'layers']);
const KNOWN_RASTER_KEYS = new Set(Object.keys(RasterLayerEntry.shape));
const KNOWN_GROUP_KEYS = new Set(Object.keys(GroupLayerEntry.shape));

function pick(obj: Record<string, unknown>, known: Set<string>): Record<string, unknown> | undefined {
  const extra = Object.fromEntries(Object.entries(obj).filter(([k]) => !known.has(k)));
  return Object.keys(extra).length ? extra : undefined;
}

/** Serialises a document to `.iep` bytes (docs/05 §2). `previewPng` is the flattened preview, if any. */
export function writeIep(
  doc: DocSnapshot,
  opts: { appVersion: string; previewPng?: Uint8Array },
): Uint8Array {
  const files: Zippable = {
    // First and stored, so tools can sniff the type (ODF/EPUB convention).
    mimetype: [strToU8(IEP_MIMETYPE), { level: 0 }],
  };
  // Tile paths use a running index, not the id: ids come from files and must never become zip paths.
  let next = 0;
  const entry = (l: LayerSnapshot): Record<string, unknown> => {
    const common = {
      ...l.extra,
      id: l.id,
      type: l.type,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      fillOpacity: l.fillOpacity,
      blendMode: l.blendMode,
      locks: l.locks,
      clipped: l.clipped,
    };
    if (l.type === 'group')
      return {
        ...common,
        passThrough: l.passThrough,
        collapsed: l.collapsed,
        children: l.children.map(entry),
      };
    const tiles = `layers/${next++}/tiles.bin`;
    files[tiles] = [encodeTiles(l.tiles), { level: 0 }]; // payloads are already deflated
    return { ...common, tiles };
  };
  const layers = doc.layers.map(entry);
  const document: Record<string, unknown> = {
    ...doc.extra?.document,
    width: doc.width,
    height: doc.height,
    ppi: doc.ppi,
    colorSpace: 'sRGB',
    guides: doc.guides,
    activeLayerId: doc.activeLayerId,
    name: doc.name,
    sourceProfile: doc.sourceProfile,
  };
  if (doc.exif) {
    document['exif'] = 'meta/exif.bin';
    files['meta/exif.bin'] = [doc.exif, { level: 6 }];
  }
  const manifest = {
    ...doc.extra?.manifest,
    format: 'iep',
    version: IEP_VERSION,
    app: { name: 'ImageEditor', version: opts.appVersion },
    document,
    layers,
  };
  files['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 1)), { level: 6 }];
  if (opts.previewPng) files['preview.png'] = [opts.previewPng, { level: 0 }];
  return zipSync(files);
}

/** Parses and validates `.iep` bytes into a document snapshot, enforcing docs/05 §2.4 limits. */
export function readIep(bytes: Uint8Array, opts: IepReadOptions): IepReadResult {
  let entries: Record<string, Uint8Array>;
  let declared = 0;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        // Only read what we understand; reject traversal names outright.
        if (file.name.includes('..') || file.name.startsWith('/') || file.name.includes('\\'))
          throw new IepError('This project contains invalid file names.');
        declared += file.originalSize;
        if (declared > opts.maxTileBytes + IEP_LIMITS.maxManifestBytes)
          throw new IepError('This project is too large to open with the current memory budget.');
        return true;
      },
    });
  } catch (err) {
    if (err instanceof IepError) throw err;
    throw new IepError('This file is not a valid project (it could not be unzipped).');
  }
  if (!entries['mimetype'] || strFromU8(entries['mimetype']).trim() !== IEP_MIMETYPE)
    throw new IepError('This file is not an ImageEditor project.');
  const rawManifest = entries['manifest.json'];
  if (!rawManifest || rawManifest.byteLength > IEP_LIMITS.maxManifestBytes)
    throw new IepError('This project has no readable manifest.');

  let json: unknown;
  try {
    json = JSON.parse(strFromU8(rawManifest));
  } catch {
    throw new IepError('This project has a damaged manifest.');
  }
  const parsed = Manifest.safeParse(json);
  if (!parsed.success) throw new IepError('This project has an invalid manifest.');
  const manifest = parsed.data;

  const reasons: string[] = [];
  if (manifest.version > IEP_VERSION)
    reasons.push('This project was saved by a newer version of ImageEditor.');

  const { width, height } = manifest.document;
  const cols = Math.ceil(width / TILE_SIZE);
  const rows = Math.ceil(height / TILE_SIZE);

  // Validate the whole tree and index every tile before inflating anything (bomb guard).
  type Plan =
    | { kind: 'raster'; entry: RasterLayerEntry; bin: Uint8Array; index: TileIndex[] }
    | { kind: 'group'; entry: GroupLayerEntry; children: Plan[] };
  const ids = new Set<string>();
  let skipped = 0;
  let tileCount = 0;
  let layerCount = 0;
  const plan = (list: unknown[], depth: number): Plan[] => {
    if (depth > IEP_LIMITS.maxGroupDepth) throw new IepError('This project has groups nested too deeply.');
    const out: Plan[] = [];
    for (const raw of list) {
      if (++layerCount > IEP_LIMITS.maxLayers) throw new IepError('This project has too many layers.');
      const base = LayerBase.safeParse(raw);
      if (!base.success) throw new IepError('This project has an invalid layer.');
      if (base.data.type !== 'raster' && base.data.type !== 'group') {
        skipped++;
        continue;
      }
      if (ids.has(base.data.id)) throw new IepError('This project has duplicate layer ids.');
      ids.add(base.data.id);
      if (base.data.type === 'group') {
        const group = GroupLayerEntry.safeParse(raw);
        if (!group.success) throw new IepError('This project has an invalid layer.');
        out.push({ kind: 'group', entry: group.data, children: plan(group.data.children, depth + 1) });
        continue;
      }
      const layer = RasterLayerEntry.safeParse(raw);
      if (!layer.success) throw new IepError('This project has an invalid layer.');
      const bin = entries[layer.data.tiles];
      if (!bin) throw new IepError(`Layer “${layer.data.name}” is missing its pixels.`);
      const index = indexTiles(bin, cols, rows);
      tileCount += index.length;
      out.push({ kind: 'raster', entry: layer.data, bin, index });
    }
    return out;
  };
  const plans = plan(manifest.layers, 0);
  if (skipped > 0)
    reasons.push(
      `${skipped} layer${skipped === 1 ? '' : 's'} use features this version cannot show, so ${skipped === 1 ? 'it is' : 'they are'} left out.`,
    );
  if (plans.length === 0) throw new IepError('This project has no layers this version can open.');
  if (tileCount * TILE_BYTES > opts.maxTileBytes)
    throw new IepError('This project is too large to open with the current memory budget.');

  const build = (p: Plan): LayerSnapshot => {
    const e = p.entry;
    const common = {
      id: e.id,
      name: e.name,
      visible: e.visible,
      opacity: e.opacity,
      fillOpacity: e.fillOpacity,
      blendMode: e.blendMode,
      locks: e.locks,
      clipped: e.clipped,
    };
    if (p.kind === 'group') {
      const extra = pick(p.entry, KNOWN_GROUP_KEYS);
      return {
        ...common,
        type: 'group',
        passThrough: p.entry.passThrough,
        collapsed: p.entry.collapsed,
        children: p.children.map(build),
        ...(extra ? { extra } : {}),
      };
    }
    const extra = pick(p.entry, KNOWN_RASTER_KEYS);
    const tiles: Array<[TileKey, Uint8Array]> = p.index.map((t) => [
      tileKey(t.tx, t.ty),
      decodeTile(p.bin, t),
    ]);
    return { ...common, type: 'raster', tiles, ...(extra ? { extra } : {}) };
  };
  const layers = plans.map(build);

  const d = manifest.document;
  const exifPath = d.exif;
  const extraManifest = pick(manifest, KNOWN_MANIFEST_KEYS);
  const extraDocument = pick(d, KNOWN_DOC_KEYS);
  const doc: DocSnapshot = {
    width,
    height,
    ppi: d.ppi,
    guides: d.guides,
    name: d.name ?? 'Untitled',
    sourceProfile: d.sourceProfile ?? null,
    exif: exifPath && entries[exifPath] ? entries[exifPath] : null,
    activeLayerId: d.activeLayerId && ids.has(d.activeLayerId) ? d.activeLayerId : layers.at(-1)!.id,
    layers,
    ...(extraManifest || extraDocument
      ? {
          extra: {
            ...(extraManifest ? { manifest: extraManifest } : {}),
            ...(extraDocument ? { document: extraDocument } : {}),
          },
        }
      : {}),
  };
  return { doc, readOnlyReason: reasons.length ? reasons.join(' ') : null };
}
