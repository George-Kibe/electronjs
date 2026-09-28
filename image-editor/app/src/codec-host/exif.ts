/**
 * EXIF sanitiser for export (FR-DOC-09, docs/06 §5). Parses the source image's EXIF (untrusted: bounds are
 * checked everywhere) and REBUILDS a fresh block from an allow-list, instead of deleting tags in place, so
 * dropped data (GPS, maker notes, thumbnails) can never survive as unreferenced bytes.
 */
export type MetadataPolicy = 'keep' | 'remove-gps' | 'remove-all';

type Entry = { tag: number; type: number; count: number; /** little-endian value bytes */ value: Uint8Array };

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8, 11: 4, 12: 8 };
/** Bytes per endian-swappable unit (rationals are two 4-byte integers). */
const UNIT_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 7: 1, 9: 4, 10: 4, 11: 4, 12: 8 };

const EXIF_IFD = 0x8769;
const GPS_IFD = 0x8825;
const ORIENTATION = 0x0112;
const COLOR_SPACE = 0xa001;

/** Descriptive tags that stay true after editing. Sizes, thumbnails, maker notes and offsets are dropped. */
const IFD0_TAGS = new Set([
  0x010e, // ImageDescription
  0x010f, // Make
  0x0110, // Model
  0x011a, // XResolution
  0x011b, // YResolution
  0x0128, // ResolutionUnit
  0x0131, // Software
  0x0132, // DateTime
  0x013b, // Artist
  0x8298, // Copyright
]);
const EXIF_TAGS = new Set([
  0x829a,
  0x829d,
  0x8822,
  0x8827,
  0x8830,
  0x8832, // exposure, f-number, program, ISO, sensitivity
  0x9000,
  0x9003,
  0x9004,
  0x9010,
  0x9011,
  0x9012, // version, dates, offsets
  0x9201,
  0x9202,
  0x9203,
  0x9204,
  0x9205,
  0x9206,
  0x9207,
  0x9208,
  0x9209,
  0x920a, // APEX values, flash, focal length
  0x9290,
  0x9291,
  0x9292, // sub-second times
  0xa402,
  0xa403,
  0xa404,
  0xa405,
  0xa406, // exposure mode, white balance, zoom, 35 mm focal, scene
  0xa432,
  0xa433,
  0xa434, // lens specification, make, model
]);
/** Identifying but not location data: only with "Keep metadata". */
const EXIF_KEEP_ONLY_TAGS = new Set([0xa430, 0xa431, 0xa435]); // owner name, body serial, lens serial

const MAX_ENTRIES_PER_IFD = 512;
const MAX_VALUE_BYTES = 64 * 1024;

class Reader {
  private readonly dv: DataView;
  constructor(
    readonly buf: Uint8Array,
    readonly le: boolean,
  ) {
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  u16(at: number): number {
    if (at < 0 || at + 2 > this.buf.length) throw new RangeError('EXIF out of bounds');
    return this.dv.getUint16(at, this.le);
  }
  u32(at: number): number {
    if (at < 0 || at + 4 > this.buf.length) throw new RangeError('EXIF out of bounds');
    return this.dv.getUint32(at, this.le);
  }
}

function readIfd(r: Reader, offset: number): Entry[] {
  const n = r.u16(offset);
  if (n > MAX_ENTRIES_PER_IFD) throw new RangeError('EXIF IFD too large');
  const entries: Entry[] = [];
  for (let i = 0; i < n; i++) {
    const at = offset + 2 + i * 12;
    const tag = r.u16(at);
    const type = r.u16(at + 2);
    const count = r.u32(at + 4);
    const size = TYPE_SIZE[type];
    if (!size) continue; // unknown type: drop
    const bytes = size * count;
    if (bytes > MAX_VALUE_BYTES) continue;
    const valueAt = bytes <= 4 ? at + 8 : r.u32(at + 8);
    if (valueAt < 0 || valueAt + bytes > r.buf.length) continue;
    const value = r.buf.slice(valueAt, valueAt + bytes);
    const unit = UNIT_SIZE[type]!;
    if (!r.le && unit > 1) for (let u = 0; u < bytes; u += unit) value.subarray(u, u + unit).reverse();
    entries.push({ tag, type, count, value });
  }
  return entries;
}

function u32le(entry: Entry | undefined): number | undefined {
  if (!entry || entry.value.length < 4) return undefined;
  return new DataView(entry.value.buffer, entry.value.byteOffset, 4).getUint32(0, true);
}

/** Splits an EXIF block ("Exif\0\0" + TIFF, or bare TIFF) into its IFD0, Exif and GPS entries. */
export function parseExif(raw: Uint8Array): { ifd0: Entry[]; exif: Entry[]; gps: Entry[] } | null {
  try {
    let tiff = raw;
    if (raw.length >= 6 && String.fromCharCode(...raw.subarray(0, 4)) === 'Exif') tiff = raw.subarray(6);
    if (tiff.length < 8) return null;
    const order = String.fromCharCode(tiff[0]!, tiff[1]!);
    if (order !== 'II' && order !== 'MM') return null;
    const r = new Reader(tiff, order === 'II');
    if (r.u16(2) !== 42) return null;
    const ifd0 = readIfd(r, r.u32(4));
    const exifAt = u32le(ifd0.find((e) => e.tag === EXIF_IFD));
    const gpsAt = u32le(ifd0.find((e) => e.tag === GPS_IFD));
    return {
      ifd0,
      exif: exifAt ? readIfd(r, exifAt) : [],
      gps: gpsAt ? readIfd(r, gpsAt) : [],
    };
  } catch {
    return null;
  }
}

function short(tag: number, v: number): Entry {
  const value = new Uint8Array(2);
  new DataView(value.buffer).setUint16(0, v, true);
  return { tag, type: 3, count: 1, value };
}

function pointer(tag: number): Entry {
  return { tag, type: 4, count: 1, value: new Uint8Array(4) };
}

/** Serialises IFDs (little-endian TIFF). Pointer entries are patched to the child IFD offsets. */
function writeTiff(ifd0: Entry[], exif: Entry[], gps: Entry[]): Uint8Array {
  const ifdSize = (entries: Entry[]) => {
    let size = 2 + entries.length * 12 + 4;
    for (const e of entries) if (e.value.length > 4) size += e.value.length + (e.value.length & 1);
    return size;
  };
  const layout: Array<[Entry[], number]> = [];
  let at = 8;
  const push = (entries: Entry[]) => {
    const start = at;
    layout.push([entries, start]);
    at += ifdSize(entries);
    return start;
  };
  push(ifd0);
  const exifAt = exif.length ? push(exif) : 0;
  const gpsAt = gps.length ? push(gps) : 0;

  const out = new Uint8Array(at);
  const dv = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0]);
  dv.setUint32(4, 8, true);
  for (const [entries, start] of layout) {
    entries.sort((a, b) => a.tag - b.tag);
    dv.setUint16(start, entries.length, true);
    let data = start + 2 + entries.length * 12 + 4;
    for (const [i, e] of entries.entries()) {
      const p = start + 2 + i * 12;
      dv.setUint16(p, e.tag, true);
      dv.setUint16(p + 2, e.type, true);
      dv.setUint32(p + 4, e.count, true);
      if (e.tag === EXIF_IFD) dv.setUint32(p + 8, exifAt, true);
      else if (e.tag === GPS_IFD) dv.setUint32(p + 8, gpsAt, true);
      else if (e.value.length <= 4) out.set(e.value, p + 8);
      else {
        dv.setUint32(p + 8, data, true);
        out.set(e.value, data);
        data += e.value.length + (e.value.length & 1);
      }
    }
    dv.setUint32(start + 2 + entries.length * 12, 0, true); // no next IFD (thumbnails dropped)
  }
  return out;
}

/**
 * Returns a fresh "Exif\0\0"-prefixed block for the policy, or null when nothing should be written.
 * Orientation is always reset to 1 because pixels are exported upright (FR-DOC-09).
 */
export function sanitizeExif(raw: Uint8Array | null, policy: MetadataPolicy): Uint8Array | null {
  if (!raw || policy === 'remove-all') return null;
  const parsed = parseExif(raw);
  if (!parsed) return null;
  const keep = policy === 'keep';
  const ifd0 = parsed.ifd0.filter((e) => IFD0_TAGS.has(e.tag));
  ifd0.push(short(ORIENTATION, 1));
  const exif = parsed.exif.filter((e) => EXIF_TAGS.has(e.tag) || (keep && EXIF_KEEP_ONLY_TAGS.has(e.tag)));
  if (exif.length) {
    exif.push(short(COLOR_SPACE, 1)); // pixels are sRGB after import conversion
    ifd0.push(pointer(EXIF_IFD));
  }
  const gps = keep ? parsed.gps : [];
  if (gps.length) ifd0.push(pointer(GPS_IFD));
  const tiff = writeTiff(ifd0, exif, gps);
  const out = new Uint8Array(6 + tiff.length);
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0]);
  out.set(tiff, 6);
  return out;
}
